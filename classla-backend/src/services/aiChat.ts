import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type { Tool, MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { supabase } from "../middleware/auth";
import { AuthenticatedSocket, getIO } from "./websocket";
import { applyContainerContent } from "./otProviderService";
import { notifyAssignmentQuery } from "./discord";
import { webSearch, formatSearchResultsForPrompt } from "./search";

// S3 client for IDE bucket operations
const S3_DEFAULT_REGION = "us-east-1";
const s3Client = new S3Client({
  region: S3_DEFAULT_REGION,
  credentials:
    process.env.IDE_MANAGER_ACCESS_KEY_ID &&
    process.env.IDE_MANAGER_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
          secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
        }
      : undefined,
});

// Bedrock client (lazy initialized)
let bedrockClient: AnthropicBedrock | null = null;

function getBedrockClient(): AnthropicBedrock {
  if (!bedrockClient) {
    bedrockClient = new AnthropicBedrock({
      awsAccessKey:
        process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey:
        process.env.BEDROCK_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion: process.env.AWS_REGION || "us-east-1",
    });
  }
  return bedrockClient;
}

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 15;

// Tool definitions for Claude
const TOOLS: Tool[] = [
  {
    name: "get_assignment_state",
    description:
      "Read the current assignment block structure. Returns a summary of all blocks with their types, indices, and content summaries. Call this first when the user asks about or wants to modify existing content.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "create_block",
    description:
      "Insert a new block into the assignment at a specific position. The block will appear at the given index, pushing existing blocks down.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description:
            "The type of block to create. One of: paragraph, heading, bulletList, orderedList, codeBlock, blockquote, horizontalRule, mcqBlock, fillInTheBlankBlock, shortAnswerBlock, ideBlock, parsonsProblemBlock, dragDropMatchingBlock, clickableAreaBlock, pollBlock, tabbedContentBlock, revealContentBlock, embedBlock",
        },
        position: {
          type: "number",
          description:
            "The 0-based index where the block should be inserted. Use -1 to append at the end.",
        },
        content: {
          type: "object",
          description:
            "The full TipTap JSON node for the block (including type and attrs).",
        },
      },
      required: ["block_type", "position", "content"],
    },
  },
  {
    name: "edit_block",
    description:
      "Modify an existing block's content. Replaces the block at the given index with the updated content.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the block to edit.",
        },
        updated_content: {
          type: "object",
          description:
            "The full updated TipTap JSON node for the block (including type and attrs).",
        },
      },
      required: ["block_index", "updated_content"],
    },
  },
  {
    name: "delete_block",
    description: "Remove a block from the assignment at the given index.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the block to delete.",
        },
      },
      required: ["block_index"],
    },
  },
  {
    name: "reorder_blocks",
    description: "Move a block from one position to another.",
    input_schema: {
      type: "object" as const,
      properties: {
        from_index: {
          type: "number",
          description: "The current 0-based index of the block to move.",
        },
        to_index: {
          type: "number",
          description: "The target 0-based index to move the block to.",
        },
      },
      required: ["from_index", "to_index"],
    },
  },
  {
    name: "read_ide_files",
    description:
      'List or read files from an IDE block\'s S3 bucket. Use bucket_type "template" for starter code or "modelSolution" for solution code. Omit file_path to list all files, or provide it to read a specific file.',
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the IDE block.",
        },
        bucket_type: {
          type: "string",
          enum: ["template", "modelSolution"],
          description:
            'Which bucket to read from: "template" for starter code or "modelSolution" for solution code.',
        },
        file_path: {
          type: "string",
          description:
            "Optional file path to read. If omitted, returns a list of all files in the bucket.",
        },
      },
      required: ["block_index", "bucket_type"],
    },
  },
  {
    name: "write_ide_files",
    description:
      "Create or update a file in an IDE block's S3 bucket. If no bucket exists yet, one will be created automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the IDE block.",
        },
        bucket_type: {
          type: "string",
          enum: ["template", "modelSolution"],
          description:
            'Which bucket to write to: "template" for starter code or "modelSolution" for solution code.',
        },
        file_path: {
          type: "string",
          description: "The file path within the bucket (e.g., 'main.py').",
        },
        content: {
          type: "string",
          description: "The file content to write.",
        },
      },
      required: ["block_index", "bucket_type", "file_path", "content"],
    },
  },
  {
    name: "get_autograder_tests",
    description:
      "Read the autograder test configuration for an IDE block. Returns all test cases with their types, names, points, and details.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the IDE block.",
        },
      },
      required: ["block_index"],
    },
  },
  {
    name: "set_autograder_tests",
    description:
      'Set the autograder test cases for an IDE block. Replaces all existing tests. Each test must have an id (UUID), name, type ("inputOutput", "unitTest", or "manualGrading"), and points. inputOutput tests have input and expectedOutput fields. unitTest tests have a code field and optional framework field ("unittest" or "junit"). manualGrading tests only need name and points.',
    input_schema: {
      type: "object" as const,
      properties: {
        block_index: {
          type: "number",
          description: "The 0-based index of the IDE block.",
        },
        tests: {
          type: "array",
          description: "Array of test case objects.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "UUID for this test case." },
              name: { type: "string", description: "Test case display name." },
              type: {
                type: "string",
                enum: ["inputOutput", "unitTest", "manualGrading"],
                description: "The type of test case.",
              },
              points: {
                type: "number",
                description: "Points value for this test.",
              },
              input: {
                type: "string",
                description:
                  "stdin input for inputOutput tests (can be empty string).",
              },
              expectedOutput: {
                type: "string",
                description: "Expected stdout for inputOutput tests.",
              },
              code: {
                type: "string",
                description: "Test code for unitTest tests.",
              },
              framework: {
                type: "string",
                enum: ["unittest", "junit"],
                description:
                  'Test framework for unitTest tests. Defaults to "unittest".',
              },
            },
            required: ["id", "name", "type", "points"],
          },
        },
        allow_student_check: {
          type: "boolean",
          description:
            "Whether students can check their answers against the autograder. IMPORTANT: Do NOT include this parameter unless the instructor explicitly asks to change it. Omit it to preserve the current value.",
        },
      },
      required: ["block_index", "tests"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for information. Use this when the user asks about a topic you need more context on, pastes a URL and asks about it, or requests web-based content to include in the assignment.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query to look up.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5).",
        },
      },
      required: ["query"],
    },
  },
];

