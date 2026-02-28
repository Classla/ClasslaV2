/**
 * Bidirectional conversion between Anthropic-format messages (stored in DB)
 * and Vercel AI SDK v6 ModelMessage format.
 *
 * Existing sessions continue working with zero DB migration.
 */
import type {
  ModelMessage,
  AssistantModelMessage,
  UserModelMessage,
  ToolModelMessage,
} from "ai";

// ────────────────────────────────────────────────────────────
// Anthropic → Vercel
// ────────────────────────────────────────────────────────────

/**
 * Convert stored Anthropic-format messages to Vercel ModelMessage[].
 *
 * Handles:
 *   - text blocks
 *   - tool_use (assistant) → tool-call part
 *   - tool_result (inside user message) → tool role messages
 *   - image/document attachments
 */
export function anthropicToVercelMessages(
  msgs: any[]
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of msgs) {
    if (msg.role === "assistant") {
      result.push(convertAssistantMessage(msg));
    } else if (msg.role === "user") {
      // User messages may contain tool_result blocks (Anthropic convention)
      // or normal text/image/document content.
      const content = normalizeContent(msg.content);

      // Check if this is purely tool_result blocks
      if (Array.isArray(content) && content.every((b: any) => b.type === "tool_result")) {
        // Convert each tool_result into a tool-role message
        const toolMessage: ToolModelMessage = {
          role: "tool",
          content: content.map((tr: any) => ({
            type: "tool-result" as const,
            toolCallId: tr.tool_use_id,
            toolName: "",
            output: { type: "text" as const, value: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content) },
          })),
        };
        result.push(toolMessage);
      } else {
        result.push(convertUserMessage(msg));
      }
    }
    // Skip any other roles (shouldn't exist)
  }

  return result;
}

function convertAssistantMessage(msg: any): AssistantModelMessage {
  const content = normalizeContent(msg.content);

  if (typeof content === "string") {
    return { role: "assistant", content };
  }

  // Mixed content: text + tool_use blocks
  const parts: AssistantModelMessage["content"] = [];

  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      const toolCallPart: any = {
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
      };
      // Restore providerOptions (e.g., Gemini thought signatures) if stored
      if (block.providerOptions) {
        toolCallPart.providerOptions = block.providerOptions;
      }
      parts.push(toolCallPart);
    }
  }

  return { role: "assistant", content: parts };
}

function convertUserMessage(msg: any): UserModelMessage {
  const content = normalizeContent(msg.content);

  if (typeof content === "string") {
    return { role: "user", content };
  }

  const parts: UserModelMessage["content"] = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      // Anthropic image: { type: "image", source: { type: "base64", media_type, data } }
      parts.push({
        type: "image",
        image: block.source?.data,
        mimeType: block.source?.media_type,
      } as any);
    } else if (block.type === "document") {
      // Anthropic PDF: { type: "document", source: { type: "base64", media_type, data }, title }
      parts.push({
        type: "file",
        data: block.source?.data,
        mimeType: block.source?.media_type || "application/pdf",
      } as any);
    }
  }

  return { role: "user", content: parts };
}

function normalizeContent(content: any): any {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content;
  return String(content);
}

// ────────────────────────────────────────────────────────────
// Vercel → Anthropic (for DB storage)
// ────────────────────────────────────────────────────────────

/**
 * Convert Vercel ModelMessage[] back to Anthropic format for DB storage.
 * This preserves backward compatibility with existing sessions.
 */
export function vercelToAnthropicMessages(msgs: ModelMessage[]): any[] {
  const result: any[] = [];

  for (const msg of msgs) {
    switch (msg.role) {
      case "assistant":
        result.push(convertVercelAssistant(msg as AssistantModelMessage));
        break;
      case "user":
        result.push(convertVercelUser(msg as UserModelMessage));
        break;
      case "tool":
        // Tool results become a user message with tool_result blocks (Anthropic convention)
        result.push(convertVercelToolResults(msg as ToolModelMessage));
        break;
    }
  }

  return result;
}

function convertVercelAssistant(msg: AssistantModelMessage): any {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content };
  }

  const blocks: any[] = [];
  for (const part of msg.content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "tool-call") {
      const block: any = {
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      };
      // Preserve providerOptions (e.g., Gemini thought signatures) for DB storage
      if ((part as any).providerOptions) {
        block.providerOptions = (part as any).providerOptions;
      }
      blocks.push(block);
    }
  }

  return { role: "assistant", content: blocks };
}

function convertVercelUser(msg: UserModelMessage): any {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }

  const blocks: any[] = [];
  for (const part of msg.content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: (part as any).mimeType || "image/jpeg",
          data: typeof part.image === "string" ? part.image : "",
        },
      });
    } else if (part.type === "file") {
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: (part as any).mimeType || "application/pdf",
          data: (part as any).data || "",
        },
      });
    }
  }

  return { role: "user", content: blocks };
}

function convertVercelToolResults(msg: ToolModelMessage): any {
  const content = Array.isArray(msg.content) ? msg.content : [];
  const blocks = content.map((tr: any) => {
    // Extract the text value from the output
    let resultText: string;
    if (typeof tr.output === "string") {
      resultText = tr.output;
    } else if (tr.output && typeof tr.output === "object" && "value" in tr.output) {
      resultText = String(tr.output.value);
    } else {
      resultText = JSON.stringify(tr.output);
    }

    return {
      type: "tool_result",
      tool_use_id: tr.toolCallId,
      content: resultText,
      ...(tr.isError ? { is_error: true } : {}),
    };
  });

  return { role: "user", content: blocks };
}
