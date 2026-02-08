#!/usr/bin/env node
/**
 * Y.js Container Sync Service
 * 
 * Runs inside the IDE container to sync filesystem changes with Y.js documents
 * via WebSocket connection to the backend.
 */

const { io } = require("socket.io-client");
const Y = require("yjs");
const chokidar = require("chokidar");
const fs = require("fs").promises;
const path = require("path");
const https = require("https");
const http = require("http");

// Configuration from environment variables
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
let BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:8000/api";
const BUCKET_ID = process.env.S3_BUCKET_ID || "";
const CONTAINER_ID = process.env.CONTAINER_ID || "";

// Fix Docker networking: replace localhost with host.docker.internal
// This allows containers to connect to services running on the host
// Check if we're running in Docker and if BACKEND_API_URL uses localhost
if ((BACKEND_API_URL.includes("localhost") || BACKEND_API_URL.includes("127.0.0.1")) && 
    (process.env.HOSTNAME || require("fs").existsSync("/.dockerenv"))) {
  // Replace localhost/127.0.0.1 with host.docker.internal
  // host.docker.internal works on Docker Desktop (Mac/Windows) and can be configured on Linux
  BACKEND_API_URL = BACKEND_API_URL.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal");
  console.log(`[YjsContainerSync] 🔧 Detected Docker environment, using host.docker.internal for backend connection`);
  console.log(`[YjsContainerSync] 🔧 Updated BACKEND_API_URL: ${BACKEND_API_URL}`);
}

if (!BUCKET_ID) {
  console.error("[YjsContainerSync] ERROR: S3_BUCKET_ID environment variable is required");
  process.exit(1);
}

