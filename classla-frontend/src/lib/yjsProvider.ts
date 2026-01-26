import { io, Socket } from "socket.io-client";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

// Get backend API URL from environment or default
const getBackendApiUrl = (): string => {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";
};

/**
 * Convert base64 string to Uint8Array (browser-compatible)
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string (browser-compatible)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

/**
 * Y.js document manager for collaborative editing
 */
class YjsProvider {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private documents: Map<string, Y.Doc> = new Map();
  private providers: Map<string, { doc: Y.Doc; ytext: Y.Text; awareness: Awareness }> = new Map();
  private pendingSubscriptions: Set<string> = new Set();

  get socketInstance(): Socket | null {
    return this.socket;
  }

  constructor() {
    // Will be initialized on connect
  }

  /**
   * Connect to the Y.js WebSocket server
   */
  connect(apiBaseUrl?: string, bucketId?: string): void {
    const backendApiUrl = apiBaseUrl || getBackendApiUrl();
    
    if (!backendApiUrl) {
      console.warn("[Yjs] Cannot connect: API base URL is empty");
      return;
    }

    // If socket already exists and is connected, just ensure event listeners are set up
    if (this.socket?.connected) {
      console.log("[Yjs] Socket already connected, ensuring event listeners are set up");
      this.setupEventListeners();
      return;
    }

    // Remove /api suffix if present
    const baseUrl = backendApiUrl.replace(/\/api$/, "");
    const namespace = "/yjs";

    // For test bucket, include bucketId in handshake to allow test authentication
    const testBucketId = "00000000-0000-0000-0000-000000000001";
    const isTestBucket = bucketId === testBucketId;
    
    const socketOptions: any = {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    };

    // Add test bucket ID to handshake for test authentication
    if (isTestBucket && process.env.NODE_ENV === 'development') {
      socketOptions.query = { bucketId: testBucketId };
      socketOptions.auth = { bucketId: testBucketId };
      socketOptions.extraHeaders = { "x-test-bucket-id": testBucketId };
    }

    this.socket = io(`${baseUrl}${namespace}`, socketOptions);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.socket) {
      console.error("[Yjs] Cannot setup event listeners: socket is null");
      return;
    }

    // Only set up connect handler if not already set up
    if (!(this.socket as any)._connectHandlerSet) {
      this.socket.on("connect", () => {
        this.isConnected = true;
        console.log("[Yjs] ✅ WebSocket connected", {
          socketId: this.socket?.id,
          existingDocuments: Array.from(this.providers.keys()),
          pendingSubscriptions: Array.from(this.pendingSubscriptions)
        });

        // Re-subscribe to all existing documents
        for (const [docId, provider] of this.providers.entries()) {
          const [bucketId, ...filePathParts] = docId.split(":");
          const filePath = filePathParts.join(":");
          console.log(`[Yjs] 🔄 Re-subscribing to ${docId} after reconnect`);
          this.subscribeToDocument(bucketId, filePath);
        }

        // Process pending subscriptions
        for (const docId of this.pendingSubscriptions) {
          const [bucketId, ...filePathParts] = docId.split(":");
          const filePath = filePathParts.join(":");
          console.log(`[Yjs] 🔔 Processing pending subscription for ${docId}`);
          this.subscribeToDocument(bucketId, filePath);
        }
        this.pendingSubscriptions.clear();
      });
      (this.socket as any)._connectHandlerSet = true;
    }

    this.socket.on("disconnect", (reason) => {
      this.isConnected = false;
      console.log("[Yjs] WebSocket disconnected:", reason);
    });

    this.socket.on("connect_error", (error) => {
      console.error("[Yjs] WebSocket connection error:", error);
    });

    this.socket.on("error", (error: { message: string }) => {
      console.error("[Yjs] WebSocket error:", error);
    });

