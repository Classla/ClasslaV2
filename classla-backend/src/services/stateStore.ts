import { createClient } from 'redis';
import { logger } from '../utils/logger';

// Redis client for storing OAuth state temporarily
let redisClient: ReturnType<typeof createClient> | null = null;

// Initialize Redis client if REDIS_URL is provided
if (process.env.REDIS_URL) {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    redisClient.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    // Connect to Redis (non-blocking)
    redisClient.connect().catch((err) => {
      logger.warn('Failed to connect to Redis', { error: err.message });
      redisClient = null;
    });
  } catch (error) {
    logger.warn('Failed to initialize Redis client', { error: error instanceof Error ? error.message : 'Unknown error' });
    redisClient = null;
  }
}

// In-memory fallback store for when Redis is not available
const memoryStore = new Map<string, { state: string; expiresAt: number }>();

// Clean up expired entries from memory store every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt < now) {
      memoryStore.delete(key);
    }
  }
}, 60000); // Run every minute

/**
 * Store OAuth state for validation during callback
 * @param state The state token to store
 * @param ttl Time to live in seconds (default: 10 minutes)
 * @returns Promise that resolves when state is stored
 */
export async function storeOAuthState(state: string, ttl: number = 600): Promise<void> {
  const key = `oauth:state:${state}`;
  const expiresAt = Date.now() + ttl * 1000;

  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.setEx(key, ttl, '1');
      logger.debug('OAuth state stored in Redis', { state, ttl });
    } catch (error) {
      logger.warn('Failed to store state in Redis, using memory store', { error: error instanceof Error ? error.message : 'Unknown error' });
      // Fallback to memory store
      memoryStore.set(key, { state, expiresAt });
    }
  } else {
    // Use memory store as fallback
    memoryStore.set(key, { state, expiresAt });
    logger.debug('OAuth state stored in memory', { state, ttl });
  }
}

/**
 * Validate and consume OAuth state
 * @param state The state token to validate
 * @returns Promise that resolves to true if state is valid, false otherwise
 */
export async function validateOAuthState(state: string): Promise<boolean> {
  const key = `oauth:state:${state}`;

  if (redisClient && redisClient.isOpen) {
    try {
      const exists = await redisClient.exists(key);
      if (exists) {
        // Delete the state after validation (one-time use)
        await redisClient.del(key);
        logger.debug('OAuth state validated and consumed from Redis', { state });
        return true;
      }
      logger.warn('OAuth state not found in Redis', { state });
      return false;
    } catch (error) {
      logger.warn('Failed to validate state in Redis, checking memory store', { error: error instanceof Error ? error.message : 'Unknown error' });
      // Fallback to memory store
      return validateFromMemory(key);
    }
  } else {
    // Use memory store as fallback
    return validateFromMemory(key);
  }
}

/**
 * Validate state from memory store
 */
function validateFromMemory(key: string): boolean {
  const stored = memoryStore.get(key);
  if (!stored) {
    logger.warn('OAuth state not found in memory store', { key });
    return false;
  }

  // Check if expired
  if (stored.expiresAt < Date.now()) {
    memoryStore.delete(key);
    logger.warn('OAuth state expired in memory store', { key });
    return false;
  }

  // Delete after validation (one-time use)
  memoryStore.delete(key);
  logger.debug('OAuth state validated and consumed from memory store', { key });
  return true;
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeStateStore(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis client disconnected');
  }
}

