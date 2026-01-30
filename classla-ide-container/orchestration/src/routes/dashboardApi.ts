import { Router, Request, Response, NextFunction } from "express";
import {
  containerService,
  stateManager,
  resourceMonitor,
  healthMonitor,
  nodeMonitor,
  queueManager,
} from "../services/serviceInstances";
import { invalidParameter, containerNotFound } from "../middleware/errors";

const router = Router();

/**
 * GET /api/dashboard/overview
 * Return cluster overview metrics (uses LIVE Docker data, not stale database)
 */
router.get(
  "/overview",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Get system resources
      const resources = await resourceMonitor.getSystemResources();

      // Get LIVE container data from Docker (not stale SQLite)
      const liveContainers = await containerService.listContainers();

      // Filter out management containers (traefik, management-api)
      const ideContainers = liveContainers.filter(
        (c) => !c.serviceName.includes("traefik") && !c.serviceName.includes("management-api")
      );

      // Count by status from live data
      const runningCount = ideContainers.filter((c) => c.status === "running").length;
      const startingCount = ideContainers.filter((c) => c.status === "starting").length;
      const stoppedCount = ideContainers.filter((c) => c.status === "stopped").length;
      const failedCount = ideContainers.filter((c) => c.status === "failed").length;
      const totalCount = ideContainers.length;

      // Calculate uptime for running containers
      const uptimes = ideContainers
        .filter((c) => c.status === "running" && c.createdAt)
        .map((c) => {
          const uptime = Math.floor(
            (Date.now() - c.createdAt.getTime()) / 1000
          );
          return uptime;
        });

      const averageUptime =
        uptimes.length > 0
          ? Math.floor(uptimes.reduce((a, b) => a + b, 0) / uptimes.length)
          : 0;

      res.json({
        timestamp: new Date().toISOString(),
        containers: {
          total: totalCount,
          running: runningCount,
          starting: startingCount,
          stopped: stoppedCount,
          failed: failedCount,
          averageUptime, // in seconds
        },
        resources: {
          cpu: {
            usage: resources.cpu.usage,
            available: resources.cpu.available,
          },
          memory: {
            total: resources.memory.total,
            used: resources.memory.used,
            available: resources.memory.available,
            usagePercent: resources.memory.usagePercent,
          },
          disk: {
            total: resources.disk.total,
            used: resources.disk.used,
            available: resources.disk.available,
            usagePercent: resources.disk.usagePercent,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/dashboard/nodes
 * Return list of all Swarm nodes with metrics and health status
 */
router.get(
  "/nodes",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Get all nodes with basic information
      const nodes = await nodeMonitor.getNodes();

      // Get per-node metrics
      const nodeMetrics = await nodeMonitor.getNodeMetrics();

      // Merge node info with metrics
      const nodesWithMetrics = nodes.map((node) => {
        const metrics = nodeMetrics.find((m) => m.nodeId === node.id);

        return {
          id: node.id,
          hostname: node.hostname,
          role: node.role,
          status: node.status,
          availability: node.availability,
          resources: {
            cpu: {
              cores: node.resources.cpuCores,
              usage: metrics?.cpuUsage || 0,
            },
            memory: {
              total: node.resources.memoryBytes,
              used: metrics?.memoryUsage || 0,
              usagePercent: metrics?.memoryUsagePercent || 0,
            },
          },
          containerCount: metrics?.containerCount || 0,
          health: metrics?.health || "unknown",
        };
      });

      res.json({
        timestamp: new Date().toISOString(),
        totalNodes: nodes.length,
        nodes: nodesWithMetrics,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/dashboard/logs
 * Stream logs from Docker services using Server-Sent Events
 */
router.get(
  "/logs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const containerId = req.query.containerId as string | undefined;

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

      // If containerId is provided, stream logs from that specific container
      if (containerId) {
        try {
          const logStream = await containerService.getContainerLogs(
            containerId,
            {
              follow: true,
              tail: 100,
              timestamps: true,
            }
          );

          // Parse Docker log stream (it uses a special format)
          logStream.on("data", (chunk: Buffer) => {
            try {
              // Docker multiplexes stdout/stderr with an 8-byte header
              // Header format: [stream_type, 0, 0, 0, size1, size2, size3, size4]
              let offset = 0;
              while (offset < chunk.length) {
                if (chunk.length - offset < 8) break;

                const header = chunk.slice(offset, offset + 8);
                const streamType = header[0]; // 1=stdout, 2=stderr
                const size =
                  (header[4] << 24) |
                  (header[5] << 16) |
                  (header[6] << 8) |
                  header[7];

                if (chunk.length - offset < 8 + size) break;

                const message = chunk
                  .slice(offset + 8, offset + 8 + size)
                  .toString("utf-8");

                const logEntry = {
                  type: "log",
                  containerId,
                  stream: streamType === 1 ? "stdout" : "stderr",
                  message: message.trim(),
                  timestamp: new Date().toISOString(),
                };

                res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
                offset += 8 + size;
              }
            } catch (error) {
              console.error("Error parsing log chunk:", error);
            }
          });

          logStream.on("error", (error: Error) => {
            const errorEntry = {
              type: "error",
              message: error.message,
              timestamp: new Date().toISOString(),
            };
            res.write(`data: ${JSON.stringify(errorEntry)}\n\n`);
          });

          logStream.on("end", () => {
            const endEntry = {
              type: "end",
              timestamp: new Date().toISOString(),
            };
            res.write(`data: ${JSON.stringify(endEntry)}\n\n`);
            res.end();
          });

          // Clean up on client disconnect
          req.on("close", () => {
            if (logStream && typeof (logStream as any).destroy === "function") {
              (logStream as any).destroy();
            }
          });
        } catch (error) {
          const errorEntry = {
            type: "error",
            message:
              error instanceof Error ? error.message : "Failed to get logs",
            timestamp: new Date().toISOString(),
          };
          res.write(`data: ${JSON.stringify(errorEntry)}\n\n`);
          res.end();
        }
      } else {
        // If no containerId, send periodic system-level updates
        const interval = setInterval(() => {
          const systemLog = {
            type: "system",
            message: "System monitoring active",
            timestamp: new Date().toISOString(),
          };
          res.write(`data: ${JSON.stringify(systemLog)}\n\n`);
        }, 5000);

        // Clean up on client disconnect
        req.on("close", () => {
          clearInterval(interval);
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/dashboard/container/:id/action
 * Execute actions on containers (start, stop, restart, delete)
 */
router.post(
  "/container/:id/action",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { action } = req.body;

      // Validate container ID
      if (!id || typeof id !== "string") {
        throw invalidParameter("Container ID is required");
      }

      // Validate action parameter
      const validActions = ["start", "stop", "restart", "delete"];
      if (!action || !validActions.includes(action)) {
        throw invalidParameter(
          `Action must be one of: ${validActions.join(", ")}`
        );
      }

      // Check if container exists
      const container = stateManager.getContainer(id);
      if (!container) {
        throw containerNotFound(id);
      }

      let updatedStatus: string;
      let message: string;

      switch (action) {
        case "stop":
        case "delete":
          // Stop the container service
          await containerService.stopContainer(id);

          // Update state
          stateManager.updateContainerLifecycle(id, {
            status: "stopped",
            stoppedAt: new Date(),
            shutdownReason: "manual",
          });

          // Remove health monitoring
          healthMonitor.removeContainerHealth(id);

          updatedStatus = "stopped";
          message = `Container ${id} ${
            action === "delete" ? "deleted" : "stopped"
          } successfully`;
          break;

        case "restart": {
          // For restart, we stop and then start again
          // First stop
          await containerService.stopContainer(id);

          // Update state to stopped
          stateManager.updateContainerLifecycle(id, {
            status: "stopped",
            stoppedAt: new Date(),
            shutdownReason: "manual",
          });

          // Wait a moment for cleanup
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Then start again with same config
          const newContainer = await containerService.createContainer({
            s3Bucket: container.s3Bucket,
            s3Region: container.s3Region,
            domain: container.urls.vnc.split("-vnc.")[1].split("/")[0],
          });

          // Update state with new service
          stateManager.saveContainer({
            id: newContainer.id,
            serviceName: newContainer.serviceName,
            s3Bucket: newContainer.s3Bucket,
            s3Region: container.s3Region,
            status: "starting",
            createdAt: newContainer.createdAt,
            urls: newContainer.urls,
            resourceLimits: container.resourceLimits,
          });

          updatedStatus = "starting";
          message = `Container ${id} restarted successfully`;
          break;
        }

        case "start":
          // Start is not implemented as containers are created fresh
          // This would require storing the full config
          throw invalidParameter(
            "Start action not supported. Use restart instead."
          );

        default:
          throw invalidParameter(`Unknown action: ${action}`);
      }

      // Get updated container info
      const updatedContainer = stateManager.getContainer(id);

      res.json({
        message,
        container: updatedContainer
          ? {
              id: updatedContainer.id,
              serviceName: updatedContainer.serviceName,
              status: updatedStatus,
              urls: updatedContainer.urls,
              s3Bucket: updatedContainer.s3Bucket,
              createdAt: updatedContainer.createdAt.toISOString(),
              stoppedAt: updatedContainer.stoppedAt?.toISOString(),
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/dashboard/queue/stats
 * Return queue statistics (uses LIVE Docker data for accuracy)
 */
router.get(
  "/queue/stats",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const queueStats = queueManager.getStats();

      // Get LIVE container data from Docker to count pre-warmed vs with S3
      const liveContainers = await containerService.listContainers();

      // Filter out management containers
      const ideContainers = liveContainers.filter(
        (c) => !c.serviceName.includes("traefik") && !c.serviceName.includes("management-api")
      );

      // Count containers with and without S3 buckets from live data
      const containersWithS3 = ideContainers.filter((c) => c.s3Bucket && c.s3Bucket.length > 0).length;
      const preWarmedCount = ideContainers.filter((c) => !c.s3Bucket || c.s3Bucket.length === 0).length;

      res.json({
        timestamp: new Date().toISOString(),
        preWarmed: preWarmedCount,
        assigned: queueStats.assigned,
        running: ideContainers.length,
        total: ideContainers.length,
        targetSize: queueStats.targetSize,
        withS3Bucket: containersWithS3,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
