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
 * If no Y.js state exists, tries to load the actual file and convert it to Y.js state
 */
export async function loadYjsDocumentFromS3(
  bucketInfo: BucketInfo,
  filePath: string
): Promise<Uint8Array | null> {
  const s3Client = getS3ClientForBucket(bucketInfo.region);
  const snapshotKey = getSnapshotKey(filePath);
  const updatesKey = getUpdatesKey(filePath);

  try {
    // Try to load snapshot first (faster)
    try {
      const snapshotCommand = new GetObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: snapshotKey,
      });

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

        // Try to load updates after snapshot
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

            // Merge snapshot + updates
            const doc = new Y.Doc();
            Y.applyUpdate(doc, snapshotState);
            Y.applyUpdate(doc, updatesState);
            return Y.encodeStateAsUpdate(doc);
          }
        } catch (updatesError: any) {
          // Updates not found, just use snapshot
          if (updatesError.name !== "NoSuchKey") {
            logger.warn(`Failed to load Y.js updates for ${filePath}:`, updatesError);
          }
        }

        return snapshotState;
      }
    } catch (snapshotError: any) {
      if (snapshotError.name === "NoSuchKey") {
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
            return new Uint8Array(updatesBuffer);
          }
        } catch (updatesError: any) {
          if (updatesError.name === "NoSuchKey") {
            // No Y.js document state found - try loading actual file from S3
            try {
              const fileContent = await loadFileContentFromS3(bucketInfo, filePath);
              if (fileContent !== null) {
                // Convert file content to Y.js document state
                const doc = new Y.Doc();
                const ytext = doc.getText("content");
                ytext.insert(0, fileContent);
                return Y.encodeStateAsUpdate(doc);
              }
            } catch (fileError: any) {
              // File doesn't exist, that's okay - return null for new file
              if (fileError.name !== "NoSuchKey") {
                logger.warn(`Failed to load file content for ${filePath}:`, fileError);
              }
            }
            return null;
          }
          throw updatesError;
        }
      } else {
        throw snapshotError;
      }
    }

    // No Y.js state found - try loading actual file from S3
    try {
      const fileContent = await loadFileContentFromS3(bucketInfo, filePath);
      if (fileContent !== null) {
        // Convert file content to Y.js document state
        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        ytext.insert(0, fileContent);
        return Y.encodeStateAsUpdate(doc);
      }
    } catch (fileError: any) {
      // File doesn't exist, that's okay - return null for new file
      if (fileError.name !== "NoSuchKey") {
        logger.warn(`Failed to load file content for ${filePath}:`, fileError);
      }
    }

    return null;
  } catch (error: any) {
    logger.error(`Failed to load Y.js document from S3 for ${filePath}:`, error);
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

  try {
    // Extract text content from Y.js document
    const ytext = doc.getText("content");
    const fileContent = ytext.toString();

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

    await s3Client.send(fileCommand);

    // Always save Y.js updates
    const updatesKey = getUpdatesKey(filePath);
    const updatesCommand = new PutObjectCommand({
      Bucket: bucketInfo.bucket_name,
      Key: updatesKey,
      Body: Buffer.from(state),
      ContentType: "application/octet-stream",
    });

    await s3Client.send(updatesCommand);

    // Optionally save snapshot (for faster loading)
    if (saveSnapshot) {
      const snapshotKey = getSnapshotKey(filePath);
      const snapshotCommand = new PutObjectCommand({
        Bucket: bucketInfo.bucket_name,
        Key: snapshotKey,
        Body: Buffer.from(state),
        ContentType: "application/octet-stream",
      });

      await s3Client.send(snapshotCommand);
    }

    logger.debug(`Saved Y.js document state and file content to S3 for ${filePath}`);
  } catch (error: any) {
    logger.error(`Failed to save Y.js document to S3 for ${filePath}:`, error);
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

