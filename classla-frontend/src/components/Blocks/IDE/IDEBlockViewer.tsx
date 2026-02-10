import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useRef,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { IDEBlockData } from "../../extensions/IDEBlock";
import {
  Loader2,
  Code2,
  RotateCcw,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  History,
} from "lucide-react";
import MonacoIDE from "./MonacoIDE";
import AutograderTestResultsModal from "./AutograderTestResultsModal";
import { Button } from "../../ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import { useToast } from "../../../hooks/use-toast";
import { apiClient } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";
import { useIDEPanel } from "../../../contexts/IDEPanelContext";
import { useAssignmentContext } from "../../../contexts/AssignmentContext";
import { otProvider } from "../../../lib/otClient";

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
    terminal?: string;
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
    const { openSidePanel, openFullscreen, updatePanelState, panelMode } = useIDEPanel();
    const { courseId, assignmentId } = useAssignmentContext();

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
    // Track student's cloned bucket ID (persisted in localStorage)
    // Initialize from localStorage for faster rendering while API call is in flight
    const [studentBucketId, setStudentBucketId] = useState<string | null>(() => {
      if (!assignmentId || !user?.id) return null;
      const storageKey = `student_bucket_${assignmentId}_${user.id}`;
      return localStorage.getItem(storageKey);
    });

    // Test results state for autograder
    const [isRunningTests, setIsRunningTests] = useState(false);
    const [testResultsModalOpen, setTestResultsModalOpen] = useState(false);
    const [testResults, setTestResults] = useState<any[]>([]);
    const [testTotalPoints, setTestTotalPoints] = useState(0);
    const [testPointsEarned, setTestPointsEarned] = useState(0);

    // Historical test runs
    const [testRunHistory, setTestRunHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const currentUser = useMemo(() => {
      if (!user) return undefined;
      return {
        id: user.id,
        name: user.firstName || user.email || "User",
        color: userIdToColor(user.id),
      };
    }, [user]);

    const pollingAttemptsRef = useRef(0);

    // Track whether THIS instance owns the side panel relationship.
    // Only the owner pushes state updates to prevent dual-instance overwrites.
    const isSidePanelOwnerRef = useRef(false);

    // Wrap openSidePanel to claim ownership when this instance opens it
    const openSidePanelWithOwnership = useCallback((...args: Parameters<typeof openSidePanel>) => {
      isSidePanelOwnerRef.current = true;
      openSidePanel(...args);
    }, [openSidePanel]);

    // Load student's cloned bucket on mount - query database for existing bucket
    useEffect(() => {
      if (!assignmentId || !user?.id) return;

      const loadStudentBucket = async () => {
        try {
          console.log("[IDE Student] Querying for student bucket:", {
            assignmentId,
            userId: user.id,
            templateBucketId: ideData.template.s3_bucket_id
          });

          // Query database for student's bucket for this assignment
          const bucketsResponse = await apiClient.listS3Buckets({
            user_id: user.id,
            assignment_id: assignmentId,
          });

          const buckets = bucketsResponse.data?.buckets || [];

          // Find the first non-template, non-deleted bucket for this student and assignment
          const studentBucket = buckets?.find(
            (b: any) =>
              !b.is_template &&
              !b.deleted_at &&
              b.user_id === user.id &&
              b.assignment_id === assignmentId
          );

          if (studentBucket) {
            console.log("[IDE Student] Found existing student bucket:", studentBucket.id);
            setStudentBucketId(studentBucket.id);

            // Also save to localStorage for faster subsequent loads
            const storageKey = `student_bucket_${assignmentId}_${user.id}`;
            localStorage.setItem(storageKey, studentBucket.id);
          } else {
            console.log("[IDE Student] No existing bucket found, student will need to clone");
            setStudentBucketId(null);

            // Clear localStorage if it has a stale value
            const storageKey = `student_bucket_${assignmentId}_${user.id}`;
            localStorage.removeItem(storageKey);
          }
        } catch (error) {
          console.error("Failed to load student bucket:", error);
          // Try localStorage as fallback (e.g., if API call fails)
          const storageKey = `student_bucket_${assignmentId}_${user.id}`;
          const cachedBucketId = localStorage.getItem(storageKey);
          if (cachedBucketId) {
            console.log("[IDE Student] Using cached bucket from localStorage:", cachedBucketId);
            setStudentBucketId(cachedBucketId);
          } else {
            setStudentBucketId(null);
          }
        }
      };

      loadStudentBucket();
    }, [assignmentId, user?.id, ideData.template.s3_bucket_id]);

    // Cleanup polling interval on unmount
    useEffect(() => {
      return () => {
        if (pollingInterval) clearInterval(pollingInterval);
      };
    }, [pollingInterval]);

    // Load test run history when component mounts or when autograder tab becomes visible
    useEffect(() => {
      if (!assignmentId || !ideData.id || !ideData.autograder?.allowStudentCheckAnswer) return;

      const loadTestHistory = async () => {
        setIsLoadingHistory(true);
        try {
          const response = await apiClient.getIDETestRuns(assignmentId, ideData.id, { limit: 10 });
          setTestRunHistory(response.data || []);
        } catch (error) {
          console.error("Failed to load test run history:", error);
          // Don't show error toast - history is optional
        } finally {
          setIsLoadingHistory(false);
        }
      };

      loadTestHistory();
    }, [assignmentId, ideData.id, ideData.autograder?.allowStudentCheckAnswer]);

    // Clear container (keeps S3 bucket)
    const clearContainer = useCallback(() => {
      setContainer(null);
    }, []);

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
        // For student view, use existing cloned bucket or create/clone new one
        let bucketId: string | null = studentBucketId;
        let bucketName: string;
        let bucketRegion: string;

        // If we don't have a cloned bucket yet, create or clone one
        if (!bucketId) {
          const templateBucketId = ideData.template.s3_bucket_id;

          if (!templateBucketId) {
            // No template bucket exists, create a new empty bucket
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
          } else {
            // Clone from template bucket
            const cloneResponse = await apiClient.cloneS3Bucket(templateBucketId, {
              course_id: courseId || undefined,
              assignment_id: assignmentId || undefined,
              region: "us-east-1",
            });

            if (!cloneResponse?.data) {
              throw new Error("Failed to clone S3 bucket");
            }

            bucketId = cloneResponse.data.id;
            bucketName = cloneResponse.data.bucket_name;
            bucketRegion = cloneResponse.data.region;

            console.log("[IDE Student] Cloned template bucket:", {
              templateBucketId,
              clonedBucketId: bucketId,
              bucketName,
              userId: user.id,
              assignmentId,
              courseId
            });
          }

          // Save the cloned bucket ID to state and localStorage
          setStudentBucketId(bucketId);
          if (assignmentId && user.id && bucketId) {
            const storageKey = `student_bucket_${assignmentId}_${user.id}`;
            localStorage.setItem(storageKey, bucketId);
            console.log("[IDE Student] Saved bucket to localStorage:", storageKey, bucketId);
          }
        } else {
          // Get existing bucket info
          const bucketResponse = await apiClient.getS3Bucket(bucketId);
          bucketName = bucketResponse.data.bucket_name;
          bucketRegion = bucketResponse.data.region || "us-east-1";
        }

        // Start container
        const containerResponse = await apiClient.startIDEContainer({
          s3Bucket: bucketName,
          s3BucketId: bucketId ?? undefined,
          s3Region: bucketRegion,
          userId: user.id,
        });

        const containerData = containerResponse.data;
        const containerId = containerData.id;

        // If container is pre-warmed and ready, show immediately
        const isPreWarmed = containerData.isPreWarmed || (containerData.urls?.codeServer && containerData.status === "running");

        if (isPreWarmed) {
          setContainer({
            id: containerId,
            status: "running",
            urls: {
              ...containerData.urls,
              terminal: containerData.urls.terminal || `${IDE_API_BASE_URL}/terminal/${containerId}/`,
              vnc: containerData.urls.vnc || `${IDE_API_BASE_URL}/vnc/${containerId}/`,
            },
          });
          setIsStarting(false);
        } else {
          // Start polling for container readiness
          pollContainerUntilReady(containerId);
        }
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
    }, [user, ideData, studentBucketId, assignmentId, courseId, pollContainerUntilReady, toast]);

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

      // Write the file directly to the container's filesystem before running
      // This ensures the container executes the latest code, not stale filesystem content
      if (studentBucketId && filename) {
        try {
          const doc = otProvider.getDocument(studentBucketId, filename);
          if (doc) {
            const content = doc.content;
            if (content) {
              console.log("[IDE] Writing file to container filesystem before run:", filename);
              await fetch(`${IDE_API_BASE_URL}/web/${container.id}/write-file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: filename, content }),
              });
              // Also save to S3 for persistence (fire-and-forget)
              apiClient.saveS3File(studentBucketId, filename, content).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("[IDE] Failed to write file to container before run:", e);
        }
      }

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
    }, [container, runFilename, detectLanguage, toast, studentBucketId]);

    // Reset ownership when panel closes
    useEffect(() => {
      if (panelMode === 'none') {
        isSidePanelOwnerRef.current = false;
      }
    }, [panelMode]);

    // Push state updates to the side panel whenever container/isStarting/etc change
    useEffect(() => {
      if (panelMode !== 'side-panel') return;
      if (!isSidePanelOwnerRef.current) return;
      updatePanelState({
        container,
        isStarting,
        bucketId: studentBucketId,
        showDesktop,
        runFilename,
      });
    }, [container, isStarting, studentBucketId, showDesktop, runFilename, panelMode, updatePanelState]);

    // Cross-tab container sync via BroadcastChannel (fullscreen IDE in another tab)
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
    const isSyncingFromPeerRef = useRef(false);

    useEffect(() => {
      const channel = new BroadcastChannel(`ide-container-${ideData.id}`);
      broadcastChannelRef.current = channel;

      channel.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "container-update" && msg.blockId === ideData.id) {
          isSyncingFromPeerRef.current = true;
          if (msg.container) {
            setContainer(msg.container);
          }
          setIsStarting(msg.isStarting);
        }
      };

      return () => {
        channel.close();
        broadcastChannelRef.current = null;
      };
    }, [ideData.id]);

    // Broadcast container state changes to other tabs
    useEffect(() => {
      if (isSyncingFromPeerRef.current) {
        isSyncingFromPeerRef.current = false;
        return;
      }
      try {
        broadcastChannelRef.current?.postMessage({
          type: "container-update",
          blockId: ideData.id,
          container,
          isStarting,
        });
      } catch {
        // Channel may be closed
      }
    }, [container, isStarting, ideData.id]);

    // Listen for side panel actions (start container, run code) via custom events
    // This avoids passing function references through React state which can have timing issues
    // stopImmediatePropagation prevents duplicate handlers (React StrictMode / TipTap node views)
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.ideDataId !== ideData.id) return;
        e.stopImmediatePropagation();
        // This instance handled the event, so it owns the side panel relationship
        isSidePanelOwnerRef.current = true;
        if (detail.action === 'start') {
          startContainer();
        } else if (detail.action === 'run') {
          handleRun();
        }
      };
      window.addEventListener('ide-panel-action', handler);
      return () => window.removeEventListener('ide-panel-action', handler);
    }, [ideData.id, startContainer, handleRun]);

    // Handle view desktop toggle
    const handleToggleDesktop = useCallback(() => {
      setShowDesktop((prev) => !prev);
    }, []);

    // Handle refresh instance
    const handleRefreshInstance = useCallback(async () => {
      if (!container) return;

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
          return;
        }

        // Wait for S3 eventual consistency
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
        return;
      }

      // Clear the current container
      clearContainer();

      // Start a new container with the existing S3 bucket
      await startContainer();
    }, [container, clearContainer, startContainer, toast]);

    // Handle reset to template - delete current bucket and clone fresh from template
    const handleResetToTemplate = useCallback(async () => {
      if (!user?.id || !assignmentId) {
        toast({
          title: "Authentication required",
          description: "Please sign in to reset workspace.",
          variant: "destructive",
        });
        return;
      }

      // Confirm reset
      if (!window.confirm("Are you sure you want to reset your workspace to the template? This will delete all your changes and cannot be undone.")) {
        return;
      }

      try {
        // Clear container first
        clearContainer();

        // Delete old bucket if it exists
        if (studentBucketId) {
          try {
            await apiClient.softDeleteS3Bucket(studentBucketId);
            console.log("[IDE Student] Deleted old bucket:", studentBucketId);
          } catch (error) {
            console.warn("[IDE Student] Failed to delete old bucket:", error);
            // Continue anyway - might already be deleted
          }
        }

        // Clear state and localStorage
        setStudentBucketId(null);
        const storageKey = `student_bucket_${assignmentId}_${user.id}`;
        localStorage.removeItem(storageKey);

        toast({
          title: "Workspace reset",
          description: "Cloning fresh copy from template...",
          variant: "default",
        });

        // Clone fresh from template
        const templateBucketId = ideData.template.s3_bucket_id;
        if (!templateBucketId) {
          throw new Error("No template bucket to clone from");
        }

        const cloneResponse = await apiClient.cloneS3Bucket(templateBucketId, {
          course_id: courseId || undefined,
          assignment_id: assignmentId || undefined,
          region: "us-east-1",
        });

        if (!cloneResponse?.data) {
          throw new Error("Failed to clone template bucket");
        }

        const newBucketId = cloneResponse.data.id;
        console.log("[IDE Student] Cloned fresh bucket:", {
          templateBucketId,
          newBucketId,
          userId: user.id,
          assignmentId
        });

        // Save new bucket ID
        setStudentBucketId(newBucketId);
        localStorage.setItem(storageKey, newBucketId);

        toast({
          title: "Workspace reset complete",
          description: "Your workspace has been reset to the template.",
          variant: "default",
        });
      } catch (error: any) {
        console.error("[IDE Student] Failed to reset workspace:", error);
        toast({
          title: "Failed to reset workspace",
          description: error.message || "An error occurred while resetting your workspace.",
          variant: "destructive",
        });
      }
    }, [studentBucketId, assignmentId, courseId, user, ideData, clearContainer, toast]);

    // Handle running tests against student's solution
    const handleRunTests = useCallback(async () => {
      if (!container) {
        toast({
          title: "No container",
          description: "Please start a container first to run tests.",
          variant: "destructive",
        });
        return;
      }

      const tests = ideData.autograder?.tests || [];
      if (tests.length === 0) {
        toast({
          title: "No tests",
          description: "No test cases have been configured for this assignment.",
          variant: "default",
        });
        return;
      }

      // Filter out manual grading tests - only run executable tests
      const executableTests = tests.filter((test) => test.type !== "manualGrading");
      if (executableTests.length === 0) {
        toast({
          title: "No executable tests",
          description: "All tests require manual grading.",
          variant: "default",
        });
        return;
      }

      setIsRunningTests(true);

      // Write all open files directly to the container's filesystem before running tests
      // This ensures tests run against the latest code, not stale filesystem content
      if (studentBucketId && container) {
        try {
          const docs = otProvider.getDocumentsForBucket(studentBucketId);
          const writePromises: Promise<any>[] = [];
          const s3Promises: Promise<any>[] = [];
          for (const [filePath, doc] of docs.entries()) {
            const content = doc.content;
            if (content) {
              console.log("[IDE] Writing file to container before tests:", filePath);
              writePromises.push(
                fetch(`${IDE_API_BASE_URL}/web/${container.id}/write-file`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path: filePath, content }),
                })
              );
              // Also save to S3 for persistence (fire-and-forget)
              s3Promises.push(apiClient.saveS3File(studentBucketId, filePath, content));
            }
          }
          if (writePromises.length > 0) {
            await Promise.allSettled(writePromises);
          }
          // S3 saves are fire-and-forget
          Promise.allSettled(s3Promises).catch(() => {});
        } catch (e) {
          console.warn("[IDE] Failed to write files to container before tests:", e);
        }
      }

      try {
        toast({
          title: "Running tests",
          description: "Executing test cases against your solution...",
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

        // Calculate stats
        const passedCount = data.results.filter((r: any) => r.passed).length;
        const totalCount = data.results.length;
        const pointsEarned = data.pointsEarned || 0;
        const totalPoints = data.totalPoints || 0;

        // Save test run to database for history
        if (assignmentId && ideData.id) {
          try {
            const savedRun = await apiClient.saveIDETestRun({
              assignment_id: assignmentId,
              block_id: ideData.id,
              course_id: courseId || undefined,
              results: data.results || [],
              total_points: totalPoints,
              points_earned: pointsEarned,
              tests_passed: passedCount,
              tests_total: totalCount,
              container_id: container.id,
            });

            // Add to history at the beginning
            setTestRunHistory((prev) => [savedRun.data, ...prev].slice(0, 10));
          } catch (saveError) {
            console.error("Failed to save test run:", saveError);
            // Don't show error toast - saving history is optional
          }
        }

        // Show toast notification
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
      } finally {
        setIsRunningTests(false);
      }
    }, [container, ideData.autograder?.tests, ideData.id, assignmentId, courseId, toast, studentBucketId]);

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
            <div className="flex items-center gap-2">
              {/* Reset to Template button (only show if student has a bucket) */}
              {studentBucketId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToTemplate}
                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                  title="Reset workspace to template (deletes all changes)"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset to Template
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className={ideData.autograder?.allowStudentCheckAnswer ? "grid w-full grid-cols-2" : "grid w-full grid-cols-1"}>
              <TabsTrigger value="code">Code</TabsTrigger>
              {ideData.autograder?.allowStudentCheckAnswer && (
                <TabsTrigger value="autoGrader">Auto Grader</TabsTrigger>
              )}
            </TabsList>

            {/* Code Tab */}
            <TabsContent value="code" className="mt-4">
              <div className="space-y-4">
                {/* Container area */}
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  {/* Show MonacoIDE if student has a cloned bucket */}
                  {studentBucketId ? (
                    <div className="h-[600px]">
                      <MonacoIDE
                        bucketId={studentBucketId}
                        containerId={container?.id || null}
                        containerTerminalUrl={container?.urls?.terminal || (container ? `${IDE_API_BASE_URL}/terminal/${container.id}/` : undefined)}
                        containerVncUrl={container?.urls?.vnc}
                        containerWebServerUrl={container?.urls?.webServer}
                        ideApiBaseUrl={IDE_API_BASE_URL}
                        onRun={container ? handleRun : startContainer}
                        runFilename={runFilename}
                        onFilenameChange={setRunFilename}
                        isStarting={isStarting}
                        onRefreshInstance={container ? handleRefreshInstance : undefined}
                        onToggleDesktop={handleToggleDesktop}
                        showDesktop={showDesktop}
                        onContainerKilled={clearContainer}
                        showPanelButtons={true}
                        currentUser={currentUser}
                        onOpenSidePanel={() => openSidePanelWithOwnership({
                          ideData,
                          container,
                          bucketId: studentBucketId,
                          isStarting,
                          showDesktop,
                          runFilename,
                          ideApiBaseUrl: IDE_API_BASE_URL,
                        })}
                        onOpenFullscreen={() => openFullscreen({
                          ideData,
                          container,
                          bucketId: studentBucketId,
                          isStarting,
                          showDesktop,
                          runFilename,
                          ideApiBaseUrl: IDE_API_BASE_URL,
                        })}
                      />
                    </div>
                  ) : (
                    /* Show start button if no bucket exists yet */
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
                        disabled={isStarting}
                      >
                        {isStarting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Starting...
                          </>
                        ) : (
                          "Start Virtual Codespace"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Auto Grader Tab */}
            {ideData.autograder?.allowStudentCheckAnswer && (
              <TabsContent value="autoGrader" className="mt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold">Autograder</h3>
                      <p className="text-sm text-gray-600">
                        Run tests to check your solution
                      </p>
                    </div>
                    <Button
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                      size="sm"
                      disabled={!container || isRunningTests}
                      onClick={handleRunTests}
                    >
                      {isRunningTests ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-4 h-4 mr-2" />
                          Run Tests
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Latest Result Summary */}
                  {testRunHistory.length > 0 && (
                    <div className={`border rounded-lg p-4 ${
                      testRunHistory[0].tests_passed === testRunHistory[0].tests_total
                        ? "bg-green-50 border-green-200"
                        : "bg-yellow-50 border-yellow-200"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {testRunHistory[0].tests_passed === testRunHistory[0].tests_total ? (
                            <CheckCircle2 className="w-8 h-8 text-green-600" />
                          ) : (
                            <XCircle className="w-8 h-8 text-yellow-600" />
                          )}
                          <div>
                            <div className="font-medium text-gray-900">
                              Latest Result: {testRunHistory[0].tests_passed}/{testRunHistory[0].tests_total} tests passed
                            </div>
                            <div className="text-sm text-gray-600">
                              Points: {testRunHistory[0].points_earned}/{testRunHistory[0].total_points}
                            </div>
                          </div>
                        </div>
                        <div className="text-right text-sm text-gray-500">
                          <Clock className="w-4 h-4 inline mr-1" />
                          {new Date(testRunHistory[0].created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Run Tests Area */}
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    {!container ? (
                      <div className="text-center py-6">
                        <Code2 className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-1">
                          Start a container to run tests
                        </p>
                        <p className="text-xs text-gray-500">
                          Go to the Code tab and start your virtual codespace first
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <PlayCircle className="w-10 h-10 text-purple-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-1">
                          Ready to run tests
                        </p>
                        <p className="text-xs text-gray-500">
                          Click "Run Tests" to check your solution against {(ideData.autograder?.tests || []).filter(t => t.type !== "manualGrading").length} test case(s)
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Test Run History */}
                  {testRunHistory.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
                        <History className="w-4 h-4 text-gray-600" />
                        <span className="text-sm font-medium text-gray-700">Test Run History</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {isLoadingHistory ? (
                          <div className="p-4 text-center">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                          </div>
                        ) : (
                          testRunHistory.map((run, index) => (
                            <div
                              key={run.id}
                              className={`p-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer ${
                                index === 0 ? "bg-purple-50" : ""
                              }`}
                              onClick={() => {
                                setTestResults(run.results || []);
                                setTestTotalPoints(run.total_points);
                                setTestPointsEarned(run.points_earned);
                                setTestResultsModalOpen(true);
                              }}
                            >
                              <div className="flex items-center gap-3">
                                {run.tests_passed === run.tests_total ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                                ) : (
                                  <XCircle className="w-5 h-5 text-red-500" />
                                )}
                                <div>
                                  <span className="text-sm font-medium">
                                    {run.tests_passed}/{run.tests_total} passed
                                  </span>
                                  <span className="text-sm text-gray-500 ml-2">
                                    ({run.points_earned}/{run.total_points} pts)
                                  </span>
                                </div>
                              </div>
                              <div className="text-xs text-gray-500">
                                {new Date(run.created_at).toLocaleString()}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <AutograderTestResultsModal
                  open={testResultsModalOpen}
                  onOpenChange={setTestResultsModalOpen}
                  results={testResults}
                  totalPoints={testTotalPoints}
                  pointsEarned={testPointsEarned}
                />
              </TabsContent>
            )}
          </Tabs>

        </div>
      </NodeViewWrapper>
    );
  }
);

export default IDEBlockViewer;

