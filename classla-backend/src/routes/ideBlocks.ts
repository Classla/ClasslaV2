import express, { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();

// Types for IDE API responses
interface ContainerResponse {
  id: string;
  status: string;
  urls?: {
    ide?: string;
    [key: string]: string | undefined;
  };
  message?: string;
  error?: {
    message?: string;
    [key: string]: unknown;
  };
}

// IDE orchestration API base URL
const IDE_API_BASE_URL =
  process.env.IDE_API_BASE_URL || "https://ide.classla.org/api";

// IDE API key for authentication (default to test key for development)
const IDE_API_KEY = process.env.IDE_API_KEY || "test-api-key-12345";

/**
 * POST /api/ide-blocks/start-container
 * Forward container start request to ide.classla.org
 */
router.post(
  "/start-container",
  asyncHandler(async (req: Request, res: Response) => {
    const { s3Bucket, s3Region, userId } = req.body;

    if (!s3Bucket || typeof s3Bucket !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "s3Bucket is required and must be a string",
        },
      });
    }

    if (!s3Region || typeof s3Region !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "s3Region is required and must be a string",
        },
      });
    }

    try {
      // Forward request to IDE orchestration API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(`${IDE_API_BASE_URL}/containers/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        body: JSON.stringify({
          s3Bucket,
          s3Region,
          userId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as ContainerResponse;

      if (!response.ok) {
        return res.status(response.status || 500).json({
          error: {
            code: "CONTAINER_START_FAILED",
            message:
              data?.error?.message ||
              data?.message ||
              "Failed to start container",
            details: data,
          },
        });
      }

      // Return the container info
      return res.status(201).json({
        id: data.id,
        status: data.status,
        urls: data.urls,
        message: data.message || "Container is starting",
      });
    } catch (error: any) {
      console.error("Failed to start IDE container:", error);

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
 * GET /api/ide-blocks/container/:id
 * Check if container is still running
 */
router.get(
  "/container/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Container ID is required",
        },
      });
    }

    try {
      // Forward request to IDE orchestration API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(`${IDE_API_BASE_URL}/containers/${id}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // If container not found, return 404
      if (response.status === 404) {
        return res.status(404).json({
          error: {
            code: "CONTAINER_NOT_FOUND",
            message: "Container not found or no longer running",
          },
        });
      }

      if (!response.ok) {
        const data = (await response.json()) as ContainerResponse;
        return res.status(response.status || 500).json({
          error: {
            code: "CONTAINER_CHECK_FAILED",
            message:
              data?.error?.message ||
              data?.message ||
              "Failed to check container status",
            details: data,
          },
        });
      }

      const data = (await response.json()) as ContainerResponse;

      // Return the container info
      return res.json({
        id: data.id,
        status: data.status,
        urls: data.urls,
      });
    } catch (error: any) {
      console.error("Failed to check container status:", error);

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

