import { Router, Request, Response, NextFunction } from "express";
import { loadTestService } from "../services/serviceInstances";
import { invalidParameter } from "../middleware/errors";

const router = Router();

/**
 * POST /api/loadtest/start
 * Start a new load test
 */
router.post(
  "/start",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { numContainers, testCode, mainFile, spawnBatchSize, executionTimeout } =
        req.body;

      // Validate required fields
      if (!numContainers || typeof numContainers !== "number") {
        throw invalidParameter("numContainers must be a number");
      }

      if (numContainers < 1) {
        throw invalidParameter("numContainers must be at least 1");
      }

      if (!testCode || typeof testCode !== "string") {
        throw invalidParameter("testCode is required and must be a string");
      }

      const config = {
        numContainers,
        testCode,
        mainFile: mainFile || "main.py",
        spawnBatchSize: spawnBatchSize || 3,
        executionTimeout: executionTimeout || 60,
      };

      console.log(`[LoadTest API] Starting load test with config:`, {
        numContainers: config.numContainers,
        mainFile: config.mainFile,
        spawnBatchSize: config.spawnBatchSize,
        executionTimeout: config.executionTimeout,
        testCodeLength: config.testCode.length,
      });

      const testId = await loadTestService.startLoadTest(config);

      res.json({
        testId,
        status: "running",
        message: `Load test started with ${numContainers} containers`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/loadtest/:testId
 * Stop a running load test
 */
router.delete(
  "/:testId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { testId } = req.params;

      if (!testId || typeof testId !== "string") {
        throw invalidParameter("testId is required");
      }

      if (!loadTestService.hasTest(testId)) {
        res.status(404).json({
          error: {
            code: "TEST_NOT_FOUND",
            message: `Load test ${testId} not found`,
          },
        });
        return;
      }

      console.log(`[LoadTest API] Stopping load test ${testId}`);

      await loadTestService.stopLoadTest(testId);

      res.json({
        testId,
        status: "stopped",
        message: "Load test stopped and containers cleaned up",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/loadtest/:testId/stream
 * Stream load test metrics via SSE (Server-Sent Events)
 */
router.get(
  "/:testId/stream",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { testId } = req.params;

      if (!testId || typeof testId !== "string") {
        throw invalidParameter("testId is required");
      }

      if (!loadTestService.hasTest(testId)) {
        res.status(404).json({
          error: {
            code: "TEST_NOT_FOUND",
            message: `Load test ${testId} not found`,
          },
        });
        return;
      }

      console.log(`[LoadTest API] Opening SSE stream for test ${testId}`);

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: "connected", testId })}\n\n`);

      // Send current metrics immediately
      const currentMetrics = loadTestService.getMetrics(testId);
      if (currentMetrics) {
        const metricsData = {
          type: "metrics",
          metrics: {
            ...currentMetrics,
            startTime: currentMetrics.startTime.toISOString(),
            endTime: currentMetrics.endTime?.toISOString(),
            containers: currentMetrics.containers.map((c) => ({
              ...c,
              startedAt: c.startedAt?.toISOString(),
              completedAt: c.completedAt?.toISOString(),
            })),
          },
        };
        res.write(`data: ${JSON.stringify(metricsData)}\n\n`);
      }

      // Listen for metrics updates
      const metricsHandler = (eventTestId: string, metrics: any) => {
        if (eventTestId !== testId) return;

        const metricsData = {
          type: "metrics",
          metrics: {
            ...metrics,
            startTime:
              metrics.startTime instanceof Date
                ? metrics.startTime.toISOString()
                : metrics.startTime,
            endTime:
              metrics.endTime instanceof Date
                ? metrics.endTime.toISOString()
                : metrics.endTime,
            containers: metrics.containers.map((c: any) => ({
              ...c,
              startedAt:
                c.startedAt instanceof Date
                  ? c.startedAt.toISOString()
                  : c.startedAt,
              completedAt:
                c.completedAt instanceof Date
                  ? c.completedAt.toISOString()
                  : c.completedAt,
            })),
          },
        };

        res.write(`data: ${JSON.stringify(metricsData)}\n\n`);

        // Close stream if test is complete
        if (
          metrics.status === "completed" ||
          metrics.status === "stopped" ||
          metrics.status === "error"
        ) {
          setTimeout(() => {
            res.write(`data: ${JSON.stringify({ type: "end" })}\n\n`);
            res.end();
          }, 1000);
        }
      };

      loadTestService.on("metrics", metricsHandler);

      // Clean up on client disconnect
      req.on("close", () => {
        console.log(`[LoadTest API] SSE client disconnected for test ${testId}`);
        loadTestService.off("metrics", metricsHandler);
      });

      // Keep connection alive with heartbeat
      const heartbeatInterval = setInterval(() => {
        res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeatInterval);
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/loadtest/:testId
 * Get current metrics for a load test
 */
router.get(
  "/:testId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { testId } = req.params;

      if (!testId || typeof testId !== "string") {
        throw invalidParameter("testId is required");
      }

      const metrics = loadTestService.getMetrics(testId);

      if (!metrics) {
        res.status(404).json({
          error: {
            code: "TEST_NOT_FOUND",
            message: `Load test ${testId} not found`,
          },
        });
        return;
      }

      res.json({
        ...metrics,
        startTime: metrics.startTime.toISOString(),
        endTime: metrics.endTime?.toISOString(),
        containers: metrics.containers.map((c) => ({
          ...c,
          startedAt: c.startedAt?.toISOString(),
          completedAt: c.completedAt?.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
