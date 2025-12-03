import React, { useCallback, useState, useEffect, useRef, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { AIBlockData } from "../../extensions/AIBlock";
import { Sparkles, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { useToast } from "../../../hooks/use-toast";
import { io, Socket } from "socket.io-client";

interface AIBlockEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
  editor: any;
  getPos: () => number;
}

// Get base URL for WebSocket
const getBaseURL = () => {
  const apiUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";
  return apiUrl.replace(/\/api$/, "") || "http://localhost:3001";
};

const AIBlockEditor: React.FC<AIBlockEditorProps> = memo(
  ({ node, updateAttributes, deleteNode, editor, getPos }) => {
    const aiData = node.attrs.aiData as AIBlockData;
    const { toast } = useToast();
    const [prompt, setPrompt] = useState(aiData.prompt || "");
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const promptSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const nodeIdRef = useRef<string>(aiData.id);
    const isInitialMount = useRef(true);
    
    // WebSocket state
    const socketRef = useRef<Socket | null>(null);
    const requestIdRef = useRef<string | null>(null);
    const assignmentIdRef = useRef<string | null>(null);
    
    // Track blocks: blockIndex -> { inserted: boolean, completed: boolean, block?: any }
    const blocksRef = useRef<Map<number, { inserted: boolean; completed: boolean; block?: any }>>(new Map());
    // Track the expected next block index for insertion
    const nextInsertIndexRef = useRef<number>(0);

    // Sync prompt from node attributes
    useEffect(() => {
      if (isInitialMount.current) {
        setPrompt(aiData.prompt || "");
        isInitialMount.current = false;
        nodeIdRef.current = aiData.id;
        return;
      }

      if (aiData.id !== nodeIdRef.current) {
        setPrompt(aiData.prompt || "");
        nodeIdRef.current = aiData.id;
      }
    }, [aiData.id, aiData.prompt]);

    // Auto-focus when block is created
    useEffect(() => {
      if (!prompt && !isGenerating && textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }
    }, []);

    // Debounced update of prompt to node attributes
    useEffect(() => {
      if (promptSaveTimeoutRef.current) {
        clearTimeout(promptSaveTimeoutRef.current);
      }

      if (prompt !== aiData.prompt && !isGenerating) {
        promptSaveTimeoutRef.current = setTimeout(() => {
          updateAttributes({
            aiData: { ...aiData, prompt, isGenerating },
          });
        }, 500);
      }

      return () => {
        if (promptSaveTimeoutRef.current) {
          if (prompt !== aiData.prompt && !isGenerating) {
            updateAttributes({
              aiData: { ...aiData, prompt, isGenerating },
            });
          }
          clearTimeout(promptSaveTimeoutRef.current);
        }
      };
    }, [prompt, aiData, isGenerating, updateAttributes]);

    // Get friendly block type name
    const getBlockTypeName = (type: string) => {
      switch (type) {
        case "mcqBlock": return "MCQ";
        case "paragraph": return "paragraph";
        case "heading": return "heading";
        case "codeBlock": return "code block";
        case "bulletList": return "bullet list";
        case "orderedList": return "ordered list";
        case "blockquote": return "blockquote";
        case "horizontalRule": return "divider";
        default: return type;
      }
    };

    // Calculate insert position: after AI block + all previously inserted content
    const getInsertPosition = (): number | null => {
      const pos = getPos();
      if (pos === undefined) return null;
      
      const aiBlockNode = editor.state.doc.nodeAt(pos);
      if (!aiBlockNode) return null;

      // Start after the AI block
      let insertPos = pos + aiBlockNode.nodeSize;

      // Add sizes of all blocks we've inserted so far
      for (let i = 0; i < nextInsertIndexRef.current; i++) {
        const blockInfo = blocksRef.current.get(i);
        if (blockInfo?.inserted) {
          // Estimate size: if completed, use actual block, else use placeholder size
          if (blockInfo.completed && blockInfo.block) {
            try {
              const node = editor.schema.nodeFromJSON(blockInfo.block);
              insertPos += node.nodeSize;
            } catch {
              insertPos += 4; // Fallback
            }
          } else {
            insertPos += 4; // Placeholder paragraph approximate size
          }
        }
      }

      return insertPos;
    };

    // Find generating block by blockIndex
    const findGeneratingBlock = (blockIndex: number): { pos: number; node: any } | null => {
      const aiPos = getPos();
      if (aiPos === undefined) return null;
      
      const aiBlockNode = editor.state.doc.nodeAt(aiPos);
      if (!aiBlockNode) return null;

      const searchStart = aiPos + aiBlockNode.nodeSize;
      let result: { pos: number; node: any } | null = null;

      editor.state.doc.nodesBetween(searchStart, editor.state.doc.content.size, (node: any, pos: number) => {
        if (result) return false;
        if (node.type.name === "generatingBlock" && node.attrs.blockIndex === blockIndex) {
          result = { pos, node };
          return false;
        }
      });

      return result;
    };

    // Insert a placeholder for a new block
    const insertPlaceholder = (blockIndex: number, blockType: string) => {
      // Only insert in order
      if (blockIndex !== nextInsertIndexRef.current) {
        console.warn(`Expected blockIndex ${nextInsertIndexRef.current}, got ${blockIndex}`);
        return;
      }

      const insertPos = getInsertPosition();
      if (insertPos === null) return;

      try {
        const tr = editor.state.tr;
        // Use nodeFromJSON to create the generating block
        const placeholderNode = editor.schema.nodeFromJSON({
          type: "generatingBlock",
          attrs: {
            blockType,
            blockIndex,
          },
        });
        tr.insert(insertPos, placeholderNode);
        editor.view.dispatch(tr);
        
        // Track this block
        blocksRef.current.set(blockIndex, { inserted: true, completed: false });
        nextInsertIndexRef.current = blockIndex + 1;
      } catch (err) {
        console.error("Error inserting placeholder:", err);
      }
    };

    // Replace a placeholder with the actual block
    const replacePlaceholder = (blockIndex: number, block: any) => {
      const placeholder = findGeneratingBlock(blockIndex);
      if (!placeholder) {
        console.warn(`Generating block for blockIndex ${blockIndex} not found`);
        return;
      }

      try {
        const tr = editor.state.tr;
        const blockNode = editor.schema.nodeFromJSON(block);
        
        tr.replaceWith(placeholder.pos, placeholder.pos + placeholder.node.nodeSize, blockNode);
        editor.view.dispatch(tr);
        
        // Mark as completed
        const info = blocksRef.current.get(blockIndex);
        if (info) {
          info.completed = true;
          info.block = block;
        }
      } catch (err) {
        console.error("Error replacing placeholder:", err);
      }
    };

    // Clean up any remaining generating blocks
    const cleanupPlaceholders = () => {
      const nodesToDelete: { pos: number; size: number }[] = [];
      
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === "generatingBlock") {
          nodesToDelete.push({ pos, size: node.nodeSize });
        }
      });

      if (nodesToDelete.length > 0) {
        const tr = editor.state.tr;
        // Delete in reverse order to maintain positions
        for (let i = nodesToDelete.length - 1; i >= 0; i--) {
          const { pos, size } = nodesToDelete[i];
          tr.delete(pos, pos + size);
        }
        editor.view.dispatch(tr);
      }
    };

    // Initialize WebSocket connection
    useEffect(() => {
      const socket = io(`${getBaseURL()}/ai`, {
        transports: ["websocket", "polling"],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on("connect", () => {
        console.log("AI WebSocket connected");
      });

      socket.on("connect_error", (err) => {
        console.error("AI WebSocket connection error:", err);
      });

      // Handle block-start: Insert placeholder in the editor
      socket.on("block-start", (data: { blockIndex: number; blockType: string; requestId: string; assignmentId: string }) => {
        if (data.requestId !== requestIdRef.current) return;
        if (data.assignmentId !== assignmentIdRef.current) return; // Verify assignment ID
        insertPlaceholder(data.blockIndex, data.blockType);
      });

      // Handle block-complete: Replace placeholder with actual block
      socket.on("block-complete", (data: { blockIndex: number; block: any; requestId: string; assignmentId: string }) => {
        if (data.requestId !== requestIdRef.current) return;
        if (data.assignmentId !== assignmentIdRef.current) return; // Verify assignment ID
        replacePlaceholder(data.blockIndex, data.block);
      });

      // Handle generation-complete: Clean up and remove AI block
      socket.on("generation-complete", (data: { success: boolean; requestId: string; assignmentId: string }) => {
        if (data.requestId !== requestIdRef.current) return;
        if (data.assignmentId !== assignmentIdRef.current) return; // Verify assignment ID
        
        // Clean up any remaining placeholders
        cleanupPlaceholders();
        
        // Delete the AI block
        try {
          deleteNode();
        } catch (err) {
          console.error("Error removing AI block:", err);
        }
        
        toast({
          title: "Content generated",
          description: "AI has generated and inserted the content.",
        });
        
        // Reset state
        setIsGenerating(false);
        blocksRef.current.clear();
        nextInsertIndexRef.current = 0;
        requestIdRef.current = null;
        assignmentIdRef.current = null;
      });

      // Handle stream error
      socket.on("stream-error", (data: { message: string; code?: string; requestId: string; assignmentId: string }) => {
        if (data.requestId !== requestIdRef.current) return;
        if (data.assignmentId !== assignmentIdRef.current) return; // Verify assignment ID
        
        // Clean up any placeholders
        cleanupPlaceholders();
        
        setIsGenerating(false);
        setError(data.message);
        
        toast({
          title: "Generation failed",
          description: data.message,
          variant: "destructive",
        });
        
        blocksRef.current.clear();
        nextInsertIndexRef.current = 0;
        requestIdRef.current = null;
        assignmentIdRef.current = null;
      });

      socketRef.current = socket;

      return () => {
        socket.close();
      };
    }, [editor, getPos, deleteNode, toast]);

    const handleGenerate = useCallback(() => {
      if (!prompt.trim()) {
        setError("Please enter a prompt");
        return;
      }

      if (isGenerating || !socketRef.current?.connected) {
        if (!socketRef.current?.connected) {
          setError("Not connected to server. Please wait...");
        }
        return;
      }

      // Get assignment ID from extension options
      const assignmentId = (editor.extensionManager.extensions.find(
        (ext: any) => ext.name === "aiBlock"
      )?.options?.assignmentId as string) || "";

      if (!assignmentId) {
        setError("Assignment ID not available");
        return;
      }

      // Generate unique request ID
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      requestIdRef.current = requestId;
      assignmentIdRef.current = assignmentId;
      blocksRef.current.clear();
      nextInsertIndexRef.current = 0;
      
      setIsGenerating(true);
      setError(null);

      // Emit generate event
      socketRef.current.emit("generate", {
        prompt: prompt.trim(),
        assignmentId,
        requestId,
      });
    }, [prompt, isGenerating, editor]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey && !isGenerating) {
          e.preventDefault();
          handleGenerate();
        }
      },
      [handleGenerate, isGenerating]
    );

    const handlePromptChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        setPrompt(e.target.value);
        setError(null);
      },
      []
    );

    return (
      <NodeViewWrapper
        className="ai-block-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        {isGenerating ? (
          // Compact generating state
          <div
            className="ai-block-editor-compact flex items-center justify-center py-2 px-4 bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200 rounded-lg"
            role="group"
            aria-label="AI generating"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <span className="text-sm font-medium text-gray-700 animate-pulse">
                Classla AI Generating...
              </span>
            </div>
          </div>
        ) : (
          // Full input state
          <div
            className="ai-block-editor border border-gray-200 rounded-lg p-4 bg-gradient-to-br from-blue-50 to-purple-50 shadow-sm"
            role="group"
            aria-label="AI content generation block"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Generate with AI
                  </div>
                  <div className="text-xs text-gray-500">
                    Ask AI to create assignment content
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-gray-600 hover:text-red-600 hover:bg-red-50"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Input area */}
            <div className="space-y-2">
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={handlePromptChange}
                onKeyDown={handleKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                placeholder="Ask AI to generate content... (e.g., 'Create a quiz on python lists for me')"
                className="min-h-[80px] resize-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  Press Enter to generate, Shift+Enter for new line
                </p>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGenerate();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!prompt.trim()}
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate
                </Button>
              </div>
            </div>
          </div>
        )}
      </NodeViewWrapper>
    );
  }
);

AIBlockEditor.displayName = "AIBlockEditor";

export default AIBlockEditor;
