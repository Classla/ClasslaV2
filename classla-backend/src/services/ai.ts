import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../utils/logger";
import { AuthenticatedSocket } from "./websocket";
import { supabase } from "../middleware/auth";
import { notifyAssignmentQuery, notifyParsingError, notifyRequestError } from "./discord";

// Claude Sonnet model ID
const CLAUDE_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0";

// Maximum context window in tokens (200k tokens)
const MAX_CONTEXT_WINDOW = 200000;

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

    if (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY,
      };
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    
    bedrockClient = new BedrockRuntimeClient(config);
  }
  return bedrockClient;
};

// System prompt for TipTap JSON generation
const SYSTEM_PROMPT = `You are an AI assistant that helps teachers create educational content for assignments. You generate content in TipTap JSON format.

TipTap JSON Structure:
- Top level: { "type": "doc", "content": [...] }
- Content is an array of block nodes
- Common block types: "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule"

MCQ Block Format:
Multiple Choice Questions use a special block type "mcqBlock" with this structure:
{
  "type": "mcqBlock",
  "attrs": {
    "mcqData": {
      "id": "uuid-string",
      "question": "HTML string of the question",
      "options": [
        {
          "id": "uuid-string",
          "text": "HTML string of option text",
          "isCorrect": true/false
        }
      ],
      "allowMultiple": false,
      "points": 1,
      "explanation": "optional explanation string"
    }
  }
}

Important Rules:
1. Always return valid TipTap JSON format
2. For MCQ blocks, generate unique UUIDs for id fields (use format: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx")
3. Question and option text should be HTML strings (e.g., "<p>What is 2+2?</p>")
4. At least one option must have "isCorrect": true
5. Include at least 2 options, typically 4-5 options
6. Set "allowMultiple": false for single-answer questions, true for multiple-answer questions
7. Set appropriate "points" value (typically 1-5)
8. You can generate multiple blocks in the content array
9. Mix different block types (paragraphs, headings, MCQ blocks, etc.) as appropriate

Example Response:
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Quiz Title" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Introduction text here." }]
    },
    {
      "type": "mcqBlock",
      "attrs": {
        "mcqData": {
          "id": "550e8400-e29b-41d4-a716-446655440000",
          "question": "<p>What is the capital of France?</p>",
          "options": [
            { "id": "opt-1", "text": "<p>Paris</p>", "isCorrect": true },
            { "id": "opt-2", "text": "<p>London</p>", "isCorrect": false },
            { "id": "opt-3", "text": "<p>Berlin</p>", "isCorrect": false },
            { "id": "opt-4", "text": "<p>Madrid</p>", "isCorrect": false }
          ],
          "allowMultiple": false,
          "points": 1,
          "explanation": "Paris is the capital city of France."
        }
      }
    }
  ]
}

IMPORTANT: Return ONLY valid JSON. Do not wrap in markdown code blocks.`;

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
      max_tokens: 4096,
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

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

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

    for await (const chunk of stream) {
      if (socket.disconnected) {
        logger.info("Client disconnected, stopping stream", { requestId });
        break;
      }

      if (chunk.chunk?.bytes) {
        const chunkData = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));

        if (chunkData.type === "content_block_delta") {
          const text = chunkData.delta?.text || "";
          if (text) {
            fullText += text;
            
            // Parse incrementally to detect new blocks
            parseAndEmitBlocks(
              fullText, 
              socket, 
              requestId, 
              assignmentId, 
              startedBlocks, 
              completedBlocks,
              llmCallId || undefined,
              userId,
              userEmail,
              assignmentContext
            );
          }
        } else if (chunkData.type === "message_stop") {
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
  llmCallId?: string | null,
  userId?: string,
  userEmail?: string,
  assignmentContext?: { name?: string }
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
          const block = JSON.parse(blockJson);
          socket.emit("block-complete", { blockIndex, block, requestId, assignmentId });
          completedBlocks.add(blockIndex);
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
