import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import config from "./config";
import { authenticate } from "./middleware/auth";
import {
  rateLimitMiddleware,
  stopCleanupInterval,
} from "./middleware/rateLimit";
import { errorHandler } from "./middleware/errorHandler";
import containersRouter from "./routes/containers";
import { handleInactivityShutdown } from "./routes/containers";
import healthRouter from "./routes/health";
import dashboardRouter from "./routes/dashboard";
import dashboardApiRouter from "./routes/dashboardApi";
import {
  healthMonitor,
  stateManager,
  queueMaintainer,
  containerCleanupService,
} from "./services/serviceInstances";

const app: Express = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or file://)
      if (!origin) {
        return callback(null, true);
      }
      
      // In production, allow specific domains
      if (config.nodeEnv === "production") {
        const allowedOrigins = [
          `https://${config.domain}`,
          `https://api.${config.domain}`,
          `http://${config.domain}`,
          `http://api.${config.domain}`,
        ];
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Also allow IP-based access for testing
        if (origin.startsWith(`http://${config.domain}`) || origin.startsWith(`https://${config.domain}`)) {
          return callback(null, true);
        }
      }
      
      // In development, allow all origins
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (config.nodeEnv === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Root endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "IDE Orchestration API",
    version: "1.0.0",
    status: "running",
  });
});

// Mount API routes
// Inactivity shutdown callback is public (called from within containers)
// Mount as specific routes BEFORE the general app.use to ensure they match first
app.post("/api/containers/:id/inactivity-shutdown", (req, res, next) => {
  // Wrap in async handler
  handleInactivityShutdown(req, res, next).catch(next);
});
app.post("/containers/:id/inactivity-shutdown", (req, res, next) => {
  handleInactivityShutdown(req, res, next).catch(next);
});
// Container routes require authentication and rate limiting
// Mount at both paths to work with and without strip-prefix middleware
// These will match any routes under /api/containers that weren't matched above
app.use("/api/containers", authenticate, rateLimitMiddleware, containersRouter);
app.use("/containers", authenticate, rateLimitMiddleware, containersRouter);
// Health endpoint is public (no authentication required)
// Mount at both paths to work with and without strip-prefix middleware
app.use("/api/health", healthRouter);
app.use("/health", healthRouter);
// Dashboard API routes (no authentication for now)
app.use("/api/dashboard", dashboardApiRouter);
// Dashboard routes (static files, no authentication for now)
app.use("/dashboard", dashboardRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found",
    },
    timestamp: new Date().toISOString(),
    path: req.path,
  });
});

// Centralized error handler (must be last)
app.use(errorHandler);

// Start health monitoring
healthMonitor.start();

// Start queue maintainer
queueMaintainer.start();
console.log(`🔄 Queue maintainer started (target: ${config.preWarmedQueueSize} containers)`);

// Start container cleanup service
containerCleanupService.start();
console.log(`🧹 Container cleanup service started`);

// Start server
const server = app.listen(config.port, () => {
  console.log(`🚀 IDE Orchestration API running on port ${config.port}`);
  console.log(`📝 Environment: ${config.nodeEnv}`);
  console.log(`🌐 Domain: ${config.domain}`);
  console.log(`💚 Health monitoring started`);
  console.log(`🔄 Queue maintainer started (target: ${config.preWarmedQueueSize} containers)`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  queueMaintainer.stop();
  healthMonitor.stop();
  containerCleanupService.stop();
  stateManager.close();
  stopCleanupInterval();
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  queueMaintainer.stop();
  healthMonitor.stop();
  containerCleanupService.stop();
  stateManager.close();
  stopCleanupInterval();
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

export default app;
