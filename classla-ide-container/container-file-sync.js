#!/usr/bin/env node
/**
 * Container File Sync Service (OT-based, Modal Architecture)
 *
 * Operates in Mode B when registered: the container filesystem is the authority.
 * - Receives real-time OT operations from the frontend via Socket.IO
 * - Pushes container filesystem changes to the backend via REST
 * - On startup, fetches all files via bulk-content endpoint (OT-aware)
 */

const chokidar = require("chokidar");
const fs = require("fs").promises;
const path = require("path");
const http = require("http");
const https = require("https");
const { io: socketIOClient } = require("socket.io-client");

// Binary file detection by extension
const BINARY_EXTENSIONS = new Set([
  'class', 'jar', 'war',                    // Java
  'o', 'obj', 'exe', 'dll', 'so', 'dylib',  // Compiled
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',  // Images
  'pdf',                                     // Documents
  'zip', 'tar', 'gz', 'bz2', '7z', 'rar',   // Archives
  'wasm',                                    // WebAssembly
  'bin', 'dat',                              // Generic
  'pyc', 'pyo',                              // Python compiled
  'ttf', 'otf', 'woff', 'woff2',            // Fonts
]);
function isBinaryFile(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTENSIONS.has(ext || '');
}

// Configuration
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
let BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:8000/api";
const BUCKET_ID = process.env.S3_BUCKET_ID || "";
const CONTAINER_SERVICE_TOKEN = process.env.CONTAINER_SERVICE_TOKEN || "";

// Fix Docker networking: replace localhost with host.docker.internal
if (
  (BACKEND_API_URL.includes("localhost") || BACKEND_API_URL.includes("127.0.0.1")) &&
  (process.env.HOSTNAME || require("fs").existsSync("/.dockerenv"))
) {
  BACKEND_API_URL = BACKEND_API_URL.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal");
  console.log(`[ContainerSync] Using host.docker.internal: ${BACKEND_API_URL}`);
}

if (!BUCKET_ID) {
  console.error("[ContainerSync] ERROR: S3_BUCKET_ID is required");
  process.exit(1);
}

// Derive Socket.IO URL from BACKEND_API_URL (strip /api path)
function getSocketIOUrl() {
  const url = new URL(BACKEND_API_URL);
  return `${url.protocol}//${url.host}`;
}

// ============================================================================
// TextOperation — apply-only, minimal port from server's TextOperation.ts
// ============================================================================

class TextOperation {
  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  retain(n) {
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && this.ops[this.ops.length - 1] > 0) {
      this.ops[this.ops.length - 1] += n;
    } else {
      this.ops.push(n);
    }
    return this;
  }

  insert(str) {
    if (str === "") return this;
    this.targetLength += str.length;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "string") {
      this.ops[this.ops.length - 1] += str;
    } else {
      this.ops.push(str);
    }
    return this;
  }

  delete(n) {
    if (n === 0) return this;
    this.baseLength += n;
    const negN = -n;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && this.ops[this.ops.length - 1] < 0) {
      this.ops[this.ops.length - 1] += negN;
    } else {
      this.ops.push(negN);
    }
    return this;
  }

  apply(doc) {
    if (doc.length !== this.baseLength) {
      throw new Error(`Cannot apply operation: expected doc length ${this.baseLength}, got ${doc.length}`);
    }
    const parts = [];
    let index = 0;
    for (const op of this.ops) {
      if (typeof op === "number") {
        if (op > 0) {
          parts.push(doc.slice(index, index + op));
          index += op;
        } else {
          index += -op;
        }
      } else {
        parts.push(op);
      }
    }
    return parts.join("");
  }

  static fromJSON(ops) {
    const o = new TextOperation();
    for (const op of ops) {
      if (typeof op === "number") {
        if (op > 0) o.retain(op);
        else o.delete(-op);
      } else if (typeof op === "string") {
        o.insert(op);
      }
    }
    return o;
  }
}

// ============================================================================
// OTReceiver — receives real-time OT operations via Socket.IO
// ============================================================================

