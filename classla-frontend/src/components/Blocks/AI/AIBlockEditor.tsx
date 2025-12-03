import React, { useCallback, useState, useEffect, useRef, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { AIBlockData } from "../../extensions/AIBlock";
import { Sparkles, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { useToast } from "../../../hooks/use-toast";
import { io, Socket } from "socket.io-client";
import { apiClient } from "../../../lib/api";
import { Assignment } from "../../../types";

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
    const textareaRef = useRef<HTMLDivElement>(null);
    const promptSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const nodeIdRef = useRef<string>(aiData.id);
    const isInitialMount = useRef(true);
    
    // @ mention state
    const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
    const [mentionStartIndex, setMentionStartIndex] = useState(-1);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [filteredAssignments, setFilteredAssignments] = useState<Assignment[]>([]);
    const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
    const [taggedAssignments, setTaggedAssignments] = useState<Map<string, Assignment>>(new Map());
    
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

    // Parse @ mentions from prompt - defined early to avoid hoisting issues
    // Note: We don't include taggedAssignments in deps to avoid infinite loops
    // Instead, we'll check both taggedAssignments and assignments when parsing
    const parseMentions = useCallback((text: string, currentTagged: Map<string, Assignment>, currentAssignments: Assignment[]): Array<{ start: number; end: number; name: string; assignment: Assignment | null }> => {
      const mentions: Array<{ start: number; end: number; name: string; assignment: Assignment | null }> = [];
      // Match @ followed by any characters until next @, newline, or end of text
      // We'll match the full text after @ and then try to find the best matching assignment
      const mentionRegex = /@([^@\n]+)/g;
      let match;

      while ((match = mentionRegex.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        const rawName = match[1].trim(); // Remove trailing whitespace
        
        if (!rawName) continue;
        
        // Try to find exact match first (for already inserted assignments)
        let assignment = Array.from(currentTagged.values()).find(
          a => a.name.toLowerCase() === rawName.toLowerCase()
        ) || currentAssignments.find(
          a => a.name.toLowerCase() === rawName.toLowerCase()
        ) || null;
        
        // If no exact match, check if any full assignment name appears after the @
        // This handles cases where user typed "@Python Lists Quiz" and we want to match the full name
        if (!assignment) {
          const textAfterAt = text.substring(start + 1);
          const allAssignments = [
            ...Array.from(currentTagged.values()),
            ...currentAssignments
          ];
          
          // Find assignment whose full name appears in the text after @
          for (const candidate of allAssignments) {
            const candidateLower = candidate.name.toLowerCase();
            if (textAfterAt.toLowerCase().startsWith(candidateLower)) {
              // Check if it's followed by whitespace, end of text, or another @
              const afterName = textAfterAt.substring(candidate.name.length);
              if (afterName.length === 0 || /^[\s@\n]/.test(afterName)) {
                assignment = candidate;
                break;
              }
            }
          }
        }

        // Only add mention if we found an assignment
        if (assignment) {
          // Use the full assignment name for the mention
          mentions.push({ 
            start, 
            end: start + 1 + assignment.name.length, // Extend to full assignment name
            name: assignment.name, 
            assignment 
          });
        }
      }

      return mentions;
    }, []);

    // Helper functions - defined early to avoid hoisting issues
    const escapeHtml = useCallback((text: string) => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }, []);
    
    const buildStyledHtml = useCallback((text: string, mentions: Array<{ start: number; end: number; name: string; assignment: Assignment | null }>) => {
      let html = "";
      let lastIndex = 0;
      
      mentions.forEach(mention => {
        if (mention.start > lastIndex) {
          html += escapeHtml(text.substring(lastIndex, mention.start));
        }
        html += `<span class="bg-purple-100 text-purple-700 font-medium px-1 rounded">@${escapeHtml(mention.name)}</span>`;
        lastIndex = mention.end;
      });
      
      if (lastIndex < text.length) {
        html += escapeHtml(text.substring(lastIndex));
      }
      
      return html || escapeHtml(text);
    }, [escapeHtml]);
    
    const getTextOffset = (container: Node | null, node: Node | null, offset: number): number => {
      if (!container || !node) return 0;
      
      try {
        let textOffset = 0;
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
          null
        );
        
        let currentNode;
        while (currentNode = walker.nextNode()) {
          if (currentNode === node) {
            return textOffset + offset;
          }
          textOffset += currentNode.textContent?.length || 0;
        }
        
        return textOffset;
      } catch (e) {
        // Fallback: just return the offset if tree walker fails
        return offset;
      }
    };
    
    const getTextNodes = (node: Node): Text[] => {
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let currentNode;
      while (currentNode = walker.nextNode()) {
        textNodes.push(currentNode as Text);
      }
      
      return textNodes;
    };

    // Auto-focus when block is created
    useEffect(() => {
      if (!prompt && !isGenerating && textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }
    }, []);
    
    // Update contentEditable div with styled mentions
    // This runs when prompt changes to update highlighting immediately
    useEffect(() => {
      if (!textareaRef.current) return;
      
      const div = textareaRef.current;
      const currentText = div.textContent || "";
      
      // Always update if prompt changed (even when focused, but with a small delay to avoid cursor issues)
      if (currentText !== prompt) {
        const mentions = parseMentions(prompt, taggedAssignments, assignments);
        if (mentions.length > 0) {
          const html = buildStyledHtml(prompt, mentions);
          const wasFocused = document.activeElement === div;
          const selection = window.getSelection();
          let savedCursorPos = 0;
          
          // Save cursor position if focused
          if (wasFocused && selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            savedCursorPos = getTextOffset(div, range.startContainer, range.startOffset);
          }
          
          div.innerHTML = html;
          
          // Restore cursor if it was focused
          if (wasFocused && savedCursorPos > 0) {
            setTimeout(() => {
              try {
                const textNodes = getTextNodes(div);
                let offset = 0;
                let found = false;
                
                for (const textNode of textNodes) {
                  const nodeLength = textNode.textContent?.length || 0;
                  if (offset + nodeLength >= savedCursorPos) {
                    const newRange = document.createRange();
                    newRange.setStart(textNode, savedCursorPos - offset);
                    newRange.collapse(true);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(newRange);
                    found = true;
                    break;
                  }
                  offset += nodeLength;
                }
                
                if (!found && textNodes.length > 0) {
                  const endRange = document.createRange();
                  endRange.selectNodeContents(div);
                  endRange.collapse(false);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(endRange);
                }
              } catch (e) {
                // Ignore cursor restoration errors
              }
            }, 0);
          }
        } else {
          // No mentions, just set plain text
          div.textContent = prompt;
        }
      } else {
        // Text matches, but check if styling needs updating
        const mentions = parseMentions(prompt, taggedAssignments, assignments);
        if (mentions.length > 0) {
          const html = buildStyledHtml(prompt, mentions);
          if (div.innerHTML !== html) {
            div.innerHTML = html;
          }
        } else if (div.innerHTML.includes('bg-purple-100')) {
          // Had mentions before but not anymore, remove styling
          div.textContent = prompt;
        }
      }
    }, [prompt, taggedAssignments, assignments, parseMentions, buildStyledHtml, getTextOffset, getTextNodes]);

    // Fetch assignments for the course
    useEffect(() => {
      const fetchAssignments = async () => {
        try {
          // Get assignment ID from extension options
          const assignmentId = (editor.extensionManager.extensions.find(
            (ext: any) => ext.name === "aiBlock"
          )?.options?.assignmentId as string) || "";

          if (!assignmentId) return;

          // Get current assignment to get course_id
          const currentAssignment = await apiClient.getAssignment(assignmentId);
          const courseId = currentAssignment.data.course_id;

          // Fetch all assignments for the course
          const response = await apiClient.getCourseAssignments(courseId);
          const allAssignments = response.data as Assignment[];
          
          // Filter out the current assignment
          const otherAssignments = allAssignments.filter(a => a.id !== assignmentId);
          setAssignments(otherAssignments);
        } catch (error) {
          console.error("Failed to fetch assignments:", error);
        }
      };

      fetchAssignments();
    }, [editor]);

    // Auto-detect mentions when prompt changes
    // Note: We use a ref to access current taggedAssignments to avoid infinite loops
    const taggedAssignmentsRef = useRef(taggedAssignments);
    useEffect(() => {
      taggedAssignmentsRef.current = taggedAssignments;
    }, [taggedAssignments]);

    useEffect(() => {
      if (prompt && assignments.length > 0) {
        const mentions = parseMentions(prompt, taggedAssignmentsRef.current, assignments);
        const newTagged = new Map<string, Assignment>();
        mentions.forEach(m => {
          if (m.assignment) {
            newTagged.set(m.assignment.id, m.assignment);
          }
        });
        
        // Only update if the tagged assignments actually changed
        const currentIds = Array.from(taggedAssignmentsRef.current.keys()).sort().join(',');
        const newIds = Array.from(newTagged.keys()).sort().join(',');
        if (currentIds !== newIds) {
          setTaggedAssignments(newTagged);
        }
      }
    }, [prompt, assignments, parseMentions]);

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
        
        // Scroll to the newly inserted generating block
        setTimeout(() => {
          try {
            const generatingBlock = findGeneratingBlock(blockIndex);
            if (generatingBlock) {
              const dom = editor.view.nodeDOM(generatingBlock.pos);
              if (dom && dom instanceof HTMLElement) {
                dom.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }
          } catch (err) {
            // Ignore scroll errors
          }
        }, 100);
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
      
      // Mark block as completed
      const blockInfo = blocksRef.current.get(blockIndex);
      if (blockInfo) {
        blocksRef.current.set(blockIndex, { ...blockInfo, completed: true, block });
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
        
        // Check if we have any completed blocks
        const hasCompletedBlocks = Array.from(blocksRef.current.values()).some(b => b.completed);
        
        // For parse errors at the end, just clean up silently if we have some blocks
        if (data.code === "PARSE_ERROR" && hasCompletedBlocks) {
          // Clean up any remaining placeholders
          cleanupPlaceholders();
          
          // Delete the AI block
          try {
            deleteNode();
          } catch (err) {
            console.error("Error removing AI block:", err);
          }
          
          // Reset state silently
          setIsGenerating(false);
          blocksRef.current.clear();
          nextInsertIndexRef.current = 0;
          requestIdRef.current = null;
          assignmentIdRef.current = null;
          return;
        }
        
        // For other errors, show error but don't show toast
        cleanupPlaceholders();
        
        setIsGenerating(false);
        setError(data.message);
        
        // Don't show toast - just set error state
        // User can see the error in the UI if needed
        
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

      // Extract tagged assignment IDs
      const taggedAssignmentIds = Array.from(taggedAssignments.keys());

      // Emit generate event with tagged assignments
      socketRef.current.emit("generate", {
        prompt: prompt.trim(),
        assignmentId,
        requestId,
        taggedAssignmentIds,
      });
    }, [prompt, isGenerating, editor, taggedAssignments]);

    // Handle @ mention detection
    const handleMentionDetection = useCallback((text: string, cursorPos: number) => {
      // Find @ before cursor
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");
      
      if (lastAtIndex === -1) {
        setShowMentionSuggestions(false);
        return;
      }

      // Get text after @ - allow spaces for multi-word assignment names
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      
      // Check if there's a newline after @ (but allow spaces)
      if (textAfterAt.includes("\n")) {
        setShowMentionSuggestions(false);
        return;
      }

      // Get query after @ (trim to remove any trailing spaces, but keep for matching)
      const query = textAfterAt.toLowerCase().trim();
      setMentionQuery(query);
      setMentionStartIndex(lastAtIndex);

      // Filter assignments - match if assignment name starts with the query (not just contains)
      // This prevents matching "Python Lists Quiz" when typing "@P"
      const filtered = assignments.filter(a => 
        a.name.toLowerCase().startsWith(query) && 
        !Array.from(taggedAssignments.values()).some(ta => ta.id === a.id)
      );
      setFilteredAssignments(filtered);
      setSelectedMentionIndex(0);

      if (filtered.length > 0) {
        // Calculate position for dropdown using actual cursor position
        if (textareaRef.current) {
          const div = textareaRef.current;
          const selection = window.getSelection();
          
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            
            // Create a temporary range to get the exact position
            try {
              const tempRange = range.cloneRange();
              tempRange.collapse(true); // Collapse to start
              
              const rect = tempRange.getBoundingClientRect();
              
              // Use fixed positioning - getBoundingClientRect already gives viewport coordinates
              setMentionPosition({
                top: rect.bottom + 5,
                left: rect.left,
              });
            } catch (e) {
              // Fallback to bottom of div
              const rect = div.getBoundingClientRect();
              setMentionPosition({
                top: rect.bottom + 5,
                left: rect.left,
              });
            }
          } else {
            // Fallback to bottom of div
            const rect = div.getBoundingClientRect();
            setMentionPosition({
              top: rect.bottom + 5,
              left: rect.left,
            });
          }
        }
        setShowMentionSuggestions(true);
      } else {
        setShowMentionSuggestions(false);
      }
    }, [assignments, taggedAssignments]);

    const handlePromptChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        const newPrompt = e.target.value;
        setPrompt(newPrompt);
        setError(null);

        // Handle @ mention detection
        const cursorPos = e.target.selectionStart || 0;
        handleMentionDetection(newPrompt, cursorPos);

                    // Parse and update tagged assignments - only tag if exact match
                    const mentions = parseMentions(newPrompt, taggedAssignments, assignments);
                    const newTagged = new Map<string, Assignment>();
                    mentions.forEach(m => {
                      // Only tag if it's an exact match (full assignment name)
                      if (m.assignment && m.name === m.assignment.name) {
                        newTagged.set(m.assignment.id, m.assignment);
                      }
                    });
                    setTaggedAssignments(newTagged);
      },
      [handleMentionDetection, parseMentions]
    );

    // Insert @ mention - defined before handleKeyDown to avoid hoisting issues
    const insertMention = useCallback((assignment: Assignment) => {
      if (mentionStartIndex === -1 || !textareaRef.current) return;

      const div = textareaRef.current;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      
      // Find the @ symbol and the text after it
      const textBefore = prompt.substring(0, mentionStartIndex);
      // Get the actual text that was typed after @ (may include spaces)
      const textAfterAt = prompt.substring(mentionStartIndex + 1);
      const spaceIndex = textAfterAt.search(/\s/);
      const queryLength = spaceIndex === -1 ? textAfterAt.length : spaceIndex;
      const textAfter = prompt.substring(mentionStartIndex + 1 + queryLength);
      
      const newPrompt = `${textBefore}@${assignment.name} ${textAfter}`;
      
      // Update the contentEditable div
      const mentions = parseMentions(newPrompt, taggedAssignments, assignments);
      const html = buildStyledHtml(newPrompt, mentions);
      
      // Save cursor position before updating
      const cursorOffset = textBefore.length + assignment.name.length + 2; // +2 for @ and space
      
      div.innerHTML = html;
      setPrompt(newPrompt);
      setShowMentionSuggestions(false);
      setTaggedAssignments(prev => new Map(prev).set(assignment.id, assignment));
      
      // Restore cursor position after a short delay
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          
          // Find the text node and set cursor position
          const textNodes = getTextNodes(textareaRef.current);
          let offset = 0;
          let found = false;
          
          for (const textNode of textNodes) {
            const nodeLength = textNode.textContent?.length || 0;
            if (offset + nodeLength >= cursorOffset) {
              const newRange = document.createRange();
              newRange.setStart(textNode, cursorOffset - offset);
              newRange.collapse(true);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(newRange);
              found = true;
              break;
            }
            offset += nodeLength;
          }
          
          if (!found && textNodes.length > 0) {
            // Fallback to end
            const lastNode = textNodes[textNodes.length - 1];
            const newRange = document.createRange();
            newRange.selectNodeContents(lastNode);
            newRange.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(newRange);
          }
        }
      }, 10);
    }, [prompt, mentionStartIndex, mentionQuery, parseMentions, buildStyledHtml, getTextNodes, taggedAssignments, assignments]);

    // Handle keyboard navigation in mention suggestions
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation();
        
        if (showMentionSuggestions && filteredAssignments.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedMentionIndex(prev => 
              prev < filteredAssignments.length - 1 ? prev + 1 : prev
            );
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedMentionIndex(prev => prev > 0 ? prev - 1 : 0);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const selected = filteredAssignments[selectedMentionIndex];
            if (selected) {
              insertMention(selected);
            }
            return;
          }
          if (e.key === "Escape") {
            setShowMentionSuggestions(false);
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey && !isGenerating && !showMentionSuggestions) {
          e.preventDefault();
          handleGenerate();
        }
      },
      [showMentionSuggestions, filteredAssignments, selectedMentionIndex, isGenerating, handleGenerate, insertMention]
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
            <div className="space-y-2 relative">
              {/* Prompt input with styled mentions */}
              <div className="relative">
                <div
                  ref={textareaRef as any}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => {
                    const div = e.currentTarget;
                    const newPrompt = div.textContent || "";
                    setPrompt(newPrompt);
                    setError(null);
                    
                    // Handle @ mention detection - get actual cursor position
                    const selection = window.getSelection();
                    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                    const cursorPos = range ? getTextOffset(div, range.startContainer, range.startOffset) : newPrompt.length;
                    handleMentionDetection(newPrompt, cursorPos);
                    
                    // Parse and update tagged assignments - only tag if exact match
                    const mentions = parseMentions(newPrompt, taggedAssignments, assignments);
                    const newTagged = new Map<string, Assignment>();
                    mentions.forEach(m => {
                      // Only tag if it's an exact match (full assignment name)
                      if (m.assignment && m.name === m.assignment.name) {
                        newTagged.set(m.assignment.id, m.assignment);
                      }
                    });
                    setTaggedAssignments(newTagged);
                    
                    // Immediately update styling to reflect changes (removed tags, etc.)
                    const currentMentions = parseMentions(newPrompt, newTagged, assignments);
                    const sel = window.getSelection();
                    
                    // Save cursor position before updating
                    let savedCursorPos = 0;
                    if (sel && sel.rangeCount > 0) {
                      const savedRange = sel.getRangeAt(0);
                      savedCursorPos = getTextOffset(div, savedRange.startContainer, savedRange.startOffset);
                    }
                    
                    if (currentMentions.length > 0) {
                      const html = buildStyledHtml(newPrompt, currentMentions);
                      if (div.innerHTML !== html) {
                        div.innerHTML = html;
                      }
                    } else {
                      // No mentions, remove styling if it exists
                      if (div.innerHTML.includes('bg-purple-100')) {
                        div.textContent = newPrompt;
                      }
                    }
                    
                    // Restore cursor position
                    if (savedCursorPos > 0) {
                      setTimeout(() => {
                        try {
                          const textNodes = getTextNodes(div);
                          let offset = 0;
                          let found = false;
                          
                          for (const textNode of textNodes) {
                            const nodeLength = textNode.textContent?.length || 0;
                            if (offset + nodeLength >= savedCursorPos) {
                              const newRange = document.createRange();
                              newRange.setStart(textNode, savedCursorPos - offset);
                              newRange.collapse(true);
                              const newSel = window.getSelection();
                              newSel?.removeAllRanges();
                              newSel?.addRange(newRange);
                              found = true;
                              break;
                            }
                            offset += nodeLength;
                          }
                          
                          if (!found && textNodes.length > 0) {
                            // Fallback to end
                            const endRange = document.createRange();
                            endRange.selectNodeContents(div);
                            endRange.collapse(false);
                            const newSel = window.getSelection();
                            newSel?.removeAllRanges();
                            newSel?.addRange(endRange);
                          }
                        } catch (e) {
                          // Ignore cursor restoration errors
                        }
                      }, 0);
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    handleKeyDown(e as any);
                  }}
                onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTimeout(() => {
                      const div = e.currentTarget;
                      const selection = window.getSelection();
                      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                      const cursorPos = range ? getTextOffset(div, range.startContainer, range.startOffset) : prompt.length;
                      handleMentionDetection(prompt, cursorPos);
                    }, 0);
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setTimeout(() => {
                      const div = e.currentTarget;
                      const selection = window.getSelection();
                      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                      const cursorPos = range ? getTextOffset(div, range.startContainer, range.startOffset) : prompt.length;
                      handleMentionDetection(prompt, cursorPos);
                    }, 0);
                  }}
                  onPaste={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const div = e.currentTarget;
                    if (!div) return;
                    
                    const text = e.clipboardData.getData("text/plain");
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                      const range = selection.getRangeAt(0);
                      range.deleteContents();
                      range.insertNode(document.createTextNode(text));
                      range.collapse(false);
                      selection.removeAllRanges();
                      selection.addRange(range);
                      
                      // Update prompt and detect mentions
                      setTimeout(() => {
                        if (!textareaRef.current) return;
                        
                        const newPrompt = textareaRef.current.textContent || "";
                        setPrompt(newPrompt);
                        
                        // Parse mentions and tag exact matches
                        const mentions = parseMentions(newPrompt, taggedAssignments, assignments);
                        const newTagged = new Map(taggedAssignments);
                        mentions.forEach(m => {
                          // Tag if it's an exact match (full assignment name)
                          if (m.assignment && m.name === m.assignment.name) {
                            newTagged.set(m.assignment.id, m.assignment);
                          }
                        });
                        setTaggedAssignments(newTagged);
                        
                        // Update styling immediately to show highlighted mentions
                        const currentMentions = parseMentions(newPrompt, newTagged, assignments);
                        const sel = window.getSelection();
                        
                        // Save cursor position
                        let savedCursorPos = 0;
                        if (sel && sel.rangeCount > 0) {
                          const savedRange = sel.getRangeAt(0);
                          savedCursorPos = getTextOffset(textareaRef.current, savedRange.startContainer, savedRange.startOffset);
                        }
                        
                        if (currentMentions.length > 0) {
                          const html = buildStyledHtml(newPrompt, currentMentions);
                          textareaRef.current.innerHTML = html;
                        } else {
                          textareaRef.current.textContent = newPrompt;
                        }
                        
                        // Restore cursor position
                        if (savedCursorPos > 0) {
                          setTimeout(() => {
                            if (textareaRef.current) {
                              try {
                                const textNodes = getTextNodes(textareaRef.current);
                                let offset = 0;
                                let found = false;
                                
                                for (const textNode of textNodes) {
                                  const nodeLength = textNode.textContent?.length || 0;
                                  if (offset + nodeLength >= savedCursorPos) {
                                    const newRange = document.createRange();
                                    newRange.setStart(textNode, savedCursorPos - offset);
                                    newRange.collapse(true);
                                    const newSel = window.getSelection();
                                    newSel?.removeAllRanges();
                                    newSel?.addRange(newRange);
                                    found = true;
                                    break;
                                  }
                                  offset += nodeLength;
                                }
                                
                                if (!found && textNodes.length > 0) {
                                  const endRange = document.createRange();
                                  endRange.selectNodeContents(textareaRef.current);
                                  endRange.collapse(false);
                                  const newSel = window.getSelection();
                                  newSel?.removeAllRanges();
                                  newSel?.addRange(endRange);
                                }
                              } catch (e) {
                                // Ignore cursor restoration errors
                              }
                            }
                          }, 0);
                        }
                        
                        // Check for @ mention detection at cursor
                        const newSel = window.getSelection();
                        const newRange = newSel?.rangeCount ? newSel.getRangeAt(0) : null;
                        const newCursorPos = newRange ? getTextOffset(textareaRef.current, newRange.startContainer, newRange.startOffset) : newPrompt.length;
                        handleMentionDetection(newPrompt, newCursorPos);
                      }, 0);
                    }
                  }}
                  className="min-h-[80px] w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-y-auto"
                  style={{
                    whiteSpace: "pre-wrap",
                    wordWrap: "break-word",
                  }}
                  data-placeholder="Ask AI to generate content... (e.g., 'Create a quiz on python lists for me'). Use @ to tag other assignments."
                />
                {/* Render styled content */}
                {prompt && (() => {
                  const mentions = parseMentions(prompt, taggedAssignments, assignments);
                  if (mentions.length > 0 && textareaRef.current) {
                    const div = textareaRef.current as HTMLElement;
                    const parts: React.ReactNode[] = [];
                    let lastIndex = 0;
                    
                    mentions.forEach(mention => {
                      if (mention.start > lastIndex) {
                        parts.push(
                          <span key={`text-${lastIndex}`}>
                            {prompt.substring(lastIndex, mention.start)}
                          </span>
                        );
                      }
                      parts.push(
                        <span
                          key={`mention-${mention.start}`}
                          className="bg-purple-100 text-purple-700 font-medium px-1 rounded"
                        >
                          @{mention.name}
                        </span>
                      );
                      lastIndex = mention.end;
                    });
                    
                    if (lastIndex < prompt.length) {
                      parts.push(
                        <span key={`text-${lastIndex}`}>
                          {prompt.substring(lastIndex)}
                        </span>
                      );
                    }
                    
                    // Update the content
                    setTimeout(() => {
                      if (div && document.activeElement !== div) {
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(div);
                        range.collapse(false);
                        selection?.removeAllRanges();
                        selection?.addRange(range);
                      }
                    }, 0);
                  }
                  return null;
                })()}
              </div>
              
              {/* Mention suggestions dropdown */}
              {showMentionSuggestions && filteredAssignments.length > 0 && (
                <div
                  className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto"
                  style={{
                    top: `${mentionPosition.top}px`,
                    left: `${mentionPosition.left}px`,
                  }}
                >
                  {filteredAssignments.map((assignment, index) => (
                    <button
                      key={assignment.id}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                        index === selectedMentionIndex ? "bg-purple-50" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMention(assignment);
                      }}
                      onMouseEnter={() => setSelectedMentionIndex(index)}
                    >
                      <div className="font-medium text-gray-900">{assignment.name}</div>
                    </button>
                  ))}
                </div>
              )}
              
              
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
