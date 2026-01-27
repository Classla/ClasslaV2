import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import * as Y from "yjs";
import { logger } from "../utils/logger";

interface BucketInfo {
  bucket_name: string;
  region: string;
}

/**
 * Get S3 client for a specific bucket
 */
function getS3ClientForBucket(region: string): S3Client {
  return new S3Client({
    region,
    credentials:
      process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
            secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

/**
 * Get S3 key for Y.js document snapshot
 */
export function getSnapshotKey(filePath: string): string {
  return `.yjs/${filePath}/snapshot.bin`;
}

/**
 * Get S3 key for Y.js document updates
 */
export function getUpdatesKey(filePath: string): string {
  return `.yjs/${filePath}/updates.bin`;
}

/**
 * Load file content from S3 (for initializing Y.js document)
 */
async function loadFileContentFromS3(
  bucketInfo: BucketInfo,
  filePath: string
): Promise<string | null> {
  const s3Client = getS3ClientForBucket(bucketInfo.region);
  
  try {
    const getCommand = new GetObjectCommand({
      Bucket: bucketInfo.bucket_name,
      Key: filePath,
    });

    const response = await s3Client.send(getCommand);
    
    if (response.Body) {
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });

      const buffer = Buffer.concat(chunks);
      return buffer.toString("utf-8");
    }
    
    return null;
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

/**
 * Load Y.js document state from S3
 * Returns the document state as a Uint8Array, or null if not found
 *
 * IMPORTANT: Raw file content is the source of truth!
 * If YJS state differs from raw file, we prefer the raw file content.
 * This prevents stale YJS state files from overriding user edits.
 */
export async function loadYjsDocumentFromS3(
  bucketInfo: BucketInfo,
  filePath: string
): Promise<Uint8Array | null> {
  const s3Client = getS3ClientForBucket(bucketInfo.region);
  const snapshotKey = getSnapshotKey(filePath);
  const updatesKey = getUpdatesKey(filePath);

  logger.info(`[YjsPersistence] 📥 Loading Y.js document from S3 for ${filePath}`, {
    bucket: bucketInfo.bucket_name,
    region: bucketInfo.region,
    snapshotKey,
    updatesKey
  });

  try {
    // CRITICAL: First load the raw file content as the source of truth
    let rawFileContent: string | null = null;
    try {
      rawFileContent = await loadFileContentFromS3(bucketInfo, filePath);
      if (rawFileContent !== null) {
        logger.info(`[YjsPersistence] 📄 Loaded raw file as source of truth for ${filePath}`, {
          contentLength: rawFileContent.length,
          contentPreview: rawFileContent.substring(0, 100)
        });
      }
    } catch (fileError: any) {
      if (fileError.name !== "NoSuchKey") {
        logger.warn(`Failed to load raw file content for ${filePath}:`, fileError);
      }
    }

    // Try to load YJS state (snapshot + updates)
    let yjsContent: string | null = null;
    let yjsState: Uint8Array | null = null;

    // Try to load snapshot first (faster)
    try {
      const snapshotCommand = new GetObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: snapshotKey,
      });

      logger.info(`[YjsPersistence] 🔍 Trying to load snapshot: ${snapshotKey}`);
      const snapshotResponse = await s3Client.send(snapshotCommand);

      if (snapshotResponse.Body) {
        const stream = snapshotResponse.Body as Readable;
        const chunks: Buffer[] = [];

        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => resolve());
          stream.on("error", reject);
        });

        const snapshotBuffer = Buffer.concat(chunks);
        const snapshotState = new Uint8Array(snapshotBuffer);
        logger.info(`[YjsPersistence] ✅ Loaded snapshot for ${filePath}`, { size: snapshotState.length });

        // Try to load updates after snapshot
        let mergedDoc = new Y.Doc();
        Y.applyUpdate(mergedDoc, snapshotState);

        try {
          const updatesCommand = new GetObjectCommand({
            Bucket: bucketInfo.bucket_name,
            Key: updatesKey,
          });

          const updatesResponse = await s3Client.send(updatesCommand);

          if (updatesResponse.Body) {
            const updatesStream = updatesResponse.Body as Readable;
            const updateChunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
              updatesStream.on("data", (chunk: Buffer) => updateChunks.push(chunk));
              updatesStream.on("end", () => resolve());
              updatesStream.on("error", reject);
            });

            const updatesBuffer = Buffer.concat(updateChunks);
            const updatesState = new Uint8Array(updatesBuffer);
            Y.applyUpdate(mergedDoc, updatesState);
            logger.info(`[YjsPersistence] ✅ Applied updates to snapshot for ${filePath}`, {
              updatesSize: updatesState.length
            });
          }
        } catch (updatesError: any) {
          if (updatesError.name !== "NoSuchKey") {
            logger.warn(`Failed to load Y.js updates for ${filePath}:`, updatesError);
          }
        }

        yjsContent = mergedDoc.getText("content").toString();
        yjsState = Y.encodeStateAsUpdate(mergedDoc);
        logger.info(`[YjsPersistence] 📊 YJS state content for ${filePath}`, {
          contentLength: yjsContent.length,
          contentPreview: yjsContent.substring(0, 100)
        });
      }
    } catch (snapshotError: any) {
      if (snapshotError.name === "NoSuchKey") {
        logger.info(`[YjsPersistence] ⚠️ No snapshot found for ${filePath}, trying updates only`);
        // Snapshot not found, try updates only
        try {
          const updatesCommand = new GetObjectCommand({
            Bucket: bucketInfo.bucket_name,
            Key: updatesKey,
          });

          const updatesResponse = await s3Client.send(updatesCommand);

          if (updatesResponse.Body) {
            const stream = updatesResponse.Body as Readable;
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => resolve());
              stream.on("error", reject);
            });

            const updatesBuffer = Buffer.concat(chunks);
            const updatesState = new Uint8Array(updatesBuffer);
            const doc = new Y.Doc();
            Y.applyUpdate(doc, updatesState);
            yjsContent = doc.getText("content").toString();
            yjsState = updatesState;
            logger.info(`[YjsPersistence] ✅ Loaded updates only for ${filePath}`, {
              size: updatesState.length,
              contentLength: yjsContent.length,
              contentPreview: yjsContent.substring(0, 100)
            });
          }
        } catch (updatesError: any) {
          if (updatesError.name !== "NoSuchKey") {
            throw updatesError;
          }
          logger.info(`[YjsPersistence] ⚠️ No updates found for ${filePath}`);
        }
      } else {
        throw snapshotError;
      }
    }

    // CRITICAL DECISION: Prefer raw file content over YJS state if they differ
    // This prevents stale YJS state from overriding user edits saved to raw file
    if (rawFileContent !== null) {
      if (yjsContent !== null && yjsContent !== rawFileContent) {
        logger.warn(`[YjsPersistence] ⚠️ YJS state differs from raw file for ${filePath}! Preferring raw file.`, {
          yjsContentLength: yjsContent.length,
          rawFileContentLength: rawFileContent.length,
          yjsPreview: yjsContent.substring(0, 50),
          rawPreview: rawFileContent.substring(0, 50)
        });
        // Create fresh YJS state from raw file content
        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        ytext.insert(0, rawFileContent);
        const state = Y.encodeStateAsUpdate(doc);
        logger.info(`[YjsPersistence] ✅ Using raw file content as Y.js for ${filePath} (overriding stale YJS state)`, {
          contentLength: rawFileContent.length,
          stateSize: state.length,
          contentPreview: rawFileContent.substring(0, 100)
        });
        return state;
      } else if (yjsState !== null) {
        // YJS state matches raw file, use YJS state (preserves CRDT history)
        logger.info(`[YjsPersistence] ✅ YJS state matches raw file for ${filePath}, using YJS state`, {
          contentLength: yjsContent?.length || 0,
          stateSize: yjsState.length,
          contentPreview: yjsContent?.substring(0, 100) || ''
        });
        return yjsState;
      } else {
        // No YJS state, create from raw file
        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        ytext.insert(0, rawFileContent);
        const state = Y.encodeStateAsUpdate(doc);
        logger.info(`[YjsPersistence] ✅ No YJS state found, created from raw file for ${filePath}`, {
          contentLength: rawFileContent.length,
          stateSize: state.length,
          contentPreview: rawFileContent.substring(0, 100)
        });
        return state;
      }
    }

    // No raw file content - use YJS state if available
    if (yjsState !== null) {
      logger.info(`[YjsPersistence] ✅ No raw file, using YJS state for ${filePath}`, {
        contentLength: yjsContent?.length || 0,
        stateSize: yjsState.length
      });
      return yjsState;
    }

    logger.info(`[YjsPersistence] ⚠️ No content found for ${filePath}, returning null (new file)`);
    return null;
  } catch (error: any) {
    logger.error(`[YjsPersistence] ❌ Failed to load Y.js document from S3 for ${filePath}:`, error);
    throw error;
  }
}

