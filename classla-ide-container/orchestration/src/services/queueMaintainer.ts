import { QueueManager } from "./queueManager";
import { ContainerService } from "./containerService";
import { StateManager } from "./stateManager";
import { ResourceMonitor } from "./resourceMonitor";
import { HealthMonitor } from "./healthMonitor";
import { config } from "../config/index";
import axios from "axios";
import https from "https";

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
  private isMaintaining = false; // Lock to prevent concurrent maintenance

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
    const stats = this.queueManager.getStats();
    console.log("[QueueMaintainer] ========================================");
    console.log("[QueueMaintainer] Starting queue maintainer...");
    console.log(`[QueueMaintainer] Target queue size: ${stats.targetSize}`);
    console.log(`[QueueMaintainer] Current queue size: ${stats.preWarmed}`);
    console.log(`[QueueMaintainer] Check interval: ${this.checkIntervalMs}ms`);
    console.log("[QueueMaintainer] ========================================");

    // First, sync with Docker to discover existing pre-warmed containers
    console.log("[QueueMaintainer] Syncing with Docker to discover existing containers...");
    this.syncWithDocker().then(() => {
      const syncedStats = this.queueManager.getStats();
      console.log(`[QueueMaintainer] After sync: ${syncedStats.preWarmed} pre-warmed containers in queue`);

      // Do initial check after sync
      console.log("[QueueMaintainer] Running initial queue check...");
      this.checkAndMaintainQueue().catch((error) => {
        console.error("[QueueMaintainer] Error in initial queue check:", error);
      });
    }).catch((error) => {
      console.error("[QueueMaintainer] Error syncing with Docker:", error);
      // Still do initial check even if sync fails
      this.checkAndMaintainQueue().catch((error) => {
        console.error("[QueueMaintainer] Error in initial queue check:", error);
      });
    });

    // Then check periodically
    this.checkInterval = setInterval(() => {
      console.log("[QueueMaintainer] Running periodic queue check...");
      this.checkAndMaintainQueue().catch((error) => {
        console.error("[QueueMaintainer] Error in periodic queue check:", error);
      });
    }, this.checkIntervalMs);

    console.log("[QueueMaintainer] Queue maintainer started successfully");
  }

  /**
   * Sync queue manager with actual Docker containers
   * This discovers existing pre-warmed containers (without S3 buckets) and adds them to the queue
   * Also removes stale entries for containers that no longer exist in Docker
   */
  private async syncWithDocker(): Promise<void> {
    try {
      // Get all live containers from Docker
      const liveContainers = await this.containerService.listContainers();

      // Filter for IDE containers (exclude traefik, management-api)
      const ideContainers = liveContainers.filter(
        (c) => !c.serviceName.includes("traefik") && !c.serviceName.includes("management-api")
      );

      // Find pre-warmed containers (those without S3 buckets)
      const preWarmedContainers = ideContainers.filter(
        (c) => !c.s3Bucket || c.s3Bucket.length === 0
      );

      // Get set of live container IDs for quick lookup
      const liveContainerIds = new Set(ideContainers.map((c) => c.id));

      console.log(`[QueueMaintainer] Found ${ideContainers.length} IDE containers in Docker`);
      console.log(`[QueueMaintainer] Found ${preWarmedContainers.length} pre-warmed containers (no S3 bucket)`);

      // Remove stale entries from queue (containers that no longer exist in Docker)
      const trackedIds = this.queueManager.getAllContainerIds();
      let removedCount = 0;
      for (const containerId of trackedIds) {
        if (!liveContainerIds.has(containerId)) {
          this.queueManager.removeFromQueue(containerId);
          removedCount++;
          console.log(`[QueueMaintainer] Removed stale container ${containerId} from queue (no longer in Docker)`);
        }
      }

      if (removedCount > 0) {
        console.log(`[QueueMaintainer] Removed ${removedCount} stale containers from queue`);
      }

      // Add pre-warmed containers to queue if not already tracked
      let addedCount = 0;
      for (const container of preWarmedContainers) {
        const existing = this.queueManager.getContainer(container.id);
        if (!existing) {
          this.queueManager.addToQueue(container.id, container.serviceName);
          addedCount++;
          console.log(`[QueueMaintainer] Added existing container ${container.id} to queue`);
        }
      }

      console.log(`[QueueMaintainer] Synced: added ${addedCount}, removed ${removedCount} containers`);
    } catch (error) {
      console.error("[QueueMaintainer] Failed to sync with Docker:", error);
      throw error;
    }
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
    // Prevent concurrent maintenance checks
    if (this.isMaintaining) {
      console.log("[QueueMaintainer] Maintenance already in progress, skipping this check");
      return;
    }

    this.isMaintaining = true;
    try {
      console.log("[QueueMaintainer] ========================================");
      console.log("[QueueMaintainer] Starting queue maintenance check...");

      // First sync with Docker to remove stale entries and add new ones
      console.log("[QueueMaintainer] Syncing with Docker...");
      await this.syncWithDocker();

      const containersNeeded = this.queueManager.getContainersNeeded();
      const queueSize = this.queueManager.getQueueSize();
      const stats = this.queueManager.getStats();

    console.log(
      `[QueueMaintainer] Queue status: ${queueSize}/${stats.targetSize} pre-warmed, ${stats.assigned} assigned, ${stats.running} running (total tracked: ${stats.total})`
    );
    console.log(`[QueueMaintainer] Containers needed: ${containersNeeded}`);

    if (containersNeeded <= 0) {
      console.log(
        `[QueueMaintainer] ✅ Queue is at target size (${queueSize}/${stats.targetSize}), no action needed`
      );
      console.log("[QueueMaintainer] ========================================");
      return; // Queue is at target size
    }

    console.log(
      `[QueueMaintainer] ⚠️ Need to spawn ${containersNeeded} container(s) to maintain queue`
    );

    // Check system resources before spawning
    console.log("[QueueMaintainer] Checking system resources...");
    const resourceCheck = await this.resourceMonitor.canStartContainer();
    if (!resourceCheck.allowed) {
      console.warn(
        `[QueueMaintainer] ❌ Cannot spawn containers: ${resourceCheck.reason}`
      );
      console.log("[QueueMaintainer] ========================================");
      return;
    }
    console.log("[QueueMaintainer] ✅ System resources OK, proceeding with spawn");

    // Spawn containers one at a time (up to containersNeeded)
    for (let i = 0; i < containersNeeded; i++) {
      try {
        console.log(`[QueueMaintainer] Spawning container ${i + 1}/${containersNeeded}...`);
        await this.spawnPreWarmedContainer();
        console.log(`[QueueMaintainer] ✅ Successfully spawned container ${i + 1}/${containersNeeded}`);
        // Small delay between spawns to avoid overwhelming the system
        if (i < containersNeeded - 1) {
          console.log("[QueueMaintainer] Waiting 2 seconds before next spawn...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(
          `[QueueMaintainer] ❌ Failed to spawn pre-warmed container ${i + 1}/${containersNeeded}:`,
          error
        );
        // Continue trying to spawn others even if one fails
      }
    }
    
      console.log("[QueueMaintainer] Queue maintenance check complete");
      console.log("[QueueMaintainer] ========================================");
    } finally {
      this.isMaintaining = false;
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

      // Save to state manager first
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

      // Start health monitoring and wait for container to be ready before adding to queue
      console.log(
        `[QueueMaintainer] ⏳ Waiting for pre-warmed container ${containerInfo.id} to be ready before adding to queue...`
      );
      console.log(`[QueueMaintainer] Code-server URL: ${containerInfo.urls.codeServer}`);
      
      // Wait for container to be ready (code-server accessible through Traefik)
      let isReady = false;
      const maxWaitTime = 120000; // 2 minutes max wait
      const checkInterval = 2000; // Check every 2 seconds
      const startTime = Date.now();
      let checkCount = 0;
      
      while (!isReady && (Date.now() - startTime) < maxWaitTime) {
        checkCount++;
        try {
          // Check if code-server is accessible through Traefik (actual route, not /healthz)
          const codeServerUrl = containerInfo.urls.codeServer;
          // For localhost URLs, use Traefik service name for internal Docker network access
          let checkUrl = `${codeServerUrl}/`;
          if (codeServerUrl.includes('localhost')) {
            checkUrl = checkUrl.replace('http://localhost', 'http://ide-local_traefik:80');
          }
          
          if (checkCount % 5 === 0 || checkCount === 1) {
            console.log(
              `[QueueMaintainer] Check ${checkCount}: Verifying pre-warmed container ${containerInfo.id} readiness at ${checkUrl}...`
            );
          }
          
          // In local mode, disable SSL certificate validation to handle self-signed certs
          const axiosConfig: any = {
            timeout: 3000,
            validateStatus: () => true, // Accept all status codes
            maxRedirects: 5,
          };
          
          // For local development, disable SSL verification if using HTTPS
          if (config.nodeEnv === "local" || checkUrl.includes("localhost") || checkUrl.includes("ide-local_traefik")) {
            axiosConfig.httpsAgent = new https.Agent({
              rejectUnauthorized: false,
            });
          }
          
          const response = await axios.get(checkUrl, axiosConfig);
          
          // Accept 200, 302 (redirect), or 401 (auth required) - means route is working
          // 404 means Traefik routing isn't ready yet
          // Note: We only verify code-server here. Web server verification happens
          // when we actually assign S3 bucket (with retries), as web server can take
          // longer to start and we don't want to delay queue population unnecessarily.
          if (response.status === 200 || response.status === 302 || response.status === 401) {
            isReady = true;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(
              `[QueueMaintainer] ✅ Pre-warmed container ${containerInfo.id} is ready after ${elapsed}s (code-server accessible via Traefik, status: ${response.status})`
            );
            console.log(
              `[QueueMaintainer] ℹ️  Web server will be verified when S3 bucket is assigned`
            );
          } else if (response.status === 404) {
            if (checkCount % 5 === 0 || checkCount === 1) {
              console.log(
                `[QueueMaintainer] ⏳ Pre-warmed container ${containerInfo.id} not ready yet (404 - Traefik routing not active), waiting...`
              );
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
          } else {
            if (checkCount % 5 === 0 || checkCount === 1) {
              console.log(
                `[QueueMaintainer] ⏳ Pre-warmed container ${containerInfo.id} returned status ${response.status}, waiting...`
              );
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
          }
        } catch (error: any) {
          // Network error or timeout - container not ready yet
          if (checkCount % 5 === 0 || checkCount === 1) {
            if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
              console.log(
                `[QueueMaintainer] ⏳ Pre-warmed container ${containerInfo.id} not ready yet (timeout), waiting...`
              );
            } else {
              console.log(
                `[QueueMaintainer] ⏳ Pre-warmed container ${containerInfo.id} not ready yet (error: ${error.message || String(error)}), waiting...`
              );
            }
          }
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
        }
      }
      
      if (!isReady) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.warn(
          `[QueueMaintainer] ❌ Pre-warmed container ${containerInfo.id} did not become ready within ${elapsed}s (max: ${maxWaitTime / 1000}s), removing from state`
        );
        // Update status to failed and remove from queue
        this.stateManager.updateContainerLifecycle(containerInfo.id, {
          status: "failed",
        });
        this.queueManager.removeFromQueue(containerInfo.id);
        throw new Error(`Pre-warmed container ${containerInfo.id} did not become ready within timeout`);
      }

      // Container is ready - add to queue manager
      console.log(`[QueueMaintainer] Adding container ${containerInfo.id} to queue manager...`);
      this.queueManager.addToQueue(
        containerInfo.id,
        containerInfo.serviceName
      );
      console.log(`[QueueMaintainer] ✅ Container ${containerInfo.id} added to queue`);

      // Update status to running now that it's ready
      this.stateManager.updateContainerLifecycle(containerInfo.id, {
        status: "running",
      });
      console.log(`[QueueMaintainer] ✅ Container ${containerInfo.id} status updated to 'running'`);

      // Start health monitoring for ongoing checks
      console.log(`[QueueMaintainer] Starting health monitoring for ${containerInfo.id}...`);
      this.healthMonitor.checkContainerImmediately(containerInfo.id).catch(
        (error) => {
          console.error(
            `[QueueMaintainer] ❌ Error starting health check for ${containerInfo.id}:`,
            error
          );
        }
      );

      console.log(
        `[QueueMaintainer] ✅ Successfully spawned and verified pre-warmed container ${containerInfo.id} - added to queue`
      );
      console.log("[QueueMaintainer] ========================================");
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

