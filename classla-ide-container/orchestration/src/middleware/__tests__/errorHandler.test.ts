import { Request, Response, NextFunction } from "express";
import { errorHandler, AppError, createError } from "../errorHandler";
import { config } from "../../config/index";

describe("Error Handler Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      path: "/api/test",
      method: "GET",
    };

    mockResponse = {
      status: statusMock,
    };

    mockNext = jest.fn();

    // Spy on console.error to suppress error logs during tests
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("AppError handling", () => {
    it("should handle AppError with correct status code and message", () => {
      const error = new AppError(
        "CONTAINER_NOT_FOUND",
        "Container xyz not found",
        404
      );

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "CONTAINER_NOT_FOUND",
            message: "Container xyz not found",
          },
          timestamp: expect.any(String),
          path: "/api/test",
        })
      );
    });

    it("should include details in AppError response when provided", () => {
      const error = new AppError(
        "CONTAINER_START_FAILED",
        "Failed to start container",
        500,
        { originalError: "Docker daemon not responding" }
      );

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "CONTAINER_START_FAILED",
            message: "Failed to start container",
            details: { originalError: "Docker daemon not responding" },
          },
        })
      );
    });
  });

  describe("Generic Error handling", () => {
    it("should map 'not found' errors to 404", () => {
      const error = new Error("Container not found");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "CONTAINER_NOT_FOUND",
            message: expect.any(String),
          },
        })
      );
    });

    it("should map 'invalid' errors to 400", () => {
      const error = new Error("Invalid parameter provided");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should map 'unauthorized' errors to 401", () => {
      const error = new Error("Unauthorized access");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "AUTHENTICATION_FAILED",
            message: expect.any(String),
          },
        })
      );
    });

    it("should map 'resource limit' errors to 503", () => {
      const error = new Error("Resource limit exceeded");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "RESOURCE_LIMIT_EXCEEDED",
            message: expect.any(String),
          },
        })
      );
    });

    it("should default to 500 for unknown errors", () => {
      const error = new Error("Something went wrong");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: "INTERNAL_ERROR",
            message: expect.any(String),
          },
        })
      );
    });
  });

  describe("Error message sanitization", () => {
    it("should return actual error message in development mode", () => {
      // Save original NODE_ENV
      const originalEnv = config.nodeEnv;
      (config as any).nodeEnv = "development";

      const error = new Error("Detailed error message");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Detailed error message",
          }),
        })
      );

      // Restore original NODE_ENV
      (config as any).nodeEnv = originalEnv;
    });

    it("should return sanitized error message in production mode", () => {
      // Save original NODE_ENV
      const originalEnv = config.nodeEnv;
      (config as any).nodeEnv = "production";

      const error = new Error("Detailed internal error");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "An internal error occurred",
          }),
        })
      );

      // Restore original NODE_ENV
      (config as any).nodeEnv = originalEnv;
    });
  });

  describe("Error logging", () => {
    it("should log error with stack trace", () => {
      const error = new Error("Test error");
      const consoleErrorSpy = jest.spyOn(console, "error");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error occurred:",
        expect.objectContaining({
          code: expect.any(String),
          message: "Test error",
          path: "/api/test",
          method: "GET",
          timestamp: expect.any(String),
          stack: expect.any(String),
        })
      );
    });
  });

  describe("createError helper", () => {
    it("should create AppError with correct properties", () => {
      const error = createError("TEST_ERROR", "Test error message", 400, {
        detail: "test",
      });

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("TEST_ERROR");
      expect(error.message).toBe("Test error message");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ detail: "test" });
    });
  });
});