    // Handle document state (initial load)
    if (!(this.socket as any)._documentStateListenerSet) {
      this.socket.on("document-state", (data: { bucketId: string; filePath: string; state: string }) => {
      const { bucketId, filePath, state } = data;
      const docId = `${bucketId}:${filePath}`;
      console.log(`[Yjs] 📥 Received initial document-state for ${docId}`, { stateSize: state.length });
      
      // Get or create provider if it doesn't exist yet
      let provider = this.providers.get(docId);
      if (!provider) {
        console.log(`[Yjs] Creating document for incoming state: ${docId}`);
        provider = this.getDocument(bucketId, filePath);
      }
      
      if (provider) {
        try {
          const beforeContent = provider.ytext.toString();
          const stateBuffer = base64ToUint8Array(state);
          Y.applyUpdate(provider.doc, stateBuffer, "server");
          const afterContent = provider.ytext.toString();
          console.log(`[Yjs] ✅ Applied initial document state for ${docId}`, {
            beforeLength: beforeContent.length,
            afterLength: afterContent.length,
            contentPreview: afterContent.substring(0, 100) + (afterContent.length > 100 ? '...' : '')
          });
        } catch (error) {
          console.error(`[Yjs] ❌ Failed to apply document state for ${docId}:`, error);
        }
      }
      });
      (this.socket as any)._documentStateListenerSet = true;
    }

    // Handle Y.js updates from server
    // CRITICAL: This must be set up for the socket to receive broadcasts
    if (!(this.socket as any)._yjsUpdateListenerSet) {
      this.socket.on("yjs-update", (data: { bucketId: string; filePath: string; update: string }) => {
        const { bucketId, filePath, update } = data;
        const docId = `${bucketId}:${filePath}`;
        console.log(`[Yjs] 📥 Received yjs-update for ${docId}`, { 
          updateSize: update.length,
          socketId: this.socket?.id,
          timestamp: new Date().toISOString()
        });
        
        // Get or create provider if it doesn't exist yet
        let provider = this.providers.get(docId);
        if (!provider) {
          console.log(`[Yjs] ⚠️ Creating document for incoming update: ${docId} (should have existed)`);
          provider = this.getDocument(bucketId, filePath);
        }
        
        if (provider) {
          try {
            const beforeContent = provider.ytext.toString();
            const updateBuffer = base64ToUint8Array(update);
            Y.applyUpdate(provider.doc, updateBuffer, "server");
            const afterContent = provider.ytext.toString();
            console.log(`[Yjs] ✅ Applied update for ${docId}`, {
              beforeLength: beforeContent.length,
              afterLength: afterContent.length,
              changed: beforeContent !== afterContent,
              contentPreview: afterContent.substring(0, 100) + (afterContent.length > 100 ? '...' : '')
            });
          } catch (error) {
            console.error(`[Yjs] ❌ Failed to apply update for ${docId}:`, error);
          }
        } else {
          console.error(`[Yjs] ❌ No provider found for ${docId} after creating`);
        }
      });
      (this.socket as any)._yjsUpdateListenerSet = true;
      console.log(`[Yjs] ✅ Set up yjs-update event listener for socket ${this.socket?.id}`);
    } else {
      console.log(`[Yjs] ⚠️ yjs-update listener already set up for socket ${this.socket?.id}`);
    }

    // Handle file tree changes (file creation/deletion)
    this.socket.on("file-tree-change", (data: { bucketId: string; filePath: string; action: "create" | "delete" }) => {
      const { bucketId, filePath, action } = data;
      // Emit custom event that MonacoIDE can listen to
      window.dispatchEvent(new CustomEvent("yjs-file-tree-change", { detail: data }));
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
    }
    
    // Clean up all documents
    this.providers.clear();
    this.documents.clear();
  }

