import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
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
      "question": "<p>Which topic should we cover next?</p>",
      "options": [
        { "id": "uuid", "text": "<p>Data Structures</p>" },
        { "id": "uuid", "text": "<p>Algorithms</p>" },
        { "id": "uuid", "text": "<p>Web Development</p>" }
      ],
      "selectionType": "single",
      "showResults": "after-voting",
      "allowAnswerChange": false
    }
  }
}
selectionType: "single" or "multiple"
showResults: "never", "after-voting", "after-close", "immediately"
NOTE: Both question and option text support HTML formatting (bold, italic, code, lists, etc.) - wrap in <p> tags at minimum

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
 * Read all files from an S3 bucket and return their contents
 */
async function readBucketFiles(bucketName: string): Promise<IdeBlockFile[]> {
  const listCommand = new ListObjectsV2Command({ Bucket: bucketName });
  const listResponse = await s3Client.send(listCommand);

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    return [];
  }

  const files: IdeBlockFile[] = [];
  for (const object of listResponse.Contents) {
    if (!object.Key) continue;
    // Skip directories and hidden files
    if (object.Key.endsWith("/") || object.Key.startsWith(".")) continue;

    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: object.Key,
    });
    const response = await s3Client.send(getCommand);

    if (response.Body) {
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      const content = Buffer.concat(chunks).toString("utf-8");
      files.push({ path: object.Key, content });
    }
  }

  return files;
}

/**
 * Generate a model solution for an IDE block using AI
 */
export const generateModelSolution = async (options: {
  assignmentId: string;
  ideBlockId: string;
  userId: string;
  userEmail?: string;
  courseId: string;
}): Promise<{ modelSolutionBucketId: string }> => {
  const { assignmentId, ideBlockId, userId, userEmail, courseId } = options;

  // Fetch assignment content
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("name, content")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found");
  }

  // Find the IDE block in the assignment content
  // content column is text, not jsonb - parse it
  const content = typeof assignment.content === "string"
    ? JSON.parse(assignment.content)
    : assignment.content;
  let ideBlock: any = null;

  const findIdeBlock = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "ideBlock" && node.attrs?.ideData?.id === ideBlockId) {
        ideBlock = node;
        return;
      }
      if (node.content) {
        findIdeBlock(node.content);
        if (ideBlock) return;
      }
    }
  };

  if (content?.content) {
    findIdeBlock(content.content);
  }

  if (!ideBlock) {
    throw new Error("IDE block not found in assignment");
  }

  const ideData = ideBlock.attrs.ideData;

  // Get template files from S3 if they exist
  let templateFiles: IdeBlockFile[] = [];
  if (ideData.template?.s3_bucket_id) {
    const { data: templateBucket } = await supabase
      .from("s3_buckets")
      .select("bucket_name")
      .eq("id", ideData.template.s3_bucket_id)
      .single();

    if (templateBucket) {
      try {
        templateFiles = await readBucketFiles(templateBucket.bucket_name);
      } catch (err) {
        logger.warn("Failed to read template files from S3", {
          bucketId: ideData.template.s3_bucket_id,
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }
  }

  // Get autograder tests
  const tests = ideData.autograder?.tests || [];
  const language = ideData.settings?.language || "python";

  // Extract assignment instructions (text content from the TipTap document)
  let instructions = "";
  const extractText = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "text" && node.text) {
        instructions += node.text;
      } else if (node.type === "paragraph" || node.type === "heading") {
        if (node.content) extractText(node.content);
        instructions += "\n";
      } else if (node.content) {
        extractText(node.content);
      }
    }
  };
  if (content?.content) {
    extractText(content.content);
  }
  instructions = instructions.trim();

  // Format template files for the prompt
  let templateContext = "No template files provided.";
  if (templateFiles.length > 0) {
    templateContext = templateFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
  }

  // Format autograder tests for the prompt
  let testsContext = "No autograder tests configured.";
  if (tests.length > 0) {
    testsContext = tests
      .map((t: any) => {
        if (t.type === "inputOutput") {
          return `### ${t.name} (${t.points} pts)\nInput:\n${t.input}\nExpected Output:\n${t.expectedOutput}`;
        } else if (t.type === "unitTest") {
          return `### ${t.name} (${t.points} pts)\n\`\`\`\n${t.code}\n\`\`\``;
        } else {
          return `### ${t.name} (${t.points} pts) - Manual grading`;
        }
      })
      .join("\n\n");
  }

  // Build the focused prompt
  const prompt = `You are a coding assistant. Generate a model solution for this programming exercise.

## Assignment: ${assignment.name}

## Instructions
${instructions || "No specific instructions provided."}

## Template Code (student starting point)
${templateContext}

## Autograder Tests
${testsContext}

## Requirements
- Language: ${language}
- Your solution must pass all the autograder tests
- Match the file structure of the template
- Only output the solution code, no explanations

## Output Format
Return a JSON object with a files array. Your ENTIRE response must be valid JSON starting with { and ending with }.
{
  "files": [
    {"path": "filename.ext", "content": "file content here"}
  ]
}`;

  // Create LLM call log entry
  let llmCallId: string | null = null;
  try {
    const { data: llmCall } = await supabase
      .from("llm_calls")
      .insert({
        assignment_id: assignmentId,
        user_id: userId,
        course_id: courseId,
        prompt: prompt.substring(0, 10000),
        success: false,
      })
      .select("id")
      .single();

    if (llmCall) llmCallId = llmCall.id;
  } catch (logError) {
    logger.error("Error creating LLM call log entry", {
      error: logError instanceof Error ? logError.message : "Unknown",
    });
  }

  try {
    const client = getBedrockClient();

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8192,
      system: "You are a coding assistant that generates model solutions for programming exercises. Your response must be ONLY valid JSON. Do NOT include any conversational text, markdown formatting, or code blocks. Your ENTIRE response must start with { and end with }.",
      messages: [{ role: "user", content: prompt }],
    };

    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    logger.info("Generating model solution", {
      assignmentId,
      ideBlockId,
      language,
      templateFileCount: templateFiles.length,
      testCount: tests.length,
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.content?.[0]?.text) {
      throw new Error("Unexpected response format from AI model");
    }

    let generatedText = responseBody.content[0].text.trim();

    // Remove markdown code blocks if present
    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      generatedText = jsonMatch[1];
    }

    const parsed = JSON.parse(generatedText);

    if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new Error("AI did not return valid solution files");
    }

    // Create S3 bucket with the solution files
    const modelSolutionBucketId = await createBucketWithFiles(
      parsed.files,
      userId,
      courseId,
      assignmentId,
      false
    );

    // Update LLM call log with success
    if (llmCallId) {
      try {
        await supabase
          .from("llm_calls")
          .update({
            success: true,
            llm_response: generatedText.substring(0, 100000),
          })
          .eq("id", llmCallId);
      } catch (updateError) {
        logger.error("Failed to update LLM call log", {
          error: updateError instanceof Error ? updateError.message : "Unknown",
        });
      }
    }

    logger.info("Model solution generated successfully", {
      assignmentId,
      ideBlockId,
      bucketId: modelSolutionBucketId,
      fileCount: parsed.files.length,
    });

    return { modelSolutionBucketId };
  } catch (error: any) {
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
        });
      }
    }

    throw error;
  }
};