const SAVE_MEMORY_TOOL: Tool = {
  name: "save_memory",
  description:
    'Save important context to course memory that persists across all chat sessions in this course. You MUST call this tool whenever the instructor expresses a persistent preference, rule, or standard — look for phrases like "remember", "always", "never", "from now on", "going forward", "make sure to", "don\'t ever", "I prefer", "I want", "use X instead of Y", or any statement that implies a lasting rule or preference. Each memory should be a concise, self-contained statement (max 500 chars). When in doubt about whether to save, save it.',
  input_schema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description:
          "A concise, self-contained statement capturing the preference or rule (max 500 characters). Write it as a directive, e.g. 'Always use Python type hints' not 'The instructor said to use type hints'.",
      },
    },
    required: ["content"],
  },
};

const DEFAULT_MAX_CHARS = 5000;
const MAX_ENTRY_CHARS = 500;

// Build the system prompt
function buildSystemPrompt(
  assignmentName: string,
  courseName: string,
  memories?: string[]
): string {
  return `You are Classla AI, an assistant helping instructors build educational assignments. You can create, edit, delete, and reorder assignment blocks, and read/write code files in IDE blocks.

CURRENT CONTEXT:
- Assignment: "${assignmentName}"
- Course: "${courseName}"

CAPABILITIES:
- Create, edit, delete, and reorder assignment blocks
- Read and write code files in IDE blocks (templates and model solutions)
- Search the web for information, references, and context
- Advise on pedagogical best practices

WORKFLOW:
- When asked about the current assignment, call get_assignment_state first
- When editing IDE code, call read_ide_files first to see current files before modifying
- Explain what you're doing conversationally
- After making changes, briefly confirm what was done
- You can reasonably generate content for all blocks to fulfill the request. 

BLOCK TYPES:
You can create any of these block types using the create_block tool. Provide the full TipTap JSON node as the "content" parameter.

## Standard TipTap Nodes
- paragraph: { "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }
- heading: { "type": "heading", "attrs": { "level": 1-6 }, "content": [{ "type": "text", "text": "..." }] }
- bulletList: { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", ... }] }] }
- orderedList: { "type": "orderedList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", ... }] }] }
- codeBlock: { "type": "codeBlock", "attrs": { "language": "python" }, "content": [{ "type": "text", "text": "code here" }] }
- blockquote: { "type": "blockquote", "content": [{ "type": "paragraph", ... }] }
- horizontalRule: { "type": "horizontalRule" }

## Interactive/Graded Block Types

### MCQ Block (Multiple Choice Question)
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

### Fill-in-the-Blank Block
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

### Short Answer Block
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
gradingType options: "manual", "keyword", "regex"

### IDE Block (Code Editor)
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
        "tests": [],
        "allowStudentCheckAnswer": true
      }
    }
  }
}
After creating an IDE block, use write_ide_files to add template and model solution files.
language options: "python", "java"

### Parsons Problem Block
{
  "type": "parsonsProblemBlock",
  "attrs": {
    "parsonsProblemData": {
      "id": "uuid",
      "instruction": "<p>Arrange the code blocks to create a function.</p>",
      "correctSolution": "for i in range(1, 6):\\n    print(i)",
      "blocks": [
        { "id": "uuid", "code": "for i in range(1, 6):", "indentLevel": 0 },
        { "id": "uuid", "code": "print(i)", "indentLevel": 1 }
      ],
      "distractorBlocks": [],
      "enableIndentation": true,
      "indentSpaces": 4,
      "showLineNumbers": true,
      "feedbackMode": "immediate",
      "points": 5
    }
  }
}

### Drag-and-Drop Matching Block
{
  "type": "dragDropMatchingBlock",
  "attrs": {
    "dragDropMatchingData": {
      "id": "uuid",
      "instruction": "Match the items.",
      "sourceItems": [
        { "id": "item-1", "text": "Item A" }
      ],
      "targetZones": [
        { "id": "zone-1", "label": "Target 1", "correctItemIds": ["item-1"] }
      ],
      "matchType": "one-to-one",
      "randomizeItems": true,
      "points": 4,
      "partialCredit": true
    }
  }
}

### Clickable Area Block
{
  "type": "clickableAreaBlock",
  "attrs": {
    "clickableAreaData": {
      "id": "uuid",
      "instruction": "<p>Click on the line(s) that contain a bug.</p>",
      "content": "x = 10\\nif x = 10:\\n    print(x)",
      "lines": [
        { "lineNumber": 1, "content": "x = 10", "isCorrect": false, "isClickable": true },
        { "lineNumber": 2, "content": "if x = 10:", "isCorrect": true, "isClickable": true }
      ],
      "showLineNumbers": true,
      "allowMultipleAttempts": true,
      "showCorrectAfterAttempts": 3,
      "points": 2,
      "partialCredit": true
    }
  }
}

### Poll Block
{
  "type": "pollBlock",
  "attrs": {
    "pollData": {
      "id": "uuid",
      "question": "Poll question?",
      "options": [
        { "id": "uuid", "text": "Option A" }
      ],
      "selectionType": "single",
      "showResults": "after-voting",
      "allowAnswerChange": false
    }
  }
}

### Tabbed Content Block
{
  "type": "tabbedContentBlock",
  "attrs": {
    "tabbedContentData": {
      "id": "uuid",
      "tabs": [
        { "id": "uuid", "label": "Tab 1", "content": "<p>Content</p>" }
      ],
      "defaultActiveTab": null,
      "tabPosition": "top"
    }
  }
}

### Reveal Content Block
{
  "type": "revealContentBlock",
  "attrs": {
    "revealContentData": {
      "id": "uuid",
      "buttonText": "Show Hint",
      "content": "<p>Hidden content here.</p>",
      "initiallyVisible": false,
      "showHideButton": true,
      "buttonStyle": "default"
    }
  }
}

### Embed Block
{
  "type": "embedBlock",
  "attrs": {
    "embedData": {
      "id": "uuid",
      "title": "Video Title",
      "embedType": "youtube",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID",
      "startTime": "",
      "width": "responsive",
      "allowFullscreen": true
    }
  }
}

### Image Block
{
  "type": "imageBlock",
  "attrs": {
    "imageData": {
      "id": "uuid",
      "s3Key": "",
      "assignmentId": "",
      "alt": "Description of the image",
      "width": 0,
      "alignment": "center",
      "caption": "Optional caption text",
      "originalFilename": "",
      "mimeType": ""
    }
  }
}
NOTE: You CANNOT upload image files. When creating an image block, set s3Key and assignmentId to empty strings — the instructor must upload the image themselves via the editor UI. You CAN edit an existing image block to update its alt text, caption, alignment, and width. When editing, preserve the existing s3Key, assignmentId, originalFilename, and mimeType values.
alignment options: "left", "center", "right"
width: pixel width (0 = auto/natural size)

RULES:
1. Generate unique UUIDs for all id fields (format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
2. Questions/prompts should be HTML strings wrapped in <p> tags
3. For graded blocks, set appropriate points values
4. For IDE blocks, always use write_ide_files after creating to add template/solution files
5. For IDE blocks, s3_bucket_id and last_container_id should always be null in the block JSON — use write_ide_files to manage files
6. For IDE autograder tests, use get_autograder_tests to read current tests and set_autograder_tests to update them — do NOT try to edit autograder tests via edit_block
6b. When calling set_autograder_tests, do NOT change the allow_student_check setting unless the instructor explicitly asks you to enable or disable it. Omit the parameter to preserve its current value.
6c. When editing MCQ blocks, do NOT change the allowCheckAnswer setting unless the instructor explicitly asks you to enable or disable it. Preserve its current value.
7. Be conversational — explain what you're doing and ask clarifying questions when needed
8. MEMORY: When the instructor says anything that implies a lasting preference or rule (e.g. "remember...", "always...", "never...", "from now on...", "I prefer...", "make sure to...", "don't ever..."), you MUST call save_memory to persist it. When in doubt, save it.${
    memories && memories.length > 0
      ? `

COURSE MEMORIES (persisted context from previous sessions):
${memories.map((m) => `- ${m}`).join("\n")}

These memories apply to ALL assignments in this course. Follow them unless the instructor explicitly overrides one. You can save new memories with the save_memory tool.`
      : ""
  }`;
}

