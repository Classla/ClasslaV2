import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "../../../hooks/useTheme";
import Editor from "@monaco-editor/react";
import { Terminal as TerminalIcon, ChevronRight, ChevronLeft, RefreshCw, Monitor, Play, Loader2, Files, Power, ExternalLink, PanelLeft, History, Clock, Settings } from "lucide-react";
import type { FileVersion } from "../../../hooks/useFileHistory";
import FileExplorer, { FileNode, getFileIcon } from "./FileExplorer";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Label } from "../../ui/label";
import { otProvider, OTDocumentClient } from "../../../lib/otClient";
import { MonacoOTBinding, CursorData } from "../../../lib/monacoOTBinding";
import * as monaco from "monaco-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
// Custom resize implementation - no Allotment needed

// Binary file detection by extension
const BINARY_EXTENSIONS = new Set([
  'class', 'jar', 'war', 'o', 'obj', 'exe', 'dll', 'so', 'dylib',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
  'pdf', 'zip', 'tar', 'gz', 'bz2', '7z', 'rar',
  'wasm', 'bin', 'dat', 'pyc', 'pyo', 'ttf', 'otf', 'woff', 'woff2',
]);
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTENSIONS.has(ext || '');
}

// (Client ID and echo detection removed - OT protocol handles this)

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
  currentUser?: { id: string; name: string; color: string };
  // History mode props (grading view only)
  historyMode?: boolean;
  historyContent?: string | null;
  historyVersions?: FileVersion[];
  historyVersionIndex?: number;
  isLoadingVersions?: boolean;
  isLoadingContent?: boolean;
  onHistoryVersionChange?: (index: number) => void;
  onHistoryToggle?: () => void;
  onHistoryFileChange?: (filePath: string) => void;
  onSelectedFileChange?: (filePath: string) => void;
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
  currentUser,
  historyMode = false,
  historyContent,
  historyVersions = [],
  historyVersionIndex = 0,
  isLoadingVersions = false,
  isLoadingContent = false,
  onHistoryVersionChange,
  onHistoryToggle,
  onHistoryFileChange,
  onSelectedFileChange,
}) => {
  const { toast } = useToast();
  const { isDark } = useTheme();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]); // Track open tabs
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set()); // Track which files are loading
  const [activePanel, setActivePanel] = useState<"files" | "settings" | null>(null);
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(() => {
    return localStorage.getItem('ide-show-hidden-files') === 'true';
  });
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({}); // Track save status per file
  const editorRef = useRef<any>(null);
  const editorReadyRef = useRef<boolean>(false); // Track if editor is mounted and ready
  const otBindingsRef = useRef<Record<string, MonacoOTBinding>>({}); // Track OT bindings per file
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalSplitRef = useRef<HTMLDivElement>(null); // Ref for terminal/VNC split container
  const pendingSavesRef = useRef<Set<string>>(new Set()); // Track files with pending saves
  const selectedFileRef = useRef<string | null>(null); // Track selected file in ref for binding checks
  const containerHealthCheckRef = useRef<NodeJS.Timeout | null>(null); // Track health check interval
  const disconnectionDetectedRef = useRef<boolean>(false); // Track if disconnection was already detected
  const saveStatusTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({}); // Track debounced save status updates per file
  const instanceIdRef = useRef(`ide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`); // Unique ID per MonacoIDE instance for local cursor dispatch
  const pendingRenamePathsRef = useRef<Set<string>>(new Set()); // Track paths that were just renamed — suppress content overwrite on reconnect
  const setupOTBindingRef = useRef<((filePath: string) => void) | null>(null); // Ref to setupOTBinding for use in callbacks declared before it
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

  // Side-panel toggle states (persisted to localStorage)
  const [showTerminal, setShowTerminal] = useState<boolean>(() => {
    const saved = localStorage.getItem('ide-show-terminal');
    return saved === null ? true : saved === 'true';
  });
  const [sidePanelVncHeight, setSidePanelVncHeight] = useState<number>(() => {
    const saved = localStorage.getItem('ide-side-panel-vnc-height');
    return saved ? parseInt(saved, 10) : 250;
  });

  // Persist showHiddenFiles to localStorage
  useEffect(() => {
    localStorage.setItem('ide-show-hidden-files', String(showHiddenFiles));
  }, [showHiddenFiles]);

  // Persist showTerminal to localStorage
  useEffect(() => {
    localStorage.setItem('ide-show-terminal', String(showTerminal));
  }, [showTerminal]);

  // Filter hidden files (dot-files/folders and .class files) from file tree
  const filterHiddenFiles = useCallback((nodes: FileNode[]): FileNode[] => {
    return nodes
      .filter((node) => {
        const name = node.name;
        if (name.startsWith('.')) return false;
        if (node.type === 'file' && name.endsWith('.class')) return false;
        return true;
      })
      .map((node) => {
        if (node.children) {
          return { ...node, children: filterHiddenFiles(node.children) };
        }
        return node;
      });
  }, []);

  const displayFiles = useMemo(() => {
    return showHiddenFiles ? files : filterHiddenFiles(files);
  }, [files, showHiddenFiles, filterHiddenFiles]);

  // Terminal URL readiness probe - ensures Traefik route is propagated before rendering iframe
  const [terminalUrlReady, setTerminalUrlReady] = useState(false);
  const terminalProbeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalProbeAttemptsRef = useRef(0);

  useEffect(() => {
    // Cleanup any existing probe
    if (terminalProbeRef.current) {
      clearInterval(terminalProbeRef.current);
      terminalProbeRef.current = null;
    }
    terminalProbeAttemptsRef.current = 0;

    // Reset readiness when URL changes or disappears
    if (!containerTerminalUrl || !containerId) {
      setTerminalUrlReady(false);
      return;
    }

    const probeUrl = containerTerminalUrl;
    const MAX_ATTEMPTS = 20; // 20 * 500ms = 10s max

    const probe = async () => {
      try {
        const resp = await fetch(probeUrl, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(2000) });
        // 404 means Traefik route not propagated yet; anything else (200/302/401) means route exists
        if (resp.status !== 404) {
          console.log('[MonacoIDE] Terminal URL verified accessible', probeUrl);
          setTerminalUrlReady(true);
          if (terminalProbeRef.current) {
            clearInterval(terminalProbeRef.current);
            terminalProbeRef.current = null;
          }
          return;
        }
      } catch {
        // Network error / timeout - keep retrying
      }

      terminalProbeAttemptsRef.current++;
      if (terminalProbeAttemptsRef.current >= MAX_ATTEMPTS) {
        console.warn('[MonacoIDE] Terminal URL probe timed out after 10s, showing iframe anyway');
        setTerminalUrlReady(true);
        if (terminalProbeRef.current) {
          clearInterval(terminalProbeRef.current);
          terminalProbeRef.current = null;
        }
      }
    };

    // Run first probe immediately
    probe();
    terminalProbeRef.current = setInterval(probe, 500);

    return () => {
      if (terminalProbeRef.current) {
        clearInterval(terminalProbeRef.current);
        terminalProbeRef.current = null;
      }
    };
  }, [containerTerminalUrl, containerId]);

  // Auto-show terminal when container is ready and URL probe has passed
  const hasTerminal = !!(containerId && containerTerminalUrl && terminalUrlReady);
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

  // Handle side-panel VNC resize (vertical) - resizes from top of VNC panel
  const handleSidePanelVncResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (!terminalSplitRef.current) return;

    // Capture initial state at drag start to avoid feedback loops
    const splitRect = terminalSplitRef.current.getBoundingClientRect();
    const startY = e.clientY;
    const initialHeight = sidePanelVncHeight;

    // Disable pointer events on iframes so they don't swallow mousemove events
    const iframes = terminalSplitRef.current.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      (iframe as HTMLIFrameElement).style.pointerEvents = 'none';
    });

    let currentHeight = initialHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Dragging up (negative deltaY) → VNC grows; dragging down → VNC shrinks
      const deltaY = startY - moveEvent.clientY;
      const newHeight = initialHeight + deltaY;
      const minHeight = 150;
      const maxHeight = splitRect.height - 100;
      const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      currentHeight = clampedHeight;
      setSidePanelVncHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      iframes.forEach((iframe) => {
        (iframe as HTMLIFrameElement).style.pointerEvents = 'auto';
      });
      localStorage.setItem('ide-side-panel-vnc-height', currentHeight.toString());
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidePanelVncHeight]);

  // Toggle panel - if clicking the same panel, close it
  const togglePanel = useCallback((panel: "files" | "settings") => {
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

  const runnableFiles = useMemo(() => {
    return availableFiles.filter((f) => f.endsWith(".java") || f.endsWith(".py"));
  }, [availableFiles]);

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

      // Filter out recently deleted files (S3 deletion may be async/slow)
      const recentlyDeleted = recentlyDeletedFilesRef.current;
      const filterDeleted = (nodes: FileNode[]): FileNode[] => {
        return nodes
          .filter((node) => !recentlyDeleted.has(node.path))
          .map((node) => {
            if (node.type === "folder" && node.children) {
              return { ...node, children: filterDeleted(node.children) };
            }
            return node;
          });
      };
      const filteredFiles = recentlyDeleted.size > 0 ? filterDeleted(s3Files) : s3Files;

      // Merge with recently created files that might not be in S3 yet
      // This prevents files from disappearing during the save window
      const recentlyCreated = Array.from(recentlyCreatedFilesRef.current);
      const allFiles = [...filteredFiles];

      // Add recently created files that aren't in S3 yet
      for (const filePath of recentlyCreated) {
        const exists = getAllFilePaths(filteredFiles).includes(filePath);
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

  // Load file content - OT server is the source of truth
  const loadFile = useCallback(
    async (filePath: string, forceReload: boolean = false) => {
      if (!bucketId) return;

      // Skip OT subscription for binary files — they can't be collaboratively edited
      if (isBinaryFile(filePath)) {
        return;
      }

      setLoadingFiles((prev) => new Set(prev).add(filePath));

      try {
        // Subscribe to OT document only if not already loaded
        const existingDoc = otProvider.getDocument(bucketId, filePath);
        if (!existingDoc) {
          otProvider.subscribeToDocument(bucketId, filePath);
        }

        // Check if OT already has content (previous subscription)
        const doc = existingDoc || otProvider.getDocument(bucketId, filePath);
        const content = doc?.content || "";

        console.log(`[MonacoIDE] Loading file ${filePath}`, {
          contentLength: content.length,
          forceReload,
        });

        setFileContent((prev) => ({ ...prev, [filePath]: content }));
      } catch (error: any) {
        console.error(`[MonacoIDE] Failed to load file ${filePath}:`, error);
        setFileContent((prev) => ({ ...prev, [filePath]: "" }));
      } finally {
        setLoadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(filePath);
          return next;
        });
      }
    },
    [bucketId]
  );

  // Save file to S3 (OT handles real-time sync, this is for explicit saves)
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

        // Save directly to S3 for persistence (OT handles sync automatically)
        await apiClient.saveS3File(bucketId, filePath, content);
        console.log(`[MonacoIDE] Saved ${filePath} to S3`);
        setFileContent((prev) => ({ ...prev, [filePath]: content }));
      } catch (error: any) {
        console.error(`[MonacoIDE] Failed to save file ${filePath}:`, error);
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
      // Clean up binding for previously selected file before switching
      if (selectedFile && selectedFile !== path && otBindingsRef.current[selectedFile]) {
        otBindingsRef.current[selectedFile].destroy();
        delete otBindingsRef.current[selectedFile];
      }

      setOpenTabs((prev) => {
        if (!prev.includes(path)) {
          return [...prev, path];
        }
        return prev;
      });
      setSelectedFile(path);
      selectedFileRef.current = path;

      // Notify history hook when switching files during history mode
      if (historyMode) {
        onHistoryFileChange?.(path);
      }

      // Subscribe to OT document only if not already loaded (skip for binary files)
      if (bucketId && !isBinaryFile(path)) {
        const existingDoc = otProvider.getDocument(bucketId, path);
        if (!existingDoc) {
          otProvider.subscribeToDocument(bucketId, path);
        }
        const doc = existingDoc || otProvider.getDocument(bucketId, path);
        const content = doc?.content || "";

        if (content) {
          setFileContent((prev) => ({ ...prev, [path]: content }));
        } else {
          loadFile(path, false);
        }
      }
    },
    [bucketId, loadFile, selectedFile, historyMode, onHistoryFileChange]
  );

  // Handle tab close
  const handleCloseTab = useCallback(
    (path: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setOpenTabs((prev) => prev.filter((p) => p !== path));
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
      // Clean up OT binding
      if (otBindingsRef.current[path]) {
        otBindingsRef.current[path].destroy();
        delete otBindingsRef.current[path];
      }
      // Unsubscribe from OT document
      if (bucketId) {
        otProvider.unsubscribeDocument(bucketId, path);
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

  // Handle editor change - OT binding handles sync automatically
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      // OT binding handles actual sync; we only update local state for UI
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

      // Broadcast file creation to other tabs via OT WebSocket
      const socket = otProvider.socketInstance;
      if (otProvider.connected && socket) {
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
      // This properly handles OT subscription and binding setup without duplication
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
      
      // Don't reload file tree immediately - let OT handle the sync
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

      // Clean up OT resources
      if (otBindingsRef.current[path]) {
        otBindingsRef.current[path].destroy();
        delete otBindingsRef.current[path];
      }
      if (bucketId) {
        otProvider.unsubscribeDocument(bucketId, path);
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

      // Broadcast file deletion to other tabs via OT WebSocket
      const socket = otProvider.socketInstance;
      if (otProvider.connected && socket) {
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

      // Get content from OT document (if available) BEFORE any cleanup
      let content = "";
      const doc = otProvider.getDocument(bucketId, oldPath);
      if (doc) {
        content = doc.content;
      } else if (fileContent[oldPath] !== undefined) {
        content = fileContent[oldPath];
      }

      // Clean up old OT binding + unsubscribe BEFORE the rename
      if (otBindingsRef.current[oldPath]) {
        otBindingsRef.current[oldPath].destroy();
        delete otBindingsRef.current[oldPath];
      }
      otProvider.unsubscribeDocument(bucketId, oldPath);

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

      // Update file content state with the saved content
      setFileContent((prev) => {
        const next = { ...prev };
        delete next[oldPath];
        next[newPath] = content;
        return next;
      });

      // Rename file server-side (S3 CopyObject + DeleteObject)
      // The backend force-saves OT content to S3 first, then copies
      try {
        await apiClient.renameS3File(bucketId, oldPath, newPath);
      } catch (error: any) {
        console.error("Failed to rename file in S3:", error);
        toast({
          title: "Failed to sync rename",
          description: `File renamed locally but failed to sync: ${error.message}`,
          variant: "destructive",
        });
        loadFileTree();
        return;
      }

      // Mark path as recently renamed — setupOTBinding will skip overwriting Monaco
      // since force-save before rename ensures S3 content matches the editor
      pendingRenamePathsRef.current.add(newPath);
      setTimeout(() => pendingRenamePathsRef.current.delete(newPath), 10000);

      // Subscribe to new OT path AFTER the S3 rename succeeds
      // so the server loads the correct content from S3
      otProvider.subscribeToDocument(bucketId, newPath);
      // Set the content we captured to ensure editor has the right content
      // even before the OT document fully loads from S3
      setFileContent((prev) => ({ ...prev, [newPath]: content }));

      // Explicitly set up OT binding after document-state arrives.
      // The useEffect/onMount chain is unreliable during rename because
      // the editor remounts (key change) during the await, and by the time
      // their timeouts fire, the old editor is disposed (model=null → silent return).
      // The subscription is only sent HERE (after the await), so we need to
      // explicitly bridge the gap.
      otProvider.onDocumentReady(bucketId, newPath, () => {
        console.log(`[MonacoIDE] Rename: document ready for ${newPath}, setting up binding`);
        // Use requestAnimationFrame to ensure we're after React's commit phase
        // (editor should already be mounted since the await took hundreds of ms)
        requestAnimationFrame(() => {
          const bindFn = setupOTBindingRef.current;
          if (!bindFn) return;
          if (editorRef.current && editorRef.current.getModel()) {
            bindFn(newPath);
          } else {
            // Fallback: editor may still be initializing, retry after a short delay
            setTimeout(() => {
              const fn = setupOTBindingRef.current;
              if (fn && editorRef.current && editorRef.current.getModel()) {
                fn(newPath);
              } else {
                console.warn(`[MonacoIDE] Rename: editor not ready for binding after rename to ${newPath}`);
              }
            }, 200);
          }
        });
      });

      // Mark new file as recently created to prevent disappearing during S3 save
      recentlyCreatedFilesRef.current.add(newPath);
      setTimeout(() => {
        recentlyCreatedFilesRef.current.delete(newPath);
      }, 15000);

      // Reload file tree after delay to catch any missed updates
      // (server also broadcasts file-tree-change events)
      setTimeout(() => {
        loadFileTree();
      }, 3000);
    },
    [bucketId, files, fileContent, selectedFile, toast, loadFileTree]
  );

  // Connect to OT provider (singleton — don't disconnect on unmount since other instances may use it)
  useEffect(() => {
    if (!bucketId) return;
    const backendApiUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
    otProvider.connect(backendApiUrl, bucketId);
  }, [bucketId]);

  // Setup OT binding for a file
  const setupOTBinding = useCallback((filePath: string) => {
    if (!bucketId || !filePath || !editorRef.current) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    // Clean up existing binding for this file
    if (otBindingsRef.current[filePath]) {
      otBindingsRef.current[filePath].destroy();
      delete otBindingsRef.current[filePath];
    }

    // Get OT document client
    const doc = otProvider.getDocument(bucketId, filePath);
    if (!doc) {
      console.log(`[MonacoIDE] OT document not ready for ${filePath}, waiting for server...`);
      // Register a callback to set up the binding when the document arrives
      const cleanup = otProvider.onDocumentReady(bucketId, filePath, () => {
        console.log(`[MonacoIDE] Document ready callback for ${filePath}`);
        setupOTBinding(filePath);
      });
      // Store cleanup so it can be cancelled if needed
      if (!otBindingsRef.current[`__pending_${filePath}`]) {
        (otBindingsRef.current as any)[`__pending_${filePath}`] = { destroy: cleanup };
      }
      return;
    }
    // Clean up pending callback if we got here directly
    if ((otBindingsRef.current as any)[`__pending_${filePath}`]) {
      delete (otBindingsRef.current as any)[`__pending_${filePath}`];
    }

    // Reconcile editor content with OT document content
    const modelContent = model.getValue();
    const isRecentRename = pendingRenamePathsRef.current.has(filePath);
    pendingRenamePathsRef.current.delete(filePath);

    if (modelContent !== doc.content) {
      if (isRecentRename) {
        // After rename: force-save ensured S3 (and thus OT) has our content.
        // Content should match in most cases. If it doesn't (rare timing issue),
        // accept the server's content — it's better than sending a replace-all
        // operation that risks OT state corruption.
        console.log(`[OT] Rename content mismatch for ${filePath} (editor: ${modelContent.length}, server: ${doc.content.length}). Accepting server content.`);
      }
      if (doc.content) {
        // OT is source of truth — overwrite editor
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: doc.content }],
          () => null
        );
        // Monaco may normalize \r\n → \n; read back to keep doc.content in sync
        const normalized = model.getValue();
        if (normalized !== doc.content) {
          doc.content = normalized;
        }
      }
    }

    // Create binding
    const binding = new MonacoOTBinding(model, editor, doc);
    otBindingsRef.current[filePath] = binding;

    // Set up cursor change tracking (send local cursor to other clients)
    if (currentUser) {
      const documentId = `${bucketId}:${filePath}`;
      binding.onCursorChange = (data: CursorData) => {
        // Send to server for remote clients (different sockets)
        otProvider.sendCursorUpdate(
          documentId,
          data.cursor,
          data.selection,
          { name: currentUser.name, color: currentUser.color }
        );
        // Also dispatch locally for same-page editors (server excludes sender socket)
        window.dispatchEvent(new CustomEvent("ot-remote-cursor", {
          detail: {
            documentId,
            clientId: instanceIdRef.current,
            cursor: data.cursor,
            selection: data.selection,
            user: { name: currentUser.name, color: currentUser.color },
            sourceInstanceId: instanceIdRef.current,
          }
        }));
      };
    }

    // Set up save status tracking
    doc.addSaveStatusListener(binding.bindingId, (status) => {
      // Debounce save status updates
      if (saveStatusTimeoutRef.current[filePath]) {
        clearTimeout(saveStatusTimeoutRef.current[filePath]);
      }
      saveStatusTimeoutRef.current[filePath] = setTimeout(() => {
        setSaveStatus((prev) => ({ ...prev, [filePath]: status }));
      }, status === "saved" ? 500 : 0);
    });

    console.log(`[MonacoIDE] OT binding created for ${filePath} (rev=${doc.revision})`);
  }, [bucketId, currentUser]);
  setupOTBindingRef.current = setupOTBinding;

  // Update Monaco editor theme when dark mode changes
  useEffect(() => {
    monaco.editor.setTheme(isDark ? "vs-dark" : "vs");
  }, [isDark]);

  // Set up binding when file changes or editor becomes ready
  useEffect(() => {
    if (bucketId && selectedFile && editorRef.current && editorReadyRef.current) {
      const timeout = setTimeout(() => {
        if (bucketId && selectedFile && editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            setupOTBinding(selectedFile);
          }
        }
      }, 50);

      return () => clearTimeout(timeout);
    }
  }, [bucketId, selectedFile, setupOTBinding]);

  // Notify parent whenever the selected file changes (covers auto-open, tab clicks, etc.)
  useEffect(() => {
    if (selectedFile) {
      onSelectedFileChange?.(selectedFile);
    }
  }, [selectedFile, onSelectedFileChange]);

  // History mode: destroy OT binding when entering, restore when exiting
  const prevHistoryModeRef = useRef(false);
  useEffect(() => {
    if (!editorRef.current || !selectedFile) return;

    const editor = editorRef.current;

    if (historyMode && !prevHistoryModeRef.current) {
      // Entering history mode — destroy OT binding for current file
      if (otBindingsRef.current[selectedFile]) {
        otBindingsRef.current[selectedFile].destroy();
        delete otBindingsRef.current[selectedFile];
      }
      // Set read-only
      editor.updateOptions({ readOnly: true });
    } else if (!historyMode && prevHistoryModeRef.current) {
      // Exiting history mode — re-establish OT binding
      editor.updateOptions({ readOnly: false });
      // Restore original content from OT before re-binding
      if (bucketId && selectedFile) {
        const doc = otProvider.getDocument(bucketId, selectedFile);
        if (doc) {
          const model = editor.getModel();
          if (model) {
            model.pushEditOperations(
              [],
              [{ range: model.getFullModelRange(), text: doc.content }],
              () => null
            );
          }
        }
        setupOTBinding(selectedFile);
      }
    }

    prevHistoryModeRef.current = historyMode;
  }, [historyMode, selectedFile, bucketId, setupOTBinding]);

  // History mode: update editor content when version content changes
  useEffect(() => {
    if (!historyMode || !editorRef.current) return;
    if (historyContent === null || historyContent === undefined) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (model) {
      // Preserve scroll position
      const scrollTop = editor.getScrollTop();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: historyContent }],
        () => null
      );
      editor.setScrollTop(scrollTop);
    }
  }, [historyMode, historyContent]);

  // Track recently created files to prevent premature S3 reloads
  const recentlyCreatedFilesRef = useRef<Set<string>>(new Set());
  // Track recently deleted files to prevent S3 reloads from resurrecting them
  const recentlyDeletedFilesRef = useRef<Set<string>>(new Set());

  // Load file tree on mount and when bucketId changes
  useEffect(() => {
    loadFileTree();
  }, [bucketId]); // Only depend on bucketId, not loadFileTree to prevent unnecessary reloads

  // OT handles remote updates via MonacoOTBinding — no manual sync needed.
  // The binding's onContentChanged callback updates Monaco directly.

  // Listen for file tree changes from other tabs
  useEffect(() => {
    const handleFileTreeChange = (event: CustomEvent) => {
      const { bucketId: changedBucketId, filePath, action } = event.detail;
      if (changedBucketId !== bucketId) return;

      if (action === "delete") {
        // Track as recently deleted so loadFileTree (S3) doesn't resurrect it
        recentlyDeletedFilesRef.current.add(filePath);
        setTimeout(() => recentlyDeletedFilesRef.current.delete(filePath), 15000);

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
        
        // Clean up OT resources for deleted file
        if (otBindingsRef.current[filePath]) {
          otBindingsRef.current[filePath].destroy();
          delete otBindingsRef.current[filePath];
        }
        if (bucketId) {
          otProvider.unsubscribeDocument(bucketId, filePath);
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

        let fileAlreadyExists = false;
        setFiles((prev) => {
          // Check if file already exists (e.g. from rename's optimistic update)
          const exists = getAllFilePaths(prev).includes(filePath);
          if (exists) {
            fileAlreadyExists = true;
            return prev;
          }

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

        // Only subscribe to OT if this is a genuinely new file (not from a rename)
        // Rename already handles its own OT subscription — double-subscribing
        // causes the editor content to be overwritten with stale S3 content
        if (bucketId && !fileAlreadyExists) {
          try {
            otProvider.subscribeToDocument(bucketId, filePath);
            const doc = otProvider.getDocument(bucketId, filePath);
            const content = doc?.content || "";
            if (content) {
              setFileContent((prev) => {
                if (!prev[filePath] || content.length > (prev[filePath]?.length || 0)) {
                  return { ...prev, [filePath]: content };
                }
                return prev;
              });
            }
          } catch (error) {
            console.warn(`[MonacoIDE] Failed to subscribe to OT for new file ${filePath}:`, error);
          }
        }

      // CRITICAL: Do NOT reload file tree after file-tree-change create events
      // The file is already added optimistically above, and we track it in recentlyCreatedFilesRef
      // Reloading from S3 would cause the file to disappear if it hasn't been saved yet
      // The file will be included in future S3 reloads once it's saved (within 15 seconds)
      }
    };

    window.addEventListener("ot-file-tree-change", handleFileTreeChange as EventListener);
    return () => {
      window.removeEventListener("ot-file-tree-change", handleFileTreeChange as EventListener);
    };
  }, [bucketId, selectedFile, openTabs, loadFileTree]);

  // Listen for OT connection restoration to update save status
  useEffect(() => {
    const handleConnectionRestored = () => {
      console.log(`[MonacoIDE] OT connection restored - updating save status`);
      for (const filePath of openTabs) {
        if (otProvider.connected) {
          setSaveStatus((prev) => {
            if (prev[filePath] === "error") {
              return { ...prev, [filePath]: "saved" };
            }
            return prev;
          });
        }
      }
    };

    window.addEventListener("ot-connection-restored", handleConnectionRestored);
    return () => {
      window.removeEventListener("ot-connection-restored", handleConnectionRestored);
    };
  }, [openTabs]);

  // Listen for remote cursor events and render them
  useEffect(() => {
    const handleRemoteCursor = (event: CustomEvent) => {
      const { documentId, clientId, cursor, selection, user, sourceInstanceId } = event.detail;
      if (!bucketId || !selectedFileRef.current) return;

      // Skip cursor events dispatched by this same MonacoIDE instance
      if (sourceInstanceId && sourceInstanceId === instanceIdRef.current) return;

      // Only process cursor events for the currently selected file
      const expectedDocId = `${bucketId}:${selectedFileRef.current}`;
      if (documentId !== expectedDocId) return;

      // Find the active binding for the selected file
      const binding = otBindingsRef.current[selectedFileRef.current];
      if (binding) {
        binding.updateRemoteCursor(clientId, user.name, user.color, cursor, selection);
      }
    };

    window.addEventListener("ot-remote-cursor", handleRemoteCursor as EventListener);
    return () => {
      window.removeEventListener("ot-remote-cursor", handleRemoteCursor as EventListener);
    };
  }, [bucketId]);

  // Re-subscribe to current document on visibility change for sync robustness
  // Only re-subscribe if the socket was disconnected (document lost)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && bucketId && selectedFileRef.current) {
        const existingDoc = otProvider.getDocument(bucketId, selectedFileRef.current);
        if (!existingDoc) {
          // Document was lost (socket disconnected) — re-subscribe
          console.log(`[MonacoIDE] Tab visible again, re-subscribing to ${selectedFileRef.current}`);
          otProvider.subscribeToDocument(bucketId, selectedFileRef.current);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [bucketId]);

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
        if (bucketId) {
          try {
            const doc = otProvider.getDocument(bucketId, filePath);
            const content = doc?.content || "";

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
        const doc = otProvider.getDocument(bucketId, filePath);
        if (doc) {
          const content = doc.content;

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

  // Expose OT debug info to window for debugging
  useEffect(() => {
    (window as any).monacoIDEDebug = () => {
      const docs = bucketId ? otProvider.getDocumentsForBucket(bucketId) : new Map();
      const info: Record<string, any> = {};
      docs.forEach((doc, key) => {
        info[key] = { revision: doc.revision, contentLength: doc.content.length, state: doc.state.type };
      });
      console.table(info);
      return info;
    };
  }, [bucketId]);

  // Cleanup OT bindings on unmount
  useEffect(() => {
    return () => {
      // Force save all files before cleanup
      if (bucketId) {
        for (const filePath of openTabs) {
          const doc = otProvider.getDocument(bucketId, filePath);
          if (doc) {
            apiClient.saveS3File(bucketId, filePath, doc.content).catch((error) => {
              console.error(`[MonacoIDE] Failed to save ${filePath} on unmount:`, error);
            });
          }
        }
      }

      // Clean up all OT bindings
      Object.values(otBindingsRef.current).forEach((binding) => {
        binding.destroy();
      });
      otBindingsRef.current = {};
    };
  }, [bucketId, openTabs]);

  const currentContent = selectedFile ? fileContent[selectedFile] || "" : "";

  return (
    <div 
      className="flex flex-col h-full bg-card border border-border rounded-lg overflow-hidden"
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
      <div className="flex items-center justify-between p-2 border-b border-border bg-muted">
        {/* Left side - Stop Machine button */}
        <div className="flex items-center gap-2">
          {containerId && containerWebServerUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!confirm("Are you sure you want to stop the machine? This will disconnect the container.")) {
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
                      title: "Machine stopped",
                      description: "The container has been shut down.",
                    });
                    // Notify parent component that container was killed
                    onContainerKilled?.();
                  } else {
                    // Even if response is not ok, the container might be shutting down
                    // which could cause the response to fail
                    console.warn("Kill endpoint returned non-OK status:", response.status);
                    toast({
                      title: "Stop request sent",
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
              title="Stop the container machine"
            >
              <Power className="w-4 h-4 mr-1" />
              Stop Machine
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
                  {runnableFiles.length > 0 ? (
                    runnableFiles.map((filePath) => (
                      <SelectItem key={filePath} value={filePath}>
                        {filePath}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value={runFilename} disabled>
                      No runnable files (.java, .py)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onRun?.();
                  // Reload file tree after run to catch container filesystem changes
                  // (e.g. rm -f *.class, new compiled files). Delay allows the run
                  // process + container sync to complete.
                  if (containerId) {
                    setTimeout(() => loadFileTree(), 5000);
                  }
                }}
                disabled={isStarting || historyMode}
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
                    className="text-primary hover:text-primary hover:bg-primary/10 w-8 h-8 p-0"
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
        <div className="w-12 border-r border-border bg-muted flex flex-col items-center py-2 gap-2 flex-shrink-0">
          <button
            onClick={() => togglePanel("files")}
            className={`w-10 h-10 flex items-center justify-center rounded hover:bg-accent transition-colors ${
              activePanel === "files" ? "bg-primary/20 text-primary" : "text-muted-foreground"
            }`}
            title="Toggle file explorer"
          >
            <Files className="w-5 h-5" />
          </button>
          <button
            onClick={() => togglePanel("settings")}
            className={`w-10 h-10 flex items-center justify-center rounded hover:bg-accent transition-colors ${
              activePanel === "settings" ? "bg-primary/20 text-primary" : "text-muted-foreground"
            }`}
            title="Toggle settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Resizable Panels - Custom Implementation */}
        <div ref={containerRef} className="flex-1 flex h-full min-w-0 overflow-hidden">
          {/* Side Panel */}
          {activePanel && (
            <>
              <div 
                className="h-full border-r border-border overflow-hidden flex-shrink-0"
                style={{ 
                  width: `${Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, sidePanelSize))}px`,
                  minWidth: `${SIDE_PANEL_MIN}px`,
                  maxWidth: `${SIDE_PANEL_MAX}px`,
                  display: activePanel ? 'block' : 'none' 
                }}
              >
                {activePanel === "files" && (
                  <FileExplorer
                    files={displayFiles}
                    onFileSelect={handleFileSelect}
                    selectedPath={selectedFile || undefined}
                    onCreateFile={handleCreateFile}
                    onDeleteFile={handleDeleteFile}
                    onRenameFile={handleRenameFile}
                  />
                )}
                {activePanel === "settings" && (
                  <div className="h-full flex flex-col bg-background">
                    <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Settings
                    </div>
                    <div className="p-3 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="show-hidden-files"
                          checked={showHiddenFiles}
                          onCheckedChange={(checked) => setShowHiddenFiles(checked === true)}
                        />
                        <Label htmlFor="show-hidden-files" className="text-sm text-foreground cursor-pointer">
                          Show hidden files
                        </Label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Resize Handle for Side Panel */}
              <div
                onMouseDown={handleSidePanelResizeStart}
                className="w-1 bg-border hover:bg-purple-500 cursor-col-resize flex-shrink-0 transition-colors"
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
                    <div className="flex items-center gap-1 border-b border-border bg-muted overflow-x-auto flex-shrink-0">
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
                                ? "bg-background border-purple-500 dark:border-purple-700 text-foreground dark:text-white"
                                : "border-transparent text-muted-foreground dark:text-gray-400 hover:bg-accent"
                            }`}
                          >
                            {getFileIcon(fileName)}
                            <span className="text-sm whitespace-nowrap">{fileName}</span>
                            {fileStatus === "saving" && (
                              <span title="Saving...">
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
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
                              className="ml-1 hover:bg-accent rounded p-0.5 transition-colors"
                              title="Close tab"
                            >
                              <span className="text-xs">×</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* History Bar (grading view only) */}
                  {onHistoryToggle && (
                    <div className={`flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0 ${
                      historyMode ? "bg-amber-50 border-amber-200" : "bg-muted border-border"
                    }`}>
                      <button
                        onClick={onHistoryToggle}
                        disabled={isLoadingVersions || (selectedFile ? isBinaryFile(selectedFile) : false)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          historyMode
                            ? "bg-amber-200 text-amber-800 hover:bg-amber-300"
                            : "bg-accent text-foreground hover:bg-accent"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <History className="w-3.5 h-3.5" />
                        {historyMode ? "Exit History" : "View History"}
                      </button>

                      {historyMode && (
                        <>
                          {isLoadingVersions ? (
                            <div className="flex items-center gap-1.5 text-xs text-amber-700">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading versions...
                            </div>
                          ) : historyVersions.length === 0 ? (
                            <span className="text-xs text-amber-700">No history available</span>
                          ) : (
                            <>
                              <span className="text-xs text-amber-700">Oldest</span>
                              <input
                                type="range"
                                min={0}
                                max={historyVersions.length - 1}
                                // Slider value is inverted: left=oldest (max index), right=newest (0)
                                value={historyVersions.length - 1 - historyVersionIndex}
                                onChange={(e) => {
                                  const invertedIndex = historyVersions.length - 1 - parseInt(e.target.value);
                                  onHistoryVersionChange?.(invertedIndex);
                                }}
                                className="flex-1 max-w-[300px] h-1.5 accent-amber-500"
                              />
                              <span className="text-xs text-amber-700">Newest</span>

                              {/* Version timestamp */}
                              <div className="flex items-center gap-1 text-xs text-amber-700 ml-2">
                                <Clock className="w-3 h-3" />
                                {historyVersions[historyVersionIndex]?.lastModified
                                  ? new Date(historyVersions[historyVersionIndex].lastModified).toLocaleString()
                                  : "—"}
                              </div>

                              {isLoadingContent && (
                                <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                              )}

                              <span className="ml-auto text-xs font-semibold text-amber-800 bg-amber-200 px-2 py-0.5 rounded">
                                READ ONLY
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-muted-foreground">Loading files...</div>
                    </div>
                  ) : selectedFile ? (
                    isBinaryFile(selectedFile) ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-sm text-muted-foreground">
                          Binary file — cannot be displayed in editor
                        </div>
                      </div>
                    ) : loadingFiles.has(selectedFile) ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                          <div className="text-sm text-muted-foreground">Loading file...</div>
                        </div>
                      </div>
                    ) : (
                    <Editor
                      // Key forces remount when file changes, ensuring new file content loads
                      key={selectedFile}
                      height="100%"
                      language={detectLanguage(selectedFile)}
                      // Use defaultValue instead of value to make Monaco uncontrolled after mount.
                      // OT binding manages all content updates directly on the model.
                      // Using value= would cause re-renders that fight with OT and cause focus loss.
                      defaultValue={currentContent}
                      onChange={handleEditorChange}
                      onMount={(editor) => {
                        console.log(`[MonacoIDE] Monaco editor mounted`);
                        editorRef.current = editor;
                        editorReadyRef.current = true;

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
                                // Call setupOTBinding directly
                                setupOTBinding(selectedFile);
                              } else {
                                // Retry after another short delay
                                setTimeout(() => {
                                  if (bucketId && selectedFile && editorRef.current?.getModel()) {
                                    setupOTBinding(selectedFile);
                                  }
                                }, 200);
                              }
                            }
                          }, 100);
                        }
                      }}
                      theme={isDark ? "vs-dark" : "vs"}
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
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      Select a file to edit
                    </div>
                  )}
            </div>
            
            {/* Resize Handle for Terminal */}
            <div
              onMouseDown={handleTerminalResizeStart}
              className="h-1 bg-border hover:bg-purple-500 cursor-row-resize flex-shrink-0 transition-colors"
              style={{ cursor: isResizingTerminal ? 'row-resize' : 'row-resize' }}
            />
            
            {/* Terminal and VNC Panel - Always shown */}
            <div 
              className="flex flex-col border-t border-border flex-shrink-0" 
              style={{ height: `${terminalSize}px` }}
            >
              {/* Single Header for Terminal/Desktop Panel */}
              <div className="flex items-center justify-between px-2 py-1 bg-muted border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">
                    {layoutMode === 'side-panel'
                      ? (showTerminal && showDesktop ? "Terminal & Desktop" : showTerminal ? "Terminal" : showDesktop ? "Desktop" : "Panels")
                      : (showDesktop ? "Terminal & Desktop" : "Terminal")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Terminal toggle - side-panel mode only */}
                  {layoutMode === 'side-panel' && (
                    <Button
                      variant={showTerminal ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowTerminal((v) => !v)}
                      title={showTerminal ? "Hide Terminal" : "Show Terminal"}
                      className="h-6 px-2 text-xs"
                    >
                      <TerminalIcon className="w-3 h-3 mr-1" />
                      Terminal
                    </Button>
                  )}
                  {/* Desktop toggle */}
                  {onToggleDesktop && (layoutMode === 'side-panel' ? true : hasTerminal) && (
                    <Button
                      variant={showDesktop ? "default" : "outline"}
                      size="sm"
                      onClick={onToggleDesktop}
                      title={showDesktop ? "Hide Desktop" : "View Desktop"}
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
                  {/* Terminal Panel - shown when showTerminal is true */}
                  {showTerminal && (
                    <div
                      className="flex flex-col min-w-0 overflow-hidden flex-1"
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
                              const iframe = e.currentTarget as HTMLIFrameElement;
                              e.stopPropagation();
                              try {
                                iframe.focus();
                                iframe.contentWindow?.focus();
                              } catch (err) {
                                console.log("Could not focus terminal iframe on click:", err);
                              }
                            }}
                            onError={() => {
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
                        <div className="flex-1 flex items-center justify-center bg-muted">
                          <div className="text-center text-muted-foreground">
                            <TerminalIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm">
                              {containerId && containerTerminalUrl
                                ? 'Connecting to terminal...'
                                : 'Waiting for machine to start...'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* VNC Resize Handle (vertical) - only when both panels visible */}
                  {showTerminal && showDesktop && hasVnc && (
                    <div
                      onMouseDown={handleSidePanelVncResizeStart}
                      className="h-1 w-full bg-border hover:bg-purple-500 cursor-row-resize flex-shrink-0 transition-colors"
                    />
                  )}

                  {/* VNC Panel - shown when showDesktop is true */}
                  {showDesktop && hasVnc && (
                    <div
                      className={`flex flex-col overflow-hidden ${!showTerminal ? 'flex-1' : 'flex-shrink-0'}`}
                      style={showTerminal ? { height: `${sidePanelVncHeight}px` } : undefined}
                    >
                      <div
                        className="flex-1 overflow-hidden"
                        style={{ position: 'relative', minHeight: 0 }}
                      >
                        <iframe
                          src={(() => {
                            if (!containerVncUrl) return '';
                            const urlObj = new URL(containerVncUrl);
                            const vncPath = urlObj.pathname.endsWith('/') ? urlObj.pathname.slice(0, -1) : urlObj.pathname;
                            const websockifyPath = `${vncPath}/websockify`;
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

                  {/* Placeholder when neither panel is visible */}
                  {!showTerminal && (!showDesktop || !hasVnc) && (
                    <div className="flex-1 flex items-center justify-center bg-muted">
                      <p className="text-sm text-muted-foreground">No panels visible</p>
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
                      <div className="flex-1 flex items-center justify-center bg-muted">
                        <div className="text-center text-muted-foreground">
                          <TerminalIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm">
                            {containerId && containerTerminalUrl
                              ? 'Connecting to terminal...'
                              : 'Waiting for machine to start...'}
                          </p>
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
                      <div className="absolute inset-y-0 left-0 w-1 bg-border hover:bg-purple-500 transition-colors" />
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


