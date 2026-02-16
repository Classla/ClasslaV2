import React, { useState, useEffect } from "react";
import MonacoIDE from "../components/Blocks/IDE/MonacoIDE";
import { apiClient } from "../lib/api";
import { otProvider } from "../lib/otClient";
import { Button } from "../components/ui/button";
import { Loader2, Trash2 } from "lucide-react";
// Note: TestIDE doesn't require auth - it uses a test user ID

/**
 * Test page for IDE component - only available in development
 * This page does NOT require authentication - it's for E2E testing
 */
const TestIDE: React.FC = () => {
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucketName, setBucketName] = useState<string | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [containerTerminalUrl, setContainerTerminalUrl] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);
  const [runFilename, setRunFilename] = useState("main.py");
  const [error, setError] = useState<string | null>(null);

  // This page is only accessible in development mode (controlled by App.tsx route)
  // It does NOT require authentication - bypasses auth for E2E testing

  // Create test bucket on mount
  useEffect(() => {
    // Small delay to ensure component is mounted
    const timer = setTimeout(() => {
      createTestBucket();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const createTestBucket = async () => {
    setIsCreatingBucket(true);
    setError(null);
    try {
      // Use a hard-coded shared test bucket ID for all test sessions
      // This ensures all tests use the same bucket
      const HARD_CODED_TEST_BUCKET_ID = "00000000-0000-0000-0000-000000000001";
      const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
      
      // Try to get the hard-coded test bucket
      const getResponse = await fetch(`http://localhost:8000/api/s3buckets/${HARD_CODED_TEST_BUCKET_ID}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      
      if (getResponse.ok) {
        // Bucket exists, use it
        const data = await getResponse.json();
        setBucketId(data.id);
        setBucketName(data.bucket_name);
        console.log("Using hard-coded test bucket:", data);
        setIsCreatingBucket(false);
        return;
      }
      
      // Bucket doesn't exist, create it with the hard-coded ID
      const createResponse = await fetch('http://localhost:8000/api/s3buckets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          user_id: TEST_USER_ID,
          region: "us-east-1",
          bucket_id: HARD_CODED_TEST_BUCKET_ID // Request specific bucket ID for test bucket
        })
      });
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Failed to create bucket: ${createResponse.statusText}`);
      }
      
      const data = await createResponse.json();
      setBucketId(data.id);
      setBucketName(data.bucket_name);
      console.log("Created test bucket (will reuse this ID):", data);
    } catch (err: any) {
      console.error("Failed to create test bucket:", err);
      setError(err.message || "Failed to create test bucket");
    } finally {
      setIsCreatingBucket(false);
    }
  };

  const startContainer = async () => {
    if (!bucketId || !bucketName) {
      setError("No bucket available. Please create a bucket first.");
      return;
    }

    setIsStarting(true);
    setError(null);
    try {
      console.log("Starting container with:", { bucketName, bucketId, s3Region: "us-east-1" });
      
      const response = await apiClient.startIDEContainer({
        s3Bucket: bucketName,
        s3BucketId: bucketId,
        s3Region: "us-east-1",
        userId: "00000000-0000-0000-0000-000000000000",
        useLocalIDE: true, // Use local IDE environment
      });
      
      console.log("Container start response:", response);
      
      if (!response.data || !response.data.id) {
        throw new Error("Invalid response from container service");
      }
      
      setContainerId(response.data.id);
      
      // Construct terminal URL using the local IDE base URL
      const ideBaseUrl = "http://localhost";
      setContainerTerminalUrl(`${ideBaseUrl}/terminal/${response.data.id}/`);
      
      console.log("Container started successfully:", response.data);
    } catch (err: any) {
      console.error("Failed to start container:", err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error?.details ||
                          err.message || 
                          "Failed to start container. Check backend logs.";
      setError(errorMessage);
      console.error("Error details:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
    } finally {
      setIsStarting(false);
    }
  };

  const stopContainer = async () => {
    if (!containerId) return;

    try {
      // Stop container via direct API call since there's no apiClient method
      await fetch(`http://localhost:8000/api/ide-blocks/container/${containerId}/stop`, {
        method: 'POST',
        credentials: 'include',
      });
      setContainerId(null);
      setContainerTerminalUrl(null);
      console.log("Container stopped");
    } catch (err: any) {
      console.error("Failed to stop container:", err);
      setError(err.message || "Failed to stop container");
    }
  };

  const deleteTestBucket = async () => {
    if (!bucketId) return;
    if (!confirm("Delete test bucket? This will remove all files.")) return;

    try {
      await apiClient.softDeleteS3Bucket(bucketId);
      setBucketId(null);
      setBucketName(null);
      console.log("Test bucket deleted");
    } catch (err: any) {
      console.error("Failed to delete bucket:", err);
      setError(err.message || "Failed to delete bucket");
    }
  };

  const handleRun = async () => {
    if (!containerId || !runFilename) return;

    const ideBaseUrl = "http://localhost";

    // Write all open OT documents to the container before running
    if (bucketId) {
      const docs = otProvider.getDocumentsForBucket(bucketId);
      for (const [filePath, doc] of docs.entries()) {
        if (doc.content) {
          try {
            console.log(`[TestIDE] Writing ${filePath} to container before run`);
            await fetch(`${ideBaseUrl}/web/${containerId}/write-file`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: filePath, content: doc.content }),
            });
            // Also save to S3 (fire-and-forget)
            apiClient.saveS3File(bucketId, filePath, doc.content).catch(() => {});
          } catch (e) {
            console.warn(`[TestIDE] Failed to write ${filePath} to container:`, e);
          }
        }
      }
    }

    try {
      const response = await fetch(`${ideBaseUrl}/web/${containerId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: runFilename,
          language: "python",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to run code: ${response.statusText}`);
      }

      console.log("Code executed successfully");
    } catch (err: any) {
      console.error("Failed to run code:", err);
      setError(err.message || "Failed to run code");
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Test Controls Header - Keep yellow background for visibility in test page */}
      <div className="bg-yellow-100 border-b border-yellow-300 p-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-yellow-900 mb-2">IDE Test Page</h1>
          <p className="text-sm text-yellow-800 mb-4">
            Development only - Test Y.js sync, container integration, and file operations
          </p>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Bucket Info */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-yellow-900">Bucket:</span>
              {isCreatingBucket ? (
                <span className="text-sm text-yellow-700">Creating...</span>
              ) : bucketId ? (
                <code className="text-xs bg-white px-2 py-1 rounded" title={bucketName || ""}>
                  {bucketId.substring(0, 8)}...
                </code>
              ) : (
                <span className="text-sm text-red-600">None</span>
              )}
              
              {bucketId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deleteTestBucket}
                  className="h-7 text-xs"
                  title="Delete test bucket"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
              
              {!bucketId && !isCreatingBucket && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={createTestBucket}
                  className="h-7 text-xs"
                >
                  Create Bucket
                </Button>
              )}
            </div>

            {/* Container Controls */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-yellow-900">Container:</span>
              {containerId ? (
                <>
                  <code className="text-xs bg-white px-2 py-1 rounded">{containerId}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={stopContainer}
                    className="h-7 text-xs"
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={startContainer}
                  disabled={!bucketId || isStarting}
                  className="h-7 text-xs"
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    "Start Container"
                  )}
                </Button>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* IDE Component */}
      <div className="flex-1 overflow-hidden">
        {bucketId ? (
          <MonacoIDE
            bucketId={bucketId}
            containerId={containerId}
            containerTerminalUrl={containerTerminalUrl || undefined}
            ideApiBaseUrl="http://localhost:8000/api"
            onRun={handleRun}
            runFilename={runFilename}
            onFilenameChange={setRunFilename}
            isStarting={isStarting}
            currentUser={{ id: "test-user", name: "Test User", color: "#FF6B6B" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-background">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Setting up test environment...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TestIDE;