// Get a summary of a block for the get_assignment_state tool
function summarizeBlock(block: any, index: number): string {
  const type = block.type || "unknown";
  let summary = `[${index}] ${type}`;

  switch (type) {
    case "paragraph":
    case "heading": {
      const text = extractText(block);
      summary += `: "${text.substring(0, 80)}${text.length > 80 ? "..." : ""}"`;
      if (type === "heading" && block.attrs?.level) {
        summary += ` (h${block.attrs.level})`;
      }
      break;
    }
    case "mcqBlock":
      summary += `: "${stripHtml(block.attrs?.mcqData?.question || "").substring(0, 60)}" (${block.attrs?.mcqData?.options?.length || 0} options, ${block.attrs?.mcqData?.points || 0} pts)`;
      break;
    case "fillInTheBlankBlock":
      summary += `: "${stripHtml(block.attrs?.fillInTheBlankData?.question || "").substring(0, 60)}" (${block.attrs?.fillInTheBlankData?.blanks?.length || 0} blanks)`;
      break;
    case "shortAnswerBlock":
      summary += `: "${stripHtml(block.attrs?.shortAnswerData?.prompt || "").substring(0, 60)}" (${block.attrs?.shortAnswerData?.points || 0} pts)`;
      break;
    case "ideBlock": {
      const ideData = block.attrs?.ideData;
      const lang = ideData?.settings?.language || "unknown";
      const hasTemplate = !!ideData?.template?.s3_bucket_id;
      const hasModel = !!ideData?.modelSolution?.s3_bucket_id;
      summary += `: ${lang} (template: ${hasTemplate ? "yes" : "no"}, model solution: ${hasModel ? "yes" : "no"}, ${ideData?.points || 0} pts)`;
      break;
    }
    case "parsonsProblemBlock":
      summary += `: "${stripHtml(block.attrs?.parsonsProblemData?.instruction || "").substring(0, 60)}"`;
      break;
    case "dragDropMatchingBlock":
      summary += `: "${block.attrs?.dragDropMatchingData?.instruction?.substring(0, 60) || ""}"`;
      break;
    case "clickableAreaBlock":
      summary += `: "${stripHtml(block.attrs?.clickableAreaData?.instruction || "").substring(0, 60)}"`;
      break;
    case "pollBlock":
      summary += `: "${block.attrs?.pollData?.question?.substring(0, 60) || ""}"`;
      break;
    case "tabbedContentBlock":
      summary += `: ${block.attrs?.tabbedContentData?.tabs?.length || 0} tabs`;
      break;
    case "revealContentBlock":
      summary += `: "${block.attrs?.revealContentData?.buttonText || "Reveal"}"`;
      break;
    case "embedBlock":
      summary += `: ${block.attrs?.embedData?.embedType || "unknown"} - "${block.attrs?.embedData?.title || ""}"`;
      break;
    case "imageBlock": {
      const imgData = block.attrs?.imageData;
      const hasImage = !!imgData?.s3Key;
      const alt = imgData?.alt || "";
      const caption = imgData?.caption || "";
      summary += `: ${hasImage ? "uploaded" : "empty"}, align: ${imgData?.alignment || "center"}${alt ? `, alt: "${alt.substring(0, 40)}"` : ""}${caption ? `, caption: "${caption.substring(0, 40)}"` : ""}`;
      break;
    }
    case "bulletList":
    case "orderedList": {
      const itemCount = block.content?.length || 0;
      summary += `: ${itemCount} items`;
      break;
    }
    case "codeBlock":
      summary += `: ${block.attrs?.language || "plain"} code`;
      break;
    case "horizontalRule":
      break;
    default:
      break;
  }

  return summary;
}

