import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { AuthenticatedSocket } from "./websocket";
import { supabase } from "../middleware/auth";
import { notifyAssignmentQuery, notifyParsingError, notifyRequestError } from "./discord";
import { webSearch, formatSearchResultsForPrompt } from "./search";

// S3 client for IDE bucket creation
const S3_DEFAULT_REGION = "us-east-1";
const s3Client = new S3Client({
  region: S3_DEFAULT_REGION,
  credentials:
    process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
          secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
        }
      : undefined,
});

interface IdeBlockFile {
  path: string;
  content: string;
}

/**
 * Process IDE block files - creates S3 buckets and uploads files
 * Returns the block with updated s3_bucket_ids
 */
async function processIdeBlockFiles(
  block: any,
  userId: string,
  courseId?: string,
  assignmentId?: string
): Promise<any> {
  if (block.type !== "ideBlock" || !block.attrs?.ideData) {
    return block;
  }

  const ideData = block.attrs.ideData;
  const templateFiles: IdeBlockFile[] = ideData.templateFiles || [];
  const modelSolutionFiles: IdeBlockFile[] = ideData.modelSolutionFiles || [];

  // Process template files
  if (templateFiles.length > 0 && !ideData.template?.s3_bucket_id) {
    try {
      const bucketId = await createBucketWithFiles(
        templateFiles,
        userId,
        courseId,
        assignmentId,
        true // isTemplate
      );
      ideData.template = { ...ideData.template, s3_bucket_id: bucketId };
      logger.info("Created S3 bucket for IDE template files", {
        bucketId,
        fileCount: templateFiles.length,
      });
    } catch (error) {
      logger.error("Failed to create S3 bucket for template files", {
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  // Process model solution files
  if (modelSolutionFiles.length > 0 && !ideData.modelSolution?.s3_bucket_id) {
    try {
      const bucketId = await createBucketWithFiles(
        modelSolutionFiles,
        userId,
        courseId,
        assignmentId,
        true // isTemplate
      );
      ideData.modelSolution = { ...ideData.modelSolution, s3_bucket_id: bucketId };
      logger.info("Created S3 bucket for IDE model solution files", {
        bucketId,
        fileCount: modelSolutionFiles.length,
      });
    } catch (error) {
      logger.error("Failed to create S3 bucket for model solution files", {
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  // Clean up the temporary file arrays from the block (they were only for AI communication)
  delete ideData.templateFiles;
  delete ideData.modelSolutionFiles;

  return block;
}

/**
 * Create an S3 bucket and upload files to it
 */
async function createBucketWithFiles(
  files: IdeBlockFile[],
  userId: string,
  courseId?: string,
  assignmentId?: string,
  isTemplate: boolean = false
): Promise<string> {
  const bucketId = uuidv4();
  const bucketName = `classla-ide-${userId.substring(0, 8)}-${Date.now()}`;

  // Insert bucket record with 'creating' status
  const { error: insertError } = await supabase.from("s3_buckets").insert({
    id: bucketId,
    bucket_name: bucketName,
    region: S3_DEFAULT_REGION,
    user_id: userId,
    course_id: courseId || null,
    assignment_id: assignmentId || null,
    status: "creating",
    is_template: isTemplate,
  });

  if (insertError) {
    throw new Error(`Failed to insert bucket record: ${insertError.message}`);
  }

  try {
    // Create S3 bucket
    const createCommand = new CreateBucketCommand({
      Bucket: bucketName,
    });
    await s3Client.send(createCommand);

    // Upload files
    for (const file of files) {
      const contentBuffer = Buffer.from(file.content, "utf-8");

      // Determine content type based on file extension
      const extension = file.path.split(".").pop()?.toLowerCase();
      const contentTypeMap: Record<string, string> = {
        py: "text/x-python",
        js: "text/javascript",
        ts: "text/typescript",
        java: "text/x-java-source",
        html: "text/html",
        css: "text/css",
        json: "application/json",
        md: "text/markdown",
        txt: "text/plain",
        sh: "text/x-shellscript",
      };
      const contentType = contentTypeMap[extension || ""] || "text/plain";

      const putCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: file.path,
        Body: contentBuffer,
        ContentType: contentType,
      });
      await s3Client.send(putCommand);
    }

    // Update status to 'active'
    await supabase
      .from("s3_buckets")
      .update({ status: "active" })
      .eq("id", bucketId);

    return bucketId;
  } catch (error) {
    // Update status to 'error'
    await supabase
      .from("s3_buckets")
      .update({ status: "error" })
      .eq("id", bucketId);
    throw error;
  }
}

// Tool definitions for Claude
const TOOLS = [
  {
    name: "web_search",
    description: "Search the web for current information about topics. Use this when you need up-to-date information, facts, or references that may not be in your training data. Good for finding recent examples, current best practices, or specific technical documentation.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant information",
        },
      },
      required: ["query"],
    },
  },
];

// Claude model IDs
const CLAUDE_SONNET_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const CLAUDE_HAIKU_MODEL_ID = "us.anthropic.claude-3-5-haiku-20241022-v1:0";

// For backwards compatibility
const CLAUDE_MODEL_ID = CLAUDE_SONNET_MODEL_ID;

// Maximum context window in tokens (200k tokens)
const MAX_CONTEXT_WINDOW = 200000;

/**
 * Use Haiku to quickly determine if web search is needed for a prompt
 * Returns true if the prompt likely needs web search (URLs, "search", recent info, etc.)
 */
async function shouldUseWebSearch(prompt: string): Promise<boolean> {
  // Quick regex checks first - no need to call Haiku for obvious cases
  const urlPattern = /https?:\/\/[^\s]+/i;
  const explicitSearchPattern = /\b(search|look up|find online|web search|google|browse)\b/i;
  const documentationPattern = /\b(docs|documentation|official|latest version|current version)\b/i;

  // If there's a URL or explicit search request, definitely use web search
  if (urlPattern.test(prompt) || explicitSearchPattern.test(prompt)) {
    return true;
  }

  // If asking about documentation, likely needs web search
  if (documentationPattern.test(prompt)) {
    return true;
  }

  // For most educational content generation, we don't need web search
  // Common patterns that DON'T need web search:
  const noSearchPatterns = [
    /\b(create|make|write|generate|build)\b.*\b(quiz|assignment|lesson|exercise|problem|test)\b/i,
    /\b(python|java|javascript|coding|programming)\b.*\b(assignment|exercise|problem)\b/i,
    /\b(explain|teach|introduction|intro|basics|fundamentals)\b/i,
    /\b(mcq|multiple choice|fill in the blank|short answer)\b/i,
    /\b(autograder|grading|grade)\b/i,
  ];

  for (const pattern of noSearchPatterns) {
    if (pattern.test(prompt)) {
      return false;
    }
  }

  // For edge cases, use Haiku for a quick decision
  try {
    const client = getBedrockClient();

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: `Does this educational content request require searching the web for current/external information? Answer only "yes" or "no".

Request: "${prompt.substring(0, 500)}"`,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: CLAUDE_HAIKU_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const answer = responseBody.content?.[0]?.text?.toLowerCase().trim() || "no";

    return answer.includes("yes");
  } catch (error) {
    // If Haiku call fails, default to no web search
    logger.warn("Haiku web search check failed, defaulting to no search", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

// Estimate tokens by dividing character count by 3.5
const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 3.5);
};

// Initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

const getBedrockClient = (): BedrockRuntimeClient => {
  if (!bedrockClient) {
    const region = process.env.AWS_REGION || process.env.BEDROCK_REGION || "us-east-1";
    
    const config: any = {
      region,
    };

    // In production, prefer IAM role credentials (no explicit credentials needed)
    // Only use explicit credentials if provided (for local development or special cases)
    if (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY,
      };
      logger.info("Using explicit Bedrock credentials from environment variables");
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
      logger.info("Using explicit AWS credentials from environment variables");
    } else {
      // No explicit credentials - will use IAM role credentials (default AWS SDK behavior)
      logger.info("Using IAM role credentials for Bedrock (no explicit credentials provided)");
    }
    
    bedrockClient = new BedrockRuntimeClient(config);
  }
  return bedrockClient;
};

// System prompt for TipTap JSON generation
const SYSTEM_PROMPT = `You are an AI assistant that generates educational content in TipTap JSON format.

CRITICAL: Your response must be ONLY valid JSON. Do NOT include:
- Any conversational text like "I'll help you..." or "Here's..."
- Any markdown formatting or code blocks
- Any explanations before or after the JSON
- Any text that is not part of the JSON structure

Your ENTIRE response must start with { and end with }

## TipTap JSON Structure
- Top level: { "type": "doc", "content": [...] }
- Content is an array of block nodes
- Standard block types: "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule"

## Standard TipTap Nodes
- paragraph: { "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }
- heading: { "type": "heading", "attrs": { "level": 1-6 }, "content": [{ "type": "text", "text": "..." }] }
- bulletList: { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", ... }] }] }
- orderedList: { "type": "orderedList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", ... }] }] }
- codeBlock: { "type": "codeBlock", "attrs": { "language": "python" }, "content": [{ "type": "text", "text": "code here" }] }
- blockquote: { "type": "blockquote", "content": [{ "type": "paragraph", ... }] }
- horizontalRule: { "type": "horizontalRule" }

## Interactive/Graded Block Types

### 1. MCQ Block (Multiple Choice Question)
Best for: Quick knowledge checks, quizzes, exam questions
{
  "type": "mcqBlock",
  "attrs": {
    "mcqData": {
      "id": "uuid",
      "question": "<p>HTML question text</p>",
      "options": [
        { "id": "uuid", "text": "<p>Option text</p>", "isCorrect": true },
        { "id": "uuid", "text": "<p>Option text</p>", "isCorrect": false }
      ],
      "allowMultiple": false,
      "points": 1,
      "explanation": "optional explanation"
    }
  }
}

### 2. Fill-in-the-Blank Block
Best for: Vocabulary, definitions, completing code snippets
{
  "type": "fillInTheBlankBlock",
  "attrs": {
    "fillInTheBlankData": {
      "id": "uuid",
      "question": "<p>The capital of France is [BLANK].</p>",
      "blanks": [
        {
          "id": "uuid",
          "acceptedAnswers": ["Paris", "paris"],
          "caseSensitive": false,
          "feedback": "optional feedback"
        }
      ],
      "points": 1,
      "pointsPerBlank": false,
      "attempts": 3,
      "showHintAfterAttempts": 1,
      "showAnswerAfterAttempts": 3,
      "generalFeedback": "optional"
    }
  }
}
Note: Use [BLANK] markers in the question. Each [BLANK] corresponds to an entry in the blanks array in order.

### 3. Short Answer Block
Best for: Open-ended responses, explanations, essays
{
  "type": "shortAnswerBlock",
  "attrs": {
    "shortAnswerData": {
      "id": "uuid",
      "prompt": "<p>Explain the concept of recursion.</p>",
      "minWords": 50,
      "maxWords": 500,
      "points": 5,
      "sampleAnswer": "hidden from students - for grading reference",
      "gradingType": "manual",
      "keywordMatches": [],
      "regexPattern": "",
      "caseSensitive": false
    }
  }
}
gradingType options: "manual" (instructor grades), "keyword" (auto-check for keywords), "regex" (pattern matching)

### 4. IDE Block (Code Editor)
Best for: Programming exercises, coding challenges
{
  "type": "ideBlock",
  "attrs": {
    "ideData": {
      "id": "uuid",
      "template": { "s3_bucket_id": null, "last_container_id": null },
      "modelSolution": { "s3_bucket_id": null, "last_container_id": null },
      "autoGrading": { "s3_bucket_id": null, "last_container_id": null },
      "points": 10,
      "settings": { "default_run_file": "main.py", "language": "python" },
      "autograder": {
        "tests": [
          { "id": "uuid", "name": "Test basic input", "type": "inputOutput", "input": "hello", "expectedOutput": "HELLO", "points": 5 },
          { "id": "uuid", "name": "Test uppercase function", "type": "unitTest", "points": 5, "framework": "unittest", "code": "import unittest\\nfrom main import to_uppercase\\n\\nclass TestUppercase(unittest.TestCase):\\n    def test_basic(self):\\n        self.assertEqual(to_uppercase('hello'), 'HELLO')\\n\\n    def test_empty(self):\\n        self.assertEqual(to_uppercase(''), '')\\n\\nif __name__ == '__main__':\\n    unittest.main()" }
        ],
        "allowStudentCheckAnswer": true
      },
      "templateFiles": [
        { "path": "main.py", "content": "def to_uppercase(s):\\n    # TODO: Implement this function\\n    pass\\n\\nif __name__ == '__main__':\\n    user_input = input()\\n    print(to_uppercase(user_input))" }
      ],
      "modelSolutionFiles": [
        { "path": "main.py", "content": "def to_uppercase(s):\\n    return s.upper()\\n\\nif __name__ == '__main__':\\n    user_input = input()\\n    print(to_uppercase(user_input))" }
      ]
    }
  }
}
language options: "python", "java"
test types: "inputOutput" (stdin/stdout), "unitTest" (code assertions), "manualGrading" (instructor reviews)

CRITICAL AUTOGRADER TEST FORMAT:
- inputOutput tests: Student's main.py reads from stdin (input()) and prints to stdout (print()). The test passes input and compares output.
- unitTest (Python): The "code" field MUST be a COMPLETE unittest file with imports, a TestCase class, and test methods. Example:
  "code": "import unittest\\nfrom main import my_function\\n\\nclass TestMyFunction(unittest.TestCase):\\n    def test_case_1(self):\\n        self.assertEqual(my_function(5), 25)\\n\\n    def test_case_2(self):\\n        self.assertEqual(my_function(0), 0)\\n\\nif __name__ == '__main__':\\n    unittest.main()"
- unitTest (Java): The "code" field MUST be a COMPLETE JUnit test file with imports and a test class.

IMPORTANT: When generating IDE blocks:
1. Always include templateFiles with starter code that students will modify
2. Include modelSolutionFiles with the complete working solution
3. For inputOutput tests, ensure the template has an if __name__ == '__main__' block that reads input() and prints output
4. For unitTest, the code must import from main (or the default_run_file) and test specific functions

### 5. Parsons Problem Block
Best for: Teaching code structure, algorithm ordering
{
  "type": "parsonsProblemBlock",
  "attrs": {
    "parsonsProblemData": {
      "id": "uuid",
      "instruction": "<p>Arrange the code blocks to create a function that prints 1-5.</p>",
      "correctSolution": "for i in range(1, 6):\\n    print(i)",
      "blocks": [
        { "id": "uuid", "code": "for i in range(1, 6):", "indentLevel": 0 },
        { "id": "uuid", "code": "print(i)", "indentLevel": 1 }
      ],
      "distractorBlocks": [
        { "id": "uuid", "code": "for i in range(5):" }
      ],
      "enableIndentation": true,
      "indentSpaces": 4,
      "showLineNumbers": true,
      "feedbackMode": "immediate",
      "points": 5
    }
  }
}
feedbackMode: "immediate" or "onCorrect"

### 6. Drag-and-Drop Matching Block
Best for: Vocabulary matching, concept pairing, categorization
{
  "type": "dragDropMatchingBlock",
  "attrs": {
    "dragDropMatchingData": {
      "id": "uuid",
      "instruction": "Match the programming terms to their definitions.",
      "sourceItems": [
        { "id": "item-1", "text": "Variable" },
        { "id": "item-2", "text": "Function" }
      ],
      "targetZones": [
        { "id": "zone-1", "label": "Stores data", "correctItemIds": ["item-1"] },
        { "id": "zone-2", "label": "Reusable code block", "correctItemIds": ["item-2"] }
      ],
      "matchType": "one-to-one",
      "randomizeItems": true,
      "points": 4,
      "partialCredit": true
    }
  }
}
matchType: "one-to-one" or "many-to-one"

### 7. Clickable Area Block (Code Selection)
Best for: Identifying errors, selecting correct lines, code review
{
  "type": "clickableAreaBlock",
  "attrs": {
    "clickableAreaData": {
      "id": "uuid",
      "instruction": "<p>Click on the line(s) that contain a bug.</p>",
      "content": "x = 10\\nif x = 10:\\n    print(x)",
      "lines": [
        { "lineNumber": 1, "content": "x = 10", "isCorrect": false, "isClickable": true },
        { "lineNumber": 2, "content": "if x = 10:", "isCorrect": true, "isClickable": true },
        { "lineNumber": 3, "content": "    print(x)", "isCorrect": false, "isClickable": true }
      ],
      "showLineNumbers": true,
      "allowMultipleAttempts": true,
      "showCorrectAfterAttempts": 3,
      "points": 2,
      "partialCredit": true
    }
  }
}

## Content/Non-Graded Block Types

### 8. Poll Block
Best for: Gathering opinions, class feedback, engagement
{
  "type": "pollBlock",
  "attrs": {
    "pollData": {
      "id": "uuid",
      "question": "Which topic should we cover next?",
      "options": [
        { "id": "uuid", "text": "Data Structures" },
        { "id": "uuid", "text": "Algorithms" },
        { "id": "uuid", "text": "Web Development" }
      ],
      "selectionType": "single",
      "showResults": "after-voting",
      "allowAnswerChange": false
    }
  }
}
selectionType: "single" or "multiple"
showResults: "never", "after-voting", "after-close", "immediately"

### 9. Tabbed Content Block
Best for: Organizing related content, showing multiple examples, language comparisons
{
  "type": "tabbedContentBlock",
  "attrs": {
    "tabbedContentData": {
      "id": "uuid",
      "tabs": [
        { "id": "uuid", "label": "Python", "content": "<p>Python example code here</p>" },
        { "id": "uuid", "label": "JavaScript", "content": "<p>JS example code here</p>" }
      ],
      "defaultActiveTab": null,
      "tabPosition": "top"
    }
  }
}
tabPosition: "top" or "left"

### 10. Reveal Content Block (Hints)
Best for: Hints, solutions, supplementary information
{
  "type": "revealContentBlock",
  "attrs": {
    "revealContentData": {
      "id": "uuid",
      "buttonText": "Show Hint",
      "content": "<p>Consider using a loop to iterate through the list.</p>",
      "initiallyVisible": false,
      "showHideButton": true,
      "buttonStyle": "default"
    }
  }
}
buttonStyle: "default", "accent", "custom"

### 11. Embed Block
Best for: Videos, external resources, interactive content
{
  "type": "embedBlock",
  "attrs": {
    "embedData": {
      "id": "uuid",
      "title": "Introduction to Python",
      "embedType": "youtube",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID",
      "startTime": "01:30",
      "width": "responsive",
      "allowFullscreen": true
    }
  }
}
embedType: "youtube", "vimeo", "iframe", "video"

## Important Rules
1. Generate unique UUIDs for all id fields (format: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx")
2. Questions/prompts should be HTML strings wrapped in <p> tags
3. For graded blocks, set appropriate points values (typically 1-10)
4. Mix block types appropriately based on learning objectives
5. Use content blocks (paragraphs, headings) to provide context and instructions
6. For MCQ, include 4-5 options with at least one correct answer
7. For fill-in-the-blank, ensure [BLANK] count matches blanks array length
8. For IDE blocks, s3_bucket_id and last_container_id should be null (they are automatically created from templateFiles and modelSolutionFiles)
9. Consider partial credit for complex questions

## OUTPUT FORMAT - CRITICAL
Your response MUST be ONLY a valid JSON object.
- Start your response with { (the opening brace)
- End your response with } (the closing brace)
- Do NOT include ANY text before or after the JSON
- Do NOT say "Here is", "I'll create", "Sure", or ANY conversational text
- Do NOT wrap the JSON in markdown code blocks (\`\`\`)
- The JSON must parse successfully with JSON.parse()

Example of CORRECT response format:
{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}

Example of WRONG response format:
I'll help you create... {"type":"doc"...`;

interface GenerateContentOptions {
  prompt: string;
  assignmentContext?: {
    name?: string;
    courseName?: string;
  };
  taggedAssignments?: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  images?: Array<{
    base64: string;
    mimeType: string;
  }>;
  userId?: string;
  userEmail?: string;
  assignmentId?: string;
  courseId?: string;
  requestId?: string;
}

/**
 * Generate content (non-streaming version)
 */
export const generateContent = async (
  options: GenerateContentOptions
): Promise<any> => {
  const { prompt, assignmentContext, userId, assignmentId, courseId, requestId } = options;

  // Create LLM call log entry
  let llmCallId: string | null = null;
  try {
    if (userId && assignmentId && courseId) {
      const { data: llmCall, error: insertError } = await supabase
        .from("llm_calls")
        .insert({
          assignment_id: assignmentId,
          user_id: userId,
          course_id: courseId,
          prompt: prompt,
          success: false, // Will update later
          request_id: requestId || undefined,
        })
        .select("id")
        .single();

      if (!insertError && llmCall) {
        llmCallId = llmCall.id;
      }
    }
  } catch (logError) {
    logger.error("Error creating LLM call log entry", {
      error: logError instanceof Error ? logError.message : "Unknown",
    });
  }

  try {
    const client = getBedrockClient();

    let userPrompt = prompt;
    if (assignmentContext) {
      if (assignmentContext.name) {
        userPrompt = `Assignment: ${assignmentContext.name}\n\n${userPrompt}`;
      }
      if (assignmentContext.courseName) {
        userPrompt = `Course: ${assignmentContext.courseName}\n\n${userPrompt}`;
      }
    }

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    logger.info("Invoking Bedrock model", {
      modelId: CLAUDE_MODEL_ID,
      promptLength: prompt.length,
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.content && responseBody.content[0]?.text) {
      let generatedText = responseBody.content[0].text.trim();
      
      // Remove markdown code blocks if present
      const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        generatedText = jsonMatch[1];
      }

      const parsedContent = JSON.parse(generatedText);

      logger.info("Successfully generated content", {
        contentType: parsedContent.type,
        blockCount: parsedContent.content?.length || 0,
      });

      // Update LLM call log with success
      if (llmCallId) {
        try {
          const responseText = generatedText.length > 100000 
            ? generatedText.substring(0, 100000) + "... [truncated]"
            : generatedText;
          
          await supabase
            .from("llm_calls")
            .update({
              success: true,
              llm_response: responseText,
            })
            .eq("id", llmCallId);
        } catch (updateError) {
          logger.error("Failed to update LLM call log with success", {
            error: updateError instanceof Error ? updateError.message : "Unknown",
            llmCallId,
          });
        }
      }

      return parsedContent;
    }

    throw new Error("Unexpected response format from AI model");
  } catch (error: any) {
    logger.error("Failed to generate content", {
      error: error.message,
      stack: error.stack,
    });

    // Update LLM call log with error
    if (llmCallId) {
      try {
        await supabase
          .from("llm_calls")
          .update({
            success: false,
            error: error.message || "Unknown error",
          })
          .eq("id", llmCallId);
      } catch (updateError) {
        logger.error("Failed to update LLM call log with error", {
          error: updateError instanceof Error ? updateError.message : "Unknown",
          llmCallId,
        });
      }
    }

    throw error;
  }
};

/**
 * Generate content with streaming support via WebSocket
 * 
 * Emits:
 * - block-start: { blockIndex, blockType } - When a new block is detected
 * - block-complete: { blockIndex, block } - When a block is fully parsed
 * - generation-complete: { success: true } - When generation is done
 * - stream-error: { message, code } - On error
 */
export const generateContentStream = async (
  options: GenerateContentOptions & {
    socket: AuthenticatedSocket;
    requestId: string;
    assignmentId: string;
  }
): Promise<void> => {
  const {
    prompt,
    assignmentContext,
    taggedAssignments,
    images,
    socket,
    requestId,
    assignmentId,
    userId,
    userEmail,
    courseId
  } = options;

  // Create LLM call log entry
  let llmCallId: string | null = null;
  try {
    if (userId && assignmentId && courseId) {
      const { data: llmCall, error: insertError } = await supabase
        .from("llm_calls")
        .insert({
          assignment_id: assignmentId,
          user_id: userId,
          course_id: courseId,
          prompt: prompt,
          success: false, // Will update later
          request_id: requestId,
        })
        .select("id")
        .single();

      if (!insertError && llmCall) {
        llmCallId = llmCall.id;
        
        // Send Discord notification for new query
        if (assignmentContext && llmCallId) {
          await notifyAssignmentQuery({
            userId,
            userEmail,
            assignmentId,
            assignmentName: assignmentContext.name || assignmentId,
            courseId,
            courseName: assignmentContext.courseName,
            prompt,
            llmCallId,
          });
        }
      } else {
        logger.error("Failed to create LLM call log entry", {
          error: insertError?.message,
          requestId,
        });
      }
    }
  } catch (logError) {
    logger.error("Error creating LLM call log entry", {
      error: logError instanceof Error ? logError.message : "Unknown",
      requestId,
    });
  }

  try {
    const client = getBedrockClient();

    let userPrompt = prompt;
    if (assignmentContext) {
      if (assignmentContext.name) {
        userPrompt = `Assignment: ${assignmentContext.name}\n\n${userPrompt}`;
      }
      if (assignmentContext.courseName) {
        userPrompt = `Course: ${assignmentContext.courseName}\n\n${userPrompt}`;
      }
    }

    // Add tagged assignment context
    if (taggedAssignments && taggedAssignments.length > 0) {
      // Estimate tokens for system prompt and base user prompt
      const systemPromptTokens = estimateTokens(SYSTEM_PROMPT);
      const basePromptTokens = estimateTokens(userPrompt);
      let availableTokens = MAX_CONTEXT_WINDOW - systemPromptTokens - basePromptTokens - 1000; // Reserve 1000 for response
      
      // Add tagged assignments, truncating if needed
      const contextParts: string[] = [];
      let totalContextTokens = 0;
      
      for (const taggedAssignment of taggedAssignments) {
        const assignmentText = `\n\n--- Assignment: ${taggedAssignment.name} ---\n${taggedAssignment.content}\n--- End of Assignment: ${taggedAssignment.name} ---`;
        const assignmentTokens = estimateTokens(assignmentText);
        
        if (totalContextTokens + assignmentTokens <= availableTokens) {
          contextParts.push(assignmentText);
          totalContextTokens += assignmentTokens;
        } else {
          // Truncate this assignment to fit
          const remainingTokens = availableTokens - totalContextTokens;
          if (remainingTokens > 100) { // Only add if we have meaningful space
            const truncatedContent = truncateToTokens(
              taggedAssignment.content,
              remainingTokens - estimateTokens(`\n\n--- Assignment: ${taggedAssignment.name} ---\n\n--- End of Assignment: ${taggedAssignment.name} ---`)
            );
            contextParts.push(`\n\n--- Assignment: ${taggedAssignment.name} ---\n${truncatedContent}\n--- End of Assignment: ${taggedAssignment.name} ---`);
          }
          break; // Stop adding more assignments
        }
      }
      
      if (contextParts.length > 0) {
        userPrompt = `Context from other assignments:\n${contextParts.join("")}\n\n${userPrompt}`;
      }
    }

    // Build message content - use multimodal format if images are provided
    let messageContent: any;
    if (images && images.length > 0) {
      // Multimodal format with images and text
      messageContent = [
        // Add images first
        ...images.map(img => ({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: img.base64,
          },
        })),
        // Then add the text prompt
        {
          type: "text",
          text: userPrompt,
        },
      ];
    } else {
      // Simple text-only format
      messageContent = userPrompt;
    }

    // Check if Tavily API key is available and if this prompt actually needs web search
    const hasSearchCapability = !!process.env.TAVILY_API_KEY;
    let useWebSearch = false;

    if (hasSearchCapability) {
      // Use Haiku to determine if web search is actually needed
      useWebSearch = await shouldUseWebSearch(prompt);
      logger.info("Web search decision", {
        requestId,
        useWebSearch,
        promptPreview: prompt.substring(0, 100),
      });

      if (useWebSearch) {
        socket.emit("search-status", { requestId, assignmentId, status: "Web search enabled for this request" });
      }
    }

    const requestBody: any = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: messageContent,
        },
      ],
    };

    // Only add tools if web search is actually needed for this prompt
    if (useWebSearch) {
      requestBody.tools = TOOLS;
    }

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    logger.info("Invoking Bedrock model with streaming", {
      modelId: CLAUDE_MODEL_ID,
      promptLength: prompt.length,
      requestId,
      socketId: socket.id,
      useWebSearch,
      hasImages: !!(images && images.length > 0),
    });

    const response = await client.send(command);
    const stream = response.body;

    if (!stream) {
      throw new Error("No stream in Bedrock response");
    }

    // Accumulate the full response
    let fullText = "";

    // Track which blocks we've started/completed
    let blockIndex = 0;
    const startedBlocks = new Set<number>();
    const completedBlocks = new Set<number>();

    // Track pending IDE block processing promises - we need to wait for these before completing
    const pendingIdeBlockPromises: Promise<void>[] = [];

    // Track tool use for multi-turn conversation
    let pendingToolUse: { id: string; name: string; input: any } | null = null;
    let currentToolUseId = "";
    let currentToolUseName = "";
    let toolInputJson = "";
    let isCollectingToolInput = false;

    // Don't parse blocks during pre-tool phase - only parse after tool execution or if no tool is used
    let isPreToolPhase = true;
    let toolUseDetected = false;
    let messageStopReason: string | null = null;

    for await (const chunk of stream) {
      if (socket.disconnected) {
        logger.info("Client disconnected, stopping stream", { requestId });
        break;
      }

      if (chunk.chunk?.bytes) {
        const chunkData = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));

        // Handle content block start (for tool use detection)
        if (chunkData.type === "content_block_start") {
          if (chunkData.content_block?.type === "tool_use") {
            currentToolUseId = chunkData.content_block.id || "";
            currentToolUseName = chunkData.content_block.name || "";
            toolInputJson = "";
            isCollectingToolInput = true;

            logger.info("Tool use detected", {
              requestId,
              toolName: currentToolUseName,
              toolId: currentToolUseId,
            });

            // Mark that tool use was detected - don't parse pre-tool text
            toolUseDetected = true;

            // Emit search-started event if it's a web search
            if (currentToolUseName === "web_search") {
              socket.emit("search-started", { requestId, assignmentId });
            }
          }
        }

        if (chunkData.type === "content_block_delta") {
          // Handle tool input JSON delta
          if (chunkData.delta?.type === "input_json_delta" && isCollectingToolInput) {
            toolInputJson += chunkData.delta.partial_json || "";
          }
          // Handle regular text delta
          else {
            const text = chunkData.delta?.text || "";
            if (text) {
              fullText += text;

              // Only parse blocks if we're not in pre-tool phase
              // (i.e., either no tool use, or we're in the post-tool response)
              if (!isPreToolPhase) {
                parseAndEmitBlocks(
                  fullText,
                  socket,
                  requestId,
                  assignmentId,
                  startedBlocks,
                  completedBlocks,
                  pendingIdeBlockPromises,
                  llmCallId || undefined,
                  userId,
                  userEmail,
                  assignmentContext,
                  courseId
                );
              }
            }
          }
        }

        // Handle content block stop (finalize tool use)
        if (chunkData.type === "content_block_stop" && isCollectingToolInput) {
          try {
            const toolInput = JSON.parse(toolInputJson);
            pendingToolUse = {
              id: currentToolUseId,
              name: currentToolUseName,
              input: toolInput,
            };
          } catch (e) {
            logger.error("Failed to parse tool input", {
              requestId,
              toolName: currentToolUseName,
              error: e instanceof Error ? e.message : "Unknown",
            });
          }
          isCollectingToolInput = false;
        }

        // Handle message_delta to capture stop_reason
        if (chunkData.type === "message_delta" && chunkData.delta?.stop_reason) {
          messageStopReason = chunkData.delta.stop_reason;
          logger.info("Message delta stop reason received", {
            requestId,
            stopReason: messageStopReason,
          });
        }

        if (chunkData.type === "message_stop") {
          // Check if we need to execute a tool and continue
          if (pendingToolUse && messageStopReason === "tool_use") {
            logger.info("Executing pending tool", {
              requestId,
              toolName: pendingToolUse.name,
              toolId: pendingToolUse.id,
            });

            // Store pre-tool text for the follow-up message but don't parse it
            const preToolText = fullText;
            fullText = "";

            // Execute the tool
            let toolResult = "";
            try {
              if (pendingToolUse.name === "web_search") {
                const searchQuery = pendingToolUse.input.query as string;
                const searchResults = await webSearch(searchQuery, 5);
                toolResult = formatSearchResultsForPrompt(searchResults);

                // Emit search-complete event with details
                socket.emit("search-complete", {
                  requestId,
                  assignmentId,
                  query: searchQuery,
                  resultsCount: searchResults.length,
                  resultTitles: searchResults.slice(0, 3).map(r => r.title),
                });

                logger.info("Web search completed", {
                  requestId,
                  query: searchQuery,
                  resultsCount: searchResults.length,
                  resultTitles: searchResults.map(r => r.title),
                });
              } else {
                toolResult = "Tool not implemented";
              }
            } catch (toolError) {
              logger.error("Tool execution failed", {
                requestId,
                toolName: pendingToolUse.name,
                error: toolError instanceof Error ? toolError.message : "Unknown",
              });
              toolResult = "Search failed. Please continue without search results.";
            }

            // Make follow-up request with tool result
            // Instead of using tool_result format (which requires tools definition and tool_choice),
            // convert the search results into a regular user message that Claude can understand
            const followUpMessages = [
              {
                role: "user",
                content: messageContent,
              },
              {
                role: "assistant",
                content: `I'll search for information to help create this content.`,
              },
              {
                role: "user",
                content: `Here are the search results for "${pendingToolUse.input.query}":\n\n${toolResult}\n\nNow please generate the educational content in TipTap JSON format based on the user's original request and these search results. Remember: your response must be ONLY valid JSON starting with { and ending with }. Do not include any conversational text.`,
              },
            ];

            // Reset for next streaming round
            fullText = "";
            pendingToolUse = null;
            messageStopReason = null;

            // Make follow-up streaming request without tools
            // This ensures Claude generates text content instead of trying to use more tools
            const followUpBody: any = {
              anthropic_version: "bedrock-2023-05-31",
              max_tokens: 8192,
              system: SYSTEM_PROMPT,
              messages: followUpMessages,
              // No tools - Claude should just generate content now
            };

            const followUpCommand = new InvokeModelWithResponseStreamCommand({
              modelId: CLAUDE_MODEL_ID,
              contentType: "application/json",
              accept: "application/json",
              body: JSON.stringify(followUpBody),
            });

            logger.info("Making follow-up request after web search", {
              requestId,
              searchResultsLength: toolResult.length,
            });

            let followUpResponse;
            try {
              followUpResponse = await client.send(followUpCommand);
            } catch (followUpError) {
              logger.error("Follow-up request failed", {
                requestId,
                error: followUpError instanceof Error ? followUpError.message : "Unknown",
                stack: followUpError instanceof Error ? followUpError.stack : undefined,
              });
              throw followUpError;
            }
            const followUpStream = followUpResponse.body;

            if (followUpStream) {
              let followUpChunkCount = 0;
              for await (const followUpChunk of followUpStream) {
                if (socket.disconnected) {
                  logger.info("Client disconnected during follow-up, stopping stream", { requestId });
                  break;
                }

                if (followUpChunk.chunk?.bytes) {
                  const followUpData = JSON.parse(new TextDecoder().decode(followUpChunk.chunk.bytes));
                  followUpChunkCount++;

                  // Handle errors
                  if (followUpData.type === "error" || followUpData.error) {
                    logger.error("Follow-up response error", {
                      requestId,
                      error: followUpData.error || followUpData,
                    });
                  }

                  if (followUpData.type === "content_block_delta") {
                    // Only process text deltas
                    if (followUpData.delta?.type === "text_delta" || followUpData.delta?.text) {
                      const text = followUpData.delta?.text || "";
                      if (text) {
                        fullText += text;
                        parseAndEmitBlocks(
                          fullText,
                          socket,
                          requestId,
                          assignmentId,
                          startedBlocks,
                          completedBlocks,
                          pendingIdeBlockPromises,
                          llmCallId || undefined,
                          userId,
                          userEmail,
                          assignmentContext,
                          courseId
                        );
                      }
                    }
                  }
                }
              }
              logger.info("Follow-up stream complete (after web search)", {
                requestId,
                totalChunks: followUpChunkCount,
                fullTextLength: fullText.length,
              });
            } else {
              logger.warn("No follow-up stream received", { requestId });
            }
          } else {
            // No tool use - parse the accumulated text now
            if (fullText.trim()) {
              parseAndEmitBlocks(
                fullText,
                socket,
                requestId,
                assignmentId,
                startedBlocks,
                completedBlocks,
                pendingIdeBlockPromises,
                llmCallId || undefined,
                userId,
                userEmail,
                assignmentContext,
                courseId
              );
            }
          }

          // Stream complete - parse final content
          let finalJson = fullText.trim();
          
          // Remove markdown code blocks if present
          const jsonMatch = finalJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            finalJson = jsonMatch[1];
          }

          // Try to find valid JSON - might have trailing text or incomplete JSON
          let parsedContent: any = null;
          let parseError: Error | null = null;
          
          try {
            parsedContent = JSON.parse(finalJson);
          } catch (e) {
            // If direct parse fails, try to extract JSON from the text
            // Look for the first { and try to find matching }
            const firstBrace = finalJson.indexOf('{');
            if (firstBrace !== -1) {
              try {
                // Use our existing findMatchingBrace function to find the end
                const jsonEnd = findMatchingBrace(finalJson, firstBrace);
                if (jsonEnd !== -1) {
                  const jsonSubstring = finalJson.substring(firstBrace, jsonEnd + 1);
                  parsedContent = JSON.parse(jsonSubstring);
                } else {
                  // JSON might be incomplete - but we already emitted blocks during streaming
                  // So we can just continue with what we have
                  parseError = new Error("Incomplete JSON at end of stream");
                }
              } catch (e2) {
                parseError = e2 instanceof Error ? e2 : new Error(String(e2));
              }
            } else {
              parseError = e instanceof Error ? e : new Error(String(e));
            }
          }

          if (parsedContent) {
            // Get content array
            let contentArray: any[] = [];
            if (parsedContent.type === "doc" && Array.isArray(parsedContent.content)) {
              contentArray = parsedContent.content;
            } else if (Array.isArray(parsedContent)) {
              contentArray = parsedContent;
            } else {
              contentArray = [parsedContent];
            }

            // Emit any remaining blocks that weren't completed during streaming
            contentArray.forEach((block: any, index: number) => {
              if (!completedBlocks.has(index)) {
                try {
                  socket.emit("block-complete", { blockIndex: index, block, requestId, assignmentId });
                  completedBlocks.add(index);
                } catch (blockError) {
                  // Silently skip invalid blocks
                  logger.warn("Failed to emit block-complete", {
                    requestId,
                    blockIndex: index,
                    error: blockError instanceof Error ? blockError.message : "Unknown",
                  });
                }
              }
            });

            // Wait for any pending IDE block S3 processing to complete
            if (pendingIdeBlockPromises.length > 0) {
              logger.info("Waiting for pending IDE block processing", {
                requestId,
                pendingCount: pendingIdeBlockPromises.length,
              });
              await Promise.allSettled(pendingIdeBlockPromises);
              logger.info("All IDE block processing complete", { requestId });
            }

            socket.emit("generation-complete", { success: true, requestId, assignmentId });

            logger.info("Stream completed successfully", {
              requestId,
              socketId: socket.id,
              totalBlocks: contentArray.length,
            });

            // Update LLM call log with success
            if (llmCallId) {
              try {
                // Truncate response if too long (keep first 100k chars)
                const responseText = fullText.length > 100000 
                  ? fullText.substring(0, 100000) + "... [truncated]"
                  : fullText;
                
                await supabase
                  .from("llm_calls")
                  .update({
                    success: true,
                    llm_response: responseText,
                  })
                  .eq("id", llmCallId);
              } catch (updateError) {
                logger.error("Failed to update LLM call log with success", {
                  error: updateError instanceof Error ? updateError.message : "Unknown",
                  llmCallId,
                });
              }
            }
          } else {
            // If we have some completed blocks, just finish successfully
            // Don't error if we got at least some content
            if (completedBlocks.size > 0) {
              logger.info("Stream completed with parse warning (but blocks were emitted)", {
                requestId,
                socketId: socket.id,
                completedBlocks: completedBlocks.size,
                parseError: parseError?.message,
              });
              
              // Update LLM call log with success (but note the parse warning)
              if (llmCallId) {
                try {
                  const responseText = fullText.length > 100000 
                    ? fullText.substring(0, 100000) + "... [truncated]"
                    : fullText;
                  
                  await supabase
                    .from("llm_calls")
                    .update({
                      success: true,
                      llm_response: responseText,
                      error: parseError ? `Parse warning: ${parseError.message}` : null,
                    })
                    .eq("id", llmCallId);
                } catch (updateError) {
                  logger.error("Failed to update LLM call log with parse warning", {
                    error: updateError instanceof Error ? updateError.message : "Unknown",
                    llmCallId,
                  });
                }
              }

              // Wait for any pending IDE block S3 processing to complete
              if (pendingIdeBlockPromises.length > 0) {
                logger.info("Waiting for pending IDE block processing (parse warning case)", {
                  requestId,
                  pendingCount: pendingIdeBlockPromises.length,
                });
                await Promise.allSettled(pendingIdeBlockPromises);
                logger.info("All IDE block processing complete", { requestId });
              }

              socket.emit("generation-complete", { success: true, requestId, assignmentId });
            } else {
              // Only error if we got no blocks at all
              const errorMessage = parseError?.message || "Unknown parsing error";
              logger.error("Failed to parse final AI response and no blocks were generated", {
                requestId,
                error: errorMessage,
                fullTextLength: fullText.length,
                fullTextPreview: fullText.substring(0, 200),
              });
              
              // Update LLM call log with error
              if (llmCallId) {
                try {
                  await supabase
                    .from("llm_calls")
                    .update({
                      success: false,
                      error: errorMessage,
                      llm_response: fullText.length > 100000 
                        ? fullText.substring(0, 100000) + "... [truncated]"
                        : fullText,
                    })
                    .eq("id", llmCallId);
                } catch (updateError) {
                  logger.error("Failed to update LLM call log with error", {
                    error: updateError instanceof Error ? updateError.message : "Unknown",
                    llmCallId,
                  });
                }

                // Send Discord notification
                if (userId && assignmentContext) {
                  await notifyParsingError({
                    llmCallId,
                    requestId,
                    assignmentId,
                    assignmentName: assignmentContext.name,
                    userId,
                    userEmail,
                    error: errorMessage,
                  });
                }
              }
              
              socket.emit("stream-error", {
                message: "Failed to parse AI response",
                code: "PARSE_ERROR",
                requestId,
                assignmentId,
              });
            }
          }
          break;
        }
      }
    }
  } catch (error: any) {
    logger.error("Streaming error", {
      error: error.message,
      stack: error.stack,
      requestId,
      socketId: socket.id,
    });

    const errorMessage = error.name === "AccessDeniedException"
      ? "Access denied to AWS Bedrock. Please check IAM permissions."
      : error.name === "ValidationException"
      ? "Invalid request to AI service. Please try again."
      : error.name === "ThrottlingException"
      ? "AI service is currently busy. Please try again in a moment."
      : error.message || "Failed to generate content";

    const errorCode = error.name || "STREAM_ERROR";

    // Update LLM call log with error
    if (llmCallId) {
      try {
        await supabase
          .from("llm_calls")
          .update({
            success: false,
            error: errorMessage,
          })
          .eq("id", llmCallId);
      } catch (updateError) {
        logger.error("Failed to update LLM call log with error", {
          error: updateError instanceof Error ? updateError.message : "Unknown",
          llmCallId,
        });
      }

      // Send Discord notification
      if (userId && assignmentContext) {
        await notifyRequestError({
          llmCallId,
          requestId,
          assignmentId,
          assignmentName: assignmentContext.name,
          userId,
          userEmail,
          error: errorMessage,
          errorCode,
        });
      }
    }

    socket.emit("stream-error", {
      message: errorMessage,
      code: errorCode,
      requestId,
      assignmentId,
    });
  }
};

