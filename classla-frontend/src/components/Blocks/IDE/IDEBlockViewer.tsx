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

interface IDEBlockViewerProps {
  node: any;
  editor: any;
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

type TabType = "code" | "autoGrader";

const IDEBlockViewer: React.FC<IDEBlockViewerProps> = memo(
  ({ node, editor }) => {
    const ideData = node.attrs.ideData as IDEBlockData;
    const { toast } = useToast();
    const { user } = useAuth();

    const [activeTab, setActiveTab] = useState<TabType>("code");
    const [container, setContainer] = useState<ContainerInfo | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [showDesktop, setShowDesktop] = useState(false);
    const [runFilename, setRunFilename] = useState(
      ideData.settings?.default_run_file || "main.py"
    );
    const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
      null
    );

    const pollingAttemptsRef = useRef(0);

    // Cleanup polling interval on unmount
    useEffect(() => {
      return () => {
        if (pollingInterval) clearInterval(pollingInterval);
      };
    }, [pollingInterval]);

    // Check container status
    const checkContainerStatus = useCallback(
      async (containerId: string): Promise<boolean> => {
        try {
          const response = await apiClient.checkContainerStatus(containerId);
          const containerData = response.data;

          if (
            containerData.status === "running" &&
            containerData.urls?.codeServer
          ) {
            setContainer({
              id: containerData.id,
              status: containerData.status,
              urls: containerData.urls,
            });
            return true;
          }
          return false;
        } catch (error: any) {
          if (error.statusCode === 404) {
            // Container not found or stopped
            return false;
          }
          console.error("Failed to check container status:", error);
          return false;
        }
      },
      []
    );

    // Poll container until ready
    const pollContainerUntilReady = useCallback(
      (containerId: string) => {
        const maxAttempts = 15; // 30 seconds max (15 * 2 seconds)
        pollingAttemptsRef.current = 0;

        const interval = setInterval(async () => {
          pollingAttemptsRef.current++;

          if (pollingAttemptsRef.current >= maxAttempts) {
            clearInterval(interval);
            setPollingInterval(null);
            setIsStarting(false);
            toast({
              title: "Container timeout",
              description:
                "Container took too long to start. Please try again.",
              variant: "destructive",
            });
            return;
          }

          const isReady = await checkContainerStatus(containerId);
          if (isReady) {
            clearInterval(interval);
            setPollingInterval(null);
            setIsStarting(false);
            pollingAttemptsRef.current = 0;
          }
        }, 2000); // Poll every 2 seconds

        setPollingInterval(interval);
      },
      [checkContainerStatus, toast]
    );

    // Start container
    const startContainer = useCallback(async () => {
      if (!user?.id) {
        toast({
          title: "Authentication required",
          description: "Please sign in to start a container.",
          variant: "destructive",
        });
        return;
      }

      setIsStarting(true);

      try {
        // Use template tab data for student view (they see the template)
        const tabData = ideData.template;

        // Get or create S3 bucket
        let bucketId = tabData.s3_bucket_id;
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

        // Start polling for container readiness
        pollContainerUntilReady(containerId);
      } catch (error: any) {
        console.error("Failed to start container:", error);
        setIsStarting(false);
        toast({
          title: "Failed to start container",
          description:
            error.message || "An error occurred while starting the container.",
          variant: "destructive",
        });
      }
    }, [user, ideData, pollContainerUntilReady, toast]);

    // Initialize container on mount
    useEffect(() => {
      const containerId = ideData.template.last_container_id;

      if (containerId) {
        // Check if container is still running
        checkContainerStatus(containerId).then((isRunning) => {
          if (!isRunning) {
            // Container is not running, clear it
            setContainer(null);
          }
        });
      }
    }, [ideData, checkContainerStatus]);

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
    const handleRun = useCallback(async () => {
      if (!container) {
        toast({
          title: "No container",
          description: "Please start a container first.",
          variant: "destructive",
        });
        return;
      }

      const filename = runFilename || "main.py";
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
    }, [container, runFilename, detectLanguage, toast]);

    // Handle view desktop toggle
    const handleToggleDesktop = useCallback(() => {
      setShowDesktop((prev) => !prev);
    }, []);

    // Handle tab change
    const handleTabChange = useCallback((value: string) => {
      setActiveTab(value as TabType);
    }, []);

    return (
      <NodeViewWrapper
        className="ide-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="ide-viewer border border-gray-200 rounded-lg p-4 bg-white shadow-sm select-none">
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
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="code">Code</TabsTrigger>
              <TabsTrigger value="autoGrader">Auto Grader</TabsTrigger>
            </TabsList>

            {/* Code Tab */}
            <TabsContent value="code" className="mt-4">
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
                      value={runFilename}
                      onChange={(e) => setRunFilename(e.target.value)}
                      className="w-32 text-sm"
                      disabled={!container || isStarting}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRun}
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
                        onClick={startContainer}
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
                      <div
                        className="relative"
                        style={{ height: showDesktop ? "400px" : "600px" }}
                      >
                        <iframe
                          src={`${IDE_API_BASE_URL}/code/${container.id}/`}
                          className="w-full h-full border-0"
                          title="Code Server"
                          allow="clipboard-read; clipboard-write"
                        />
                      </div>

                      {/* VNC iframe (shown when desktop view is enabled) */}
                      {showDesktop && (
                        <div
                          className="relative border-t border-gray-300"
                          style={{ height: "400px" }}
                        >
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
            </TabsContent>

            {/* Auto Grader Tab */}
            <TabsContent value="autoGrader" className="mt-4">
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
          {container && (
            <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-start">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Monitor className="w-4 h-4 mr-2" />
                    View Desktop
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={handleToggleDesktop}>
                    {showDesktop ? "Hide" : "Show"} Desktop View
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }
);

export default IDEBlockViewer;

