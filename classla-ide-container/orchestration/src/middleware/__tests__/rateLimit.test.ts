/**
 * Tests for rate limiting middleware
 */

import { Request, Response, NextFunction } from "express";
import {
  rateLimitMiddleware,
  getRateLimitStatus,
  resetRateLimit,
  clearRateLimitStore,
} from "../rateLimit";

describe("Rate Limiting Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let statusCode: number;
  let responseData: any;
  let headers: Record<string, string>;

  beforeEach(() => {
    // Clear rate limit store before each test
    clearRateLimitStore();

    statusCode = 200;
    responseData = null;
    headers = {};

    mockReq = {
      ip: "127.0.0.1",
      path: "/api/test",
      method: "GET",
    };

    mockRes = {
      status: jest.fn().mockImplementation((code: number) => {
        statusCode = code;
        return mockRes;
      }),
      json: jest.fn().mockImplementation((data: any) => {
        responseData = data;
        return mockRes;
      }),
      setHeader: jest.fn().mockImplementation((name: string, value: string) => {
        headers[name] = value;
        return mockRes;
      }),
    } as Partial<Response>;

    mockNext = jest.fn();
  });

  afterEach(() => {
    clearRateLimitStore();
  });

  afterAll(() => {
    // Stop cleanup interval to allow Jest to exit
    const { stopCleanupInterval } = require("../rateLimit");
    stopCleanupInterval();
  });

  describe("Basic Rate Limiting", () => {
    it("should allow requests within rate limit", () => {
      (mockReq as any).apiKey = "test-api-key";

      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusCode).toBe(200);
    });

    it("should set rate limit headers on successful request", () => {
      (mockReq as any).apiKey = "test-api-key";

      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("99");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });

    it("should skip rate limiting if no API key", () => {
      // No API key set
      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusCode).toBe(200);
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should block requests after exceeding rate limit", () => {
      (mockReq as any).apiKey = "test-api-key";

      // Make 100 requests (at the limit)
      for (let i = 0; i < 100; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // 101st request should be blocked
      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseData.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("should return 429 with proper error message", () => {
      (mockReq as any).apiKey = "test-api-key";

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(statusCode).toBe(429);
      expect(responseData.error.message).toBe(
        "Too many requests. Please try again later."
      );
      expect(responseData.error.retryAfter).toBeDefined();
      expect(responseData.error.resetTime).toBeDefined();
    });

    it("should set Retry-After header when rate limited", () => {
      (mockReq as any).apiKey = "test-api-key";

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(headers["Retry-After"]).toBeDefined();
      expect(parseInt(headers["Retry-After"])).toBeGreaterThan(0);
    });

    it("should set rate limit headers to 0 remaining when exceeded", () => {
      (mockReq as any).apiKey = "test-api-key";

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(headers["X-RateLimit-Remaining"]).toBe("0");
    });
  });

  describe("Per-API-Key Rate Limiting", () => {
    it("should track rate limits separately per API key", () => {
      (mockReq as any).apiKey = "api-key-1";

      // Make 50 requests with first API key
      for (let i = 0; i < 50; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // Switch to second API key
      (mockReq as any).apiKey = "api-key-2";

      // Should still be able to make requests
      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusCode).toBe(200);
    });

    it("should not affect other API keys when one is rate limited", () => {
      (mockReq as any).apiKey = "api-key-1";

      // Exceed rate limit for first API key
      for (let i = 0; i < 101; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(statusCode).toBe(429);

      // Reset for second API key test
      statusCode = 200;
      mockNext = jest.fn();

      // Switch to second API key
      (mockReq as any).apiKey = "api-key-2";

      // Should still be able to make requests
      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusCode).toBe(200);
    });
  });

  describe("Rate Limit Window Reset", () => {
    it("should reset counter after window expires", async () => {
      (mockReq as any).apiKey = "test-api-key";

      // Make 100 requests
      for (let i = 0; i < 100; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // Manually reset the rate limit (simulating window expiration)
      resetRateLimit("test-api-key");

      // Should be able to make requests again
      rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusCode).toBe(200);
    });
  });

  describe("Rate Limit Status", () => {
    it("should return correct rate limit status", () => {
      const apiKey = "test-api-key";
      (mockReq as any).apiKey = apiKey;

      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      const status = getRateLimitStatus(apiKey);
      expect(status.count).toBe(10);
      expect(status.limit).toBe(100);
      expect(status.remaining).toBe(90);
      expect(status.resetTime).toBeDefined();
    });

    it("should return zero count for unused API key", () => {
      const status = getRateLimitStatus("unused-api-key");
      expect(status.count).toBe(0);
      expect(status.limit).toBe(100);
      expect(status.remaining).toBe(100);
      expect(status.resetTime).toBeNull();
    });
  });

  describe("Logging", () => {
    it("should log rate limit violations", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      (mockReq as any).apiKey = "test-api-key";

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rate limit exceeded"),
        expect.objectContaining({
          count: 101,
          limit: 100,
        })
      );

      consoleSpy.mockRestore();
    });
  });
});
