import { streamText } from "ai";
import { getChatModel } from "./aiProvider";
import { getChatToolSet } from "./aiTools";
import { anthropicToVercelMessages, vercelToAnthropicMessages } from "./aiMessageCompat";
import type { ModelMessage } from "ai";
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
import { emitAssignmentSettingsUpdate, emitTreeUpdate } from "./courseTreeSocket";

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

const MAX_TOOL_ITERATIONS = 15;

const DEFAULT_MAX_CHARS = 5000;
const MAX_ENTRY_CHARS = 500;

// Build the system prompt
function buildSystemPrompt(
  assignmentName: string,
  courseName: string,
  userTimezone: string,
  memories?: string[]
): string {
  // Format current date/time in the user's timezone
  const now = new Date();
  const localDateStr = now.toLocaleString("en-US", {
    timeZone: userTimezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return `You are Classla AI, an assistant helping instructors build educational assignments. You can create, edit, delete, and reorder assignment blocks, and read/write code files in IDE blocks.

CURRENT CONTEXT:
- Assignment: "${assignmentName}"
- Course: "${courseName}"
- Current date/time: ${localDateStr}
- Instructor's timezone: ${userTimezone}

CAPABILITIES:
- Create, edit, delete, and reorder assignment blocks
- Read and write code files in IDE blocks (templates and model solutions)
- Search the web for information, references, and context
- View and update assignment settings (due dates, late submissions, resubmissions, etc.)
- Update the assignment title
- Set due dates at course, section, or individual student level
- Browse other assignments in this course (read-only) for reference and inspiration
- Advise on pedagogical best practices

WORKFLOW:
- When asked about the current assignment, call get_assignment_state first
- When editing IDE code, call read_ide_files first to see current files before modifying
- Explain what you're doing conversationally
- After making changes, briefly confirm what was done
- You can reasonably generate content for all blocks to fulfill the request.
- When the instructor references another assignment (e.g. "style this like the quiz from Unit 1"), use list_course_assignments to find it, then read_other_assignment to see its structure. Adapt the style/content for the current assignment.

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
8. MEMORY: When the instructor says anything that implies a lasting preference or rule (e.g. "remember...", "always...", "never...", "from now on...", "I prefer...", "make sure to...", "don't ever..."), you MUST call save_memory to persist it. When in doubt, save it.

ASSIGNMENT SETTINGS RULES (CRITICAL — these settings affect student experience):
9. PRESERVE EXISTING SETTINGS: When using update_assignment_settings, ONLY include the specific settings the instructor explicitly asked to change. All omitted settings are preserved automatically. Never change settings the instructor didn't mention.
10. ASSIGNMENT TITLE vs HEADING BLOCKS: The assignment has a NAME (shown in the sidebar/course tree, e.g. "${assignmentName}") which is SEPARATE from any heading blocks in the content. When the instructor asks to "rename", "retitle", or "change the name of" the assignment, you MUST use the update_assignment_title tool — do NOT edit a heading block. Heading blocks (h1, h2, etc.) are just content within the assignment body. Only use update_assignment_title if (a) the instructor explicitly asks to rename/retitle the assignment, OR (b) the current title is "New Assignment" and you are generating content that warrants a proper name.
11. DUE DATES & TIMEZONE: Always call get_assignment_settings first before setting due dates so you understand the current configuration. Due dates cascade: course-wide → section overrides → student overrides. When the instructor says "set the due date", they typically mean the course-wide date. Only set section or student overrides when explicitly requested. IMPORTANT: When the instructor gives a time like "tomorrow at 3pm" or "Friday at midnight", interpret it in their local timezone (${userTimezone}) and convert to an ISO 8601 string with the correct UTC offset for that timezone. For example, if the timezone is America/New_York and they say "3pm", that means 3:00 PM Eastern time, so use the appropriate UTC offset (e.g. "2025-03-15T15:00:00-04:00" for EDT or "2025-03-15T15:00:00-05:00" for EST). Use the current date/time shown above to resolve relative dates like "tomorrow", "next Monday", "in 3 days", etc.
12. SECTIONS AND STUDENTS: The get_assignment_settings tool returns section IDs, names, and enrolled student IDs/names. Use these exact IDs when setting section or student due date overrides. If the instructor refers to a section or student by name, match it to the correct ID from the settings data.
13. CONFIRM SENSITIVE CHANGES: Before changing settings that directly impact students (like disabling late submissions or reducing time limits), briefly confirm with the instructor what you're about to change.
14. CROSS-ASSIGNMENT REFERENCE: When browsing other assignments with list_course_assignments and read_other_assignment, this access is read-only. You cannot modify other assignments. Use the information to adapt content, style, or structure for the current assignment only.${
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

// Fetch full assignment settings and due date info for the AI
async function handleGetAssignmentSettings(
  assignmentId: string,
  courseId: string
): Promise<string> {
  // Fetch the assignment
  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("name, settings, due_dates_map, due_date_config, is_lockdown, lockdown_time_map")
    .eq("id", assignmentId)
    .single();

  if (error || !assignment) {
    throw new Error("Assignment not found");
  }

  // Fetch sections with their enrollments so the AI can reference them
  const { data: sections } = await supabase
    .from("sections")
    .select("id, name, slug")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("name");

  // Fetch enrolled students
  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("user_id, section_id, users!inner(id, first_name, last_name, email)")
    .eq("course_id", courseId)
    .eq("role", "student");

  const settings = assignment.settings || {};
  const dueDateConfig = assignment.due_date_config || {};
  const dueDatesMap = assignment.due_dates_map || {};

  let result = `Assignment: "${assignment.name}"\n\n`;

  // Settings
  result += "SETTINGS:\n";
  result += `- allowLateSubmissions: ${settings.allowLateSubmissions ?? false}\n`;
  result += `- allowResubmissions: ${settings.allowResubmissions ?? false}\n`;
  result += `- showResponsesAfterSubmission: ${settings.showResponsesAfterSubmission ?? false}\n`;
  result += `- showScoreAfterSubmission: ${settings.showScoreAfterSubmission ?? false}\n`;
  result += `- timeLimitSeconds: ${settings.timeLimitSeconds ?? "not set"}\n`;
  result += `- is_lockdown (timed assignment): ${assignment.is_lockdown ?? false}\n`;

  // Due dates
  result += "\nDUE DATES:\n";
  const courseDueDate = dueDateConfig.courseDueDate;
  if (courseDueDate) {
    result += `- Course-wide due date: ${courseDueDate}\n`;
  } else {
    result += "- Course-wide due date: not set\n";
  }

  const sectionDueDates = dueDateConfig.sectionDueDates || {};
  if (Object.keys(sectionDueDates).length > 0) {
    result += "- Section overrides:\n";
    for (const [sectionId, date] of Object.entries(sectionDueDates)) {
      const section = sections?.find((s: any) => s.id === sectionId);
      result += `    ${section?.name || sectionId}: ${date}\n`;
    }
  }

  // Individual student overrides (only those different from inherited)
  const studentOverrides: string[] = [];
  for (const [userId, date] of Object.entries(dueDatesMap)) {
    if (!date) continue;
    // Find student info
    const enrollment = enrollments?.find((e: any) => e.user_id === userId);
    const user = (enrollment as any)?.users;
    const studentName = user ? `${user.first_name} ${user.last_name}` : userId;

    // Determine inherited date
    const studentSection = enrollment?.section_id;
    const inheritedDate = (studentSection && sectionDueDates[studentSection]) || courseDueDate;

    // Only show as override if different from inherited
    const dateStr = typeof date === "string" ? date : new Date(date as any).toISOString();
    if (dateStr !== inheritedDate) {
      studentOverrides.push(`    ${studentName} (${userId}): ${dateStr}`);
    }
  }

  if (studentOverrides.length > 0) {
    result += "- Individual student overrides:\n";
    result += studentOverrides.join("\n") + "\n";
  }

  // Sections list
  if (sections && sections.length > 0) {
    result += "\nSECTIONS:\n";
    for (const section of sections) {
      const sectionEnrollments = enrollments?.filter((e: any) => e.section_id === section.id) || [];
      result += `- "${section.name}" (id: ${section.id}, code: ${section.slug}, ${sectionEnrollments.length} students)\n`;
    }
  }

  // Unsectioned students
  const unsectioned = enrollments?.filter((e: any) => !e.section_id) || [];
  if (unsectioned.length > 0) {
    result += `\nUNSECTIONED STUDENTS: ${unsectioned.length}\n`;
  }

  // Total enrolled students
  result += `\nTOTAL ENROLLED STUDENTS: ${enrollments?.length || 0}`;

  return result;
}

// Update assignment title
async function handleUpdateAssignmentTitle(
  assignmentId: string,
  courseId: string,
  title: string,
  socket: AuthenticatedSocket
): Promise<string> {
  const { error } = await supabase
    .from("assignments")
    .update({ name: title, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (error) {
    throw new Error(`Failed to update assignment title: ${error.message}`);
  }

  // Emit tree update so sidebar reflects the new name
  try {
    emitTreeUpdate(getIO(), courseId, "assignment-updated", { assignmentId });
  } catch {}

  socket.emit("assignment-title-updated", {
    assignmentId,
    title,
  });

  return `Assignment title updated to "${title}".`;
}

// Update assignment settings (merge with existing)
async function handleUpdateAssignmentSettings(
  assignmentId: string,
  courseId: string,
  settingsUpdate: Record<string, any>,
  socket: AuthenticatedSocket
): Promise<string> {
  // Fetch current settings
  const { data: assignment, error: fetchError } = await supabase
    .from("assignments")
    .select("settings")
    .eq("id", assignmentId)
    .single();

  if (fetchError || !assignment) {
    throw new Error("Assignment not found");
  }

  // Merge: only the provided keys overwrite existing
  const currentSettings = assignment.settings || {};
  const mergedSettings = { ...currentSettings };

  const changedFields: string[] = [];
  for (const [key, value] of Object.entries(settingsUpdate)) {
    if (value !== undefined) {
      mergedSettings[key] = value;
      changedFields.push(`${key}: ${value}`);
    }
  }

  const { error: updateError } = await supabase
    .from("assignments")
    .update({ settings: mergedSettings, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (updateError) {
    throw new Error(`Failed to update settings: ${updateError.message}`);
  }

  // Emit real-time settings update
  try {
    emitAssignmentSettingsUpdate(getIO(), courseId, {
      assignmentId,
      settings: mergedSettings,
    });
  } catch {}

  socket.emit("assignment-settings-changed", {
    assignmentId,
    settings: mergedSettings,
  });

  return `Assignment settings updated: ${changedFields.join(", ")}.`;
}

// Set due dates at course, section, or student level
async function handleSetDueDates(
  assignmentId: string,
  courseId: string,
  courseDueDate: string | null | undefined,
  sectionDueDates: Record<string, string | null> | undefined,
  studentDueDates: Record<string, string | null> | undefined,
  socket: AuthenticatedSocket
): Promise<string> {
  // Fetch current assignment state
  const { data: assignment, error: fetchError } = await supabase
    .from("assignments")
    .select("due_dates_map, due_date_config")
    .eq("id", assignmentId)
    .single();

  if (fetchError || !assignment) {
    throw new Error("Assignment not found");
  }

  const currentDueDatesMap: Record<string, string> = assignment.due_dates_map || {};
  const currentConfig: { courseDueDate?: string; sectionDueDates?: Record<string, string> } =
    assignment.due_date_config || {};

  // Update due_date_config
  const newConfig = { ...currentConfig };

  if (courseDueDate !== undefined) {
    if (courseDueDate === null) {
      delete newConfig.courseDueDate;
    } else {
      newConfig.courseDueDate = courseDueDate;
    }
  }

  if (sectionDueDates) {
    const currentSectionDates = { ...(newConfig.sectionDueDates || {}) };
    for (const [sectionId, date] of Object.entries(sectionDueDates)) {
      if (date === null) {
        delete currentSectionDates[sectionId];
      } else {
        currentSectionDates[sectionId] = date;
      }
    }
    newConfig.sectionDueDates = currentSectionDates;
  }

  // Now expand the cascade into per-student due_dates_map
  // Fetch enrollments so we know which students are in which sections
  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("user_id, section_id")
    .eq("course_id", courseId)
    .eq("role", "student");

  const newDueDatesMap: Record<string, string> = {};
  const effectiveCourseDueDate = newConfig.courseDueDate || null;
  const effectiveSectionDates = newConfig.sectionDueDates || {};

  // For each enrolled student, compute their effective due date
  for (const enrollment of (enrollments || [])) {
    const userId = enrollment.user_id;

    // Check for explicit student override from input
    if (studentDueDates && studentDueDates[userId] !== undefined) {
      if (studentDueDates[userId] !== null) {
        newDueDatesMap[userId] = studentDueDates[userId] as string;
        continue;
      }
      // null means clear override, fall through to inherited
    } else if (currentDueDatesMap[userId]) {
      // Check if this was a student-level override (not just inherited)
      const sectionDate = enrollment.section_id ? effectiveSectionDates[enrollment.section_id] : null;
      const inheritedDate = sectionDate || effectiveCourseDueDate;
      if (currentDueDatesMap[userId] !== inheritedDate) {
        // Preserve existing student-level override
        newDueDatesMap[userId] = currentDueDatesMap[userId];
        continue;
      }
    }

    // Compute inherited date
    const sectionDate = enrollment.section_id ? effectiveSectionDates[enrollment.section_id] : null;
    const effectiveDate = sectionDate || effectiveCourseDueDate;

    if (effectiveDate) {
      newDueDatesMap[userId] = effectiveDate;
    }
  }

  // Also handle any explicit student overrides for students we haven't processed
  if (studentDueDates) {
    for (const [userId, date] of Object.entries(studentDueDates)) {
      if (date !== null && date !== undefined && !newDueDatesMap[userId]) {
        newDueDatesMap[userId] = date;
      }
    }
  }

  // Save to DB
  const { error: updateError } = await supabase
    .from("assignments")
    .update({
      due_dates_map: newDueDatesMap,
      due_date_config: newConfig,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId);

  if (updateError) {
    throw new Error(`Failed to update due dates: ${updateError.message}`);
  }

  // Emit real-time update
  try {
    emitAssignmentSettingsUpdate(getIO(), courseId, {
      assignmentId,
      due_dates_map: newDueDatesMap,
      due_date_config: newConfig,
    });
  } catch {}

  socket.emit("assignment-settings-changed", {
    assignmentId,
    due_dates_map: newDueDatesMap,
    due_date_config: newConfig,
  });

  // Build confirmation message
  const changes: string[] = [];
  if (courseDueDate !== undefined) {
    changes.push(courseDueDate ? `Course-wide due date: ${courseDueDate}` : "Course-wide due date cleared");
  }
  if (sectionDueDates) {
    for (const [sectionId, date] of Object.entries(sectionDueDates)) {
      changes.push(date ? `Section ${sectionId}: ${date}` : `Section ${sectionId}: override cleared`);
    }
  }
  if (studentDueDates) {
    for (const [userId, date] of Object.entries(studentDueDates)) {
      changes.push(date ? `Student ${userId}: ${date}` : `Student ${userId}: override cleared`);
    }
  }

  return `Due dates updated:\n${changes.join("\n")}\n\n${Object.keys(newDueDatesMap).length} student(s) have due dates set.`;
}

// List all assignments in the course grouped by module path
async function handleListCourseAssignments(
  courseId: string,
  currentAssignmentId: string
): Promise<string> {
  const { data: assignments, error } = await supabase
    .from("assignments")
    .select("id, name, module_path, order_index")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("module_path")
    .order("order_index");

  if (error) {
    throw new Error(`Failed to list assignments: ${error.message}`);
  }

  if (!assignments || assignments.length === 0) {
    return "No assignments found in this course.";
  }

  // Group by module_path
  const grouped: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    const path = a.module_path || "(ungrouped)";
    if (!grouped[path]) grouped[path] = [];
    grouped[path].push(a);
  }

  const lines: string[] = [`Course has ${assignments.length} assignment(s):\n`];
  for (const [path, items] of Object.entries(grouped)) {
    lines.push(`${path}/`);
    for (const item of items) {
      const marker = item.id === currentAssignmentId ? " ← (current)" : "";
      lines.push(`  - ${item.name} [id: ${item.id}]${marker}`);
    }
  }

  return lines.join("\n");
}

// Read block summary of another assignment in the same course
async function handleReadOtherAssignment(
  targetAssignmentId: string,
  courseId: string
): Promise<string> {
  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("id, name, course_id, content")
    .eq("id", targetAssignmentId)
    .is("deleted_at", null)
    .single();

  if (error || !assignment) {
    return `Assignment not found. Make sure the ID is correct and the assignment hasn't been deleted.`;
  }

  if (assignment.course_id !== courseId) {
    return `Access denied: that assignment belongs to a different course. You can only read assignments within the current course.`;
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

  if (content.length === 0) {
    return `Assignment "${assignment.name}" is empty (no blocks).`;
  }

  const summaries = content.map((block: any, i: number) => summarizeBlock(block, i));
  return `Assignment "${assignment.name}" has ${content.length} block(s):\n${summaries.join("\n")}`;
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

    case "list_course_assignments":
      return handleListCourseAssignments(courseId, assignmentId);

    case "read_other_assignment":
      return handleReadOtherAssignment(toolInput.assignment_id, courseId);

    case "get_assignment_settings":
      return handleGetAssignmentSettings(assignmentId, courseId);

    case "update_assignment_title":
      return handleUpdateAssignmentTitle(
        assignmentId,
        courseId,
        toolInput.title,
        socket
      );

    case "update_assignment_settings":
      return handleUpdateAssignmentSettings(
        assignmentId,
        courseId,
        toolInput,
        socket
      );

    case "set_due_dates":
      return handleSetDueDates(
        assignmentId,
        courseId,
        toolInput.course_due_date,
        toolInput.section_due_dates,
        toolInput.student_due_dates,
        socket
      );

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
  timezone?: string;
  attachments?: ChatAttachment[];
  socket: AuthenticatedSocket;
}): Promise<void> {
  const { sessionId, assignmentId, userId, userMessage, timezone, attachments, socket } = params;

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

    // Load assignment metadata (including settings for the new settings tools)
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("name, course_id, settings, due_dates_map, due_date_config, is_lockdown, lockdown_time_map, courses!inner(name)")
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

    // Build new user content in Vercel format
    const userContentParts: any[] = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        switch (att.kind) {
          case "image":
            userContentParts.push({
              type: "image",
              image: att.data,
              mediaType: att.media_type,
            });
            break;
          case "pdf":
            userContentParts.push({
              type: "file",
              data: att.data,
              mediaType: "application/pdf",
            });
            break;
          case "text":
            userContentParts.push({
              type: "text",
              text: `[Attached file: ${att.fileName}]\n\n${att.textContent}`,
            });
            break;
        }
      }
      userContentParts.push({ type: "text", text: userMessage });
    }

    // Convert stored Anthropic-format messages to Vercel format
    const historyMessages = anthropicToVercelMessages(session.messages || []);

    // Append the new user message
    const newUserMessage: ModelMessage = userContentParts.length > 0
      ? { role: "user", content: userContentParts as any }
      : { role: "user", content: userMessage };

    const currentMessages: ModelMessage[] = [...historyMessages, newUserMessage];

    const userTimezone = timezone || "America/New_York";
    const systemPrompt = buildSystemPrompt(assignment.name, courseName, userTimezone, memories);
    const tools = getChatToolSet(memoryEnabled);

    // Agentic loop with streaming
    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const result = await streamText({
        model: getChatModel(),
        maxOutputTokens: 8192,
        system: systemPrompt,
        tools,
        messages: currentMessages,
      });

      // Stream text deltas to the frontend in real-time
      for await (const textPart of result.textStream) {
        if (textPart) {
          socket.emit("chat-text", {
            text: textPart,
            sessionId,
          });
        }
      }

      // Get the full response text and tool calls
      const responseText = await result.text;
      const toolCalls = await result.toolCalls;

      // Use SDK response messages to preserve provider metadata
      // (e.g., Gemini thought signatures on tool-call parts)
      const responseMessages = (await result.response).messages;
      for (const msg of responseMessages) {
        currentMessages.push(msg);
      }

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        break;
      }

      // Execute all tool calls and collect results
      const toolResultParts: any[] = [];

      for (const tc of toolCalls) {
        socket.emit("tool-call-start", {
          toolName: tc.toolName,
          toolInput: tc.input,
          toolId: tc.toolCallId,
          sessionId,
        });

        let toolResultText: string;
        let isError = false;
        try {
          toolResultText = await executeTool(
            tc.toolName,
            tc.input,
            assignmentId,
            userId,
            courseId,
            socket,
            memoryEnabled,
            memoryMaxChars
          );
        } catch (err: any) {
          toolResultText = `Error: ${err.message}`;
          isError = true;
          logger.error("Tool execution error", {
            tool: tc.toolName,
            error: err.message,
            sessionId,
          });
        }

        socket.emit("tool-call-complete", {
          toolName: tc.toolName,
          toolId: tc.toolCallId,
          result: toolResultText,
          isError,
          sessionId,
        });

        toolResultParts.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: "text", value: toolResultText },
          isError,
        });
      }

      // Add tool results to history
      currentMessages.push({
        role: "tool",
        content: toolResultParts,
      } as ModelMessage);
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      socket.emit("chat-text", {
        text: "\n\n*I've reached the maximum number of tool calls for this message. Please send another message to continue.*",
        sessionId,
      });
    }

    // Convert back to Anthropic format for DB storage (backward compat)
    const storedMessages = vercelToAnthropicMessages(currentMessages);

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
    if (error.message?.includes("throttl") || error.message?.includes("rate limit") || error.message?.includes("429") || error.message?.includes("Too Many Requests") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      errorMessage =
        "The AI service is currently busy. Please try again in a moment.";
    } else if (error.message?.includes("Access denied")) {
      errorMessage = "AI service access denied. Please contact support.";
    } else if (error.message?.includes("No output generated") || error.message?.includes("InvalidPrompt")) {
      errorMessage = "The AI failed to generate a response. Please try again or rephrase your message.";
    }

    socket.emit("chat-error", {
      message: errorMessage,
      sessionId,
    });
  }
}
