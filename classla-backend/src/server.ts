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
import { responseInterceptor } from "./middleware/responseInterceptor";
import { sessionMiddleware, waitForRedisConnection } from "./config/session";
import { logger } from "./utils/logger";
import { initializeWebSocket } from "./services/websocket";
import { setupAIChatWebSocket } from "./routes/aiChat";
import { setupCourseTreeSocket } from "./services/courseTreeSocket";

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
const PORT = process.env.PORT || 8000;

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

// Response interceptor - catches ALL 5xx responses and sends Discord alerts
app.use(responseInterceptor);

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Test Supabase connection
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);

    if (error) {
      res.status(503).json({
        status: "DEGRADED",
        timestamp: new Date().toISOString(),
        database: "disconnected",
      });
    } else {
      res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        database: "connected",
      });
    }
  } catch (error) {
    res.status(503).json({
      status: "ERROR",
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
import ideBlocksRoutes from "./routes/ideBlocks";
import aiRoutes from "./routes/ai";
import aiChatRoutes from "./routes/aiChat";
import organizationRoutes from "./routes/organizations";
import courseTemplateRoutes from "./routes/courseTemplates";
import managedStudentsRoutes from "./routes/managedStudents";
import adminIdeRoutes from "./routes/adminIde";
import aiMemoriesRoutes from "./routes/aiMemories";

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
app.use("/api/ide-blocks", ideBlocksRoutes);
app.use("/api", aiRoutes);
app.use("/api", aiChatRoutes);
app.use("/api", organizationRoutes);
app.use("/api", courseTemplateRoutes);
app.use("/api", managedStudentsRoutes);
app.use("/api/admin/ide", adminIdeRoutes);
app.use("/api", aiMemoriesRoutes);

// Error handling - must be after all routes
app.use(errorHandler);
app.use(notFoundHandler);

// Initialize WebSocket server (must be after session middleware is set up)
const io = initializeWebSocket(server, sessionMiddleware);

// Set up AI Chat WebSocket namespace
setupAIChatWebSocket(io);

// Set up Course Tree WebSocket namespace (real-time module tree updates)
setupCourseTreeSocket(io);

// Set up OT WebSocket namespace
const { setupOTWebSocket, saveAllDocuments: saveAllOTDocuments } = require("./services/otProviderService");
setupOTWebSocket(io);

// Graceful shutdown - Save all OT documents before exiting
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.info(`[Shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  logger.info(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

  try {
    logger.info('[Shutdown] Saving all OT documents...');
    await saveAllOTDocuments();
    logger.info('[Shutdown] All OT documents saved successfully');
  } catch (error) {
    logger.error('[Shutdown] Failed to save OT documents:', error);
  }

  // Close HTTP server (stop accepting new connections)
  server.close((err) => {
    if (err) {
      logger.error('[Shutdown] Error closing HTTP server:', err);
      process.exit(1);
    }
    logger.info('[Shutdown] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors - save before crashing
process.on('uncaughtException', async (error) => {
  logger.error('[Fatal] Uncaught exception:', error);
  try {
    await saveAllOTDocuments();
    logger.info('[Fatal] Emergency save completed');
  } catch (saveError) {
    logger.error('[Fatal] Emergency save failed:', saveError);
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('[Fatal] Unhandled rejection:', { reason, promise });
  // Don't exit on unhandled rejection - just log it
  // The process will continue running
});

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
