import { Router, Request, Response, NextFunction } from "express";
import { config } from "../config/index";
import { queueManager, resourceMonitor } from "../services/serviceInstances";
import Docker from "dockerode";

const router = Router();

// Use shared Docker instance
const docker = new Docker({ socketPath: config.dockerSocket });

/**
 * GET /api/health
 * Health check endpoint with Docker connectivity and resource summary
 */
router.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const healthStatus: {
        status: string;
        timestamp: string;
        docker: {
          connected: boolean;
          error?: string;
        };
        queue?: {
          preWarmed: number;
          withS3Bucket: number;
          targetSize: number;
        };
        resources?: {
          cpu: {
            usage: number;
            available: number;
          };
          memory: {
            total: number;
            used: number;
            available: number;
            usagePercent: number;
          };
          disk: {
            total: number;
            used: number;
            available: number;
            usagePercent: number;
          };
          containers: {
            running: number;
            total: number;
          };
        };
      } = {
        status: "ok",
        timestamp: new Date().toISOString(),
        docker: {
          connected: false,
        },
      };

      // Check Docker daemon connectivity
      try {
        await docker.ping();
        healthStatus.docker.connected = true;
      } catch (error) {
        healthStatus.docker.connected = false;
        healthStatus.docker.error =
          error instanceof Error ? error.message : "Unknown error";
        healthStatus.status = "degraded";
      }

      // Get system resource summary first (needed for queue calculation)
      let resources;
      try {
        resources = await resourceMonitor.getSystemResources();
        healthStatus.resources = resources;
      } catch (error) {
        console.error("Failed to get system resources:", error);
        // Don't fail the health check if we can't get resources
        resources = null;
      }

      // Get queue statistics from queue manager (more accurate than counting Docker services)
      try {
        const queueStats = queueManager.getStats();
        // Calculate containers with S3 buckets: total running - pre-warmed - management API - traefik
        let containersWithS3 = 0;
        if (resources && resources.containers) {
          const totalRunning = resources.containers.running;
          // Total = pre-warmed + with S3 + management API (1) + traefik (1)
          containersWithS3 = Math.max(0, totalRunning - queueStats.preWarmed - 2);
        }
        
        healthStatus.queue = {
          preWarmed: queueStats.preWarmed,
          withS3Bucket: containersWithS3,
          targetSize: queueStats.targetSize,
        };
      } catch (error) {
        console.error("[Health] Failed to get queue statistics:", error);
        // Still include queue object with zeros if there's an error
        healthStatus.queue = {
          preWarmed: 0,
          withS3Bucket: 0,
          targetSize: config.preWarmedQueueSize,
        };
      }

      // Return appropriate status code
      const statusCode = healthStatus.status === "ok" ? 200 : 503;

      res.status(statusCode).json(healthStatus);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
