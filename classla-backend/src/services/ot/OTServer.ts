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

export class OTServer {
  private documents: Map<string, OTDocument> = new Map();
  private persistence: OTPersistence;
  private saveTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private cleanupTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private operationQueues: Map<string, Promise<any>> = new Map();
  private static readonly SAVE_DEBOUNCE_MS = 1000;
  private static readonly CLEANUP_GRACE_PERIOD_MS = 30000;

  constructor() {
    this.persistence = new OTPersistence();
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
      // Also check S3 content to see if container has updated the file directly
      let s3Content: string | null = null;
      try {
        s3Content = await this.persistence.loadFileFromS3(bucketInfo, filePath);
      } catch (e) {
        logger.warn(`[OTServer] Failed to load S3 content for ${documentId}, using DB content`);
      }

      let content = dbDoc.content;
      let revision = dbDoc.current_revision;

      // If S3 content differs from DB, prefer S3 (container may have changed file directly)
      if (s3Content !== null && s3Content !== dbDoc.content) {
        logger.warn(
          `[OTServer] S3 content differs from DB for ${documentId}, using S3 content`,
          {
            dbLen: dbDoc.content.length,
            s3Len: s3Content.length,
          }
        );
        content = s3Content;
        // Increment revision since content changed
        revision = dbDoc.current_revision + 1;
        // Save updated content to DB
        await this.persistence.saveDocument({
          id: documentId,
          bucket_id: bucketId,
          file_path: filePath,
          current_revision: revision,
          content,
        });
      }

      const doc: OTDocument = {
        id: documentId,
        bucketId,
        filePath,
        bucketInfo,
        content,
        revision,
      };
      this.documents.set(documentId, doc);
      logger.info(`[OTServer] Loaded document ${documentId} from DB (rev=${revision})`);
      return doc;
    }

    // No DB record - create from S3 file content
    let content = "";
    try {
      const s3Content = await this.persistence.loadFileFromS3(bucketInfo, filePath);
      if (s3Content !== null) {
        content = s3Content;
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
          logger.warn(
            `[OTServer] Operation log gap for ${documentId}: expected ${doc.revision - clientRevision} ops, got ${missedOps.length}`
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

      // Apply to document
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

      // Persist operation to DB
      await this.persistence.saveOperation({
        document_id: documentId,
        revision: doc.revision,
        author_id: authorId,
        operations: transformedOp.toJSON(),
      });

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
   */
  private debouncedSave(doc: OTDocument): void {
    if (this.saveTimeouts.has(doc.id)) {
      clearTimeout(this.saveTimeouts.get(doc.id)!);
    }

    const timeout = setTimeout(async () => {
      this.saveTimeouts.delete(doc.id);
      try {
        // Save to Postgres
        await this.persistence.saveDocument({
          id: doc.id,
          bucket_id: doc.bucketId,
          file_path: doc.filePath,
          current_revision: doc.revision,
          content: doc.content,
        });

        // Save to S3
        await this.persistence.saveFileToS3(doc.bucketInfo, doc.filePath, doc.content);

        logger.debug(`[OTServer] Saved document ${doc.id} (rev=${doc.revision})`);
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
