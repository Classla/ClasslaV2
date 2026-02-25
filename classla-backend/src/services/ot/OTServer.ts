/**
 * OTServer - Server-side OT engine managing document state
 *
 * The server is the single source of truth. It receives operations from clients,
 * transforms them against any missed concurrent operations, applies them to the
 * document, and persists the result.
 */

import { TextOperation, Component } from "./TextOperation";
import { OTPersistence, OTDocumentRecord, OperationRecord } from "./OTPersistence";
import { logger } from "../../utils/logger";

// Use diff-match-patch for computing diffs (for container full-content sync)
const DiffMatchPatch = require("diff-match-patch");
const dmp = new DiffMatchPatch();

interface BucketInfo {
  bucket_name: string;
  region: string;
}

export interface OTDocument {
  id: string;
  bucketId: string;
  filePath: string;
  bucketInfo: BucketInfo;
  content: string;
  revision: number;
}

export type BucketMode = 'A' | 'B';

export class OTServer {
  private documents: Map<string, OTDocument> = new Map();
  private persistence: OTPersistence;
  private saveTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private cleanupTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private operationQueues: Map<string, Promise<any>> = new Map();
  private bucketModes: Map<string, BucketMode> = new Map();
  private s3BackgroundTimers: Map<string, NodeJS.Timeout> = new Map();
  private static readonly SAVE_DEBOUNCE_MS = 1000;
  private static readonly CLEANUP_GRACE_PERIOD_MS = 30000;
  private static readonly MODE_B_S3_INTERVAL_MS = 30000;

  constructor() {
    this.persistence = new OTPersistence();
  }

  /**
   * Set the sync mode for a bucket.
   * Mode A: OT server = source of truth, S3 = background persistence (1s debounce)
   * Mode B: Container filesystem = authority, S3 = background only (30s interval)
   */
  setBucketMode(bucketId: string, mode: BucketMode): void {
    const prev = this.bucketModes.get(bucketId) || 'A';
    this.bucketModes.set(bucketId, mode);
    logger.info(`[OTServer] Bucket ${bucketId} mode: ${prev} → ${mode}`);

    if (mode === 'B') {
      // Start background S3 persistence timer
      this.startS3BackgroundTimer(bucketId);
    } else {
      // Stop background timer, flush to S3
      this.stopS3BackgroundTimer(bucketId);
    }
  }

  getBucketMode(bucketId: string): BucketMode {
    return this.bucketModes.get(bucketId) || 'A';
  }

  /**
   * Normalize line endings to LF only.
   * Prevents \r\n divergence between Monaco (LF-only) and content loaded from S3/DB.
   */
  private normalizeContent(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  private startS3BackgroundTimer(bucketId: string): void {
    this.stopS3BackgroundTimer(bucketId);
    const timer = setInterval(async () => {
      try {
        await this.saveAllDocumentsToS3ForBucket(bucketId);
      } catch (e) {
        logger.error(`[OTServer] Background S3 save failed for bucket ${bucketId}:`, e);
      }
    }, OTServer.MODE_B_S3_INTERVAL_MS);
    this.s3BackgroundTimers.set(bucketId, timer);
  }

  private stopS3BackgroundTimer(bucketId: string): void {
    const timer = this.s3BackgroundTimers.get(bucketId);
    if (timer) {
      clearInterval(timer);
      this.s3BackgroundTimers.delete(bucketId);
    }
  }

  /**
   * Save all in-memory documents for a bucket to S3 only (no Postgres, used by background timer)
   */
  private async saveAllDocumentsToS3ForBucket(bucketId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, doc] of this.documents.entries()) {
      if (doc.bucketId === bucketId) {
        promises.push(
          this.persistence.saveFileToS3(doc.bucketInfo, doc.filePath, doc.content).catch((e) => {
            logger.error(`[OTServer] Background S3 save failed for ${doc.id}:`, e);
          })
        );
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
      logger.debug(`[OTServer] Background S3 save: ${promises.length} docs for bucket ${bucketId}`);
    }
  }

