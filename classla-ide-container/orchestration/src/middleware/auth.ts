import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import config from "../config/index";
import { authenticationFailed } from "./errors.js";

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Load and hash API keys from environment variables
 * Supports multiple API keys separated by commas
 */
function loadApiKeys(): Set<string> {
  const apiKeyString = config.apiKey;
  const apiKeys = apiKeyString.split(",").map((key) => key.trim());

  // Hash all API keys
  const hashedKeys = new Set<string>();
  for (const key of apiKeys) {
    if (key) {
      hashedKeys.add(hashApiKey(key));
    }
  }

  return hashedKeys;
}

// Load hashed API keys at startup
const validApiKeys = loadApiKeys();

/**
 * Authentication middleware
 * Validates API key from Authorization header
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    // Check if Authorization header is present
    if (!authHeader) {
      throw authenticationFailed("Missing Authorization header");
    }

    // Extract API key from header
    // Support both "Bearer <key>" and plain "<key>" formats
    let apiKey: string;
    if (authHeader.startsWith("Bearer ")) {
      apiKey = authHeader.substring(7);
    } else {
      apiKey = authHeader;
    }

    // Hash the provided API key
    const hashedProvidedKey = hashApiKey(apiKey);

    // Validate API key
    if (!validApiKeys.has(hashedProvidedKey)) {
      throw authenticationFailed("Invalid API key");
    }

    // Store hashed API key in request for rate limiting
    (req as any).apiKey = hashedProvidedKey;

    // API key is valid, proceed to next middleware
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Export for testing purposes
 */
export function getValidApiKeysCount(): number {
  return validApiKeys.size;
}
