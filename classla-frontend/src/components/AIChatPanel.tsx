import React, { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Plus,
  Loader2,
  ChevronDown,
  Check,
  AlertCircle,
  Wrench,
  Trash2,
  MessageSquare,
  Sparkles,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  ChatSession,
  ChatContentBlock,
} from "../lib/aiChatApi";

interface AIChatPanelProps {
  assignmentId: string;
  courseId: string;
  onBlockMutation?: () => void;
  onClose?: () => void;
}

// Get base URL for WebSocket
const getBaseURL = () => {
  const apiUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
  return apiUrl.replace(/\/api$/, "") || "http://localhost:8000";
};

// Image attachment (pending or displayed)
interface ImageAttachment {
  data: string; // base64 data (no prefix)
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  preview: string; // data URL for display
}

// Ordered content parts — text and tool calls interleaved
type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool"; toolCall: ToolCallDisplay };

// Displayable message types for the UI
interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text?: string; // only for user messages
  images?: ImageAttachment[]; // only for user messages with images
  parts?: ContentPart[]; // only for assistant messages
}

interface ToolCallDisplay {
  id: string;
  name: string;
  input: any;
  result?: string;
  isError?: boolean;
  status: "running" | "complete";
}

// Tool name to friendly label
function toolLabel(name: string, input?: any): string {
  switch (name) {
    case "get_assignment_state":
      return "Reading assignment...";
    case "create_block":
      return `Creating ${input?.block_type || "block"}...`;
    case "edit_block":
      return `Editing block ${input?.block_index ?? ""}...`;
    case "delete_block":
      return `Removing block ${input?.block_index ?? ""}...`;
    case "reorder_blocks":
      return `Moving block...`;
    case "read_ide_files":
      return input?.file_path
        ? `Reading ${input.file_path}...`
        : `Listing ${input?.bucket_type || ""} files...`;
    case "write_ide_files":
      return `Writing ${input?.file_path || "file"}...`;
    case "get_autograder_tests":
      return "Reading autograder tests...";
    case "set_autograder_tests":
      return "Updating autograder tests...";
    case "web_search":
      return `Searching "${input?.query || "web"}"...`;
    case "save_memory":
      return "Saving to memory...";
    default:
      return `${name}...`;
  }
}

function toolCompleteLabel(name: string, input?: any): string {
  switch (name) {
    case "get_assignment_state":
      return "Read assignment state";
    case "create_block":
      return `Created ${input?.block_type || "block"}`;
    case "edit_block":
      return `Edited block ${input?.block_index ?? ""}`;
    case "delete_block":
      return `Removed block ${input?.block_index ?? ""}`;
    case "reorder_blocks":
      return `Moved block`;
    case "read_ide_files":
      return input?.file_path
        ? `Read ${input.file_path}`
        : `Listed ${input?.bucket_type || ""} files`;
    case "write_ide_files":
      return `Wrote ${input?.file_path || "file"}`;
    case "get_autograder_tests":
      return "Read autograder tests";
    case "set_autograder_tests":
      return `Set ${input?.tests?.length || ""} autograder tests`;
    case "web_search":
      return `Searched "${input?.query || "web"}"`;
    case "save_memory":
      return "Saved to memory";
    default:
      return name;
  }
}

