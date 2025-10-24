import { Router, Request, Response, NextFunction } from "express";
import { ContainerService } from "../services/containerService.js";
import { ResourceMonitor } from "../services/resourceMonitor.js";
import { config } from "../config/index.js";
import Docker from "dockerode";

const router = Router();

// Initialize services
const containerService = new ContainerService();
const resourceMonitor = new ResourceMonitor(containerService, {
  memoryPercent: config.maxMemoryPercent,
  cpuPercent: config.maxCpuPercent,
});
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

      // Get system resource summary
      try {
        const resources = await resourceMonitor.getSystemResources();
        healthStatus.resources = resources;
      } catch (error) {
        console.error("Failed to get system resources:", error);
        // Don't fail the health check if we can't get resources
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