class OTReceiver {
  constructor(syncingFiles) {
    this.socket = null;
    this.registered = false;
    this.hasCompletedInitialSync = false; // set to true after first register(); used to re-register on reconnect
    this.contentCache = new Map(); // filePath → string content
    this.syncingFiles = syncingFiles; // shared with ContainerFileSync
    this.bufferedEvents = []; // buffer events before registration
    this.buffering = true;
    this.pendingWrites = new Set(); // in-flight disk write promises (for flush)
    // Per-file timeout handles for syncingFiles cleanup. When multiple rapid
    // writes happen for the same file (e.g. user typing fast), each new write
    // must CANCEL the previous timeout and set a fresh one. Without this,
    // the first timeout's delete fires prematurely and removes the guard
    // while later writes are still within their 2s window.
    this.syncingTimeouts = new Map(); // filePath → timeout handle
    // Secondary echo detection for syncFromBackendOT writes.
    // Records what syncFromBackendOT wrote so the file watcher can detect
    // stale flush echoes even if the primary cache was updated by a newer
    // remote-operation in the meantime.
    this.lastFlushWriteContent = new Map(); // filePath → content
  }

  connect() {
    const socketUrl = getSocketIOUrl();
    console.log(`[OTReceiver] Connecting to ${socketUrl}/ot`);

    this.socket = socketIOClient(`${socketUrl}/ot`, {
      auth: { token: CONTAINER_SERVICE_TOKEN },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on("connect", () => {
      console.log(`[OTReceiver] Connected (socketId=${this.socket.id})`);
      if (this.hasCompletedInitialSync) {
        // Reconnect after a disconnect — re-register immediately since bulk sync is already done.
        // The server removes containers from Socket.IO rooms on disconnect, so we must re-join.
        console.log(`[OTReceiver] Reconnected — re-registering for bucket ${BUCKET_ID}`);
        this.socket.emit("container-register", { bucketId: BUCKET_ID });

        // Bug #5: Sync from backend OT after reconnect to recover any operations
        // lost while disconnected (Socket.IO has no server-side buffer).
        this.syncFromBackendOT().then(() => {
          console.log(`[OTReceiver] Post-reconnect sync complete`);
        }).catch((err) => {
          console.error(`[OTReceiver] Post-reconnect sync failed:`, err.message);
        });
      }
      // On first connect, don't register yet — wait for bulk-content sync to complete.
    });

    this.socket.on("disconnect", (reason) => {
      console.log(`[OTReceiver] Disconnected: ${reason}`);
      this.registered = false;
    });

    this.socket.on("connect_error", (err) => {
      console.error(`[OTReceiver] Connection error: ${err.message}`);
    });

    this.socket.on("container-registered", (data) => {
      if (data.success) {
        console.log(`[OTReceiver] Registered for bucket ${data.bucketId}`);
        this.registered = true;
      } else {
        console.error(`[OTReceiver] Registration failed: ${data.error}`);
      }
    });

    // Listen for OT operations (buffer until registered)
    this.socket.on("remote-operation", (data) => {
      if (this.buffering) {
        this.bufferedEvents.push({ type: "remote-operation", data });
        return;
      }
      this._handleRemoteOperation(data);
    });

    // Listen for file tree changes (buffer until registered)
    this.socket.on("file-tree-change", (data) => {
      if (this.buffering) {
        this.bufferedEvents.push({ type: "file-tree-change", data });
        return;
      }
      this._handleFileTreeChange(data);
    });

    this.socket.on("error", (err) => {
      console.error(`[OTReceiver] Socket error:`, err);
    });
  }

  /**
   * Register with the backend — activates Mode B.
   * Call this AFTER initial sync is complete.
   */
  register() {
    if (!this.socket?.connected) {
      console.error("[OTReceiver] Cannot register: not connected");
      return;
    }
    console.log(`[OTReceiver] Registering for bucket ${BUCKET_ID}`);
    this.socket.emit("container-register", { bucketId: BUCKET_ID });
    this.hasCompletedInitialSync = true;
  }

  /**
   * Apply any buffered events that arrived between connect and registration
   */
  applyBufferedEvents() {
    this.buffering = false;
    const count = this.bufferedEvents.length;
    if (count > 0) {
      console.log(`[OTReceiver] Applying ${count} buffered events`);
      for (const event of this.bufferedEvents) {
        if (event.type === "remote-operation") {
          this._handleRemoteOperation(event.data);
        } else if (event.type === "file-tree-change") {
          this._handleFileTreeChange(event.data);
        }
      }
    }
    this.bufferedEvents = [];
  }

  /**
   * Initialize content cache from bulk-content files
   */
  initCache(files) {
    for (const file of files) {
      if (file.encoding === 'utf-8') {
        this.contentCache.set(file.path, file.content);
      }
    }
    console.log(`[OTReceiver] Content cache initialized with ${this.contentCache.size} text files`);
  }

  _handleRemoteOperation(data) {
    const { documentId, operation, authorId } = data;

    // Extract filePath from documentId (format: bucketId:filePath)
    const colonIdx = documentId.indexOf(":");
    if (colonIdx < 0) return;
    const filePath = documentId.substring(colonIdx + 1);

    // Skip operations from the container itself (avoid echo loop)
    if (authorId === "container") return;

    // Only apply to text files with cached content
    const cached = this.contentCache.get(filePath);
    if (cached === undefined) {
      // File not in cache — might be a new file. Try to re-fetch content.
      this._refetchAndWriteFile(filePath);
      return;
    }

    try {
      const op = TextOperation.fromJSON(operation);
      const newContent = op.apply(cached);
      this.contentCache.set(filePath, newContent);

      // Write to disk — track the promise so flush can wait for it
      const fullPath = path.join(WORKSPACE_PATH, filePath);
      this.markSyncing(filePath);
      const writePromise = fs.mkdir(path.dirname(fullPath), { recursive: true })
        .then(() => fs.writeFile(fullPath, newContent, "utf-8"))
        .catch((err) => {
          this.syncingFiles.delete(filePath);
          console.error(`[OTReceiver] Error writing ${filePath}:`, err.message);
        })
        .finally(() => {
          this.pendingWrites.delete(writePromise);
        });
      this.pendingWrites.add(writePromise);
    } catch (err) {
      console.error(`[OTReceiver] Failed to apply op to ${filePath}: ${err.message}, re-fetching`);
      // Cache is out of sync — re-fetch full content
      this._refetchAndWriteFile(filePath);
    }
  }

  _handleFileTreeChange(data) {
    const { filePath, action } = data;
    const fullPath = path.join(WORKSPACE_PATH, filePath);

    if (action === "create") {
      // Fetch content from backend (handles renames where S3 has the copied content).
      // For genuinely new empty files, the fetch returns 404 and we create empty.
      this._fetchAndCreateFile(filePath);
    } else if (action === "delete") {
      this.markSyncing(filePath);
      this.contentCache.delete(filePath);
      fs.unlink(fullPath)
        .catch((err) => {
          this.syncingFiles.delete(filePath);
          if (err.code !== "ENOENT") {
            console.error(`[OTReceiver] Error deleting ${filePath}:`, err.message);
          }
        });
    }
  }

  /**
   * Re-fetch a single file's content from the backend when cache is out of sync
   */
  async _refetchAndWriteFile(filePath) {
    try {
      const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/${encodeURIComponent(filePath)}`;
      const result = await httpGet(url);
      if (result && result.content !== undefined && result.encoding !== 'base64') {
        this.contentCache.set(filePath, result.content);
        const fullPath = path.join(WORKSPACE_PATH, filePath);
        this.markSyncing(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, result.content, "utf-8");
        console.log(`[OTReceiver] Re-fetched and wrote ${filePath}`);
      }
    } catch (err) {
      console.error(`[OTReceiver] Failed to re-fetch ${filePath}:`, err.message);
    }
  }

  /**
   * Fetch content from backend and create/write a file on disk.
   * Used for file-tree-change "create" events — fetches content to handle renames
   * (where S3 already has the copied content). For genuinely new files, backend
   * returns 404 and we create an empty file.
   */
  async _fetchAndCreateFile(filePath) {
    const fullPath = path.join(WORKSPACE_PATH, filePath);
    this.markSyncing(filePath);
    try {
      let content = "";
      if (!isBinaryFile(filePath)) {
        // Try to fetch text content from backend
        const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/${encodeURIComponent(filePath)}`;
        const result = await httpGet(url);
        if (result && result.content !== undefined && result.encoding !== 'base64') {
          content = result.content;
        }
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      this.contentCache.set(filePath, content);
      if (content.length > 0) {
        console.log(`[OTReceiver] Created ${filePath} with fetched content (${content.length} chars)`);
      } else {
        console.log(`[OTReceiver] Created empty ${filePath}`);
      }
    } catch (err) {
      this.syncingFiles.delete(filePath);
      console.error(`[OTReceiver] Error creating ${filePath}:`, err.message);
    }
  }

  /**
   * Mark a file as "syncing" for the given duration. Cancels any existing
   * timeout for the same file so rapid writes don't cause premature expiration.
   */
  markSyncing(filePath, durationMs = 2000) {
    this.syncingFiles.add(filePath);
    if (this.syncingTimeouts.has(filePath)) {
      clearTimeout(this.syncingTimeouts.get(filePath));
    }
    this.syncingTimeouts.set(filePath, setTimeout(() => {
      this.syncingFiles.delete(filePath);
      this.syncingTimeouts.delete(filePath);
    }, durationMs));
  }

  /**
   * Update content cache when container filesystem changes
   * (called by the file watcher for text files)
   */
  updateCache(filePath, content) {
    this.contentCache.set(filePath, content);
  }

  removeFromCache(filePath) {
    this.contentCache.delete(filePath);
  }

  /**
   * Wait for all in-flight OT→disk writes to complete.
   * Called by flush before running code to guarantee disk matches OT state.
   */
  async drainPendingWrites() {
    if (this.pendingWrites.size === 0) return;
    console.log(`[OTReceiver] Draining ${this.pendingWrites.size} pending disk writes...`);
    await Promise.all(Array.from(this.pendingWrites));
  }

  /**
   * Fetch latest OT content from backend and sync to disk.
   * Catches any operations still in-transit (between server and container).
   * This is the final guarantee that disk matches what the user sees.
   */
  async syncFromBackendOT() {
    try {
      // Snapshot cache state BEFORE the async fetch. If a remote-operation
      // updates the cache between the fetch and the write loop, the snapshot
      // lets us detect the change and skip the overwrite (the cache is newer).
      const cacheSnapshot = new Map(this.contentCache);

      const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/ot-content`;
      const result = await httpPost(url, null, 5000);
      if (!result || !result.files) return;

      let synced = 0;
      for (const file of result.files) {
        const currentCached = this.contentCache.get(file.path);
        const snapshotCached = cacheSnapshot.get(file.path);

        // Only update if:
        // 1. Content differs from cache, AND
        // 2. Cache hasn't been modified since we started the fetch
        //    (if it was modified, a remote-operation updated it to a newer version)
        if (currentCached !== file.content && currentCached === snapshotCached) {
          this.contentCache.set(file.path, file.content);
          const fullPath = path.join(WORKSPACE_PATH, file.path);
          this.markSyncing(file.path);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, file.content, "utf-8");
          // Record what we wrote for secondary echo detection. If chokidar
          // fires late (after syncingFiles expires) and the cache was updated
          // by a remote-operation in the meantime, the primary echo detection
          // (disk === cache) fails. This secondary record catches that case.
          this.lastFlushWriteContent.set(file.path, file.content);
          setTimeout(() => this.lastFlushWriteContent.delete(file.path), 30000);
          synced++;
        }
      }
      if (synced > 0) {
        console.log(`[OTReceiver] syncFromBackendOT: updated ${synced} files`);
      }
    } catch (err) {
      console.error(`[OTReceiver] syncFromBackendOT failed:`, err.message);
      // Non-fatal — we still have pendingWrites drained, this is just extra safety
    }
  }

  /**
   * Emit a file-tree-change event to notify the backend (and frontends) about
   * file creation or deletion in the container.
   */
  emitFileTreeChange(filePath, action) {
    if (this.socket?.connected && this.registered) {
      this.socket.emit("file-tree-change", { bucketId: BUCKET_ID, filePath, action });
      console.log(`[OTReceiver] Emitted file-tree-change: ${action} ${filePath}`);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// ============================================================================
// HTTP helpers
// ============================================================================

function httpGet(url, timeoutMs = 15000) {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: { "x-container-service-token": CONTAINER_SERVICE_TOKEN },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`)); }
          } else if (res.statusCode === 404) {
            resolve(null);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function httpPost(url, body = null, timeoutMs = 20000) {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;
  const bodyStr = body ? JSON.stringify(body) : "";

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          "x-container-service-token": CONTAINER_SERVICE_TOKEN,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`)); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout after ${timeoutMs}ms`)); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ============================================================================
// ContainerFileSync — main orchestrator
// ============================================================================

class ContainerFileSync {
  constructor() {
    this.watcher = null;
    this.changeTimeouts = new Map(); // Debounce per-file
    this.syncingFiles = new Set(); // Files being written by OTReceiver (prevent loops)
    this.otReceiver = new OTReceiver(this.syncingFiles);
  }

