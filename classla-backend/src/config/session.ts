import session from 'express-session';
import { createClient } from 'redis';
import { logger } from '../utils/logger';

// Import connect-redis - v9 exports RedisStore directly
const { RedisStore: RedisStoreClass } = require('connect-redis');

// Session configuration
const SESSION_SECRET = process.env.SESSION_SECRET;

// Validate SESSION_SECRET
if (!SESSION_SECRET) {
  logger.error('SESSION_SECRET is not set! Session cookies will not work.');
  throw new Error('SESSION_SECRET environment variable is required');
}

export const SESSION_CONFIG = {
  secret: SESSION_SECRET,
  name: 'classla.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Must be true in production for HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // Use 'none' for cross-domain cookies (app.classla.org -> api.classla.org)
    // 'lax' doesn't work for cross-domain AJAX requests
    sameSite: process.env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
    // Set domain to .classla.org to share cookie across subdomains (app.classla.org and api.classla.org)
    domain: process.env.NODE_ENV === 'production' ? '.classla.org' : 'localhost',
  },
} as const;

// Redis store configuration (optional - falls back to memory store)
let store: session.Store | undefined;
let redisClient: ReturnType<typeof createClient> | null = null;

if (process.env.REDIS_URL) {
  try {
    const redisUrl = process.env.REDIS_URL;
    
    // Create Redis client using the URL directly (same pattern as stateStore.ts)
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            logger.error('Redis reconnection failed after 10 retries for session store');
            return new Error('Redis reconnection limit exceeded');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });
    
    // Handle Redis client errors
    redisClient.on('error', (err: Error) => {
      logger.error('Redis client error for session store', { error: err.message });
    });
    
    redisClient.on('connect', () => {
      logger.info('Redis client connected for session storage');
    });
    
    redisClient.on('ready', () => {
      logger.info('Redis client ready for session storage');
    });
    
    // Create Redis store - connect-redis v9 API
    // RedisStore is a class constructor that takes options
    store = new RedisStoreClass({
      client: redisClient as any,
      prefix: 'sess:',
    });
    
    // Add logging to Redis store operations
    // Note: We need to wrap the methods properly to maintain the store's functionality
    if (store && typeof store.set === 'function' && typeof store.get === 'function') {
      const originalSet = store.set.bind(store);
      const originalGet = store.get.bind(store);
      const originalDestroy = store.destroy?.bind(store);
      const originalTouch = store.touch?.bind(store);
      
          // Wrap set method (only log errors)
          store.set = function(sid: string, session: any, callback?: (err?: any) => void) {
            return originalSet(sid, session, (err?: any) => {
              if (err) {
                logger.error('Redis store SET failed', {
                  sessionId: sid,
                  error: err.message,
                });
              }
              if (callback) callback(err);
            });
          };
          
          // Wrap get method (only log errors)
          store.get = function(sid: string, callback: (err?: any, session?: any) => void) {
            return originalGet(sid, (err?: any, session?: any) => {
              if (err) {
                logger.error('Redis store GET failed', {
                  sessionId: sid,
                  error: err.message,
                });
              }
              callback(err, session);
            });
          };
          
          // Wrap destroy if it exists (only log errors)
          if (originalDestroy) {
            store.destroy = function(sid: string, callback?: (err?: any) => void) {
              return originalDestroy(sid, (err?: any) => {
                if (err) {
                  logger.error('Redis store DESTROY failed', {
                    sessionId: sid,
                    error: err.message,
                  });
                }
                if (callback) callback(err);
              });
            };
          }
          
          // Wrap touch if it exists (only log errors)
          if (originalTouch) {
            store.touch = function(sid: string, session: any, callback?: (err?: any) => void) {
              return originalTouch(sid, session, (err?: any) => {
                if (err) {
                  logger.error('Redis store TOUCH failed', {
                    sessionId: sid,
                    error: err.message,
                  });
                }
                if (callback) callback(err);
              });
            };
          }
    } else {
      logger.warn('Store methods not available for wrapping', {
        hasStore: !!store,
        hasSet: store && typeof store.set === 'function',
        hasGet: store && typeof store.get === 'function',
      });
    }
    
    // Note: Connection will be established asynchronously
    // The server should wait for Redis connection before starting (see server.ts)
    redisClient.connect().then(() => {
      logger.info('Redis session store connected successfully', { url: redisUrl });
    }).catch((err: Error) => {
      logger.error('Failed to connect to Redis for session store', { 
        error: err.message,
        url: redisUrl 
      });
      // In production, fail hard if Redis is not available
      if (process.env.NODE_ENV === 'production') {
        logger.error('Redis is required in production. Exiting...');
        process.exit(1);
      } else {
        logger.warn('Falling back to memory store (not recommended for production)');
        store = undefined;
        redisClient = null;
      }
    });
    
    logger.info('Redis session store initialized', { url: redisUrl });
  } catch (error) {
    logger.error('Failed to initialize Redis store', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    if (process.env.NODE_ENV === 'production') {
      logger.error('Redis is required in production. Exiting...');
      process.exit(1);
    } else {
      logger.warn('Falling back to memory store (not recommended for production)');
      store = undefined;
      redisClient = null;
    }
  }
} else {
  if (process.env.NODE_ENV === 'production') {
    logger.error('REDIS_URL is required in production. Exiting...');
    process.exit(1);
  } else {
    logger.warn('Using memory session store (not recommended for production)');
  }
}

// Create session middleware
const baseSessionMiddleware = session({
  ...SESSION_CONFIG,
  store,
});

// Export session middleware (with error logging for signature validation failures)
export const sessionMiddleware = (req: any, res: any, next: any) => {
  // Extract cookie value for error detection
  const cookieHeader = req.headers.cookie;
  const sessionCookie = cookieHeader?.split(';').find((c: string) => c.trim().startsWith('classla.sid='));
  const cookieValue = sessionCookie ? sessionCookie.split('=')[1]?.trim() : null;
  
  // Call the actual session middleware
  baseSessionMiddleware(req, res, () => {
    // Only log errors: if we had a cookie but got a new session, signature validation likely failed
    if (cookieValue && req.session?.isNew) {
      logger.error('Cookie present but new session created - signature validation likely failed', {
        path: req.path,
        method: req.method,
        sessionId: req.sessionID,
      });
    }
    
    next();
  });
};

// Export store for WebSocket authentication
// Access the store from the middleware instance (works for both Redis and MemoryStore)
export const sessionStore = (baseSessionMiddleware as any).store as session.Store | undefined;

// Export function to wait for Redis connection (for server startup)
export async function waitForRedisConnection(): Promise<void> {
  if (!process.env.REDIS_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL is required in production');
    }
    return; // Development mode, memory store is OK
  }

  if (!redisClient) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Redis client not initialized - REDIS_URL is set but client failed to initialize');
    }
    return; // Development mode, memory store is OK
  }

  // Wait for Redis to be ready (with timeout)
  const maxWaitTime = 15000; // 15 seconds
  const startTime = Date.now();

  // Check if already connected
  if (redisClient.isOpen) {
    logger.info('Redis connection already open');
    return;
  }

  // Wait for connection to be established
  while (!redisClient.isOpen) {
    if (Date.now() - startTime > maxWaitTime) {
      throw new Error('Redis connection timeout - server cannot start without Redis in production');
    }
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
  }

  if (!redisClient.isOpen) {
    throw new Error('Redis connection failed - server cannot start without Redis in production');
  }

  logger.info('Redis connection verified before server startup');
}

export default sessionMiddleware;