/**
 * Generate unit tests for an IDE block using AI
 */
export const generateUnitTests = async (options: {
  assignmentId: string;
  ideBlockId: string;
  userId: string;
  userEmail?: string;
  courseId: string;
}): Promise<{ tests: any[] }> => {
  const { assignmentId, ideBlockId, userId, userEmail, courseId } = options;

  // Fetch assignment content
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("name, content")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found");
  }

  // Find the IDE block in the assignment content
  const content = typeof assignment.content === "string"
    ? JSON.parse(assignment.content)
    : assignment.content;
  let ideBlock: any = null;

  const findIdeBlock = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "ideBlock" && node.attrs?.ideData?.id === ideBlockId) {
        ideBlock = node;
        return;
      }
      if (node.content) {
        findIdeBlock(node.content);
        if (ideBlock) return;
      }
    }
  };

  if (content?.content) {
    findIdeBlock(content.content);
  }

  if (!ideBlock) {
    throw new Error("IDE block not found in assignment");
  }

  const ideData = ideBlock.attrs.ideData;

  // Get template files from S3 if they exist
  let templateFiles: IdeBlockFile[] = [];
  if (ideData.template?.s3_bucket_id) {
    const { data: templateBucket } = await supabase
      .from("s3_buckets")
      .select("bucket_name")
      .eq("id", ideData.template.s3_bucket_id)
      .single();

    if (templateBucket) {
      try {
        templateFiles = await readBucketFiles(templateBucket.bucket_name);
      } catch (err) {
        logger.warn("Failed to read template files from S3", {
          bucketId: ideData.template.s3_bucket_id,
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }
  }

  // Get model solution files from S3 if they exist
  let modelSolutionFiles: IdeBlockFile[] = [];
  if (ideData.modelSolution?.s3_bucket_id) {
    const { data: modelSolutionBucket } = await supabase
      .from("s3_buckets")
      .select("bucket_name")
      .eq("id", ideData.modelSolution.s3_bucket_id)
      .single();

    if (modelSolutionBucket) {
      try {
        modelSolutionFiles = await readBucketFiles(modelSolutionBucket.bucket_name);
      } catch (err) {
        logger.warn("Failed to read model solution files from S3", {
          bucketId: ideData.modelSolution.s3_bucket_id,
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }
  }

  // Get existing tests and language
  const existingTests = ideData.autograder?.tests || [];
  const language = ideData.settings?.language || "python";

  // Extract assignment instructions
  let instructions = "";
  const extractText = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "text" && node.text) {
        instructions += node.text;
      } else if (node.type === "paragraph" || node.type === "heading") {
        if (node.content) extractText(node.content);
        instructions += "\n";
      } else if (node.content) {
        extractText(node.content);
      }
    }
  };
  if (content?.content) {
    extractText(content.content);
  }
  instructions = instructions.trim();

  // Format template files for the prompt
  let templateContext = "No template files provided.";
  if (templateFiles.length > 0) {
    templateContext = templateFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
  }

  // Format model solution files for the prompt
  let modelSolutionContext = "No model solution available.";
  if (modelSolutionFiles.length > 0) {
    modelSolutionContext = modelSolutionFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
  }

  // Format existing tests for the prompt
  let existingTestsContext = "No existing tests.";
  if (existingTests.length > 0) {
    existingTestsContext = existingTests
      .map((t: any) => {
        if (t.type === "inputOutput") {
          return `### ${t.name} (${t.points} pts, inputOutput)\nInput: ${t.input}\nExpected Output: ${t.expectedOutput}`;
        } else if (t.type === "unitTest") {
          return `### ${t.name} (${t.points} pts, unitTest)\n\`\`\`\n${t.code}\n\`\`\``;
        } else {
          return `### ${t.name} (${t.points} pts, manualGrading)`;
        }
      })
      .join("\n\n");
  }

  // Determine framework
  const framework = language === "java" ? "junit" : "unittest";

  // Build the prompt
  const prompt = `You are a coding assistant. Generate unit tests for this programming exercise.

## Assignment: ${assignment.name}

## Instructions
${instructions || "No specific instructions provided."}

## Template Code (student starting point)
${templateContext}

## Model Solution
${modelSolutionContext}

## Existing Tests (DO NOT duplicate these)
${existingTestsContext}

## Requirements
- Language: ${language}
- Framework: ${framework}
- Generate 3-5 meaningful unit tests with descriptive names
- Each test should test a different aspect of the solution
- Tests should be appropriate for the template code structure
- ${language === "python" ? "Each test must be a COMPLETE unittest file with imports, a TestCase class, and test methods. Import from the main module file (e.g., 'from main import function_name'). Include 'if __name__ == \"__main__\": unittest.main()' at the end." : "Each test must be a COMPLETE JUnit test file with imports and a test class."}
- Do NOT duplicate any existing tests
- Assign reasonable point values (2-5 points each)

## Output Format
Return a JSON object. Your ENTIRE response must be valid JSON starting with { and ending with }.
{
  "tests": [
    {
      "name": "Descriptive test name",
      "code": "complete test file code as a string",
      "points": 3,
      "framework": "${framework}"
    }
  ]
}`;

  // Create LLM call log entry
  let llmCallId: string | null = null;
  try {
    const { data: llmCall } = await supabase
      .from("llm_calls")
      .insert({
        assignment_id: assignmentId,
        user_id: userId,
        course_id: courseId,
        prompt: prompt.substring(0, 10000),
        success: false,
      })
      .select("id")
      .single();

    if (llmCall) llmCallId = llmCall.id;
  } catch (logError) {
    logger.error("Error creating LLM call log entry", {
      error: logError instanceof Error ? logError.message : "Unknown",
    });
  }

  try {
    const client = getBedrockClient();

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8192,
      system: "You are a coding assistant that generates unit tests for programming exercises. Your response must be ONLY valid JSON. Do NOT include any conversational text, markdown formatting, or code blocks. Your ENTIRE response must start with { and end with }.",
      messages: [{ role: "user", content: prompt }],
    };

    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    logger.info("Generating unit tests", {
      assignmentId,
      ideBlockId,
      language,
      templateFileCount: templateFiles.length,
      modelSolutionFileCount: modelSolutionFiles.length,
      existingTestCount: existingTests.length,
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.content?.[0]?.text) {
      throw new Error("Unexpected response format from AI model");
    }

    let generatedText = responseBody.content[0].text.trim();

    // Remove markdown code blocks if present
    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      generatedText = jsonMatch[1];
    }

    const parsed = JSON.parse(generatedText);

    if (!parsed.tests || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
      throw new Error("AI did not return valid unit tests");
    }

    // Add id and type to each test server-side
    const tests = parsed.tests.map((test: any) => ({
      id: uuidv4(),
      type: "unitTest" as const,
      name: test.name,
      code: test.code,
      points: test.points || 3,
      framework: test.framework || framework,
    }));

    // Update LLM call log with success
    if (llmCallId) {
      try {
        await supabase
          .from("llm_calls")
          .update({
            success: true,
            llm_response: generatedText.substring(0, 100000),
          })
          .eq("id", llmCallId);
      } catch (updateError) {
        logger.error("Failed to update LLM call log", {
          error: updateError instanceof Error ? updateError.message : "Unknown",
        });
      }
    }

    logger.info("Unit tests generated successfully", {
      assignmentId,
      ideBlockId,
      testCount: tests.length,
    });

    return { tests };
  } catch (error: any) {
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
        });
      }
    }

    throw error;
  }
};

export default {
  generateContent,
  generateModelSolution,
  generateUnitTests,
};
