import { Router, Request, Response, NextFunction } from "express";
import { ContainerStatus } from "../services/stateManager.js";
import { config } from "../config/index.js";
import {
  invalidS3Bucket,
  invalidParameter,
  resourceLimitExceeded,
  containerNotFound,
  containerStartFailed,
  containerStopFailed,
} from "../middleware/errors.js";
import {
  containerService,
  stateManager,
  resourceMonitor,
  healthMonitor,
  s3ValidationService,
  containerStatsService,
} from "../services/serviceInstances.js";

const router = Router();

/**
 * POST /api/containers/start
 * Start a new IDE container
 */
router.post(
  "/start",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate request body
      const {
        s3Bucket,
        s3Region,
        awsAccessKeyId,
        awsSecretAccessKey,
        vncPassword,
        userId,
      } = req.body;

      if (!s3Bucket || typeof s3Bucket !== "string") {
        throw invalidS3Bucket("s3Bucket is required and must be a string");
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

      // Check system resources before starting
      const resourceCheck = await resourceMonitor.canStartContainer();
      if (!resourceCheck.allowed) {
        throw resourceLimitExceeded(
          resourceCheck.reason || "System resources exhausted"
        );
      }

      // Create Docker Swarm service with Traefik labels
      let containerInfo;
      try {
        containerInfo = await containerService.createContainer({
          s3Bucket,
          s3Region: validatedRegion,
          awsAccessKeyId: awsAccessKeyId || config.awsAccessKeyId,
          awsSecretAccessKey: awsSecretAccessKey || config.awsSecretAccessKey,
          vncPassword,
          domain: config.domain,
        });
      } catch (error) {
        throw containerStartFailed(
          error instanceof Error ? error : new Error(String(error))
        );
      }

      // Record request received in stats service
      await containerStatsService.recordRequestReceived(
        containerInfo.id,
        s3Bucket,
        userId
      );

      // Save container metadata to state manager
      stateManager.saveContainer({
        id: containerInfo.id,
        serviceName: containerInfo.serviceName,
        s3Bucket: containerInfo.s3Bucket,
        s3Region: validatedRegion,
        status: "starting",
        createdAt: containerInfo.createdAt,
        urls: containerInfo.urls,
        resourceLimits: {
          cpuLimit: `${config.containerCpuLimit} cores`,
          memoryLimit: `${config.containerMemoryLimit} bytes`,
        },
      });

      // Return container info with URLs
      res.status(201).json({
        id: containerInfo.id,
        serviceName: containerInfo.serviceName,
        status: containerInfo.status,
        urls: containerInfo.urls,
        message: "Container is starting. Services will be available shortly.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/containers
 * List all containers with optional filtering and pagination
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

      // Get containers from state manager
      const containers = stateManager.listContainers({
        status,
        limit,
        offset,
      });

      // Get total count for pagination
      const total = stateManager.getContainerCount(status);

      res.json({
        containers: containers.map((c) => ({
          id: c.id,
          serviceName: c.serviceName,
          status: c.status,
          urls: c.urls,
          s3Bucket: c.s3Bucket,
          createdAt: c.createdAt.toISOString(),
          lastActivity: c.lastActivity?.toISOString(),
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

      // Validate container ID parameter
      if (!id || typeof id !== "string") {
        throw invalidParameter("Container ID is required");
      }

      // Query container from state manager
      const container = stateManager.getContainer(id);

      if (!container) {
        throw containerNotFound(id);
      }

      // Fetch current status from Docker Swarm
      const liveContainer = await containerService.getContainer(id);

      // Merge state manager data with live Docker data
      const status = liveContainer ? liveContainer.status : container.status;

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
 */
router.post(
  "/:id/inactivity-shutdown",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
);

export default router;