/**
 * Save Y.js document state to S3
 * Saves both snapshot and updates, and also saves the actual file content
 */
export async function saveYjsDocumentToS3(
  bucketInfo: BucketInfo,
  filePath: string,
  doc: Y.Doc,
  saveSnapshot: boolean = false
): Promise<void> {
  const s3Client = getS3ClientForBucket(bucketInfo.region);
  const state = Y.encodeStateAsUpdate(doc);

  logger.info(`[YjsPersistence] 🚀 Starting S3 save for ${filePath}`, {
    bucket: bucketInfo.bucket_name,
    region: bucketInfo.region,
    saveSnapshot,
    stateSize: state.length
  });

  try {
    // Extract text content from Y.js document
    const ytext = doc.getText("content");
    const fileContent = ytext.toString();

    logger.info(`[YjsPersistence] 📄 Extracted content for ${filePath}`, {
      contentLength: fileContent.length,
      contentPreview: fileContent.substring(0, 100) + (fileContent.length > 100 ? '...' : '')
    });

    // Save actual file content to S3 (for compatibility and normal file access)
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

    const fileCommand = new PutObjectCommand({
      Bucket: bucketInfo.bucket_name,
      Key: filePath,
      Body: Buffer.from(fileContent, "utf-8"),
      ContentType: contentType,
    });

    logger.info(`[YjsPersistence] 📤 Uploading file content to S3: ${bucketInfo.bucket_name}/${filePath}`, {
      contentLength: fileContent.length,
      bodyLength: Buffer.from(fileContent, "utf-8").length
    });
    const uploadResult = await s3Client.send(fileCommand);
    logger.info(`[YjsPersistence] ✅ File content uploaded: ${filePath}`, {
      etag: uploadResult.ETag,
      versionId: uploadResult.VersionId,
      bucket: bucketInfo.bucket_name,
      key: filePath,
      uploadedSize: Buffer.from(fileContent, "utf-8").length
    });

    // Always save Y.js updates
    const updatesKey = getUpdatesKey(filePath);
    const updatesCommand = new PutObjectCommand({
      Bucket: bucketInfo.bucket_name,
      Key: updatesKey,
      Body: Buffer.from(state),
      ContentType: "application/octet-stream",
    });

    logger.info(`[YjsPersistence] 📤 Uploading Y.js updates to S3: ${updatesKey}`);
    await s3Client.send(updatesCommand);
    logger.info(`[YjsPersistence] ✅ Y.js updates uploaded: ${updatesKey}`);

    // Optionally save snapshot (for faster loading)
    if (saveSnapshot) {
      const snapshotKey = getSnapshotKey(filePath);
      const snapshotCommand = new PutObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: snapshotKey,
        Body: Buffer.from(state),
        ContentType: "application/octet-stream",
      });

      logger.info(`[YjsPersistence] 📤 Uploading Y.js snapshot to S3: ${snapshotKey}`);
      await s3Client.send(snapshotCommand);
      logger.info(`[YjsPersistence] ✅ Y.js snapshot uploaded: ${snapshotKey}`);
    }

    logger.info(`[YjsPersistence] ✅✅ All S3 uploads completed for ${filePath}`, {
      fileKey: filePath,
      updatesKey,
      snapshotSaved: saveSnapshot
    });
  } catch (error: any) {
    logger.error(`[YjsPersistence] ❌ Failed to save Y.js document to S3 for ${filePath}:`, {
      error: error.message,
      code: error.code,
      name: error.name,
      bucket: bucketInfo.bucket_name,
      region: bucketInfo.region
    });
    throw error;
  }
}

/**
 * Check if Y.js document exists in S3
 */
export async function yjsDocumentExistsInS3(
  bucketInfo: BucketInfo,
  filePath: string
): Promise<boolean> {
  const s3Client = getS3ClientForBucket(bucketInfo.region);
  const snapshotKey = getSnapshotKey(filePath);
  const updatesKey = getUpdatesKey(filePath);

  try {
    // Check if snapshot exists
    try {
      const snapshotCommand = new HeadObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: snapshotKey,
      });
      await s3Client.send(snapshotCommand);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound") {
        // Check if updates exist
        try {
          const updatesCommand = new HeadObjectCommand({
            Bucket: bucketInfo.bucket_name,
            Key: updatesKey,
          });
          await s3Client.send(updatesCommand);
          return true;
        } catch (updatesError: any) {
          return false;
        }
      }
      throw error;
    }
  } catch (error: any) {
    logger.error(`Failed to check Y.js document existence in S3 for ${filePath}:`, error);
    return false;
  }
}