  /**
   * Serialize operations per document to prevent concurrent modifications.
   * Each document's operations run sequentially through a promise chain.
   */
  private enqueue<T>(documentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.operationQueues.get(documentId) || Promise.resolve();
    const next = prev.then(fn, fn); // Run fn even if previous rejected
    this.operationQueues.set(documentId, next.catch(() => {})); // Prevent unhandled rejection
    return next;
  }

  /**
   * Get document ID from bucket ID and file path
   */
  static getDocumentId(bucketId: string, filePath: string): string {
    return `${bucketId}:${filePath}`;
  }

  /**
   * Get or load a document. Creates from S3 if not in memory or DB.
   */
  async getDocument(
    documentId: string,
    bucketId?: string,
    filePath?: string,
    bucketInfo?: BucketInfo
  ): Promise<OTDocument | null> {
    // Check in-memory cache
    if (this.documents.has(documentId)) {
      return this.documents.get(documentId)!;
    }

    // Must have creation params to load/create
    if (!bucketId || !filePath || !bucketInfo) {
      return null;
    }

    return this.loadOrCreateDocument(documentId, bucketId, filePath, bucketInfo);
  }

  /**
   * Load document from Postgres or create from S3 content
   */
  private async loadOrCreateDocument(
    documentId: string,
    bucketId: string,
    filePath: string,
    bucketInfo: BucketInfo
  ): Promise<OTDocument> {
    // Try loading from Postgres
    const dbDoc = await this.persistence.loadDocument(documentId);

    if (dbDoc) {
      // Load from Postgres only — container no longer writes directly to S3,
      // so S3 can't diverge from Postgres.
      let content = this.normalizeContent(dbDoc.content);
      let revision = dbDoc.current_revision;

      // Clear stale operations from previous sessions.
      // Operations are only needed for transforming concurrent edits within a session.
      // When reloading from DB (document not in memory = no active editors),
      // old operations can cause revision conflicts (duplicate key errors).
      // Start fresh with the current content as the baseline.
      await this.persistence.clearOperations(documentId);
      revision = 0;

      // Save the clean state
      await this.persistence.saveDocument({
        id: documentId,
        bucket_id: bucketId,
        file_path: filePath,
        current_revision: revision,
        content,
      });

      const doc: OTDocument = {
        id: documentId,
        bucketId,
        filePath,
        bucketInfo,
        content,
        revision,
      };
      this.documents.set(documentId, doc);
      logger.info(`[OTServer] Loaded document ${documentId} from DB (rev=${revision}, content len=${content.length})`);
      return doc;
    }

    // No DB record - create from S3 file content
    let content = "";
    try {
      const s3Content = await this.persistence.loadFileFromS3(bucketInfo, filePath);
      if (s3Content !== null) {
        content = this.normalizeContent(s3Content);
      }
    } catch (error: any) {
      logger.warn(`[OTServer] Failed to load S3 content for new document ${documentId}:`, error);
    }

    const doc: OTDocument = {
      id: documentId,
      bucketId,
      filePath,
      bucketInfo,
      content,
      revision: 0,
    };

    // Persist to DB
    await this.persistence.saveDocument({
      id: documentId,
      bucket_id: bucketId,
      file_path: filePath,
      current_revision: 0,
      content,
    });

    this.documents.set(documentId, doc);
    logger.info(
      `[OTServer] Created new document ${documentId} (content length=${content.length})`
    );
    return doc;
  }

  /**
   * Create a document (explicit creation for subscribe flow)
   */
  async createDocument(
    bucketId: string,
    filePath: string,
    bucketInfo: BucketInfo
  ): Promise<OTDocument> {
    const documentId = OTServer.getDocumentId(bucketId, filePath);
    // Return in-memory document if already loaded (e.g., another tab is editing)
    if (this.documents.has(documentId)) {
      return this.documents.get(documentId)!;
    }
    return this.loadOrCreateDocument(documentId, bucketId, filePath, bucketInfo);
  }

