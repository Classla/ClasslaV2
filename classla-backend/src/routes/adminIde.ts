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
    // When running with Docker Swarm locally, orchestration is accessible via Traefik at localhost:80
    // Traefik strips the /api prefix, so we need /api/api to reach the server's /api routes
    return "http://localhost/api/api";
  }

  // In development, connect to orchestration via Traefik (port 80)
  // Traefik strips /api prefix, so we need /api/api to reach the server's /api routes
  if (process.env.NODE_ENV === "development" && !process.env.IDE_API_BASE_URL) {
    return "http://localhost/api/api";
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

/**
 * POST /api/admin/ide/loadtest/start
 * Start a new load test
 */
router.post(
  "/loadtest/start",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ideApiBaseUrl = getIDEApiBaseUrl(req);
    const { numContainers, testCode, mainFile, spawnBatchSize, executionTimeout } = req.body;

    // Validate required fields
    if (!numContainers || numContainers < 1) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "numContainers must be at least 1",
        },
      });
    }

    if (!testCode || typeof testCode !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "testCode is required",
        },
      });
    }

    try {
      logger.info(`[Admin IDE] Starting load test with ${numContainers} containers`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ideApiBaseUrl}/loadtest/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        body: JSON.stringify({
          numContainers,
          testCode,
          mainFile: mainFile || "main.py",
          spawnBatchSize: spawnBatchSize || 3,
          executionTimeout: executionTimeout || 60,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Load test start failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to start load test",
            details: errorText,
          },
        });
      }

      const data = await response.json() as { testId: string };
      logger.info(`[Admin IDE] Load test started: ${data.testId}`);
      return res.json(data);
    } catch (error: any) {
      logger.error("[Admin IDE] Failed to start load test:", error);

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
 * DELETE /api/admin/ide/loadtest/:testId
 * Stop a running load test
 */
router.delete(
  "/loadtest/:testId",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { testId } = req.params;
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    if (!testId || typeof testId !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Test ID is required",
        },
      });
    }

    try {
      logger.info(`[Admin IDE] Stopping load test ${testId}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // Longer timeout for cleanup

      const response = await fetch(`${ideApiBaseUrl}/loadtest/${testId}`, {
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
            code: "TEST_NOT_FOUND",
            message: "Load test not found",
          },
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Load test stop failed: ${response.status}`, { errorText });
        return res.status(response.status).json({
          error: {
            code: "IDE_SERVICE_ERROR",
            message: "Failed to stop load test",
            details: errorText,
          },
        });
      }

      const data = await response.json();
      logger.info(`[Admin IDE] Load test ${testId} stopped`);
      return res.json(data);
    } catch (error: any) {
      logger.error(`[Admin IDE] Failed to stop load test ${testId}:`, error);

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
 * GET /api/admin/ide/loadtest/:testId/stream
 * Stream load test metrics via SSE (Server-Sent Events)
 */
router.get(
  "/loadtest/:testId/stream",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { testId } = req.params;
    const ideApiBaseUrl = getIDEApiBaseUrl(req);

    if (!testId || typeof testId !== "string") {
      res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Test ID is required",
        },
      });
      return;
    }

    logger.info(`[Admin IDE] Opening SSE stream for load test ${testId}`);

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    try {
      // Proxy the SSE connection to the IDE orchestration service
      const response = await fetch(`${ideApiBaseUrl}/loadtest/${testId}/stream`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
          Accept: "text/event-stream",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[Admin IDE] Load test stream failed: ${response.status}`, { errorText });
        res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to connect to load test stream" })}\n\n`);
        res.end();
        return;
      }

      // Pipe the response body to the client
      const reader = response.body?.getReader();
      if (!reader) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "No response body" })}\n\n`);
        res.end();
        return;
      }

      const decoder = new TextDecoder();

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            res.write(decoder.decode(value));
          }
        } catch (error) {
          logger.error(`[Admin IDE] SSE stream error:`, error);
          res.end();
        }
      };

      // Handle client disconnect
      req.on("close", () => {
        logger.info(`[Admin IDE] SSE client disconnected for load test ${testId}`);
        reader.cancel();
      });

      await pump();
    } catch (error: any) {
      logger.error(`[Admin IDE] Failed to open SSE stream for load test ${testId}:`, error);
      res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      res.end();
    }
  })
);

export default router;
