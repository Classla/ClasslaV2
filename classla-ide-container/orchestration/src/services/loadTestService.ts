import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { ContainerService } from "./containerService";
import { StateManager } from "./stateManager";
import { HealthMonitor } from "./healthMonitor";
import { ResourceMonitor } from "./resourceMonitor";
import { config } from "../config/index";

// Resource thresholds for load testing
const MEMORY_THRESHOLD_PERCENT = 85; // Stop spawning if memory exceeds this
const CPU_THRESHOLD_PERCENT = 90; // Stop spawning if CPU exceeds this

export type LoadTestContainerStatus =
  | "pending"
  | "starting"
  | "running"
  | "executing"
  | "completed"
  | "failed";

export interface LoadTestConfig {
  numContainers: number;
  testCode: string;
  mainFile: string;
  spawnBatchSize: number;
  executionTimeout: number;
}

export interface LoadTestContainerInfo {
  id: string;
  status: LoadTestContainerStatus;
  startLatency?: number;
  executionLatency?: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface LoadTestSummary {
  pending: number;
  starting: number;
  running: number;
  executing: number;
  completed: number;
  failed: number;
}

export interface LoadTestMetrics {
  testId: string;
  status: "running" | "completed" | "stopped" | "error";
  containers: LoadTestContainerInfo[];
  summary: LoadTestSummary;
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;
  averageStartLatency?: number;
  averageExecutionLatency?: number;
  error?: string;
  resourceUsage?: {
    cpu: number;
    memory: number;
  };
}

interface LoadTestState {
  testId: string;
  config: LoadTestConfig;
  metrics: LoadTestMetrics;
  containerIds: string[];
  stopped: boolean;
}

export class LoadTestService extends EventEmitter {
  private containerService: ContainerService;
  private stateManager: StateManager;
  private healthMonitor: HealthMonitor;
  private resourceMonitor: ResourceMonitor;
  private activeTests: Map<string, LoadTestState> = new Map();

  constructor(
    containerService: ContainerService,
    stateManager: StateManager,
    healthMonitor: HealthMonitor,
    resourceMonitor: ResourceMonitor
  ) {
    super();
    this.containerService = containerService;
    this.stateManager = stateManager;
    this.healthMonitor = healthMonitor;
    this.resourceMonitor = resourceMonitor;
  }

  /**
   * Check if system resources allow spawning more containers
   * Returns { ok: true } or { ok: false, reason: string }
   */
  private async checkResourcesBeforeSpawn(): Promise<{ ok: boolean; reason?: string; resources?: { cpu: number; memory: number } }> {
    try {
      const resources = await this.resourceMonitor.getSystemResources();
      const cpuUsage = resources.cpu.usage;
      const memoryUsage = resources.memory.usagePercent;

      if (memoryUsage >= MEMORY_THRESHOLD_PERCENT) {
        return {
          ok: false,
          reason: `Memory usage too high: ${memoryUsage.toFixed(1)}% (threshold: ${MEMORY_THRESHOLD_PERCENT}%)`,
          resources: { cpu: cpuUsage, memory: memoryUsage },
        };
      }

      if (cpuUsage >= CPU_THRESHOLD_PERCENT) {
        return {
          ok: false,
          reason: `CPU usage too high: ${cpuUsage.toFixed(1)}% (threshold: ${CPU_THRESHOLD_PERCENT}%)`,
          resources: { cpu: cpuUsage, memory: memoryUsage },
        };
      }

      return { ok: true, resources: { cpu: cpuUsage, memory: memoryUsage } };
    } catch (error) {
      console.error("[LoadTest] Failed to check resources:", error);
      // If we can't check resources, allow spawning but log warning
      return { ok: true };
    }
  }