  /**
   * Receive an operation from a client.
   * Serialized per-document to prevent concurrent modification.
   *
   * Critical path:
   * 1. Load document
   * 2. If client is behind, transform against missed ops
   * 3. Apply to document
   * 4. Persist
   * 5. Return transformed operation for broadcasting
   */
  async receiveOperation(
    documentId: string,
    clientRevision: number,
    operation: TextOperation,
    authorId: string
  ): Promise<{ revision: number; operation: TextOperation }> {
    return this.enqueue(documentId, async () => {
      const doc = this.documents.get(documentId);
      if (!doc) {
        throw new Error(`Document not found: ${documentId}`);
      }

      let transformedOp = operation;

      // If client is behind, transform against missed operations
      if (clientRevision < doc.revision) {
        const missedOps = await this.persistence.getOperationsSince(documentId, clientRevision);

        if (missedOps.length !== doc.revision - clientRevision) {
          throw new Error(
            `Operation log gap for ${documentId}: expected ${doc.revision - clientRevision} ops, got ${missedOps.length}. Client should resync.`
          );
        }

        for (const missedOp of missedOps) {
          const serverOp = TextOperation.fromJSON(missedOp.operations);
          const [clientPrime] = TextOperation.transform(transformedOp, serverOp);
          transformedOp = clientPrime;
        }
      } else if (clientRevision > doc.revision) {
        throw new Error(
          `Client revision ${clientRevision} is ahead of server revision ${doc.revision} for ${documentId}`
        );
      }

      // Apply to document — save old state for rollback if persistence fails
      const oldContent = doc.content;
      const oldRevision = doc.revision;

      try {
        doc.content = transformedOp.apply(doc.content);
      } catch (error: any) {
        logger.error(
          `[OTServer] Failed to apply operation to ${documentId} (rev=${doc.revision}):`,
          {
            error: error.message,
            docLength: doc.content.length,
            opBaseLength: transformedOp.baseLength,
            opTargetLength: transformedOp.targetLength,
          }
        );
        throw error;
      }

      doc.revision++;

      // Persist operation to DB — rollback in-memory state on failure
      try {
        await this.persistence.saveOperation({
          document_id: documentId,
          revision: doc.revision,
          author_id: authorId,
          operations: transformedOp.toJSON(),
        });
      } catch (persistError: any) {
        logger.error(
          `[OTServer] Persistence failed for ${documentId} (rev=${doc.revision}), rolling back in-memory state:`,
          persistError
        );
        doc.content = oldContent;
        doc.revision = oldRevision;
        throw persistError;
      }

      // Debounced save to DB + S3
      this.debouncedSave(doc);

      // Periodic compaction
      if (doc.revision % 500 === 0) {
        this.persistence.compactOperations(documentId).catch((e) => {
          logger.error(`[OTServer] Compaction failed for ${documentId}:`, e);
        });
      }

      return { revision: doc.revision, operation: transformedOp };
    });
  }

