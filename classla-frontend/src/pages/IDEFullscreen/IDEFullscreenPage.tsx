import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, AlertCircle } from "lucide-react";
import MonacoIDE from "../../components/Blocks/IDE/MonacoIDE";
import { Button } from "../../components/ui/button";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import { fetchWithNetworkRetry } from "../../components/Blocks/IDE/fetchWithNetworkRetry";


const PRODUCTION_IDE_API_BASE_URL =
  import.meta.env.VITE_IDE_API_BASE_URL || "https://ide.classla.org";

// Deterministic color from user ID for cursor sharing
const CURSOR_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
];
function userIdToColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

interface ContainerInfo {
  id: string;
  status: string;
  urls: {
    codeServer?: string;
    vnc?: string;
    webServer?: string;
    terminal?: string;
  };
}

interface StoredPanelState {
  ideData?: {
    id: string;
    settings?: {
      default_run_file?: string;
      language?: string;
    };
  };
  bucketId: string | null;
  container: ContainerInfo | null;
  runFilename: string;
  showDesktop: boolean;
  isStarting: boolean;
  ideApiBaseUrl: string;
  readOnly?: boolean;
}

// BroadcastChannel message type for cross-tab container sync
interface ContainerSyncMessage {
  type: "container-update";
  blockId: string;
  container: ContainerInfo | null;
  isStarting: boolean;
  isResetting?: boolean;
}

