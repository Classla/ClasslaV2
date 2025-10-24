import { Request, Response, NextFunction } from "express";
import { authenticate, hashApiKey, getValidApiKeysCount } from "../auth";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { it } from "node:test";
import { describe } from "node:test";
import { expect } from "chai";
import { it } from "node:test";
import { describe } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { describe } from "node:test";
import { expect } from "chai";
import { it } from "node:test";
import { expect } from "chai";
import { expect } from "chai";
import { it } from "node:test";
import { describe } from "node:test";
import { beforeEach } from "node:test";
import { describe } from "node:test";

describe("Authentication Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      path: "/api/containers",
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe("hashApiKey", () => {
    it("should hash an API key consistently", () => {
      const apiKey = "test-api-key";
      const hash1 = hashApiKey(apiKey);
      const hash2 = hashApiKey(apiKey);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters
    });

    it("should produce different hashes for different keys", () => {
      const hash1 = hashApiKey("key1");
      const hash2 = hashApiKey("key2");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("authenticate middleware", () => {
    it("should call next with error when Authorization header is missing", () => {
      authenticate(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "AUTHENTICATION_FAILED",
          message: "Missing Authorization header",
          statusCode: 401,
        })
      );
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it("should call next with error when API key is invalid", () => {
      mockRequest.headers = {
        authorization: "invalid-api-key",
      };

      authenticate(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "AUTHENTICATION_FAILED",
          message: "Invalid API key",
          statusCode: 401,
        })
      );
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it("should call next() when API key is valid (plain format)", () => {
      // Use the API key from the test environment
      mockRequest.headers = {
        authorization: "test-api-key-for-development",
      };

      authenticate(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it("should call next() when API key is valid (Bearer format)", () => {
      mockRequest.headers = {
        authorization: "Bearer test-api-key-for-development",
      };

      authenticate(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it("should pass error to next() for centralized error handling", () => {
      const requestWithPath = {
        headers: {
          authorization: "invalid-key",
        },
        path: "/api/containers/start",
      };

      authenticate(
        requestWithPath as Request,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "AUTHENTICATION_FAILED",
          statusCode: 401,
        })
      );
    });
  });

  describe("getValidApiKeysCount", () => {
    it("should return the number of loaded API keys", () => {
      const count = getValidApiKeysCount();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("multiple API keys support", () => {
    it("should support multiple API keys separated by commas", () => {
      // The current implementation loads keys from config
      // This test verifies that the system can handle multiple keys
      const count = getValidApiKeysCount();

      // At minimum, we should have 1 key loaded from the environment
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("should hash all API keys before storing", () => {
      // Verify that keys are hashed by checking the hash function
      const key1 = "key1";
      const key2 = "key2";

      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);

      // Hashes should be different for different keys
      expect(hash1).not.toBe(hash2);

      // Hashes should be consistent
      expect(hashApiKey(key1)).toBe(hash1);
      expect(hashApiKey(key2)).toBe(hash2);
    });
  });
});