function extractText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractText).join("");
  }
  return "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

// Fetch assignment content from DB
async function getAssignmentContent(
  assignmentId: string
): Promise<{ content: any[]; rawContent: any }> {
  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("content")
    .eq("id", assignmentId)
    .single();

  if (error || !assignment) {
    throw new Error("Assignment not found");
  }

  let parsed: any;
  if (!assignment.content || assignment.content === "") {
    parsed = { type: "doc", content: [] };
  } else if (typeof assignment.content === "string") {
    parsed = JSON.parse(assignment.content);
  } else {
    parsed = assignment.content;
  }

  const content = parsed?.content || [];
  return { content, rawContent: parsed };
}

// Save assignment content back to DB
async function saveAssignmentContent(
  assignmentId: string,
  content: any[]
): Promise<void> {
  const doc = { type: "doc", content };
  const { error } = await supabase
    .from("assignments")
    .update({ content: doc, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (error) {
    throw new Error(`Failed to save assignment: ${error.message}`);
  }
}

// Create an S3 bucket for IDE files
async function createIdeBucket(
  userId: string,
  courseId: string,
  assignmentId: string,
  isTemplate: boolean
): Promise<{ bucketId: string; bucketName: string }> {
  const bucketId = uuidv4();
  const bucketName = `classla-ide-${userId.substring(0, 8)}-${Date.now()}`;

  const { error: insertError } = await supabase.from("s3_buckets").insert({
    id: bucketId,
    bucket_name: bucketName,
    region: S3_DEFAULT_REGION,
    user_id: userId,
    course_id: courseId,
    assignment_id: assignmentId,
    status: "creating",
    is_template: isTemplate,
  });

  if (insertError) {
    throw new Error(`Failed to create bucket record: ${insertError.message}`);
  }

  await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

  await supabase
    .from("s3_buckets")
    .update({ status: "active" })
    .eq("id", bucketId);

  return { bucketId, bucketName };
}

// Get bucket info for an IDE block
async function getIdeBucketInfo(
  block: any,
  bucketType: "template" | "modelSolution"
): Promise<{ bucketId: string; bucketName: string } | null> {
  const ideData = block.attrs?.ideData;
  if (!ideData) return null;

  const bucketId = ideData[bucketType]?.s3_bucket_id;
  if (!bucketId) return null;

  const { data: bucket, error } = await supabase
    .from("s3_buckets")
    .select("id, bucket_name")
    .eq("id", bucketId)
    .is("deleted_at", null)
    .single();

  if (error || !bucket) return null;
  return { bucketId: bucket.id, bucketName: bucket.bucket_name };
}

// Tool handlers
async function handleGetAssignmentState(
  assignmentId: string
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);
  if (content.length === 0) {
    return "The assignment is currently empty. No blocks have been added yet.";
  }
  const summaries = content.map((block, i) => summarizeBlock(block, i));
  return `Assignment has ${content.length} block(s):\n${summaries.join("\n")}`;
}

async function handleCreateBlock(
  assignmentId: string,
  blockType: string,
  position: number,
  blockContent: any,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  const insertIndex = position === -1 ? content.length : Math.min(position, content.length);
  content.splice(insertIndex, 0, blockContent);

  await saveAssignmentContent(assignmentId, content);

  socket.emit("block-mutation", {
    type: "create",
    blockIndex: insertIndex,
    blockType,
    assignmentId,
  });

  return `Created ${blockType} block at position ${insertIndex}. The assignment now has ${content.length} blocks.`;
}

async function handleEditBlock(
  assignmentId: string,
  blockIndex: number,
  updatedContent: any,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(
      `Block index ${blockIndex} is out of range. The assignment has ${content.length} blocks (indices 0-${content.length - 1}).`
    );
  }

  const oldType = content[blockIndex].type;
  content[blockIndex] = updatedContent;

  await saveAssignmentContent(assignmentId, content);

  socket.emit("block-mutation", {
    type: "edit",
    blockIndex,
    blockType: updatedContent.type || oldType,
    assignmentId,
  });

  return `Updated block at position ${blockIndex} (${updatedContent.type || oldType}).`;
}