class YjsContainerSync {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.documents = new Map();
    this.watcher = null;
    this.fileChangeTimeouts = new Map();
    this.syncingFromYjs = new Set(); // Track files being synced from Y.js to prevent loops
    this.pendingFileWrites = new Map(); // Track debounced file writes from remote YJS updates
    this.lastRemoteUpdateTime = new Map(); // Track last remote update time per file
    this.initialSyncComplete = false; // Track whether initial file sync is done
    this.pendingInitialFiles = new Set(); // Files we're waiting for during initial sync
    this.isFirstSubscription = true; // Track first vs periodic re-subscription
  }

  async start() {
    console.log("[YjsContainerSync] 🚀 Starting Y.js container sync service...");
    console.log(`[YjsContainerSync] 📁 Workspace: ${WORKSPACE_PATH}`);
    console.log(`[YjsContainerSync] 🌐 Backend: ${BACKEND_API_URL}`);
    console.log(`[YjsContainerSync] 🪣 Bucket ID: "${BUCKET_ID}" (length: ${BUCKET_ID?.length || 0})`);
    console.log(`[YjsContainerSync] 🔐 Service Token: ${process.env.CONTAINER_SERVICE_TOKEN ? `${process.env.CONTAINER_SERVICE_TOKEN.substring(0, 8)}... (${process.env.CONTAINER_SERVICE_TOKEN.length} chars)` : "NOT SET"}`);
    console.log(`[YjsContainerSync] 📦 Container ID: ${CONTAINER_ID || "NOT SET"}`);

    if (!BUCKET_ID || BUCKET_ID.length === 0) {
      console.error("[YjsContainerSync] ❌ CRITICAL: Bucket ID is empty or undefined! YJS sync will not work.");
      return;
    }

    // Connect to Y.js WebSocket
    await this.connect();

    // Start filesystem watcher
    await this.startFileWatcher();

    console.log("[YjsContainerSync] Service started successfully");

    // Log status every 60 seconds to confirm service is still running
    setInterval(() => {
      console.log(`[YjsContainerSync] 💓 Status: connected=${this.isConnected}, socketId=${this.socket?.id}, documents=${this.documents.size}, pendingWrites=${this.pendingFileWrites.size}`);
    }, 60000);

    // CRITICAL: Periodically re-subscribe to all files every 30 seconds
    // This catches files that might have been missed during initial subscription
    // or if socket.io room membership was lost
    setInterval(() => {
      if (this.isConnected) {
        console.log(`[YjsContainerSync] 🔄 Periodic re-subscription check...`);
        this.subscribeToAllFiles();
      }
    }, 30000);
  }

  async connect() {
    const baseUrl = BACKEND_API_URL.replace(/\/api$/, "");
    const namespace = "/yjs";

    const serviceToken = process.env.CONTAINER_SERVICE_TOKEN || "";
    
    console.log(`[YjsContainerSync] Connecting to ${baseUrl}${namespace}`, {
      hasServiceToken: !!serviceToken,
      serviceTokenLength: serviceToken.length,
      serviceTokenPreview: serviceToken ? `${serviceToken.substring(0, 8)}...` : "none"
    });
    
    const socketOptions = {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    };
    
    // Add service token in multiple ways for maximum compatibility
    // 1. auth object (works for both websocket and polling)
    // 2. extraHeaders (works for polling, may work for websocket)
    // 3. query parameter in URL (fallback)
    if (serviceToken) {
      socketOptions.auth = {
        token: serviceToken
      };
      socketOptions.extraHeaders = {
        "x-container-service-token": serviceToken,
      };
      // Also add as query parameter in the URL for maximum compatibility
      // Socket.IO will merge query params from URL with query option
      socketOptions.query = {
        token: serviceToken
      };
      console.log(`[YjsContainerSync] Sending service token:`, {
        authToken: serviceToken.substring(0, 10) + "...",
        queryToken: serviceToken.substring(0, 10) + "...",
        headerToken: serviceToken.substring(0, 10) + "..."
      });
      this.socket = io(`${baseUrl}${namespace}`, socketOptions);
    } else {
      this.socket = io(`${baseUrl}${namespace}`, socketOptions);
    }

    this.socket.on("connect", () => {
      this.isConnected = true;
      console.log("[YjsContainerSync] ✅ Connected to Y.js server", {
        socketId: this.socket.id,
        bucketId: BUCKET_ID,
        backendUrl: baseUrl
      });

      // Subscribe to all files in workspace
      this.subscribeToAllFiles();
    });

    this.socket.on("disconnect", (reason) => {
      this.isConnected = false;
      console.log(`[YjsContainerSync] Disconnected: ${reason}`);
    });

    this.socket.on("connect_error", (error) => {
      console.error("[YjsContainerSync] ❌ Connection error:", error.message, {
        type: error.type,
        description: error.description,
        context: error.context
      });
    });

    // Log when transport changes (useful for debugging connection issues)
    this.socket.io.on("open", () => {
      console.log(`[YjsContainerSync] 🔌 Socket.IO transport opened`);
    });

    this.socket.io.on("ping", () => {
      console.log(`[YjsContainerSync] 💓 Ping`);
    });

    // Handle document state (initial load)
    this.socket.on("document-state", (data) => {
      console.log(`[YjsContainerSync] 📥 Received document-state for ${data?.filePath}`, {
        stateLength: data?.state?.length,
        bucketId: data?.bucketId
      });
      this.handleDocumentState(data);
    });

    // Handle Y.js updates from server
    this.socket.on("yjs-update", (data) => {
      console.log(`[YjsContainerSync] 🔔 RAW yjs-update event received:`, {
        filePath: data?.filePath,
        bucketId: data?.bucketId,
        updateLength: data?.update?.length,
        expectedBucketId: BUCKET_ID,
        bucketMatch: data?.bucketId === BUCKET_ID
      });
      this.handleYjsUpdate(data);
    });

      // Handle file tree changes (for explicit file deletions and creations)
      this.socket.on("file-tree-change", (data) => {
        this.handleFileTreeChange(data);
      });
  }

  async subscribeToAllFiles() {
    if (!this.isConnected || !this.socket) {
      console.log(`[YjsContainerSync] ⚠️ subscribeToAllFiles called but not connected`);
      return;
    }

    const isInitial = this.isFirstSubscription;
    if (isInitial) {
      this.isFirstSubscription = false;
    }

    try {
      // First, get list of files from S3 via backend API
      // This ensures we subscribe to files that exist in S3/IDE but not yet in workspace
      console.log(`[YjsContainerSync] 📋 Fetching file list from backend...`);
      const fileList = await this.getFileListFromBackend();
      const filesFromBackend = new Set(fileList);

      console.log(`[YjsContainerSync] 📋 Backend returned ${filesFromBackend.size} files:`, Array.from(filesFromBackend));

      // Also list files that already exist in workspace
      const workspaceFiles = await this.listFilesRecursive(WORKSPACE_PATH);
      const workspaceFilePaths = new Set(
        workspaceFiles.map(f => path.relative(WORKSPACE_PATH, f))
      );

      console.log(`[YjsContainerSync] 📋 Workspace has ${workspaceFilePaths.size} files:`, Array.from(workspaceFilePaths));

      // Combine both sets - subscribe to all files from backend and workspace
      const allFiles = new Set([...filesFromBackend, ...workspaceFilePaths]);

      console.log(`[YjsContainerSync] 📋 COMBINED ${allFiles.size} unique files to subscribe:`, Array.from(allFiles));

      // For initial subscription, track files we need to sync
      if (isInitial) {
        // Collect non-ignored files for initial sync tracking
        const filesToTrack = [];
        for (const relativePath of allFiles) {
          if (!this.shouldIgnoreFile(relativePath)) {
            filesToTrack.push(relativePath);
          }
        }

        if (filesToTrack.length === 0) {
          // No files to sync - immediately mark sync complete
          console.log(`[YjsContainerSync] 📋 No files to sync, marking initial sync complete immediately`);
          this.markInitialSyncComplete();
        } else {
          // Track pending files
          this.pendingInitialFiles = new Set(filesToTrack);
          console.log(`[YjsContainerSync] 📋 Tracking ${this.pendingInitialFiles.size} files for initial sync`);

          // Safety timeout: mark sync complete after 15 seconds regardless
          // This prevents infinite wait if a file's document-state never arrives
          setTimeout(() => {
            if (!this.initialSyncComplete) {
              console.warn(`[YjsContainerSync] ⚠️ Initial sync safety timeout (15s) - marking complete with ${this.pendingInitialFiles.size} files still pending:`, Array.from(this.pendingInitialFiles));
              this.markInitialSyncComplete();
            }
          }, 15000);
        }
      }

      let subscribedCount = 0;
      let skippedCount = 0;

      for (const relativePath of allFiles) {
        if (this.shouldIgnoreFile(relativePath)) {
          skippedCount++;
          continue;
        }

        const docId = `${BUCKET_ID}:${relativePath}`;
        console.log(`[YjsContainerSync] 🔔 Subscribing to document: ${relativePath}`);

        // Get or create Y.js document FIRST (before subscribing)
        const doc = this.getOrCreateDocument(relativePath);

        // CRITICAL FIX: Sync local file to Y.js BEFORE subscribing
        // This ensures our local content is in Y.js before server sends document-state
        // The handleDocumentState will then compare and decide who wins
        const fullPath = path.join(WORKSPACE_PATH, relativePath);
        try {
          await fs.access(fullPath);
          // File exists in workspace - sync it to Y.js BEFORE subscribing
          // This is important because document-state handler will compare local vs server
          await this.syncFileToYjs(relativePath, doc);
          console.log(`[YjsContainerSync] ✅ Pre-synced local file to Y.js before subscribing: ${relativePath}`);
        } catch {
          // File doesn't exist in workspace yet - that's fine
          console.log(`[YjsContainerSync] File ${relativePath} not in workspace yet, will be created from server state`);
        }

        // NOW subscribe to document - backend will send document-state
        // handleDocumentState will compare server content with our local content
        this.socket.emit("subscribe-document", {
          bucketId: BUCKET_ID,
          filePath: relativePath,
        });
        subscribedCount++;
      }

      console.log(`[YjsContainerSync] ✅ Subscribed to ${subscribedCount} files (${skippedCount} skipped) for bucket: ${BUCKET_ID}`, {
        files: Array.from(allFiles),
        socketId: this.socket?.id,
        connected: this.isConnected
      });
    } catch (error) {
      console.error("[YjsContainerSync] ❌ Failed to subscribe to files:", error);
      console.error("[YjsContainerSync] Error stack:", error.stack);

      // If initial subscription failed, mark sync complete to avoid blocking forever
      if (isInitial && !this.initialSyncComplete) {
        console.warn(`[YjsContainerSync] ⚠️ Initial subscription failed, marking sync complete to avoid blocking`);
        this.markInitialSyncComplete();
      }
    }
  }

  async getFileListFromBackend() {
    try {
      const baseUrl = BACKEND_API_URL.replace(/\/api$/, "");
      const serviceToken = process.env.CONTAINER_SERVICE_TOKEN || "";
      const urlString = `${baseUrl}/api/s3buckets/${BUCKET_ID}/files/list-for-container`;
      console.log(`[YjsContainerSync] Getting file list from: ${urlString}`);
      const url = new URL(urlString);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "GET",
        headers: serviceToken ? {
          "X-Container-Service-Token": serviceToken,
        } : {},
      };

      return new Promise((resolve, reject) => {
        const client = url.protocol === "https:" ? https : http;
        const req = client.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            console.log(`[YjsContainerSync] 📡 Backend file list response:`, {
              statusCode: res.statusCode,
              dataLength: data.length,
              hasServiceToken: !!serviceToken,
              url: urlString
            });
            if (res.statusCode !== 200) {
              console.warn(`[YjsContainerSync] ⚠️  Failed to get file list from backend: ${res.statusCode}`, {
                response: data.substring(0, 200)
              });
              resolve([]);
              return;
            }
            try {
              const jsonData = JSON.parse(data);
              console.log(`[YjsContainerSync] ✅ Got file list from backend:`, jsonData.files);
              resolve(jsonData.files || []);
            } catch (error) {
              console.error("[YjsContainerSync] Failed to parse file list response:", error);
              resolve([]);
            }
          });
        });
        
        req.on("error", (error) => {
          console.error("[YjsContainerSync] Error getting file list from backend:", error);
          resolve([]);
        });
        
        req.end();
      });
    } catch (error) {
      console.error("[YjsContainerSync] Error getting file list from backend:", error);
      return [];
    }
  }

  async startFileWatcher() {
    this.watcher = chokidar.watch(WORKSPACE_PATH, {
      awaitWriteFinish: {
        stabilityThreshold: 500, // Wait 500ms after file size stops changing
        pollInterval: 100 // Check every 100ms
      },
      ignorePermissionErrors: true,
      ignored: [
        /(^|[\/\\])\../,
        /node_modules/,
        /\.git/,
        /__pycache__/,
        /\.vscode/,
        /\.idea/,
        /\.yjs/,
        /\.partial$/,  // Ignore .partial files (temporary files)
      ],
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher
      .on("add", (filePath) => {
        try {
          this.handleFileChange(filePath, "add");
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Error handling file add for ${filePath}:`, error);
          console.error(`[YjsContainerSync] Error stack:`, error.stack);
        }
      })
      .on("change", (filePath) => {
        try {
          this.handleFileChange(filePath, "change");
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Error handling file change for ${filePath}:`, error);
          console.error(`[YjsContainerSync] Error stack:`, error.stack);
        }
      })
      .on("unlink", (filePath) => {
        try {
          this.handleFileChange(filePath, "unlink");
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Error handling file unlink for ${filePath}:`, error);
          console.error(`[YjsContainerSync] Error stack:`, error.stack);
        }
      })
      .on("error", (error) => {
        console.error("[YjsContainerSync] ❌ File watcher error:", error);
        console.error("[YjsContainerSync] Error stack:", error.stack);
        // Don't throw - let the watcher continue
      });

    console.log("[YjsContainerSync] File watcher started");
  }

  async handleFileChange(filePath, event) {
    // Calculate relativePath outside try block so it's available in setTimeout
    let relativePath;
    try {
      relativePath = path.relative(WORKSPACE_PATH, filePath);

      // Log what we're processing for debugging
      console.log(`[YjsContainerSync] 📝 File change detected: ${relativePath} (event: ${event})`);

    if (this.shouldIgnoreFile(relativePath)) {
        console.log(`[YjsContainerSync] ⏭️  Ignoring file (matches ignore pattern): ${relativePath}`);
        return;
      }

      // Skip if we're currently syncing this file from Y.js (prevents sync loops)
      // EXCEPTION: Don't skip "add" events - new files must be synced to Y.js
      if (this.syncingFromYjs.has(relativePath) && event !== "add") {
        console.log(`[YjsContainerSync] ⏭️  Skipping file change (syncing from Y.js): ${relativePath}`);
        return;
      }
      
      // For "add" events during Y.js sync, log but continue to ensure file content is sent
      if (this.syncingFromYjs.has(relativePath) && event === "add") {
        console.log(`[YjsContainerSync] ⚠️  New file detected during Y.js sync, will sync file content anyway: ${relativePath}`);
      }
    } catch (error) {
      console.error(`[YjsContainerSync] ❌ Error in handleFileChange for ${filePath}:`, error);
      console.error(`[YjsContainerSync] Error stack:`, error.stack);
      // Don't throw - continue processing other files
      return;
    }

    // Ensure relativePath is defined before using it
    if (!relativePath) {
      console.error(`[YjsContainerSync] ❌ relativePath is undefined for ${filePath}`);
      return;
    }

    // Debounce file changes
    // Ensure relativePath is available (it was calculated in the try block above)
    if (!relativePath) {
      console.error(`[YjsContainerSync] ❌ relativePath is undefined for ${filePath}`);
      return;
    }
    
    if (this.fileChangeTimeouts.has(relativePath)) {
      clearTimeout(this.fileChangeTimeouts.get(relativePath));
    }

    // CRITICAL: Set timeout immediately to block Y.js from syncing to file during this window
    // This prevents Y.js from overwriting file changes that are in progress
    const timeout = setTimeout(async () => {
      try {
        // Recalculate relativePath inside timeout to ensure it's correct
        const relativePath = path.relative(WORKSPACE_PATH, filePath);
        
        if (event === "unlink") {
          console.log(`[YjsContainerSync] File deleted: ${relativePath}`);
          // Broadcast file-tree-change delete so IDE removes the file
          // Then unsubscribe and clean up locally. Do NOT clear Y.js content -
          // that sends a yjs-update to the backend which would recreate the document.
          if (this.socket && this.isConnected) {
            try {
              this.socket.emit("file-tree-change", {
                bucketId: BUCKET_ID,
                filePath: relativePath,
                action: "delete",
              });
              this.socket.emit("unsubscribe-document", {
                bucketId: BUCKET_ID,
                filePath: relativePath,
              });
              // Clean up local document state (keyed by filePath)
              if (this.documents.has(relativePath)) {
                const doc = this.documents.get(relativePath);
                doc.destroy();
                this.documents.delete(relativePath);
              }
              // Cancel any pending file writes for this file
              if (this.pendingFileWrites.has(relativePath)) {
                clearTimeout(this.pendingFileWrites.get(relativePath));
                this.pendingFileWrites.delete(relativePath);
              }
              console.log(`[YjsContainerSync] 🗑️  Broadcasted delete and cleaned up Y.js for: ${relativePath}`);
            } catch (error) {
              console.error(`[YjsContainerSync] ❌ Error handling Y.js cleanup for deleted file ${relativePath}:`, error);
            }
          }
        } else {
          // CRITICAL: For new files, subscribe FIRST to ensure backend creates document
          // Then sync file content to Y.js
          if (this.socket && this.isConnected) {
            try {
              // Subscribe to document first (this creates the document on backend)
            this.socket.emit("subscribe-document", {
              bucketId: BUCKET_ID,
              filePath: relativePath,
            });
              
              if (event === "add") {
                console.log(`[YjsContainerSync] 🔔 Subscribed to new file: ${relativePath}`);
              } else {
                console.log(`[YjsContainerSync] 🔔 Ensuring subscription for file: ${relativePath}`);
              }
              
              // Wait for subscription response to complete before syncing
              // This ensures the backend has created the document
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
              console.error(`[YjsContainerSync] ❌ Error subscribing to document for ${relativePath}:`, error);
              // Continue anyway - might still work
            }
          }
          
          // Now sync file content to Y.js (backend document exists now)
          try {
          const doc = this.getOrCreateDocument(relativePath);
            // Sync file to Y.js - this will update Y.js with filesystem content
            // Even if Y.js is currently empty (from previous deletion), this will populate it
          await this.syncFileToYjs(relativePath, doc);
            
            // CRITICAL: Cancel any pending batched writes for this file
            // since we're syncing from filesystem (actual changes from terminal/commands)
            if (this.pendingFileWrites.has(relativePath)) {
              clearTimeout(this.pendingFileWrites.get(relativePath));
              this.pendingFileWrites.delete(relativePath);
              console.log(`[YjsContainerSync] ✅ Cancelled pending batched write (filesystem change detected): ${relativePath}`);
            }
          } catch (error) {
            console.error(`[YjsContainerSync] ❌ Error syncing file ${relativePath} to Y.js:`, error);
            console.error(`[YjsContainerSync] Error stack:`, error.stack);
            // Don't throw - continue processing other files
          }
        }
      } catch (error) {
        console.error(`[YjsContainerSync] ❌ CRITICAL: Unexpected error in file change handler:`, error);
        console.error(`[YjsContainerSync] Error stack:`, error.stack);
        // Don't throw - continue processing other files
      } finally {
        this.fileChangeTimeouts.delete(path.relative(WORKSPACE_PATH, filePath));
      }
    }, 1000); // Increased from 500ms to 1000ms to allow file writes to complete

    // Store timeout so we can check if file change is in progress
    this.fileChangeTimeouts.set(relativePath, timeout);
  }

  async syncFileToYjs(filePath, doc) {
    try {
      const fullPath = path.join(WORKSPACE_PATH, filePath);
      
      // Verify file exists before reading
      try {
        await fs.access(fullPath);
      } catch (error) {
        if (error.code === "ENOENT") {
          console.log(`[YjsContainerSync] ⏭️  File does not exist, skipping sync: ${filePath}`);
          return;
        }
        throw error;
      }
      
      // CRITICAL: Wait for file write to complete before reading
      // Files can be written in chunks, so we need to wait for the file size to stabilize
      let previousSize = 0;
      let stableCount = 0;
      const maxWaitTime = 2000; // Max 2 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        try {
          const stats = await fs.stat(fullPath);
          if (stats.size === previousSize) {
            stableCount++;
            if (stableCount >= 3) {
              // File size has been stable for 3 checks (300ms), safe to read
              break;
            }
          } else {
            stableCount = 0;
            previousSize = stats.size;
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            console.log(`[YjsContainerSync] ⏭️  File deleted while waiting, skipping sync: ${filePath}`);
            return;
          }
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const content = await fs.readFile(fullPath, "utf-8");

      const ytext = doc.getText("content");
      const currentContent = ytext.toString();

      // Always sync if content is different
      // This handles:
      // 1. Normal file updates
      // 2. File was deleted in IDE (Y.js empty) and then recreated in container
      // 3. File was overwritten with new content (old content not replaced)
      if (currentContent !== content) {
        // CRITICAL: Always clear and replace to ensure old content is fully removed
        // This prevents issues where partial updates might leave stale content
        // Use transaction to ensure atomic update
        try {
          doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
          }, "filesystem-sync");
          
          console.log(`[YjsContainerSync] ✅ Synced file to Y.js: ${filePath}`, {
            contentLength: content.length,
            previousLength: currentContent.length,
            changed: true,
            wasEmpty: currentContent.length === 0,
            wasOverwrite: currentContent.length > 0 && content.length > 0,
            contentPreview: content.substring(0, 50),
            previousPreview: currentContent.substring(0, 50)
          });
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Error updating Y.js document for ${filePath}:`, error);
          console.error(`[YjsContainerSync] Error stack:`, error.stack);
          throw error; // Re-throw to be caught by outer catch
        }
      } else {
        // Even if content matches, log it for debugging
        // This helps identify when files aren't updating as expected
        console.log(`[YjsContainerSync] ⏭️  File unchanged, skipping sync: ${filePath}`, {
          contentLength: content.length,
          yjsLength: currentContent.length,
          contentPreview: content.substring(0, 50),
          yjsPreview: currentContent.substring(0, 50),
          filesMatch: content === currentContent
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`[YjsContainerSync] ❌ Failed to read/sync file ${filePath}:`, error);
        console.error(`[YjsContainerSync] Error stack:`, error.stack);
        // Don't throw - log and continue
      }
    }
  }

  async handleFileTreeChange(data) {
    const { filePath, action } = data;

    if (this.shouldIgnoreFile(filePath)) {
      return;
    }

    if (action === "delete") {
      // File was explicitly deleted in IDE - delete it from filesystem immediately
      console.log(`[YjsContainerSync] 🗑️  File explicitly deleted in IDE: ${filePath}`);

      const fullPath = path.join(WORKSPACE_PATH, filePath);
      try {
        await fs.access(fullPath);
        await fs.unlink(fullPath);
        console.log(`[YjsContainerSync] ✅ Deleted file from filesystem (explicit deletion): ${filePath}`);
      } catch (error) {
        if (error.code === "ENOENT") {
          // File doesn't exist, that's fine - already deleted
          console.log(`[YjsContainerSync] File already deleted: ${filePath}`);
        } else {
          console.error(`[YjsContainerSync] ❌ Failed to delete file ${filePath}:`, error);
        }
      }

      // Unsubscribe from the Y.js document and clean up local state
      // Do NOT clear Y.js content - that sends a yjs-update to the backend which
      // would recreate the document. The backend already handles cleanup.
      try {
        if (this.socket && this.isConnected) {
          this.socket.emit("unsubscribe-document", {
            bucketId: BUCKET_ID,
            filePath: filePath,
          });
        }
        // Clean up local document state (keyed by filePath)
        if (this.documents.has(filePath)) {
          const doc = this.documents.get(filePath);
          doc.destroy();
          this.documents.delete(filePath);
        }
        // Cancel any pending file writes for this file
        if (this.pendingFileWrites.has(filePath)) {
          clearTimeout(this.pendingFileWrites.get(filePath));
          this.pendingFileWrites.delete(filePath);
        }
        console.log(`[YjsContainerSync] ✅ Unsubscribed and cleaned up Y.js document for deleted file: ${filePath}`);
      } catch (error) {
        console.error(`[YjsContainerSync] ❌ Failed to clean up Y.js for deleted file ${filePath}:`, error);
      }
    } else if (action === "create") {
      // CRITICAL: File was created in IDE - we MUST subscribe to receive YJS updates
      // Without subscribing, we won't be in the room and won't receive content updates
      console.log(`[YjsContainerSync] 📝 File created in IDE, subscribing to document: ${filePath}`);

      if (this.socket && this.isConnected) {
        // Subscribe to the document first
        this.socket.emit("subscribe-document", {
          bucketId: BUCKET_ID,
          filePath: filePath,
        });

        // Get or create the Y.js document locally
        const doc = this.getOrCreateDocument(filePath);

        // Create the file in the workspace (empty initially, will be filled by YJS updates)
        const fullPath = path.join(WORKSPACE_PATH, filePath);
        try {
          const dir = path.dirname(fullPath);
          await fs.mkdir(dir, { recursive: true });
          // Check if file already exists
          try {
            await fs.access(fullPath);
            console.log(`[YjsContainerSync] File already exists, waiting for YJS sync: ${filePath}`);
          } catch {
            // File doesn't exist, create it empty
            await fs.writeFile(fullPath, "", "utf-8");
            console.log(`[YjsContainerSync] ✅ Created empty file, waiting for YJS sync: ${filePath}`);
          }
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Failed to create file ${filePath}:`, error);
        }
      } else {
        console.warn(`[YjsContainerSync] ⚠️  Cannot subscribe to new file - not connected: ${filePath}`);
      }
    }
  }

  async handleYjsUpdate(data) {
    const { filePath, update, bucketId } = data;

    if (!filePath) {
      console.error(`[YjsContainerSync] ❌ Received Y.js update with no filePath:`, data);
      return;
    }

    // Verify bucketId matches (safety check)
    if (bucketId && bucketId !== BUCKET_ID) {
      console.error(`[YjsContainerSync] ❌ Received Y.js update for wrong bucket:`, {
        received: bucketId,
        expected: BUCKET_ID,
        filePath
      });
      return;
    }

    if (this.shouldIgnoreFile(filePath)) {
      return;
    }

    try {
      // CRITICAL: Get the document for THIS specific filePath
      // Verify the document exists in our map before applying update
      if (!this.documents.has(filePath)) {
        console.log(`[YjsContainerSync] 📝 Creating new document for ${filePath} (not in map yet)`);
      }
      
      const doc = this.getOrCreateDocument(filePath);
      
      // Double-check we got the right document
      const docFromMap = this.documents.get(filePath);
      if (doc !== docFromMap) {
        console.error(`[YjsContainerSync] ❌ CRITICAL: Document mismatch for ${filePath}!`, {
          docFromGetOrCreate: !!doc,
          docFromMap: !!docFromMap,
          areEqual: doc === docFromMap
        });
        return;
      }
      
      const ytextBefore = doc.getText("content");
      const contentBefore = ytextBefore.toString();
      
      const updateBuffer = Buffer.from(update, "base64");
      // Apply update with "server" origin to prevent echo back to server
      Y.applyUpdate(doc, new Uint8Array(updateBuffer), "server");

      const ytextAfter = doc.getText("content");
      const contentAfter = ytextAfter.toString();
      
      console.log(`[YjsContainerSync] 📥 Received Y.js update for ${filePath}`, {
        updateSize: update.length,
        contentBeforeLength: contentBefore.length,
        contentAfterLength: contentAfter.length,
        changed: contentBefore !== contentAfter,
        bucketId: bucketId || BUCKET_ID,
        docInMap: this.documents.has(filePath)
      });

      // CRITICAL FIX: Don't immediately write remote updates to filesystem
      // This prevents the feedback loop: remote update -> file write -> file watch -> YJS update -> back to IDE
      // Instead, schedule a debounced write that will only happen after 2.5 seconds of inactivity
      this.lastRemoteUpdateTime.set(filePath, Date.now());
      this.scheduleBatchedFileWrite(filePath, doc);
    } catch (error) {
      console.error(`[YjsContainerSync] ❌ Failed to handle Y.js update for ${filePath}:`, error);
    }
  }

  async handleDocumentState(data) {
    const { filePath, state } = data;

    if (this.shouldIgnoreFile(filePath)) {
      return;
    }

    try {
      const doc = this.getOrCreateDocument(filePath);
      const stateBuffer = Buffer.from(state, "base64");

      // CRITICAL FIX: Before applying server state, check if local file has content
      // If local file exists with content and server state is empty, LOCAL WINS
      // This prevents stale/empty server state from overwriting container's files
      const fullPath = path.join(WORKSPACE_PATH, filePath);
      let localContent = null;
      let localFileExists = false;

      try {
        localContent = await fs.readFile(fullPath, "utf-8");
        localFileExists = true;
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.error(`[YjsContainerSync] ❌ Error reading local file ${filePath}:`, error);
        }
        // File doesn't exist locally - that's fine, server state will create it
      }

      // Apply server state to Y.js document to see what content it has
      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, new Uint8Array(stateBuffer), "server");
      const serverContent = tempDoc.getText("content").toString();

      console.log(`[YjsContainerSync] 📥 Received document-state for ${filePath}`, {
        serverContentLength: serverContent.length,
        localContentLength: localContent?.length || 0,
        localFileExists,
        serverPreview: serverContent.substring(0, 50),
        localPreview: localContent?.substring(0, 50) || "(no local file)"
      });

      // CRITICAL DECISION: Who wins?
      // 1. If server has content and local doesn't exist -> SERVER WINS (create file)
      // 2. If server is empty and local has content -> LOCAL WINS (sync to server)
      // 3. If both have content and differ -> SERVER WINS (trust S3 as source of truth)
      // 4. If both empty -> No action needed

      if (localFileExists && localContent && localContent.length > 0 && serverContent.length === 0) {
        // LOCAL WINS - server is empty but we have local content
        // This handles the case where server hasn't synced yet or backend restarted
        console.log(`[YjsContainerSync] 🏆 LOCAL WINS: Server state is empty but local file has content: ${filePath}`);
        console.log(`[YjsContainerSync] 📤 Syncing local content TO server for ${filePath}`);

        // Update Y.js with local content (this will trigger update to server)
        const ytext = doc.getText("content");
        doc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, localContent);
        }, "local-file-sync");

        console.log(`[YjsContainerSync] ✅ Synced local file content to Y.js (will propagate to server): ${filePath}`);
        this.checkInitialSyncProgress(filePath);
        return; // Don't write server state to file
      }

      // SERVER WINS - apply server state to our document
      Y.applyUpdate(doc, new Uint8Array(stateBuffer), "server");

      // Cancel any pending file change timeout for this file
      if (this.fileChangeTimeouts.has(filePath)) {
        clearTimeout(this.fileChangeTimeouts.get(filePath));
        this.fileChangeTimeouts.delete(filePath);
        console.log(`[YjsContainerSync] 🔄 Cancelled pending file change for ${filePath} - server state takes precedence`);
      }

      // Write server state to file (only if server has content or file doesn't exist)
      if (serverContent.length > 0 || !localFileExists) {
        await this.syncYjsToFile(filePath, doc, true);
        console.log(`[YjsContainerSync] 🏆 SERVER WINS: Applied server state to file: ${filePath}`);
      } else {
        console.log(`[YjsContainerSync] ⏭️  Skipping file write - both server and local are empty: ${filePath}`);
      }

      this.checkInitialSyncProgress(filePath);
    } catch (error) {
      console.error(`[YjsContainerSync] ❌ Failed to handle document state for ${filePath}:`, error);
      // Even on error, mark file as processed for initial sync to avoid blocking
      this.checkInitialSyncProgress(filePath);
    }
  }

  async syncYjsToFile(filePath, doc, forceImmediate = false) {
    // CRITICAL: Skip if we're currently processing a file change for this file
    // This prevents Y.js from overwriting file changes that are in progress
    if (this.fileChangeTimeouts.has(filePath)) {
      console.log(`[YjsContainerSync] ⏭️  Skipping Y.js to file sync - file change in progress: ${filePath}`);
      return;
    }
    
    // Mark that we're syncing from Y.js to prevent file watcher from syncing back
    this.syncingFromYjs.add(filePath);

    try {
      const ytext = doc.getText("content");
      const content = ytext.toString();

      const fullPath = path.join(WORKSPACE_PATH, filePath);

      // Skip write if file content is unchanged to avoid resetting the inactivity timer.
      // The inactivity monitor uses inotifywait on /workspace, so unnecessary writes
      // prevent containers from ever auto-shutting down.
      try {
        const currentContent = await fs.readFile(fullPath, "utf-8");
        if (currentContent === content) {
          console.log(`[YjsContainerSync] Content unchanged, skipping file write: ${filePath}`);
          return;
        }
      } catch (readError) {
        // File doesn't exist (ENOENT) - proceed with write
        if (readError.code !== "ENOENT") {
          console.warn(`[YjsContainerSync] Could not read file for comparison: ${filePath}`, readError);
        }
      }

      // If Y.js content is empty, write empty file (don't delete)
      // File deletion is handled explicitly via file-tree-change events
      // Empty files are valid - users can clear all content without deleting the file
      if (content.length === 0) {
        try {
          const dir = path.dirname(fullPath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(fullPath, "", "utf-8");
          console.log(`[YjsContainerSync] ✅ Synced Y.js to file (empty content): ${filePath}`);
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Failed to write empty file ${filePath}:`, error);
          throw error;
        }
      } else {
        // File has content, write it
        try {
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
          const writeReason = forceImmediate ? "immediate (filesystem change)" : "batched (remote update)";
          console.log(`[YjsContainerSync] ✅ Synced Y.js to file (${writeReason}): ${filePath}`, {
            contentLength: content.length,
            contentPreview: content.substring(0, 50)
          });
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Failed to write file ${filePath}:`, error);
          throw error; // Re-throw to be caught by outer catch
        }
      }
    } catch (error) {
      console.error(`[YjsContainerSync] ❌ Failed to sync Y.js to file ${filePath}:`, error);
      // Don't throw - log and continue
    } finally {
      // CRITICAL: Remove from syncing set AFTER a longer delay to prevent race conditions
      // The file watcher might detect the file change immediately after we write it
      // So we need to keep the syncingFromYjs flag set longer
      setTimeout(() => {
        console.log(`[YjsContainerSync] 🏁 Clearing syncing flag for ${filePath}`);
        this.syncingFromYjs.delete(filePath);
      }, 3000); // Increased from 1000ms to 3000ms
    }
  }

  /**
   * Schedule a batched file write for remote YJS updates
   * This prevents the feedback loop where every keystroke causes a file write,
   * which triggers a file watch event, which syncs back to YJS, causing flickering
   */
  scheduleBatchedFileWrite(filePath, doc) {
    // Cancel existing pending write for this file
    if (this.pendingFileWrites.has(filePath)) {
      clearTimeout(this.pendingFileWrites.get(filePath));
    }

    // SMART BATCHING: Use shorter delay for significant changes, longer for keystrokes
    // This balances responsiveness (for running code) with debouncing (for typing)
    const ytext = doc.getText("content");
    const content = ytext.toString();
    const lastUpdateTime = this.lastRemoteUpdateTime.get(filePath) || 0;
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;

    // If >2 seconds since last update, this is likely a significant change (not rapid typing)
    // Use short delay for immediate feedback
    // Otherwise use longer delay to batch keystrokes
    const isLikelySignificantChange = timeSinceLastUpdate > 2000 || content.length > 1000;
    const debounceMs = isLikelySignificantChange ? 300 : 800;

    // Schedule a new write after debounce period
    const timeout = setTimeout(async () => {
      try {
        console.log(`[YjsContainerSync] 💾 Writing batched update to filesystem: ${filePath}`);
        await this.syncYjsToFile(filePath, doc, false);
        this.pendingFileWrites.delete(filePath);
        this.lastRemoteUpdateTime.delete(filePath);
      } catch (error) {
        console.error(`[YjsContainerSync] ❌ Failed to write batched update for ${filePath}:`, error);
      }
    }, debounceMs);

    this.pendingFileWrites.set(filePath, timeout);
    console.log(`[YjsContainerSync] ⏰ Scheduled batched write for ${filePath} (${debounceMs}ms debounce, significant=${isLikelySignificantChange})`);
  }

  /**
   * Mark initial sync as complete and write marker file
   */
  markInitialSyncComplete() {
    if (this.initialSyncComplete) return;
    this.initialSyncComplete = true;
    this.pendingInitialFiles.clear();
    try {
      require("fs").writeFileSync("/tmp/initial-sync-complete", Date.now().toString());
      console.log(`[YjsContainerSync] ✅ Initial sync complete - wrote /tmp/initial-sync-complete`);
    } catch (error) {
      console.error(`[YjsContainerSync] ❌ Failed to write initial sync marker:`, error);
    }
  }

  /**
   * Called after a file's document-state is processed during initial sync
   */
  checkInitialSyncProgress(filePath) {
    if (this.initialSyncComplete) return;
    this.pendingInitialFiles.delete(filePath);
    console.log(`[YjsContainerSync] 📋 Initial sync progress: ${this.pendingInitialFiles.size} files remaining`);
    if (this.pendingInitialFiles.size === 0) {
      console.log(`[YjsContainerSync] 📋 All initial files synced!`);
      this.markInitialSyncComplete();
    }
  }

  getOrCreateDocument(filePath) {
    if (this.documents.has(filePath)) {
      return this.documents.get(filePath);
    }

    const doc = new Y.Doc();
    this.documents.set(filePath, doc);

    // Create a closure to capture the filePath for this specific document
    // This ensures the correct filePath is used even if the variable changes
    const capturedFilePath = filePath;
    const updateHandler = (update, origin) => {
      // Skip updates that came from the server (they're already synced)
      // BUT: We need to send filesystem-sync updates to the server so they can be broadcast to other clients
      // Only skip updates that actually came from the server
      const isServerOrigin = origin === "server" || 
                            (typeof origin === "string" && origin === "server") ||
                            (origin && origin.toString && origin.toString() === "server");
      
      // CRITICAL: Do NOT skip "filesystem-sync" origin - these need to be sent to the server
      // so that other clients (like the IDE) receive the updates
      // "filesystem-sync" means we synced from the filesystem to Y.js, and now we need to
      // send that update to the server so it can broadcast to other clients
      
      if (isServerOrigin) {
        console.log(`[YjsContainerSync] ⏭️  Skipping update send (origin is ${String(origin)}) for ${capturedFilePath}`);
        return;
      }

      // Send update to server (this includes updates from filesystem changes)
      if (this.socket && this.isConnected) {
        try {
        const updateBase64 = Buffer.from(update).toString("base64");
          // CRITICAL: Use the captured filePath, not a variable that might have changed
        this.socket.emit("yjs-update", {
          bucketId: BUCKET_ID,
            filePath: capturedFilePath, // Use captured filePath from closure
          update: updateBase64,
        });
          console.log(`[YjsContainerSync] ✅ Sent filesystem update to server for ${capturedFilePath}`, {
            origin: String(origin),
            updateSize: update.length,
            filePath: capturedFilePath // Log to verify correct filePath
          });
        } catch (error) {
          console.error(`[YjsContainerSync] ❌ Failed to send update for ${capturedFilePath}:`, error);
        }
      } else {
        console.warn(`[YjsContainerSync] ⚠️  Cannot send update for ${capturedFilePath}: socket=${!!this.socket}, connected=${this.isConnected}`);
      }
    };
    
    doc.on("update", updateHandler);

    return doc;
  }

  async listFilesRecursive(dirPath) {
    const files = [];

    const walk = async (currentPath) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (this.shouldIgnoreFile(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    await walk(dirPath);
    return files;
  }

  shouldIgnoreFile(filePath) {
    const ignorePatterns = [
      /^\./,
      /node_modules/,
      /\.git/,
      /__pycache__/,
      /\.vscode/,
      /\.idea/,
      /\.yjs/,
      /\.partial$/,  // Ignore .partial files (temporary files)
    ];

    return ignorePatterns.some((pattern) => pattern.test(filePath));
  }

  async stop() {
    console.log("[YjsContainerSync] Stopping service...");

    if (this.watcher) {
      await this.watcher.close();
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.fileChangeTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.fileChangeTimeouts.clear();

    // Clear pending file writes
    this.pendingFileWrites.forEach((timeout) => clearTimeout(timeout));
    this.pendingFileWrites.clear();

    console.log("[YjsContainerSync] Service stopped");
  }
}

// Start the service
const sync = new YjsContainerSync();
sync.start().catch((error) => {
  console.error("[YjsContainerSync] ❌ CRITICAL: Failed to start:", error);
  console.error("[YjsContainerSync] Stack trace:", error.stack);
  // Don't exit immediately - let the process handle it naturally
  // This prevents Docker from restarting too aggressively
  setTimeout(() => {
  process.exit(1);
  }, 5000);
});

// Handle uncaught errors to prevent crashes
process.on("uncaughtException", (error) => {
  console.error("[YjsContainerSync] ❌ CRITICAL: Uncaught exception:", error);
  console.error("[YjsContainerSync] Stack trace:", error.stack);
  // Log but don't exit - let the service try to recover
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[YjsContainerSync] ❌ CRITICAL: Unhandled promise rejection:", reason);
  console.error("[YjsContainerSync] Promise:", promise);
  // Log but don't exit - let the service try to recover
});

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[YjsContainerSync] Received SIGTERM, shutting down gracefully...");
  try {
    await sync.stop();
    process.exit(0);
  } catch (error) {
    console.error("[YjsContainerSync] Error during shutdown:", error);
    process.exit(1);
  }
});

process.on("SIGINT", async () => {
  console.log("[YjsContainerSync] Received SIGINT, shutting down gracefully...");
  try {
  await sync.stop();
  process.exit(0);
  } catch (error) {
    console.error("[YjsContainerSync] Error during shutdown:", error);
    process.exit(1);
  }
});

process.on("SIGINT", async () => {
  await sync.stop();
  process.exit(0);
});

