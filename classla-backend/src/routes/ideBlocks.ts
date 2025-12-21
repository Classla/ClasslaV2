import express, { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();

// Types for IDE API responses
interface ContainerResponse {
  id: string;
  status: string;
  urls?: {
    ide?: string;
    codeServer?: string;
    vnc?: string;
    webServer?: string;
    [key: string]: string | undefined;
  };
  message?: string;
  isPreWarmed?: boolean;
  error?: {
    message?: string;
    [key: string]: unknown;
  };
}

// IDE orchestration API base URL
// Can be overridden by X-IDE-Environment header (local/production)
const getIDEApiBaseUrl = (req: Request): string => {
  // Check for X-IDE-Environment header (set by frontend when toggling local mode)
  const ideEnvironment = req.headers["x-ide-environment"];
  if (ideEnvironment === "local") {
    // Use localhost (resolves to IPv6 ::1 on macOS, which Traefik listens on)
    // If IPv4 is needed, use 127.0.0.1, but Traefik must be configured to listen on IPv4
    return "http://localhost/api";
  }
  // Use environment variable or default to production
  return process.env.IDE_API_BASE_URL || "https://ide.classla.org/api";
};

// IDE API key for authentication (default to test key for development)
const IDE_API_KEY = process.env.IDE_API_KEY || "test-api-key-12345";

// AWS credentials for S3 bucket validation (used when forwarding to IDE orchestration service)
const getAWSCredentials = () => {
  // Get from environment variables (for local development)
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  if (accessKeyId && secretAccessKey) {
    return { awsAccessKeyId: accessKeyId, awsSecretAccessKey: secretAccessKey };
  }
  
  return null;
};

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

    // Forward request to IDE orchestration API
    // Declare outside try block so it's accessible in catch block
    let ideApiBaseUrl: string = getIDEApiBaseUrl(req);
    try {
      console.log(`[IDE Blocks] Using IDE API: ${ideApiBaseUrl} (environment: ${req.headers["x-ide-environment"] || "production"})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      // Get AWS credentials to pass to IDE orchestration service
      const awsCredentials = getAWSCredentials();
      
      const requestBody: any = {
        s3Bucket,
        s3Region,
        userId,
      };
      
      // Add AWS credentials if available (needed for S3 bucket validation)
      if (awsCredentials) {
        requestBody.awsAccessKeyId = awsCredentials.awsAccessKeyId;
        requestBody.awsSecretAccessKey = awsCredentials.awsSecretAccessKey;
      }
      
      const response = await fetch(`${ideApiBaseUrl}/containers/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response body - handle both success and error responses
      let data: ContainerResponse;
      try {
        data = (await response.json()) as ContainerResponse;
      } catch (parseError) {
        // If JSON parsing fails, create a basic error response
        console.error("Failed to parse IDE orchestration service response:", parseError);
        return res.status(503).json({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "IDE orchestration service returned invalid response",
            details: parseError instanceof Error ? parseError.message : String(parseError),
          },
        });
      }

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
        isPreWarmed: data.isPreWarmed || false, // Pass through isPreWarmed flag
      });
    } catch (error: any) {
      console.error("Failed to start IDE container:", error);
      console.error("Error details:", {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause,
        ideApiBaseUrl: ideApiBaseUrl || "not set",
      });

      if (error.name === "AbortError") {
        return res.status(504).json({
          error: {
            code: "REQUEST_TIMEOUT",
            message: "Request to IDE orchestration service timed out",
          },
        });
      }

      // Check if it's a network error (ECONNREFUSED, ENOTFOUND, etc.)
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.message?.includes("fetch failed")) {
        return res.status(503).json({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: `IDE orchestration service is unavailable at ${ideApiBaseUrl || "unknown URL"}. Please ensure the service is running.`,
            details: error.message || String(error),
          },
        });
      }

      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "IDE orchestration service is unavailable",
          details: error.message || String(error),
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
      const ideApiBaseUrl = getIDEApiBaseUrl(req);
      const fetchUrl = `${ideApiBaseUrl}/containers/${id}`;
      console.log(`[IDE Blocks] Checking container status using IDE API: ${ideApiBaseUrl} (environment: ${req.headers["x-ide-environment"] || "production"})`);
      console.log(`[IDE Blocks] Fetching: ${fetchUrl}`);
      console.log(`[IDE Blocks] Container ID: ${id}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${IDE_API_KEY}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(`[IDE Blocks] Response status: ${response.status} for container ${id}`);
      console.log(`[IDE Blocks] Response OK: ${response.ok}`);

      // If container not found, return 404
      if (response.status === 404) {
        console.log(`[IDE Blocks] Container ${id} not found (404) - checking if it exists in state manager`);
        // Try to get response body for more info
        try {
          const errorBody = await response.text();
          console.log(`[IDE Blocks] 404 response body: ${errorBody}`);
        } catch (e) {
          console.log(`[IDE Blocks] Could not read 404 response body: ${e}`);
        }
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

      let data: ContainerResponse;
      try {
        const responseText = await response.text();
        console.log(`[IDE Blocks] Response text for container ${id} (first 200 chars):`, responseText.substring(0, 200));
        try {
          data = JSON.parse(responseText) as ContainerResponse;
        } catch (parseError) {
          console.error(`[IDE Blocks] Failed to parse JSON for container ${id}:`, parseError);
          console.error(`[IDE Blocks] Full response text:`, responseText);
          return res.status(503).json({
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "IDE orchestration service returned invalid JSON",
              details: parseError instanceof Error ? parseError.message : String(parseError),
            },
          });
        }
      } catch (readError) {
        console.error(`[IDE Blocks] Failed to read response for container ${id}:`, readError);
        return res.status(503).json({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "IDE orchestration service returned invalid response",
            details: readError instanceof Error ? readError.message : String(readError),
          },
        });
      }

      console.log(`[IDE Blocks] Container ${id} data parsed:`, { id: data.id, status: data.status, hasUrls: !!data.urls, urlKeys: data.urls ? Object.keys(data.urls) : [] });

      // Validate required fields
      if (!data.id || !data.status) {
        console.error(`[IDE Blocks] Container ${id} response missing required fields:`, data);
        return res.status(503).json({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "IDE orchestration service returned incomplete container data",
            details: data,
          },
        });
      }

      // Return the container info (even if stopped - frontend will handle it)
      const responseData = {
        id: data.id,
        status: data.status,
        urls: data.urls,
        // Include additional fields if present (including isPreWarmed)
        ...(data.message && { message: data.message }),
        ...((data as any).isPreWarmed !== undefined && { isPreWarmed: (data as any).isPreWarmed }),
      };
      
      console.log(`[IDE Blocks] Returning container ${id} to frontend:`, { id: responseData.id, status: responseData.status, hasUrls: !!responseData.urls });
      return res.json(responseData);
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

