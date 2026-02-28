import { z } from "zod";
import { tool, zodSchema } from "ai";
import type { ToolSet } from "ai";

// Tool definitions using Vercel AI SDK v6 tool() with Zod schemas.
// No execute functions — execution stays in executeTool() in aiChat.ts.

const getAssignmentState = tool({
  description:
    "Read the current assignment block structure. Returns a summary of all blocks with their types, indices, and content summaries. Call this first when the user asks about or wants to modify existing content.",
  inputSchema: zodSchema(z.object({})),
});

const createBlock = tool({
  description:
    "Insert a new block into the assignment at a specific position. The block will appear at the given index, pushing existing blocks down.",
  inputSchema: zodSchema(
    z.object({
      block_type: z
        .string()
        .describe(
          "The type of block to create. One of: paragraph, heading, bulletList, orderedList, codeBlock, blockquote, horizontalRule, mcqBlock, fillInTheBlankBlock, shortAnswerBlock, ideBlock, parsonsProblemBlock, dragDropMatchingBlock, clickableAreaBlock, pollBlock, tabbedContentBlock, revealContentBlock, embedBlock"
        ),
      position: z
        .number()
        .describe(
          "The 0-based index where the block should be inserted. Use -1 to append at the end."
        ),
      content: z
        .record(z.string(), z.any())
        .describe(
          "The full TipTap JSON node for the block (including type and attrs)."
        ),
    })
  ),
});

const editBlock = tool({
  description:
    "Modify an existing block's content. Replaces the block at the given index with the updated content.",
  inputSchema: zodSchema(
    z.object({
      block_index: z.number().describe("The 0-based index of the block to edit."),
      updated_content: z
        .record(z.string(), z.any())
        .describe(
          "The full updated TipTap JSON node for the block (including type and attrs)."
        ),
    })
  ),
});

const deleteBlock = tool({
  description: "Remove a block from the assignment at the given index.",
  inputSchema: zodSchema(
    z.object({
      block_index: z
        .number()
        .describe("The 0-based index of the block to delete."),
    })
  ),
});

const reorderBlocks = tool({
  description: "Move a block from one position to another.",
  inputSchema: zodSchema(
    z.object({
      from_index: z
        .number()
        .describe("The current 0-based index of the block to move."),
      to_index: z
        .number()
        .describe("The target 0-based index to move the block to."),
    })
  ),
});

const readIdeFiles = tool({
  description:
    'List or read files from an IDE block\'s S3 bucket. Use bucket_type "template" for starter code or "modelSolution" for solution code. Omit file_path to list all files, or provide it to read a specific file.',
  inputSchema: zodSchema(
    z.object({
      block_index: z
        .number()
        .describe("The 0-based index of the IDE block."),
      bucket_type: z
        .enum(["template", "modelSolution"])
        .describe(
          'Which bucket to read from: "template" for starter code or "modelSolution" for solution code.'
        ),
      file_path: z
        .string()
        .optional()
        .describe(
          "Optional file path to read. If omitted, returns a list of all files in the bucket."
        ),
    })
  ),
});

const writeIdeFiles = tool({
  description:
    "Create or update a file in an IDE block's S3 bucket. If no bucket exists yet, one will be created automatically.",
  inputSchema: zodSchema(
    z.object({
      block_index: z
        .number()
        .describe("The 0-based index of the IDE block."),
      bucket_type: z
        .enum(["template", "modelSolution"])
        .describe(
          'Which bucket to write to: "template" for starter code or "modelSolution" for solution code.'
        ),
      file_path: z
        .string()
        .describe("The file path within the bucket (e.g., 'main.py')."),
      content: z.string().describe("The file content to write."),
    })
  ),
});

const getAutograderTests = tool({
  description:
    "Read the autograder test configuration for an IDE block. Returns all test cases with their types, names, points, and details.",
  inputSchema: zodSchema(
    z.object({
      block_index: z
        .number()
        .describe("The 0-based index of the IDE block."),
    })
  ),
});

const setAutograderTests = tool({
  description:
    'Set the autograder test cases for an IDE block. Replaces all existing tests. Each test must have an id (UUID), name, type ("inputOutput", "unitTest", or "manualGrading"), and points. inputOutput tests have input and expectedOutput fields. unitTest tests have a code field and optional framework field ("unittest" or "junit"). manualGrading tests only need name and points.',
  inputSchema: zodSchema(
    z.object({
      block_index: z
        .number()
        .describe("The 0-based index of the IDE block."),
      tests: z
        .array(
          z.object({
            id: z.string().describe("UUID for this test case."),
            name: z.string().describe("Test case display name."),
            type: z
              .enum(["inputOutput", "unitTest", "manualGrading"])
              .describe("The type of test case."),
            points: z.number().describe("Points value for this test."),
            input: z
              .string()
              .optional()
              .describe("stdin input for inputOutput tests (can be empty string)."),
            expectedOutput: z
              .string()
              .optional()
              .describe("Expected stdout for inputOutput tests."),
            code: z
              .string()
              .optional()
              .describe("Test code for unitTest tests."),
            framework: z
              .enum(["unittest", "junit"])
              .optional()
              .describe('Test framework for unitTest tests. Defaults to "unittest".'),
          })
        )
        .describe("Array of test case objects."),
      allow_student_check: z
        .boolean()
        .optional()
        .describe(
          "Whether students can check their answers against the autograder. IMPORTANT: Do NOT include this parameter unless the instructor explicitly asks to change it. Omit it to preserve the current value."
        ),
    })
  ),
});

const webSearchTool = tool({
  description:
    "Search the web for information. Use this when the user asks about a topic you need more context on, pastes a URL and asks about it, or requests web-based content to include in the assignment.",
  inputSchema: zodSchema(
    z.object({
      query: z.string().describe("The search query to look up."),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 5)."),
    })
  ),
});

const saveMemory = tool({
  description:
    'Save important context to course memory that persists across all chat sessions in this course. You MUST call this tool whenever the instructor expresses a persistent preference, rule, or standard — look for phrases like "remember", "always", "never", "from now on", "going forward", "make sure to", "don\'t ever", "I prefer", "I want", "use X instead of Y", or any statement that implies a lasting rule or preference. Each memory should be a concise, self-contained statement (max 500 chars). When in doubt about whether to save, save it.',
  inputSchema: zodSchema(
    z.object({
      content: z
        .string()
        .describe(
          "A concise, self-contained statement capturing the preference or rule (max 500 characters). Write it as a directive, e.g. 'Always use Python type hints' not 'The instructor said to use type hints'."
        ),
    })
  ),
});

export function getChatToolSet(memoryEnabled: boolean): ToolSet {
  const tools: ToolSet = {
    get_assignment_state: getAssignmentState,
    create_block: createBlock,
    edit_block: editBlock,
    delete_block: deleteBlock,
    reorder_blocks: reorderBlocks,
    read_ide_files: readIdeFiles,
    write_ide_files: writeIdeFiles,
    get_autograder_tests: getAutograderTests,
    set_autograder_tests: setAutograderTests,
    web_search: webSearchTool,
  };

  if (memoryEnabled) {
    tools.save_memory = saveMemory;
  }

  return tools;
}
