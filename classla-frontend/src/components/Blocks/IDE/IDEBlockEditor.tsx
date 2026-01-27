import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useRef,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { IDEBlockData, TestCase } from "../../extensions/IDEBlock";
import {
  Trash2,
  Play,
  Monitor,
  Loader2,
  AlertCircle,
  Code2,
  RefreshCw,
  ExternalLink,
  PanelLeft,
} from "lucide-react";
import AutograderTestModal from "./AutograderTestModal";
import AutograderTestList from "./AutograderTestList";
import AutograderTestResultsModal from "./AutograderTestResultsModal";
import MonacoIDE from "./MonacoIDE";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
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
import { useIDEPanel } from "../../../contexts/IDEPanelContext";
import { useAssignmentContext } from "../../../contexts/AssignmentContext";

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
    terminal?: string;
  };
}

const PRODUCTION_IDE_API_BASE_URL =
  import.meta.env.VITE_IDE_API_BASE_URL || "https://ide.classla.org";
const LOCAL_IDE_API_BASE_URL = "http://localhost";

type TabType = "template" | "modelSolution" | "autoGrading";

const IDEBlockEditor: React.FC<IDEBlockEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const ideData = node.attrs.ideData as IDEBlockData;
    const { toast } = useToast();
    const { user } = useAuth();
    const { openSidePanel, openFullscreen } = useIDEPanel();
    const { courseId, assignmentId } = useAssignmentContext();

    // Admin toggle for local vs production IDE API
    const [useLocalIDE, setUseLocalIDE] = useState(false);
    const isAdmin = user?.isAdmin || false;
    const IDE_API_BASE_URL = useLocalIDE ? LOCAL_IDE_API_BASE_URL : PRODUCTION_IDE_API_BASE_URL;

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
    
    // Track ongoing status checks to prevent duplicate requests
    const statusCheckInProgress = useRef<Set<string>>(new Set());

    // Autograder test case management
    const [testModalOpen, setTestModalOpen] = useState(false);
    const [editingTest, setEditingTest] = useState<TestCase | null>(null);
    const [testResultsModalOpen, setTestResultsModalOpen] = useState(false);
    const [testResults, setTestResults] = useState<any[]>([]);
    const [testTotalPoints, setTestTotalPoints] = useState(0);
    const [testPointsEarned, setTestPointsEarned] = useState(0);

    // Cleanup polling intervals on unmount
    useEffect(() => {
      return () => {
        Object.values(pollingIntervals).forEach((interval) => {
          if (interval) clearInterval(interval);
        });
      };
    }, [pollingIntervals]);

    // Clear container for a specific tab (keeps S3 bucket)
    const clearContainer = useCallback(
      (tab: TabType) => {
        setContainers((prev) => ({ ...prev, [tab]: null }));
        updateAttributes({
          ideData: {
            ...ideData,
            [tab]: {
              ...ideData[tab],
              last_container_id: null,
            },
          },
        });
      },
      [ideData, updateAttributes]
    );

    // Check container status for a specific tab
    const checkContainerStatus = useCallback(
      async (tab: TabType, containerId: string): Promise<boolean> => {
        // Prevent duplicate simultaneous checks
        const checkKey = `${tab}-${containerId}`;
        if (statusCheckInProgress.current.has(checkKey)) {
          return false; // Already checking, skip
        }

        statusCheckInProgress.current.add(checkKey);

        try {
          const response = await apiClient.checkContainerStatus(containerId, useLocalIDE);
          const container = response.data;
          const currentIDEBaseUrl = useLocalIDE ? LOCAL_IDE_API_BASE_URL : PRODUCTION_IDE_API_BASE_URL;

          if (container.status === "running" && container.urls?.codeServer) {
            setContainers((prev) => ({
              ...prev,
              [tab]: {
                id: container.id,
                status: container.status,
                urls: {
                  ...container.urls,
                  terminal: container.urls.terminal || `${currentIDEBaseUrl}/terminal/${container.id}`,
                  vnc: container.urls.vnc || `${currentIDEBaseUrl}/vnc/${container.id}/`,
                },
              },
            }));
            statusCheckInProgress.current.delete(checkKey);
            return true;
          }
          // Container is not running, clear it
          clearContainer(tab);
          statusCheckInProgress.current.delete(checkKey);
          return false;
        } catch (error: any) {
          statusCheckInProgress.current.delete(checkKey);
          
          // Don't clear container on rate limit errors - just log and return
          // This prevents cascading failures when rate limited
          if (error.statusCode === 429) {
            console.warn(`Rate limited while checking container status for ${tab}`);
            return false;
          }
          
          if (error.statusCode === 404 || error.statusCode === 502) {
            // Container not found, stopped, or gateway error - clear it
            clearContainer(tab);
            return false;
          }
          
          // For other errors (network issues, etc.), don't clear container
          // Might be temporary - let user retry manually
          console.error(`Failed to check container status for ${tab}:`, error);
          return false;
        }
      },
      [clearContainer, useLocalIDE]
    );


    // Poll container until ready (only for newly created containers, not pre-warmed)
    const pollContainerUntilReady = useCallback(
      (tab: TabType, containerId: string) => {
        const maxAttempts = 30; // 15 seconds max (30 * 500ms) - faster polling
        pollingAttemptsRef.current[tab] = 0;

        // First check immediately (no delay)
        checkContainerStatus(tab, containerId).then((isReady) => {
          if (isReady) {
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            pollingAttemptsRef.current[tab] = 0;
            return; // Already ready, no need to poll
          }
        });

        const interval = setInterval(async () => {
          pollingAttemptsRef.current[tab]++;

          if (pollingAttemptsRef.current[tab] >= maxAttempts) {
            clearInterval(interval);
            setPollingIntervals((prev) => ({ ...prev, [tab]: null }));
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            return;
          }

          const isReady = await checkContainerStatus(tab, containerId);
          if (isReady) {
            clearInterval(interval);
            setPollingIntervals((prev) => ({ ...prev, [tab]: null }));
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            pollingAttemptsRef.current[tab] = 0;
          }
        }, 500); // Poll every 500ms for faster detection

        setPollingIntervals((prev) => ({ ...prev, [tab]: interval }));
      },
      [checkContainerStatus]
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
          let bucketName: string | undefined;
          let bucketRegion: string | undefined;

          if (!bucketId) {
            // Check if we should clone from template
            const templateBucketId = ideData.template.s3_bucket_id;
            const shouldClone = (tab === "modelSolution" || tab === "autoGrading") && templateBucketId;

            if (shouldClone) {
              // Clone from template bucket
              try {
                const cloneResponse = await apiClient.cloneS3Bucket(templateBucketId, {
                  region: "us-east-1",
                });

                if (!cloneResponse?.data) {
                  throw new Error("Failed to clone S3 bucket");
                }

                bucketId = cloneResponse.data.id;
                bucketName = cloneResponse.data.bucket_name;
                bucketRegion = cloneResponse.data.region;
              } catch (cloneError: any) {
                // If clone fails (e.g., user not enrolled), fall back to creating new bucket
                console.warn("Failed to clone template bucket, creating new bucket:", cloneError);
                const bucketResponse = await apiClient.createS3Bucket({
                  user_id: user.id,
                  course_id: courseId || undefined,
                  assignment_id: assignmentId || undefined,
                  region: "us-east-1",
                });

                if (!bucketResponse?.data) {
                  throw new Error("Failed to create S3 bucket");
                }

                bucketId = bucketResponse.data.id;
                bucketName = bucketResponse.data.bucket_name;
                bucketRegion = bucketResponse.data.region;
              }
            } else {
              // Create new S3 bucket
              // Template buckets should be marked as templates
              const isTemplate = tab === "template";
              const bucketResponse = await apiClient.createS3Bucket({
                user_id: user.id,
                course_id: courseId || undefined,
                assignment_id: assignmentId || undefined,
                region: "us-east-1",
                is_template: isTemplate,
              });

              if (!bucketResponse?.data) {
                throw new Error("Failed to create S3 bucket");
              }

              bucketId = bucketResponse.data.id;
              bucketName = bucketResponse.data.bucket_name;
              bucketRegion = bucketResponse.data.region;
            }

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
            try {
              const bucketResponse = await apiClient.getS3Bucket(bucketId);
              // Check if bucket is deleted
              if (bucketResponse.data.deleted_at) {
                // Bucket is deleted, clear it and treat as if no bucket exists
                updateAttributes({
                  ideData: {
                    ...ideData,
                    [tab]: {
                      ...ideData[tab],
                      s3_bucket_id: null,
                      last_container_id: null,
                    },
                  },
                });
                // Fall through to create/clone logic below
                bucketId = null;
              } else {
                bucketName = bucketResponse.data.bucket_name;
                bucketRegion = bucketResponse.data.region || "us-east-1";
              }
            } catch (error: any) {
              // Bucket not found or error, clear it and treat as if no bucket exists
              if (error.statusCode === 404) {
                updateAttributes({
                  ideData: {
                    ...ideData,
                    [tab]: {
                      ...ideData[tab],
                      s3_bucket_id: null,
                      last_container_id: null,
                    },
                  },
                });
                // Fall through to create/clone logic below
                bucketId = null;
              } else {
                throw error;
              }
            }
          }

          // If bucket was cleared (deleted or not found), create/clone a new one
          if (!bucketId) {
            // Check if we should clone from template
            const templateBucketId = ideData.template.s3_bucket_id;
            const shouldClone = (tab === "modelSolution" || tab === "autoGrading") && templateBucketId;

            if (shouldClone) {
              // Clone from template bucket
              try {
                const cloneResponse = await apiClient.cloneS3Bucket(templateBucketId, {
                  region: "us-east-1",
                });

                if (!cloneResponse?.data) {
                  throw new Error("Failed to clone S3 bucket");
                }

                bucketId = cloneResponse.data.id;
                bucketName = cloneResponse.data.bucket_name;
                bucketRegion = cloneResponse.data.region;
              } catch (cloneError: any) {
                // If clone fails (e.g., user not enrolled), fall back to creating new bucket
                console.warn("Failed to clone template bucket, creating new bucket:", cloneError);
                const bucketResponse = await apiClient.createS3Bucket({
                  user_id: user.id,
                  course_id: courseId || undefined,
                  assignment_id: assignmentId || undefined,
                  region: "us-east-1",
                });

                if (!bucketResponse?.data) {
                  throw new Error("Failed to create S3 bucket");
                }

                bucketId = bucketResponse.data.id;
                bucketName = bucketResponse.data.bucket_name;
                bucketRegion = bucketResponse.data.region;
              }
            } else {
              // Create new S3 bucket
              // Template buckets should be marked as templates
              const isTemplate = tab === "template";
              const bucketResponse = await apiClient.createS3Bucket({
                user_id: user.id,
                course_id: courseId || undefined,
                assignment_id: assignmentId || undefined,
                region: "us-east-1",
                is_template: isTemplate,
              });

              if (!bucketResponse?.data) {
                throw new Error("Failed to create S3 bucket");
              }

              bucketId = bucketResponse.data.id;
              bucketName = bucketResponse.data.bucket_name;
              bucketRegion = bucketResponse.data.region;
            }

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
          }

          // Ensure bucketName and bucketRegion are set
          if (!bucketName || !bucketRegion) {
            throw new Error("Failed to get bucket information");
          }

          // Start container
          const containerResponse = await apiClient.startIDEContainer({
            s3Bucket: bucketName,
            s3BucketId: bucketId || undefined, // Pass bucketId for file sync
            s3Region: bucketRegion,
            userId: user.id,
            useLocalIDE: useLocalIDE,
          });

          const containerData = containerResponse.data;
          const containerId = containerData.id;

          // Update block data with both bucket ID and container ID in a single update
          // This ensures both are saved atomically and prevents validation from clearing the container
          updateAttributes({
            ideData: {
              ...ideData,
              [tab]: {
                ...ideData[tab],
                s3_bucket_id: bucketId, // Ensure bucket ID is saved with container ID
                last_container_id: containerId,
              },
            },
          });

          // If container has URLs and is running OR marked as pre-warmed, show it immediately
          // Pre-warmed containers are already running with code-server ready
          const isPreWarmed = containerData.isPreWarmed || (containerData.urls?.codeServer && containerData.status === "running");
          
          if (isPreWarmed) {
            // Pre-warmed container - show immediately, no need to poll!
            console.log(`[IDE] Using pre-warmed container ${containerId} - showing immediately`);
            setContainers((prev) => ({
              ...prev,
              [tab]: {
                id: containerId,
                status: "running", // Force to running for pre-warmed
                urls: {
                  ...containerData.urls,
                  terminal: containerData.urls.terminal || `${IDE_API_BASE_URL}/terminal/${containerId}`,
                  vnc: containerData.urls.vnc || `${IDE_API_BASE_URL}/vnc/${containerId}/`,
                },
              },
            }));
            setIsStarting((prev) => ({ ...prev, [tab]: false }));
            // Container is ready - S3 sync happens in background, code-server is already accessible
          } else {
            // New container or still starting - poll until ready
            console.log(`[IDE] New container ${containerId} with status ${containerData.status} - polling until ready`);
            // Start polling for container readiness
            pollContainerUntilReady(tab, containerId);
          }
        } catch (error: any) {
          console.error(`Failed to start container for ${tab}:`, error);
          setIsStarting((prev) => ({ ...prev, [tab]: false }));
        }
      },
      [user, ideData, updateAttributes, pollContainerUntilReady, toast, IDE_API_BASE_URL]
    );

    // Initialize containers for all tabs on mount
    // Use a ref to track if we've already run the initial check for this block
    const hasInitializedRef = useRef<string | null>(null);
    
    useEffect(() => {
      // Only run once per block ID, not on every ideData change
      if (hasInitializedRef.current === ideData.id) {
        return;
      }
      
      const tabs: TabType[] = ["template", "modelSolution", "autoGrading"];
      
      // Initial check only - don't poll repeatedly
      tabs.forEach((tab) => {
        const containerId = ideData[tab].last_container_id;
        const bucketId = ideData[tab].s3_bucket_id;
        
        // If there's a container but no bucket ID, clear the container
        // Containers cannot exist without S3 buckets
        // Only check this on initial mount, not during container creation
        if (containerId && !bucketId) {
          console.warn(`Container ${containerId} exists for ${tab} but no S3 bucket ID found. Clearing container.`);
          clearContainer(tab);
          return;
        }
        
        if (containerId) {
          // Check if container is still running (one time only)
          // Note: useLocalIDE is captured from closure, so it will use current value
          checkContainerStatus(tab, containerId).catch((error) => {
            // Silently fail - container will be cleared if it doesn't exist
            console.debug(`Container ${containerId} not available for ${tab}`);
          });
        }
      });
      
      hasInitializedRef.current = ideData.id;
    }, [ideData.id, checkContainerStatus, clearContainer]); // Only run when ideData.id changes (new block)

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
      [containers, runFilename, detectLanguage, toast, IDE_API_BASE_URL]
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

    // Sync points from tests when tests change (for autograder tab)
    // Use JSON.stringify to detect actual test changes, not just reference changes
    const testsString = JSON.stringify(ideData.autograder?.tests || []);
    useEffect(() => {
      const tests = ideData.autograder?.tests || [];
      if (tests.length > 0) {
        const totalPoints = tests.reduce((sum, test) => sum + test.points, 0);
        // Only update if points don't match (to avoid infinite loops)
        if (ideData.points !== totalPoints) {
          updateAttributes({
            ideData: {
              ...ideData,
              points: totalPoints,
            },
          });
        }
      }
    }, [testsString, ideData.points, ideData, updateAttributes]);

    // Autograder test case handlers
    const handleAddTest = useCallback(() => {
      setEditingTest(null);
      setTestModalOpen(true);
    }, []);

    const handleEditTest = useCallback((test: TestCase) => {
      setEditingTest(test);
      setTestModalOpen(true);
    }, []);

    const handleDeleteTest = useCallback(
      (testId: string) => {
        const currentTests = ideData.autograder?.tests || [];
        const updatedTests = currentTests.filter((t) => t.id !== testId);
        
        // Compute total points from remaining tests
        const totalPoints = updatedTests.reduce((sum, test) => sum + test.points, 0);
        
        updateAttributes({
          ideData: {
            ...ideData,
            autograder: {
              tests: updatedTests,
            },
            points: totalPoints, // Update points to match total test points
          },
        });

        toast({
          title: "Test case deleted",
          description: "The test case has been removed.",
          variant: "default",
        });
      },
      [ideData, updateAttributes, toast]
    );

    const handleSaveTest = useCallback(
      (testCase: TestCase) => {
        const currentTests = ideData.autograder?.tests || [];
        const existingIndex = currentTests.findIndex((t) => t.id === testCase.id);
        
        let updatedTests: TestCase[];
        if (existingIndex >= 0) {
          // Update existing test
          updatedTests = [...currentTests];
          updatedTests[existingIndex] = testCase;
        } else {
          // Add new test
          updatedTests = [...currentTests, testCase];
        }

        // Compute total points from all tests
        const totalPoints = updatedTests.reduce((sum, test) => sum + test.points, 0);

        updateAttributes({
          ideData: {
            ...ideData,
            autograder: {
              tests: updatedTests,
            },
            points: totalPoints, // Update points to match total test points
          },
        });

        toast({
          title: existingIndex >= 0 ? "Test case updated" : "Test case created",
          description: `The test case "${testCase.name}" has been ${existingIndex >= 0 ? "updated" : "created"}.`,
          variant: "default",
        });
      },
      [ideData, updateAttributes, toast]
    );

    const handleTestModelSolution = useCallback(async () => {
      const container = containers.modelSolution;
      if (!container) {
        toast({
          title: "No container",
          description: "Please start a model solution container first.",
          variant: "destructive",
        });
        return;
      }

      const tests = ideData.autograder?.tests || [];
      if (tests.length === 0) {
        toast({
          title: "No tests",
          description: "Please add test cases in the Auto Grading tab first.",
          variant: "default",
        });
        return;
      }

      // Filter out manual grading tests
      const executableTests = tests.filter((test) => test.type !== "manualGrading");
      if (executableTests.length === 0) {
        toast({
          title: "No executable tests",
          description: "All tests are manual grading. Please add input/output or unit tests.",
          variant: "default",
        });
        return;
      }

      try {
        toast({
          title: "Running tests",
          description: "Executing test cases against model solution...",
          variant: "default",
        });

        const response = await fetch(
          `${IDE_API_BASE_URL}/web/${container.id}/run-tests`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tests: executableTests,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to run tests");
        }

        // Store results and show modal
        setTestResults(data.results || []);
        setTestTotalPoints(data.totalPoints || 0);
        setTestPointsEarned(data.pointsEarned || 0);
        setTestResultsModalOpen(true);

        // Also show toast notification
        const passedCount = data.results.filter((r: any) => r.passed).length;
        const totalCount = data.results.length;
        const pointsEarned = data.pointsEarned || 0;
        const totalPoints = data.totalPoints || 0;

        toast({
          title: `Tests completed: ${passedCount}/${totalCount} passed`,
          description: `Points: ${pointsEarned}/${totalPoints}`,
          variant: passedCount === totalCount ? "default" : "destructive",
        });
      } catch (error: any) {
        console.error("Failed to run tests:", error);
        toast({
          title: "Failed to run tests",
          description: error.message || "An error occurred while running tests.",
          variant: "destructive",
        });
      }
    }, [containers.modelSolution, ideData.autograder?.tests, toast, IDE_API_BASE_URL]);

    const handleDeleteModelSolution = useCallback(async () => {
      const bucketId = ideData.modelSolution.s3_bucket_id;
      
      if (!bucketId) {
        toast({
          title: "No model solution",
          description: "There is no model solution bucket to delete.",
          variant: "default",
        });
        return;
      }

      try {
        // Soft delete the bucket
        await apiClient.softDeleteS3Bucket(bucketId);

        // Clear the bucket ID from IDE block data
        updateAttributes({
          ideData: {
            ...ideData,
            modelSolution: {
              ...ideData.modelSolution,
              s3_bucket_id: null,
              last_container_id: null,
            },
          },
        });

        // Clear the container from state
        setContainers((prev) => ({ ...prev, modelSolution: null }));

        toast({
          title: "Model solution deleted",
          description: "The model solution bucket has been deleted.",
          variant: "default",
        });
      } catch (error: any) {
        console.error("Failed to delete model solution:", error);
        toast({
          title: "Failed to delete model solution",
          description: error.message || "An error occurred while deleting the model solution.",
          variant: "destructive",
        });
      }
    }, [ideData, updateAttributes, toast]);

    const handleRefreshInstance = useCallback(async (tab: TabType) => {
      const container = containers[tab];
      
      // If there's a running container, force sync before refreshing
      if (container) {
        try {
          toast({
            title: "Syncing workspace",
            description: "Saving changes to S3 before refreshing...",
            variant: "default",
          });

          const syncResponse = await fetch(
            `${IDE_API_BASE_URL}/web/${container.id}/sync`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            }
          );

          const syncData = await syncResponse.json();

          if (!syncResponse.ok) {
            console.error("Sync before refresh failed:", syncData);
            toast({
              title: "Sync failed",
              description: syncData.error || "Failed to sync workspace to S3. Refresh cancelled.",
              variant: "destructive",
            });
            return; // Don't refresh if sync failed
          }

          // Wait a bit more to ensure S3 eventual consistency
          await new Promise(resolve => setTimeout(resolve, 2000));

          toast({
            title: "Workspace synced",
            description: `Changes saved to S3 (${syncData.files_synced || 0} files). Refreshing container...`,
            variant: "default",
          });
        } catch (error: any) {
          console.error("Failed to sync before refresh:", error);
          toast({
            title: "Sync error",
            description: "Failed to sync workspace. Refresh cancelled to prevent data loss.",
            variant: "destructive",
          });
          return; // Don't refresh if sync failed
        }
      }

      // Clear the current container
      setContainers((prev) => ({ ...prev, [tab]: null }));
      
      // Clear container ID from block data
      updateAttributes({
        ideData: {
          ...ideData,
          [tab]: {
            ...ideData[tab],
            last_container_id: null,
          },
        },
      });

      // Start a new container with the existing S3 bucket
      await startContainer(tab);
    }, [containers, ideData, updateAttributes, startContainer, toast, IDE_API_BASE_URL]);


    return (
      <NodeViewWrapper
        className="ide-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
        onKeyDown={(e: React.KeyboardEvent) => {
          // Allow keyboard events to pass through if targeting terminal iframe
          const target = e.target as HTMLElement;
          const isTerminalArea = target.closest('[data-terminal-container]') !== null || 
                                 target.closest('iframe[title="Terminal"]') !== null;
          if (!isTerminalArea) {
            // Stop keyboard events from propagating to ProseMirror
            // This prevents page scrolling when typing in Monaco Editor
            e.stopPropagation();
          }
        }}
        onKeyUp={(e: React.KeyboardEvent) => {
          // Allow keyboard events to pass through if targeting terminal iframe
          const target = e.target as HTMLElement;
          const isTerminalArea = target.closest('[data-terminal-container]') !== null || 
                                 target.closest('iframe[title="Terminal"]') !== null;
          if (!isTerminalArea) {
            e.stopPropagation();
          }
        }}
        onKeyPress={(e: React.KeyboardEvent) => {
          // Allow keyboard events to pass through if targeting terminal iframe
          const target = e.target as HTMLElement;
          const isTerminalArea = target.closest('[data-terminal-container]') !== null || 
                                 target.closest('iframe[title="Terminal"]') !== null;
          if (!isTerminalArea) {
            e.stopPropagation();
          }
        }}
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
                className="text-red-600 hover:text-red-700 hover:bg-red-50 w-8 h-8 p-0"
                title="Delete IDE Block"
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
                ideApiBaseUrl={IDE_API_BASE_URL}
                isAdmin={isAdmin}
                useLocalIDE={useLocalIDE}
                bucketId={ideData.template.s3_bucket_id}
                ideData={ideData}
                onToggleIDEEnvironment={() => {
                  setUseLocalIDE(!useLocalIDE);
                  // Clear all containers when switching environments
                  setContainers({
                    template: null,
                    modelSolution: null,
                    autoGrading: null,
                  });
                  toast({
                    title: "IDE Environment Switched",
                    description: `Switched to ${!useLocalIDE ? "local" : "production"} IDE API. Containers cleared.`,
                    variant: "default",
                  });
                }}
                onFilenameChange={(filename) =>
                  setRunFilename((prev) => ({ ...prev, template: filename }))
                }
                onStart={() => startContainer("template")}
                onRun={async () => {
                  const container = containers.template;
                  if (!container) {
                    toast({
                      title: "No container",
                      description: "Please start a container first.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const filename = runFilename.template || "main.py";
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
                  } catch (error: any) {
                    console.error("Failed to execute code:", error);
                    toast({
                      title: "Execution failed",
                      description: error.message || "Failed to execute code.",
                      variant: "destructive",
                    });
                  }
                }}
                onToggleDesktop={() => handleToggleDesktop("template")}
                onClearContainer={() => clearContainer("template")}
                onRefreshInstance={containers.template ? () => handleRefreshInstance("template") : undefined}
                onOpenSidePanel={openSidePanel}
                onOpenFullscreen={openFullscreen}
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
                ideApiBaseUrl={IDE_API_BASE_URL}
                isAdmin={isAdmin}
                useLocalIDE={useLocalIDE}
                bucketId={ideData.modelSolution.s3_bucket_id}
                ideData={ideData}
                onToggleIDEEnvironment={() => {
                  setUseLocalIDE(!useLocalIDE);
                  // Clear all containers when switching environments
                  setContainers({
                    template: null,
                    modelSolution: null,
                    autoGrading: null,
                  });
                  toast({
                    title: "IDE Environment Switched",
                    description: `Switched to ${!useLocalIDE ? "local" : "production"} IDE API. Containers cleared.`,
                    variant: "default",
                  });
                }}
                onFilenameChange={(filename) =>
                  setRunFilename((prev) => ({
                    ...prev,
                    modelSolution: filename,
                  }))
                }
                onStart={() => startContainer("modelSolution")}
                onRun={async () => {
                  const container = containers.modelSolution;
                  if (!container) {
                    toast({
                      title: "No container",
                      description: "Please start a container first.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const filename = runFilename.modelSolution || "main.py";
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
                  } catch (error: any) {
                    console.error("Failed to execute code:", error);
                    toast({
                      title: "Execution failed",
                      description: error.message || "Failed to execute code.",
                      variant: "destructive",
                    });
                  }
                }}
                onToggleDesktop={() => handleToggleDesktop("modelSolution")}
                onClearContainer={() => clearContainer("modelSolution")}
                onDeleteModelSolution={
                  (ideData.modelSolution.s3_bucket_id || containers.modelSolution) 
                    ? handleDeleteModelSolution 
                    : undefined
                }
                hasModelSolution={!!(ideData.modelSolution.s3_bucket_id || containers.modelSolution)}
                onRefreshInstance={containers.modelSolution ? () => handleRefreshInstance("modelSolution") : undefined}
                onOpenSidePanel={openSidePanel}
                onOpenFullscreen={openFullscreen}
              />
            </TabsContent>

            {/* Auto Grading Tab */}
            <TabsContent value="autoGrading" className="mt-4">
              <div className="space-y-4">
                <AutograderTestList
                  tests={ideData.autograder?.tests || []}
                  onAddTest={handleAddTest}
                  onEditTest={handleEditTest}
                  onDeleteTest={handleDeleteTest}
                  onTestModelSolution={handleTestModelSolution}
                />

                {/* Allow Student Check Answer Checkbox */}
                <div className="flex items-center space-x-2 pt-4 border-t">
                  <Checkbox
                    id="allow-student-check"
                    checked={ideData.autograder?.allowStudentCheckAnswer || false}
                    onCheckedChange={(checked) => {
                      updateAttributes({
                        ideData: {
                          ...ideData,
                          autograder: {
                            ...ideData.autograder,
                            tests: ideData.autograder?.tests || [],
                            allowStudentCheckAnswer: checked === true,
                          },
                        },
                      });
                    }}
                  />
                  <Label
                    htmlFor="allow-student-check"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Allow student to check answer
                  </Label>
                </div>
              </div>
              <AutograderTestModal
                open={testModalOpen}
                onOpenChange={setTestModalOpen}
                onSave={handleSaveTest}
                testCase={editingTest}
              />
              <AutograderTestResultsModal
                open={testResultsModalOpen}
                onOpenChange={setTestResultsModalOpen}
                results={testResults}
                totalPoints={testTotalPoints}
                pointsEarned={testPointsEarned}
              />
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Label htmlFor="points" className="text-sm text-gray-700">
                Points:
              </Label>
              {activeTab === "autoGrading" && (ideData.autograder?.tests || []).length > 0 ? (
                // On autograder tab with tests, show computed points (read-only)
                <span className="text-sm font-medium text-gray-900 w-20">
                  {ideData.points}
                </span>
              ) : (
                // On other tabs or no tests, allow manual input
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
              )}
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
  ideApiBaseUrl: string;
  isAdmin: boolean;
  useLocalIDE: boolean;
  bucketId: string | null;
  ideData: IDEBlockData;
  onToggleIDEEnvironment: () => void;
  onFilenameChange: (filename: string) => void;
  onStart: () => void;
  onRun: () => void;
  onToggleDesktop: () => void;
  onClearContainer: () => void;
  onDeleteModelSolution?: () => void;
  hasModelSolution?: boolean;
  onRefreshInstance?: () => void;
  onOpenSidePanel: (state: any) => void;
  onOpenFullscreen: (state: any) => void;
}

const IDETabContent: React.FC<IDETabContentProps> = memo(
  ({
    tab,
    container,
    isStarting,
    showDesktop,
    filename,
    ideApiBaseUrl,
    isAdmin,
    useLocalIDE,
    bucketId,
    ideData,
    onToggleIDEEnvironment,
    onFilenameChange,
    onStart,
    onRun,
    onToggleDesktop,
    onClearContainer,
    onDeleteModelSolution,
    hasModelSolution,
    onRefreshInstance,
    onOpenSidePanel,
    onOpenFullscreen,
  }) => {


    return (
      <div className="space-y-4">
        {/* Header with Delete button on left, Run controls on right */}
        <div className="flex items-center justify-between gap-2">
          {/* Left side - Delete Model Solution button (only for modelSolution tab) */}
          <div className="flex items-center gap-2">
            {tab === "modelSolution" && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDeleteModelSolution || (() => {})}
                disabled={!hasModelSolution}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Model Solution
              </Button>
            )}
          </div>

          {/* Right side - Admin-only IDE environment toggle */}
          <div className="flex items-center gap-2">
            {/* Admin-only IDE environment toggle */}
            {isAdmin && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-gray-300 bg-gray-50">
                <Label htmlFor={`ide-env-toggle-${tab}`} className="text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                  {useLocalIDE ? "Local" : "Production"}
                </Label>
                <button
                  id={`ide-env-toggle-${tab}`}
                  onClick={onToggleIDEEnvironment}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                    useLocalIDE ? "bg-purple-600" : "bg-gray-300"
                  }`}
                  title={`Switch to ${useLocalIDE ? "production" : "local"} IDE environment`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      useLocalIDE ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Container area */}
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
          {/* Show Monaco IDE if we have a bucketId (files can be viewed/edited even without container) */}
          {bucketId && (
            <div className="h-[600px]">
              <MonacoIDE
                bucketId={bucketId}
                containerId={container?.id || null}
                containerTerminalUrl={container?.urls?.terminal}
                containerVncUrl={container?.urls?.vnc}
                containerWebServerUrl={container?.urls?.webServer}
                ideApiBaseUrl={ideApiBaseUrl}
                onRun={container ? onRun : onStart}
                runFilename={filename}
                onFilenameChange={onFilenameChange}
                isStarting={isStarting}
                onRefreshInstance={onRefreshInstance}
                onToggleDesktop={onToggleDesktop}
                showDesktop={showDesktop}
                onContainerKilled={() => {
                  // Clear the container state gracefully - no errors, just go back to unconnected state
                  onClearContainer();
                }}
                showPanelButtons={true}
                onOpenSidePanel={() => onOpenSidePanel({
                  ideData,
                  container,
                  bucketId,
                  isStarting,
                  showDesktop,
                  runFilename: filename,
                  ideApiBaseUrl,
                })}
                onOpenFullscreen={() => onOpenFullscreen({
                  ideData,
                  container,
                  bucketId,
                  isStarting,
                  showDesktop,
                  runFilename: filename,
                  ideApiBaseUrl,
                })}
              />
            </div>
          )}

          {/* Show start button only if no bucketId and no container */}
          {!bucketId && !container && !isStarting && (
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
        </div>
      </div>
    );
  }
);

IDETabContent.displayName = "IDETabContent";

export default IDEBlockEditor;

