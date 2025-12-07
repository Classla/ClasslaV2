// Load environment variables FIRST before any other imports
// Only load .env file in development - in production, use environment variables from container
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  // Try .env.local first (for local overrides), then .env
  dotenv.config({ path: ".env.local" });
  dotenv.config(); // .env will override .env.local if both exist
}

import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import { supabase } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { sessionMiddleware, waitForRedisConnection } from "./config/session";
import { logger } from "./utils/logger";
import { initializeWebSocket } from "./services/websocket";
import { setupAIWebSocket } from "./routes/ai";

// Validate required environment variables
const requiredEnvVars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// CRITICAL: Trust proxy for load balancer (ALB)
// This is required for secure cookies to work correctly behind a load balancer
// Without this, Express doesn't know the request is over HTTPS and may reject secure cookies
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or file://)
      if (!origin) return callback(null, true);

      // In development, allow all origins
      if (process.env.NODE_ENV === "development") {
        return callback(null, true);
      }

      // In production, only allow specific origins
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        logger.error("FRONTEND_URL environment variable is not set");
        return callback(new Error("CORS configuration error: FRONTEND_URL not set"));
      }

      // Parse the frontend URL to get the origin
      let frontendOrigin: string;
      try {
        frontendOrigin = new URL(frontendUrl).origin;
      } catch (error) {
        logger.error(`Invalid FRONTEND_URL format: ${frontendUrl}`);
        return callback(new Error("CORS configuration error: Invalid FRONTEND_URL format"));
      }
      
      // Allowed origins in production (must include protocol)
      const allowedOrigins = [
        frontendOrigin, // Frontend URL from environment (e.g., https://dkxwdi4itgzqv.amplifyapp.com)
        "https://app.classla.org", // Production frontend domain
        "https://api.classla.org", // Backend itself (for internal requests)
      ];

      // Check if origin matches any allowed origin
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Session middleware
app.use(sessionMiddleware);

// Request logging middleware (only log errors and important routes)
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substring(2, 15);
  req.headers["x-request-id"] = requestId;

  // Only log non-GET requests and errors
  if (req.method !== "GET") {
    logger.debug(`${req.method} ${req.originalUrl}`, {
      requestId,
    });
  }

  next();
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Test Supabase connection
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      database: error ? "disconnected" : "connected",
    });
  } catch (error) {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      database: "error",
    });
  }
});

// Import routes
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import courseRoutes from "./routes/courses";
import sectionRoutes from "./routes/sections";
import enrollmentRoutes from "./routes/enrollments";
import assignmentRoutes from "./routes/assignments";
import folderRoutes from "./routes/folders";
import submissionRoutes from "./routes/submissions";
import graderRoutes from "./routes/graders";
import rubricRoutes from "./routes/rubrics";
import joinLinksRoutes from "./routes/joinLinks";
import blocksRoutes from "./routes/blocks";
import autograderRoutes from "./routes/autograder";
import s3bucketsRoutes from "./routes/s3buckets";
import aiRoutes from "./routes/ai";

// Auth routes (mounted at root for WorkOS callback compatibility)
app.use("/", authRoutes);

// API routes (auth routes also mounted here for frontend API calls)
app.use("/api", authRoutes);
app.use("/api", userRoutes);
app.use("/api", courseRoutes);
app.use("/api", sectionRoutes);
app.use("/api", enrollmentRoutes);
app.use("/api", assignmentRoutes);
app.use("/api", folderRoutes);
app.use("/api", submissionRoutes);
app.use("/api", graderRoutes);
app.use("/api", rubricRoutes);
app.use("/api/join-links", joinLinksRoutes);
app.use("/api", blocksRoutes);
app.use("/api", autograderRoutes);
app.use("/api/s3buckets", s3bucketsRoutes);
app.use("/api", aiRoutes);

// Error handling - must be after all routes
app.use(errorHandler);
app.use(notFoundHandler);

// Initialize WebSocket server (must be after session middleware is set up)
const io = initializeWebSocket(server, sessionMiddleware);

// Set up AI WebSocket namespace
setupAIWebSocket(io);

// Wait for Redis connection before starting server (in production)
waitForRedisConnection()
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`WebSocket server initialized`);
    });
  })
  .catch((error) => {
    logger.error('Failed to start server - Redis connection required', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  });

export default app;

