import { QueueManager } from "./queueManager.js";
import { ContainerService } from "./containerService.js";
import { StateManager } from "./stateManager.js";
import { ResourceMonitor } from "./resourceMonitor.js";
import { HealthMonitor } from "./healthMonitor.js";
import { config } from "../config/index.js";

/**
 * QueueMaintainer - Background service that maintains the pre-warmed container queue
 *
 * This service:
 * - Monitors queue size
 * - Spawns new pre-warmed containers when queue is below target
 * - Handles container failures (removes from queue, spawns replacement)
 * - Runs periodically to ensure queue stays at target size
 */
export class QueueMaintainer {
  private queueManager: QueueManager;
  private containerService: ContainerService;
  private stateManager: StateManager;
  private resourceMonitor: ResourceMonitor;
  private healthMonitor: HealthMonitor;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs: number = 30000; // Check every 30 seconds

  constructor(
    queueManager: QueueManager,
    containerService: ContainerService,
    stateManager: StateManager,
    resourceMonitor: ResourceMonitor,
    healthMonitor: HealthMonitor
  ) {
    this.queueManager = queueManager;
    this.containerService = containerService;
    this.stateManager = stateManager;
    this.resourceMonitor = resourceMonitor;
    this.healthMonitor = healthMonitor;
  }

  /**
   * Start the queue maintainer background process
   */
  start(): void {
    if (this.isRunning) {
      console.warn("[QueueMaintainer] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[QueueMaintainer] Starting queue maintainer...");
    console.log(`[QueueMaintainer] Target queue size: ${this.queueManager.getStats().targetSize}`);

    // Do initial check immediately
    this.checkAndMaintainQueue().catch((error) => {
      console.error("[QueueMaintainer] Error in initial queue check:", error);
    });

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkAndMaintainQueue().catch((error) => {
        console.error("[QueueMaintainer] Error in periodic queue check:", error);
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop the queue maintainer background process
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log("[QueueMaintainer] Stopped");
  }

  /**
   * Check queue size and spawn containers as needed
   */
  private async checkAndMaintainQueue(): Promise<void> {
    const containersNeeded = this.queueManager.getContainersNeeded();
    const queueSize = this.queueManager.getQueueSize();
    const stats = this.queueManager.getStats();

    console.log(
      `[QueueMaintainer] Queue status: ${queueSize}/${stats.targetSize} pre-warmed, ${stats.assigned} assigned, ${stats.running} running`
    );

    if (containersNeeded <= 0) {
      return; // Queue is at target size
    }

    console.log(
      `[QueueMaintainer] Need to spawn ${containersNeeded} container(s) to maintain queue`
    );

    // Check system resources before spawning
    const resourceCheck = await this.resourceMonitor.canStartContainer();
    if (!resourceCheck.allowed) {
      console.warn(
        `[QueueMaintainer] Cannot spawn containers: ${resourceCheck.reason}`
      );
      return;
    }

    // Spawn containers one at a time (up to containersNeeded)
    for (let i = 0; i < containersNeeded; i++) {
      try {
        await this.spawnPreWarmedContainer();
        // Small delay between spawns to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(
          `[QueueMaintainer] Failed to spawn pre-warmed container:`,
          error
        );
        // Continue trying to spawn others even if one fails
      }
    }
  }

  /**
   * Spawn a single pre-warmed container (without S3 bucket)
   */
  private async spawnPreWarmedContainer(): Promise<void> {
    try {
      console.log("[QueueMaintainer] Spawning new pre-warmed container...");

      // Create container without S3 bucket
      const containerInfo = await this.containerService.createContainer({
        skipS3Bucket: true,
        domain: config.domain,
      });

      // Add to queue manager
      this.queueManager.addToQueue(
        containerInfo.id,
        containerInfo.serviceName
      );

      // Save to state manager
      this.stateManager.saveContainer({
        id: containerInfo.id,
        serviceName: containerInfo.serviceName,
        s3Bucket: "", // Empty for pre-warmed containers
        s3Region: config.awsRegion,
        status: "starting",
        createdAt: containerInfo.createdAt,
        urls: containerInfo.urls,
        isPreWarmed: true,
        resourceLimits: {
          cpuLimit: `${config.containerCpuLimit} cores`,
          memoryLimit: `${config.containerMemoryLimit} bytes`,
        },
      });

      // Start health monitoring
      this.healthMonitor.checkContainerImmediately(containerInfo.id).catch(
        (error) => {
          console.error(
            `[QueueMaintainer] Error starting health check for ${containerInfo.id}:`,
            error
          );
        }
      );

      console.log(
        `[QueueMaintainer] Successfully spawned pre-warmed container ${containerInfo.id}`
      );
    } catch (error) {
      console.error(
        "[QueueMaintainer] Error spawning pre-warmed container:",
        error
      );
      throw error;
    }
  }

  /**
   * Handle container failure - remove from queue and spawn replacement
   */
  async handleContainerFailure(containerId: string): Promise<void> {
    const container = this.queueManager.getContainer(containerId);
    if (!container) {
      return; // Not in queue
    }

    console.log(
      `[QueueMaintainer] Handling failure of container ${containerId} (state: ${container.state})`
    );

    // Remove from queue
    this.queueManager.removeFromQueue(containerId);

    // If it was pre-warmed, spawn a replacement
    if (container.state === "pre-warmed") {
      console.log(
        `[QueueMaintainer] Spawning replacement for failed pre-warmed container`
      );
      try {
        await this.spawnPreWarmedContainer();
      } catch (error) {
        console.error(
          `[QueueMaintainer] Failed to spawn replacement container:`,
          error
        );
      }
    }
  }

  /**
   * Manually trigger queue maintenance (useful for testing or manual triggers)
   */
  async maintainQueue(): Promise<void> {
    await this.checkAndMaintainQueue();
  }
}