async function handleDeleteBlock(
  assignmentId: string,
  blockIndex: number,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(
      `Block index ${blockIndex} is out of range. The assignment has ${content.length} blocks (indices 0-${content.length - 1}).`
    );
  }

  const removedType = content[blockIndex].type;
  content.splice(blockIndex, 1);

  await saveAssignmentContent(assignmentId, content);

  socket.emit("block-mutation", {
    type: "delete",
    blockIndex,
    blockType: removedType,
    assignmentId,
  });

  return `Deleted ${removedType} block from position ${blockIndex}. The assignment now has ${content.length} blocks.`;
}

async function handleReorderBlocks(
  assignmentId: string,
  fromIndex: number,
  toIndex: number,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (fromIndex < 0 || fromIndex >= content.length) {
    throw new Error(`From index ${fromIndex} is out of range.`);
  }
  if (toIndex < 0 || toIndex >= content.length) {
    throw new Error(`To index ${toIndex} is out of range.`);
  }

  const [block] = content.splice(fromIndex, 1);
  content.splice(toIndex, 0, block);

  await saveAssignmentContent(assignmentId, content);

  socket.emit("block-mutation", {
    type: "reorder",
    fromIndex,
    toIndex,
    assignmentId,
  });

  return `Moved block from position ${fromIndex} to position ${toIndex}.`;
}

async function handleReadIdeFiles(
  assignmentId: string,
  blockIndex: number,
  bucketType: "template" | "modelSolution",
  filePath?: string
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(`Block index ${blockIndex} is out of range.`);
  }

  const block = content[blockIndex];
  if (block.type !== "ideBlock") {
    throw new Error(
      `Block at index ${blockIndex} is a ${block.type}, not an ideBlock.`
    );
  }

  const bucketInfo = await getIdeBucketInfo(block, bucketType);
  if (!bucketInfo) {
    return `No ${bucketType} bucket exists for this IDE block yet. Use write_ide_files to create one.`;
  }

  if (!filePath) {
    // List files
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucketInfo.bucketName })
    );
    const files =
      listResponse.Contents?.filter(
        (obj) =>
          obj.Key &&
          !obj.Key.startsWith(".yjs/") &&
          !obj.Key.endsWith(".partial")
      ).map((obj) => obj.Key) || [];

    if (files.length === 0) {
      return `The ${bucketType} bucket exists but contains no files.`;
    }
    return `Files in ${bucketType} bucket:\n${files.join("\n")}`;
  }

  // Read specific file
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketInfo.bucketName,
        Key: filePath,
      })
    );

    let fileContent = "";
    if (response.Body) {
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      fileContent = Buffer.concat(chunks).toString("utf-8");
    }

    return `Content of ${filePath}:\n\`\`\`\n${fileContent}\n\`\`\``;
  } catch (err: any) {
    if (
      err.name === "NoSuchKey" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return `File "${filePath}" not found in ${bucketType} bucket.`;
    }
    throw err;
  }
}

