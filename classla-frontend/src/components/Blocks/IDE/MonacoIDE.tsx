import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Editor from "@monaco-editor/react";
import { Terminal as TerminalIcon, ChevronRight, ChevronLeft, RefreshCw, Monitor, Play, Loader2, Files, Power, ExternalLink, PanelLeft } from "lucide-react";
import FileExplorer, { FileNode } from "./FileExplorer";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../ui/button";
import { yjsProvider } from "../../../lib/yjsProvider";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as monaco from "monaco-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
// Custom resize implementation - no Allotment needed

// Generate a unique client ID for this IDE instance
// CRITICAL: Each MonacoIDE component instance needs a unique ID (side panel + main view = 2 instances)
const generateClientId = () => {
  // Use crypto.randomUUID if available, fallback to timestamp + random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `monaco-${crypto.randomUUID()}`;
  }
  // Fallback: timestamp + high-precision random + performance.now for uniqueness
  return `monaco-${Date.now()}-${performance.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 9)}`;
};

// Quick hash function for content comparison (used for echo detection)
const quickHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
};

interface MonacoIDEProps {
  bucketId: string | null;
  containerId: string | null;
  containerTerminalUrl?: string;
  containerVncUrl?: string;
  containerWebServerUrl?: string;
  ideApiBaseUrl: string;
  onRun?: () => void;
  runFilename?: string;
  onFilenameChange?: (filename: string) => void;
  isStarting?: boolean;
  onRefreshInstance?: () => void;
  onToggleDesktop?: () => void;
  showDesktop?: boolean;
  onContainerKilled?: () => void;
  layoutMode?: 'normal' | 'side-panel';
  onOpenSidePanel?: () => void;
  onOpenFullscreen?: () => void;
  showPanelButtons?: boolean;
}