  /**
   * Apply full content from container (REST sync).
   * Computes a minimal TextOperation from old→new content using diff-match-patch,
   * then applies it atomically. Serialized per-document.
   */
  async applyFullContent(
    documentId: string,
    newContent: string,
    authorId: string
  ): Promise<{ revision: number; operation: TextOperation } | null> {
    return this.enqueue(documentId, async () => {
      const doc = this.documents.get(documentId);
      if (!doc) {
        throw new Error(`Document not found: ${documentId}`);
      }

      // Bug #4: Normalize line endings before comparison/diff
      newContent = this.normalizeContent(newContent);

      // No change
      if (doc.content === newContent) {
        return null;
      }

      // Use diff-match-patch to compute minimal diff
      const diffs = dmp.diff_main(doc.content, newContent);
      dmp.diff_cleanupEfficiency(diffs);

      // Convert diffs to TextOperation
      const op = new TextOperation();
      for (const [type, text] of diffs) {
        switch (type) {
          case 0: // EQUAL
            op.retain(text.length);
            break;
          case 1: // INSERT
            op.insert(text);
            break;
          case -1: // DELETE
            op.delete(text.length);
            break;
        }
      }

      if (op.isNoop()) {
        return null;
      }

      // Apply directly (we're already in the queue, don't call receiveOperation which also enqueues)
      try {
        doc.content = op.apply(doc.content);
      } catch (error: any) {
        logger.error(`[OTServer] Failed to apply container content to ${documentId}:`, {
          error: error.message,
          docLength: doc.content.length,
          opBaseLength: op.baseLength,
        });
        throw error;
      }

      doc.revision++;

      await this.persistence.saveOperation({
        document_id: documentId,
        revision: doc.revision,
        author_id: authorId,
        operations: op.toJSON(),
      });

      this.debouncedSave(doc);

      return { revision: doc.revision, operation: op };
    });
  }

  /**
   * Get operations since a given revision
   */
  async getOperationsSince(
    documentId: string,
    sinceRevision: number
  ): Promise<OperationRecord[]> {
    return this.persistence.getOperationsSince(documentId, sinceRevision);
  }

  /**
   * Debounced save: persist document content to Postgres + S3
   * Mode A: save to both Postgres and S3 (1s debounce)
   * Mode B: always save to Postgres, skip S3 (handled by background timer)
   */
  private debouncedSave(doc: OTDocument): void {
    if (this.saveTimeouts.has(doc.id)) {
      clearTimeout(this.saveTimeouts.get(doc.id)!);
    }

    const timeout = setTimeout(async () => {
      this.saveTimeouts.delete(doc.id);
      try {
        // Always save to Postgres (OT operation log integrity)
        await this.persistence.saveDocument({
          id: doc.id,
          bucket_id: doc.bucketId,
          file_path: doc.filePath,
          current_revision: doc.revision,
          content: doc.content,
        });

        // Only save to S3 in Mode A; Mode B uses background timer
        const mode = this.getBucketMode(doc.bucketId);
        if (mode === 'A') {
          await this.persistence.saveFileToS3(doc.bucketInfo, doc.filePath, doc.content);
        }

        logger.debug(`[OTServer] Saved document ${doc.id} (rev=${doc.revision}, mode=${mode})`);
      } catch (error: any) {
        logger.error(`[OTServer] Failed to save document ${doc.id}:`, error);
      }
    }, OTServer.SAVE_DEBOUNCE_MS);

    this.saveTimeouts.set(doc.id, timeout);
  }

  /**
   * Force save a document immediately
   */
  async forceSaveDocument(documentId: string): Promise<void> {
    // Clear any pending debounced save
    if (this.saveTimeouts.has(documentId)) {
      clearTimeout(this.saveTimeouts.get(documentId)!);
      this.saveTimeouts.delete(documentId);
    }

    const doc = this.documents.get(documentId);
    if (!doc) return;

    await this.persistence.saveDocument({
      id: doc.id,
      bucket_id: doc.bucketId,
      file_path: doc.filePath,
      current_revision: doc.revision,
      content: doc.content,
    });

    await this.persistence.saveFileToS3(doc.bucketInfo, doc.filePath, doc.content);
    logger.info(`[OTServer] Force saved document ${documentId} (rev=${doc.revision})`);
  }

  /**
   * Get in-memory document content without loading from S3/DB.
   * Returns null if the document is not currently in memory.
   */
  getDocumentContent(bucketId: string, filePath: string): string | null {
    const documentId = OTServer.getDocumentId(bucketId, filePath);
    const doc = this.documents.get(documentId);
    return doc ? doc.content : null;
  }

