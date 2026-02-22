import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import session from "express-session";
import cookieParser from "cookie-parser";
import { sessionManagementService } from "./session";
import { supabase } from "../middleware/auth";
import { logger } from "../utils/logger";
import { sessionMiddleware } from "../config/session";

let io: SocketIOServer | null = null;

export type AuthenticatedSocket = Socket & {
  userId?: string;
  isAuthenticated?: boolean;
  request?: any;
};

/**
 * Initialize Socket.IO server
 */
export function initializeWebSocket(
  server: HTTPServer,
  expressSessionMiddleware: typeof sessionMiddleware
): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
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
          logger.error("FRONTEND_URL environment variable is not set for WebSocket CORS");
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

        const allowedOrigins = [
          frontendOrigin, // Frontend URL from environment (e.g., https://dkxwdi4itgzqv.amplifyapp.com)
          "https://app.classla.org", // Production frontend domain
          "https://api.classla.org", // Backend itself (for internal requests)
        ];

        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 30 * 1024 * 1024, // 30MB — supports PDF/image attachments in AI chat
  });

  // Authentication middleware for WebSocket connections
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Get request from socket
      const req = socket.request as any;
      
      // Parse cookies manually
      const cookies = req.headers.cookie || "";
      const parsedCookies: any = {};
      
      // Parse session ID from cookie
      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(new RegExp(`${sessionCookieName}=([^;]+)`));
      
      if (!sessionIdMatch) {
        logger.warn("WebSocket connection rejected: No session cookie", {
          socketId: socket.id,
        });
        return next(new Error("Authentication failed: No session"));
      }

      const sessionId = sessionIdMatch[1];
      
      // Set up request object for session middleware
      req.sessionID = sessionId;
      req.session = null as any;
      
      // Manually load session from store
      // Wrap in a promise to handle async session loading
      await new Promise<void>((resolve, reject) => {
        const store = (expressSessionMiddleware as any).store;
        if (!store) {
          // Memory store - we can't easily access it
          // For now, we'll need to use a workaround
          resolve();
          return;
        }
        
        // Load session from store
        store.get(sessionId, (err: any, session: any) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (session) {
            req.session = session;
          }
          resolve();
        });
      });
      
      // Now validate session using session management service
      const sessionData = await sessionManagementService.validateSession(req);
      
      if (!sessionData) {
        logger.warn("WebSocket connection rejected: Invalid session", {
          socketId: socket.id,
        });
        return next(new Error("Authentication failed"));
      }

      // Extract user information from database
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, email, is_admin, workos_user_id")
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (userError || !userData) {
        logger.warn("WebSocket connection rejected: User not found", {
          socketId: socket.id,
          workosUserId: sessionData.workosUserId,
        });
        return next(new Error("User not found"));
      }

      // Attach user info to socket
      socket.userId = userData.id;
      socket.isAuthenticated = true;

      logger.info("WebSocket connection authenticated", {
        socketId: socket.id,
        userId: userData.id,
      });

      next();
    } catch (error) {
      logger.error("WebSocket authentication error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(new Error("Authentication failed"));
    }
  });

  // Handle connection
  io.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("WebSocket client connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    socket.on("disconnect", (reason) => {
      logger.info("WebSocket client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });
    });

    socket.on("error", (error) => {
      logger.error("WebSocket error", {
        socketId: socket.id,
        userId: socket.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });

  return io;
}

/**
 * Get the Socket.IO server instance
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("WebSocket server not initialized. Call initializeWebSocket first.");
  }
  return io;
}

export default { initializeWebSocket, getIO };

