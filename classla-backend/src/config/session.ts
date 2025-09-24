import session from 'express-session';
import connectRedis from 'connect-redis';

// Session configuration
export const SESSION_CONFIG = {
  secret: process.env.SESSION_SECRET!,
  name: 'classla.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' as const,
    domain: process.env.NODE_ENV === 'production' ? undefined : 'localhost',
  },
} as const;

// Validate required environment variables
if (!SESSION_CONFIG.secret) {
  throw new Error('SESSION_SECRET environment variable is required');
}

// Redis store configuration (optional - falls back to memory store)
let store: session.Store | undefined;

if (process.env.REDIS_URL) {
  try {
    // For now, we'll use memory store and add Redis support later when needed
    console.log('Redis URL provided but using memory store for now (Redis integration can be added later)');
  } catch (error) {
    console.warn('Failed to initialize Redis store, falling back to memory store:', error);
  }
} else {
  console.log('Using memory session store (not recommended for production)');
}

export const sessionMiddleware = session({
  ...SESSION_CONFIG,
  store,
});

export default sessionMiddleware;