async function handleWriteIdeFiles(
  assignmentId: string,
  userId: string,
  courseId: string,
  blockIndex: number,
  bucketType: "template" | "modelSolution",
  filePath: string,
  fileContent: string,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(`Block index ${blockIndex} is out of range.`);
  }

  const block = content[blockIndex];
  if (block.type !== "ideBlock") {
    throw new Error(
      `Block at index ${blockIndex} is a ${block.type}, not an ideBlock.`
    );
  }

  let bucketInfo = await getIdeBucketInfo(block, bucketType);

  // If no bucket exists, create one
  if (!bucketInfo) {
    const newBucket = await createIdeBucket(
      userId,
      courseId,
      assignmentId,
      true
    );
    bucketInfo = newBucket;

    // Update the block's ideData with the new bucket ID
    if (!block.attrs) block.attrs = {};
    if (!block.attrs.ideData) block.attrs.ideData = {};
    if (!block.attrs.ideData[bucketType]) {
      block.attrs.ideData[bucketType] = {
        s3_bucket_id: null,
        last_container_id: null,
      };
    }
    block.attrs.ideData[bucketType].s3_bucket_id = bucketInfo.bucketId;

    // Save the updated block with the new bucket reference
    content[blockIndex] = block;
    await saveAssignmentContent(assignmentId, content);

    socket.emit("block-mutation", {
      type: "edit",
      blockIndex,
      blockType: "ideBlock",
      assignmentId,
    });
  }

  // Write the file to S3
  const contentBuffer = Buffer.from(fileContent, "utf-8");
  const extension = filePath.split(".").pop()?.toLowerCase();
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

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketInfo.bucketName,
      Key: filePath,
      Body: contentBuffer,
      ContentType: contentType,
    })
  );

  // Sync through OT so connected editors and running containers pick up the change
  try {
    const io = getIO();
    await applyContainerContent(bucketInfo.bucketId, filePath, fileContent, io);
  } catch (otErr: any) {
    logger.warn("OT sync after AI file write failed (non-fatal)", {
      bucketId: bucketInfo.bucketId,
      filePath,
      error: otErr.message,
    });
  }

  return `Wrote file "${filePath}" to ${bucketType} bucket (${contentBuffer.length} bytes).`;
}

async function handleGetAutograderTests(
  assignmentId: string,
  blockIndex: number
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(`Block index ${blockIndex} is out of range.`);
  }

  const block = content[blockIndex];
  if (block.type !== "ideBlock") {
    throw new Error(
      `Block at index ${blockIndex} is a ${block.type}, not an ideBlock.`
    );
  }

  const autograder = block.attrs?.ideData?.autograder;
  if (!autograder || !autograder.tests || autograder.tests.length === 0) {
    return `IDE block at index ${blockIndex} has no autograder tests configured. allowStudentCheckAnswer: ${autograder?.allowStudentCheckAnswer ?? true}`;
  }

  const testSummaries = autograder.tests.map((t: any, i: number) => {
    let detail = `  [${i}] "${t.name}" (type: ${t.type}, points: ${t.points})`;
    if (t.type === "inputOutput") {
      detail += `\n      input: ${JSON.stringify(t.input || "")}`;
      detail += `\n      expectedOutput: ${JSON.stringify(t.expectedOutput || "")}`;
    } else if (t.type === "unitTest") {
      detail += `\n      framework: ${t.framework || "unittest"}`;
      detail += `\n      code: ${JSON.stringify(t.code || "")}`;
    }
    return detail;
  });

  return `IDE block ${blockIndex} autograder (allowStudentCheckAnswer: ${autograder.allowStudentCheckAnswer ?? true}):\n${autograder.tests.length} test(s):\n${testSummaries.join("\n")}`;
}

async function handleSetAutograderTests(
  assignmentId: string,
  blockIndex: number,
  tests: any[],
  allowStudentCheck: boolean | undefined,
  socket: AuthenticatedSocket
): Promise<string> {
  const { content } = await getAssignmentContent(assignmentId);

  if (blockIndex < 0 || blockIndex >= content.length) {
    throw new Error(`Block index ${blockIndex} is out of range.`);
  }

  const block = content[blockIndex];
  if (block.type !== "ideBlock") {
    throw new Error(
      `Block at index ${blockIndex} is a ${block.type}, not an ideBlock.`
    );
  }

  if (!block.attrs) block.attrs = {};
  if (!block.attrs.ideData) block.attrs.ideData = {};
  if (!block.attrs.ideData.autograder) {
    block.attrs.ideData.autograder = { tests: [], allowStudentCheckAnswer: true };
  }

  block.attrs.ideData.autograder.tests = tests;
  if (allowStudentCheck !== undefined) {
    block.attrs.ideData.autograder.allowStudentCheckAnswer = allowStudentCheck;
  }

  // Update total points to match sum of test points
  const totalPoints = tests.reduce((sum: number, t: any) => sum + (t.points || 0), 0);
  block.attrs.ideData.points = totalPoints;

  content[blockIndex] = block;
  await saveAssignmentContent(assignmentId, content);

  socket.emit("block-mutation", {
    type: "edit",
    blockIndex,
    blockType: "ideBlock",
    assignmentId,
  });

  return `Set ${tests.length} autograder test(s) on IDE block ${blockIndex} (total: ${totalPoints} points).`;
}