  /**
   * Start a new load test
   */
  async startLoadTest(testConfig: LoadTestConfig): Promise<string> {
    const testId = randomUUID();

    // Initialize container info
    const containers: LoadTestContainerInfo[] = [];
    for (let i = 0; i < testConfig.numContainers; i++) {
      containers.push({
        id: `pending-${i}`,
        status: "pending",
      });
    }

    const metrics: LoadTestMetrics = {
      testId,
      status: "running",
      containers,
      summary: this.calculateSummary(containers),
      startTime: new Date(),
    };

    const state: LoadTestState = {
      testId,
      config: testConfig,
      metrics,
      containerIds: [],
      stopped: false,
    };

    this.activeTests.set(testId, state);

    // Emit initial metrics
    this.emit("metrics", testId, metrics);

    // Start spawning containers in the background
    this.spawnContainersInBatches(state).catch((error) => {
      console.error(`[LoadTest ${testId}] Error during test:`, error);
      state.metrics.status = "error";
      state.metrics.error = error.message;
      this.emit("metrics", testId, state.metrics);
    });

    return testId;
  }

  /**
   * Stop a running load test and clean up containers
   */
  async stopLoadTest(testId: string): Promise<void> {
    const state = this.activeTests.get(testId);
    if (!state) {
      throw new Error(`Load test ${testId} not found`);
    }

    state.stopped = true;
    state.metrics.status = "stopped";
    state.metrics.endTime = new Date();
    state.metrics.totalDuration =
      state.metrics.endTime.getTime() - state.metrics.startTime.getTime();

    this.emit("metrics", testId, state.metrics);

    // Kill all containers created by this test
    console.log(
      `[LoadTest ${testId}] Stopping test and cleaning up ${state.containerIds.length} containers`
    );

    const killPromises = state.containerIds.map(async (containerId) => {
      try {
        await this.containerService.stopContainer(containerId);
        this.stateManager.updateContainerLifecycle(containerId, {
          status: "stopped",
          stoppedAt: new Date(),
          shutdownReason: "manual",
        });
        this.healthMonitor.removeContainerHealth(containerId);
        console.log(`[LoadTest ${testId}] Killed container ${containerId}`);
      } catch (error) {
        console.error(
          `[LoadTest ${testId}] Failed to kill container ${containerId}:`,
          error
        );
      }
    });

    await Promise.all(killPromises);

    // Keep the test in active tests for a bit so metrics can be retrieved
    setTimeout(() => {
      this.activeTests.delete(testId);
    }, 60000); // Keep for 1 minute after stopping
  }

  /**
   * Get metrics for a specific test
   */
  getMetrics(testId: string): LoadTestMetrics | null {
    const state = this.activeTests.get(testId);
    return state?.metrics || null;
  }

  /**
   * Check if a test exists
   */
  hasTest(testId: string): boolean {
    return this.activeTests.has(testId);
  }

