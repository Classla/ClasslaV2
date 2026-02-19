import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useRef,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { IDEBlockData, TestCase, IDELanguage } from "../../extensions/IDEBlock";
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
  Sparkles,
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

// Hello World starter templates
const PYTHON_HELLO_WORLD = `# Hello World in Python
print("Hello, World!")
`;

const JAVA_HELLO_WORLD = `// Hello World in Java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
`;

type TabType = "template" | "modelSolution" | "autoGrading";

// Module-level maps to persist state across TipTap node view remounts
// (OT sync after updateAttributes can cause full component remounts)
const persistedActiveTab = new Map<string, TabType>();
const persistedPendingTestRun = new Map<string, boolean>();
const persistedTestingState = new Map<string, boolean>();

const IDEBlockEditor: React.FC<IDEBlockEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const ideData = node.attrs.ideData as IDEBlockData;
    const { toast } = useToast();
    const { user } = useAuth();
    const { openSidePanel, openFullscreen, updatePanelState, panelMode } = useIDEPanel();
    const { courseId, assignmentId } = useAssignmentContext();

    // Admin toggle for local vs production IDE API
    const [useLocalIDE, setUseLocalIDE] = useState(false);
    const isAdmin = user?.isAdmin || false;
    const IDE_API_BASE_URL = useLocalIDE ? LOCAL_IDE_API_BASE_URL : PRODUCTION_IDE_API_BASE_URL;

    const currentUser = useMemo(() => {
      if (!user) return undefined;
      return {
        id: user.id,
        name: user.firstName || user.email || "Instructor",
        color: userIdToColor(user.id),
      };
    }, [user]);

    const [activeTab, setActiveTab] = useState<TabType>(() => persistedActiveTab.get(ideData.id) || "template");
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

    // Track whether THIS instance owns the side panel relationship.
    // Only the owner pushes state updates to prevent dual-instance overwrites
    // (React StrictMode / TipTap creates duplicate instances).
    const isSidePanelOwnerRef = useRef(false);

    // Unique instance ID for cross-instance container state sync
    const instanceIdRef = useRef(`ide-editor-${Math.random().toString(36).slice(2, 8)}`);

    // Epoch counter per tab — incremented on deletion to cancel in-flight startContainer calls
    const startContainerEpochRef = useRef<Record<TabType, number>>({
      template: 0,
      modelSolution: 0,
      autoGrading: 0,
    });

    // pendingTestRunRef backed by module-level map so it survives remounts
    const pendingTestRunRef = useRef(persistedPendingTestRun.get(ideData.id) || false);

    // Wrap openSidePanel to claim ownership when this instance opens it
    const openSidePanelWithOwnership = useCallback((...args: Parameters<typeof openSidePanel>) => {
      isSidePanelOwnerRef.current = true;
      openSidePanel(...args);
    }, [openSidePanel]);

    // AI model solution generation
    const [isGeneratingModelSolution, setIsGeneratingModelSolution] = useState(false);
    // AI unit test generation
    const [isGeneratingUnitTests, setIsGeneratingUnitTests] = useState(false);

    // Autograder test case management
    const [isTestingModelSolution, _setIsTestingModelSolution] = useState(() => persistedTestingState.get(ideData.id) || false);
    const setIsTestingModelSolution = useCallback((value: boolean) => {
      _setIsTestingModelSolution(value);
      persistedTestingState.set(ideData.id, value);
    }, [ideData.id]);
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
                  terminal: container.urls.terminal || `${currentIDEBaseUrl}/terminal/${container.id}/`,
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
      async (tab: TabType, language?: IDELanguage) => {
        if (!user?.id) {
          toast({
            title: "Authentication required",
            description: "Please sign in to start a container.",
            variant: "destructive",
          });
          return;
        }

        setIsStarting((prev) => ({ ...prev, [tab]: true }));
        const startEpoch = startContainerEpochRef.current[tab]; // capture before any await

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

              // Seed initial file for new template buckets
              if (isTemplate && bucketId) {
                const lang = language || ideData.settings?.language || "python";
                const starterFile = lang === "java" ? "Main.java" : "main.py";
                const starterContent = lang === "java" ? JAVA_HELLO_WORLD : PYTHON_HELLO_WORLD;
                try {
                  await apiClient.createS3File(bucketId, starterFile, starterContent);
                  console.log(`[IDE] Seeded ${starterFile} for ${lang} template`);
                } catch (seedError) {
                  console.warn("Failed to seed initial file:", seedError);
                  // Continue anyway - bucket is created, just no starter file
                }
              }
            }

            // Update block data with bucket ID
            if (startContainerEpochRef.current[tab] !== startEpoch) return;
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

              // Seed initial file for new template buckets
              if (isTemplate && bucketId) {
                const lang = language || ideData.settings?.language || "python";
                const starterFile = lang === "java" ? "Main.java" : "main.py";
                const starterContent = lang === "java" ? JAVA_HELLO_WORLD : PYTHON_HELLO_WORLD;
                try {
                  await apiClient.createS3File(bucketId, starterFile, starterContent);
                  console.log(`[IDE] Seeded ${starterFile} for ${lang} template`);
                } catch (seedError) {
                  console.warn("Failed to seed initial file:", seedError);
                  // Continue anyway - bucket is created, just no starter file
                }
              }
            }

            // Update block data with bucket ID
            if (startContainerEpochRef.current[tab] !== startEpoch) return;
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
          if (startContainerEpochRef.current[tab] !== startEpoch) return;
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
          if (startContainerEpochRef.current[tab] !== startEpoch) return;
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
                  terminal: containerData.urls.terminal || `${IDE_API_BASE_URL}/terminal/${containerId}/`,
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
      const tab = value as TabType;
      setActiveTab(tab);
      persistedActiveTab.set(ideData.id, tab);
    }, [ideData.id]);

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
        const bucketId = ideData[tab].s3_bucket_id;

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
          if (error instanceof TypeError) {
            const isAlive = await checkContainerStatus(tab, container.id);
            if (!isAlive) {
              toast({
                title: "Container disconnected",
                description: "Restarting container. Please click Run again in a moment.",
              });
              startContainer(tab);
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
      },
      [containers, runFilename, detectLanguage, toast, IDE_API_BASE_URL, ideData, checkContainerStatus, startContainer]
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

    // Run tests on a specific container (extracted helper)
    const runTestsOnContainer = useCallback(async (containerId: string) => {
      const tests = ideData.autograder?.tests || [];
      if (tests.length === 0) {
        setIsTestingModelSolution(false);
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
        setIsTestingModelSolution(false);
        toast({
          title: "No executable tests",
          description: "All tests are manual grading. Please add input/output or unit tests.",
          variant: "default",
        });
        return;
      }

      try {
        // Retry loop: the container's web server (port 3000) may not be ready
        // immediately after startup, causing Traefik to return 502
        const maxRetries = 5;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 2000));
          }

          const response = await fetch(
            `${IDE_API_BASE_URL}/web/${containerId}/run-tests`,
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

          if (response.status === 502) {
            lastError = new Error("Container web server not ready yet");
            continue;
          }

          if (!response.ok) {
            const text = await response.text();
            let message = "Failed to run tests";
            try { message = JSON.parse(text).error || message; } catch {}
            throw new Error(message);
          }

          const data = await response.json();

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
          return; // Success — exit the function
        }

        // All retries exhausted
        throw lastError || new Error("Failed to run tests after retries");
      } catch (error: any) {
        console.error("Failed to run tests:", error);
        toast({
          title: "Failed to run tests",
          description: error.message || "An error occurred while running tests.",
          variant: "destructive",
        });
      } finally {
        setIsTestingModelSolution(false);
      }
    }, [ideData.autograder?.tests, toast, setIsTestingModelSolution, IDE_API_BASE_URL]);

    const handleTestModelSolution = useCallback(async () => {
      const container = containers.modelSolution;

      if (!container) {
        // Validate tests exist before starting a container
        const tests = ideData.autograder?.tests || [];
        if (tests.length === 0) {
          toast({
            title: "No tests",
            description: "Please add test cases in the Auto Grading tab first.",
            variant: "default",
          });
          return;
        }

        const executableTests = tests.filter((test) => test.type !== "manualGrading");
        if (executableTests.length === 0) {
          toast({
            title: "No executable tests",
            description: "All tests are manual grading. Please add input/output or unit tests.",
            variant: "default",
          });
          return;
        }

        // Auto-start the container and queue the test run
        setIsTestingModelSolution(true);
        pendingTestRunRef.current = true;
        persistedPendingTestRun.set(ideData.id, true);
        startContainer("modelSolution");
        return;
      }

      // Container already running — run tests directly
      setIsTestingModelSolution(true);
      await runTestsOnContainer(container.id);
    }, [containers.modelSolution, ideData.id, ideData.autograder?.tests, toast, setIsTestingModelSolution, startContainer, runTestsOnContainer]);

    // Auto-run pending tests when model solution container becomes ready
    useEffect(() => {
      if (
        containers.modelSolution &&
        !isStarting.modelSolution &&
        pendingTestRunRef.current
      ) {
        pendingTestRunRef.current = false;
        persistedPendingTestRun.delete(ideData.id);
        runTestsOnContainer(containers.modelSolution.id);
      }
    }, [containers.modelSolution, isStarting.modelSolution, ideData.id, runTestsOnContainer]);

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
        // Cancel any in-progress startContainer for modelSolution and reset UI immediately
        startContainerEpochRef.current.modelSolution++;
        setIsStarting((prev) => ({ ...prev, modelSolution: false }));

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

    const handleGenerateModelSolution = useCallback(async () => {
      if (!assignmentId) {
        toast({
          title: "No assignment",
          description: "Save the assignment first before generating a model solution.",
          variant: "destructive",
        });
        return;
      }

      setIsGeneratingModelSolution(true);
      try {
        const response = await apiClient.generateModelSolution(assignmentId, ideData.id);
        const { modelSolutionBucketId } = response.data;

        if (modelSolutionBucketId) {
          updateAttributes({
            ideData: {
              ...ideData,
              modelSolution: {
                ...ideData.modelSolution,
                s3_bucket_id: modelSolutionBucketId,
              },
            },
          });

          toast({
            title: "Model solution generated",
            description: "AI has created a model solution. You can review it in the editor.",
          });
        }
      } catch (error: any) {
        console.error("Failed to generate model solution:", error);
        const message = error.response?.data?.error?.message || error.message || "Failed to generate model solution.";
        toast({
          title: "Generation failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsGeneratingModelSolution(false);
      }
    }, [assignmentId, ideData, updateAttributes, toast]);

    const handleGenerateUnitTests = useCallback(async () => {
      if (!assignmentId) {
        toast({
          title: "No assignment",
          description: "Save the assignment first before generating unit tests.",
          variant: "destructive",
        });
        return;
      }

      setIsGeneratingUnitTests(true);
      try {
        const response = await apiClient.generateUnitTests(assignmentId, ideData.id);
        const { tests: generatedTests } = response.data;

        if (generatedTests && generatedTests.length > 0) {
          const existingTests = ideData.autograder?.tests || [];
          const mergedTests = [...existingTests, ...generatedTests];
          const totalPoints = mergedTests.reduce((sum: number, test: TestCase) => sum + test.points, 0);

          updateAttributes({
            ideData: {
              ...ideData,
              autograder: {
                ...ideData.autograder,
                tests: mergedTests,
              },
              points: totalPoints,
            },
          });

          toast({
            title: "Unit tests generated",
            description: `AI generated ${generatedTests.length} unit test${generatedTests.length === 1 ? "" : "s"}.`,
          });
        }
      } catch (error: any) {
        console.error("Failed to generate unit tests:", error);
        const message = error.response?.data?.error?.message || error.message || "Failed to generate unit tests.";
        toast({
          title: "Generation failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsGeneratingUnitTests(false);
      }
    }, [assignmentId, ideData, updateAttributes, toast]);

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

    // Push state updates to the side panel for the active tab
    // Reset ownership when panel closes
    useEffect(() => {
      if (panelMode === 'none') {
        isSidePanelOwnerRef.current = false;
      }
    }, [panelMode]);

    useEffect(() => {
      if (panelMode !== 'side-panel') return;
      if (!isSidePanelOwnerRef.current) return;
      const tabContainer = containers[activeTab];
      const tabIsStarting = isStarting[activeTab];
      const tabShowDesktop = showDesktop[activeTab];
      const tabFilename = runFilename[activeTab];
      const tabBucketId = ideData[activeTab].s3_bucket_id;
      updatePanelState({
        container: tabContainer,
        isStarting: tabIsStarting,
        bucketId: tabBucketId,
        showDesktop: tabShowDesktop,
        runFilename: tabFilename,
      });
    }, [containers, isStarting, showDesktop, runFilename, activeTab, panelMode, updatePanelState, ideData]);

    // Broadcast container/isStarting state to other instances of the same IDE block
    // CustomEvent: same-tab sync (React StrictMode / TipTap duplicate instances)
    // BroadcastChannel: cross-tab sync (fullscreen IDE in another tab)
    const isSyncingFromPeerRef = useRef(false);
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    // Set up BroadcastChannel for cross-tab container sync
    useEffect(() => {
      const channel = new BroadcastChannel(`ide-container-${ideData.id}`);
      broadcastChannelRef.current = channel;

      channel.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "container-update" && msg.blockId === ideData.id) {
          isSyncingFromPeerRef.current = true;
          if (msg.container) {
            setContainers((prev) => ({ ...prev, [activeTab]: msg.container }));
          }
          setIsStarting((prev) => ({ ...prev, [activeTab]: msg.isStarting }));
        }
      };

      return () => {
        channel.close();
        broadcastChannelRef.current = null;
      };
    }, [ideData.id, activeTab]);

    useEffect(() => {
      // Don't broadcast if we just received this state from a peer (avoids infinite loop)
      if (isSyncingFromPeerRef.current) {
        isSyncingFromPeerRef.current = false;
        return;
      }
      // Same-tab sync via CustomEvent
      window.dispatchEvent(new CustomEvent('ide-container-sync', {
        detail: {
          ideDataId: ideData.id,
          sourceInstanceId: instanceIdRef.current,
          containers,
          isStarting,
        },
      }));
      // Cross-tab sync via BroadcastChannel
      const tabContainer = containers[activeTab];
      const tabIsStarting = isStarting[activeTab];
      try {
        broadcastChannelRef.current?.postMessage({
          type: "container-update",
          blockId: ideData.id,
          container: tabContainer,
          isStarting: tabIsStarting,
        });
      } catch {
        // Channel may be closed
      }
    }, [containers, isStarting, ideData.id, activeTab]);

    // Listen for container state broadcasts from sibling instances (same tab)
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.ideDataId !== ideData.id) return;
        if (detail.sourceInstanceId === instanceIdRef.current) return;
        // Sync container state from the sibling instance
        isSyncingFromPeerRef.current = true;
        if (detail.containers) {
          setContainers(detail.containers);
        }
        if (detail.isStarting) {
          setIsStarting(detail.isStarting);
        }
      };
      window.addEventListener('ide-container-sync', handler);
      return () => window.removeEventListener('ide-container-sync', handler);
    }, [ideData.id]);

    // Listen for side panel actions (start container, run code) via custom events
    // stopImmediatePropagation prevents duplicate handlers (React StrictMode / TipTap node views)
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.ideDataId !== ideData.id) return;
        e.stopImmediatePropagation();
        // This instance handled the event, so it owns the side panel relationship
        isSidePanelOwnerRef.current = true;
        if (detail.action === 'start') {
          startContainer(activeTab);
        } else if (detail.action === 'run') {
          handleRun(activeTab);
        }
      };
      window.addEventListener('ide-panel-action', handler);
      return () => window.removeEventListener('ide-panel-action', handler);
    }, [ideData.id, activeTab, startContainer, handleRun]);

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
        <div className="ide-editor border border-border rounded-lg p-4 bg-card shadow-sm select-none">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  IDE Block - Virtual Codespace
                </div>
                <div className="text-xs text-muted-foreground">
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
                onOpenSidePanel={openSidePanelWithOwnership}
                onOpenFullscreen={openFullscreen}
                currentUser={currentUser}
                onLanguageSelect={(language: IDELanguage) => {
                  const newRunFile = language === "java" ? "Main.java" : "main.py";
                  updateAttributes({
                    ideData: {
                      ...ideData,
                      settings: {
                        ...ideData.settings,
                        language,
                        default_run_file: newRunFile,
                      },
                    },
                  });
                  setRunFilename({
                    template: newRunFile,
                    modelSolution: newRunFile,
                    autoGrading: newRunFile,
                  });
                  // Auto-start container after selecting language
                  startContainer("template", language);
                }}
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
                onGenerateModelSolution={handleGenerateModelSolution}
                isGeneratingModelSolution={isGeneratingModelSolution}
                onRefreshInstance={containers.modelSolution ? () => handleRefreshInstance("modelSolution") : undefined}
                onOpenSidePanel={openSidePanelWithOwnership}
                onOpenFullscreen={openFullscreen}
                currentUser={currentUser}
                onLanguageSelect={(language: IDELanguage) => {
                  const newRunFile = language === "java" ? "Main.java" : "main.py";
                  updateAttributes({
                    ideData: {
                      ...ideData,
                      settings: {
                        ...ideData.settings,
                        language,
                        default_run_file: newRunFile,
                      },
                    },
                  });
                  setRunFilename({
                    template: newRunFile,
                    modelSolution: newRunFile,
                    autoGrading: newRunFile,
                  });
                  // Auto-start container after selecting language
                  startContainer("modelSolution", language);
                }}
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
                  isTestingModelSolution={isTestingModelSolution}
                  onGenerateUnitTests={handleGenerateUnitTests}
                  isGeneratingUnitTests={isGeneratingUnitTests}
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
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Label htmlFor="points" className="text-sm text-foreground">
                Points:
              </Label>
              {activeTab === "autoGrading" && (ideData.autograder?.tests || []).length > 0 ? (
                // On autograder tab with tests, show computed points (read-only)
                <span className="text-sm font-medium text-foreground w-20">
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
  onGenerateModelSolution?: () => void;
  isGeneratingModelSolution?: boolean;
  onRefreshInstance?: () => void;
  onOpenSidePanel: (state: any) => void;
  onOpenFullscreen: (state: any) => void;
  onLanguageSelect: (language: IDELanguage) => void; // Sets language AND starts container
  currentUser?: { id: string; name: string; color: string };
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
    onGenerateModelSolution,
    isGeneratingModelSolution,
    onRefreshInstance,
    onOpenSidePanel,
    onOpenFullscreen,
    onLanguageSelect,
    currentUser,
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
              <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-border bg-muted">
                <Label htmlFor={`ide-env-toggle-${tab}`} className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                  {useLocalIDE ? "Local" : "Production"}
                </Label>
                <button
                  id={`ide-env-toggle-${tab}`}
                  onClick={onToggleIDEEnvironment}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                    useLocalIDE ? "bg-purple-600" : "bg-muted-foreground"
                  }`}
                  title={`Switch to ${useLocalIDE ? "production" : "local"} IDE environment`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
                      useLocalIDE ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Container area */}
        <div className="border border-border rounded-lg overflow-hidden bg-muted">
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
                currentUser={currentUser}
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

          {/* Show skeleton loader while IDE is starting */}
          {!bucketId && !container && isStarting && (
            <div className="h-[600px] flex flex-col relative">
              {/* Skeleton toolbar */}
              <div className="flex items-center gap-2 p-2 border-b border-border bg-muted">
                <div className="w-8 h-8 bg-accent rounded animate-pulse" />
                <div className="w-20 h-6 bg-accent rounded animate-pulse" />
                <div className="w-16 h-6 bg-accent rounded animate-pulse" />
                <div className="flex-1" />
                <div className="w-24 h-8 bg-accent rounded animate-pulse" />
              </div>
              <div className="flex flex-1">
                {/* Skeleton file explorer */}
                <div className="w-48 border-r border-border bg-muted p-3 space-y-2">
                  <div className="w-full h-5 bg-accent rounded animate-pulse" />
                  <div className="w-3/4 h-5 bg-accent rounded animate-pulse ml-4" />
                  <div className="w-2/3 h-5 bg-accent rounded animate-pulse ml-4" />
                  <div className="w-4/5 h-5 bg-accent rounded animate-pulse" />
                </div>
                {/* Skeleton editor */}
                <div className="flex-1 bg-gray-900 p-4 space-y-2">
                  <div className="w-1/3 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-2/3 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-1/2 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-3/4 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-1/4 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-2/3 h-4 bg-muted rounded animate-pulse" />
                </div>
              </div>
              {/* Skeleton terminal */}
              <div className="h-32 border-t border-border bg-gray-900 p-3">
                <div className="w-1/4 h-4 bg-muted rounded animate-pulse mb-2" />
                <div className="w-1/2 h-4 bg-muted rounded animate-pulse" />
              </div>
              {/* Loading overlay */}
              <div className="absolute inset-0 bg-card/50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                  <p className="text-sm text-muted-foreground font-medium">Starting Virtual Codespace...</p>
                </div>
              </div>
            </div>
          )}

          {/* Show language selection if no bucketId, no container, and not starting */}
          {!bucketId && !container && !isStarting && (
            <div className="flex flex-col items-center justify-center h-96">
              {/* Create with AI button for model solution tab */}
              {tab === "modelSolution" && !hasModelSolution && onGenerateModelSolution && (
                <Button
                  onClick={onGenerateModelSolution}
                  disabled={isGeneratingModelSolution}
                  variant="outline"
                  className="mb-6 border-purple-300 text-primary hover:bg-primary/10 hover:border-purple-400"
                >
                  {isGeneratingModelSolution ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  {isGeneratingModelSolution ? "Generating..." : "Create with AI"}
                </Button>
              )}
              <Code2 className="w-16 h-16 text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium mb-2">
                Start Virtual Codespace
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Select a programming language to get started
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => onLanguageSelect("python")}
                  variant="outline"
                  className="flex flex-col items-center gap-2 h-auto py-4 px-6 hover:border-purple-500 hover:bg-primary/10"
                >
                  <svg className="w-8 h-8" viewBox="0 0 256 255" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid">
                    <defs>
                      <linearGradient x1="12.959%" y1="12.039%" x2="79.639%" y2="78.201%" id="pythonA">
                        <stop stopColor="#387EB8" offset="0%"/>
                        <stop stopColor="#366994" offset="100%"/>
                      </linearGradient>
                      <linearGradient x1="19.128%" y1="20.579%" x2="90.742%" y2="88.429%" id="pythonB">
                        <stop stopColor="#FFE052" offset="0%"/>
                        <stop stopColor="#FFC331" offset="100%"/>
                      </linearGradient>
                    </defs>
                    <path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" fill="url(#pythonA)"/>
                    <path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" fill="url(#pythonB)"/>
                  </svg>
                  <span className="font-medium">Python</span>
                </Button>
                <Button
                  onClick={() => onLanguageSelect("java")}
                  variant="outline"
                  className="flex flex-col items-center gap-2 h-auto py-4 px-6 hover:border-purple-500 hover:bg-primary/10"
                >
                  <svg className="w-8 h-8" viewBox="0 0 256 346" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid">
                    <path d="M82.554 267.473s-13.198 7.675 9.393 10.272c27.369 3.122 41.356 2.675 71.517-3.034 0 0 7.93 4.972 19.003 9.279-67.611 28.977-153.019-1.679-99.913-16.517M74.292 229.659s-14.803 10.958 7.805 13.296c29.236 3.016 52.324 3.263 92.276-4.43 0 0 5.526 5.602 14.215 8.666-81.747 23.904-172.798 1.885-114.296-17.532" fill="#5382A1"/>
                    <path d="M143.942 165.515c16.66 19.18-4.377 36.44-4.377 36.44s42.301-21.837 22.874-49.183c-18.144-25.5-32.059-38.172 43.268-81.858 0 0-118.238 29.53-61.765 94.6" fill="#E76F00"/>
                    <path d="M233.364 295.442s9.767 8.047-10.757 14.273c-39.026 11.823-162.432 15.393-196.714.471-12.323-5.36 10.787-12.8 18.056-14.362 7.581-1.644 11.914-1.337 11.914-1.337-13.705-9.655-88.583 18.957-38.034 27.15 137.853 22.356 251.292-10.066 215.535-26.195M88.9 190.48s-62.771 14.91-22.228 20.323c17.118 2.292 51.243 1.774 83.03-.89 25.978-2.19 52.063-6.85 52.063-6.85s-9.16 3.923-15.787 8.448c-63.744 16.765-186.886 8.966-151.435-8.183 29.981-14.492 54.358-12.848 54.358-12.848M201.506 253.422c64.8-33.672 34.839-66.03 13.927-61.67-5.126 1.066-7.411 1.99-7.411 1.99s1.903-2.98 5.537-4.27c41.37-14.545 73.187 42.897-13.355 65.647 0 .001 1.003-.895 1.302-1.697" fill="#5382A1"/>
                    <path d="M162.439.371s35.887 35.9-34.037 91.101c-56.071 44.282-12.786 69.53-.023 98.377-32.73-29.53-56.75-55.526-40.635-79.72C111.395 74.612 176.918 57.393 162.439.37" fill="#E76F00"/>
                    <path d="M95.268 344.665c62.199 3.982 157.712-2.209 159.974-31.64 0 0-4.348 11.158-51.404 20.018-53.088 9.99-118.564 8.824-157.399 2.421.001 0 7.95 6.58 48.83 9.201" fill="#5382A1"/>
                  </svg>
                  <span className="font-medium">Java</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

IDETabContent.displayName = "IDETabContent";

export default IDEBlockEditor;