// Save a memory entry from the AI
async function handleSaveMemory(
  courseId: string,
  userId: string,
  content: string,
  memoryEnabled: boolean,
  maxChars: number
): Promise<string> {
  if (!memoryEnabled) {
    return "Memory saving is disabled for this course. The instructor can enable it in Course Settings > AI Memory.";
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return "Error: Memory content cannot be empty.";
  }

  if (content.length > MAX_ENTRY_CHARS) {
    return `Error: Memory entry must be ${MAX_ENTRY_CHARS} characters or fewer. Current length: ${content.length}.`;
  }

  // Check total usage
  const { data: existingMemories } = await supabase
    .from("ai_chat_memories")
    .select("content")
    .eq("course_id", courseId);

  const currentUsage = (existingMemories || []).reduce(
    (sum: number, m: any) => sum + (m.content?.length || 0),
    0
  );

  if (currentUsage + content.trim().length > maxChars) {
    return `Memory is full (${currentUsage}/${maxChars} characters used). Ask the instructor to free up space in Course Settings > AI Memory.`;
  }

  const { error } = await supabase.from("ai_chat_memories").insert({
    course_id: courseId,
    content: content.trim(),
    created_by: userId,
    source: "ai",
  });

  if (error) {
    logger.error("Failed to save AI memory", { error: error.message, courseId });
    return "Error: Failed to save memory. Please try again.";
  }

  return `Memory saved: "${content.trim()}"`;
}