  async start() {
    console.log(`[ContainerSync] Starting file sync service`);
    console.log(`[ContainerSync] Workspace: ${WORKSPACE_PATH}`);
    console.log(`[ContainerSync] Backend: ${BACKEND_API_URL}`);
    console.log(`[ContainerSync] Bucket: ${BUCKET_ID}`);

    // 1. Start flush server
    await this.startFlushServer();

    // 2. Connect Socket.IO (but don't register yet — buffer incoming events)
    this.otReceiver.connect();

    // Wait briefly for Socket.IO connection
    await new Promise((resolve) => {
      const check = () => {
        if (this.otReceiver.socket?.connected) resolve();
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
      // Don't block forever — proceed after 5s even if not connected
      setTimeout(resolve, 5000);
    });

    // 3. Fetch all files via bulk-content endpoint
    let files = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[ContainerSync] Fetching bulk content attempt ${attempt}/3...`);
        const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/bulk-content`;
        const result = await httpPost(url, null, 30000);
        files = result.files || [];
        console.log(`[ContainerSync] Got ${files.length} files from bulk-content`);
        break;
      } catch (err) {
        console.error(`[ContainerSync] Bulk content attempt ${attempt} failed:`, err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }

    // 4. Write all files to disk and populate content cache
    for (const file of files) {
      try {
        const fullPath = path.join(WORKSPACE_PATH, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        this.otReceiver.markSyncing(file.path);
        if (file.encoding === 'base64') {
          await fs.writeFile(fullPath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(fullPath, file.content, "utf-8");
        }
      } catch (err) {
        console.error(`[ContainerSync] Error writing ${file.path}:`, err.message);
      }
    }

    // Delete local files that don't exist in bulk-content response
    if (files.length > 0) {
      try {
        const remoteFileSet = new Set(files.map(f => f.path));
        const localFiles = await this.scanWorkspaceFiles();
        for (const localFile of localFiles) {
          if (!remoteFileSet.has(localFile) && !this.syncingFiles.has(localFile)) {
            const fullPath = path.join(WORKSPACE_PATH, localFile);
            try {
              await fs.unlink(fullPath);
              console.log(`[ContainerSync] Deleted stale file: ${localFile}`);
            } catch (err) {
              if (err.code !== "ENOENT") {
                console.error(`[ContainerSync] Error deleting ${localFile}:`, err.message);
              }
            }
          }
        }
      } catch (err) {
        console.error("[ContainerSync] Error cleaning up stale files:", err.message);
      }
    }

    // Initialize OT content cache
    this.otReceiver.initCache(files);

    // 5. Register with backend (activates Mode B)
    this.otReceiver.register();

    // 6. Apply any buffered operations that arrived between step 3 and step 5
    this.otReceiver.applyBufferedEvents();

    // 7. Start chokidar file watcher
    await this.startFileWatcher();

    // 8. Write sync marker file
    const markerPath = "/tmp/sync-initial-complete";
    await fs.writeFile(
      markerPath,
      JSON.stringify({
        completedAt: new Date().toISOString(),
        bucketId: BUCKET_ID,
      }),
      "utf-8"
    );
    console.log(`[ContainerSync] Sync marker written to ${markerPath}`);

    // Status heartbeat
    setInterval(() => {
      console.log(`[ContainerSync] Status: watching=${!!this.watcher}, pending=${this.changeTimeouts.size}, otConnected=${this.otReceiver.socket?.connected}, otRegistered=${this.otReceiver.registered}`);
    }, 60000);
  }

  async startFileWatcher() {
    this.watcher = chokidar.watch(WORKSPACE_PATH, {
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      ignorePermissionErrors: true,
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        /node_modules/,
        /\.git/,
        /__pycache__/,
        /\.vscode/,
        /\.idea/,
        /\.yjs/,
        /\.partial$/,
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for files written during setup
    });

    this.watcher
      .on("add", (filePath) => this.handleChange(filePath, "add"))
      .on("change", (filePath) => this.handleChange(filePath, "change"))
      .on("unlink", (filePath) => this.handleChange(filePath, "unlink"))
      .on("error", (err) => console.error("[ContainerSync] Watcher error:", err.message));

    console.log("[ContainerSync] File watcher started");
  }

  async handleChange(fullPath, event) {
    const relativePath = path.relative(WORKSPACE_PATH, fullPath);

    if (this.shouldIgnore(relativePath)) return;
    if (this.syncingFiles.has(relativePath)) return;

    // Debounce: 1 second per file
    if (this.changeTimeouts.has(relativePath)) {
      clearTimeout(this.changeTimeouts.get(relativePath));
    }

    this.changeTimeouts.set(
      relativePath,
      setTimeout(async () => {
        this.changeTimeouts.delete(relativePath);

        try {
          if (event === "unlink") {
            console.log(`[ContainerSync] File deleted: ${relativePath}`);
            this.otReceiver.removeFromCache(relativePath);
            this.otReceiver.emitFileTreeChange(relativePath, "delete");
            return;
          }

          let content, encoding;
          if (isBinaryFile(relativePath)) {
            const buffer = await fs.readFile(fullPath);
            content = buffer.toString('base64');
            encoding = 'base64';
            console.log(`[ContainerSync] Syncing binary ${relativePath} (${buffer.length} bytes)`);
          } else {
            content = await fs.readFile(fullPath, "utf-8");
            encoding = 'utf-8';
            // Primary echo detection: if content matches OT cache, this event is
            // a reflection of an OT write. Skip to prevent feedback loops.
            const cached = this.otReceiver.contentCache.get(relativePath);
            if (cached !== undefined && content === cached) {
              console.log(`[ContainerSync] Echo detected for ${relativePath}, skipping`);
              return;
            }
            // Secondary echo detection: if content matches what syncFromBackendOT
            // wrote during the last flush, this is a delayed chokidar echo. The
            // primary check above fails when a remote-operation updated the cache
            // between the flush write and this chokidar fire. Without this check,
            // stale flush content would be pushed back to the backend, creating a
            // revert operation that breaks sync for all connected IDEs.
            // This is critical for Java where rm/javac .class file churn delays
            // chokidar detection of the .java file write past the syncingFiles guard.
            const flushContent = this.otReceiver.lastFlushWriteContent.get(relativePath);
            if (flushContent !== undefined && content === flushContent) {
              console.log(`[ContainerSync] Flush-echo detected for ${relativePath}, skipping`);
              this.otReceiver.lastFlushWriteContent.delete(relativePath);
              return;
            }
            // Real external change (e.g. student ran a program that modified the file)
            this.otReceiver.updateCache(relativePath, content);
            console.log(`[ContainerSync] Syncing ${relativePath} (${content.length} chars)`);
          }

          await this.pushToBackend(relativePath, content, encoding);
        } catch (err) {
          if (err.code === "ENOENT") return; // File was deleted
          console.error(`[ContainerSync] Error syncing ${relativePath}:`, err.message);
        }
      }, 1000)
    );
  }

  async pushToBackend(filePath, content, encoding = 'utf-8') {
    const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/sync-from-container`;
    const body = JSON.stringify({ filePath, content, encoding });
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "x-container-service-token": CONTAINER_SERVICE_TOKEN,
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Flush server on port 3001 — called before Run/Tests.
   * Now just flushes any pending debounced writes (near-instant).
   * Container already has up-to-date files via OT bridge.
   */
  async startFlushServer() {
    const flushServer = http.createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/flush") {
        try {
          const flushedCount = await this.flushPendingWrites();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "flushed", fileCount: flushedCount }));
        } catch (err) {
          console.error("[ContainerSync] Flush error:", err.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error", error: err.message }));
        }
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    flushServer.listen(3001, "127.0.0.1", () => {
      console.log("[ContainerSync] Flush server listening on 127.0.0.1:3001");
    });

    flushServer.on("error", (err) => {
      console.error("[ContainerSync] Flush server error:", err.message);
    });
  }

  /**
   * Flush all pending writes to ensure disk matches what the user sees.
   * 1. Drain any in-flight OT→disk writes (frontend edits not yet on disk)
   * 2. Sync with backend OT state (catches in-transit operations)
   * 3. Push any pending debounced container→backend writes
   */
  async flushPendingWrites() {
    // Wait for any in-flight OT operations to finish writing to disk
    await this.otReceiver.drainPendingWrites();

    // Fetch latest OT content from backend — catches operations still in network transit
    await this.otReceiver.syncFromBackendOT();

    const pendingPaths = Array.from(this.changeTimeouts.keys());
    if (pendingPaths.length === 0) {
      console.log("[ContainerSync] Flush: no pending writes");
      return 0;
    }

    console.log(`[ContainerSync] Flushing ${pendingPaths.length} pending writes...`);
    for (const relativePath of pendingPaths) {
      clearTimeout(this.changeTimeouts.get(relativePath));
      this.changeTimeouts.delete(relativePath);

      const fullPath = path.join(WORKSPACE_PATH, relativePath);
      try {
        let content, encoding;
        if (isBinaryFile(relativePath)) {
          const buffer = await fs.readFile(fullPath);
          content = buffer.toString('base64');
          encoding = 'base64';
        } else {
          content = await fs.readFile(fullPath, "utf-8");
          encoding = 'utf-8';
          this.otReceiver.updateCache(relativePath, content);
        }
        await this.pushToBackend(relativePath, content, encoding);
        console.log(`[ContainerSync] Flushed pending: ${relativePath}`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[ContainerSync] Error flushing ${relativePath}:`, err.message);
        }
      }
    }

