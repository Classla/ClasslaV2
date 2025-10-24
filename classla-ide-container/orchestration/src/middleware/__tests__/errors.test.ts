import {
  ErrorCodes,
  containerNotFound,
  invalidS3Bucket,
  invalidParameter,
  authenticationFailed,
  containerStartFailed,
  containerStopFailed,
  dockerError,
  resourceLimitExceeded,
  internalError,
} from "../errors";
import { AppError } from "../errorHandler";

describe("Error Codes and Helpers", () => {
  describe("ErrorCodes constants", () => {
    it("should define CONTAINER_NOT_FOUND with 404 status", () => {
      expect(ErrorCodes.CONTAINER_NOT_FOUND).toEqual({
        code: "CONTAINER_NOT_FOUND",
        statusCode: 404,
        message: "Container not found",
      });
    });

    it("should define INVALID_S3_BUCKET with 400 status", () => {
      expect(ErrorCodes.INVALID_S3_BUCKET).toEqual({
        code: "INVALID_S3_BUCKET",
        statusCode: 400,
        message: "Invalid S3 bucket configuration",
      });
    });

    it("should define AUTHENTICATION_FAILED with 401 status", () => {
      expect(ErrorCodes.AUTHENTICATION_FAILED).toEqual({
        code: "AUTHENTICATION_FAILED",
        statusCode: 401,
        message: "Authentication failed",
      });
    });

    it("should define CONTAINER_START_FAILED with 500 status", () => {
      expect(ErrorCodes.CONTAINER_START_FAILED).toEqual({
        code: "CONTAINER_START_FAILED",
        statusCode: 500,
        message: "Failed to start container",
      });
    });

    it("should define CONTAINER_STOP_FAILED with 500 status", () => {
      expect(ErrorCodes.CONTAINER_STOP_FAILED).toEqual({
        code: "CONTAINER_STOP_FAILED",
        statusCode: 500,
        message: "Failed to stop container",
      });
    });

    it("should define DOCKER_ERROR with 500 status", () => {
      expect(ErrorCodes.DOCKER_ERROR).toEqual({
        code: "DOCKER_ERROR",
        statusCode: 500,
        message: "Docker operation failed",
      });
    });

    it("should define INTERNAL_ERROR with 500 status", () => {
      expect(ErrorCodes.INTERNAL_ERROR).toEqual({
        code: "INTERNAL_ERROR",
        statusCode: 500,
        message: "An internal error occurred",
      });
    });

    it("should define RESOURCE_LIMIT_EXCEEDED with 503 status", () => {
      expect(ErrorCodes.RESOURCE_LIMIT_EXCEEDED).toEqual({
        code: "RESOURCE_LIMIT_EXCEEDED",
        statusCode: 503,
        message: "System resources exhausted",
      });
    });
  });

  describe("containerNotFound", () => {
    it("should create AppError with container ID in message", () => {
      const error = containerNotFound("abc123");

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("CONTAINER_NOT_FOUND");
      expect(error.message).toBe("Container with ID abc123 not found");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("invalidS3Bucket", () => {
    it("should create AppError with default message", () => {
      const error = invalidS3Bucket();

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INVALID_S3_BUCKET");
      expect(error.message).toBe("Invalid S3 bucket configuration");
      expect(error.statusCode).toBe(400);
    });

    it("should create AppError with custom message", () => {
      const error = invalidS3Bucket("Bucket name is required");

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe("Bucket name is required");
    });
  });

  describe("invalidParameter", () => {
    it("should create AppError with custom message", () => {
      const error = invalidParameter("limit must be positive");

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INVALID_PARAMETER");
      expect(error.message).toBe("limit must be positive");
      expect(error.statusCode).toBe(400);
    });
  });

  describe("authenticationFailed", () => {
    it("should create AppError with default message", () => {
      const error = authenticationFailed();

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("AUTHENTICATION_FAILED");
      expect(error.message).toBe("Authentication failed");
      expect(error.statusCode).toBe(401);
    });

    it("should create AppError with custom message", () => {
      const error = authenticationFailed("Invalid API key");

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe("Invalid API key");
    });
  });

  describe("containerStartFailed", () => {
    it("should create AppError with original error message", () => {
      const originalError = new Error("Docker daemon not responding");
      const error = containerStartFailed(originalError);

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("CONTAINER_START_FAILED");
      expect(error.message).toBe(
        "Failed to start container: Docker daemon not responding"
      );
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({
        originalError: "Docker daemon not responding",
      });
    });
  });

  describe("containerStopFailed", () => {
    it("should create AppError with original error message", () => {
      const originalError = new Error("Service not found");
      const error = containerStopFailed(originalError);

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("CONTAINER_STOP_FAILED");
      expect(error.message).toBe("Failed to stop container: Service not found");
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({
        originalError: "Service not found",
      });
    });
  });

  describe("dockerError", () => {
    it("should create AppError with original error message", () => {
      const originalError = new Error("Connection refused");
      const error = dockerError(originalError);

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("DOCKER_ERROR");
      expect(error.message).toBe("Docker operation failed: Connection refused");
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({
        originalError: "Connection refused",
      });
    });
  });

  describe("resourceLimitExceeded", () => {
    it("should create AppError with custom reason", () => {
      const error = resourceLimitExceeded("Memory usage at 95%");

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("RESOURCE_LIMIT_EXCEEDED");
      expect(error.message).toBe("Memory usage at 95%");
      expect(error.statusCode).toBe(503);
    });
  });

  describe("internalError", () => {
    it("should create AppError with generic message", () => {
      const originalError = new Error("Unexpected error");
      const error = internalError(originalError);

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("An internal error occurred");
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({
        originalError: "Unexpected error",
      });
    });
  });
});