// Execute a single tool call
async function executeTool(
  toolName: string,
  toolInput: any,
  assignmentId: string,
  userId: string,
  courseId: string,
  socket: AuthenticatedSocket,
  memoryEnabled?: boolean,
  memoryMaxChars?: number
): Promise<string> {
  switch (toolName) {
    case "get_assignment_state":
      return handleGetAssignmentState(assignmentId);

    case "create_block":
      return handleCreateBlock(
        assignmentId,
        toolInput.block_type,
        toolInput.position,
        toolInput.content,
        socket
      );

    case "edit_block":
      return handleEditBlock(
        assignmentId,
        toolInput.block_index,
        toolInput.updated_content,
        socket
      );

    case "delete_block":
      return handleDeleteBlock(assignmentId, toolInput.block_index, socket);

    case "reorder_blocks":
      return handleReorderBlocks(
        assignmentId,
        toolInput.from_index,
        toolInput.to_index,
        socket
      );

    case "read_ide_files":
      return handleReadIdeFiles(
        assignmentId,
        toolInput.block_index,
        toolInput.bucket_type,
        toolInput.file_path
      );

    case "write_ide_files":
      return handleWriteIdeFiles(
        assignmentId,
        userId,
        courseId,
        toolInput.block_index,
        toolInput.bucket_type,
        toolInput.file_path,
        toolInput.content,
        socket
      );

    case "get_autograder_tests":
      return handleGetAutograderTests(assignmentId, toolInput.block_index);

    case "set_autograder_tests":
      return handleSetAutograderTests(
        assignmentId,
        toolInput.block_index,
        toolInput.tests,
        toolInput.allow_student_check,
        socket
      );

    case "web_search": {
      const results = await webSearch(toolInput.query, toolInput.max_results || 5);
      return formatSearchResultsForPrompt(results);
    }

    case "save_memory":
      return handleSaveMemory(
        courseId,
        userId,
        toolInput.content,
        memoryEnabled ?? true,
        memoryMaxChars ?? DEFAULT_MAX_CHARS
      );

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Attachment types sent from the frontend
type ChatAttachment =
  | { kind: "image"; data: string; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }
  | { kind: "pdf"; data: string; fileName: string }
  | { kind: "text"; textContent: string; fileName: string };

// Size limits (bytes)
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;   // 20MB
const MAX_PDF_SIZE = 10 * 1024 * 1024;     // 10MB
const MAX_TEXT_SIZE = 500 * 1024;           // 500KB
const MAX_ATTACHMENTS = 10;

// Main chat handler
export async function handleChatMessage(params: {
  sessionId: string;
  assignmentId: string;
  userId: string;
  isAdmin: boolean;
  userMessage: string;
  attachments?: ChatAttachment[];
  socket: AuthenticatedSocket;
}): Promise<void> {
  const { sessionId, assignmentId, userId, userMessage, attachments, socket } = params;

  try {
    // Load session
    const { data: session, error: sessionError } = await supabase
      .from("ai_chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      socket.emit("chat-error", {
        message: "Chat session not found",
        sessionId,
      });
      return;
    }

    // Load assignment metadata
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("name, course_id, courses!inner(name)")
      .eq("id", assignmentId)
      .single();

    if (assignmentError || !assignment) {
      socket.emit("chat-error", {
        message: "Assignment not found",
        sessionId,
      });
      return;
    }

    const courseName = (assignment as any).courses?.name || "Unknown Course";
    const courseId = assignment.course_id;

    // Fetch course settings and memories
    const { data: courseData } = await supabase
      .from("courses")
      .select("settings")
      .eq("id", courseId)
      .single();

    const courseSettings = courseData?.settings || {};
    const memoryEnabled = courseSettings.ai_memory_enabled !== false; // default true
    const memoryMaxChars = courseSettings.ai_memory_max_chars ?? DEFAULT_MAX_CHARS;

    const { data: memoriesData } = await supabase
      .from("ai_chat_memories")
      .select("content")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true });

    const memories = (memoriesData || []).map((m: any) => m.content);

    // Fetch user email for Discord notification
    const { data: userData } = await supabase
      .from("users")
      .select("email")
      .eq("id", userId)
      .single();

    // Discord notification (fire-and-forget)
    const llmCallId = uuidv4();
    notifyAssignmentQuery({
      userId,
      userEmail: userData?.email,
      assignmentId,
      assignmentName: assignment.name,
      courseId,
      courseName,
      prompt: userMessage,
      llmCallId,
    }).catch((err) => {
      logger.warn("Discord notification failed (non-fatal)", { error: err.message });
    });

    // Validate attachments
    if (attachments && attachments.length > MAX_ATTACHMENTS) {
      socket.emit("chat-error", {
        message: `Too many attachments (max ${MAX_ATTACHMENTS}).`,
        sessionId,
      });
      return;
    }

    if (attachments) {
      for (const att of attachments) {
        if (att.kind === "image") {
          const sizeBytes = Buffer.byteLength(att.data, "base64");
          if (sizeBytes > MAX_IMAGE_SIZE) {
            socket.emit("chat-error", {
              message: `Image exceeds 20MB limit.`,
              sessionId,
            });
            return;
          }
        } else if (att.kind === "pdf") {
          const sizeBytes = Buffer.byteLength(att.data, "base64");
          if (sizeBytes > MAX_PDF_SIZE) {
            socket.emit("chat-error", {
              message: `PDF "${att.fileName}" exceeds 10MB limit.`,
              sessionId,
            });
            return;
          }
        } else if (att.kind === "text") {
          if (Buffer.byteLength(att.textContent, "utf-8") > MAX_TEXT_SIZE) {
            socket.emit("chat-error", {
              message: `Text file "${att.fileName}" exceeds 500KB limit.`,
              sessionId,
            });
            return;
          }
        }
      }
    }

    // Build message history
    // Construct user content — text + optional attachments
    let userContent: any;
    if (attachments && attachments.length > 0) {
      const contentBlocks: any[] = [];
      for (const att of attachments) {
        switch (att.kind) {
          case "image":
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.media_type,
                data: att.data,
              },
            });
            break;
          case "pdf":
            contentBlocks.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: att.data,
              },
              title: att.fileName,
            });
            break;
          case "text":
            contentBlocks.push({
              type: "text",
              text: `[Attached file: ${att.fileName}]\n\n${att.textContent}`,
            });
            break;
        }
      }
      contentBlocks.push({ type: "text", text: userMessage });
      userContent = contentBlocks;
    } else {
      userContent = userMessage;
    }

    const messages: MessageParam[] = [
      ...(session.messages || []),
      { role: "user" as const, content: userContent },
    ];

    const systemPrompt = buildSystemPrompt(assignment.name, courseName, memories);
    const tools = memoryEnabled ? [...TOOLS, SAVE_MEMORY_TOOL] : TOOLS;
    const client = getBedrockClient();

    // Agentic loop with streaming
    let iteration = 0;
    let currentMessages = [...messages];

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const stream = client.messages.stream({
        model: MODEL_ID,
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages: currentMessages,
      });

      // Stream text deltas to the frontend in real-time
      stream.on("text", (textDelta) => {
        socket.emit("chat-text", {
          text: textDelta,
          sessionId,
        });
      });

      // Wait for the complete message
      const response = await stream.finalMessage();

      // Collect tool use blocks from the final message
      const toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      // If no tool use, we're done
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        currentMessages.push({
          role: "assistant" as const,
          content: response.content as any,
        });
        break;
      }

      // Execute all tool calls and collect results
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];

      for (const tc of toolUseBlocks) {
        socket.emit("tool-call-start", {
          toolName: tc.name,
          toolInput: tc.input,
          toolId: tc.id,
          sessionId,
        });

        let toolResult: string;
        let isError = false;
        try {
          toolResult = await executeTool(
            tc.name,
            tc.input,
            assignmentId,
            userId,
            courseId,
            socket,
            memoryEnabled,
            memoryMaxChars
          );
        } catch (err: any) {
          toolResult = `Error: ${err.message}`;
          isError = true;
          logger.error("Tool execution error", {
            tool: tc.name,
            error: err.message,
            sessionId,
          });
        }

        socket.emit("tool-call-complete", {
          toolName: tc.name,
          toolId: tc.id,
          result: toolResult,
          isError,
          sessionId,
        });

        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: tc.id,
          content: toolResult,
          ...(isError ? { is_error: true } : {}),
        });
      }

      // Add assistant response + all tool results to history
      currentMessages.push({
        role: "assistant" as const,
        content: response.content as any,
      });
      currentMessages.push({
        role: "user" as const,
        content: toolResults as any,
      });
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      socket.emit("chat-text", {
        text: "\n\n*I've reached the maximum number of tool calls for this message. Please send another message to continue.*",
        sessionId,
      });
    }

    // Save updated messages to the session
    // Simplify messages for storage (convert to a clean format)
    const storedMessages = currentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    await supabase
      .from("ai_chat_sessions")
      .update({
        messages: storedMessages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    // Signal completion
    socket.emit("chat-complete", { sessionId });
  } catch (error: any) {
    logger.error("Chat message handling error", {
      error: error.message,
      stack: error.stack,
      sessionId,
      assignmentId,
    });

    let errorMessage = "An error occurred while processing your message.";
    if (error.message?.includes("throttl") || error.message?.includes("rate")) {
      errorMessage =
        "The AI service is currently busy. Please try again in a moment.";
    } else if (error.message?.includes("Access denied")) {
      errorMessage = "AI service access denied. Please contact support.";
    }

    socket.emit("chat-error", {
      message: errorMessage,
      sessionId,
    });
  }
}