    return pendingPaths.length;
  }

  /**
   * Recursively scan workspace directory and return all relative file paths,
   * respecting the same ignore patterns as the watcher.
   */
  async scanWorkspaceFiles(dir = WORKSPACE_PATH) {
    const results = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return results;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(WORKSPACE_PATH, fullPath);
      if (this.shouldIgnore(relativePath)) continue;
      if (entry.isDirectory()) {
        const subFiles = await this.scanWorkspaceFiles(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
    return results;
  }

  shouldIgnore(filePath) {
    const patterns = [
      /^\./,
      /node_modules/,
      /\.git/,
      /__pycache__/,
      /\.vscode/,
      /\.idea/,
      /\.yjs/,
      /\.partial$/,
    ];
    return patterns.some((p) => p.test(filePath));
  }

  async stop() {
    console.log("[ContainerSync] Stopping...");
    this.otReceiver.disconnect();
    if (this.watcher) await this.watcher.close();
    this.changeTimeouts.forEach((t) => clearTimeout(t));
    this.changeTimeouts.clear();
    console.log("[ContainerSync] Stopped");
  }
}

// Start
const sync = new ContainerFileSync();
sync.start().catch((err) => {
  console.error("[ContainerSync] Failed to start:", err);
  setTimeout(() => process.exit(1), 5000);
});

// Graceful shutdown
process.on("SIGTERM", () => sync.stop().then(() => process.exit(0)));
process.on("SIGINT", () => sync.stop().then(() => process.exit(0)));
