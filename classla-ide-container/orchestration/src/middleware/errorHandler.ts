import { Request, Response, NextFunction } from "express";
import { config } from "../config/index";

/**
 * Custom error class for application-specific errors
 */
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
  path: string;
}

/**
 * Map error types to HTTP status codes
 */
function getStatusCode(error: Error | AppError): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  // Map common error patterns to status codes
  const message = error.message.toLowerCase();

  if (message.includes("not found")) {
    return 404;
  }

  if (
    message.includes("invalid") ||
    message.includes("required") ||
    message.includes("must be")
  ) {
    return 400;
  }

  if (message.includes("unauthorized") || message.includes("authentication")) {
    return 401;
  }

  if (message.includes("forbidden") || message.includes("permission")) {
    return 403;
  }

  if (
    message.includes("resource limit") ||
    message.includes("exhausted") ||
    message.includes("unavailable")
  ) {
    return 503;
  }

  // Default to 500 for unknown errors
  return 500;
}

/**
 * Get error code from error
 */
function getErrorCode(error: Error | AppError): string {
  if (error instanceof AppError) {
    return error.code;
  }

  // Map common error patterns to error codes
  const message = error.message.toLowerCase();

  if (message.includes("container") && message.includes("not found")) {
    return "CONTAINER_NOT_FOUND";
  }

  if (message.includes("container") && message.includes("start")) {
    return "CONTAINER_START_FAILED";
  }

  if (message.includes("container") && message.includes("stop")) {
    return "CONTAINER_STOP_FAILED";
  }

  if (message.includes("resource limit") || message.includes("exhausted")) {
    return "RESOURCE_LIMIT_EXCEEDED";
  }

  if (message.includes("s3") || message.includes("bucket")) {
    return "INVALID_S3_BUCKET";
  }

  if (message.includes("docker")) {
    return "DOCKER_ERROR";
  }

  if (message.includes("authentication") || message.includes("unauthorized")) {
    return "AUTHENTICATION_FAILED";
  }

  return "INTERNAL_ERROR";
}

/**
 * Sanitize error message for production
 */
function sanitizeErrorMessage(error: Error | AppError): string {
  if (error instanceof AppError) {
    return error.message;
  }

  // In production, return generic messages for security
  if (config.nodeEnv === "production") {
    const statusCode = getStatusCode(error);

    switch (statusCode) {
      case 400:
        return "Invalid request parameters";
      case 401:
        return "Authentication failed";
      case 403:
        return "Access forbidden";
      case 404:
        return "Resource not found";
      case 503:
        return "Service temporarily unavailable";
      default:
        return "An internal error occurred";
    }
  }

  // In development, return the actual error message
  return error.message;
}

/**
 * Centralized error handler middleware
 *
 * This middleware handles all errors thrown in the application:
 * - Logs errors with stack traces
 * - Maps error types to appropriate HTTP status codes
 * - Returns sanitized error messages to clients
 * - Provides detailed error information in development mode
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error with stack trace
  console.error("Error occurred:", {
    code: getErrorCode(err),
    message: err.message,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    stack: err.stack,
  });

  // Get status code
  const statusCode = getStatusCode(err);

  // Build error response
  const errorResponse: ErrorResponse = {
    error: {
      code: getErrorCode(err),
      message: sanitizeErrorMessage(err),
      ...(err instanceof AppError && err.details
        ? { details: err.details }
        : {}),
    },
    timestamp: new Date().toISOString(),
    path: req.path,
  };

  // Send error response
  res.status(statusCode).json(errorResponse);
}

/**
 * Helper function to create AppError instances
 */
export function createError(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown
): AppError {
  return new AppError(code, message, statusCode, details);
}
