import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useRef,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { IDEBlockData } from "../../extensions/IDEBlock";
import {
  Trash2,
  Play,
  Monitor,
  Loader2,
  AlertCircle,
  Code2,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { useToast } from "../../../hooks/use-toast";
import { apiClient } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";

interface IDEBlockEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

interface ContainerInfo {
  id: string;
  status: string;
  urls: {
    codeServer: string;
    vnc: string;
    webServer: string;
  };
}

const IDE_API_BASE_URL =
  import.meta.env.VITE_IDE_API_BASE_URL || "https://ide.classla.org";

type TabType = "template" | "modelSolution" | "autoGrading";

const IDEBlockEditor: React.FC<IDEBlockEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const ideData = node.attrs.ideData as IDEBlockData;
    const { toast } = useToast();
    const { user } = useAuth();

    const [activeTab, setActiveTab] = useState<TabType>("template");
    const [containers, setContainers] = useState<
      Record<TabType, ContainerInfo | null>
    >({
      template: null,
      modelSolution: null,
      autoGrading: null,
    });
    const [isStarting, setIsStarting] = useState<
      Record<TabType, boolean>
    >({
      template: false,
      modelSolution: false,
      autoGrading: false,
    });
    const [showDesktop, setShowDesktop] = useState<
      Record<TabType, boolean>
    >({
      template: false,
      modelSolution: false,
      autoGrading: false,
    });
    // Initialize run filename from settings
    const [runFilename, setRunFilename] = useState<
      Record<TabType, string>
    >({
      template: ideData.settings?.default_run_file || "main.py",
      modelSolution: ideData.settings?.default_run_file || "main.py",
      autoGrading: ideData.settings?.default_run_file || "main.py",
    });
    const [pollingIntervals, setPollingIntervals] = useState<
      Record<TabType, NodeJS.Timeout | null>
    >({
      template: null,
      modelSolution: null,
      autoGrading: null,
    });

    const pollingAttemptsRef = useRef<Record<TabType, number>>({
      template: 0,
      modelSolution: 0,
      autoGrading: 0,
    });

    // Cleanup polling intervals on unmount
    useEffect(() => {
      return () => {
        Object.values(pollingIntervals).forEach((interval) => {
          if (interval) clearInterval(interval);
        });
      };
    }, [pollingIntervals]);

    // Check container status for a specific tab
    const checkContainerStatus = useCallback(
      async (tab: TabType, containerId: string): Promise<boolean> => {
        try {
          const response = await apiClient.checkContainerStatus(containerId);
          const container = response.data;

          if (container.status === "running" && container.urls?.codeServer) {
            setContainers((prev) => ({
              ...prev,
              [tab]: {
                id: container.id,
                status: container.status,
                urls: container.urls,
              },
            }));
            return true;
          }
          return false;
        } catch (error: any) {
          if (error.statusCode === 404) {
            // Container not found or stopped
            return false;
          }
          console.error(`Failed to check container status for ${tab}:`, error);
          return false;
        }
      },
      []
    );

    // Poll container until ready
    const pollContainerUntilReady = useCallback(
      (tab: TabType, containerId: string) => {
        const maxAttempts = 15; // 30 seconds max (15 * 2 seconds)
        pollingAttemptsRef.current[tab] = 0;

        const interval = setInterval(async () => {
          pollingAttemptsRef.current[tab]++;

          if (pollingAttemptsRef.current[tab] >= maxAttempts) {
            clearInterval(interval);
            setPollingIntervals((prev) => ({ ...prev, [tab]: null }));
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            toast({
              title: "Container timeout",
              description:
                "Container took too long to start. Please try again.",
              variant: "destructive",
            });
            return;
          }

          const isReady = await checkContainerStatus(tab, containerId);
          if (isReady) {
            clearInterval(interval);
            setPollingIntervals((prev) => ({ ...prev, [tab]: null }));
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            pollingAttemptsRef.current[tab] = 0;
          }
        }, 2000); // Poll every 2 seconds

        setPollingIntervals((prev) => ({ ...prev, [tab]: interval }));
      },
      [checkContainerStatus, toast]
    );

    // Start container for a specific tab
    const startContainer = useCallback(
      async (tab: TabType) => {
        if (!user?.id) {
          toast({
            title: "Authentication required",
            description: "Please sign in to start a container.",
            variant: "destructive",
          });
          return;
        }

        setIsStarting((prev) => ({ ...prev, [tab]: true }));

        try {
          // Get or create S3 bucket
          let bucketId = ideData[tab].s3_bucket_id;
          let bucketName: string;
          let bucketRegion: string;

          if (!bucketId) {
            // Create new S3 bucket
            const bucketResponse = await apiClient.createS3Bucket({
              user_id: user.id,
              region: "us-east-1",
            });

            if (!bucketResponse?.data) {
              throw new Error("Failed to create S3 bucket");
            }

            bucketId = bucketResponse.data.id;
            bucketName = bucketResponse.data.bucket_name;
            bucketRegion = bucketResponse.data.region;

            // Update block data with bucket ID
            updateAttributes({
              ideData: {
                ...ideData,
                [tab]: {
                  ...ideData[tab],
                  s3_bucket_id: bucketId,
                },
              },
            });
          } else {
            // Get existing bucket info
            const bucketResponse = await apiClient.getS3Bucket(bucketId);
            bucketName = bucketResponse.data.bucket_name;
            bucketRegion = bucketResponse.data.region || "us-east-1";
          }

          // Start container
          const containerResponse = await apiClient.startIDEContainer({
            s3Bucket: bucketName,
            s3Region: bucketRegion,
            userId: user.id,
          });

          const containerId = containerResponse.data.id;

          // Update block data with container ID
          updateAttributes({
            ideData: {
              ...ideData,
              [tab]: {
                ...ideData[tab],
                last_container_id: containerId,
              },
            },
          });

          // Start polling for container readiness
          pollContainerUntilReady(tab, containerId);
        } catch (error: any) {
          console.error(`Failed to start container for ${tab}:`, error);
          setIsStarting((prev) => ({ ...prev, [tab]: false }));
          toast({
            title: "Failed to start container",
            description:
              error.message || "An error occurred while starting the container.",
            variant: "destructive",
          });
        }
      },
      [user, ideData, updateAttributes, pollContainerUntilReady, toast]
    );

    // Initialize containers for all tabs on mount
    useEffect(() => {
      const tabs: TabType[] = ["template", "modelSolution", "autoGrading"];
      
      tabs.forEach((tab) => {
        const containerId = ideData[tab].last_container_id;
        if (containerId) {
          // Check if container is still running
          checkContainerStatus(tab, containerId).then((isRunning) => {
            if (!isRunning) {
              // Container is not running, clear it
              setContainers((prev) => ({ ...prev, [tab]: null }));
            }
          });
        }
      });
    }, [ideData, checkContainerStatus]);

    // Handle tab change
    const handleTabChange = useCallback((value: string) => {
      setActiveTab(value as TabType);
    }, []);

    // Detect language from filename extension
    const detectLanguage = useCallback((filename: string): string => {
      const ext = filename.split(".").pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        py: "python",
        js: "node",
        java: "java",
        sh: "bash",
        ts: "node", // TypeScript runs with node
      };
      return languageMap[ext || ""] || "python";
    }, []);

    // Handle run button click
    const handleRun = useCallback(
      async (tab: TabType) => {
        const container = containers[tab];
        if (!container) {
          toast({
            title: "No container",
            description: "Please start a container first.",
            variant: "destructive",
          });
          return;
        }

        const filename = runFilename[tab] || "main.py";
        const language = detectLanguage(filename);

        try {
          const response = await fetch(
            `${IDE_API_BASE_URL}/web/${container.id}/run`,
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

          // Don't show toast on success - code is running silently
        } catch (error: any) {
          console.error("Failed to execute code:", error);
          toast({
            title: "Execution failed",
            description: error.message || "Failed to execute code.",
            variant: "destructive",
          });
        }
      },
      [containers, runFilename, detectLanguage, toast]
    );

    // Handle view desktop toggle
    const handleToggleDesktop = useCallback((tab: TabType) => {
      setShowDesktop((prev) => ({
        ...prev,
        [tab]: !prev[tab],
      }));
    }, []);

    // Update points
    const updatePoints = useCallback(
      (points: number) => {
        updateAttributes({
          ideData: {
            ...ideData,
            points: points >= 0 ? points : 0,
          },
        });
      },
      [ideData, updateAttributes]
    );

    // Update default run file in settings
    const updateDefaultRunFile = useCallback(
      (filename: string) => {
        updateAttributes({
          ideData: {
            ...ideData,
            settings: {
              ...ideData.settings,
              default_run_file: filename,
            },
          },
        });
      },
      [ideData, updateAttributes]
    );

    // Sync run filename to settings when it changes (debounced)
    useEffect(() => {
      const timeoutId = setTimeout(() => {
        // Update settings when active tab's filename changes
        const currentFilename = runFilename[activeTab];
        if (
          currentFilename &&
          currentFilename !== (ideData.settings?.default_run_file || "main.py")
        ) {
          updateDefaultRunFile(currentFilename);
        }
      }, 500); // Debounce by 500ms to avoid too many updates

      return () => clearTimeout(timeoutId);
    }, [runFilename, activeTab, ideData.settings, updateDefaultRunFile]);


    return (
      <NodeViewWrapper
        className="ide-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="ide-editor border border-gray-200 rounded-lg p-4 bg-white shadow-sm select-none">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  IDE Block - Virtual Codespace
                </div>
                <div className="text-xs text-gray-500">
                  Interactive coding environment
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={deleteNode}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="template">Template</TabsTrigger>
              <TabsTrigger value="modelSolution">Model Solution</TabsTrigger>
              <TabsTrigger value="autoGrading">Auto Grading</TabsTrigger>
            </TabsList>

            {/* Template Tab */}
            <TabsContent value="template" className="mt-4">
              <IDETabContent
                tab="template"
                container={containers.template}
                isStarting={isStarting.template}
                showDesktop={showDesktop.template}
                filename={runFilename.template}
                onFilenameChange={(filename) =>
                  setRunFilename((prev) => ({ ...prev, template: filename }))
                }
                onStart={() => startContainer("template")}
                onRun={() => handleRun("template")}
                onToggleDesktop={() => handleToggleDesktop("template")}
              />
            </TabsContent>

            {/* Model Solution Tab */}
            <TabsContent value="modelSolution" className="mt-4">
              <IDETabContent
                tab="modelSolution"
                container={containers.modelSolution}
                isStarting={isStarting.modelSolution}
                showDesktop={showDesktop.modelSolution}
                filename={runFilename.modelSolution}
                onFilenameChange={(filename) =>
                  setRunFilename((prev) => ({
                    ...prev,
                    modelSolution: filename,
                  }))
                }
                onStart={() => startContainer("modelSolution")}
                onRun={() => handleRun("modelSolution")}
                onToggleDesktop={() => handleToggleDesktop("modelSolution")}
              />
            </TabsContent>

            {/* Auto Grading Tab */}
            <TabsContent value="autoGrading" className="mt-4">
              <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <div className="text-center">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-medium">Coming Soon</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Auto grading functionality will be available soon
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Label htmlFor="points" className="text-sm text-gray-700">
                Points:
              </Label>
              <Input
                id="points"
                type="number"
                min="0"
                step="0.5"
                value={ideData.points}
                onChange={(e) =>
                  updatePoints(parseFloat(e.target.value) || 0)
                }
                className="w-20"
              />
              {containers[activeTab] && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Monitor className="w-4 h-4 mr-2" />
                      View Desktop
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => handleToggleDesktop(activeTab)}
                    >
                      {showDesktop[activeTab] ? "Hide" : "Show"} Desktop View
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

interface IDETabContentProps {
  tab: TabType;
  container: ContainerInfo | null;
  isStarting: boolean;
  showDesktop: boolean;
  filename: string;
  onFilenameChange: (filename: string) => void;
  onStart: () => void;
  onRun: () => void;
  onToggleDesktop: () => void;
}

const IDETabContent: React.FC<IDETabContentProps> = memo(
  ({
    container,
    isStarting,
    showDesktop,
    filename,
    onFilenameChange,
    onStart,
    onRun,
    onToggleDesktop,
  }) => {
    const IDE_API_BASE_URL =
      import.meta.env.VITE_IDE_API_BASE_URL || "https://ide.classla.org";

    return (
      <div className="space-y-4">
        {/* Header with Run button and filename input */}
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="default-run-file" className="text-xs text-gray-600 whitespace-nowrap">
              Default Run File:
            </Label>
            <Input
              id="default-run-file"
              type="text"
              placeholder="main.py"
              value={filename}
              onChange={(e) => onFilenameChange(e.target.value)}
              className="w-32 text-sm"
              disabled={!container || isStarting}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={!container || isStarting}
          >
            <Play className="w-4 h-4 mr-2" />
            Run
          </Button>
        </div>

        {/* Container area */}
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
          {!container && !isStarting && (
            <div className="flex flex-col items-center justify-center h-96">
              <Code2 className="w-16 h-16 text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium mb-2">
                Start Virtual Codespace
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Launch a containerized development environment
              </p>
              <Button
                onClick={onStart}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Start Virtual Codespace
              </Button>
            </div>
          )}

          {isStarting && (
            <div className="flex flex-col items-center justify-center h-96">
              <Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-4" />
              <p className="text-gray-600 font-medium">
                Starting container...
              </p>
              <p className="text-sm text-gray-500 mt-1">
                This may take a few moments
              </p>
            </div>
          )}

          {container && !isStarting && (
            <div className="space-y-0">
              {/* Code Server iframe */}
              <div className="relative" style={{ height: showDesktop ? "400px" : "600px" }}>
                <iframe
                  src={`${IDE_API_BASE_URL}/code/${container.id}/`}
                  className="w-full h-full border-0"
                  title="Code Server"
                  allow="clipboard-read; clipboard-write"
                />
              </div>

              {/* VNC iframe (shown when desktop view is enabled) */}
              {showDesktop && (
                <div className="relative border-t border-gray-300" style={{ height: "400px" }}>
                  <iframe
                    src={`${IDE_API_BASE_URL}/vnc/${container.id}/`}
                    className="w-full h-full border-0"
                    title="Desktop View"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

IDETabContent.displayName = "IDETabContent";

export default IDEBlockEditor;