/**
 * Parse the accumulated text and emit block-start/block-complete events
 */
function parseAndEmitBlocks(
  text: string,
  socket: AuthenticatedSocket,
  requestId: string,
  assignmentId: string,
  startedBlocks: Set<number>,
  completedBlocks: Set<number>,
  pendingIdeBlockPromises: Promise<void>[],
  llmCallId?: string | null,
  userId?: string,
  userEmail?: string,
  assignmentContext?: { name?: string },
  courseId?: string
): void {
  // Remove markdown code blocks if present
  let jsonText = text.trim();
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*)/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1];
    // Remove trailing ``` if present
    jsonText = jsonText.replace(/\s*```\s*$/, "");
  }

  // Find the content array
  const contentMatch = jsonText.match(/"content"\s*:\s*\[/);
  if (!contentMatch) {
    return;
  }

  const contentStart = contentMatch.index! + contentMatch[0].length;
  
  // Parse blocks one by one
  let blockIndex = 0;
  let searchPos = contentStart;
  
  while (true) {
    // Find start of next block
    const blockStart = jsonText.indexOf("{", searchPos);
    if (blockStart === -1) break;
    
    // Try to detect block type from the beginning of the block
    const blockPreview = jsonText.substring(blockStart, Math.min(blockStart + 100, jsonText.length));
    const typeMatch = blockPreview.match(/"type"\s*:\s*"([^"]+)"/);
    
    if (typeMatch && !startedBlocks.has(blockIndex)) {
      const blockType = typeMatch[1];
      socket.emit("block-start", { blockIndex, blockType, requestId, assignmentId });
      startedBlocks.add(blockIndex);
    }
    
    // Try to find the complete block
    const blockEnd = findMatchingBrace(jsonText, blockStart);
    
    if (blockEnd !== -1) {
      // We have a complete block
      if (!completedBlocks.has(blockIndex)) {
        try {
          const blockJson = jsonText.substring(blockStart, blockEnd + 1);
          let block = JSON.parse(blockJson);

          // Process IDE blocks with files asynchronously
          if (block.type === "ideBlock" && userId &&
              (block.attrs?.ideData?.templateFiles || block.attrs?.ideData?.modelSolutionFiles)) {
            // IMPORTANT: Capture blockIndex by VALUE here, not reference!
            // The while loop will increment blockIndex, but we need the value at this moment
            const capturedBlockIndex = blockIndex;
            const capturedBlock = block; // Also capture the block reference

            // Mark as completed immediately to prevent re-processing
            completedBlocks.add(capturedBlockIndex);

            logger.info("Processing IDE block with files", {
              requestId,
              blockIndex: capturedBlockIndex,
              hasTemplateFiles: !!capturedBlock.attrs?.ideData?.templateFiles,
              hasModelSolutionFiles: !!capturedBlock.attrs?.ideData?.modelSolutionFiles,
              templateFileCount: capturedBlock.attrs?.ideData?.templateFiles?.length || 0,
              modelSolutionFileCount: capturedBlock.attrs?.ideData?.modelSolutionFiles?.length || 0,
            });

            // Process files asynchronously and emit when done
            // Capture the promise so we can wait for it before completing
            const ideBlockPromise = (async () => {
              try {
                // Check if we have S3 credentials
                const hasS3Credentials = !!(process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY);

                if (!hasS3Credentials) {
                  logger.warn("IDE block skipping S3 - no credentials configured", {
                    requestId,
                    blockIndex: capturedBlockIndex,
                  });
                  // Clean up temporary file arrays but don't create S3 buckets
                  if (capturedBlock.attrs?.ideData) {
                    delete capturedBlock.attrs.ideData.templateFiles;
                    delete capturedBlock.attrs.ideData.modelSolutionFiles;
                  }
                  socket.emit("block-complete", { blockIndex: capturedBlockIndex, block: capturedBlock, requestId, assignmentId });
                  return;
                }

                // Add timeout for S3 processing (30 seconds max)
                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => reject(new Error("IDE block S3 processing timed out after 30s")), 30000);
                });

                const processedBlock = await Promise.race([
                  processIdeBlockFiles(capturedBlock, userId, courseId, assignmentId),
                  timeoutPromise,
                ]);
                logger.info("IDE block processed successfully", {
                  requestId,
                  blockIndex: capturedBlockIndex,
                  hasTemplateBucket: !!processedBlock.attrs?.ideData?.template?.s3_bucket_id,
                  hasModelSolutionBucket: !!processedBlock.attrs?.ideData?.modelSolution?.s3_bucket_id,
                });
                socket.emit("block-complete", { blockIndex: capturedBlockIndex, block: processedBlock, requestId, assignmentId });
              } catch (processError) {
                logger.error("Failed to process IDE block files", {
                  error: processError instanceof Error ? processError.message : "Unknown",
                  stack: processError instanceof Error ? processError.stack : undefined,
                  blockIndex: capturedBlockIndex,
                  requestId,
                });
                // Clean up temporary file arrays
                if (capturedBlock.attrs?.ideData) {
                  delete capturedBlock.attrs.ideData.templateFiles;
                  delete capturedBlock.attrs.ideData.modelSolutionFiles;
                }
                // Emit the original block without S3 files
                socket.emit("block-complete", { blockIndex: capturedBlockIndex, block: capturedBlock, requestId, assignmentId });
              }
            })();

            // Track this promise so we wait for it before completing
            pendingIdeBlockPromises.push(ideBlockPromise);
          } else {
            socket.emit("block-complete", { blockIndex, block, requestId, assignmentId });
            completedBlocks.add(blockIndex);
          }
        } catch (e) {
          // Block JSON parsing failed - log error for observability
          const parseError = e instanceof Error ? e.message : String(e);
          logger.warn("Failed to parse block during streaming", {
            requestId,
            blockIndex,
            blockType: typeMatch?.[1],
            error: parseError,
            blockJsonPreview: jsonText.substring(blockStart, Math.min(blockStart + 200, blockEnd + 1)),
          });

          // Log parsing error to database and Discord
          if (llmCallId && typeMatch?.[1]) {
            (async () => {
              try {
                await notifyParsingError({
                  llmCallId,
                  requestId,
                  assignmentId,
                  assignmentName: assignmentContext?.name,
                  userId: userId || "",
                  userEmail,
                  error: `Failed to parse block ${blockIndex}: ${parseError}`,
                  blockIndex,
                  blockType: typeMatch[1],
                });
              } catch (notifyError) {
                logger.error("Failed to send parsing error notification", {
                  error: notifyError instanceof Error ? notifyError.message : "Unknown",
                });
              }
            })();
          }
        }
      }
      blockIndex++;
      searchPos = blockEnd + 1;
    } else {
      // Block not complete yet
      break;
    }
  }
}

/**
 * Truncate text to fit within a token budget
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) {
    return text;
  }
  
  // Truncate from the end
  return text.substring(0, maxChars) + "... [truncated]";
}

/**
 * Find the matching closing brace for a JSON object
 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  
  return -1; // Not found
}

export default {
  generateContent,
  generateContentStream,
};