// Parse stored messages into display format with interleaved parts
function parseStoredMessages(messages: any[]): DisplayMessage[] {
  const display: DisplayMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // User messages can be string or content array
      if (typeof msg.content === "string") {
        display.push({
          id: `msg-${display.length}`,
          role: "user",
          text: msg.content,
        });
      } else if (Array.isArray(msg.content)) {
        // Check if it's a tool_result (skip those — they're internal)
        const hasToolResult = msg.content.some(
          (b: any) => b.type === "tool_result"
        );
        if (!hasToolResult) {
          const text = msg.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const images: ImageAttachment[] = msg.content
            .filter((b: any) => b.type === "image" && b.source?.type === "base64")
            .map((b: any) => ({
              data: b.source.data,
              media_type: b.source.media_type,
              preview: `data:${b.source.media_type};base64,${b.source.data}`,
            }));
          if (text || images.length > 0) {
            display.push({
              id: `msg-${display.length}`,
              role: "user",
              text: text || undefined,
              images: images.length > 0 ? images : undefined,
            });
          }
        }
      }
    } else if (msg.role === "assistant") {
      const contentBlocks: ChatContentBlock[] = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text", text: msg.content }];

      const parts: ContentPart[] = [];

      for (const block of contentBlocks) {
        if (block.type === "text" && block.text) {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            type: "tool",
            toolCall: {
              id: block.id || `tool-${parts.length}`,
              name: block.name || "unknown",
              input: block.input,
              status: "complete",
            },
          });
        }
      }

      if (parts.length > 0) {
        display.push({
          id: `msg-${display.length}`,
          role: "assistant",
          parts,
        });
      }
    }
  }

  return display;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  assignmentId,
  courseId,
  onBlockMutation,
  onClose,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingParts, setStreamingParts] = useState<ContentPart[]>([]);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const streamingPartsRef = useRef<ContentPart[]>([]);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingParts, scrollToBottom]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowSessionDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Helper: append text to the last text part or create a new one
  const appendStreamingText = (text: string) => {
    const parts = streamingPartsRef.current;
    const last = parts[parts.length - 1];
    if (last && last.type === "text") {
      last.text += text;
    } else {
      parts.push({ type: "text", text });
    }
    streamingPartsRef.current = [...parts];
    setStreamingParts(streamingPartsRef.current);
  };

  // Helper: add a tool call part
  const addStreamingToolCall = (tc: ToolCallDisplay) => {
    streamingPartsRef.current = [
      ...streamingPartsRef.current,
      { type: "tool", toolCall: tc },
    ];
    setStreamingParts(streamingPartsRef.current);
  };

  // Helper: update a tool call in streaming parts
  const updateStreamingToolCall = (
    toolId: string,
    updates: Partial<ToolCallDisplay>
  ) => {
    streamingPartsRef.current = streamingPartsRef.current.map((part) =>
      part.type === "tool" && part.toolCall.id === toolId
        ? { ...part, toolCall: { ...part.toolCall, ...updates } }
        : part
    );
    setStreamingParts([...streamingPartsRef.current]);
  };

  // Initialize socket connection
  useEffect(() => {
    const socket = io(`${getBaseURL()}/ai-chat`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socket.on("connect", () => {
      console.log("[AI Chat] WebSocket connected");
    });

    socket.on("chat-text", ({ text }: { text: string; sessionId: string }) => {
      appendStreamingText(text);
    });

    socket.on(
      "tool-call-start",
      ({
        toolName,
        toolInput,
        toolId,
      }: {
        toolName: string;
        toolInput: any;
        toolId: string;
        sessionId: string;
      }) => {
        addStreamingToolCall({
          id: toolId,
          name: toolName,
          input: toolInput,
          status: "running",
        });
      }
    );

    socket.on(
      "tool-call-complete",
      ({
        toolName,
        toolId,
        result,
        isError,
      }: {
        toolName: string;
        toolId: string;
        result: string;
        isError: boolean;
        sessionId: string;
      }) => {
        updateStreamingToolCall(toolId, {
          status: "complete",
          result,
          isError,
        });

        // Trigger block mutation refresh if it was a mutating tool
        if (
          [
            "create_block",
            "edit_block",
            "delete_block",
            "reorder_blocks",
            "write_ide_files",
          ].includes(toolName)
        ) {
          onBlockMutation?.();
        }
      }
    );

    socket.on("chat-complete", () => {
      const finalParts = [...streamingPartsRef.current];

      if (finalParts.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: "assistant" as const,
            parts: finalParts,
          },
        ]);
      }

      streamingPartsRef.current = [];
      setStreamingParts([]);
      setIsStreaming(false);
    });

    socket.on(
      "chat-error",
      ({ message }: { message: string; sessionId: string }) => {
        setError(message);
        setIsStreaming(false);
        streamingPartsRef.current = [];
        setStreamingParts([]);
      }
    );

    socket.on("block-mutation", () => {
      onBlockMutation?.();
    });

    socket.on("connect_error", (err) => {
      console.error("[AI Chat] Connection error:", err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [assignmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const res = await listChatSessions(assignmentId);
      const sessionList = res.data.sessions;
      setSessions(sessionList);

      if (sessionList.length > 0) {
        // Load most recent session
        await loadSession(sessionList[0].id);
      } else {
        // Create first session
        await handleNewChat();
      }
    } catch (err: any) {
      console.error("Failed to load sessions:", err);
      setError("Failed to load chat sessions");
    } finally {
      setIsLoading(false);
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await getChatSession(sessionId);
      const session = res.data.session;
      setActiveSessionId(session.id);
      setMessages(parseStoredMessages(session.messages || []));
      setStreamingParts([]);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load session:", err);
      setError("Failed to load session");
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await createChatSession(assignmentId);
      const newSession = res.data.session;
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);
      setStreamingParts([]);
      setShowSessionDropdown(false);
      setError(null);
    } catch (err: any) {
      console.error("Failed to create session:", err);
      setError("Failed to create new chat");
    }
  };

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      await deleteChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        if (remaining.length > 0) {
          await loadSession(remaining[0].id);
        } else {
          await handleNewChat();
        }
      }
    } catch (err: any) {
      console.error("Failed to delete session:", err);
    }
  };

  const handleSend = () => {
    if ((!inputValue.trim() && pendingImages.length === 0) || isStreaming || !activeSessionId) return;

    const userMessage = inputValue.trim() || (pendingImages.length > 0 ? "What do you see in this image?" : "");
    const imagesToSend = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInputValue("");
    setPendingImages([]);
    setError(null);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Add user message to display
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        role: "user",
        text: userMessage,
        images: imagesToSend,
      },
    ]);

    // Start streaming
    setIsStreaming(true);
    streamingPartsRef.current = [];
    setStreamingParts([]);

    // Send via WebSocket
    socketRef.current?.emit("send-message", {
      sessionId: activeSessionId,
      assignmentId,
      message: userMessage,
      images: imagesToSend?.map((img) => ({
        data: img.data,
        media_type: img.media_type,
      })),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 150) + "px";
  };

  // Convert a File to an ImageAttachment
  const fileToImageAttachment = (file: File): Promise<ImageAttachment | null> => {
    return new Promise((resolve) => {
      const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!validTypes.includes(file.type)) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        resolve({
          data: base64,
          media_type: file.type as ImageAttachment["media_type"],
          preview: dataUrl,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  // Handle paste events for images
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0) return;

    e.preventDefault();
    const attachments = await Promise.all(imageFiles.map(fileToImageAttachment));
    const valid = attachments.filter(Boolean) as ImageAttachment[];
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid]);
    }
  };

  // Handle file input change
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const attachments = await Promise.all(
      Array.from(files).map(fileToImageAttachment)
    );
    const valid = attachments.filter(Boolean) as ImageAttachment[];
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid]);
    }
    // Reset file input so same file can be re-selected
    e.target.value = "";
  };

  // Remove a pending image
  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Session Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted flex-shrink-0">
        <div className="relative flex-1" ref={dropdownRef}>
          <button
            onClick={() => setShowSessionDropdown(!showSessionDropdown)}
            className="flex items-center gap-1 text-sm text-foreground hover:text-foreground truncate max-w-full"
          >
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              {sessions.find((s) => s.id === activeSessionId)?.title ||
                `Chat ${sessions.findIndex((s) => s.id === activeSessionId) + 1}`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          </button>

          {showSessionDropdown && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-card border border-border rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
              {sessions.map((session, idx) => (
                <div
                  key={session.id}
                  className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent ${
                    session.id === activeSessionId ? "bg-primary/10" : ""
                  }`}
                  onClick={() => {
                    loadSession(session.id);
                    setShowSessionDropdown(false);
                  }}
                >
                  <span className="truncate flex-1">
                    {session.title || `Chat ${idx + 1}`}
                  </span>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    className="ml-2 p-1 text-muted-foreground hover:text-red-500 rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          className="h-7 px-2"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 w-7 p-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
            <p>Ask me to help build your assignment.</p>
            <p className="text-xs mt-1">
              I can create, edit, and organize blocks.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming state */}
        {isStreaming && (
          <div>
            <AssistantLabel />
            <div className="space-y-1.5">
              {streamingParts.length === 0 && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking...
                </div>
              )}

              {streamingParts.map((part, idx) => (
                <ContentPartRenderer key={idx} part={part} />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t flex-shrink-0">
        {/* Pending image previews */}
        {pendingImages.length > 0 && (
          <div className="px-3 pt-2 flex gap-2 flex-wrap">
            {pendingImages.map((img, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={img.preview}
                  alt={`Attachment ${idx + 1}`}
                  className="w-16 h-16 object-cover rounded-md border border-border"
                />
                <button
                  onClick={() => removePendingImage(idx)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-muted text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="p-3 flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="h-[38px] px-2 text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center"
            title="Attach image"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Describe what you want to create or change..."
            className="flex-1 resize-none border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent min-h-[38px] max-h-[150px]"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={(!inputValue.trim() && pendingImages.length === 0) || isStreaming}
            size="sm"
            className="h-[38px] px-3 bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Markdown prose classes shared between components
const PROSE_CLASSES =
  "text-sm text-foreground prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-1 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:text-foreground prose-pre:p-2 prose-pre:rounded-md";

// Render a single content part (text or tool call)
const ContentPartRenderer: React.FC<{ part: ContentPart }> = ({ part }) => {
  if (part.type === "text") {
    return (
      <div className={PROSE_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
      </div>
    );
  }
  return <ToolCallPill toolCall={part.toolCall} />;
};

// Assistant label with logo
const AssistantLabel: React.FC = () => (
  <div className="flex items-center gap-2 mb-1">
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0">
      <img
        src="/images/Classla-logo.png"
        alt="Classla"
        className="w-6 h-6 object-contain"
      />
    </div>
    <span className="text-md font-semibold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">
      Classla Assistant
    </span>
    <Sparkles className="w-4 h-4 text-purple-500" />
  </div>
);

// Message bubble component
const MessageBubble: React.FC<{ message: DisplayMessage }> = ({ message }) => {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-purple-600 text-white rounded-lg px-3 py-2 text-sm max-w-[85%]">
          {message.images && message.images.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {message.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img.preview}
                  alt={`Attachment ${idx + 1}`}
                  className="w-20 h-20 object-cover rounded-md border border-purple-400"
                />
              ))}
            </div>
          )}
          <span className="whitespace-pre-wrap">{message.text}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AssistantLabel />
      <div className="space-y-1.5">
        {message.parts?.map((part, idx) => (
          <ContentPartRenderer key={idx} part={part} />
        ))}
      </div>
    </div>
  );
};

// Tool call indicator pill
const ToolCallPill: React.FC<{ toolCall: ToolCallDisplay }> = ({
  toolCall,
}) => {
  const isRunning = toolCall.status === "running";
  const label = isRunning
    ? toolLabel(toolCall.name, toolCall.input)
    : toolCompleteLabel(toolCall.name, toolCall.input);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        toolCall.isError
          ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
          : isRunning
            ? "bg-primary/10 text-primary"
            : "bg-primary/10 text-primary"
      }`}
    >
      {isRunning ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : toolCall.isError ? (
        <AlertCircle className="w-3 h-3" />
      ) : (
        <Check className="w-3 h-3" />
      )}
      <Wrench className="w-3 h-3" />
      {label}
    </div>
  );
};

export default AIChatPanel;
