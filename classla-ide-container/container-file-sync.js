#!/usr/bin/env node
/**
 * Container File Sync Service (OT-based)
 *
 * Pure REST-based file sync — no WebSocket or Yjs.
 * Watches filesystem for changes and pushes them to the backend via REST.
 * The backend converts changes to OT operations and broadcasts to frontend clients.
 */

const chokidar = require("chokidar");
const fs = require("fs").promises;
const path = require("path");
const http = require("http");
const https = require("https");

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

class ContainerFileSync {
  constructor() {
    this.watcher = null;
    this.changeTimeouts = new Map(); // Debounce per-file
    this.syncingFiles = new Set(); // Files being written by flush (prevent loops)
  }

  async start() {
    console.log(`[ContainerSync] Starting file sync service`);
    console.log(`[ContainerSync] Workspace: ${WORKSPACE_PATH}`);
    console.log(`[ContainerSync] Backend: ${BACKEND_API_URL}`);
    console.log(`[ContainerSync] Bucket: ${BUCKET_ID}`);

    await this.startFileWatcher();
    await this.startFlushServer();

    // Write marker file to signal initial sync is ready
    const markerPath = "/tmp/yjs-initial-sync-complete";
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
      console.log(`[ContainerSync] Status: watching=${!!this.watcher}, pending=${this.changeTimeouts.size}`);
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
      ignoreInitial: false,
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
            // Backend handles OT cleanup via the sync-from-container or delete endpoint
            return;
          }

          const content = await fs.readFile(fullPath, "utf-8");
          console.log(`[ContainerSync] Syncing ${relativePath} (${content.length} chars)`);

          await this.pushToBackend(relativePath, content);
        } catch (err) {
          if (err.code === "ENOENT") return; // File was deleted
          console.error(`[ContainerSync] Error syncing ${relativePath}:`, err.message);
        }
      }, 1000)
    );
  }

  async pushToBackend(filePath, content) {
    const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/sync-from-container`;

    const body = JSON.stringify({ filePath, content });
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
   * Pulls latest file content from S3 to ensure container has up-to-date files.
   */
  async startFlushServer() {
    const flushServer = http.createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/flush") {
        try {
          const flushedCount = await this.flushFiles();
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
   * Pull latest files from backend/S3 and push any pending container changes.
   * Ensures the container filesystem is up-to-date before running code.
   */
  async flushFiles() {
    console.log("[ContainerSync] Flushing: syncing files with backend...");

    // 1. Push any pending debounced writes to backend first
    const pendingPaths = Array.from(this.changeTimeouts.keys());
    for (const relativePath of pendingPaths) {
      clearTimeout(this.changeTimeouts.get(relativePath));
      this.changeTimeouts.delete(relativePath);

      const fullPath = path.join(WORKSPACE_PATH, relativePath);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        await this.pushToBackend(relativePath, content);
        console.log(`[ContainerSync] Flushed pending: ${relativePath}`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[ContainerSync] Error flushing ${relativePath}:`, err.message);
        }
      }
    }

    // 2. Pull latest file list from backend and update container filesystem
    let pulledCount = 0;
    try {
      const fileList = await this.fetchFileList();
      for (const filePath of fileList) {
        try {
          const content = await this.fetchFileContent(filePath);
          if (content !== null) {
            const fullPath = path.join(WORKSPACE_PATH, filePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            // Mark as syncing to prevent the watcher from re-pushing
            this.syncingFiles.add(filePath);
            await fs.writeFile(fullPath, content, "utf-8");
            // Clear syncing flag after a short delay (let watcher settle)
            setTimeout(() => this.syncingFiles.delete(filePath), 2000);

            pulledCount++;
          }
        } catch (err) {
          console.error(`[ContainerSync] Error pulling ${filePath}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ContainerSync] Error fetching file list:", err.message);
    }

    console.log(`[ContainerSync] Flush complete: pushed ${pendingPaths.length}, pulled ${pulledCount} file(s)`);
    return pendingPaths.length + pulledCount;
  }

  /**
   * Fetch the list of files in the bucket from backend
   */
  async fetchFileList() {
    const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/list-for-container`;
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "GET",
          headers: {
            "x-container-service-token": CONTAINER_SERVICE_TOKEN,
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                resolve(parsed.files || []);
              } catch (e) {
                reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.end();
    });
  }

  /**
   * Fetch file content from backend (S3)
   */
  async fetchFileContent(filePath) {
    const url = `${BACKEND_API_URL}/s3buckets/${BUCKET_ID}/files/${encodeURIComponent(filePath)}`;
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "GET",
          headers: {
            "x-container-service-token": CONTAINER_SERVICE_TOKEN,
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                resolve(parsed.content !== undefined ? parsed.content : null);
              } catch (e) {
                reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
              }
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
