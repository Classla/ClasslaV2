import { Request, Response, NextFunction } from "express";
import { notify5xxError } from "../services/discord";

/**
 * Response interceptor middleware that detects ANY 5xx response
 * (whether from the global error handler or inline res.status(500).json())
 * and fires a Discord alert.
 */
export function responseInterceptor(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.on("finish", () => {
    if (res.statusCode < 500) return;

    // Skip health endpoint to avoid noise
    if (req.originalUrl === "/health") return;

    // Fire-and-forget: Discord outage should never affect API
    notify5xxError({
      statusCode: res.statusCode,
      method: req.method,
      path: req.originalUrl,
      requestId: req.headers["x-request-id"] as string | undefined,
      userEmail: (req as any).user?.email,
    }).catch(() => {
      // Silently swallow — Discord notification failure is non-critical
    });
  });

  next();
}
