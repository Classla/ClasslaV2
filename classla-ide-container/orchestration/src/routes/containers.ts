import { Router, Request, Response, NextFunction } from "express";
import { ContainerStatus } from "../services/stateManager";
import { config } from "../config/index";
import {
  invalidS3Bucket,
  invalidParameter,
  resourceLimitExceeded,
  containerNotFound,
  containerStartFailed,
  containerStopFailed,
} from "../middleware/errors";
import {
  containerService,
  stateManager,
  resourceMonitor,
  healthMonitor,
  s3ValidationService,
  containerStatsService,
  queueManager,
  queueMaintainer,
} from "../services/serviceInstances";
import axios from "axios";
import https from "https";

const router = Router();

/**
 * POST /api/containers/start
 * Start a new IDE container
 */
router.post(
  "/start",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.log("[Containers] POST /start received");
      // Validate request body
      const {
        s3Bucket,
        s3BucketId, // Optional: bucketId from backend
        s3Region,
        awsAccessKeyId,
        awsSecretAccessKey,
        vncPassword,
        userId,
      } = req.body;

      if (!s3Bucket || typeof s3Bucket !== "string") {
        throw invalidS3Bucket("s3Bucket is required and must be a string");
      }

      // Check if there's already a running container for this S3 bucket
      const existingContainer = stateManager.getRunningContainerByS3Bucket(s3Bucket);
      if (existingContainer && existingContainer.urls?.codeServer) {
        console.log(
          `[Containers] ✅ Found existing running container ${existingContainer.id} for bucket ${s3Bucket}, reusing it`
        );

        // Update last activity timestamp
        stateManager.updateContainerLifecycle(existingContainer.id, {
          lastActivity: new Date(),
        });

        res.status(200).json({
          id: existingContainer.id,
          serviceName: existingContainer.serviceName,
          status: existingContainer.status,
          urls: existingContainer.urls,
          message: "Container is already running. Reusing existing instance.",
          isPreWarmed: false,
          isReused: true,
        });
        return;
      }

      // Validate S3 bucket accessibility before starting container
      const s3ValidationResult = await s3ValidationService.validateBucket(
        s3Bucket,
        s3Region || config.awsRegion,
        awsAccessKeyId && awsSecretAccessKey
          ? { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey }
          : undefined
      );

      if (!s3ValidationResult.valid) {
        throw invalidS3Bucket(
          s3ValidationResult.error || "S3 bucket validation failed"
        );
      }

      // Use the validated region (in case it differs from what was provided)
      const validatedRegion =
        s3ValidationResult.region || s3Region || config.awsRegion;

      // Check queue for available pre-warmed container first
      let containerInfo;
      let usedQueue = false;
      const queueStats = queueManager.getStats();
      console.log(
        `[Containers] ========================================`
      );
      console.log(
        `[Containers] POST /start - Queue status: ${queueStats.preWarmed} pre-warmed, ${queueStats.assigned} assigned, ${queueStats.running} running (target: ${queueStats.targetSize})`
      );
      console.log(
        `[Containers] Total containers tracked: ${queueStats.total}`
      );
      
      const queuedContainer = queueManager.getAvailableContainer();
      
      if (queuedContainer) {
        console.log(
          `[Containers] ✅ Found pre-warmed container ${queuedContainer.containerId} in queue (state: ${queuedContainer.state})`
        );
      } else {
        console.log(
          `[Containers] ⚠️ No pre-warmed container available in queue (queue size: ${queueStats.preWarmed}, total tracked: ${queueStats.total})`
        );
      }

      if (queuedContainer) {
        // Use pre-warmed container from queue
        console.log(
          `[Containers] ✅ Using pre-warmed container ${queuedContainer.containerId} from queue`
        );
        
        // Verify the pre-warmed container is actually accessible before using it
        // This ensures Traefik routing is working
        const containerInState = stateManager.getContainer(queuedContainer.containerId);
        let shouldVerify = true;
        let verified = false; // Initialize verified outside the if block
        
        if (!containerInState || !containerInState.urls?.codeServer) {
          console.warn(
            `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} missing URLs, will skip verification but still assign S3`
          );
          shouldVerify = false;
        }
        
        if (shouldVerify && containerInState) {
          // Verify code-server is accessible through Traefik
          // Retry up to 3 times with delays to account for Traefik route registration
          const maxRetries = 3;
          const retryDelay = 1000; // 1 second between retries
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const codeServerUrl = containerInState.urls.codeServer;
              // For localhost URLs, use Traefik service name for internal Docker network access
              // This is the same fix we applied to the health monitor
              let checkUrl = `${codeServerUrl}/`;
              if (codeServerUrl.includes('localhost')) {
                checkUrl = checkUrl.replace('http://localhost', 'http://ide-local_traefik:80');
              }
              
              console.log(
                `[Containers] Verifying pre-warmed container ${queuedContainer.containerId} accessibility (attempt ${attempt}/${maxRetries}) at ${checkUrl}...`
              );
              
              // In local mode, disable SSL certificate validation to handle self-signed certs
              const axiosConfig: any = {
                timeout: 3000,
                validateStatus: () => true,
                maxRedirects: 5,
              };
              
              // For local development, disable SSL verification if using HTTPS
              if (config.nodeEnv === "local" || checkUrl.includes("localhost") || checkUrl.includes("ide-local_traefik")) {
                axiosConfig.httpsAgent = new https.Agent({
                  rejectUnauthorized: false,
                });
              }
              
              const response = await axios.get(checkUrl, axiosConfig);
              
              // Must return 200, 302, or 401 to be considered ready
              if (response.status === 200 || response.status === 302 || response.status === 401) {
                console.log(
                  `[Containers] ✅ Pre-warmed container ${queuedContainer.containerId} verified accessible (status: ${response.status}, attempt ${attempt}/${maxRetries})`
                );
                verified = true;
                break; // Success, exit retry loop
              } else if (response.status === 404) {
                // 404 means Traefik routing not ready yet
                if (attempt < maxRetries) {
                  console.log(
                    `[Containers] ⏳ Pre-warmed container ${queuedContainer.containerId} not accessible yet (404, attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`
                  );
                  await new Promise((resolve) => setTimeout(resolve, retryDelay));
                } else {
                  console.warn(
                    `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} not accessible after ${maxRetries} attempts (status: ${response.status}), skipping and creating new container`
                  );
                }
              } else {
                console.warn(
                  `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} returned unexpected status ${response.status} (attempt ${attempt}/${maxRetries}), skipping and creating new container`
                );
                break; // Unexpected status, don't retry
              }
            } catch (error: any) {
              if (attempt < maxRetries) {
                console.log(
                  `[Containers] ⏳ Pre-warmed container ${queuedContainer.containerId} verification failed (${error.message || String(error)}, attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
              } else {
                console.warn(
                  `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} verification failed after ${maxRetries} attempts (${error.message || String(error)}), skipping and creating new container`
                );
              }
            }
          }
        }
        
        // CRITICAL FIX: Always assign S3 bucket to pre-warmed container
        // Assignment must happen regardless of verification status or URL availability
        // Verification is just to check code-server accessibility, but S3 assignment
        // must happen for sync to work. Even if verification fails or URLs are missing,
        // we should still assign S3 so that file edits are synced and files can be downloaded.
        if (!verified && shouldVerify) {
          console.warn(
            `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} verification failed, but assigning S3 anyway to ensure sync works`
          );
        }
        
        // Always assign S3 bucket to pre-warmed container (regardless of verification or URLs)
        usedQueue = true;
        try {
          await containerService.assignS3BucketToContainer(
            queuedContainer.containerId,
            {
              bucket: s3Bucket,
              bucketId: s3BucketId, // Pass bucketId if provided
              region: validatedRegion,
              accessKeyId: awsAccessKeyId || config.awsAccessKeyId,
              secretAccessKey: awsSecretAccessKey || config.awsSecretAccessKey,
            }
          );

          // Mark container as assigned in queue
          queueManager.markAsAssigned(queuedContainer.containerId, s3Bucket);

          // Get container info
          const assignedContainerInfo = await containerService.getContainer(
            queuedContainer.containerId
          );
          if (!assignedContainerInfo) {
            throw new Error("Failed to get container info after S3 assignment");
          }
          // Pre-warmed containers are already running, but we need to wait for file sync
          // Poll /sync-status on the container's web server before marking as "running"
          let syncComplete = false;
          const syncPollStart = Date.now();
          const syncPollTimeout = 15000; // 15 seconds max
          const syncPollInterval = 500; // 500ms between polls

          while (Date.now() - syncPollStart < syncPollTimeout) {
            try {
              const syncResponse = await axios.get(
                `http://ide-${queuedContainer.containerId}:3000/sync-status`,
                { timeout: 2000, validateStatus: () => true }
              );
              if (syncResponse.status === 200 && syncResponse.data?.synced === true) {
                syncComplete = true;
                console.log(
                  `[Containers] ✅ Pre-warmed container ${queuedContainer.containerId} file sync complete (${Date.now() - syncPollStart}ms)`
                );
                break;
              }
            } catch {
              // Web server might not be ready yet, continue polling
            }
            await new Promise((resolve) => setTimeout(resolve, syncPollInterval));
          }

          if (!syncComplete) {
            console.warn(
              `[Containers] ⚠️ Pre-warmed container ${queuedContainer.containerId} file sync not complete after ${syncPollTimeout}ms, returning as "starting"`
            );
          }

          const assignedStatus: "running" | "starting" = syncComplete ? "running" : "starting";
          containerInfo = {
            ...assignedContainerInfo,
            status: assignedStatus,
          };
        } catch (error) {
          console.error(
            `[Containers] Failed to assign S3 bucket to pre-warmed container:`,
            error
          );
          // Return container to pre-warmed state so it can be reused
          queueManager.returnToQueue(queuedContainer.containerId);
          // Fall through to create new container
          usedQueue = false;
          containerInfo = undefined;
        }
      }

      // If no queue container available or assignment failed, create new container
      if (!usedQueue || !containerInfo) {
        if (!usedQueue) {
          console.log(
            `[Containers] ⚠️ No pre-warmed container available, creating new container`
          );
        } else {
          console.log(
            `[Containers] ⚠️ Pre-warmed container assignment failed, creating new container`
          );
        }
        
        // Check system resources before starting
        const resourceCheck = await resourceMonitor.canStartContainer();
        if (!resourceCheck.allowed) {
          throw resourceLimitExceeded(
            resourceCheck.reason || "System resources exhausted"
          );
        }

        // Create Docker Swarm service with Traefik labels
        try {
          containerInfo = await containerService.createContainer({
            s3Bucket,
            s3BucketId: s3BucketId, // Pass bucketId if provided
            s3Region: validatedRegion,
            awsAccessKeyId: awsAccessKeyId || config.awsAccessKeyId,
            awsSecretAccessKey: awsSecretAccessKey || config.awsSecretAccessKey,
            vncPassword,
            domain: config.domain,
          });
          console.log(
            `[Containers] ✅ Created new container ${containerInfo.id} with status: ${containerInfo.status}`
          );
        } catch (error) {
          throw containerStartFailed(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      } else {
        // CRITICAL: Verify that pre-warmed containers have S3 assignment
        if (usedQueue && containerInfo) {
          // Pre-warmed container - verify S3 was assigned
          // If assignment failed, containerInfo would be undefined and we'd create a new container
          // So if we reach here, assignment should have succeeded
          console.log(
            `[Containers] ✅ Using pre-warmed container ${containerInfo.id} with status: ${containerInfo.status}`
          );
        } else {
          // This shouldn't happen, but defensive check
          console.error(
            `[Containers] ⚠️ WARNING: Container info exists but usedQueue is false - this is unexpected`
          );
        }
      }

      // Record request received in stats service
      await containerStatsService.recordRequestReceived(
        containerInfo.id,
        s3Bucket,
        userId
      );

      // Save container metadata to state manager
      // Pre-warmed containers are already running, so use their actual status
      stateManager.saveContainer({
        id: containerInfo.id,
        serviceName: containerInfo.serviceName,
        s3Bucket: containerInfo.s3Bucket || s3Bucket, // Use provided bucket if container doesn't have it
        s3Region: validatedRegion,
        status: containerInfo.status, // Use actual status (running for pre-warmed, starting for new)
        createdAt: containerInfo.createdAt,
        urls: containerInfo.urls,
        isPreWarmed: usedQueue,
        resourceLimits: {
          cpuLimit: `${config.containerCpuLimit} cores`,
          memoryLimit: `${config.containerMemoryLimit} bytes`,
        },
      });

      // Trigger queue replenishment immediately when a pre-warmed container is used
      if (usedQueue) {
        // Queue was used, trigger immediate replenishment in background
        setImmediate(() => {
          console.log(
            `[Containers] Queue container used, triggering immediate queue replenishment`
          );
          // Trigger queue maintainer to check and spawn replacement immediately
          queueMaintainer.maintainQueue().catch((error) => {
            console.error(
              `[Containers] Error triggering queue replenishment:`,
              error
            );
          });
        });
      }

      // Ensure containerInfo is defined before using it
      if (!containerInfo) {
        throw new Error("Container info is not available");
      }

      // Trigger immediate health check for fastest detection
      // This starts aggressive polling (1s interval) and does an immediate check
      healthMonitor.checkContainerImmediately(containerInfo.id).catch((error) => {
        console.error(`[Containers] Error triggering immediate health check:`, error);
      });

      // Return container info with URLs
      const message = containerInfo.status === "running"
        ? "Container is ready. Services are available."
        : "Container is starting. Services will be available shortly.";
      
      // Log the response for debugging
      console.log(
        `[Containers] Returning container ${containerInfo.id}: status=${containerInfo.status}, usedQueue=${usedQueue}, hasUrls=${!!containerInfo.urls?.codeServer}`
      );
      
      res.status(201).json({
        id: containerInfo.id,
        serviceName: containerInfo.serviceName,
        status: containerInfo.status, // "running" for pre-warmed, "starting" for new
        urls: containerInfo.urls,
        message,
        isPreWarmed: usedQueue, // Add flag to help frontend identify pre-warmed containers
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/containers
 * List all containers with optional filtering and pagination (uses LIVE Docker data)
 */
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Parse query parameters
      const statusParam = req.query.status as string | undefined;
      const status: ContainerStatus | undefined = statusParam as
        | ContainerStatus
        | undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : undefined;

      // Validate pagination parameters
      if (limit !== undefined && (isNaN(limit) || limit < 1)) {
        throw invalidParameter("limit must be a positive integer");
      }

      if (offset !== undefined && (isNaN(offset) || offset < 0)) {
        throw invalidParameter("offset must be a non-negative integer");
      }

      // Get LIVE containers from Docker (not stale SQLite)
      const liveContainers = await containerService.listContainers({
        status,
        limit,
        offset,
      });

      // Filter out management containers (traefik, management-api)
      const ideContainers = liveContainers.filter(
        (c) => !c.serviceName.includes("traefik") && !c.serviceName.includes("management-api")
      );

      // Get total count
      const total = ideContainers.length;

      res.json({
        containers: ideContainers.map((c) => ({
          id: c.id,
          serviceName: c.serviceName,
          status: c.status,
          urls: c.urls,
          s3Bucket: c.s3Bucket,
          createdAt: c.createdAt.toISOString(),
          startedAt: c.createdAt.toISOString(), // Use createdAt as startedAt for live data
        })),
        total,
        limit: limit || total,
        offset: offset || 0,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/containers/:id
 * Get detailed information about a specific container
 */
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      console.log(`[Containers] ========================================`);
      console.log(`[Containers] GET /:id received for container ${id}`);

      // Validate container ID parameter
      if (!id || typeof id !== "string") {
        throw invalidParameter("Container ID is required");
      }

      // Query container from state manager
      const container = stateManager.getContainer(id);
      console.log(`[Containers] Container ${id} in state manager: ${container ? '✅ found' : '❌ not found'}`);
      
      if (!container) {
        // Log all containers in state manager for debugging
        const allContainers = stateManager.listContainers();
        console.log(`[Containers] Total containers in state manager: ${allContainers.length}`);
        console.log(`[Containers] Container IDs in state manager: ${allContainers.map(c => `${c.id}:${c.status}`).join(', ') || 'none'}`);
        console.log(`[Containers] Container ${id} not found in state manager, returning 404`);
        throw containerNotFound(id);
      }
      
      console.log(`[Containers] Container ${id} found. Status: ${container.status}, hasUrls: ${!!container.urls}, codeServerUrl: ${container.urls?.codeServer || 'none'}`);

      // Fetch current status from Docker Swarm
      const liveContainer = await containerService.getContainer(id);

      // Merge state manager data with live Docker data
      // If liveContainer is null, the service doesn't exist in Docker Swarm, so it's stopped
      // If liveContainer exists, use its status (which reflects actual Docker state)
      let status: ContainerStatus;
      if (!liveContainer) {
        // Service doesn't exist in Docker Swarm - container is stopped
        status = "stopped";
        // Update state manager to reflect stopped status if it's not already
        if (container.status !== "stopped") {
          stateManager.updateContainerLifecycle(id, {
            status: "stopped",
            stoppedAt: container.stoppedAt || new Date(),
          });
        }
      } else {
        // Use live status from Docker Swarm
        status = liveContainer.status;
      }

      // Calculate uptime if container is running
      let uptime: number | undefined;
      if (
        container.startedAt &&
        (status === "running" || status === "starting")
      ) {
        uptime = Math.floor(
          (Date.now() - container.startedAt.getTime()) / 1000
        );
      }

      // Get health status if available
      const health = healthMonitor.getContainerHealth(id);

      res.json({
        id: container.id,
        serviceName: container.serviceName,
        status,
        urls: container.urls,
        s3Bucket: container.s3Bucket,
        createdAt: container.createdAt.toISOString(),
        startedAt: container.startedAt?.toISOString(),
        stoppedAt: container.stoppedAt?.toISOString(),
        lastActivity: container.lastActivity?.toISOString(),
        uptime,
        shutdownReason: container.shutdownReason,
        resourceLimits: container.resourceLimits,
        health,
        isPreWarmed: container.isPreWarmed || false, // Include isPreWarmed flag
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/containers/:id
 * Stop and remove a container
 */
router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      // Validate container ID parameter
      if (!id || typeof id !== "string") {
        throw invalidParameter("Container ID is required");
      }

      // Check if container exists in state manager
      const container = stateManager.getContainer(id);

      if (!container) {
        throw containerNotFound(id);
      }

      // Stop Docker Swarm service
      try {
        await containerService.stopContainer(id);
      } catch (error) {
        // If service doesn't exist in Docker, that's okay - continue with state update
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        ) {
          console.warn(
            `Service ide-${id} not found in Docker Swarm, updating state only`
          );
        } else {
          throw containerStopFailed(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }

      // Update container status to 'stopped' and record shutdown reason as 'manual'
      stateManager.updateContainerLifecycle(id, {
        status: "stopped",
        stoppedAt: new Date(),
        shutdownReason: "manual",
      });

      // Record container stopped in stats service
      await containerStatsService.recordContainerStopped(id, "manual");

      // Remove health monitoring state for this container
      healthMonitor.removeContainerHealth(id);

      res.json({
        message: `Container ${id} stopped successfully`,
        id,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/containers/:id/inactivity-shutdown
 * Webhook endpoint for containers to report inactivity shutdown
 * This endpoint does NOT require authentication as it's called from within containers
 * Exported as a separate handler so it can be mounted without authentication middleware
 */
export async function handleInactivityShutdown(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      // Validate container ID parameter
      if (!id || typeof id !== "string") {
        throw invalidParameter("Container ID is required");
      }

      // Check if container exists in state manager
      const container = stateManager.getContainer(id);

      if (!container) {
        throw containerNotFound(id);
      }

      // Log inactivity shutdown
      console.log(
        `[Inactivity Shutdown] Container ${id} reporting inactivity shutdown. Reason: ${
          reason || "inactivity"
        }`
      );

      // Actually stop the Docker service
      try {
        await containerService.stopContainer(id);
        console.log(`[Inactivity Shutdown] Successfully stopped Docker service for container ${id}`);
      } catch (error) {
        // If service doesn't exist in Docker, that's okay - continue with state update
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        ) {
          console.warn(
            `[Inactivity Shutdown] Service ide-${id} not found in Docker Swarm, updating state only`
          );
        } else {
          console.error(
            `[Inactivity Shutdown] Failed to stop Docker service for container ${id}:`,
            error
          );
          // Continue anyway to update state
        }
      }

      // Update container status to 'stopped' and record shutdown reason as 'inactivity'
      stateManager.updateContainerLifecycle(id, {
        status: "stopped",
        stoppedAt: new Date(),
        shutdownReason: "inactivity",
      });

      // Record container stopped in stats service
      await containerStatsService.recordContainerStopped(id, "inactivity");

      // Remove health monitoring state for this container
      healthMonitor.removeContainerHealth(id);
      
      // Remove from queue if it was in the queue
      queueManager.removeFromQueue(id);

      res.json({
        message: `Container ${id} inactivity shutdown recorded`,
        id,
        status: "stopped",
        shutdownReason: "inactivity",
        stoppedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
}

// Also mount on router for backward compatibility
router.post(
  "/:id/inactivity-shutdown",
  handleInactivityShutdown
);

export default router;
