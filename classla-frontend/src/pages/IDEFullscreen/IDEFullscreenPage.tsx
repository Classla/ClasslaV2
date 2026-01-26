import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, AlertCircle } from "lucide-react";
import MonacoIDE from "../../components/Blocks/IDE/MonacoIDE";
import { IDEBlockData } from "../../components/extensions/IDEBlock";
import { Button } from "../../components/ui/button";
import { useToast } from "../../hooks/use-toast";

interface IDEPanelState {
  bucketId: string;
  container: {
    id: string;
    status: string;
    urls: {
      codeServer?: string;
      vnc?: string;
      webServer?: string;
      terminal?: string;
    };
  } | null;
  runFilename: string;
  showDesktop: boolean;
  isStarting: boolean;
  ideApiBaseUrl: string;
}

const IDEFullscreenPage: React.FC = () => {
  const { blockId } = useParams<{ blockId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [panelState, setPanelState] = useState<IDEPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blockId) {
      setError("No IDE block ID provided");
      return;
    }

    try {
      // Load IDE panel state from localStorage
      const storageKey = `ide-panel-state-${blockId}`;
      const storedData = localStorage.getItem(storageKey);

      if (!storedData) {
        setError("IDE state not found. Please reopen from the assignment page.");
        return;
      }

      const parsedData = JSON.parse(storedData) as IDEPanelState;
      setPanelState(parsedData);

      // Clean up old data after 1 hour (in case tab is left open)
      const cleanupTimeout = setTimeout(() => {
        localStorage.removeItem(storageKey);
      }, 3600000); // 1 hour

      return () => {
        clearTimeout(cleanupTimeout);
      };
    } catch (err) {
      console.error("Failed to load IDE panel state:", err);
      setError("Failed to load IDE configuration. Please try again.");
    }
  }, [blockId]);

  const handleClose = () => {
    // Clean up localStorage
    if (blockId) {
      localStorage.removeItem(`ide-panel-state-${blockId}`);
    }
    // Close the tab or navigate back
    window.close();
    // If window.close() doesn't work (e.g., not opened with window.open), navigate to dashboard
    setTimeout(() => {
      navigate("/dashboard");
    }, 100);
  };

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md p-8 bg-white rounded-lg shadow-lg border border-red-200">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
            <h2 className="text-xl font-bold text-gray-900">Error Loading IDE</h2>
          </div>
          <p className="text-gray-600 mb-6">{error}</p>
          <Button
            onClick={handleClose}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (!panelState) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading IDE environment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="bg-purple-600 text-white px-4 py-2 flex items-center justify-between flex-shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">IDE Fullscreen - {blockId}</h1>
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
          bucketId={panelState.bucketId}
          containerId={panelState.container?.id || null}
          containerTerminalUrl={panelState.container?.urls?.terminal}
          containerVncUrl={panelState.container?.urls?.vnc}
          containerWebServerUrl={panelState.container?.urls?.webServer}
          ideApiBaseUrl={panelState.ideApiBaseUrl}
          runFilename={panelState.runFilename}
          isStarting={panelState.isStarting}
          showDesktop={panelState.showDesktop}
          layoutMode="normal"
          onRun={async () => {
            // Run code in the container
            if (!panelState.container) return;
            
            const filename = panelState.runFilename || "main.py";
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
              const response = await fetch(
                `${panelState.ideApiBaseUrl}/web/${panelState.container.id}/run`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    filename,
                    language,
                  }),
                }
              );

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || "Failed to execute code");
              }
            } catch (error: any) {
              console.error("Failed to execute code:", error);
              toast({
                title: "Execution failed",
                description: error.message || "Failed to execute code.",
                variant: "destructive",
              });
            }
          }}
          onFilenameChange={(filename) => {
            // Update the filename in panel state
            setPanelState((prev) => prev ? { ...prev, runFilename: filename } : null);
          }}
          onToggleDesktop={() => {
            // Toggle desktop view
            setPanelState((prev) => prev ? { ...prev, showDesktop: !prev.showDesktop } : null);
          }}
          onContainerKilled={() => {
            // Container was killed, close the window
            handleClose();
          }}
        />
      </div>
    </div>
  );
};

export default IDEFullscreenPage;
