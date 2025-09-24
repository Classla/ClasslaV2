// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { supabase } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { sessionMiddleware } from "./config/session";
import { logger } from "./utils/logger";

// Validate required environment variables
const requiredEnvVars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Session middleware
app.use(sessionMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substring(2, 15);
  req.headers["x-request-id"] = requestId;

  logger.info(`${req.method} ${req.originalUrl}`, {
    requestId,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

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
import submissionRoutes from "./routes/submissions";
import graderRoutes from "./routes/graders";
import rubricRoutes from "./routes/rubrics";
import joinLinksRoutes from "./routes/joinLinks";

// Auth routes (mounted at root for WorkOS callback compatibility)
app.use("/", authRoutes);

// API routes (auth routes also mounted here for frontend API calls)
app.use("/api", authRoutes);
app.use("/api", userRoutes);
app.use("/api", courseRoutes);
app.use("/api", sectionRoutes);
app.use("/api", enrollmentRoutes);
app.use("/api", assignmentRoutes);
app.use("/api", submissionRoutes);
app.use("/api", graderRoutes);
app.use("/api", rubricRoutes);
app.use("/api/join-links", joinLinksRoutes);

// Error handling - must be after all routes
app.use(errorHandler);
app.use(notFoundHandler);

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

export default app;