const MonacoIDE: React.FC<MonacoIDEProps> = ({
  bucketId,
  containerId,
  containerTerminalUrl,
  containerVncUrl,
  containerWebServerUrl,
  ideApiBaseUrl,
  onRun,
  runFilename = "main.py",
  onFilenameChange,
  isStarting = false,
  onRefreshInstance,
  onToggleDesktop,
  showDesktop = false,
  onContainerKilled,
  layoutMode = 'normal',
  onOpenSidePanel,
  onOpenFullscreen,
  showPanelButtons = false,
}) => {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]); // Track open tabs
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set()); // Track which files are loading
  const [activePanel, setActivePanel] = useState<"files" | null>("files");
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({}); // Track save status per file
  const editorRef = useRef<any>(null);
  const editorReadyRef = useRef<boolean>(false); // Track if editor is mounted and ready
  const yjsBindingsRef = useRef<Record<string, { dispose: () => void }>>({}); // Track Y.js bindings per file
  const yjsDocsRef = useRef<Record<string, { doc: Y.Doc; ytext: Y.Text; awareness: Awareness }>>({}); // Track Y.js documents
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalSplitRef = useRef<HTMLDivElement>(null); // Ref for terminal/VNC split container
  const pendingSavesRef = useRef<Set<string>>(new Set()); // Track files with pending saves
  const selectedFileRef = useRef<string | null>(null); // Track selected file in ref for binding checks
  const containerHealthCheckRef = useRef<NodeJS.Timeout | null>(null); // Track health check interval
  const disconnectionDetectedRef = useRef<boolean>(false); // Track if disconnection was already detected
  const clientIdRef = useRef<string>(generateClientId()); // Unique client ID for this IDE instance
  const lastMonacoChangeRef = useRef<{ filePath: string; content: string; timestamp: number } | null>(null); // Track last change from Monaco
  const recentMonacoChangesRef = useRef<Array<{ filePath: string; content: string; timestamp: number }>>([]); // Track last 5 changes for better echo detection
  const isTypingRef = useRef<boolean>(false); // Track if user is actively typing
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout to clear typing state
  const yjsUpdateLogRef = useRef<Array<{timestamp: number; filePath: string; origin: string; content: string; skipped: boolean; reason?: string}>>([]); // Log all YJS updates for debugging
  const isApplyingYjsUpdateRef = useRef<Record<string, boolean>>({}); // Track YJS updates per file using refs
  const isApplyingMonacoUpdateRef = useRef<Record<string, boolean>>({}); // Track Monaco updates per file using refs
  const lastMonacoContentRef = useRef<Record<string, string>>({}); // Track last Monaco content per file to detect our own changes
  const saveStatusTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({}); // Track debounced save status updates per file
  const recentContentHashesRef = useRef<Map<string, Set<number>>>(new Map()); // Track content hashes for echo detection
  // Min and max constraints for side panel
  const SIDE_PANEL_MIN = 150;
  const SIDE_PANEL_MAX = 500;
  const SIDE_PANEL_DEFAULT = 200;
  
  const [sidePanelSize, setSidePanelSize] = useState<number>(() => {
    // Load saved side panel size from localStorage
    const saved = localStorage.getItem('ide-side-panel-size');
    if (!saved || saved.trim() === '') {
      // No saved value, use default
      return SIDE_PANEL_DEFAULT;
    }
    const parsed = parseInt(saved, 10);
    // Check if parsed value is valid number
    if (isNaN(parsed) || parsed <= 0) {
      // Invalid value, use default
      return SIDE_PANEL_DEFAULT;
    }
    // Ensure it's within bounds
    return Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, parsed));
  });
  const [terminalSize, setTerminalSize] = useState<number>(() => {
    // Load saved terminal size from localStorage
    const saved = localStorage.getItem('ide-terminal-size');
    return saved ? parseInt(saved, 10) : 200; // Default to 200px
  });
  const [vncSize, setVncSize] = useState<number>(() => {
    // Load saved VNC size from localStorage
    const saved = localStorage.getItem('ide-vnc-size');
    return saved ? parseInt(saved, 10) : 400; // Default to 400px
  });
  
  // Resize state
  const [isResizingSidePanel, setIsResizingSidePanel] = useState(false);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const [isResizingVnc, setIsResizingVnc] = useState(false);
  
  // Auto-show terminal when container is ready
  const hasTerminal = !!(containerId && containerTerminalUrl);
  const hasVnc = !!(containerId && containerVncUrl && showDesktop);

  // Detect container disconnection by monitoring health endpoints
  // Track consecutive failures - only disconnect after multiple failures
  const healthCheckFailureCountRef = useRef(0);
  const HEALTH_CHECK_FAILURE_THRESHOLD = 3; // Require 3 consecutive failures before disconnecting

  useEffect(() => {
    if (!containerId || !containerWebServerUrl || disconnectionDetectedRef.current) {
      return;
    }

    // Reset failure count when container changes
    healthCheckFailureCountRef.current = 0;

    const checkContainerHealth = async () => {
      try {
        const response = await fetch(`${containerWebServerUrl}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(3000), // 3 second timeout
        });

        // Check for successful response - container is alive
        if (response.ok) {
          healthCheckFailureCountRef.current = 0;
        } else {
          // Non-OK response (e.g., 502 Bad Gateway) - container might be dead
          throw new Error(`Health check returned ${response.status}`);
        }

      } catch (error: any) {
        // Network error or timeout - container might be disconnected
        // Don't treat as fatal immediately - increment failure count
        healthCheckFailureCountRef.current++;

        console.warn(`[MonacoIDE] Container health check failed (attempt ${healthCheckFailureCountRef.current}/${HEALTH_CHECK_FAILURE_THRESHOLD})`, error.message);

        // Only disconnect after multiple consecutive failures
        if (healthCheckFailureCountRef.current >= HEALTH_CHECK_FAILURE_THRESHOLD) {
          console.warn("[MonacoIDE] Container health check failed multiple times, disconnecting...");
          disconnectionDetectedRef.current = true;
          if (containerHealthCheckRef.current) {
            clearInterval(containerHealthCheckRef.current);
            containerHealthCheckRef.current = null;
          }
          onContainerKilled?.();
        }
      }
    };

    // Check health every 5 seconds
    containerHealthCheckRef.current = setInterval(checkContainerHealth, 5000);

    // Initial check after 5 seconds (give container time to fully start)
    setTimeout(checkContainerHealth, 5000);

    return () => {
      if (containerHealthCheckRef.current) {
        clearInterval(containerHealthCheckRef.current);
        containerHealthCheckRef.current = null;
      }
    };
  }, [containerId, containerWebServerUrl, onContainerKilled]);

  // Reset disconnection flag when container changes
  useEffect(() => {
    disconnectionDetectedRef.current = false;
  }, [containerId]);
  
  // Ensure sidePanelSize is always within bounds
  useEffect(() => {
    if (sidePanelSize < SIDE_PANEL_MIN || sidePanelSize > SIDE_PANEL_MAX || isNaN(sidePanelSize)) {
      setSidePanelSize(SIDE_PANEL_DEFAULT);
    }
  }, [sidePanelSize]);
  
  // Handle side panel resize (horizontal)
  const handleSidePanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidePanel(true);
  }, []);
  
  useEffect(() => {
    if (!isResizingSidePanel) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      
      // Clamp between min and max
      const clampedWidth = Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, newWidth));
      setSidePanelSize(clampedWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizingSidePanel(false);
      // Save to localStorage
      localStorage.setItem('ide-side-panel-size', sidePanelSize.toString());
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidePanel, sidePanelSize]);
  
  // Handle terminal resize (vertical)
  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingTerminal(true);
  }, []);
  
  useEffect(() => {
    if (!isResizingTerminal) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      
      // Clamp between 150px and container height - 200px (min editor height)
      const minHeight = 150;
      const maxHeight = containerRect.height - 200;
      const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      setTerminalSize(clampedHeight);
    };
    
    const handleMouseUp = () => {
      setIsResizingTerminal(false);
      // Save to localStorage
      localStorage.setItem('ide-terminal-size', terminalSize.toString());
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTerminal, terminalSize]);
  
  // Handle VNC resize (horizontal) - capture initial dimensions to avoid feedback loop
  const handleVncResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!terminalSplitRef.current) return;
    
    // Capture initial dimensions at drag start (before any resize happens)
    const initialRect = terminalSplitRef.current.getBoundingClientRect();
    const initialVncSize = vncSize;
    const startX = e.clientX;
    
    // Disable pointer events on iframes during resize
    const iframes = terminalSplitRef.current.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      (iframe as HTMLIFrameElement).style.pointerEvents = 'none';
    });
    
    setIsResizingVnc(true);
    
    let currentWidth = initialVncSize;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Calculate delta from start position
      const deltaX = startX - moveEvent.clientX; // Positive = dragging left = VNC wider
      const newWidth = initialVncSize + deltaX;
      
      // Clamp using initial container width (doesn't change during drag)
      const minWidth = 200;
      const maxWidth = initialRect.width - 200;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      currentWidth = clampedWidth;
      setVncSize(clampedWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizingVnc(false);
      // Re-enable pointer events on iframes
      iframes.forEach(iframe => {
        (iframe as HTMLIFrameElement).style.pointerEvents = 'auto';
      });
      // Save to localStorage using the current width
      localStorage.setItem('ide-vnc-size', currentWidth.toString());
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [vncSize]);
  
  // Toggle panel - if clicking the same panel, close it
  const togglePanel = useCallback((panel: "files") => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  // Extract all file paths from the file tree recursively
  const getAllFilePaths = useCallback((nodes: FileNode[]): string[] => {
    const paths: string[] = [];
    const traverse = (node: FileNode) => {
      if (node.type === "file") {
        paths.push(node.path);
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    };
    nodes.forEach(traverse);
    return paths.sort();
  }, []);

  // Get all available file paths for the dropdown
  const availableFiles = useMemo(() => {
    return getAllFilePaths(files);
  }, [files, getAllFilePaths]);

  // Detect language from file extension
  const detectLanguage = useCallback((filePath: string): string => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      py: "python",
      js: "javascript",
      ts: "typescript",
      java: "java",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      txt: "plaintext",
      sh: "shell",
      yml: "yaml",
      yaml: "yaml",
      xml: "xml",
      sql: "sql",
      cpp: "cpp",
      c: "c",
      h: "c",
      hpp: "cpp",
      go: "go",
      rs: "rust",
      php: "php",
      rb: "ruby",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      r: "r",
      bash: "shell",
      zsh: "shell",
    };
    return languageMap[ext || ""] || "plaintext";
  }, []);

  // Load file tree from S3
  const loadFileTree = useCallback(async () => {
    if (!bucketId) {
      setFiles([]);
      setLoading(false);
      return;
    }

    try {
      const response = await apiClient.listS3Files(bucketId);
      const s3Files = response.data.files || [];
      
      // Merge with recently created files that might not be in S3 yet
      // This prevents files from disappearing during the save window
      const recentlyCreated = Array.from(recentlyCreatedFilesRef.current);
      const allFiles = [...s3Files];
      
      // Add recently created files that aren't in S3 yet
      for (const filePath of recentlyCreated) {
        const exists = getAllFilePaths(s3Files).includes(filePath);
        if (!exists) {
          // File was recently created but not in S3 yet - add it optimistically
          const parts = filePath.split("/");
          if (parts.length === 1) {
            allFiles.push({
              name: filePath,
              path: filePath,
              type: "file" as const,
            });
          } else {
            // Nested file - ensure parent folders exist
            // This is a simplified merge - in practice, the file tree structure should handle this
            allFiles.push({
              name: parts[parts.length - 1],
              path: filePath,
              type: "file" as const,
            });
          }
        }
      }
      
      setFiles(allFiles);
      setLoading(false);
    } catch (error: any) {
      console.error("Failed to load file tree:", error);
      toast({
        title: "Failed to load files",
        description: error.message || "Could not load file tree from S3",
        variant: "destructive",
      });
      setLoading(false);
    }
  }, [bucketId, toast, getAllFilePaths]);

  // Load file content - Y.js is the source of truth, server handles S3 loading
  const loadFile = useCallback(
    async (filePath: string, forceReload: boolean = false) => {
      if (!bucketId) return;

      // Set loading state
      setLoadingFiles((prev) => new Set(prev).add(filePath));

      try {
        // CRITICAL: Subscribe to Y.js document and let the SERVER handle loading from S3
        // The server will send document-state which contains the latest content
        // DO NOT load from S3 on the client - this causes race conditions where
        // old S3 content overwrites newer Y.js state
        yjsProvider.subscribeToDocument(bucketId, filePath);

        // Get or create Y.js document
        const { ytext } = yjsProvider.getDocument(bucketId, filePath);

        // Check if Y.js already has content (might have been loaded from a previous subscription)
        const yjsContent = ytext.toString();

        console.log(`[MonacoIDE] Loading file ${filePath}`, {
          yjsContentLength: yjsContent.length,
          forceReload,
          docId: `${bucketId}:${filePath}`
        });

        // If Y.js has content, use it immediately
        // If empty, the server will send document-state which will trigger the ytext observer
        if (yjsContent) {
          console.log(`[MonacoIDE] Using existing Y.js content: ${filePath}`, {
            contentLength: yjsContent.length
          });
          setFileContent((prev) => ({ ...prev, [filePath]: yjsContent }));
        } else {
          // Y.js is empty - this is normal on first load
          // The server will send document-state shortly which will populate the content
          // For now, set empty content (will be updated when document-state arrives)
          console.log(`[MonacoIDE] Y.js empty, waiting for server document-state: ${filePath}`);
          setFileContent((prev) => ({ ...prev, [filePath]: "" }));
        }
      } catch (error: any) {
        console.error(`[MonacoIDE] Failed to load file ${filePath}:`, error);
        setFileContent((prev) => ({ ...prev, [filePath]: "" }));
      } finally {
        // Clear loading state
        setLoadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(filePath);
          return next;
        });
      }
    },
    [bucketId]
  );

  // Save file to S3 (Y.js handles real-time sync, this is for explicit saves)
  const saveFile = useCallback(
    async (filePath: string, content: string) => {
      if (!bucketId) {
        console.warn("Cannot save file: no bucketId");
        return;
      }

      try {
        console.log(`[MonacoIDE] Explicit save requested for ${filePath}`, {
          contentLength: content.length
        });
        
        // Get Y.js document and update it
        const { doc, ytext } = yjsProvider.getDocument(bucketId, filePath);
        const currentContent = ytext.toString();
        
        // Update Y.js document if content differs (this will sync to other tabs)
        if (currentContent !== content) {
          doc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, content);
          }, "explicit-save");
          console.log(`[MonacoIDE] Updated Y.js document for ${filePath}`);
        }
        
        // Also save directly to S3 for persistence (Y.js will sync, but this ensures it's saved)
        await apiClient.saveS3File(bucketId, filePath, content);
        console.log(`[MonacoIDE] ✅ Saved ${filePath} to S3`);
        setFileContent((prev) => ({ ...prev, [filePath]: content }));
      } catch (error: any) {
        console.error(`[MonacoIDE] ❌ Failed to save file ${filePath}:`, error);
        toast({
          title: "Failed to save file",
          description: error.message || `Could not save ${filePath}`,
          variant: "destructive",
        });
      }
    },
    [bucketId, toast]
  );

  // Handle file selection - opens file in a new tab if not already open
  const handleFileSelect = useCallback(
    (path: string) => {
      // CRITICAL: Clean up bindings for the previously selected file BEFORE switching
      // This prevents stale bindings from syncing wrong content
      if (selectedFile && selectedFile !== path && yjsBindingsRef.current[selectedFile]) {
        console.log(`[MonacoIDE] 🧹 Cleaning up binding for previous file: ${selectedFile}`);
        yjsBindingsRef.current[selectedFile].dispose();
        delete yjsBindingsRef.current[selectedFile];
      }
      
      // Add to open tabs if not already open
      setOpenTabs((prev) => {
        if (!prev.includes(path)) {
          return [...prev, path];
        }
        return prev;
      });
      setSelectedFile(path);
      selectedFileRef.current = path; // Update ref immediately
      
      // Subscribe to Y.js document immediately to start syncing
      if (bucketId) {
        yjsProvider.subscribeToDocument(bucketId, path);
        const { ytext } = yjsProvider.getDocument(bucketId, path);
        const yjsContent = ytext.toString();

        // If Y.js has content, use it (it's the source of truth)
        if (yjsContent) {
          setFileContent((prev) => ({ ...prev, [path]: yjsContent }));
        } else {
          // If Y.js is empty, subscribe and wait for server to send document-state
          // Server handles loading from S3 - client should NOT load from S3 directly
          loadFile(path, false);
        }
      }
    },
    [bucketId, loadFile, selectedFile]
  );

  // Handle tab close
  const handleCloseTab = useCallback(
    (path: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setOpenTabs((prev) => prev.filter((p) => p !== path));
      // If closing the selected file, switch to another tab or clear selection
      if (selectedFile === path) {
        const remainingTabs = openTabs.filter((p) => p !== path);
        if (remainingTabs.length > 0) {
          setSelectedFile(remainingTabs[remainingTabs.length - 1]);
          selectedFileRef.current = remainingTabs[remainingTabs.length - 1];
        } else {
          setSelectedFile(null);
          selectedFileRef.current = null;
        }
      }
      // Clean up Y.js binding for closed file
      if (yjsBindingsRef.current[path]) {
        yjsBindingsRef.current[path].dispose();
        delete yjsBindingsRef.current[path];
      }
      
      // Clean up state refs for closed file
      delete isApplyingYjsUpdateRef.current[path];
      delete isApplyingMonacoUpdateRef.current[path];
      if (yjsDocsRef.current[path]) {
        // Clear connection check interval
        const connectionCheckInterval = (yjsDocsRef.current[path] as any)?._connectionCheckInterval;
        if (connectionCheckInterval) {
          clearInterval(connectionCheckInterval);
        }
        
        yjsProvider.unsubscribeDocument(bucketId || "", path);
        delete yjsDocsRef.current[path];
      }
      
      // Clear save status
      setSaveStatus((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    },
    [selectedFile, openTabs, bucketId]
  );

  // Handle editor change - Y.js handles sync automatically
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      // Note: This handler is called by Monaco, but the MonacoBinding
      // should be handling the actual sync to Y.js
      // We only update local state here for UI consistency
      if (selectedFile && value !== undefined) {
        // Only update if different to avoid unnecessary re-renders
        setFileContent((prev) => {
          if (prev[selectedFile] !== value) {
            return { ...prev, [selectedFile]: value };
          }
          return prev;
        });
      }
    },
    [selectedFile]
  );

  // Handle file creation - optimistic update
  const handleCreateFile = useCallback(
    async (path: string) => {
      if (!bucketId) return;

      // Optimistic update - update UI immediately
      const newFileNode: FileNode = {
        name: path.split("/").pop() || path,
        path: path,
        type: "file",
      };

      // Add to file tree optimistically
      setFiles((prev) => {
        // Check if file already exists
        const exists = getAllFilePaths(prev).includes(path);
        if (exists) return prev;

        // Add file to appropriate location in tree
        const parts = path.split("/");
        if (parts.length === 1) {
          // Root level file
          return [...prev, newFileNode];
        } else {
          // Nested file - find or create parent folder
          const updated = [...prev];
          let current = updated;
          for (let i = 0; i < parts.length - 1; i++) {
            const folderName = parts[i];
            let folder = current.find((f) => f.name === folderName && f.type === "folder");
            if (!folder) {
              folder = {
                name: folderName,
                path: parts.slice(0, i + 1).join("/"),
                type: "folder",
                children: [],
              };
              current.push(folder);
            }
            if (!folder.children) {
              folder.children = [];
            }
            current = folder.children;
          }
          current.push(newFileNode);
          return updated;
        }
      });

      // Broadcast file creation to other tabs via Y.js WebSocket
      const socket = (yjsProvider as any).socketInstance;
      if (yjsProvider.connected && socket) {
        try {
          socket.emit("file-tree-change", {
            bucketId,
            filePath: path,
            action: "create",
          });
        } catch (error) {
          console.error("Failed to broadcast file creation:", error);
        }
      }

      // Open and select the new file using the standard file selection flow
      // This properly handles Y.js subscription and binding setup without duplication
      setFileContent((prev) => ({ ...prev, [path]: "" }));
      handleFileSelect(path);

      // Create file in S3 in background (don't wait)
      apiClient.createS3File(bucketId, path, "").catch((error: any) => {
        console.error("Failed to create file in S3:", error);
        toast({
          title: "Failed to sync file",
          description: `File created locally but failed to sync: ${error.message}`,
          variant: "destructive",
        });
        // Reload file tree to get accurate state
        loadFileTree();
      });

      // Mark file as recently created to prevent it from disappearing during S3 save
      recentlyCreatedFilesRef.current.add(path);
      setTimeout(() => {
        recentlyCreatedFilesRef.current.delete(path);
      }, 15000);
      
      // Don't reload file tree immediately - let Y.js handle the sync
      // The file tree will be updated via WebSocket events from the backend
      // Only reload after a longer delay to catch any missed updates
      setTimeout(() => {
        loadFileTree();
      }, 5000); // Increased delay to prevent premature S3 checks
    },
    [bucketId, toast, loadFileTree, handleFileSelect]
  );

  // Handle file deletion - optimistic update
  const handleDeleteFile = useCallback(
    async (path: string) => {
      if (!bucketId) return;
      if (!confirm(`Are you sure you want to delete ${path}?`)) return;

      // Optimistic update - remove from UI immediately
      const removeFromTree = (nodes: FileNode[]): FileNode[] => {
        return nodes
          .filter((node) => node.path !== path)
          .map((node) => {
            if (node.type === "folder" && node.children) {
              return {
                ...node,
                children: removeFromTree(node.children),
              };
            }
            return node;
          });
      };

      setFiles((prev) => removeFromTree(prev));

      // Remove from open tabs
      setOpenTabs((prev) => prev.filter((p) => p !== path));

        // Remove from local state
        setFileContent((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });

      // Clean up Y.js resources (backend handles document cleanup via file-tree-change delete event)
      if (yjsBindingsRef.current[path]) {
        yjsBindingsRef.current[path].dispose();
        delete yjsBindingsRef.current[path];
      }
      if (yjsDocsRef.current[path]) {
        yjsProvider.unsubscribeDocument(bucketId, path);
        delete yjsDocsRef.current[path];
      }

        // Clear selection if deleted file was selected
        if (selectedFile === path) {
        const remainingTabs = openTabs.filter((p) => p !== path);
        if (remainingTabs.length > 0) {
          setSelectedFile(remainingTabs[remainingTabs.length - 1]);
          selectedFileRef.current = remainingTabs[remainingTabs.length - 1];
        } else {
          setSelectedFile(null);
          selectedFileRef.current = null;
        }
      }

      // Broadcast file deletion to other tabs via Y.js WebSocket
      const socket = (yjsProvider as any).socketInstance;
      if (yjsProvider.connected && socket) {
        try {
          socket.emit("file-tree-change", {
            bucketId,
            filePath: path,
            action: "delete",
          });
        } catch (error) {
          console.error("Failed to broadcast file deletion:", error);
        }
      }

      // Delete from S3 in background (don't wait)
      apiClient.deleteS3File(bucketId, path)
        .then(() => {
          // Only reload file tree after successful deletion and a longer delay
          // This ensures S3 has time to process the deletion
          setTimeout(() => {
            loadFileTree();
          }, 3000); // Increased delay for S3 consistency
        })
        .catch((error: any) => {
        console.error("Failed to delete file from S3:", error);
        toast({
          title: "Failed to sync deletion",
          description: `File removed locally but failed to sync: ${error.message}`,
          variant: "destructive",
        });
          // Reload file tree to get accurate state on error
        loadFileTree();
      });
    },
    [bucketId, selectedFile, openTabs, toast, loadFileTree]
  );

  // Handle file rename
  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!bucketId) return;

      // Validate new path doesn't conflict with existing files
      const pathExists = (nodes: FileNode[], targetPath: string): boolean => {
        for (const node of nodes) {
          if (node.path === targetPath) return true;
          if (node.children && pathExists(node.children, targetPath)) return true;
        }
        return false;
      };

      if (pathExists(files, newPath)) {
        toast({
          title: "Rename failed",
          description: `A file with the name "${newPath}" already exists.`,
          variant: "destructive",
        });
        return;
      }

      // Get content from old Y.js document (if available)
      let content = "";
      if (yjsDocsRef.current[oldPath]) {
        const { ytext } = yjsDocsRef.current[oldPath];
        content = ytext.toString();
      } else if (fileContent[oldPath] !== undefined) {
        content = fileContent[oldPath];
      }

      // Optimistic UI update - update file tree
      const renameInTree = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((node) => {
          if (node.path === oldPath) {
            const newName = newPath.split("/").pop() || newPath;
            return { ...node, name: newName, path: newPath };
          }
          if (node.type === "folder" && node.children) {
            return { ...node, children: renameInTree(node.children) };
          }
          return node;
        });
      };
      setFiles((prev) => renameInTree(prev));

      // Update open tabs
      setOpenTabs((prev) =>
        prev.map((p) => (p === oldPath ? newPath : p))
      );

      // Update selected file
      if (selectedFile === oldPath) {
        setSelectedFile(newPath);
        selectedFileRef.current = newPath;
      }

      // Update file content state
      setFileContent((prev) => {
        const next = { ...prev };
        if (next[oldPath] !== undefined) {
          next[newPath] = next[oldPath];
          delete next[oldPath];
        }
        return next;
      });

      // Clean up old Y.js binding + unsubscribe
      if (yjsBindingsRef.current[oldPath]) {
        yjsBindingsRef.current[oldPath].dispose();
        delete yjsBindingsRef.current[oldPath];
      }
      if (yjsDocsRef.current[oldPath]) {
        yjsProvider.unsubscribeDocument(bucketId, oldPath);
        delete yjsDocsRef.current[oldPath];
      }

      // Create new Y.js document with content + subscribe
      try {
        yjsProvider.subscribeToDocument(bucketId, newPath);
        const { ytext } = yjsProvider.getDocument(bucketId, newPath);
        if (content && ytext.length === 0) {
          ytext.insert(0, content);
        }
        setFileContent((prev) => ({ ...prev, [newPath]: ytext.toString() }));
      } catch (error) {
        console.warn(`[MonacoIDE] Failed to initialize Y.js for renamed file ${newPath}:`, error);
      }

      // Broadcast file-tree-change events (delete old + create new)
      const socket = (yjsProvider as any).socketInstance;
      if (yjsProvider.connected && socket) {
        try {
          socket.emit("file-tree-change", {
            bucketId,
            filePath: oldPath,
            action: "delete",
          });
          socket.emit("file-tree-change", {
            bucketId,
            filePath: newPath,
            action: "create",
          });
        } catch (error) {
          console.error("Failed to broadcast file rename:", error);
        }
      }

      // Save new file to S3 (use PUT, not POST - Y.js subscription may have already created it)
      // Then delete old file
      try {
        await apiClient.saveS3File(bucketId, newPath, content);
        await apiClient.deleteS3File(bucketId, oldPath);
      } catch (error: any) {
        console.error("Failed to rename file in S3:", error);
        toast({
          title: "Failed to sync rename",
          description: `File renamed locally but failed to sync: ${error.message}`,
          variant: "destructive",
        });
        loadFileTree();
      }

      // Mark new file as recently created to prevent disappearing during S3 save
      recentlyCreatedFilesRef.current.add(newPath);
      setTimeout(() => {
        recentlyCreatedFilesRef.current.delete(newPath);
      }, 15000);

      // Reload file tree after delay to catch any missed updates
      setTimeout(() => {
        loadFileTree();
      }, 3000);
    },
    [bucketId, files, fileContent, selectedFile, toast, loadFileTree]
  );

  // Connect to Y.js provider
  useEffect(() => {
    if (!bucketId) {
      yjsProvider.disconnect();
      return;
    }

    // Connect to Y.js provider with bucketId for test authentication
    // CRITICAL: Y.js always connects to the backend API (port 8000 in dev),
    // NOT the IDE orchestration API. These are separate services.
    // Backend API URL is determined by VITE_API_BASE_URL env var
    const backendApiUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
    yjsProvider.connect(backendApiUrl, bucketId);
  }, [bucketId]);

  // Extract binding setup into a reusable function
  const setupYjsBinding = useCallback((filePath: string) => {
    if (!bucketId || !filePath || !editorRef.current) {
      console.log(`[MonacoIDE] ⏳ Cannot setup binding:`, {
        hasBucketId: !!bucketId,
        hasFilePath: !!filePath,
        hasEditor: !!editorRef.current
      });
        return;
      }

    const editor = editorRef.current;
    const model = editor.getModel();
    
    if (!model) {
      console.warn(`[MonacoIDE] ⚠️  Model not ready for ${filePath}, will retry...`);
      // Retry after a short delay
      setTimeout(() => {
        const retryModel = editor.getModel();
        if (retryModel && bucketId && filePath) {
          setupYjsBinding(filePath);
        }
      }, 200);
      return;
    }

    // DIRECT binding setup - no setTimeout, no nested functions
    console.log(`[MonacoIDE] 🔧🔧🔧 STARTING binding setup for ${filePath}`, {
      hasEditor: !!editor,
      hasModel: !!model,
      modelUri: model?.uri?.toString()
    });

      // Clean up old binding for this file if it exists
      if (yjsBindingsRef.current[filePath]) {
      console.log(`[MonacoIDE] Cleaning up old binding for ${filePath}`);
      yjsBindingsRef.current[filePath].dispose();
        delete yjsBindingsRef.current[filePath];
      }
      
      // Get or create Y.js document and subscribe
      yjsProvider.subscribeToDocument(bucketId, filePath);
      const { doc, ytext, awareness } = yjsProvider.getDocument(bucketId, filePath);
      yjsDocsRef.current[filePath] = { doc, ytext, awareness };

    const yjsContent = ytext.toString();
    const modelContent = model.getValue();
    
    // CRITICAL: Check if this model is actually for the file we're setting up
    // Monaco Editor reuses the same model instance, so when switching tabs,
    // the model might still have the old file's content. We need to verify
    // the model content matches what we expect for this file.
    const expectedContent = fileContent[filePath] || "";
    
    // Check if model matches expected content for this file
    // If expectedContent is empty, we'll trust Y.js
    const modelMatchesExpected = expectedContent === "" || modelContent === expectedContent;
    const yjsMatchesExpected = expectedContent === "" || yjsContent === expectedContent;

    console.log(`[MonacoIDE] Initial state for ${filePath}:`, {
      yjsLength: yjsContent.length,
      modelLength: modelContent.length,
      expectedLength: expectedContent.length,
      yjsMatchesModel: yjsContent === modelContent,
      modelMatchesExpected,
      yjsMatchesExpected
    });

    // Determine what content to use:
    // 1. If model matches expected content, it's correct - use Y.js if different
    // 2. If model doesn't match expected, it's stale - use expected content
    // 3. If expected is empty, use Y.js
    let contentToUse = yjsContent;
    if (!modelMatchesExpected && expectedContent) {
      // Model has stale content from previous file, use expected content
      contentToUse = expectedContent;
      console.log(`[MonacoIDE] 🔄 Model has stale content, using expected content for ${filePath}`);
    } else if (yjsContent && yjsMatchesExpected) {
      // Y.js matches expected, use Y.js
      contentToUse = yjsContent;
    }

    // Only update if content differs
    if (modelContent !== contentToUse) {
      console.log(`[MonacoIDE] 🔄 Syncing Monaco model with content for ${filePath}`, {
        fromLength: modelContent.length,
        toLength: contentToUse.length,
        source: contentToUse === expectedContent ? 'expected' : 'yjs'
      });
      
      // Save cursor position before updating model
      const editor = editorRef.current;
      const savedPosition = editor?.getPosition();
      const savedSelection = editor?.getSelection();
      const hadFocus = editor?.hasTextFocus() || false;
      
      // For initial sync, use full replacement (model might be empty or completely different)
      // For subsequent updates, the YJS observer will handle incremental updates
      model.pushEditOperations(
        [],
        [{
          range: model.getFullModelRange(),
          text: contentToUse
        }],
        () => null
      );
      
      // Restore cursor position after initial sync (synchronously)
      if (editor && savedPosition) {
        const lineCount = model.getLineCount();
        const validPosition = {
          lineNumber: Math.min(savedPosition.lineNumber, lineCount),
          column: savedPosition.lineNumber <= lineCount 
            ? Math.min(savedPosition.column, model.getLineLength(savedPosition.lineNumber) + 1)
            : model.getLineLength(lineCount) + 1
        };
        
        editor.setPosition(validPosition);
        if (savedSelection) {
          editor.setSelection(savedSelection);
        }
        
        // Only restore focus if we had it (avoid unnecessary focus calls)
        if (hadFocus) {
        editor.focus();
        }
      }
      
      setFileContent((prev) => ({ ...prev, [filePath]: contentToUse }));
    }

    // Create Y.js binding - IMMEDIATE, no setTimeout
    console.log(`[MonacoIDE] 🔧 Creating Y.js binding for ${filePath}`);
    
    // Use refs for state flags to prevent race conditions
    // Initialize refs for this file if not already set
    if (!isApplyingYjsUpdateRef.current[filePath]) {
      isApplyingYjsUpdateRef.current[filePath] = false;
    }
    if (!isApplyingMonacoUpdateRef.current[filePath]) {
      isApplyingMonacoUpdateRef.current[filePath] = false;
    }
    
    // 1. Sync Y.js -> Monaco: When Y.js changes, update Monaco
    // CRITICAL: Capture filePath and clientId in closure to verify we're still bound to the correct file
    const capturedFilePathForYjs = filePath;
    const capturedClientId = clientIdRef.current;
    const yjsObserver = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      const timestamp = Date.now();
      const originStr = String(transaction.origin || '');
      const yjsContent = ytext.toString();
      
      // DETAILED LOGGING: Track all YJS updates
      const logEntry = {
        timestamp,
        filePath: capturedFilePathForYjs,
        origin: originStr,
        content: yjsContent.substring(0, 100), // First 100 chars for logging
        skipped: false,
        reason: undefined as string | undefined
      };
      
      const isApplyingYjs = isApplyingYjsUpdateRef.current[capturedFilePathForYjs] || false;
      const isApplyingMonaco = isApplyingMonacoUpdateRef.current[capturedFilePathForYjs] || false;
      
      console.log(`[MonacoIDE] 🔍 YJS Observer triggered for ${capturedFilePathForYjs}`, {
        origin: originStr,
        clientId: capturedClientId,
        isTyping: isTypingRef.current,
        isApplyingYjsUpdate: isApplyingYjs,
        isApplyingMonacoUpdate: isApplyingMonaco,
        selectedFile: selectedFileRef.current,
        yjsLength: yjsContent.length,
        hasBinding: !!yjsBindingsRef.current[capturedFilePathForYjs]
      });
      
      // CRITICAL: Verify we're still bound to the correct file using ref (always current)
      if (selectedFileRef.current !== capturedFilePathForYjs) {
        logEntry.skipped = true;
        logEntry.reason = `file changed from ${capturedFilePathForYjs} to ${selectedFileRef.current}`;
        console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift(); // Keep last 50
        return;
      }
      
      // Also verify the binding still exists for this file
      if (!yjsBindingsRef.current[capturedFilePathForYjs]) {
        logEntry.skipped = true;
        logEntry.reason = `binding disposed for ${capturedFilePathForYjs}`;
        console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }
      
      // Get content and editor state early (yjsContent already declared above)
      const monacoContent = model.getValue();
      const editor = editorRef.current;
      const editorHasFocus = editor?.hasTextFocus() || false;
      
      // CRITICAL: Check recent changes for echo detection (define early)
      const recentChanges = recentMonacoChangesRef.current.filter(
        (c: { filePath: string; content: string; timestamp: number }) =>
          c.filePath === capturedFilePathForYjs && Date.now() - c.timestamp < 5000
      );

      // CRITICAL: Check content hash for reliable echo detection
      // If the incoming YJS content matches a hash we recently sent, it's definitely an echo
      const incomingHash = quickHash(yjsContent);
      const recentHashes = recentContentHashesRef.current.get(capturedFilePathForYjs);
      if (recentHashes?.has(incomingHash)) {
        logEntry.skipped = true;
        logEntry.reason = `content hash matches recent local change - BLOCKING echo`;
        console.log(`[MonacoIDE] ⏭️  BLOCKING Y.js update - ${logEntry.reason}`, {
          hash: incomingHash,
          yjsLength: yjsContent.length
        });
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }

      // CRITICAL: Block ALL server-origin updates if we have recent changes (container echoes)
      // Server origin means it came from the container, which echoes our changes back
      // This check happens BEFORE typing flag check because echoes can arrive after typing flag expires
      // Be VERY aggressive - block ANY server update if we have recent changes within 5 seconds
      if (originStr === 'server' && recentChanges.length > 0) {
        // Check if ANY recent change happened within 5 seconds
        const hasVeryRecentChange = recentChanges.some((c: { filePath: string; content: string; timestamp: number }) => {
          const timeSinceChange = Date.now() - c.timestamp;
          return timeSinceChange < 5000;
        });
        
        if (hasVeryRecentChange) {
          // Check if server update is similar to ANY recent change (within 5 chars length difference)
          // This catches echoes even if content is slightly different
          const isSimilarToRecent = recentChanges.some((c: { filePath: string; content: string; timestamp: number }) => {
            const timeSinceChange = Date.now() - c.timestamp;
            if (timeSinceChange >= 5000) return false;
            
            // Compare against the recent change content (what user typed)
            const lengthDiff = Math.abs(yjsContent.length - c.content.length);
            const lengthSimilar = lengthDiff <= 5;
            
            // Also compare against current Monaco content (in case it was already updated)
            const monacoDiff = Math.abs(yjsContent.length - monacoContent.length);
            const monacoSimilar = monacoDiff <= 5;
            
            return lengthSimilar || monacoSimilar;
          });

          if (isSimilarToRecent) {
            logEntry.skipped = true;
            logEntry.reason = `server update similar to recent change - BLOCKING container echo`;
            console.log(`[MonacoIDE] ⏭️  BLOCKING Y.js update - ${logEntry.reason}`, {
              origin: originStr,
              recentChangesCount: recentChanges.length,
              yjsLength: yjsContent.length,
              monacoLength: monacoContent.length,
              isTyping: isTypingRef.current
            });
            yjsUpdateLogRef.current.push(logEntry);
            if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
            return;
          }
        }
      }
      
      // CRITICAL: If user is actively typing, BLOCK ALL updates immediately
      // This is the FIRST and MOST IMPORTANT check - do it before anything else
      // The typing flag is set synchronously on keydown, so this should catch echoes
      if (isTypingRef.current) {
        logEntry.skipped = true;
        logEntry.reason = `user is actively typing - BLOCKING ALL updates`;
        console.log(`[MonacoIDE] ⏭️  BLOCKING Y.js update - ${logEntry.reason}`, {
          isTyping: isTypingRef.current,
          timestamp: Date.now(),
          yjsContent: yjsContent.substring(0, 50),
          monacoContent: monacoContent.substring(0, 50)
        });
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }
      
      // CRITICAL: If editor has focus, be EXTREMELY conservative
      // Only apply updates if they're CLEARLY from another source (not echoes)
      if (editorHasFocus) {
        // Check if this matches any of our recent changes (echo detection)
        const matchesRecentChange = recentChanges.some((c: { filePath: string; content: string; timestamp: number }) => {
          return yjsContent === c.content || Math.abs(yjsContent.length - c.content.length) <= 2;
        });
        
        // Also check if content is very similar to current Monaco content (likely echo)
        const contentSimilarity = Math.abs(yjsContent.length - monacoContent.length);
        const isLikelyEcho = matchesRecentChange || contentSimilarity <= 3;
        
        if (isLikelyEcho) {
          logEntry.skipped = true;
          logEntry.reason = `editor has focus and update looks like echo - BLOCKING (similarity: ${contentSimilarity} chars)`;
          console.log(`[MonacoIDE] ⏭️  BLOCKING Y.js update - ${logEntry.reason}`, {
            editorHasFocus,
            matchesRecentChange,
            contentSimilarity,
            yjsLength: yjsContent.length,
            monacoLength: monacoContent.length
          });
          yjsUpdateLogRef.current.push(logEntry);
          if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
          return;
        }
      }
      
      // Also check if we're currently applying a Monaco update (double protection)
      if (isApplyingMonaco) {
        logEntry.skipped = true;
        logEntry.reason = `Monaco update in progress`;
        console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }
      
      // Skip if this update came from this Monaco instance (to prevent loops)
      // Check if origin matches our client ID or is the generic 'monaco' origin
      const isOurUpdate = originStr === capturedClientId || 
                          originStr === 'monaco' || 
                          isApplyingMonaco;
      
      if (isOurUpdate) {
        logEntry.skipped = true;
        logEntry.reason = `our own update (origin: ${originStr})`;
        console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }
      if (isApplyingYjs) {
        logEntry.skipped = true;
        logEntry.reason = `already applying YJS update`;
        console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        yjsUpdateLogRef.current.push(logEntry);
        if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
        return;
      }

      // Set flag BEFORE any operations
      isApplyingYjsUpdateRef.current[capturedFilePathForYjs] = true;
      try {
        const yjsContent = ytext.toString();
        const monacoContent = model.getValue();
        
        // CRITICAL: Double-check we're still on the correct file before syncing
        if (selectedFileRef.current !== capturedFilePathForYjs) {
          console.log(`[MonacoIDE] ⏭️  Aborting Y.js sync - file changed during update from ${capturedFilePathForYjs} to ${selectedFileRef.current}`);
          return;
        }
        
        // CRITICAL: Check if this update matches our last Monaco change
        // This catches updates that are echoed back from the server with origin "server"
        const lastChange = lastMonacoChangeRef.current;
        if (lastChange && 
            lastChange.filePath === capturedFilePathForYjs) {
          const timeSinceChange = Date.now() - lastChange.timestamp;
          // Check if content matches (exact match) OR if it's very close (within a few chars)
          const contentMatches = lastChange.content === yjsContent;
          const isRecentChange = timeSinceChange < 3000; // Within 3 seconds
          
          if (contentMatches && isRecentChange) {
            logEntry.skipped = true;
            logEntry.reason = `matches our recent Monaco change (${timeSinceChange}ms ago, exact match)`;
            console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
            yjsUpdateLogRef.current.push(logEntry);
            if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
            return;
          }
          
          // Also check if this is a very small change that might be an echo
          // (e.g., we typed one char, and this update has one char difference)
          const lengthDiff = Math.abs(yjsContent.length - lastChange.content.length);
          if (isRecentChange && lengthDiff <= 2 && Math.abs(yjsContent.length - monacoContent.length) <= 2) {
            logEntry.skipped = true;
            logEntry.reason = `likely echo of recent change (${timeSinceChange}ms ago, ${lengthDiff} char diff)`;
            console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
            yjsUpdateLogRef.current.push(logEntry);
            if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
            return;
          }
        }
        
        // CRITICAL: Check recent changes for echo detection (define before use)
        const recentChanges = recentMonacoChangesRef.current.filter(
          (c: { filePath: string; content: string; timestamp: number }) => 
            c.filePath === capturedFilePathForYjs && Date.now() - c.timestamp < 5000
        );
        
        // CRITICAL: Double-check content still differs (might have changed during checks above)
        if (yjsContent === monacoContent) {
          logEntry.skipped = true;
          logEntry.reason = `content already matches (no update needed)`;
          yjsUpdateLogRef.current.push(logEntry);
          if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
          console.log(`[MonacoIDE] ⏭️  Skipping Y.js update - ${logEntry.reason}`);
        } else {
          // CRITICAL: Save cursor position and selection to prevent focus loss
          const savedPosition = editor?.getPosition();
          const savedSelection = editor?.getSelection();
        const hadFocus = editorHasFocus;

          console.log(`[MonacoIDE] 📥 APPLYING Y.js update to Monaco for ${capturedFilePathForYjs}`, {
              origin: originStr,
              yjsLength: yjsContent.length,
              monacoLength: monacoContent.length,
              diff: yjsContent.length - monacoContent.length,
              hadFocus,
              isTyping: isTypingRef.current,
              savedPosition: savedPosition ? `${savedPosition.lineNumber}:${savedPosition.column}` : null
            });
            
              // CRITICAL: Use Y.Text delta/changes to apply incremental updates
            // This is the proper way to sync YJS with Monaco - YJS already tracks deltas
            try {
            // Get the Y.Text delta (what actually changed)
            // Y.Text maintains the content as a sequence of items, we need to compute the diff
            // For now, use a simpler approach: only update if content is significantly different
            // or use Monaco's built-in diff
            
              // Simple heuristic: if lengths are very different, use full replacement
              // Otherwise, try to find the minimal edit
              const lengthDiff = Math.abs(yjsContent.length - monacoContent.length);
              const isLargeChange = lengthDiff > 100 || 
                                    (yjsContent.length === 0 && monacoContent.length > 0) ||
                                    (monacoContent.length === 0 && yjsContent.length > 0);
              
              if (isLargeChange) {
                // Large change - use full replacement
                model.pushEditOperations(
                  [],
                  [{
            range: model.getFullModelRange(),
            text: yjsContent
                  }],
                  () => null
                );
              } else {
                // Small change - try to find and apply only the diff
                // Find first difference
                let start = 0;
                while (start < monacoContent.length && 
                       start < yjsContent.length && 
                       monacoContent[start] === yjsContent[start]) {
                  start++;
                }
                
                // Find last difference
                let endMonaco = monacoContent.length;
                let endYjs = yjsContent.length;
                while (endMonaco > start && endYjs > start &&
                       monacoContent[endMonaco - 1] === yjsContent[endYjs - 1]) {
                  endMonaco--;
                  endYjs--;
                }
                
                // Apply the change
                if (start < endMonaco || start < endYjs) {
                  const startPos = model.getPositionAt(start);
                  const endPos = model.getPositionAt(endMonaco);
                  const newText = yjsContent.substring(start, endYjs);
                  
                  model.pushEditOperations(
                    [],
                    [{
                      range: {
                        startLineNumber: startPos.lineNumber,
                        startColumn: startPos.column,
                        endLineNumber: endPos.lineNumber,
                        endColumn: endPos.column
                      },
                      text: newText
                    }],
                    () => null
                  );
                }
              }
            } catch (error) {
              // Fallback to full replacement if anything fails
              console.warn(`[MonacoIDE] Update failed, using full replacement:`, error);
              model.pushEditOperations(
                [],
                [{
                  range: model.getFullModelRange(),
                  text: yjsContent
                }],
                () => null
              );
            }
            
            // Restore cursor position and selection after Y.js update (synchronously)
            // Only restore if we had focus before the update to avoid stealing focus
            if (editor && savedPosition && hadFocus) {
            // Validate position is still within bounds after update
            const lineCount = model.getLineCount();
            const lastLineLength = model.getLineLength(lineCount);
            
            const validPosition = {
              lineNumber: Math.min(savedPosition.lineNumber, lineCount),
              column: savedPosition.lineNumber <= lineCount 
                ? Math.min(savedPosition.column, model.getLineLength(savedPosition.lineNumber) + 1)
                : lastLineLength + 1
            };
            
              // Check if cursor actually moved during the update
              const currentPosition = editor.getPosition();
              const cursorMoved = !currentPosition || 
                                  currentPosition.lineNumber !== validPosition.lineNumber || 
                                  currentPosition.column !== validPosition.column;
              
              // CRITICAL: Restore cursor synchronously, not asynchronously
              // requestAnimationFrame causes focus loss because it delays the restoration
              if (cursorMoved) {
                // Restore immediately to prevent focus loss
                editor.setPosition(validPosition);
                if (savedSelection) {
                  editor.setSelection(savedSelection);
                }

                // CRITICAL: Restore focus immediately if we had it before
                // Don't use setTimeout - restore focus synchronously to prevent focus loss
                if (hadFocus) {
                  // Restore focus immediately, not in setTimeout
                  // This prevents other code from stealing focus
                  editor.focus();
                }
              } else if (savedSelection) {
                // Cursor didn't move but restore selection if we had one
                editor.setSelection(savedSelection);
              }
          
          // Log the source of the update for debugging
              const finalOriginStr = transaction.origin === 'server' ? 'server (container/other client)' : 
                           transaction.origin === 'monaco' ? 'monaco' : 
                           String(transaction.origin || 'unknown');
          
              logEntry.skipped = false;
              yjsUpdateLogRef.current.push(logEntry);
              if (yjsUpdateLogRef.current.length > 50) yjsUpdateLogRef.current.shift();
              
              console.log(`[MonacoIDE] ✅ Y.js -> Monaco: Successfully updated ${capturedFilePathForYjs} from ${finalOriginStr}`, {
            yjsLength: yjsContent.length,
            monacoLength: monacoContent.length,
                origin: finalOriginStr,
                cursorRestored: !!savedPosition,
                hadFocus,
                cursorMoved
              });
            }
          }
      } finally {
        // CRITICAL: Clear flag AFTER all operations complete
        isApplyingYjsUpdateRef.current[capturedFilePathForYjs] = false;
      }
    };
    
    ytext.observe(yjsObserver);
    
    // 2. Sync Monaco -> Y.js: When Monaco changes, update Y.js
    // CRITICAL: Capture filePath and clientId in closure to verify we're still bound to the correct file
    const capturedFilePath = filePath;
    const monacoDisposable = model.onDidChangeContent((e: monaco.editor.IModelContentChangedEvent) => {
      // CRITICAL: Verify we're still bound to the correct file using ref (always current)
      // If selectedFile changed, this binding is stale and should not sync
      if (selectedFileRef.current !== capturedFilePath) {
        console.log(`[MonacoIDE] ⏭️  Skipping Monaco update - file changed from ${capturedFilePath} to ${selectedFileRef.current}`);
          return;
        }

      // Also verify the binding still exists for this file
      if (!yjsBindingsRef.current[capturedFilePath]) {
        console.log(`[MonacoIDE] ⏭️  Skipping Monaco update - binding disposed for ${capturedFilePath}`);
        return;
      }
      
      // CRITICAL: Mark that user is typing IMMEDIATELY and SYNCHRONOUSLY
      // This must happen FIRST, before any other operations, to block YJS updates
      isTypingRef.current = true;
      
      // Also update last known content immediately to catch echoes
      const currentContent = model.getValue();
      lastMonacoContentRef.current[capturedFilePath] = currentContent;
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      // Clear typing state after 2 seconds of no typing (longer to catch fast echoes from container)
      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        console.log(`[MonacoIDE] ⌨️  Typing state cleared (2000ms idle)`);
      }, 2000);
      
      const isApplyingYjs = isApplyingYjsUpdateRef.current[capturedFilePath] || false;
      const isApplyingMonaco = isApplyingMonacoUpdateRef.current[capturedFilePath] || false;
      
      console.log(`[MonacoIDE] 🔔 Monaco content changed for ${capturedFilePath}!`, {
        changesCount: e.changes.length,
        isApplyingYjsUpdate: isApplyingYjs,
        isApplyingMonacoUpdate: isApplyingMonaco,
        currentSelectedFile: selectedFileRef.current,
        isTyping: isTypingRef.current,
        changes: e.changes.map(c => ({
          range: `${c.range.startLineNumber}:${c.range.startColumn}-${c.range.endLineNumber}:${c.range.endColumn}`,
          textLength: c.text.length
        }))
      });
      
      // CRITICAL: If this change came from YJS, don't sync back (prevents ping-pong)
      if (isApplyingYjs) {
        console.log(`[MonacoIDE] ⏭️  Skipping Monaco -> YJS sync - update from Y.js`);
        return;
      }
      
      // CRITICAL: If we're already syncing Monaco, skip to prevent loops
      if (isApplyingMonaco) {
        console.log(`[MonacoIDE] ⏭️  Skipping Monaco -> YJS sync - already applying Monaco update`);
        return;
      }
      
      // Set flag BEFORE any operations
      isApplyingMonacoUpdateRef.current[capturedFilePath] = true;
      try {
        const monacoContent = model.getValue();
        const yjsContent = ytext.toString();
        
        // CRITICAL: Double-check we're still on the correct file before syncing
        if (selectedFileRef.current !== capturedFilePath) {
          console.log(`[MonacoIDE] ⏭️  Aborting Monaco -> YJS sync - file changed during update from ${capturedFilePath} to ${selectedFileRef.current}`);
          return;
        }
        
        if (monacoContent !== yjsContent) {
          // Track this change so we can skip it when it echoes back from server
          const changeTimestamp = Date.now();
          lastMonacoChangeRef.current = {
            filePath: capturedFilePath,
            content: monacoContent,
            timestamp: changeTimestamp
          };
          
          // CRITICAL: Add to recent changes array for echo detection
          recentMonacoChangesRef.current.push({
            filePath: capturedFilePath,
            content: monacoContent,
            timestamp: changeTimestamp
          });
          // Keep only last 5 changes
          if (recentMonacoChangesRef.current.length > 5) {
            recentMonacoChangesRef.current.shift();
          }

          console.log(`[MonacoIDE] 📤 Monaco -> Y.js: Sending update for ${capturedFilePath}`, {
            monacoLength: monacoContent.length,
            yjsLength: yjsContent.length,
            clientId: clientIdRef.current,
            timestamp: changeTimestamp,
            recentChangesCount: recentMonacoChangesRef.current.length
          });
          
          // CRITICAL: Use incremental updates instead of full replacement
          // This allows YJS to properly merge concurrent edits from multiple users
          doc.transact(() => {
            // Compute diff and apply incrementally
            const currentYjs = ytext.toString();
            
            // Find common prefix and suffix
            let prefixLength = 0;
            while (prefixLength < currentYjs.length && 
                   prefixLength < monacoContent.length && 
                   currentYjs[prefixLength] === monacoContent[prefixLength]) {
              prefixLength++;
            }
            
            let suffixLength = 0;
            while (suffixLength < currentYjs.length - prefixLength && 
                   suffixLength < monacoContent.length - prefixLength &&
                   currentYjs[currentYjs.length - 1 - suffixLength] === monacoContent[monacoContent.length - 1 - suffixLength]) {
              suffixLength++;
            }
            
            // Delete the changed portion
            const deleteStart = prefixLength;
            const deleteEnd = currentYjs.length - suffixLength;
            if (deleteEnd > deleteStart) {
              ytext.delete(deleteStart, deleteEnd - deleteStart);
            }
            
            // Insert the new portion
            const insertText = monacoContent.substring(prefixLength, monacoContent.length - suffixLength);
            if (insertText.length > 0) {
              ytext.insert(prefixLength, insertText);
            }
          }, clientIdRef.current);
          
          console.log(`[MonacoIDE] ✅ Monaco -> Y.js: Successfully updated Y.js for ${capturedFilePath}`, {
            newYjsLength: ytext.length,
            origin: clientIdRef.current
          });

          // Track save status for LOCAL changes only (moved from ytext observer to prevent re-renders on echoes)
          setSaveStatus((prev) => {
            // Only update if actually changing to prevent unnecessary re-renders
            if (prev[capturedFilePath] !== "saving") {
              return { ...prev, [capturedFilePath]: "saving" };
            }
            return prev;
          });

          // Debounce the "saved" status update
          if (saveStatusTimeoutRef.current[capturedFilePath]) {
            clearTimeout(saveStatusTimeoutRef.current[capturedFilePath]);
          }
          saveStatusTimeoutRef.current[capturedFilePath] = setTimeout(() => {
            if (yjsProvider.connected) {
              setSaveStatus((prev) => ({ ...prev, [capturedFilePath]: "saved" }));
            } else {
              setSaveStatus((prev) => ({ ...prev, [capturedFilePath]: "error" }));
            }
          }, 1500); // 1.5s timeout for save confirmation

          // Track content hash for echo detection
          const contentHash = quickHash(monacoContent);
          if (!recentContentHashesRef.current.has(capturedFilePath)) {
            recentContentHashesRef.current.set(capturedFilePath, new Set());
          }
          recentContentHashesRef.current.get(capturedFilePath)!.add(contentHash);
          // Clean up hash after 10 seconds (longer than container echo delay)
          setTimeout(() => {
            recentContentHashesRef.current.get(capturedFilePath)?.delete(contentHash);
          }, 10000);
        } else {
          console.log(`[MonacoIDE] ⏭️  Skipping Monaco -> YJS sync - content matches`);
        }
      } finally {
        // CRITICAL: Clear flag AFTER all operations complete
        isApplyingMonacoUpdateRef.current[capturedFilePath] = false;
      }
    });
    
    // NOTE: We no longer use updateContentObserver to call setFileContent here.
    // Monaco's onChange (handleEditorChange) already updates fileContent for ALL model changes,
    // whether local or from YJS binding. Having updateContentObserver also call setFileContent
    // causes duplicate re-renders which leads to focus loss.
    //
    // The YJS observer (yjsObserver) updates Monaco's model directly via pushEditOperations,
    // which triggers Monaco's onChange, which triggers handleEditorChange, which updates fileContent.

    // Keep a simple observer just for logging (no state updates)
    const updateContentObserver = () => {
      // Intentionally empty - just for dispose tracking
      // setFileContent is handled by Monaco's onChange (handleEditorChange)
    };

    ytext.observe(updateContentObserver);

    // Initial content sync - only needed once when binding is created
    // Monaco's model should already have content from file load
    const initialContent = ytext.toString();
    if (initialContent) {
      setFileContent((prev) => {
        if (prev[filePath] !== initialContent) {
          return { ...prev, [filePath]: initialContent };
        }
        return prev;
      });
    }

    // Connection status check interval
    const checkConnectionStatus = () => {
      if (!yjsProvider.connected) {
        setSaveStatus((prev) => ({ ...prev, [filePath]: "error" }));
      }
    };

    const connectionCheckInterval = setInterval(checkConnectionStatus, 2000);

    // Store disposables for cleanup - MUST include ALL observers
    const dispose = () => {
      console.log(`[MonacoIDE] 🧹 Disposing binding for ${filePath}`);
      ytext.unobserve(yjsObserver);
      ytext.unobserve(updateContentObserver);
      monacoDisposable.dispose();
      clearInterval(connectionCheckInterval);

      // Clear any pending save status timeout for this file
      if (saveStatusTimeoutRef.current[filePath]) {
        clearTimeout(saveStatusTimeoutRef.current[filePath]);
        delete saveStatusTimeoutRef.current[filePath];
      }
    };

    yjsBindingsRef.current[filePath] = { dispose };
    (yjsDocsRef.current[filePath] as any)._connectionCheckInterval = connectionCheckInterval;

    console.log(`[MonacoIDE] ✅✅✅ Y.js binding CREATED for ${filePath}`, {
      ytextLength: ytext.length,
      modelLength: model.getValueLength()
    });

    // NOTE: Save status tracking is now handled in the Monaco onDidChangeContent handler
    // to prevent re-renders on every YJS update (including echoes)
  }, [bucketId]);
  
  // Set up binding when file changes or editor becomes ready
  // Add a small delay to ensure Monaco has updated the model content
  useEffect(() => {
    if (bucketId && selectedFile && editorRef.current && editorReadyRef.current) {
      // Wait a moment for Monaco to update the model with the new file's content
      // This prevents the binding from syncing with stale model content
      const timeout = setTimeout(() => {
        if (bucketId && selectedFile && editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            setupYjsBinding(selectedFile);
          }
        }
      }, 50); // Small delay to let Monaco update
      
      return () => clearTimeout(timeout);
    }
  // CRITICAL: fileContent removed from dependencies to prevent feedback loop
  // (YJS update → setFileContent → fileContent changes → effect re-runs → binding re-created)
  }, [bucketId, selectedFile, setupYjsBinding]);

  // Track recently created files to prevent premature S3 reloads
  const recentlyCreatedFilesRef = useRef<Set<string>>(new Set());

  // Load file tree on mount and when bucketId changes
  useEffect(() => {
    loadFileTree();
  }, [bucketId]); // Only depend on bucketId, not loadFileTree to prevent unnecessary reloads

  // Listen for Y.js document updates from other tabs/clients
  useEffect(() => {
    const handleYjsDocumentUpdate = (event: CustomEvent) => {
      const { bucketId: updatedBucketId, filePath, docId, content } = event.detail;
      if (updatedBucketId !== bucketId) return;
      
      // If this file is currently selected and editor is ready, ensure it's in sync
      if (filePath === selectedFile && editorRef.current) {
        const editor = editorRef.current;
        const model = editor.getModel();
        if (model && model.getValue() !== content) {
          console.log(`[MonacoIDE] 🔄 Syncing Monaco editor with Y.js update from other client for ${filePath}`);
          // Only update if binding isn't active (to avoid conflicts)
          // The binding should handle this, but this is a safety net
          if (!yjsBindingsRef.current[filePath]) {
            model.pushEditOperations(
              [],
              [{
                range: model.getFullModelRange(),
                text: content
              }],
              () => null
            );
          }
        }
        // Update local state
        setFileContent((prev) => ({ ...prev, [filePath]: content }));
      } else if (filePath !== selectedFile) {
        // Update state for files that aren't currently selected
        setFileContent((prev) => ({ ...prev, [filePath]: content }));
      }
    };

    window.addEventListener("yjs-document-updated", handleYjsDocumentUpdate as EventListener);
    return () => {
      window.removeEventListener("yjs-document-updated", handleYjsDocumentUpdate as EventListener);
    };
  }, [bucketId, selectedFile]);

  // Listen for file tree changes from other tabs
  useEffect(() => {
    const handleFileTreeChange = (event: CustomEvent) => {
      const { bucketId: changedBucketId, filePath, action } = event.detail;
      if (changedBucketId !== bucketId) return;

      if (action === "delete") {
        // Remove file from tree
        const removeFromTree = (nodes: FileNode[]): FileNode[] => {
          return nodes
            .filter((node) => node.path !== filePath)
            .map((node) => {
              if (node.type === "folder" && node.children) {
                return {
                  ...node,
                  children: removeFromTree(node.children),
                };
              }
              return node;
            });
        };
        setFiles((prev) => removeFromTree(prev));
        setOpenTabs((prev) => prev.filter((p) => p !== filePath));
        setFileContent((prev) => {
          const next = { ...prev };
          delete next[filePath];
          return next;
        });
        if (selectedFile === filePath) {
          const remainingTabs = openTabs.filter((p) => p !== filePath);
          if (remainingTabs.length > 0) {
            setSelectedFile(remainingTabs[remainingTabs.length - 1]);
            selectedFileRef.current = remainingTabs[remainingTabs.length - 1];
          } else {
            setSelectedFile(null);
            selectedFileRef.current = null;
          }
        }
        
        // Clean up Y.js resources for deleted file (if not already cleaned up)
        if (yjsBindingsRef.current[filePath]) {
          yjsBindingsRef.current[filePath].dispose();
          delete yjsBindingsRef.current[filePath];
        }
        if (yjsDocsRef.current[filePath] && bucketId) {
          // Wait a moment for the clear to sync, then unsubscribe
          setTimeout(() => {
            yjsProvider.unsubscribeDocument(bucketId, filePath);
          }, 500);
          delete yjsDocsRef.current[filePath];
        }
        
        // CRITICAL: Do NOT reload file tree here - the deletion is already handled optimistically
        // Reloading would cause the file to reappear if S3 delete hasn't completed yet
        // The file tree will be reloaded after S3 deletion completes (in handleDeleteFile)
      } else if (action === "create") {
        // Mark file as recently created to prevent it from disappearing during S3 save window
        recentlyCreatedFilesRef.current.add(filePath);
        // Remove from recently created set after 15 seconds (enough time for S3 save)
        setTimeout(() => {
          recentlyCreatedFilesRef.current.delete(filePath);
        }, 15000);
        
        // Add file to tree optimistically (don't switch editor)
        const newFileNode: FileNode = {
          name: filePath.split("/").pop() || filePath,
          path: filePath,
          type: "file",
        };

        setFiles((prev) => {
          // Check if file already exists
          const exists = getAllFilePaths(prev).includes(filePath);
          if (exists) return prev;

          // Add file to appropriate location in tree
          const parts = filePath.split("/");
          if (parts.length === 1) {
            // Root level file
            return [...prev, newFileNode];
          } else {
            // Nested file - find or create parent folder
            const updated = [...prev];
            let current = updated;
            for (let i = 0; i < parts.length - 1; i++) {
              const folderName = parts[i];
              let folder = current.find((f) => f.name === folderName && f.type === "folder");
              if (!folder) {
                folder = {
                  name: folderName,
                  path: parts.slice(0, i + 1).join("/"),
                  type: "folder",
                  children: [],
                };
                current.push(folder);
              }
              if (!folder.children) {
                folder.children = [];
              }
              current = folder.children;
            }
            current.push(newFileNode);
            return updated;
          }
        });

        // Initialize Y.js document for the new file (but don't switch to it)
        // This ensures the file is available for syncing in all tabs
        // CRITICAL: Subscribe first, then get the document to ensure we receive updates
        // If this is from container, Y.js might already have content
        if (bucketId) {
            try {
              yjsProvider.subscribeToDocument(bucketId, filePath);
              const { doc, ytext } = yjsProvider.getDocument(bucketId, filePath);
              
              // Get current Y.js content (might already have content from container)
              const yjsContent = ytext.toString();
              
              // Update local state with Y.js content (not empty - use actual content)
        setFileContent((prev) => {
                // Only update if we don't have content or if Y.js has newer content
                if (!prev[filePath] || yjsContent.length > (prev[filePath]?.length || 0)) {
                  return { ...prev, [filePath]: yjsContent };
          }
          return prev;
        });

              console.log(`[MonacoIDE] ✅ Initialized Y.js document for new file from container: ${filePath}`, {
                yjsContentLength: yjsContent.length,
                hasContent: yjsContent.length > 0
              });
            } catch (error) {
              console.warn(`[MonacoIDE] Failed to initialize Y.js for new file ${filePath}:`, error);
            // Retry after delay
          setTimeout(() => {
            try {
              yjsProvider.subscribeToDocument(bucketId, filePath);
              const { ytext } = yjsProvider.getDocument(bucketId, filePath);
                const yjsContent = ytext.toString();
                setFileContent((prev) => {
                  if (!prev[filePath] || yjsContent.length > (prev[filePath]?.length || 0)) {
                    return { ...prev, [filePath]: yjsContent };
              }
                  return prev;
                });
              } catch (retryError) {
                console.error(`[MonacoIDE] Retry failed for Y.js initialization:`, retryError);
            }
          }, 500);
        }
        }

      // CRITICAL: Do NOT reload file tree after file-tree-change create events
      // The file is already added optimistically above, and we track it in recentlyCreatedFilesRef
      // Reloading from S3 would cause the file to disappear if it hasn't been saved yet
      // The file will be included in future S3 reloads once it's saved (within 15 seconds)
      }
    };

    window.addEventListener("yjs-file-tree-change", handleFileTreeChange as EventListener);
    return () => {
      window.removeEventListener("yjs-file-tree-change", handleFileTreeChange as EventListener);
    };
  }, [bucketId, selectedFile, openTabs, loadFileTree]);

  // Listen for Y.js connection restoration to update save status
  useEffect(() => {
    const handleConnectionRestored = () => {
      console.log(`[MonacoIDE] Y.js connection restored - updating save status`);
      // Update save status for all open files
      for (const filePath of openTabs) {
        if (yjsProvider.connected) {
          setSaveStatus((prev) => {
            // Only update if currently showing error
            if (prev[filePath] === "error") {
              return { ...prev, [filePath]: "saved" };
            }
            return prev;
          });
        }
      }
    };

    window.addEventListener("yjs-connection-restored", handleConnectionRestored);
    return () => {
      window.removeEventListener("yjs-connection-restored", handleConnectionRestored);
    };
  }, [openTabs]);

  // Auto-open default run file when files are loaded or runFilename changes
  useEffect(() => {
    if (!loading && files.length > 0 && runFilename) {
      // Check if the default run file exists in the file tree
      const fileExists = availableFiles.includes(runFilename);
      if (fileExists && !openTabs.includes(runFilename)) {
        // Add to open tabs and select it
        setOpenTabs((prev) => (prev.includes(runFilename) ? prev : [...prev, runFilename]));
        setSelectedFile(runFilename);
        selectedFileRef.current = runFilename;
        // Force reload to get latest content from S3
        loadFile(runFilename, true);
      }
    }
  }, [loading, files, runFilename, openTabs, availableFiles, loadFile]);

  // Force save all open files on page unload to prevent data loss
  // CRITICAL: Only set up once, don't re-setup on every render
  useEffect(() => {
    // Track if we've already set up the handler to prevent duplicate setup
    if ((window as any)._monacoIdeUnloadHandlerSet) {
      return;
    }
    (window as any)._monacoIdeUnloadHandlerSet = true;

    let isUnloading = false;
    let hasInitialized = false;

    // Mark as initialized after a short delay to prevent firing on initial load
    setTimeout(() => {
      hasInitialized = true;
    }, 2000);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only run if we've been initialized (not on initial page load)
      if (!hasInitialized || isUnloading) {
        return;
      }

      isUnloading = true;
      console.log(`[MonacoIDE] Page unloading - saving files...`);

      // Use fetch with keepalive: true for reliable unload saves
      // This supports PUT method (sendBeacon only supports POST, which doesn't match our route)
      const currentTabs = Array.from(openTabs);
      const backendApiUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
      for (const filePath of currentTabs) {
        if (bucketId && yjsDocsRef.current[filePath]) {
          try {
            const { ytext } = yjsDocsRef.current[filePath];
            const content = ytext.toString();

            // Use fetch with keepalive for reliable save during page unload
            fetch(
              `${backendApiUrl}/api/s3buckets/${bucketId}/files/${encodeURIComponent(filePath)}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
                keepalive: true,
                credentials: 'include',
              }
            ).catch(() => {});
          } catch (error) {
            console.error(`[MonacoIDE] Failed to save ${filePath} on unload:`, error);
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      // Only save if tab is hidden AND we've been initialized
      if (!hasInitialized || !document.hidden || !bucketId) {
        return;
      }

      // Save when tab becomes hidden (user switching tabs)
      const currentTabs = Array.from(openTabs);
      for (const filePath of currentTabs) {
        if (yjsDocsRef.current[filePath]) {
          const { ytext } = yjsDocsRef.current[filePath];
          const content = ytext.toString();
          
          // Save in background, don't await
          apiClient.saveS3File(bucketId, filePath, content).catch((error) => {
            console.error(`[MonacoIDE] Failed to save ${filePath} on visibility change:`, error);
          });
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      (window as any)._monacoIdeUnloadHandlerSet = false;
    };
  }, [bucketId, ideApiBaseUrl]); // Only depend on bucketId, not openTabs (use ref instead)

  // Expose update log to window for debugging
  useEffect(() => {
    (window as any).monacoIDEUpdateLog = () => {
      console.table(yjsUpdateLogRef.current.slice(-20)); // Show last 20 updates
      return yjsUpdateLogRef.current;
    };
    (window as any).monacoIDEClearLog = () => {
      yjsUpdateLogRef.current = [];
      console.log('[MonacoIDE] Update log cleared');
    };
    (window as any).monacoIDETypingState = () => {
      return {
        isTyping: isTypingRef.current,
        lastChange: lastMonacoChangeRef.current,
        clientId: clientIdRef.current
      };
    };
  }, []);

  // Cleanup Y.js bindings on unmount
  useEffect(() => {
    return () => {
      // Force save all files before cleanup
      if (bucketId) {
        for (const filePath of openTabs) {
          if (yjsDocsRef.current[filePath]) {
            const { ytext } = yjsDocsRef.current[filePath];
            const content = ytext.toString();
            
            // Save directly to S3
            apiClient.saveS3File(bucketId, filePath, content).catch((error) => {
              console.error(`[MonacoIDE] Failed to save ${filePath} on unmount:`, error);
            });
          }
        }
      }
      
      // Clean up all Y.js bindings
      Object.values(yjsBindingsRef.current).forEach((binding) => {
        binding.dispose();
      });
      yjsBindingsRef.current = {};
      
      yjsDocsRef.current = {};
    };
  }, [bucketId, openTabs]);

  const currentContent = selectedFile ? fileContent[selectedFile] || "" : "";

  return (
    <div 
      className="flex flex-col h-full bg-white border border-gray-200 rounded-lg overflow-hidden"
      onKeyDown={(e) => {
        // Only stop propagation if the event is not targeting the terminal iframe
        const target = e.target as HTMLElement;
        const isTerminalArea = target.closest('[data-terminal-container]') !== null;
        if (!isTerminalArea) {
          // Stop keyboard events from bubbling to TipTap
          e.stopPropagation();
        }
      }}
      onKeyUp={(e) => {
        // Only stop propagation if the event is not targeting the terminal iframe
        const target = e.target as HTMLElement;
        const isTerminalArea = target.closest('[data-terminal-container]') !== null;
        if (!isTerminalArea) {
          e.stopPropagation();
        }
      }}
      onKeyPress={(e) => {
        // Only stop propagation if the event is not targeting the terminal iframe
        const target = e.target as HTMLElement;
        const isTerminalArea = target.closest('[data-terminal-container]') !== null;
        if (!isTerminalArea) {
          e.stopPropagation();
        }
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b border-gray-200 bg-gray-50">
        {/* Left side - Kill Machine button */}
        <div className="flex items-center gap-2">
          {containerId && containerWebServerUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!confirm("Are you sure you want to kill the machine? This will disconnect the container.")) {
                  return;
                }
                try {
                  // First verify the web server is reachable
                  try {
                    const healthCheck = await fetch(`${containerWebServerUrl}/health`, {
                      method: "GET",
                    });
                    if (!healthCheck.ok) {
                      console.warn("Web server health check failed, but attempting kill anyway");
                    }
                  } catch (healthError) {
                    console.warn("Could not reach web server for health check:", healthError);
                    // Continue anyway - the server might be in a bad state but kill might still work
                  }
                  
                  // Make the kill request - use POST without body to minimize CORS issues
                  const response = await fetch(`${containerWebServerUrl}/kill`, {
                    method: "POST",
                    // Explicitly don't set Content-Type to avoid preflight
                    // Flask-CORS should handle OPTIONS automatically
                  });
                  
                  if (response.ok) {
                    toast({
                      title: "Machine killed",
                      description: "The container has been shut down.",
                    });
                    // Notify parent component that container was killed
                    onContainerKilled?.();
                  } else {
                    // Even if response is not ok, the container might be shutting down
                    // which could cause the response to fail
                    console.warn("Kill endpoint returned non-OK status:", response.status);
                    toast({
                      title: "Kill request sent",
                      description: "The container shutdown has been initiated.",
                    });
                    onContainerKilled?.();
                  }
                } catch (error: any) {
                  console.error("Failed to kill container:", error);
                  // Network errors are expected if container shuts down quickly
                  // Still notify parent - the container will disconnect
                  toast({
                    title: "Kill request sent",
                    description: "The container shutdown has been initiated. It may disconnect shortly.",
                  });
                  // Notify parent - container might be dead
                  onContainerKilled?.();
                }
              }}
              disabled={isStarting}
              className="h-8 px-3 text-sm text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Kill the container machine"
            >
              <Power className="w-4 h-4 mr-1" />
              Kill Machine
            </Button>
          )}
        </div>
        {/* Right side - Run button */}
        <div className="flex items-center gap-2">
          {onRun && (
            <div className="flex items-center gap-2">
              <Select
                value={runFilename}
                onValueChange={(value) => onFilenameChange?.(value)}
                disabled={isStarting}
              >
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Select file to run" />
                </SelectTrigger>
                <SelectContent>
                  {availableFiles.length > 0 ? (
                    availableFiles.map((filePath) => (
                      <SelectItem key={filePath} value={filePath}>
                        {filePath}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value={runFilename} disabled>
                      No files available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={onRun}
                disabled={isStarting}
              >
                {isStarting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : containerId ? (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Run
                  </>
                ) : (
                  "Start Machine"
                )}
              </Button>
              {showPanelButtons && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onOpenSidePanel}
                    className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 w-8 h-8 p-0"
                    title="Open in Side Panel"
                  >
                    <PanelLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onOpenFullscreen}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 w-8 h-8 p-0"
                    title="Open in New Tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar with Toggle Icons */}
        <div className="w-12 border-r border-gray-200 bg-gray-50 flex flex-col items-center py-2 gap-2 flex-shrink-0">
          <button
            onClick={() => togglePanel("files")}
            className={`w-10 h-10 flex items-center justify-center rounded hover:bg-gray-200 transition-colors ${
              activePanel === "files" ? "bg-purple-100 text-purple-600" : "text-gray-600"
            }`}
            title="Toggle file explorer"
          >
            <Files className="w-5 h-5" />
          </button>
        </div>

        {/* Resizable Panels - Custom Implementation */}
        <div ref={containerRef} className="flex-1 flex h-full min-w-0 overflow-hidden">
          {/* Side Panel */}
          {activePanel && (
            <>
              <div 
                className="h-full border-r border-gray-200 overflow-hidden flex-shrink-0"
                style={{ 
                  width: `${Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, sidePanelSize))}px`,
                  minWidth: `${SIDE_PANEL_MIN}px`,
                  maxWidth: `${SIDE_PANEL_MAX}px`,
                  display: activePanel ? 'block' : 'none' 
                }}
              >
                {activePanel === "files" && (
                  <FileExplorer
                    files={files}
                    onFileSelect={handleFileSelect}
                    selectedPath={selectedFile || undefined}
                    onCreateFile={handleCreateFile}
                    onDeleteFile={handleDeleteFile}
                    onRenameFile={handleRenameFile}
                  />
                )}
              </div>
              {/* Resize Handle for Side Panel */}
              <div
                onMouseDown={handleSidePanelResizeStart}
                className="w-1 bg-gray-300 hover:bg-purple-500 cursor-col-resize flex-shrink-0 transition-colors"
                style={{ cursor: isResizingSidePanel ? 'col-resize' : 'col-resize' }}
              />
            </>
          )}
          
          {/* Editor and Terminal Area */}
          <div className="flex-1 flex flex-col min-w-0 max-w-full overflow-hidden">
            {/* Editor Area */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* File Tabs */}
                  {openTabs.length > 0 && (
                    <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
                      {openTabs.map((filePath) => {
                        const fileName = filePath.split("/").pop() || filePath;
                        const isActive = selectedFile === filePath;
                        const fileStatus = saveStatus[filePath] || "saved";
                        return (
                          <div
                            key={filePath}
                            onClick={() => {
                              setSelectedFile(filePath);
                              selectedFileRef.current = filePath;
                              loadFile(filePath, false);
                            }}
                            className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b-2 transition-colors ${
                              isActive
                                ? "bg-white border-purple-500 text-purple-600"
                                : "border-transparent text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            <span className="text-sm whitespace-nowrap">{fileName}</span>
                            {fileStatus === "saving" && (
                              <span title="Saving...">
                                <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                              </span>
                            )}
                            {fileStatus === "saved" && (
                              <span className="w-2 h-2 rounded-full bg-green-500" title="Saved" />
                            )}
                            {fileStatus === "error" && (
                              <span className="w-2 h-2 rounded-full bg-red-500" title="Save error" />
                            )}
                            <button
                              onClick={(e) => handleCloseTab(filePath, e)}
                              className="ml-1 hover:bg-gray-200 rounded p-0.5 transition-colors"
                              title="Close tab"
                            >
                              <span className="text-xs">×</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-gray-500">Loading files...</div>
                    </div>
                  ) : selectedFile ? (
                    loadingFiles.has(selectedFile) ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                          <div className="text-sm text-gray-500">Loading file...</div>
                        </div>
                      </div>
                    ) : (
                    <Editor
                      // Key forces remount when file changes, ensuring new file content loads
                      key={selectedFile}
                      height="100%"
                      language={detectLanguage(selectedFile)}
                      // Use defaultValue instead of value to make Monaco uncontrolled after mount.
                      // YJS binding manages all content updates directly on the model.
                      // Using value= would cause re-renders that fight with YJS and cause focus loss.
                      defaultValue={currentContent}
                      onChange={handleEditorChange}
                      onMount={(editor) => {
                        console.log(`[MonacoIDE] 🎨 Monaco editor mounted`);
                        editorRef.current = editor;
                        editorReadyRef.current = true;
                        
                        // CRITICAL: Add keydown listener to set typing state IMMEDIATELY
                        // This must happen before content changes to block YJS updates
                        const keydownDisposable = editor.onKeyDown((e) => {
                          // Only set typing state for actual character input (not modifiers, arrows, etc.)
                          const isCharacterKey = (e.keyCode >= 48 && e.keyCode <= 90) || // A-Z, 0-9
                                                 (e.keyCode >= 186 && e.keyCode <= 222) || // Punctuation
                                                 e.keyCode === 32 || // Space
                                                 e.keyCode === 13 || // Enter
                                                 e.keyCode === 8 || // Backspace
                                                 e.keyCode === 46; // Delete
                          
                          if (isCharacterKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                            // Set typing state IMMEDIATELY and SYNCHRONOUSLY
                            isTypingRef.current = true;
                            
                            // Update last known content immediately
                            const model = editor.getModel();
                            if (model && selectedFileRef.current) {
                              const currentContent = model.getValue();
                              lastMonacoContentRef.current[selectedFileRef.current] = currentContent;
                              
                              // CRITICAL: Also add to recent changes for echo detection
                              // This ensures echo detection works even if onDidChangeContent hasn't fired yet
                              const changeTimestamp = Date.now();
                              recentMonacoChangesRef.current.push({
                                filePath: selectedFileRef.current,
                                content: currentContent,
                                timestamp: changeTimestamp
                              });
                              // Keep only last 5 changes
                              if (recentMonacoChangesRef.current.length > 5) {
                                recentMonacoChangesRef.current.shift();
                              }
                            }
                            
                            // Clear existing timeout
                            if (typingTimeoutRef.current) {
                              clearTimeout(typingTimeoutRef.current);
                            }
                            
                            // Set new timeout (2 seconds)
                            typingTimeoutRef.current = setTimeout(() => {
                              isTypingRef.current = false;
                              console.log(`[MonacoIDE] ⌨️  Typing state cleared (2000ms idle)`);
                            }, 2000);

                            console.log(`[MonacoIDE] ⌨️  Key pressed - typing state set immediately`, {
                              keyCode: e.keyCode,
                              code: e.code,
                              isTyping: isTypingRef.current
                            });
                          }
                        });
                        
                        // Store disposable for cleanup
                        (editor as any)._keydownDisposable = keydownDisposable;
                        
                        // Focus the editor to ensure keyboard input works
                        editor.focus();
                        
                        // Trigger binding setup if we have a selected file
                        // This ensures binding is created even if useEffect ran before editor was ready
                        if (bucketId && selectedFile) {
                          console.log(`[MonacoIDE] 🔄 Editor mounted - setting up binding for ${selectedFile}`);
                          // Wait a moment for model to be ready, then setup binding
                          setTimeout(() => {
                            if (bucketId && selectedFile && editorRef.current) {
                              const model = editorRef.current.getModel();
                              if (model) {
                                // Call setupYjsBinding directly
                                setupYjsBinding(selectedFile);
                              } else {
                                // Retry after another short delay
                                setTimeout(() => {
                                  if (bucketId && selectedFile && editorRef.current?.getModel()) {
                                    setupYjsBinding(selectedFile);
                                  }
                                }, 200);
                              }
                            }
                          }, 100);
                        }
                      }}
                      theme="vs"
                      options={{
                        minimap: { enabled: true },
                        fontSize: 14,
                        wordWrap: "on",
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        renderLineHighlight: "all",
                        selectOnLineNumbers: true,
                        roundedSelection: false,
                        readOnly: false,
                        cursorStyle: "line",
                        // Ensure proper keyboard handling
                        acceptSuggestionOnEnter: "on",
                        tabCompletion: "on",
                        quickSuggestions: true,
                        suggestOnTriggerCharacters: true,
                        multiCursorModifier: "ctrlCmd",
                        disableLayerHinting: false,
                          contextmenu: true,
                          quickSuggestionsDelay: 100,
                          // Ensure all standard editor commands work
                          // Don't override any keybindings
                          wordBasedSuggestions: "matchingDocuments",
                          // Allow all standard shortcuts (Cmd+A, Cmd+C, Delete, Backspace, etc.)
                        }}
                      />
                    )
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                      Select a file to edit
                    </div>
                  )}
            </div>
            
            {/* Resize Handle for Terminal */}
            <div
              onMouseDown={handleTerminalResizeStart}
              className="h-1 bg-gray-300 hover:bg-purple-500 cursor-row-resize flex-shrink-0 transition-colors"
              style={{ cursor: isResizingTerminal ? 'row-resize' : 'row-resize' }}
            />
            
            {/* Terminal and VNC Panel - Always shown */}
            <div 
              className="flex flex-col border-t border-gray-200 flex-shrink-0" 
              style={{ height: `${terminalSize}px` }}
            >
              {/* Single Header for Terminal/Desktop Panel */}
              <div className="flex items-center justify-between px-2 py-1 bg-gray-100 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-3.5 h-3.5 text-gray-600" />
                  <span className="text-xs font-medium text-gray-700">
                    {showDesktop ? "Terminal & Desktop" : "Terminal"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {onToggleDesktop && hasTerminal && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onToggleDesktop}
                      title={showDesktop ? "Hide desktop" : "View desktop"}
                      className="h-6 px-2 text-xs"
                    >
                      <Monitor className="w-3 h-3 mr-1" />
                      {showDesktop ? "Hide Desktop" : "View Desktop"}
                    </Button>
                  )}
                </div>
              </div>
              
              {/* Split Content Area: Conditional layout based on layoutMode */}
              {layoutMode === 'side-panel' ? (
                /* Side Panel Mode: Stack Terminal and VNC vertically */
                <div ref={terminalSplitRef} className="flex-1 flex flex-col min-h-0 min-w-0 max-w-full overflow-hidden">
                  {/* Terminal Panel (top half) */}
                  <div 
                    className="flex flex-col flex-1 min-w-0 overflow-hidden"
                    data-terminal-container
                  >
                  {hasTerminal ? (
                    <div 
                      className="flex-1"
                      style={{ position: 'relative', minHeight: 0 }}
                      data-terminal-container
                    >
                      <iframe
                        // NOTE: Do NOT auto-focus terminal on ref, load, or mouseEnter!
                        // This steals focus from Monaco editor and causes typing issues.
                        // Only focus terminal when user explicitly clicks on it.
                        src={containerTerminalUrl}
                        className="w-full h-full border-0"
                        title="Terminal"
                        allow="clipboard-read; clipboard-write"
                        style={{ pointerEvents: 'auto', outline: 'none' }}
                        tabIndex={0}
                        onMouseDown={(e) => {
                          // Focus the iframe ONLY when explicitly clicked
                          const iframe = e.currentTarget as HTMLIFrameElement;
                          e.stopPropagation(); // Prevent parent handlers from interfering
                          try {
                            iframe.focus();
                            iframe.contentWindow?.focus();
                          } catch (err) {
                            // Cross-origin restrictions may prevent this
                            console.log("Could not focus terminal iframe on click:", err);
                          }
                        }}
                        onError={() => {
                          // Iframe failed to load - container is likely disconnected
                          if (!disconnectionDetectedRef.current) {
                            console.warn("[MonacoIDE] Terminal iframe failed to load, disconnecting...");
                            disconnectionDetectedRef.current = true;
                            if (containerHealthCheckRef.current) {
                              clearInterval(containerHealthCheckRef.current);
                              containerHealthCheckRef.current = null;
                            }
                            onContainerKilled?.();
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-gray-50">
                      <div className="text-center text-gray-500">
                        <TerminalIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">Waiting for machine to start...</p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* VNC Resize Handle for Side Panel Mode (vertical) */}
                {showDesktop && hasVnc && (
                  <div
                    className="h-1 w-full bg-gray-300 hover:bg-purple-500 cursor-row-resize flex-shrink-0 transition-colors"
                  />
                )}
                
                {/* VNC Panel (bottom half) - Shown when showDesktop is true */}
                {showDesktop && hasVnc && (
                  <div 
                    className="flex flex-col overflow-hidden flex-1"
                  >
                    {/* VNC Content */}
                    <div 
                      className="flex-1 overflow-hidden"
                      style={{ position: 'relative', minHeight: 0 }}
                    >
                      <iframe
                        src={(() => {
                          if (!containerVncUrl) return '';
                          // Extract the path from the VNC URL (e.g., /vnc/px63ejgn from http://localhost/vnc/px63ejgn)
                          const urlObj = new URL(containerVncUrl);
                          const vncPath = urlObj.pathname.endsWith('/') ? urlObj.pathname.slice(0, -1) : urlObj.pathname;
                          const websockifyPath = `${vncPath}/websockify`;
                          // Construct the full VNC URL with path parameter
                          return `${containerVncUrl}${containerVncUrl.endsWith('/') ? '' : '/'}vnc.html?autoconnect=true&password=vncpassword&resize=scale&path=${encodeURIComponent(websockifyPath)}`;
                        })()}
                        className="w-full h-full border-0"
                        title="Desktop View"
                        allow="clipboard-read; clipboard-write"
                        style={{ 
                          pointerEvents: 'auto', 
                          outline: 'none',
                          maxWidth: '100%',
                          overflow: 'hidden'
                        }}
                        tabIndex={0}
                        onError={() => {
                          // VNC iframe failed to load - container is likely disconnected
                          if (!disconnectionDetectedRef.current) {
                            console.warn("[MonacoIDE] VNC iframe failed to load, disconnecting...");
                            disconnectionDetectedRef.current = true;
                            if (containerHealthCheckRef.current) {
                              clearInterval(containerHealthCheckRef.current);
                              containerHealthCheckRef.current = null;
                            }
                            onContainerKilled?.();
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              ) : (
                /* Normal Mode: Terminal on left, VNC on right */
                <div ref={terminalSplitRef} className="flex-1 flex min-h-0 min-w-0 max-w-full overflow-hidden">
                  {/* Terminal Panel */}
                  <div 
                    className="flex flex-col flex-1 min-w-0 overflow-hidden"
                    data-terminal-container
                  >
                    {hasTerminal ? (
                      <div 
                        className="flex-1"
                        style={{ position: 'relative', minHeight: 0 }}
                        data-terminal-container
                      >
                        <iframe
                          // NOTE: Do NOT auto-focus terminal on ref, load, or mouseEnter!
                          // This steals focus from Monaco editor and causes typing issues.
                          // Only focus terminal when user explicitly clicks on it.
                          src={containerTerminalUrl}
                          className="w-full h-full border-0"
                          title="Terminal"
                          allow="clipboard-read; clipboard-write"
                          style={{ pointerEvents: 'auto', outline: 'none' }}
                          tabIndex={0}
                          onMouseDown={(e) => {
                            // Focus the iframe ONLY when explicitly clicked
                            const iframe = e.currentTarget as HTMLIFrameElement;
                            e.stopPropagation(); // Prevent parent handlers from interfering
                            try {
                              iframe.focus();
                              iframe.contentWindow?.focus();
                            } catch (err) {
                              // Cross-origin restrictions may prevent this
                              console.log("Could not focus terminal iframe on click:", err);
                            }
                          }}
                          onError={() => {
                            // Iframe failed to load - container is likely disconnected
                            if (!disconnectionDetectedRef.current) {
                              console.warn("[MonacoIDE] Terminal iframe failed to load, disconnecting...");
                              disconnectionDetectedRef.current = true;
                              if (containerHealthCheckRef.current) {
                                clearInterval(containerHealthCheckRef.current);
                                containerHealthCheckRef.current = null;
                              }
                              onContainerKilled?.();
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center bg-gray-50">
                        <div className="text-center text-gray-500">
                          <TerminalIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                          <p className="text-sm">Waiting for machine to start...</p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* VNC Resize Handle - wider invisible hit area for better tracking */}
                  {showDesktop && hasVnc && (
                    <div
                      onMouseDown={handleVncResizeStart}
                      className="flex-shrink-0 relative"
                      style={{ 
                        width: '4px',
                        cursor: 'col-resize',
                        zIndex: 10
                      }}
                    >
                      {/* Visible handle */}
                      <div className="absolute inset-y-0 left-0 w-1 bg-gray-300 hover:bg-purple-500 transition-colors" />
                      {/* Invisible wider hit area */}
                      <div 
                        className="absolute inset-y-0 -left-2 -right-2" 
                        style={{ cursor: 'col-resize' }}
                      />
                    </div>
                  )}
                  
                  {/* VNC Panel - Shown when showDesktop is true */}
                  {showDesktop && hasVnc && (
                    <div 
                      className="flex flex-col overflow-hidden"
                      style={{ 
                        width: `${vncSize}px`,
                        minWidth: '200px',
                        maxWidth: `${vncSize}px`,
                        flexShrink: 0,
                        flexGrow: 0
                      }}
                    >
                      {/* VNC Content */}
                      <div 
                        className="flex-1 overflow-hidden"
                        style={{ position: 'relative', minHeight: 0 }}
                      >
                        <iframe
                          src={(() => {
                            if (!containerVncUrl) return '';
                            // Extract the path from the VNC URL (e.g., /vnc/px63ejgn from http://localhost/vnc/px63ejgn)
                            const urlObj = new URL(containerVncUrl);
                            const vncPath = urlObj.pathname.endsWith('/') ? urlObj.pathname.slice(0, -1) : urlObj.pathname;
                            const websockifyPath = `${vncPath}/websockify`;
                            // Construct the full VNC URL with path parameter
                            return `${containerVncUrl}${containerVncUrl.endsWith('/') ? '' : '/'}vnc.html?autoconnect=true&password=vncpassword&resize=scale&path=${encodeURIComponent(websockifyPath)}`;
                          })()}
                          className="w-full h-full border-0"
                          title="Desktop View"
                          allow="clipboard-read; clipboard-write"
                          style={{ 
                            pointerEvents: 'auto', 
                            outline: 'none',
                            maxWidth: '100%',
                            overflow: 'hidden'
                          }}
                          tabIndex={0}
                          onError={() => {
                            // VNC iframe failed to load - container is likely disconnected
                            if (!disconnectionDetectedRef.current) {
                              console.warn("[MonacoIDE] VNC iframe failed to load, disconnecting...");
                              disconnectionDetectedRef.current = true;
                              if (containerHealthCheckRef.current) {
                                clearInterval(containerHealthCheckRef.current);
                                containerHealthCheckRef.current = null;
                              }
                              onContainerKilled?.();
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonacoIDE;