  /**
   * Get all in-memory document contents for a bucket.
   * Returns array of {path, content} for text documents currently in memory.
   */
  getDocumentContentsForBucket(bucketId: string): { path: string; content: string }[] {
    const results: { path: string; content: string }[] = [];
    for (const [, doc] of this.documents.entries()) {
      if (doc.bucketId === bucketId) {
        results.push({ path: doc.filePath, content: doc.content });
      }
    }
    return results;
  }

  /**
   * Force save all in-memory documents for a specific bucket.
   * Returns the list of file paths that were saved.
   */
  async forceSaveDocumentsForBucket(bucketId: string): Promise<string[]> {
    const savedPaths: string[] = [];
    const promises: Promise<void>[] = [];
    for (const [documentId, doc] of this.documents.entries()) {
      if (doc.bucketId === bucketId) {
        savedPaths.push(doc.filePath);
        promises.push(
          this.forceSaveDocument(documentId).catch((e) => {
            logger.error(`[OTServer] Failed to save ${documentId} during bucket flush:`, e);
          })
        );
      }
    }
    await Promise.all(promises);
    if (savedPaths.length > 0) {
      logger.info(`[OTServer] Force-saved ${savedPaths.length} documents for bucket ${bucketId}`);
    }
    return savedPaths;
  }

  /**
   * Force save all documents
   */
  async saveAllDocuments(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const documentId of this.documents.keys()) {
      promises.push(
        this.forceSaveDocument(documentId).catch((e) => {
          logger.error(`[OTServer] Failed to save ${documentId} during saveAll:`, e);
        })
      );
    }
    await Promise.all(promises);
    logger.info(`[OTServer] Saved ${promises.length} documents`);
  }

  /**
   * Clean up a document from memory
   */
  cleanupDocument(documentId: string, skipSave: boolean = false): void {
    // Clear pending save
    if (this.saveTimeouts.has(documentId)) {
      clearTimeout(this.saveTimeouts.get(documentId)!);
      this.saveTimeouts.delete(documentId);
    }

    // Clear cleanup timeout
    if (this.cleanupTimeouts.has(documentId)) {
      clearTimeout(this.cleanupTimeouts.get(documentId)!);
      this.cleanupTimeouts.delete(documentId);
    }

    const doc = this.documents.get(documentId);
    if (!doc) return;

    if (!skipSave) {
      // Fire-and-forget final save
      this.forceSaveDocument(documentId).catch((e) => {
        logger.error(`[OTServer] Failed to save during cleanup for ${documentId}:`, e);
      });
    }

    this.documents.delete(documentId);
    logger.info(`[OTServer] Cleaned up document ${documentId}`);
  }

  /**
   * Schedule cleanup after grace period
   */
  scheduleCleanup(documentId: string): void {
    if (this.cleanupTimeouts.has(documentId)) {
      clearTimeout(this.cleanupTimeouts.get(documentId)!);
    }

    const timeout = setTimeout(() => {
      this.cleanupTimeouts.delete(documentId);
      this.cleanupDocument(documentId);
    }, OTServer.CLEANUP_GRACE_PERIOD_MS);

    this.cleanupTimeouts.set(documentId, timeout);
  }

  /**
   * Cancel scheduled cleanup (e.g., when a client reconnects)
   */
  cancelCleanup(documentId: string): void {
    if (this.cleanupTimeouts.has(documentId)) {
      clearTimeout(this.cleanupTimeouts.get(documentId)!);
      this.cleanupTimeouts.delete(documentId);
    }
  }

  /**
   * Delete a document from memory, DB, and cancel saves
   */
  async deleteDocumentPermanently(documentId: string): Promise<void> {
    this.cleanupDocument(documentId, true);
    await this.persistence.deleteDocument(documentId);
    logger.info(`[OTServer] Permanently deleted document ${documentId}`);
  }

  /**
   * Check if a document is in memory
   */
  hasDocument(documentId: string): boolean {
    return this.documents.has(documentId);
  }

  /**
   * Get all document IDs in memory
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }
}
