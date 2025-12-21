import { AppError } from "./errorHandler";

/**
 * Error codes and their corresponding HTTP status codes
 */
export const ErrorCodes = {
  // 404 errors
  CONTAINER_NOT_FOUND: {
    code: "CONTAINER_NOT_FOUND",
    statusCode: 404,
    message: "Container not found",
  },

  // 400 errors
  INVALID_S3_BUCKET: {
    code: "INVALID_S3_BUCKET",
    statusCode: 400,
    message: "Invalid S3 bucket configuration",
  },
  INVALID_PARAMETER: {
    code: "INVALID_PARAMETER",
    statusCode: 400,
    message: "Invalid request parameter",
  },

  // 401 errors
  AUTHENTICATION_FAILED: {
    code: "AUTHENTICATION_FAILED",
    statusCode: 401,
    message: "Authentication failed",
  },

  // 500 errors
  CONTAINER_START_FAILED: {
    code: "CONTAINER_START_FAILED",
    statusCode: 500,
    message: "Failed to start container",
  },
  CONTAINER_STOP_FAILED: {
    code: "CONTAINER_STOP_FAILED",
    statusCode: 500,
    message: "Failed to stop container",
  },
  DOCKER_ERROR: {
    code: "DOCKER_ERROR",
    statusCode: 500,
    message: "Docker operation failed",
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    message: "An internal error occurred",
  },

  // 503 errors
  RESOURCE_LIMIT_EXCEEDED: {
    code: "RESOURCE_LIMIT_EXCEEDED",
    statusCode: 503,
    message: "System resources exhausted",
  },
} as const;

/**
 * Helper functions to create specific error types
 */

export function containerNotFound(containerId: string): AppError {
  return new AppError(
    ErrorCodes.CONTAINER_NOT_FOUND.code,
    `Container with ID ${containerId} not found`,
    ErrorCodes.CONTAINER_NOT_FOUND.statusCode
  );
}

export function invalidS3Bucket(message?: string): AppError {
  return new AppError(
    ErrorCodes.INVALID_S3_BUCKET.code,
    message || ErrorCodes.INVALID_S3_BUCKET.message,
    ErrorCodes.INVALID_S3_BUCKET.statusCode
  );
}

export function invalidParameter(message: string): AppError {
  return new AppError(
    ErrorCodes.INVALID_PARAMETER.code,
    message,
    ErrorCodes.INVALID_PARAMETER.statusCode
  );
}

export function authenticationFailed(message?: string): AppError {
  return new AppError(
    ErrorCodes.AUTHENTICATION_FAILED.code,
    message || ErrorCodes.AUTHENTICATION_FAILED.message,
    ErrorCodes.AUTHENTICATION_FAILED.statusCode
  );
}

export function containerStartFailed(error: Error): AppError {
  return new AppError(
    ErrorCodes.CONTAINER_START_FAILED.code,
    `Failed to start container: ${error.message}`,
    ErrorCodes.CONTAINER_START_FAILED.statusCode,
    { originalError: error.message }
  );
}

export function containerStopFailed(error: Error): AppError {
  return new AppError(
    ErrorCodes.CONTAINER_STOP_FAILED.code,
    `Failed to stop container: ${error.message}`,
    ErrorCodes.CONTAINER_STOP_FAILED.statusCode,
    { originalError: error.message }
  );
}

export function dockerError(error: Error): AppError {
  return new AppError(
    ErrorCodes.DOCKER_ERROR.code,
    `Docker operation failed: ${error.message}`,
    ErrorCodes.DOCKER_ERROR.statusCode,
    { originalError: error.message }
  );
}

export function resourceLimitExceeded(reason: string): AppError {
  return new AppError(
    ErrorCodes.RESOURCE_LIMIT_EXCEEDED.code,
    reason,
    ErrorCodes.RESOURCE_LIMIT_EXCEEDED.statusCode
  );
}

export function internalError(error: Error): AppError {
  return new AppError(
    ErrorCodes.INTERNAL_ERROR.code,
    ErrorCodes.INTERNAL_ERROR.message,
    ErrorCodes.INTERNAL_ERROR.statusCode,
    { originalError: error.message }
  );
}
