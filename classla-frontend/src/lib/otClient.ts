/**
 * OT Client - Frontend Operational Transformation client
 *
 * Provides:
 * - TextOperation: client-side OT data structure (same algorithms as server)
 * - OTDocumentClient: manages single document's OT state machine
 * - OTProvider: singleton Socket.IO provider (replaces yjsProvider)
 */

import { io, Socket } from "socket.io-client";

// ============================================================================
// TextOperation (client-side copy - same algorithms, no Node.js deps)
// ============================================================================

export type Component = number | string;

export class TextOperation {
  ops: Component[] = [];
  baseLength: number = 0;
  targetLength: number = 0;

  retain(n: number): this {
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) > 0) {
      (this.ops[this.ops.length - 1] as number) += n;
    } else {
      this.ops.push(n);
    }
    return this;
  }

  insert(str: string): this {
    if (str === "") return this;
    this.targetLength += str.length;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "string") {
      (this.ops[this.ops.length - 1] as string) += str;
    } else if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) < 0) {
      if (this.ops.length > 1 && typeof this.ops[this.ops.length - 2] === "string") {
        (this.ops[this.ops.length - 2] as string) += str;
      } else {
        this.ops.splice(this.ops.length - 1, 0, str);
      }
    } else {
      this.ops.push(str);
    }
    return this;
  }

  delete(n: number): this {
    if (n === 0) return this;
    this.baseLength += n;
    const negN = -n;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) < 0) {
      (this.ops[this.ops.length - 1] as number) += negN;
    } else {
      this.ops.push(negN);
    }
    return this;
  }

  apply(doc: string): string {
    if (doc.length !== this.baseLength) {
      throw new Error(`Cannot apply: expected length ${this.baseLength}, got ${doc.length}`);
    }
    const parts: string[] = [];
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

  isNoop(): boolean {
    for (const op of this.ops) {
      if (typeof op === "string") return false;
      if (typeof op === "number" && op < 0) return false;
    }
    return true;
  }

  toJSON(): Component[] {
    return this.ops;
  }

  static fromJSON(ops: Component[]): TextOperation {
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

  static compose(a: TextOperation, b: TextOperation): TextOperation {
    if (a.targetLength !== b.baseLength) {
      throw new Error(`compose: a.targetLength (${a.targetLength}) !== b.baseLength (${b.baseLength})`);
    }
    const result = new TextOperation();
    const aOps = a.ops.slice();
    const bOps = b.ops.slice();
    let ai = 0, bi = 0;
    let aOp: Component | undefined = aOps[ai++];
    let bOp: Component | undefined = bOps[bi++];

    while (aOp !== undefined || bOp !== undefined) {
      if (typeof aOp === "number" && aOp < 0) { result.delete(-aOp); aOp = aOps[ai++]; continue; }
      if (typeof bOp === "string") { result.insert(bOp); bOp = bOps[bi++]; continue; }
      if (aOp === undefined || bOp === undefined) throw new Error("compose: mismatch");

      if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp > 0) {
        if (aOp > bOp) { result.retain(bOp); aOp = aOp - bOp; bOp = bOps[bi++]; }
        else if (aOp < bOp) { result.retain(aOp); bOp = bOp - aOp; aOp = aOps[ai++]; }
        else { result.retain(aOp); aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "string" && typeof bOp === "number" && bOp < 0) {
        const aLen: number = aOp.length, bLen: number = -bOp;
        if (aLen > bLen) { aOp = aOp.slice(bLen); bOp = bOps[bi++]; }
        else if (aLen < bLen) { aOp = aOps[ai++]; bOp = -(bLen - aLen); }
        else { aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "string" && typeof bOp === "number" && bOp > 0) {
        const aLen: number = aOp.length;
        if (aLen > bOp) { result.insert(aOp.slice(0, bOp)); aOp = aOp.slice(bOp); bOp = bOps[bi++]; }
        else if (aLen < bOp) { result.insert(aOp); bOp = bOp - aLen; aOp = aOps[ai++]; }
        else { result.insert(aOp); aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp < 0) {
        const bLen: number = -bOp;
        if (aOp > bLen) { result.delete(bLen); aOp = aOp - bLen; bOp = bOps[bi++]; }
        else if (aOp < bLen) { result.delete(aOp); bOp = -(bLen - aOp); aOp = aOps[ai++]; }
        else { result.delete(aOp); aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else {
        throw new Error(`compose: unhandled: ${JSON.stringify(aOp)}, ${JSON.stringify(bOp)}`);
      }
    }
    return result;
  }

  static transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
    if (a.baseLength !== b.baseLength) {
      throw new Error(`transform: baseLength mismatch (${a.baseLength} !== ${b.baseLength})`);
    }
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const aOps = a.ops.slice();
    const bOps = b.ops.slice();
    let ai = 0, bi = 0;
    let aOp: Component | undefined = aOps[ai++];
    let bOp: Component | undefined = bOps[bi++];

    while (aOp !== undefined || bOp !== undefined) {
      if (typeof aOp === "string") { aPrime.insert(aOp); bPrime.retain(aOp.length); aOp = aOps[ai++]; continue; }
      if (typeof bOp === "string") { bPrime.insert(bOp); aPrime.retain(bOp.length); bOp = bOps[bi++]; continue; }
      if (aOp === undefined || bOp === undefined) throw new Error("transform: mismatch");

      if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp > 0) {
        const m = Math.min(aOp, bOp); aPrime.retain(m); bPrime.retain(m);
        if (aOp > bOp) { aOp = aOp - bOp; bOp = bOps[bi++]; }
        else if (aOp < bOp) { bOp = bOp - aOp; aOp = aOps[ai++]; }
        else { aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "number" && aOp < 0 && typeof bOp === "number" && bOp < 0) {
        const aLen: number = -aOp, bLen: number = -bOp;
        if (aLen > bLen) { aOp = -(aLen - bLen); bOp = bOps[bi++]; }
        else if (aLen < bLen) { bOp = -(bLen - aLen); aOp = aOps[ai++]; }
        else { aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "number" && aOp < 0 && typeof bOp === "number" && bOp > 0) {
        const aLen: number = -aOp, m = Math.min(aLen, bOp); aPrime.delete(m);
        if (aLen > bOp) { aOp = -(aLen - bOp); bOp = bOps[bi++]; }
        else if (aLen < bOp) { bOp = bOp - aLen; aOp = aOps[ai++]; }
        else { aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp < 0) {
        const bLen: number = -bOp, m = Math.min(aOp, bLen); bPrime.delete(m);
        if (aOp > bLen) { aOp = aOp - bLen; bOp = bOps[bi++]; }
        else if (aOp < bLen) { bOp = -(bLen - aOp); aOp = aOps[ai++]; }
        else { aOp = aOps[ai++]; bOp = bOps[bi++]; }
      } else {
        throw new Error(`transform: unhandled: ${JSON.stringify(aOp)}, ${JSON.stringify(bOp)}`);
      }
    }
    return [aPrime, bPrime];
  }
}

// ============================================================================
// OTDocumentClient - state machine for a single document
// ============================================================================

type ClientState =
  | { type: "synchronized" }
  | { type: "awaitingConfirm"; outstanding: TextOperation }
  | { type: "awaitingWithBuffer"; outstanding: TextOperation; buffer: TextOperation };

export class OTDocumentClient {
  documentId: string;
  revision: number;
  state: ClientState;
  content: string;
  onSendOperation: ((revision: number, operation: TextOperation) => void) | null = null;

  // Listener maps for multi-editor support (same page, two Monaco instances)
  private contentChangedListeners: Map<string, (content: string, operation: TextOperation) => void> = new Map();
  private saveStatusListeners: Map<string, (status: "saving" | "saved" | "error") => void> = new Map();
  private resyncListeners: Map<string, () => void> = new Map();

  // Backward-compatible getter/setter for onContentChanged
  get onContentChanged(): ((content: string, operation: TextOperation) => void) | null {
    if (this.contentChangedListeners.size === 0) return null;
    return (content: string, operation: TextOperation) => {
      this.notifyContentChanged(content, operation);
    };
  }
  set onContentChanged(fn: ((content: string, operation: TextOperation) => void) | null) {
    if (fn) this.contentChangedListeners.set("__legacy__", fn);
    else this.contentChangedListeners.delete("__legacy__");
  }

  // Backward-compatible getter/setter for onSaveStatusChanged
  get onSaveStatusChanged(): ((status: "saving" | "saved" | "error") => void) | null {
    if (this.saveStatusListeners.size === 0) return null;
    return (status: "saving" | "saved" | "error") => {
      this.notifySaveStatus(status);
    };
  }
  set onSaveStatusChanged(fn: ((status: "saving" | "saved" | "error") => void) | null) {
    if (fn) this.saveStatusListeners.set("__legacy__", fn);
    else this.saveStatusListeners.delete("__legacy__");
  }

  // Backward-compatible getter/setter for onResyncNeeded
  get onResyncNeeded(): (() => void) | null {
    if (this.resyncListeners.size === 0) return null;
    return () => { this.notifyResyncNeeded(); };
  }
  set onResyncNeeded(fn: (() => void) | null) {
    if (fn) this.resyncListeners.set("__legacy__", fn);
    else this.resyncListeners.delete("__legacy__");
  }

  constructor(documentId: string, content: string, revision: number) {
    this.documentId = documentId;
    this.content = content;
    this.revision = revision;
    this.state = { type: "synchronized" };
  }

  // Listener registration methods
  addContentChangedListener(id: string, fn: (content: string, operation: TextOperation) => void): void {
    this.contentChangedListeners.set(id, fn);
  }
  removeContentChangedListener(id: string): void {
    this.contentChangedListeners.delete(id);
  }
  addSaveStatusListener(id: string, fn: (status: "saving" | "saved" | "error") => void): void {
    this.saveStatusListeners.set(id, fn);
  }
  removeSaveStatusListener(id: string): void {
    this.saveStatusListeners.delete(id);
  }
  addResyncListener(id: string, fn: () => void): void {
    this.resyncListeners.set(id, fn);
  }
  removeResyncListener(id: string): void {
    this.resyncListeners.delete(id);
  }

  // Notification methods
  private notifyContentChanged(content: string, operation: TextOperation): void {
    for (const fn of this.contentChangedListeners.values()) {
      try { fn(content, operation); } catch (e) { console.error("[OT] contentChanged listener error:", e); }
    }
  }
  private notifySaveStatus(status: "saving" | "saved" | "error"): void {
    for (const fn of this.saveStatusListeners.values()) {
      try { fn(status); } catch (e) { console.error("[OT] saveStatus listener error:", e); }
    }
  }
  private notifyResyncNeeded(): void {
    for (const fn of this.resyncListeners.values()) {
      try { fn(); } catch (e) { console.error("[OT] resyncNeeded listener error:", e); }
    }
  }

  /**
   * Notify all content listeners EXCEPT the source binding.
   * Used for same-page sync between two editors sharing the same OT document.
   */
  notifyLocalOperation(sourceBindingId: string, operation: TextOperation): void {
    for (const [id, fn] of this.contentChangedListeners.entries()) {
      if (id === sourceBindingId) continue;
      try { fn(this.content, operation); } catch (e) { console.error("[OT] localOp listener error:", e); }
    }
  }

  /**
   * User made a local edit. Send to server or buffer.
   */
  applyLocal(operation: TextOperation): void {
    // Apply to local content
    this.content = operation.apply(this.content);

    if (this.state.type === "synchronized") {
      // Send immediately
      this.state = { type: "awaitingConfirm", outstanding: operation };
      this.notifySaveStatus("saving");
      this.onSendOperation?.(this.revision, operation);
    } else if (this.state.type === "awaitingConfirm") {
      // Buffer this operation
      this.state = {
        type: "awaitingWithBuffer",
        outstanding: this.state.outstanding,
        buffer: operation,
      };
    } else if (this.state.type === "awaitingWithBuffer") {
      // Compose into existing buffer
      this.state = {
        type: "awaitingWithBuffer",
        outstanding: this.state.outstanding,
        buffer: TextOperation.compose(this.state.buffer, operation),
      };
    }
  }

  /**
   * Server acknowledged our operation
   */
  handleAck(revision: number): void {
    this.revision = revision;

    if (this.state.type === "awaitingConfirm") {
      this.state = { type: "synchronized" };
      this.notifySaveStatus("saved");
    } else if (this.state.type === "awaitingWithBuffer") {
      // Send buffer
      const buffer = this.state.buffer;
      this.state = { type: "awaitingConfirm", outstanding: buffer };
      this.onSendOperation?.(this.revision, buffer);
    }
  }

  /**
   * Received a remote operation from the server.
   * If transform/apply fails, requests a full resync rather than leaving a corrupted state.
   */
  handleRemoteOperation(operation: TextOperation, revision: number): void {
    try {
      this.revision = revision;

      if (this.state.type === "synchronized") {
        // Apply directly
        this.content = operation.apply(this.content);
        this.notifyContentChanged(this.content, operation);
      } else if (this.state.type === "awaitingConfirm") {
        // Transform against outstanding
        const [oPrime, outstandingPrime] = TextOperation.transform(
          operation,
          this.state.outstanding
        );
        this.state = { type: "awaitingConfirm", outstanding: outstandingPrime };
        this.content = oPrime.apply(this.content);
        this.notifyContentChanged(this.content, oPrime);
      } else if (this.state.type === "awaitingWithBuffer") {
        // Transform against outstanding, then against buffer
        const [oPrime1, outstandingPrime] = TextOperation.transform(
          operation,
          this.state.outstanding
        );
        const [oPrime2, bufferPrime] = TextOperation.transform(oPrime1, this.state.buffer);
        this.state = {
          type: "awaitingWithBuffer",
          outstanding: outstandingPrime,
          buffer: bufferPrime,
        };
        this.content = oPrime2.apply(this.content);
        this.notifyContentChanged(this.content, oPrime2);
      }
    } catch (error) {
      console.error(`[OT] Error applying remote operation for ${this.documentId}, requesting resync:`, error);
      // Reset to synchronized state — the next document-state from server will fix us
      this.state = { type: "synchronized" };
      this.notifyResyncNeeded();
    }
  }
}

// ============================================================================
// OTProvider - singleton, replaces yjsProvider
// ============================================================================

const getBackendApiUrl = (): string => {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";
};

class OTProvider {
  private socket: Socket | null = null;
  private _connected: boolean = false;
  private documents: Map<string, OTDocumentClient> = new Map();
  private pendingSubscriptions: Set<string> = new Set();
  private documentReadyCallbacks: Map<string, Array<(doc: OTDocumentClient) => void>> = new Map();

  get connected(): boolean {
    return this._connected && this.socket?.connected === true;
  }

  get socketInstance(): Socket | null {
    return this.socket;
  }

  connect(apiBaseUrl?: string, bucketId?: string): void {
    const backendApiUrl = apiBaseUrl || getBackendApiUrl();
    if (!backendApiUrl) return;

    if (this.socket?.connected) return;

    // If we have a disconnected socket, clean it up first
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const baseUrl = backendApiUrl.replace(/\/api$/, "");
    const namespace = "/ot";

    const testBucketId = "00000000-0000-0000-0000-000000000001";
    const isTestBucket = bucketId === testBucketId;

    const socketOptions: any = {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    };

    if (isTestBucket && import.meta.env.MODE === "development") {
      socketOptions.query = { bucketId: testBucketId };
      socketOptions.auth = { bucketId: testBucketId };
      socketOptions.extraHeaders = { "x-test-bucket-id": testBucketId };
    }

    const url = `${baseUrl}${namespace}`;
    this.socket = io(url, socketOptions);
    this.setupEventListeners();
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this._connected = false;
    }
    this.documents.clear();
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this._connected = true;
      console.log("[OT] Connected", { socketId: this.socket?.id });

      // Re-subscribe to all existing documents
      for (const [docId, doc] of this.documents.entries()) {
        const [bucketId, ...rest] = docId.split(":");
        const filePath = rest.join(":");
        this.socket!.emit("subscribe-document", { bucketId, filePath });
      }

      // Process pending subscriptions
      for (const key of this.pendingSubscriptions) {
        const [bucketId, ...rest] = key.split(":");
        const filePath = rest.join(":");
        this.socket!.emit("subscribe-document", { bucketId, filePath });
      }
      this.pendingSubscriptions.clear();
    });

    this.socket.on("disconnect", (reason) => {
      this._connected = false;
      console.log("[OT] Disconnected:", reason);
    });

    this.socket.on("connect_error", (error) => {
      console.error("[OT] Connection error:", error.message);
    });

    this.socket.on("error", (error: { message: string }) => {
      console.error("[OT] Error:", error);
    });

    // Initial document state from server
    this.socket.on(
      "document-state",
      (data: { documentId: string; content: string; revision: number }) => {
        const { documentId, content, revision } = data;
        let doc = this.documents.get(documentId);

        if (!doc) {
          doc = new OTDocumentClient(documentId, content, revision);
          this.documents.set(documentId, doc);
        } else {
          // Reconnect case: check if content actually changed
          const oldContent = doc.content;
          doc.content = content;
          doc.revision = revision;
          doc.state = { type: "synchronized" };

          // If content changed during disconnect, build a replace operation for Monaco
          if (oldContent !== content && doc.onContentChanged) {
            const replaceOp = new TextOperation();
            if (oldContent.length > 0) replaceOp.delete(oldContent.length);
            if (content.length > 0) replaceOp.insert(content);
            doc.onContentChanged(content, replaceOp);
          }
        }

        // Wire up send callback
        doc.onSendOperation = (rev, op) => {
          this.socket?.emit("submit-operation", {
            documentId,
            revision: rev,
            operation: op.toJSON(),
          });
        };

        // Wire up resync callback — re-subscribe to get fresh document-state
        doc.onResyncNeeded = () => {
          const [bId, ...rest] = documentId.split(":");
          const fPath = rest.join(":");
          console.log(`[OT] Resync requested for ${documentId}`);
          this.socket?.emit("subscribe-document", { bucketId: bId, filePath: fPath });
        };

        // Notify listeners of content (for initial load — no-op retain)
        doc.onContentChanged?.(content, new TextOperation().retain(content.length));
        doc.onSaveStatusChanged?.("saved");

        console.log(`[OT] Document state received: ${documentId} (rev=${revision}, len=${content.length})`);

        // Fire ready callbacks
        const callbacks = this.documentReadyCallbacks.get(documentId);
        if (callbacks) {
          this.documentReadyCallbacks.delete(documentId);
          for (const cb of callbacks) {
            try { cb(doc); } catch (e) { console.error("[OT] documentReady callback error:", e); }
          }
        }
      }
    );

    // Server acknowledged our operation
    this.socket.on("ack", (data: { documentId: string; revision: number }) => {
      const doc = this.documents.get(data.documentId);
      if (doc) {
        doc.handleAck(data.revision);
      }
    });

    // Remote operation from another client
    this.socket.on(
      "remote-operation",
      (data: {
        documentId: string;
        operation: (number | string)[];
        authorId: string;
        revision: number;
      }) => {
        const doc = this.documents.get(data.documentId);
        if (doc) {
          const op = TextOperation.fromJSON(data.operation);
          doc.handleRemoteOperation(op, data.revision);
        }
      }
    );

    // File tree changes
    this.socket.on(
      "file-tree-change",
      (data: { bucketId: string; filePath: string; action: "create" | "delete" }) => {
        window.dispatchEvent(
          new CustomEvent("ot-file-tree-change", { detail: data })
        );
      }
    );

    // Remote cursor updates
    this.socket.on(
      "remote-cursor",
      (data: {
        documentId: string;
        clientId: string;
        cursor: { lineNumber: number; column: number } | null;
        selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
        user: { name: string; color: string };
      }) => {
        window.dispatchEvent(
          new CustomEvent("ot-remote-cursor", { detail: data })
        );
      }
    );
  }

  /**
   * Subscribe to a document
   */
  subscribeToDocument(bucketId: string, filePath: string): void {
    const documentId = `${bucketId}:${filePath}`;

    if (!this.socket || !this._connected) {
      this.pendingSubscriptions.add(documentId);
      return;
    }

    this.socket.emit("subscribe-document", { bucketId, filePath });
  }

  /**
   * Unsubscribe from a document
   */
  unsubscribeDocument(bucketId: string, filePath: string): void {
    const documentId = `${bucketId}:${filePath}`;

    if (this.socket && this._connected) {
      this.socket.emit("unsubscribe-document", { bucketId, filePath });
    }

    this.documents.delete(documentId);
  }

  /**
   * Get a document client
   */
  getDocument(bucketId: string, filePath: string): OTDocumentClient | undefined {
    return this.documents.get(`${bucketId}:${filePath}`);
  }

  /**
   * Get all documents for a bucket
   */
  getDocumentsForBucket(
    bucketId: string
  ): Map<string, OTDocumentClient> {
    const result = new Map<string, OTDocumentClient>();
    const prefix = `${bucketId}:`;
    for (const [docId, doc] of this.documents.entries()) {
      if (docId.startsWith(prefix)) {
        result.set(docId.slice(prefix.length), doc);
      }
    }
    return result;
  }

  /**
   * Get content for a specific document
   */
  getContent(bucketId: string, filePath: string): string {
    const doc = this.getDocument(bucketId, filePath);
    return doc?.content || "";
  }

  /**
   * Send a cursor update for a document
   */
  sendCursorUpdate(
    documentId: string,
    cursor: { lineNumber: number; column: number } | null,
    selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null,
    user: { name: string; color: string }
  ): void {
    if (this.socket && this._connected) {
      this.socket.emit("cursor-update", { documentId, cursor, selection, user });
    }
  }

  /**
   * Wait for a document to be ready (document-state received from server).
   * If the document is already available, calls the callback immediately.
   * Returns a cleanup function to cancel the callback.
   */
  onDocumentReady(bucketId: string, filePath: string, callback: (doc: OTDocumentClient) => void): () => void {
    const documentId = `${bucketId}:${filePath}`;
    const existing = this.documents.get(documentId);
    if (existing) {
      callback(existing);
      return () => {};
    }

    const callbacks = this.documentReadyCallbacks.get(documentId) || [];
    callbacks.push(callback);
    this.documentReadyCallbacks.set(documentId, callbacks);

    return () => {
      const cbs = this.documentReadyCallbacks.get(documentId);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
        if (cbs.length === 0) this.documentReadyCallbacks.delete(documentId);
      }
    };
  }
}

export const otProvider = new OTProvider();