const IDEFullscreenPage: React.FC = () => {
  const { blockId } = useParams<{ blockId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const isResettingRef = useRef(false);
  const [showDesktop, setShowDesktop] = useState(false);
  const [runFilename, setRunFilename] = useState("main.py");
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [ideApiBaseUrl, setIdeApiBaseUrl] = useState(PRODUCTION_IDE_API_BASE_URL);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingAttemptsRef = useRef(0);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const currentUser = useMemo(() => {
    if (!user) return undefined;
    return {
      id: user.id,
      name: user.firstName || user.email || "User",
      color: userIdToColor(user.id),
    };
  }, [user]);

  // Set up BroadcastChannel for cross-tab container sync
  useEffect(() => {
    if (!blockId) return;
    const channel = new BroadcastChannel(`ide-container-${blockId}`);
    broadcastChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<ContainerSyncMessage>) => {
      const msg = event.data;
      if (msg.type === "container-update" && msg.blockId === blockId) {
        setContainer(msg.container);
        setIsStarting(msg.isStarting);
        const resetting = msg.isResetting ?? false;
        setIsResetting(resetting);
        isResettingRef.current = resetting;
      }
    };

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [blockId]);

  // Broadcast container state changes to other tabs
  const broadcastContainerState = useCallback(
    (cont: ContainerInfo | null, starting: boolean) => {
      if (!blockId || !broadcastChannelRef.current) return;
      const msg: ContainerSyncMessage = {
        type: "container-update",
        blockId,
        container: cont,
        isStarting: starting,
        isResetting: isResettingRef.current,
      };
      try {
        broadcastChannelRef.current.postMessage(msg);
      } catch {
        // Channel may be closed
      }
    },
    [blockId]
  );

  // Load initial state from localStorage
  useEffect(() => {
    if (!blockId) {
      setError("No IDE block ID provided");
      return;
    }

    try {
      const storageKey = `ide-panel-state-${blockId}`;
      const storedData = localStorage.getItem(storageKey);

      if (!storedData) {
        setError("IDE state not found. Please reopen from the assignment page.");
        return;
      }

      const parsed = JSON.parse(storedData) as StoredPanelState;
      setBucketId(parsed.bucketId);
      setContainer(parsed.container);
      setIsStarting(parsed.isStarting);
      setShowDesktop(parsed.showDesktop);
      setRunFilename(parsed.runFilename || "main.py");
      setIdeApiBaseUrl(parsed.ideApiBaseUrl || PRODUCTION_IDE_API_BASE_URL);
      setReadOnly(parsed.readOnly ?? false);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load IDE panel state:", err);
      setError("Failed to load IDE configuration. Please try again.");
    }
  }, [blockId]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Poll container until ready
  const pollContainerUntilReady = useCallback(
    (containerId: string) => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      pollingAttemptsRef.current = 0;

      const interval = setInterval(async () => {
        pollingAttemptsRef.current += 1;
        if (pollingAttemptsRef.current > 60) {
          clearInterval(interval);
          pollingIntervalRef.current = null;
          setIsStarting(false);
          toast({
            title: "Container timeout",
            description: "Container took too long to start. Please try again.",
            variant: "destructive",
          });
          return;
        }

        try {
          const response = await apiClient.checkContainerStatus(containerId);
          const data = response.data;

          if (data.status === "running" && data.urls?.codeServer) {
            clearInterval(interval);
            pollingIntervalRef.current = null;

            const newContainer: ContainerInfo = {
              id: data.id,
              status: data.status,
              urls: {
                ...data.urls,
                terminal: data.urls.terminal || `${ideApiBaseUrl}/terminal/${data.id}/`,
                vnc: data.urls.vnc || `${ideApiBaseUrl}/vnc/${data.id}/`,
              },
            };

            setContainer(newContainer);
            setIsStarting(false);
            broadcastContainerState(newContainer, false);
          }
        } catch {
          // Ignore polling errors, will retry
        }
      }, 3000);

      pollingIntervalRef.current = interval;
    },
    [ideApiBaseUrl, toast, broadcastContainerState]
  );

  // Start a container
  const startContainer = useCallback(async () => {
    if (!user?.id || !bucketId) {
      toast({
        title: "Cannot start container",
        description: !user?.id ? "Please sign in first." : "No bucket configured.",
        variant: "destructive",
      });
      return;
    }

    setIsStarting(true);
    broadcastContainerState(null, true);

    try {
      // Get bucket info
      const bucketResponse = await apiClient.getS3Bucket(bucketId);
      const bucketData = bucketResponse.data;

      if (bucketData.deleted_at) {
        throw new Error("S3 bucket has been deleted.");
      }

      const bucketName = bucketData.bucket_name;
      const bucketRegion = bucketData.region || "us-east-1";

      // Start container
      const startResponse = await apiClient.startIDEContainer({
        s3Bucket: bucketName,
        s3BucketId: bucketId,
        s3Region: bucketRegion,
        userId: user.id,
      });

      const containerData = startResponse.data;
      const containerId = containerData.containerId || containerData.id;

      if (!containerId) {
        throw new Error("No container ID returned");
      }

      const isPreWarmed =
        containerData.isPreWarmed ||
        (containerData.urls?.codeServer && containerData.status === "running");

      if (isPreWarmed) {
        const newContainer: ContainerInfo = {
          id: containerId,
          status: "running",
          urls: {
            ...containerData.urls,
            terminal: containerData.urls.terminal || `${ideApiBaseUrl}/terminal/${containerId}/`,
            vnc: containerData.urls.vnc || `${ideApiBaseUrl}/vnc/${containerId}/`,
          },
        };
        setContainer(newContainer);
        setIsStarting(false);
        broadcastContainerState(newContainer, false);
      } else {
        pollContainerUntilReady(containerId);
      }
    } catch (error: any) {
      console.error("Failed to start container:", error);
      setIsStarting(false);
      broadcastContainerState(null, false);
      toast({
        title: "Failed to start container",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  }, [user, bucketId, ideApiBaseUrl, toast, broadcastContainerState, pollContainerUntilReady]);

  // Run code in container (with OT content write)
  const handleRun = useCallback(async () => {
    if (!container) {
      startContainer();
      return;
    }

    const filename = runFilename || "main.py";

    const ext = filename.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      py: "python",
      js: "node",
      java: "java",
      sh: "bash",
      ts: "node",
    };
    const language = languageMap[ext || ""] || "python";

    try {
      const response = await fetchWithNetworkRetry(
        `${ideApiBaseUrl}/web/${container.id}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, language }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to execute code");
      }
    } catch (error: any) {
      if (error instanceof TypeError) {
        try {
          const statusResp = await apiClient.checkContainerStatus(container.id);
          if (statusResp.data.status !== "running") throw new Error("not running");
        } catch {
          toast({
            title: "Container disconnected",
            description: "Restarting container. Please click Run again in a moment.",
          });
          startContainer();
          return;
        }
      }
      console.error("Failed to execute code:", error);
      toast({
        title: "Execution failed",
        description: error.message || "Failed to execute code.",
        variant: "destructive",
      });
    }
  }, [container, runFilename, bucketId, ideApiBaseUrl, startContainer, toast]);

  // Handle reset instance: clear UI instantly, best-effort sync, stop old container, start fresh
  const handleRefreshInstance = useCallback(async () => {
    if (!container) return;

    const oldContainerId = container.id;

    // Clear the UI state and show spinner immediately
    setContainer(null);
    setIsStarting(true);
    setIsResetting(true);
    isResettingRef.current = true;
    broadcastContainerState(null, true);

    // Best-effort sync with 5s timeout (container may be unresponsive)
    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 5000);
      try {
        const syncResponse = await fetch(
          `${ideApiBaseUrl}/web/${oldContainerId}/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
          }
        );
        clearTimeout(timeout);
        const syncData = await syncResponse.json();
        if (!syncResponse.ok) {
          console.warn("Sync before reset failed:", syncData);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (syncError: any) {
        clearTimeout(timeout);
        console.warn("Sync before reset failed (continuing anyway):", syncError);
      }
    } catch (error: any) {
      console.warn("Unexpected error during pre-reset sync:", error);
    }

    // Stop the old container
    try {
      await apiClient.stopIDEContainer(oldContainerId);
    } catch (stopError: any) {
      console.warn("Failed to stop old container (continuing anyway):", stopError);
    }

    // Start a fresh container with the existing S3 bucket
    // startContainer handles broadcasting the new container state
    isResettingRef.current = false;
    await startContainer();
    setIsResetting(false);
  }, [container, ideApiBaseUrl, startContainer, broadcastContainerState]);

  const handleClose = () => {
    if (blockId) {
      localStorage.removeItem(`ide-panel-state-${blockId}`);
    }
    window.close();
    setTimeout(() => {
      navigate("/dashboard");
    }, 100);
  };

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="max-w-md p-8 bg-card rounded-lg shadow-lg border border-red-200">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
            <h2 className="text-xl font-bold text-foreground">Error Loading IDE</h2>
          </div>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button
            onClick={handleClose}
            className="w-full bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading IDE environment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-card">
      {/* Header */}
      <header className="bg-purple-600 text-white px-4 py-2 flex items-center justify-between flex-shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">IDE Fullscreen</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="text-white hover:bg-purple-500"
          title="Close Fullscreen IDE"
        >
          <X className="w-5 h-5 mr-1" />
          Close
        </Button>
      </header>

      {/* IDE Content */}
      <div className="flex-1 overflow-hidden">
        <MonacoIDE
          bucketId={bucketId}
          containerId={container?.id || null}
          containerTerminalUrl={container?.urls?.terminal}
          containerVncUrl={container?.urls?.vnc}
          containerWebServerUrl={container?.urls?.webServer}
          ideApiBaseUrl={ideApiBaseUrl}
          runFilename={runFilename}
          isStarting={isStarting}
          isResetting={isResetting}
          onRefreshInstance={container ? handleRefreshInstance : undefined}
          showDesktop={showDesktop}
          layoutMode="normal"
          readOnly={readOnly}
          currentUser={currentUser}
          onRun={handleRun}
          onFilenameChange={setRunFilename}
          onToggleDesktop={() => setShowDesktop((prev) => !prev)}
          onContainerKilled={() => {
            setContainer(null);
            broadcastContainerState(null, false);
          }}
        />
      </div>
    </div>
  );
};

export default IDEFullscreenPage;
