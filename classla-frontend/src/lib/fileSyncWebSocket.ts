import { io, Socket } from "socket.io-client";

// Get backend API URL from environment or default
const getBackendApiUrl = (): string => {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";
};

export interface FileChangeEvent {
  bucketId: string;
  filePath: string;
  content: string;
  etag?: string;
  source: "frontend" | "container";
  userId?: string;
  timestamp: number;
}

export type FileChangeCallback = (event: FileChangeEvent) => void;

class FileSyncWebSocket {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private subscribers: Map<string, Set<FileChangeCallback>> = new Map();
  private subscribedBuckets: Set<string> = new Set();
  private subscribedFiles: Map<string, string> = new Map(); // filePath -> bucketId

  constructor() {
    // Will be initialized on connect
  }

  /**
   * Connect to the file sync WebSocket server
   * Uses the backend API URL, not the IDE API URL
   */
  connect(apiBaseUrl?: string): void {
    // Use provided URL or get backend API URL
    const backendApiUrl = apiBaseUrl || getBackendApiUrl();
    
    if (!backendApiUrl) {
      console.warn("[FileSync] Cannot connect: API base URL is empty");
      return;
    }

    if (this.socket?.connected) {
      return;
    }

    // Remove /api suffix if present, keep http/https (Socket.IO handles protocol conversion)
    const baseUrl = backendApiUrl.replace(/\/api$/, "");
    const namespace = "/file-sync";

    // Socket.IO: namespace goes in the connection URL, path is for the engine
    // Use HTTP URL - Socket.IO will handle WebSocket upgrade
    this.socket = io(`${baseUrl}${namespace}`, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: false, // Disable auto-reconnect to avoid errors when backend is down
      reconnectionAttempts: 0,
      reconnectionDelay: 0,
    });

    this.socket.on("connect", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("[FileSync] WebSocket connected");

      // Re-subscribe to previously subscribed buckets/files
      this.subscribedBuckets.forEach((bucketId) => {
        this.subscribeToBucket(bucketId);
      });
      this.subscribedFiles.forEach((filePath, bucketId) => {
        this.subscribeToFile(bucketId, filePath);
      });
    });

    this.socket.on("disconnect", (reason) => {
      this.isConnected = false;
      console.log("[FileSync] WebSocket disconnected:", reason);
    });

    this.socket.on("connect_error", (error) => {
      this.reconnectAttempts++;
      console.error("[FileSync] WebSocket connection error:", error);
    });

    this.socket.on("subscribed", (data: { bucketId?: string; filePath?: string }) => {
      console.log("[FileSync] Subscribed:", data);
    });

    this.socket.on("error", (error: { message: string }) => {
      console.error("[FileSync] WebSocket error:", error);
    });

    // Handle file change events
    this.socket.on("file-change", (event: FileChangeEvent) => {
      this.handleFileChange(event);
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.subscribedBuckets.clear();
      this.subscribedFiles.clear();
    }
  }

  /**
   * Subscribe to all file changes in a bucket
   */
  subscribeToBucket(bucketId: string): void {
    if (!this.socket || !this.isConnected) {
      this.subscribedBuckets.add(bucketId);
      return;
    }

    this.socket.emit("subscribe-bucket", { bucketId });
    this.subscribedBuckets.add(bucketId);
  }

  /**
   * Unsubscribe from a bucket
   */
  unsubscribeFromBucket(bucketId: string): void {
    if (this.socket && this.isConnected) {
      this.socket.emit("unsubscribe-bucket", { bucketId });
    }
    this.subscribedBuckets.delete(bucketId);
  }

  /**
   * Subscribe to changes for a specific file
   */
  subscribeToFile(bucketId: string, filePath: string): void {
    if (!this.socket || !this.isConnected) {
      this.subscribedFiles.set(`${bucketId}:${filePath}`, bucketId);
      return;
    }

    this.socket.emit("subscribe-file", { bucketId, filePath });
    this.subscribedFiles.set(`${bucketId}:${filePath}`, bucketId);
  }

  /**
   * Unsubscribe from a file
   */
  unsubscribeFromFile(bucketId: string, filePath: string): void {
    this.subscribedFiles.delete(`${bucketId}:${filePath}`);
  }

  /**
   * Register a callback for file changes
   */
  onFileChange(bucketId: string, filePath: string, callback: FileChangeCallback): () => void {
    const key = `${bucketId}:${filePath}`;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);

    // Subscribe to the file if not already subscribed
    this.subscribeToFile(bucketId, filePath);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Register a callback for any file change in a bucket
   */
  onBucketChange(bucketId: string, callback: FileChangeCallback): () => void {
    const key = `bucket:${bucketId}`;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);

    // Subscribe to the bucket if not already subscribed
    this.subscribeToBucket(bucketId);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Handle incoming file change event
   */
  private handleFileChange(event: FileChangeEvent): void {
    const { bucketId, filePath } = event;

    // Notify file-specific subscribers
    const fileKey = `${bucketId}:${filePath}`;
    const fileSubscribers = this.subscribers.get(fileKey);
    if (fileSubscribers) {
      fileSubscribers.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error("[FileSync] Error in file change callback:", error);
        }
      });
    }

    // Notify bucket-level subscribers
    const bucketKey = `bucket:${bucketId}`;
    const bucketSubscribers = this.subscribers.get(bucketKey);
    if (bucketSubscribers) {
      bucketSubscribers.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error("[FileSync] Error in bucket change callback:", error);
        }
      });
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }
}

// Export singleton instance
export const fileSyncWebSocket = new FileSyncWebSocket();

