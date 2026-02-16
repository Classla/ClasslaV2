/**
 * OTPersistence - Postgres + S3 persistence layer for OT documents
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { logger } from "../../utils/logger";
import { supabase } from "../../middleware/auth";
import { Component } from "./TextOperation";

export interface OTDocumentRecord {
  id: string;
  bucket_id: string;
  file_path: string;
  current_revision: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface OperationRecord {
  id?: number;
  document_id: string;
  revision: number;
  author_id: string;
  operations: Component[];
  created_at?: string;
}

interface BucketInfo {
  bucket_name: string;
  region: string;
}

const s3ClientCache: Map<string, S3Client> = new Map();

function getS3ClientForBucket(region: string): S3Client {
  let client = s3ClientCache.get(region);
  if (!client) {
    client = new S3Client({
      region,
      credentials:
        process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
              secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
    s3ClientCache.set(region, client);
  }
  return client;
}

export class OTPersistence {
  private tablesAvailable = true;

  /**
   * Sanitize a string for PostgreSQL storage.
   * Strips null bytes (\u0000) and replaces lone surrogates with U+FFFD.
   * PostgreSQL TEXT rejects null bytes, and JSONB rejects both null bytes and lone surrogates.
   */
  private sanitizeForPostgres(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  }

  /**
   * Sanitize operation components for JSONB storage.
   * Only string components need sanitization; numbers pass through.
   */
  private sanitizeOperations(ops: Component[]): Component[] {
    return ops.map(op => typeof op === "string" ? this.sanitizeForPostgres(op) : op);
  }

  /**
   * Check if the error is a "table not found" error from Supabase/PostgREST
   */
  private isTableNotFoundError(error: any): boolean {
    const msg = error?.message || "";
    return (
      error?.code === "PGRST204" ||
      msg.includes("schema cache") ||
      (msg.includes("relation") && msg.includes("does not exist"))
    );
  }

  /**
   * Load document metadata from Postgres
   */
  async loadDocument(documentId: string): Promise<OTDocumentRecord | null> {
    if (!this.tablesAvailable) return null;

    const { data, error } = await supabase
      .from("ot_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      if (this.isTableNotFoundError(error)) {
        logger.warn("[OTPersistence] ot_documents table not found - running in memory-only mode. Apply the migration to enable persistence.");
        this.tablesAvailable = false;
        return null;
      }
      logger.error(`[OTPersistence] Failed to load document ${documentId}:`, error);
      throw error;
    }
    return data;
  }

  /**
   * Create or update document in Postgres
   */
  async saveDocument(doc: {
    id: string;
    bucket_id: string;
    file_path: string;
    current_revision: number;
    content: string;
  }): Promise<void> {
    if (!this.tablesAvailable) return;

    const { error } = await supabase.from("ot_documents").upsert(
      {
        id: doc.id,
        bucket_id: doc.bucket_id,
        file_path: doc.file_path,
        current_revision: doc.current_revision,
        content: this.sanitizeForPostgres(doc.content),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      if (this.isTableNotFoundError(error)) {
        this.tablesAvailable = false;
        return;
      }
      logger.error(`[OTPersistence] Failed to save document ${doc.id}:`, error);
      throw error;
    }
  }

  /**
   * Save an operation to the log
   */
  async saveOperation(record: OperationRecord): Promise<void> {
    if (!this.tablesAvailable) return;

    const { error } = await supabase.from("ot_operations").insert({
      document_id: record.document_id,
      revision: record.revision,
      author_id: record.author_id,
      operations: this.sanitizeOperations(record.operations),
    });

    if (error) {
      if (this.isTableNotFoundError(error)) {
        this.tablesAvailable = false;
        return;
      }
      logger.error(
        `[OTPersistence] Failed to save operation rev=${record.revision} for ${record.document_id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all operations since a given revision
   */
  async getOperationsSince(
    documentId: string,
    sinceRevision: number
  ): Promise<OperationRecord[]> {
    if (!this.tablesAvailable) return [];

    const { data, error } = await supabase
      .from("ot_operations")
      .select("*")
      .eq("document_id", documentId)
      .gt("revision", sinceRevision)
      .order("revision", { ascending: true });

    if (error) {
      if (this.isTableNotFoundError(error)) {
        this.tablesAvailable = false;
        return [];
      }
      logger.error(
        `[OTPersistence] Failed to get operations since rev=${sinceRevision} for ${documentId}:`,
        error
      );
      throw error;
    }
    return data || [];
  }

  /**
   * Load raw file content from S3
   */
  async loadFileFromS3(bucketInfo: BucketInfo, filePath: string): Promise<string | null> {
    const s3Client = getS3ClientForBucket(bucketInfo.region);
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketInfo.bucket_name,
          Key: filePath,
        })
      );

      if (response.Body) {
        const stream = response.Body as Readable;
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => resolve());
          stream.on("error", reject);
        });
        return Buffer.concat(chunks).toString("utf-8");
      }
      return null;
    } catch (error: any) {
      if (error.name === "NoSuchKey") return null;
      throw error;
    }
  }

  /**
   * Save file content to S3
   */
  async saveFileToS3(
    bucketInfo: BucketInfo,
    filePath: string,
    content: string
  ): Promise<void> {
    const s3Client = getS3ClientForBucket(bucketInfo.region);
    const extension = filePath.split(".").pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      py: "text/x-python",
      js: "text/javascript",
      ts: "text/typescript",
      java: "text/x-java-source",
      html: "text/html",
      css: "text/css",
      json: "application/json",
      md: "text/markdown",
      txt: "text/plain",
      sh: "text/x-shellscript",
    };
    const contentType = contentTypeMap[extension || ""] || "text/plain";

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: filePath,
        Body: Buffer.from(content, "utf-8"),
        ContentType: contentType,
      })
    );
  }

  /**
   * Compact old operations by removing ops older than keepCount
   */
  async compactOperations(documentId: string, keepCount: number = 500): Promise<void> {
    // Get current revision
    const doc = await this.loadDocument(documentId);
    if (!doc || doc.current_revision <= keepCount) return;

    const deleteBeforeRevision = doc.current_revision - keepCount;
    const { error } = await supabase
      .from("ot_operations")
      .delete()
      .eq("document_id", documentId)
      .lt("revision", deleteBeforeRevision);

    if (error) {
      logger.error(`[OTPersistence] Failed to compact operations for ${documentId}:`, error);
    } else {
      logger.info(
        `[OTPersistence] Compacted operations for ${documentId}, deleted revisions < ${deleteBeforeRevision}`
      );
    }
  }

  /**
   * Clear all operations for a document (used when reloading from DB to prevent stale revision conflicts)
   */
  async clearOperations(documentId: string): Promise<void> {
    if (!this.tablesAvailable) return;

    const { error } = await supabase
      .from("ot_operations")
      .delete()
      .eq("document_id", documentId);

    if (error) {
      if (this.isTableNotFoundError(error)) {
        this.tablesAvailable = false;
        return;
      }
      logger.error(`[OTPersistence] Failed to clear operations for ${documentId}:`, error);
    } else {
      logger.info(`[OTPersistence] Cleared all operations for ${documentId}`);
    }
  }

  /**
   * Delete a document and all its operations
   */
  async deleteDocument(documentId: string): Promise<void> {
    const { error } = await supabase
      .from("ot_documents")
      .delete()
      .eq("id", documentId);

    if (error) {
      logger.error(`[OTPersistence] Failed to delete document ${documentId}:`, error);
      throw error;
    }
  }
}