  /**
   * Spawn containers in batches
   */
  private async spawnContainersInBatches(state: LoadTestState): Promise<void> {
    const { config: testConfig, testId } = state;
    const batchSize = testConfig.spawnBatchSize;
    const totalContainers = testConfig.numContainers;

    console.log(
      `[LoadTest ${testId}] Starting to spawn ${totalContainers} containers in batches of ${batchSize}`
    );

    for (let i = 0; i < totalContainers && !state.stopped; i += batchSize) {
      // Check resources before spawning each batch
      const resourceCheck = await this.checkResourcesBeforeSpawn();
      if (!resourceCheck.ok) {
        console.warn(
          `[LoadTest ${testId}] Stopping due to resource constraints: ${resourceCheck.reason}`
        );

        // Mark remaining containers as failed due to resource limits
        for (let j = i; j < totalContainers; j++) {
          state.metrics.containers[j].status = "failed";
          state.metrics.containers[j].error = `Stopped: ${resourceCheck.reason}`;
        }

        // Update metrics and stop
        state.metrics.status = "error";
        state.metrics.error = resourceCheck.reason;
        state.metrics.endTime = new Date();
        state.metrics.totalDuration =
          state.metrics.endTime.getTime() - state.metrics.startTime.getTime();
        state.metrics.summary = this.calculateSummary(state.metrics.containers);
        this.calculateAverages(state.metrics);
        this.emit("metrics", testId, state.metrics);

        // Clean up containers that were spawned
        this.cleanupTestContainers(state);
        return;
      }

      // Log resource usage for monitoring and add to metrics
      if (resourceCheck.resources) {
        console.log(
          `[LoadTest ${testId}] Batch ${Math.floor(i / batchSize) + 1}: CPU=${resourceCheck.resources.cpu.toFixed(1)}%, Memory=${resourceCheck.resources.memory.toFixed(1)}%`
        );
        state.metrics.resourceUsage = resourceCheck.resources;
      }

      const batchEnd = Math.min(i + batchSize, totalContainers);
      const batchPromises: Promise<void>[] = [];

      for (let j = i; j < batchEnd && !state.stopped; j++) {
        batchPromises.push(this.spawnAndExecute(state, j));
      }

      // Wait for batch to complete
      await Promise.all(batchPromises);

      // Emit updated metrics after each batch
      state.metrics.summary = this.calculateSummary(state.metrics.containers);
      this.calculateAverages(state.metrics);
      this.emit("metrics", testId, state.metrics);

      // Small delay between batches to prevent overwhelming the system
      if (i + batchSize < totalContainers && !state.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Final update
    if (!state.stopped) {
      state.metrics.status = "completed";
      state.metrics.endTime = new Date();
      state.metrics.totalDuration =
        state.metrics.endTime.getTime() - state.metrics.startTime.getTime();
      state.metrics.summary = this.calculateSummary(state.metrics.containers);
      this.calculateAverages(state.metrics);
      this.emit("metrics", testId, state.metrics);

      console.log(
        `[LoadTest ${testId}] Test completed. Summary: ${JSON.stringify(state.metrics.summary)}`
      );

      // Clean up containers after test completes
      setTimeout(() => {
        this.cleanupTestContainers(state);
      }, 5000); // Give time for final metrics to be sent
    }
  }

  /**
   * Spawn a single container and execute test code on it
   */
  private async spawnAndExecute(
    state: LoadTestState,
    index: number
  ): Promise<void> {
    const { testId, config: testConfig } = state;

    if (state.stopped) return;

    // Update status to starting
    state.metrics.containers[index].status = "starting";
    state.metrics.containers[index].startedAt = new Date();
    this.emit("metrics", testId, state.metrics);

    const startTime = Date.now();

    try {
      // Create container (without S3 bucket - just for testing)
      const containerInfo = await this.containerService.createContainer({
        domain: config.domain,
        skipS3Bucket: true, // No S3 bucket for load test containers
      });

      const containerId = containerInfo.id;
      state.containerIds.push(containerId);
      state.metrics.containers[index].id = containerId;

      // Save to state manager
      this.stateManager.saveContainer({
        id: containerId,
        serviceName: containerInfo.serviceName,
        s3Bucket: "",
        s3Region: "",
        status: "starting",
        createdAt: containerInfo.createdAt,
        urls: containerInfo.urls,
        isPreWarmed: false,
        resourceLimits: {
          cpuLimit: String(config.containerCpuLimit),
          memoryLimit: String(config.containerMemoryLimit),
        },
      });

      // Wait for container to be ready
      const readyTime = await this.waitForContainerReady(containerId);
      const startLatency = readyTime - startTime;

      state.metrics.containers[index].status = "running";
      state.metrics.containers[index].startLatency = startLatency;

      // Update state manager
      this.stateManager.updateContainerLifecycle(containerId, {
        status: "running",
        startedAt: new Date(),
      });

      this.emit("metrics", testId, state.metrics);

      if (state.stopped) return;

      // Execute test code
      state.metrics.containers[index].status = "executing";
      this.emit("metrics", testId, state.metrics);

      const execStartTime = Date.now();
      await this.executeCodeOnContainer(
        containerId,
        testConfig.testCode,
        testConfig.mainFile,
        testConfig.executionTimeout
      );
      const executionLatency = Date.now() - execStartTime;

      state.metrics.containers[index].status = "completed";
      state.metrics.containers[index].executionLatency = executionLatency;
      state.metrics.containers[index].completedAt = new Date();

      console.log(
        `[LoadTest ${testId}] Container ${containerId} completed (start: ${startLatency}ms, exec: ${executionLatency}ms)`
      );
    } catch (error) {
      state.metrics.containers[index].status = "failed";
      state.metrics.containers[index].error =
        error instanceof Error ? error.message : String(error);
      state.metrics.containers[index].completedAt = new Date();

      console.error(
        `[LoadTest ${testId}] Container ${index} failed:`,
        error
      );
    }

    this.emit("metrics", testId, state.metrics);
  }

  /**
   * Wait for container to be ready (code-server responding)
   */
  private async waitForContainerReady(containerId: string): Promise<number> {
    const serviceName = `ide-${containerId}`;
    const webServerUrl = `http://${serviceName}:3000`;
    const maxRetries = 60; // 60 seconds max wait
    const retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(`${webServerUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return Date.now();
        }
      } catch {
        // Container not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    throw new Error(`Container ${containerId} did not become ready in time`);
  }

  /**
   * Execute test code on a container
   */
  private async executeCodeOnContainer(
    containerId: string,
    testCode: string,
    mainFile: string,
    timeout: number
  ): Promise<void> {
    const serviceName = `ide-${containerId}`;
    const webServerUrl = `http://${serviceName}:3000`;

    // First, write the test code file to the container's workspace
    const writeResponse = await fetch(`${webServerUrl}/write-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: `/workspace/${mainFile}`,
        content: testCode,
      }),
    });

    if (!writeResponse.ok) {
      const errorText = await writeResponse.text();
      throw new Error(`Failed to write test file: ${errorText}`);
    }

    // Determine language from file extension
    const ext = mainFile.split(".").pop()?.toLowerCase() || "";
    const languageMap: Record<string, string> = {
      py: "python",
      js: "node",
      java: "java",
      sh: "bash",
    };
    const language = languageMap[ext] || "python";

    // Execute the code using the container's run endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

    try {
      const runResponse = await fetch(`${webServerUrl}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: mainFile,
          language: language,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!runResponse.ok) {
        const errorText = await runResponse.text();
        throw new Error(`Code execution failed: ${errorText}`);
      }

      // The /run endpoint sends the command to tmux and returns immediately
      // It returns {"status": "success", "message": "...", "command": "..."}
      const result = (await runResponse.json()) as { status?: string; error?: string };
      if (result.status !== "success") {
        throw new Error(`Code execution failed: ${result.error || "Unknown error"}`);
      }

      // For load testing, we consider the test complete once the code starts running
      // The actual code execution happens asynchronously in tmux
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Code execution timed out after ${timeout} seconds`);
      }
      throw error;
    }
  }

  /**
   * Clean up containers after test completes
   */
  private async cleanupTestContainers(state: LoadTestState): Promise<void> {
    console.log(
      `[LoadTest ${state.testId}] Cleaning up ${state.containerIds.length} containers`
    );

    for (const containerId of state.containerIds) {
      try {
        await this.containerService.stopContainer(containerId);
        this.stateManager.updateContainerLifecycle(containerId, {
          status: "stopped",
          stoppedAt: new Date(),
          shutdownReason: "manual",
        });
        this.healthMonitor.removeContainerHealth(containerId);
      } catch (error) {
        console.error(
          `[LoadTest ${state.testId}] Failed to cleanup container ${containerId}:`,
          error
        );
      }
    }

    // Remove from active tests after cleanup
    setTimeout(() => {
      this.activeTests.delete(state.testId);
    }, 60000);
  }

  /**
   * Calculate summary from container statuses
   */
  private calculateSummary(
    containers: LoadTestContainerInfo[]
  ): LoadTestSummary {
    return {
      pending: containers.filter((c) => c.status === "pending").length,
      starting: containers.filter((c) => c.status === "starting").length,
      running: containers.filter((c) => c.status === "running").length,
      executing: containers.filter((c) => c.status === "executing").length,
      completed: containers.filter((c) => c.status === "completed").length,
      failed: containers.filter((c) => c.status === "failed").length,
    };
  }

  /**
   * Calculate average latencies
   */
  private calculateAverages(metrics: LoadTestMetrics): void {
    const startLatencies = metrics.containers
      .filter((c) => c.startLatency !== undefined)
      .map((c) => c.startLatency!);

    const executionLatencies = metrics.containers
      .filter((c) => c.executionLatency !== undefined)
      .map((c) => c.executionLatency!);

    if (startLatencies.length > 0) {
      metrics.averageStartLatency =
        startLatencies.reduce((a, b) => a + b, 0) / startLatencies.length;
    }

    if (executionLatencies.length > 0) {
      metrics.averageExecutionLatency =
        executionLatencies.reduce((a, b) => a + b, 0) / executionLatencies.length;
    }
  }
}
