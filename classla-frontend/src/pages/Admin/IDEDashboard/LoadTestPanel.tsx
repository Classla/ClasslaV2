import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Badge } from "../../../components/ui/badge";
import {
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Server,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import type {
  LoadTestConfig,
  LoadTestMetrics,
  LoadTestContainerInfo,
  LoadTestContainerStatus,
} from "../../../types/adminIde";

// Default test code for stress testing
const DEFAULT_TEST_CODE = `import time
import random

def stress_test():
    """Simple CPU stress test that runs for a few iterations"""
    width, height = 400, 300
    pixels = [[0] * width for _ in range(height)]

    # Run for 10 iterations instead of infinite loop
    for frame in range(10):
        for y in range(height):
            for x in range(width):
                pixels[y][x] = random.randint(0, 255)
        print(f"Frame {frame + 1}/10 rendered: {width}x{height}")
        time.sleep(0.1)

    print("Stress test completed successfully!")

if __name__ == "__main__":
    stress_test()
`;

// Status badge component
const StatusBadge: React.FC<{ status: LoadTestContainerStatus }> = ({
  status,
}) => {
  const variants: Record<LoadTestContainerStatus, string> = {
    pending: "bg-gray-100 text-gray-800",
    starting: "bg-yellow-100 text-yellow-800",
    running: "bg-blue-100 text-blue-800",
    executing: "bg-purple-100 text-purple-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  return (
    <Badge className={variants[status] || "bg-gray-100 text-gray-800"}>
      {status}
    </Badge>
  );
};

// Progress bar component
const ProgressBar: React.FC<{
  current: number;
  total: number;
  label: string;
}> = ({ current, total, label }) => {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">
          {current} / {total}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-purple-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

const LoadTestPanel: React.FC = () => {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LoadTestMetrics | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Form state
  const [config, setConfig] = useState<LoadTestConfig>({
    numContainers: 5,
    testCode: DEFAULT_TEST_CODE,
    mainFile: "main.py",
    spawnBatchSize: 3,
    executionTimeout: 60,
  });

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Connect to SSE stream when test starts
  const connectToStream = useCallback(
    (id: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const streamUrl = apiClient.adminIde.getLoadTestStreamUrl(id);
      const eventSource = new EventSource(streamUrl, { withCredentials: true });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "metrics") {
            setMetrics(data.metrics);

            // Check if test is complete
            if (
              data.metrics.status === "completed" ||
              data.metrics.status === "stopped" ||
              data.metrics.status === "error"
            ) {
              setIsRunning(false);
              eventSource.close();
            }
          } else if (data.type === "error") {
            toast({
              title: "Load Test Error",
              description: data.message,
              variant: "destructive",
            });
            setIsRunning(false);
            eventSource.close();
          }
        } catch (error) {
          console.error("Failed to parse SSE message:", error);
        }
      };

      eventSource.onerror = () => {
        console.error("SSE connection error");
        eventSource.close();
        setIsRunning(false);
      };

      eventSourceRef.current = eventSource;
    },
    [toast]
  );

  const handleStartTest = async () => {
    try {
      setIsRunning(true);
      setMetrics(null);

      const response = await apiClient.adminIde.startLoadTest({
        numContainers: config.numContainers,
        testCode: config.testCode,
        mainFile: config.mainFile,
        spawnBatchSize: config.spawnBatchSize,
        executionTimeout: config.executionTimeout,
      });

      const newTestId = response.data.testId;
      setTestId(newTestId);

      toast({
        title: "Load Test Started",
        description: `Test ID: ${newTestId}`,
      });

      // Connect to SSE stream
      connectToStream(newTestId);
    } catch (error: any) {
      console.error("Failed to start load test:", error);
      toast({
        title: "Failed to start load test",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
      setIsRunning(false);
    }
  };

  const handleStopTest = async () => {
    if (!testId) return;

    try {
      await apiClient.adminIde.stopLoadTest(testId);

      toast({
        title: "Load Test Stopped",
        description: "The load test is being stopped and containers cleaned up.",
      });

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      setIsRunning(false);
    } catch (error: any) {
      console.error("Failed to stop load test:", error);
      toast({
        title: "Failed to stop load test",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: LoadTestContainerStatus) => {
    switch (status) {
      case "pending":
        return <Clock className="w-4 h-4 text-gray-500" />;
      case "starting":
        return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />;
      case "running":
        return <Server className="w-4 h-4 text-blue-500" />;
      case "executing":
        return <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />;
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
            <CardTitle>Load Test</CardTitle>
            {isRunning && (
              <Badge className="bg-purple-100 text-purple-800 ml-2">
                Running
              </Badge>
            )}
          </div>
          <CardDescription className="text-right">
            Stress test container spawning and execution
          </CardDescription>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Configuration Form */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="numContainers">Number of Containers</Label>
              <Input
                id="numContainers"
                type="number"
                min={1}
                value={config.numContainers}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    numContainers: parseInt(e.target.value) || 1,
                  })
                }
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spawnBatchSize">Batch Size</Label>
              <Input
                id="spawnBatchSize"
                type="number"
                min={1}
                max={10}
                value={config.spawnBatchSize}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    spawnBatchSize: parseInt(e.target.value) || 1,
                  })
                }
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="executionTimeout">Timeout (seconds)</Label>
              <Input
                id="executionTimeout"
                type="number"
                min={10}
                max={300}
                value={config.executionTimeout}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    executionTimeout: parseInt(e.target.value) || 60,
                  })
                }
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mainFile">Main File</Label>
              <Input
                id="mainFile"
                value={config.mainFile}
                onChange={(e) =>
                  setConfig({ ...config, mainFile: e.target.value })
                }
                disabled={isRunning}
              />
            </div>
          </div>

          {/* Test Code */}
          <div className="space-y-2">
            <Label htmlFor="testCode">Test Code (Python)</Label>
            <textarea
              id="testCode"
              className="w-full h-48 p-3 font-mono text-sm border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={config.testCode}
              onChange={(e) =>
                setConfig({ ...config, testCode: e.target.value })
              }
              disabled={isRunning}
            />
          </div>

          {/* Controls */}
          <div className="flex gap-4">
            <Button
              onClick={handleStartTest}
              disabled={isRunning}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Load Test
            </Button>
            <Button
              onClick={handleStopTest}
              disabled={!isRunning}
              variant="destructive"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop Test
            </Button>
          </div>

          {/* Metrics Display */}
          {metrics && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Test Results</h3>
                <Badge
                  className={
                    metrics.status === "running"
                      ? "bg-purple-100 text-purple-800"
                      : metrics.status === "completed"
                      ? "bg-green-100 text-green-800"
                      : metrics.status === "stopped"
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                  }
                >
                  {metrics.status}
                </Badge>
              </div>

              {/* Progress */}
              <div className="grid gap-4 md:grid-cols-2">
                <ProgressBar
                  current={
                    metrics.summary.completed + metrics.summary.failed
                  }
                  total={metrics.containers.length}
                  label="Completion"
                />
                <ProgressBar
                  current={
                    metrics.summary.running +
                    metrics.summary.executing +
                    metrics.summary.completed +
                    metrics.summary.failed
                  }
                  total={metrics.containers.length}
                  label="Spawned"
                />
              </div>

              {/* Summary Stats */}
              <div className="grid gap-2 md:grid-cols-6">
                <div className="text-center p-2 bg-gray-100 rounded">
                  <div className="text-2xl font-bold text-gray-600">
                    {metrics.summary.pending}
                  </div>
                  <div className="text-xs text-gray-500">Pending</div>
                </div>
                <div className="text-center p-2 bg-yellow-100 rounded">
                  <div className="text-2xl font-bold text-yellow-600">
                    {metrics.summary.starting}
                  </div>
                  <div className="text-xs text-yellow-600">Starting</div>
                </div>
                <div className="text-center p-2 bg-blue-100 rounded">
                  <div className="text-2xl font-bold text-blue-600">
                    {metrics.summary.running}
                  </div>
                  <div className="text-xs text-blue-600">Running</div>
                </div>
                <div className="text-center p-2 bg-purple-100 rounded">
                  <div className="text-2xl font-bold text-purple-600">
                    {metrics.summary.executing}
                  </div>
                  <div className="text-xs text-purple-600">Executing</div>
                </div>
                <div className="text-center p-2 bg-green-100 rounded">
                  <div className="text-2xl font-bold text-green-600">
                    {metrics.summary.completed}
                  </div>
                  <div className="text-xs text-green-600">Completed</div>
                </div>
                <div className="text-center p-2 bg-red-100 rounded">
                  <div className="text-2xl font-bold text-red-600">
                    {metrics.summary.failed}
                  </div>
                  <div className="text-xs text-red-600">Failed</div>
                </div>
              </div>

              {/* Resource Usage */}
              {metrics.resourceUsage && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">CPU Usage</span>
                      <span
                        className={`text-xl font-semibold ${
                          metrics.resourceUsage.cpu > 85
                            ? "text-red-600"
                            : metrics.resourceUsage.cpu > 70
                            ? "text-yellow-600"
                            : "text-green-600"
                        }`}
                      >
                        {metrics.resourceUsage.cpu.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${
                          metrics.resourceUsage.cpu > 85
                            ? "bg-red-500"
                            : metrics.resourceUsage.cpu > 70
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{ width: `${Math.min(metrics.resourceUsage.cpu, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">Memory Usage</span>
                      <span
                        className={`text-xl font-semibold ${
                          metrics.resourceUsage.memory > 85
                            ? "text-red-600"
                            : metrics.resourceUsage.memory > 70
                            ? "text-yellow-600"
                            : "text-green-600"
                        }`}
                      >
                        {metrics.resourceUsage.memory.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${
                          metrics.resourceUsage.memory > 85
                            ? "bg-red-500"
                            : metrics.resourceUsage.memory > 70
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{ width: `${Math.min(metrics.resourceUsage.memory, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Latency Stats */}
              {(metrics.averageStartLatency !== undefined ||
                metrics.averageExecutionLatency !== undefined) && (
                <div className="grid gap-4 md:grid-cols-3">
                  {metrics.averageStartLatency !== undefined && (
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-sm text-gray-500">
                        Avg Start Latency
                      </div>
                      <div className="text-xl font-semibold">
                        {metrics.averageStartLatency.toFixed(0)}ms
                      </div>
                    </div>
                  )}
                  {metrics.averageExecutionLatency !== undefined && (
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-sm text-gray-500">
                        Avg Execution Time
                      </div>
                      <div className="text-xl font-semibold">
                        {metrics.averageExecutionLatency.toFixed(0)}ms
                      </div>
                    </div>
                  )}
                  {metrics.totalDuration !== undefined && (
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-sm text-gray-500">
                        Total Duration
                      </div>
                      <div className="text-xl font-semibold">
                        {(metrics.totalDuration / 1000).toFixed(1)}s
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Container Grid */}
              <div className="space-y-2">
                <h4 className="font-medium">Container Status</h4>
                <div className="grid gap-2 grid-cols-5 md:grid-cols-10 lg:grid-cols-15">
                  {metrics.containers.map(
                    (container: LoadTestContainerInfo, index: number) => (
                      <div
                        key={container.id || index}
                        className="flex flex-col items-center p-2 border rounded text-xs"
                        title={
                          container.error
                            ? `Error: ${container.error}`
                            : `ID: ${container.id || index}\nStatus: ${container.status}${
                                container.startLatency
                                  ? `\nStart: ${container.startLatency}ms`
                                  : ""
                              }${
                                container.executionLatency
                                  ? `\nExec: ${container.executionLatency}ms`
                                  : ""
                              }`
                        }
                      >
                        {getStatusIcon(container.status)}
                        <span className="mt-1 truncate w-full text-center">
                          {container.id ? container.id.slice(0, 4) : index + 1}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Error Display */}
              {metrics.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <div className="flex items-center gap-2 text-red-800">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-medium">Error</span>
                  </div>
                  <p className="text-sm text-red-700 mt-1">{metrics.error}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};

export default LoadTestPanel;