  /**
   * Get or create a Y.js document for a file
   */
  getDocument(bucketId: string, filePath: string): { doc: Y.Doc; ytext: Y.Text; awareness: Awareness } {
    const docId = `${bucketId}:${filePath}`;
    
    if (this.providers.has(docId)) {
      console.log(`[Yjs] Reusing existing document for ${docId}`);
      return this.providers.get(docId)!;
    }

    console.log(`[Yjs] Creating NEW document for ${docId}`);

    // Create new document
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const awareness = new Awareness(doc);
    
    // Set local user info for awareness
    // Use a combination of localStorage (shared across tabs) and a unique per-tab ID
    let userId = localStorage.getItem('yjs-user-id');
    if (!userId) {
      userId = `user-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('yjs-user-id', userId);
      console.log(`[Yjs] Created new base userId: ${userId}`);
    }
    
    // Generate a unique tab ID - use a combination of timestamp and random to ensure uniqueness
    // Even if sessionStorage is shared, this will be unique per tab instance
    let tabId = sessionStorage.getItem('yjs-tab-id');
    if (!tabId) {
      tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('yjs-tab-id', tabId);
      console.log(`[Yjs] Created new tabId: ${tabId}`);
    }
    const uniqueUserId = `${userId}-${tabId}`;
    console.log(`[Yjs] User ID for this tab: ${uniqueUserId}`, {
      baseUserId: userId,
      tabId: tabId,
      socketId: this.socket?.id
    });
    
    awareness.setLocalStateField('user', {
      name: uniqueUserId,
      color: this.generateColor(uniqueUserId),
    });
    
    this.documents.set(docId, doc);
    this.providers.set(docId, { doc, ytext, awareness });

    // Subscribe to document
    this.subscribeToDocument(bucketId, filePath);

    // Set up update handler to send updates to server
    doc.on("update", (update: Uint8Array, origin: any) => {
      const currentContent = ytext.toString();
      console.log(`[Yjs] 📤 Document update detected for ${docId}`, {
        origin: origin,
        originType: typeof origin,
        updateSize: update.length,
        contentLength: currentContent.length,
        contentPreview: currentContent.substring(0, 50) + (currentContent.length > 50 ? '...' : '')
      });

      // Don't send updates that came from the server (they're already synced)
      // But DO send updates from Monaco binding (they need to sync to other clients)
      if (origin === "server") {
        console.log(`[Yjs] ⏭️  Skipping update send (origin is server)`);
        return;
      }

      // Send update to server (this includes updates from Monaco binding)
      if (this.socket && this.isConnected) {
        try {
          const updateBase64 = uint8ArrayToBase64(update);
          this.socket.emit("yjs-update", {
            bucketId,
            filePath,
            update: updateBase64,
          });
          console.log(`[Yjs] ✅ Successfully sent update to server for ${docId}`);
        } catch (error) {
          console.error(`[Yjs] ❌ Failed to send update for ${docId}:`, error);
        }
      } else {
        console.warn(`[Yjs] ⚠️  Cannot send update for ${docId}: socket=${!!this.socket}, connected=${this.isConnected}`);
      }
    });

    // Set up awareness update handler
    awareness.on('change', () => {
      const states = Array.from(awareness.getStates().entries());
      console.log(`[Yjs] 👥 Awareness changed for ${docId}:`, {
        totalUsers: states.length,
        users: states.map(([id, state]) => ({ id, user: state.user }))
      });
    });

    return { doc, ytext, awareness };
  }

  private generateColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 50%)`;
  }

  /**
   * Subscribe to a document
   */
  subscribeToDocument(bucketId: string, filePath: string): void {
    const docId = `${bucketId}:${filePath}`;
    
    if (!this.socket || !this.isConnected) {
      // Will subscribe when connected
      console.log(`[Yjs] ⏳ Queueing subscription for ${docId} (socket not connected)`);
      this.pendingSubscriptions.add(docId);
      return;
    }

    console.log(`[Yjs] 🔔 Subscribing to document: ${docId}`, {
      socketId: this.socket.id,
      isConnected: this.isConnected
    });
    this.socket.emit("subscribe-document", { bucketId, filePath });
    console.log(`[Yjs] ✅ Sent subscribe-document request for ${docId}`);
  }

  /**
   * Unsubscribe from a document
   */
  unsubscribeDocument(bucketId: string, filePath: string): void {
    const docId = `${bucketId}:${filePath}`;
    
    if (this.socket && this.isConnected) {
      this.socket.emit("unsubscribe-document", { bucketId, filePath });
    }

    // Clean up document
    this.providers.delete(docId);
    this.documents.delete(docId);
  }

  /**
   * Get the Y.Text for a file (for Monaco editor binding)
   */
  getYText(bucketId: string, filePath: string): Y.Text {
    const { ytext } = this.getDocument(bucketId, filePath);
    return ytext;
  }

  /**
   * Get the Y.Doc for a file
   */
  getYDoc(bucketId: string, filePath: string): Y.Doc {
    const { doc } = this.getDocument(bucketId, filePath);
    return doc;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }
}

// Export singleton instance
export const yjsProvider = new YjsProvider();

