import express, { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authenticateToken } from "../middleware/auth";
import { requireAdmin } from "../middleware/authorization";
import { logger } from "../utils/logger";

const router = express.Router();

// IDE orchestration API base URL
const getIDEApiBaseUrl = (req: Request): string => {
  // Check for X-IDE-Environment header (set by frontend when toggling local mode)
  const ideEnvironment = req.headers["x-ide-environment"];
  if (ideEnvironment === "local") {
    // Port 3001 is the orchestration service direct port (not through Traefik)
    return "http://localhost:3001/api";
  }

  // In development, default to localhost:3001 if no IDE_API_BASE_URL is set
  if (process.env.NODE_ENV === "development" && !process.env.IDE_API_BASE_URL) {
    return "http://localhost:3001/api";
  }

  return process.env.IDE_API_BASE_URL || "https://ide.classla.org/api";
};

// IDE API key for authentication
const IDE_API_KEY = process.env.IDE_API_KEY || "test-api-key-12345";

/**
 * GET /api/admin/ide/overview
 * Get cluster overview metrics (containers, resources)
 */
router.get(
  "/overview",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    try {
      logger.info(`[Admin IDE] Fetching overview from ${ideApiBaseUrl}/dashboard/overview`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${ideApiBaseUrl}/dashboard/overview`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Overview request failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to fetch IDE overview",
            details: errorText,
          },
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error: any) {
      logger.error("[Admin IDE] Failed to fetch overview:", error);

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message,
        },
      });
    }
  })
);

/**
 * GET /api/admin/ide/containers
 * List all containers with their details
 */
router.get(
  "/containers",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ideApiBaseUrl = getIDEApiBaseUrl(req);
    const { status, limit, offset } = req.query;

    try {
      const queryParams = new URLSearchParams();
      if (status) queryParams.append("status", status as string);
      if (limit) queryParams.append("limit", limit as string);
      if (offset) queryParams.append("offset", offset as string);

      const url = `${ideApiBaseUrl}/containers${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      logger.info(`[Admin IDE] Fetching containers from ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Containers request failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to fetch containers",
            details: errorText,
          },
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error: any) {
      logger.error("[Admin IDE] Failed to fetch containers:", error);

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message,
        },
      });
    }
  })
);

/**
 * GET /api/admin/ide/queue/stats
 * Get queue statistics (pre-warmed containers, etc.)
 */
router.get(
  "/queue/stats",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    try {
      logger.info(`[Admin IDE] Fetching queue stats from ${ideApiBaseUrl}/dashboard/queue/stats`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${ideApiBaseUrl}/dashboard/queue/stats`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Queue stats request failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to fetch queue stats",
            details: errorText,
          },
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error: any) {
      logger.error("[Admin IDE] Failed to fetch queue stats:", error);

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message,
        },
      });
    }
  })
);

/**
 * DELETE /api/admin/ide/containers/:id
 * Kill/stop a specific container
 */
router.delete(
  "/containers/:id",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Container ID is required",
        },
      });
    }

    try {
      logger.info(`[Admin IDE] Killing container ${id} via ${ideApiBaseUrl}/containers/${id}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ideApiBaseUrl}/containers/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return res.status(404).json({
          error: {
            code: "CONTAINER_NOT_FOUND",
            message: "Container not found",
          },
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Kill container request failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to kill container",
            details: errorText,
          },
        });
      }

      const data = (await response.json()) as Record<string, unknown>;
      logger.info(`[Admin IDE] Container ${id} killed successfully`);
      return res.json({
        message: `Container ${id} stopped successfully`,
        ...data,
      });
    } catch (error: any) {
      logger.error(`[Admin IDE] Failed to kill container ${id}:`, error);

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message,
        },
      });
    }
  })
);

/**
 * POST /api/admin/ide/containers/:id/action
 * Execute an action on a container (stop, restart, delete)
 */
router.post(
  "/containers/:id/action",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { action } = req.body;
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Container ID is required",
        },
      });
    }

    const validActions = ["stop", "restart", "delete"];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: `Action must be one of: ${validActions.join(", ")}`,
        },
      });
    }

    try {
      logger.info(`[Admin IDE] Executing action '${action}' on container ${id}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ideApiBaseUrl}/dashboard/container/${id}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return res.status(404).json({
          error: {
            code: "CONTAINER_NOT_FOUND",
            message: "Container not found",
          },
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Container action request failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: `Failed to execute action '${action}' on container`,
            details: errorText,
          },
        });
      }

      const data = await response.json();
      logger.info(`[Admin IDE] Action '${action}' executed successfully on container ${id}`);
      return res.json(data);
    } catch (error: any) {
      logger.error(`[Admin IDE] Failed to execute action on container ${id}:`, error);

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message,
        },
      });
    }
  })
);

export default router;
