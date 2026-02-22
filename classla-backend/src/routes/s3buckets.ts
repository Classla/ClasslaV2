import express, { Request, Response } from "express";
import { supabase, authenticateToken } from "../middleware/auth";
import { AuthenticationError } from "../middleware/errorHandler";
import { sessionManagementService } from "../services/session";
import {
  isEnrolledInCourse,
  getCoursePermissions,
  getUserCourseRole,
  CoursePermissions
} from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { v4 as uuidv4 } from "uuid";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { asyncHandler } from "../middleware/errorHandler";
import { logger } from "../utils/logger";

const router = express.Router();

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
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTENSIONS.has(ext || '');
}

// S3 buckets are always created in us-east-1
// This is separate from the backend's AWS_REGION which may be different
const S3_DEFAULT_REGION = "us-east-1";

// Initialize S3 client
const s3Client = new S3Client({
  region: S3_DEFAULT_REGION,
  credentials:
    process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
          secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
        }
      : undefined,
});

/**
 * S3 Bucket type for authorization checks
 */
interface S3Bucket {
  id: string;
  bucket_name: string;
  user_id: string;
  course_id: string | null;
  assignment_id: string | null;
  block_id: string | null;
  is_template: boolean;
  is_snapshot: boolean | null;
  region: string;
  status: string;
  deleted_at: string | null;
}

/**
 * Enable S3 versioning and lifecycle policy on a bucket.
 * Non-fatal — logs warning on failure.
 */
async function enableBucketVersioning(bucketName: string): Promise<void> {
  try {
    await s3Client.send(new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: { Status: "Enabled" },
    }));
    await s3Client.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: [{
          ID: "expire-old-versions",
          Status: "Enabled",
          Filter: { Prefix: "" },
          NoncurrentVersionExpiration: { NoncurrentDays: 30 },
        }],
      },
    }));
  } catch (error: any) {
    logger.warn(`[S3 Versioning] Failed to enable versioning on ${bucketName}:`, error.message);
  }
}

/**
 * Check if a user can access an S3 bucket based on ownership and course permissions.
 *
 * Authorization logic:
 * 1. System admins (isAdmin=true) can access all buckets
 * 2. Bucket owner always has full access
 * 3. If bucket has a course_id:
 *    - Instructors can access all buckets in their course
 *    - TAs can read all buckets; write access depends on TA permissions
 *    - For student-owned buckets, TAs/Instructors need canGrade to access
 *
 * @param userId - The ID of the user requesting access
 * @param bucket - The S3 bucket being accessed
 * @param isAdmin - Whether the user is a system admin
 * @param requiredPermission - 'read' for viewing, 'write' for modifications
 * @returns Promise<boolean> - Whether access should be granted
 */
const canAccessBucket = async (
  userId: string,
  bucket: S3Bucket,
  isAdmin: boolean,
  requiredPermission: 'read' | 'write' = 'read'
): Promise<boolean> => {
  // 1. System admins bypass all checks
  if (isAdmin) {
    return true;
  }

  // 2. Bucket owner always has access
  if (bucket.user_id === userId) {
    return true;
  }

  // 3. Check course permissions if bucket has course_id
  if (bucket.course_id) {
    const permissions = await getCoursePermissions(userId, bucket.course_id, false);

    // Not enrolled in course at all
    if (!permissions.canRead) {
      return false;
    }

    // Instructors have full access to all course buckets
    if (permissions.canManage) {
      return true;
    }

    // For read access: TAs and other elevated roles can read
    if (requiredPermission === 'read') {
      // Check if this is a student's bucket
      const ownerRole = await getUserCourseRole(bucket.user_id, bucket.course_id);

      if (ownerRole === UserRole.STUDENT || ownerRole === UserRole.AUDIT) {
        // For student buckets, need canGrade permission to view submissions
        return permissions.canGrade;
      }

      // For instructor/TA buckets (templates, model solutions), TAs can read
      return permissions.canRead;
    }

    // For write access: need canWrite permission
    if (requiredPermission === 'write') {
      // Check if this is a student's bucket
      const ownerRole = await getUserCourseRole(bucket.user_id, bucket.course_id);

      if (ownerRole === UserRole.STUDENT || ownerRole === UserRole.AUDIT) {
        // Only instructors can write to student buckets (for feedback, etc.)
        // TAs typically shouldn't modify student submissions
        return permissions.canManage;
      }

      // For course template buckets, TAs with write permission can edit
      return permissions.canWrite;
    }
  }

  return false;
};

/**
 * Create a read-only snapshot of an S3 bucket for a submission.
 * Copies all objects from the source bucket into a new "snapshot" bucket
 * and records it in the database linked to the submission.
 *
 * @param sourceBucketId - The live bucket to snapshot
 * @param submissionId - The submission this snapshot belongs to
 * @returns The snapshot bucket ID
 */
export async function createBucketSnapshot(
  sourceBucketId: string,
  submissionId: string
): Promise<string> {
  // Fetch the source bucket
  const { data: sourceBucket, error: fetchError } = await supabase
    .from("s3_buckets")
    .select("*")
    .eq("id", sourceBucketId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !sourceBucket) {
    throw new Error(`Source bucket not found: ${sourceBucketId}`);
  }

  // Create a new snapshot bucket
  const bucketName = `classla-snapshot-${sourceBucket.user_id.substring(0, 8)}-${Date.now()}`;
  const bucketRegion = sourceBucket.region || S3_DEFAULT_REGION;
  const bucketId = uuidv4();

  // Insert snapshot bucket record
  const { error: insertError } = await supabase.from("s3_buckets").insert({
    id: bucketId,
    bucket_name: bucketName,
    region: bucketRegion,
    user_id: sourceBucket.user_id,
    course_id: sourceBucket.course_id || null,
    assignment_id: sourceBucket.assignment_id || null,
    block_id: sourceBucket.block_id || null,
    status: "creating",
    is_template: false,
    is_snapshot: true,
    submission_id: submissionId,
  });

  if (insertError) {
    throw new Error(`Failed to insert snapshot bucket record: ${insertError.message}`);
  }

  try {
    // Create the S3 bucket
    await s3Client.send(new CreateBucketCommand({
      Bucket: bucketName,
      CreateBucketConfiguration:
        bucketRegion !== "us-east-1"
          ? { LocationConstraint: bucketRegion as any }
          : undefined,
    }));

    // List all objects in source bucket
    const listResponse = await s3Client.send(new ListObjectsV2Command({
      Bucket: sourceBucket.bucket_name,
    }));

    // Copy all objects in parallel
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const copyPromises = listResponse.Contents
        .filter((obj) => obj.Key)
        .map((obj) =>
          s3Client.send(new CopyObjectCommand({
            CopySource: `${sourceBucket.bucket_name}/${obj.Key}`,
            Bucket: bucketName,
            Key: obj.Key!,
          })).catch((err) => {
            logger.error(`Failed to copy object ${obj.Key} during snapshot:`, err);
          })
        );
      await Promise.all(copyPromises);
    }

    // Mark as active
    await supabase
      .from("s3_buckets")
      .update({ status: "active" })
      .eq("id", bucketId);

    return bucketId;
  } catch (error: any) {
    // Mark as error
    await supabase
      .from("s3_buckets")
      .update({ status: "error" })
      .eq("id", bucketId);
    throw new Error(`Failed to create snapshot bucket: ${error.message}`);
  }
}

// ─── Image Block Presigned URL Endpoints ───────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Ensure the assignment-level image bucket exists.
 * Creates it with CORS if it doesn't already exist.
 */
async function ensureImageBucket(assignmentId: string): Promise<string> {
  const bucketName = `classla-images-${assignmentId}`;

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    // Bucket already exists
    return bucketName;
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404 || err.name === "NoSuchBucket") {
      // Create the bucket
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: bucketName,
          // us-east-1 doesn't need LocationConstraint
        })
      );

      // Configure CORS for direct browser uploads
      const allowedOrigins: string[] = [];
      if (process.env.NODE_ENV === "development") {
        allowedOrigins.push("http://localhost:5173", "http://localhost:3000");
      }
      if (process.env.FRONTEND_URL) {
        try {
          allowedOrigins.push(new URL(process.env.FRONTEND_URL).origin);
        } catch { /* ignore invalid URL */ }
      }
      allowedOrigins.push("https://app.classla.org");

      await s3Client.send(
        new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ["*"],
                AllowedMethods: ["PUT", "GET"],
                AllowedOrigins: allowedOrigins,
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        })
      );

      return bucketName;
    }
    throw err;
  }
}

/**
 * POST /api/s3buckets/image-upload-url
 * Get a presigned PUT URL for uploading an image to the assignment's image bucket.
 * Auth: session-based. Authorization: canWrite on the course.
 */
router.post(
  "/image-upload-url",
  asyncHandler(async (req: Request, res: Response) => {
    const { assignmentId, filename, contentType } = req.body;

    if (!assignmentId || !filename || !contentType) {
      return res.status(400).json({ error: "assignmentId, filename, and contentType are required" });
    }

    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(400).json({ error: "Invalid content type. Allowed: png, jpeg, gif, webp" });
    }

    // Authenticate via session
    let userId: string | undefined;
    let isAdmin: boolean = false;
    try {
      const sessionData = await sessionManagementService.validateSession(req);
      if (!sessionData) {
        throw new AuthenticationError("Valid session is required");
      }
      if (sessionData.isManagedStudent) {
        userId = sessionData.userId;
        isAdmin = false;
      } else {
        const { data: userData } = await supabase
          .from("users")
          .select("id, is_admin")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        if (userData) {
          userId = userData.id;
          isAdmin = userData.is_admin || false;
        }
      }
      if (!userId) {
        throw new AuthenticationError("User not found");
      }
    } catch (error) {
      return res.status(401).json({ error: "Valid session is required" });
    }

    // Look up assignment to get course_id
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("course_id")
      .eq("id", assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Authorization: canWrite on the course
    const permissions = await getCoursePermissions(userId, assignment.course_id, isAdmin);
    if (!permissions.canWrite) {
      return res.status(403).json({ error: "Insufficient permissions to upload images" });
    }

    try {
      const bucketName = await ensureImageBucket(assignmentId);

      // Generate S3 key
      const ext = filename.split(".").pop()?.toLowerCase() || "png";
      const s3Key = `images/${uuidv4()}.${ext}`;

      // Generate presigned PUT URL
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

      return res.json({
        uploadUrl,
        s3Key,
        bucketName,
        expiresIn: 300,
      });
    } catch (error: any) {
      logger.error("[Image Upload] Failed to generate presigned URL:", error);
      return res.status(500).json({ error: "Failed to generate upload URL", details: error.message });
    }
  })
);

/**
 * GET /api/s3buckets/image-url
 * Get a presigned GET URL for reading an image from the assignment's image bucket.
 * Auth: session-based. Authorization: canRead on the assignment's course.
 */
router.get(
  "/image-url",
  asyncHandler(async (req: Request, res: Response) => {
    const { assignmentId, s3Key } = req.query;

    if (!assignmentId || !s3Key) {
      return res.status(400).json({ error: "assignmentId and s3Key are required" });
    }

    // Authenticate via session
    let userId: string | undefined;
    let isAdmin: boolean = false;
    try {
      const sessionData = await sessionManagementService.validateSession(req);
      if (!sessionData) {
        throw new AuthenticationError("Valid session is required");
      }
      if (sessionData.isManagedStudent) {
        userId = sessionData.userId;
        isAdmin = false;
      } else {
        const { data: userData } = await supabase
          .from("users")
          .select("id, is_admin")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        if (userData) {
          userId = userData.id;
          isAdmin = userData.is_admin || false;
        }
      }
      if (!userId) {
        throw new AuthenticationError("User not found");
      }
    } catch (error) {
      return res.status(401).json({ error: "Valid session is required" });
    }

    // Look up assignment to get course_id for authorization
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("course_id")
      .eq("id", assignmentId as string)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Authorization: canRead on the course
    const permissions = await getCoursePermissions(userId, assignment.course_id, isAdmin);
    if (!permissions.canRead) {
      return res.status(403).json({ error: "Insufficient permissions to view images" });
    }

    try {
      const bucketName = `classla-images-${assignmentId}`;

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key as string,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      return res.json({
        url,
        expiresIn: 3600,
      });
    } catch (error: any) {
      logger.error("[Image URL] Failed to generate presigned URL:", error);
      return res.status(500).json({ error: "Failed to generate image URL", details: error.message });
    }
  })
);

/**
 * POST /api/s3buckets
 * Create a new S3 bucket for IDE container workspace
 */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, course_id, assignment_id, region, is_template, bucket_id, block_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    // Generate unique bucket name
    const bucketName = `classla-ide-${user_id.substring(0, 8)}-${Date.now()}`;
    const bucketRegion = region || S3_DEFAULT_REGION;
    
    // Allow specifying a bucket ID for test buckets (development only)
    let bucketId: string;
    if (process.env.NODE_ENV === 'development' && bucket_id && user_id === '00000000-0000-0000-0000-000000000000') {
      bucketId = bucket_id;
    } else {
      bucketId = uuidv4();
    }

    // Insert bucket record with 'creating' status
    const { error: insertError } = await supabase.from("s3_buckets").insert({
      id: bucketId,
      bucket_name: bucketName,
      region: bucketRegion,
      user_id,
      course_id: course_id || null,
      assignment_id: assignment_id || null,
      block_id: block_id || null,
      status: "creating",
      is_template: is_template === true,
    });

    if (insertError) {
      console.error("Error inserting bucket:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    try {
      // Create S3 bucket
      const createCommand = new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration:
          bucketRegion !== "us-east-1"
            ? {
                LocationConstraint: bucketRegion as any,
              }
            : undefined,
      });

      await s3Client.send(createCommand);

      // Enable versioning on non-template buckets (student work buckets)
      if (!is_template) {
        await enableBucketVersioning(bucketName);
      }

      // Update status to 'active'
      const { error: updateError } = await supabase
        .from("s3_buckets")
        .update({ status: "active" })
        .eq("id", bucketId);

      if (updateError) {
        console.error("Error updating bucket status:", updateError);
      }

      // Fetch and return the created bucket
      const { data: bucket, error: fetchError } = await supabase
        .from("s3_buckets")
        .select("*")
        .eq("id", bucketId)
        .single();

      if (fetchError) {
        console.error("Error fetching bucket:", fetchError);
        return res.status(500).json({ error: fetchError.message });
      }

      return res.status(201).json(bucket);
    } catch (s3Error: any) {
      // Update status to 'error'
      await supabase
        .from("s3_buckets")
        .update({ status: "error" })
        .eq("id", bucketId);

      console.error("S3 bucket creation failed:", s3Error);
      return res.status(500).json({
        error: "Failed to create S3 bucket",
        details: s3Error.message,
        bucket_id: bucketId,
      });
    }
  })
);

/**
 * GET /api/s3buckets
 * List all S3 buckets (optionally filtered by user, course, or assignment)
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, course_id, assignment_id, block_id, status, include_deleted, include_snapshots } = req.query;

    let query = supabase.from("s3_buckets").select("*");

    // By default, exclude deleted buckets unless explicitly requested
    if (include_deleted !== "true") {
      query = query.is("deleted_at", null);
    }

    // By default, exclude snapshot buckets unless explicitly requested
    if (include_snapshots !== "true") {
      query = query.or("is_snapshot.is.null,is_snapshot.eq.false");
    }

    if (user_id) {
      query = query.eq("user_id", user_id as string);
    }

    if (course_id) {
      query = query.eq("course_id", course_id as string);
    }

    if (assignment_id) {
      query = query.eq("assignment_id", assignment_id as string);
    }

    if (block_id) {
      query = query.eq("block_id", block_id as string);
    }

    if (status) {
      query = query.eq("status", status as string);
    }

    query = query.order("created_at", { ascending: false });

    const { data: buckets, error } = await query;

    if (error) {
      console.error("Error listing buckets:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ buckets });
  })
);

/**
 * POST /api/s3buckets/admin/enable-versioning
 * One-time migration: enable S3 versioning on all existing non-template, non-snapshot buckets.
 * Admin-only endpoint.
 */
router.post(
  "/admin/enable-versioning",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { isAdmin } = req.user!;
    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Fetch all active, non-template, non-snapshot, non-deleted buckets
    const { data: buckets, error } = await supabase
      .from("s3_buckets")
      .select("id, bucket_name")
      .is("deleted_at", null)
      .eq("is_template", false)
      .or("is_snapshot.is.null,is_snapshot.eq.false")
      .eq("status", "active");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let processed = 0;
    const errors: string[] = [];

    for (const bucket of buckets || []) {
      try {
        await enableBucketVersioning(bucket.bucket_name);
        processed++;
      } catch (err: any) {
        errors.push(`${bucket.bucket_name}: ${err.message}`);
      }
    }

    return res.json({
      message: `Versioning enabled on ${processed}/${(buckets || []).length} buckets`,
      processed,
      total: (buckets || []).length,
      errors: errors.length > 0 ? errors : undefined,
    });
  })
);

/**
 * GET /api/s3buckets/:id
 * Get a specific S3 bucket by ID
 */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { include_deleted } = req.query;

    let query = supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", id);

    // By default, exclude deleted buckets unless explicitly requested
    if (include_deleted !== "true") {
      query = query.is("deleted_at", null);
    }

    const { data: bucket, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Bucket not found" });
      }
      console.error("Error fetching bucket:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(bucket);
  })
);

/**
 * DELETE /api/s3buckets/:id
 * Delete an S3 bucket (marks as deleting, then deletes from S3 and DB)
 */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return res.status(404).json({ error: "Bucket not found" });
      }
      console.error("Error fetching bucket:", fetchError);
      return res.status(500).json({ error: fetchError.message });
    }

    // Snapshot buckets are immutable submission records and must never be deleted
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets cannot be deleted" });
    }

    // Update status to 'deleting'
    await supabase
      .from("s3_buckets")
      .update({ status: "deleting", deleted_at: new Date().toISOString() })
      .eq("id", id);

    try {
      // List all objects in bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket.bucket_name,
      });
      const listResponse = await s3Client.send(listCommand);

      // Delete all objects
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        for (const object of listResponse.Contents) {
          if (object.Key) {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: bucket.bucket_name,
                Key: object.Key,
              })
            );
          }
        }
      }

      // Delete the bucket
      const deleteCommand = new DeleteBucketCommand({
        Bucket: bucket.bucket_name,
      });
      await s3Client.send(deleteCommand);

      // Update status to 'deleted'
      await supabase
        .from("s3_buckets")
        .update({ status: "deleted" })
        .eq("id", id);

      return res.json({ message: "Bucket deleted successfully", id });
    } catch (s3Error: any) {
      // Update status to 'error'
      await supabase
        .from("s3_buckets")
        .update({ status: "error" })
        .eq("id", id);

      console.error("S3 bucket deletion failed:", s3Error);
      return res.status(500).json({
        error: "Failed to delete S3 bucket",
        details: s3Error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:id/clone
 * Clone an S3 bucket (copy all objects from source to new bucket)
 * Only allows cloning of template buckets, and only by enrolled users
 */
router.post(
  "/:id/clone",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { id: sourceBucketId } = req.params;
    const { id: userId } = req.user!;
    const { course_id, assignment_id, region, block_id } = req.body;

    // Fetch source bucket (exclude deleted buckets)
    const { data: sourceBucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", sourceBucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !sourceBucket) {
      return res.status(404).json({ error: "Source bucket not found" });
    }

    // Check if source bucket is a template
    if (!sourceBucket.is_template) {
      return res.status(403).json({
        error: "Only template buckets can be cloned",
      });
    }

    // Check if user owns the bucket OR is enrolled in the course
    if (sourceBucket.user_id !== userId) {
      // If bucket has a course_id, check enrollment
      if (sourceBucket.course_id) {
        const isEnrolled = await isEnrolledInCourse(userId, sourceBucket.course_id);
        if (!isEnrolled) {
          return res.status(403).json({
            error: "You must be enrolled in the course to clone this template",
          });
        }
      } else {
        // No course_id, only owner can clone
        return res.status(403).json({
          error: "You do not have permission to clone this bucket",
        });
      }
    }

    // Generate unique bucket name for clone
    const bucketName = `classla-ide-${userId.substring(0, 8)}-${Date.now()}`;
    const bucketRegion = region || sourceBucket.region || S3_DEFAULT_REGION;
    const bucketId = uuidv4();

    // Insert bucket record with 'creating' status (cloned buckets are never templates)
    const { error: insertError } = await supabase.from("s3_buckets").insert({
      id: bucketId,
      bucket_name: bucketName,
      region: bucketRegion,
      user_id: userId,
      course_id: course_id || sourceBucket.course_id || null,
      assignment_id: assignment_id || sourceBucket.assignment_id || null,
      block_id: block_id || null,
      status: "creating",
      is_template: false, // Cloned buckets are never templates
    });

    if (insertError) {
      console.error("Error inserting cloned bucket:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    try {
      // Create new S3 bucket
      const createCommand = new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration:
          bucketRegion !== "us-east-1"
            ? {
                LocationConstraint: bucketRegion as any,
              }
            : undefined,
      });

      await s3Client.send(createCommand);

      // Enable versioning on cloned buckets (student work buckets)
      await enableBucketVersioning(bucketName);

      // List all objects in source bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: sourceBucket.bucket_name,
      });
      const listResponse = await s3Client.send(listCommand);

      // Copy all objects from source to destination
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        for (const object of listResponse.Contents) {
          if (object.Key) {
            try {
              const copyCommand = new CopyObjectCommand({
                CopySource: `${sourceBucket.bucket_name}/${object.Key}`,
                Bucket: bucketName,
                Key: object.Key,
              });
              await s3Client.send(copyCommand);
            } catch (copyError: any) {
              console.error(`Failed to copy object ${object.Key}:`, copyError);
              // Continue with other objects even if one fails
            }
          }
        }
      }

      // Update status to 'active'
      const { error: updateError } = await supabase
        .from("s3_buckets")
        .update({ status: "active" })
        .eq("id", bucketId);

      if (updateError) {
        console.error("Error updating cloned bucket status:", updateError);
      }

      // Fetch and return the cloned bucket
      const { data: bucket, error: fetchError } = await supabase
        .from("s3_buckets")
        .select("*")
        .eq("id", bucketId)
        .single();

      if (fetchError) {
        console.error("Error fetching cloned bucket:", fetchError);
        return res.status(500).json({ error: fetchError.message });
      }

      return res.status(201).json(bucket);
    } catch (s3Error: any) {
      // Update status to 'error'
      await supabase
        .from("s3_buckets")
        .update({ status: "error" })
        .eq("id", bucketId);

      console.error("S3 bucket clone failed:", s3Error);
      return res.status(500).json({
        error: "Failed to clone S3 bucket",
        details: s3Error.message,
        bucket_id: bucketId,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:id/soft-delete
 * Soft delete an S3 bucket (sets deleted_at timestamp without deleting from S3)
 * Used for model solutions and other buckets that should be removed from use but not fully deleted
 */
router.post(
  "/:id/soft-delete",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, isAdmin } = req.user!;

    // Fetch bucket
    // Fetch bucket (include deleted buckets for soft delete endpoint)
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Check if user has permission to access this bucket
    // Soft delete requires write permission (owner, admin, or course instructor/TA with write access)
    const hasAccess = await canAccessBucket(userId, bucket, isAdmin || false, 'write');
    if (!hasAccess) {
      return res.status(403).json({
        error: "You do not have permission to delete this bucket",
      });
    }

    // Snapshot buckets are immutable submission records and must never be deleted
    if (bucket.is_snapshot) {
      return res.status(403).json({
        error: "Snapshot buckets cannot be deleted",
      });
    }

    // Check if already deleted
    if (bucket.deleted_at) {
      return res.status(400).json({
        error: "Bucket is already deleted",
      });
    }

    // Soft delete: set deleted_at timestamp
    const { data: updatedBucket, error: updateError } = await supabase
      .from("s3_buckets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error soft deleting bucket:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    return res.json({
      message: "Bucket soft deleted successfully",
      bucket: updatedBucket,
    });
  })
);

/**
 * GET /api/s3buckets/:bucketId/source-bucket
 * Resolve the live (non-snapshot) bucket for a snapshot bucket.
 * Used by the grading view to fetch version history from the student's live bucket.
 */
router.get(
  "/:bucketId/source-bucket",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;

    // Authenticate
    let userId: string | undefined;
    let isAdmin: boolean = false;
    try {
      const sessionData = await sessionManagementService.validateSession(req);
      if (!sessionData) {
        throw new AuthenticationError("Valid session is required");
      }
      if (sessionData.isManagedStudent) {
        userId = sessionData.userId;
        isAdmin = false;
      } else {
        const { data: userData } = await supabase
          .from("users")
          .select("id, is_admin")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        if (userData) {
          userId = userData.id;
          isAdmin = userData.is_admin || false;
        }
      }
      if (!userId) {
        throw new AuthenticationError("User not found");
      }
    } catch (error) {
      return res.status(401).json({ error: "Valid session is required" });
    }

    // Fetch snapshot bucket
    const { data: snapshotBucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !snapshotBucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    if (!snapshotBucket.is_snapshot) {
      return res.status(400).json({ error: "Bucket is not a snapshot" });
    }

    // Auth check
    const hasAccess = await canAccessBucket(userId, snapshotBucket, isAdmin, 'read');
    if (!hasAccess) {
      return res.status(403).json({ error: "You do not have permission to access this bucket" });
    }

    // Find the live bucket matching the same user, assignment, and block
    const { data: liveBucket, error: liveError } = await supabase
      .from("s3_buckets")
      .select("id")
      .eq("user_id", snapshotBucket.user_id)
      .eq("assignment_id", snapshotBucket.assignment_id)
      .eq("block_id", snapshotBucket.block_id)
      .eq("is_template", false)
      .or("is_snapshot.is.null,is_snapshot.eq.false")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (liveError || !liveBucket) {
      return res.status(404).json({ error: "Live bucket not found" });
    }

    return res.json({ liveBucketId: liveBucket.id });
  })
);

/**
 * GET /api/s3buckets/:bucketId/versions/*
 * List all S3 object versions for a specific file in a bucket.
 * Used by the grading view history slider.
 */
router.get(
  "/:bucketId/versions/*",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const filePath = decodeURIComponent(req.params[0] || "");

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Authenticate
    let userId: string | undefined;
    let isAdmin: boolean = false;
    try {
      const sessionData = await sessionManagementService.validateSession(req);
      if (!sessionData) {
        throw new AuthenticationError("Valid session is required");
      }
      if (sessionData.isManagedStudent) {
        userId = sessionData.userId;
        isAdmin = false;
      } else {
        const { data: userData } = await supabase
          .from("users")
          .select("id, is_admin")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        if (userData) {
          userId = userData.id;
          isAdmin = userData.is_admin || false;
        }
      }
      if (!userId) {
        throw new AuthenticationError("User not found");
      }
    } catch (error) {
      return res.status(401).json({ error: "Valid session is required" });
    }

    // Fetch bucket
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Auth check
    const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'read');
    if (!hasAccess) {
      return res.status(403).json({ error: "You do not have permission to access this bucket" });
    }

    try {
      const response = await s3Client.send(new ListObjectVersionsCommand({
        Bucket: bucket.bucket_name,
        Prefix: filePath,
        MaxKeys: 500,
      }));

      // Filter to exact key match (Prefix is just a prefix, not exact)
      const versions = (response.Versions || [])
        .filter((v) => v.Key === filePath)
        .sort((a, b) => {
          const aTime = a.LastModified?.getTime() || 0;
          const bTime = b.LastModified?.getTime() || 0;
          return bTime - aTime; // newest first
        })
        .map((v) => ({
          versionId: v.VersionId,
          lastModified: v.LastModified?.toISOString(),
          size: v.Size,
          isLatest: v.IsLatest,
        }));

      return res.json({ versions, filePath });
    } catch (s3Error: any) {
      logger.error("Failed to list object versions:", s3Error);
      return res.status(500).json({
        error: "Failed to list file versions",
        details: s3Error.message,
      });
    }
  })
);

/**
 * GET /api/s3buckets/:bucketId/version/:versionId/*
 * Get a specific version's content for a file in a bucket.
 * Used by the grading view history slider.
 */
router.get(
  "/:bucketId/version/:versionId/*",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId, versionId } = req.params;
    const filePath = decodeURIComponent(req.params[0] || "");

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Authenticate
    let userId: string | undefined;
    let isAdmin: boolean = false;
    try {
      const sessionData = await sessionManagementService.validateSession(req);
      if (!sessionData) {
        throw new AuthenticationError("Valid session is required");
      }
      if (sessionData.isManagedStudent) {
        userId = sessionData.userId;
        isAdmin = false;
      } else {
        const { data: userData } = await supabase
          .from("users")
          .select("id, is_admin")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        if (userData) {
          userId = userData.id;
          isAdmin = userData.is_admin || false;
        }
      }
      if (!userId) {
        throw new AuthenticationError("User not found");
      }
    } catch (error) {
      return res.status(401).json({ error: "Valid session is required" });
    }

    // Fetch bucket
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Auth check
    const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'read');
    if (!hasAccess) {
      return res.status(403).json({ error: "You do not have permission to access this bucket" });
    }

    try {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
        VersionId: versionId,
      }));

      let content = "";
      if (response.Body) {
        const stream = response.Body as Readable;
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => resolve());
          stream.on("error", reject);
        });

        const buffer = Buffer.concat(chunks);

        if (isBinaryFile(filePath)) {
          content = buffer.toString('base64');
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.json({ content, path: filePath, versionId, encoding: 'base64' });
        }

        content = buffer.toString("utf-8");
      }

      // Versions are immutable, cache aggressively
      res.setHeader("Cache-Control", "public, max-age=3600");

      return res.json({ content, path: filePath, versionId });
    } catch (s3Error: any) {
      if (s3Error.name === "NoSuchKey" || s3Error.name === "NoSuchVersion" || s3Error.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: "Version not found", path: filePath, versionId });
      }
      logger.error("Failed to get version content:", s3Error);
      return res.status(500).json({
        error: "Failed to get version content",
        details: s3Error.message,
      });
    }
  })
);

/**
 * GET /api/s3buckets/:bucketId/files/list-for-container
 * List files in bucket for container (container-only endpoint with service token auth)
 * NOTE: This must be defined BEFORE the general /:bucketId/files route
 */
router.get(
  "/:bucketId/files/list-for-container",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const serviceToken = req.headers["x-container-service-token"] as string;

    // Verify service token
    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    if (!expectedToken || serviceToken !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing service token" });
    }

    // Fetch bucket (no user ownership check for container sync)
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    try {
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;
      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

      // List all objects in bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket.bucket_name,
      });
      const listResponse = await bucketS3Client.send(listCommand);

      // Extract file paths (filter out .yjs folder and .partial files)
      const filePaths: string[] = [];
      if (listResponse.Contents) {
        for (const object of listResponse.Contents) {
          if (object.Key && 
              !object.Key.startsWith(".yjs/") && 
              object.Key !== ".yjs" &&
              !object.Key.endsWith(".partial")) {
            filePaths.push(object.Key);
          }
        }
      }

      return res.json({ files: filePaths });
    } catch (s3Error: any) {
      logger.error("Failed to list files for container:", s3Error);
      return res.status(500).json({
        error: "Failed to list files",
        details: s3Error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files/flush-for-container
 * Force-save all OT documents for this bucket to S3 and return the file list.
 * Called by the container before running code to ensure S3 is up-to-date.
 */
router.post(
  "/:bucketId/files/flush-for-container",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const serviceToken = req.headers["x-container-service-token"] as string;

    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    if (!expectedToken || serviceToken !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing service token" });
    }

    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    try {
      // Step 1: Force-save all OT documents for this bucket to S3
      let savedPaths: string[] = [];
      try {
        const { forceSaveDocumentsForBucket } = await import("../services/otProviderService");
        savedPaths = await forceSaveDocumentsForBucket(bucketId);
      } catch (otError: any) {
        logger.warn(`[Flush] Failed to force-save OT documents:`, otError);
      }

      // Step 2: List all objects in bucket (now with up-to-date content)
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;
      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

      const listCommand = new ListObjectsV2Command({
        Bucket: bucket.bucket_name,
      });
      const listResponse = await bucketS3Client.send(listCommand);

      const filePaths: string[] = [];
      if (listResponse.Contents) {
        for (const object of listResponse.Contents) {
          if (object.Key &&
              !object.Key.startsWith(".yjs/") &&
              object.Key !== ".yjs" &&
              !object.Key.endsWith(".partial")) {
            filePaths.push(object.Key);
          }
        }
      }

      return res.json({ files: filePaths, otSaved: savedPaths.length });
    } catch (error: any) {
      logger.error("Failed to flush for container:", error);
      return res.status(500).json({
        error: "Failed to flush",
        details: error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files/bulk-content
 * Return all file contents for a bucket. Prefers OT in-memory content, falls back to S3.
 * Used by the container during startup to get initial file state.
 */
router.post(
  "/:bucketId/files/bulk-content",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const serviceToken = req.headers["x-container-service-token"] as string;

    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    if (!expectedToken || serviceToken !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing service token" });
    }

    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    try {
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;
      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

      // List all objects in bucket
      const listCommand = new ListObjectsV2Command({ Bucket: bucket.bucket_name });
      const listResponse = await bucketS3Client.send(listCommand);

      const BINARY_EXTENSIONS = new Set([
        'class', 'jar', 'war', 'o', 'obj', 'exe', 'dll', 'so', 'dylib',
        'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'pdf',
        'zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'wasm', 'bin', 'dat',
        'pyc', 'pyo', 'ttf', 'otf', 'woff', 'woff2',
      ]);

      const { getDocumentContent } = await import("../services/otProviderService");
      const files: { path: string; content: string; encoding: string }[] = [];

      if (listResponse.Contents) {
        for (const object of listResponse.Contents) {
          if (!object.Key ||
              object.Key.startsWith(".yjs/") ||
              object.Key === ".yjs" ||
              object.Key.endsWith(".partial")) {
            continue;
          }

          const ext = object.Key.split('.').pop()?.toLowerCase() || '';
          const isBinary = BINARY_EXTENSIONS.has(ext);

          if (isBinary) {
            // Read binary from S3, base64 encode
            try {
              const getCmd = new GetObjectCommand({ Bucket: bucket.bucket_name, Key: object.Key });
              const getResp = await bucketS3Client.send(getCmd);
              if (getResp.Body) {
                const chunks: Buffer[] = [];
                for await (const chunk of getResp.Body as any) {
                  chunks.push(Buffer.from(chunk));
                }
                files.push({
                  path: object.Key,
                  content: Buffer.concat(chunks).toString('base64'),
                  encoding: 'base64',
                });
              }
            } catch (e: any) {
              logger.warn(`[BulkContent] Failed to read binary ${object.Key}:`, e.message);
            }
          } else {
            // Text file: prefer OT in-memory content, fall back to S3
            const otContent = getDocumentContent(bucketId, object.Key);
            if (otContent !== null) {
              files.push({ path: object.Key, content: otContent, encoding: 'utf-8' });
            } else {
              try {
                const getCmd = new GetObjectCommand({ Bucket: bucket.bucket_name, Key: object.Key });
                const getResp = await bucketS3Client.send(getCmd);
                if (getResp.Body) {
                  const chunks: Buffer[] = [];
                  for await (const chunk of getResp.Body as any) {
                    chunks.push(Buffer.from(chunk));
                  }
                  files.push({
                    path: object.Key,
                    content: Buffer.concat(chunks).toString('utf-8'),
                    encoding: 'utf-8',
                  });
                }
              } catch (e: any) {
                logger.warn(`[BulkContent] Failed to read ${object.Key}:`, e.message);
              }
            }
          }
        }
      }

      return res.json({ files });
    } catch (error: any) {
      logger.error("Failed to get bulk content:", error);
      return res.status(500).json({
        error: "Failed to get bulk content",
        details: error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files/ot-content
 * Return only OT in-memory document contents for a bucket.
 * Lightweight endpoint used by container flush to catch in-transit operations.
 * Returns only documents currently loaded in OT (no S3 fallback).
 */
router.post(
  "/:bucketId/files/ot-content",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const serviceToken = req.headers["x-container-service-token"] as string;

    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    if (!expectedToken || serviceToken !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing service token" });
    }

    const { getDocumentContentsForBucket } = await import("../services/otProviderService");
    const files = getDocumentContentsForBucket(bucketId);

    return res.json({ files });
  })
);

/**
 * GET /api/s3buckets/:bucketId/files
 * List all files in bucket, return file tree structure
 */
router.get(
  "/:bucketId/files",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket) {
      // For non-test buckets, require authentication
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        // Handle both WorkOS users and managed students
        if (sessionData.isManagedStudent) {
          // For managed students, use userId directly from session
          // Managed students are never admins
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          // For WorkOS users, look up by workos_user_id (include is_admin)
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      // Test bucket - use test user ID
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket and verify ownership
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Check if user has permission to access this bucket
    // List files requires read permission
    if (!isTestBucket) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'read');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to access this bucket",
        });
      }
    }

    try {
      // List all objects in bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket.bucket_name,
      });
      const listResponse = await s3Client.send(listCommand);

      // Build file tree structure
      interface FileNode {
        name: string;
        path: string;
        type: "file" | "folder";
        children?: FileNode[];
      }

      const fileTree: FileNode[] = [];
      const pathMap = new Map<string, FileNode>();

      if (listResponse.Contents) {
        for (const object of listResponse.Contents) {
          if (!object.Key) continue;

          // Filter out .yjs folder and its contents, and .partial files
          if (object.Key.startsWith('.yjs/') || 
              object.Key === '.yjs' || 
              object.Key.endsWith('.partial')) {
            continue;
          }

          const parts = object.Key.split("/");
          let currentPath = "";
          let parentNode: FileNode | null = null;

          // Skip if any part is .yjs or if file ends with .partial
          if (parts.some(part => part === '.yjs') || object.Key.endsWith('.partial')) {
            continue;
          }

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!pathMap.has(currentPath)) {
              const node: FileNode = {
                name: part,
                path: currentPath,
                type: isLast ? "file" : "folder",
                children: isLast ? undefined : [],
              };

              pathMap.set(currentPath, node);

              if (parentNode) {
                if (!parentNode.children) {
                  parentNode.children = [];
                }
                parentNode.children.push(node);
              } else {
                fileTree.push(node);
              }
            }

            parentNode = pathMap.get(currentPath)!;
          }
        }
      }

      return res.json({ files: fileTree });
    } catch (s3Error: any) {
      console.error("S3 list files failed:", s3Error);
      return res.status(500).json({
        error: "Failed to list files",
        details: s3Error.message,
      });
    }
  })
);

/**
 * GET /api/s3buckets/:bucketId/files/*
 * Get file content from S3 (proxied through backend)
 */
router.get(
  "/:bucketId/files/*",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    // Decode the file path (Express may have already decoded it, but be safe)
    const filePath = decodeURIComponent(req.params[0] || ""); // Everything after /files/

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Allow container service token auth (for container file sync)
    const serviceToken = req.headers["x-container-service-token"] as string;
    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    const isContainerRequest = !!(expectedToken && serviceToken === expectedToken);

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket && !isContainerRequest) {
      // For non-test/non-container requests, require authentication
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        if (sessionData.isManagedStudent) {
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket and verify ownership
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Check if user has permission to access this bucket
    // Reading file content requires read permission (skip for container requests)
    if (!isTestBucket && !isContainerRequest) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'read');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to access this bucket",
        });
      }
    }

    try {
      // For container requests on text files: prefer OT in-memory content (source of truth)
      // This avoids stale S3 content when OT save debounce hasn't fired yet
      if (isContainerRequest && !isBinaryFile(filePath)) {
        try {
          const { getDocumentContent } = await import("../services/otProviderService");
          const otContent = getDocumentContent(bucketId, filePath);
          if (otContent !== null) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return res.json({ content: otContent, path: filePath, source: 'ot' });
          }
        } catch (otError: any) {
          // Fall through to S3 read
          logger.debug(`[File Read] OT lookup failed for ${filePath}, falling back to S3`);
        }
      }

      // Create S3 client with bucket's specific region
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;

      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

      // Get file content from S3
      const getCommand = new GetObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
      });

      const response = await bucketS3Client.send(getCommand);

      // Convert stream to buffer
      let content = "";
      if (response.Body) {
        // AWS SDK v3 returns a Readable stream
        const stream = response.Body as Readable;
        const chunks: Buffer[] = [];

        // Read the stream
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => resolve());
          stream.on("error", reject);
        });

        const buffer = Buffer.concat(chunks);

        // Return binary files as base64
        if (isBinaryFile(filePath)) {
          content = buffer.toString('base64');

          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");

          return res.json({ content, path: filePath, encoding: 'base64' });
        }

        content = buffer.toString("utf-8");
      }

      // Set cache-control headers to prevent caching
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      return res.json({ content, path: filePath });
    } catch (s3Error: any) {
      if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({
          error: "File not found",
          path: filePath,
        });
      }
      console.error("S3 file read failed:", s3Error);
      return res.status(500).json({
        error: "Failed to read file",
        details: s3Error.message,
      });
    }
  })
);

/**
 * PUT /api/s3buckets/:bucketId/files/*
 * Write file content to S3 (proxy from frontend)
 */
router.put(
  "/:bucketId/files/*",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    // Decode the file path (Express may have already decoded it, but be safe)
    const filePath = decodeURIComponent(req.params[0] || ""); // Everything after /files/
    const { content } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    if (content === undefined) {
      return res.status(400).json({ error: "File content is required" });
    }

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket) {
      // For non-test buckets, require authentication
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        if (sessionData.isManagedStudent) {
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket and verify ownership
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Snapshot buckets are read-only
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets are read-only" });
    }

    // Check if user has permission to modify this bucket
    // Writing file content requires write permission
    if (!isTestBucket) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'write');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to modify this bucket",
        });
      }
    }

    try {
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;
      // Create S3 client with bucket's specific region
      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
      
      // Convert content to Buffer if it's a string
      const contentBuffer =
        typeof content === "string" ? Buffer.from(content, "utf-8") : content;

      // Determine content type based on file extension
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

      // Check for conflicts by reading current S3 content
      let currentContent = "";
      let currentEtag = "";
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: bucket.bucket_name,
          Key: filePath,
        });
        const headResult = await bucketS3Client.send(headCommand);
        currentEtag = headResult.ETag || "";
        
        // If file exists, read it for conflict resolution
        if (headResult.ContentLength && headResult.ContentLength > 0) {
          const getCommand = new GetObjectCommand({
            Bucket: bucket.bucket_name,
            Key: filePath,
          });
          const getResult = await bucketS3Client.send(getCommand);
          if (getResult.Body) {
            const stream = getResult.Body as Readable;
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => resolve());
              stream.on("error", reject);
            });
            currentContent = Buffer.concat(chunks).toString("utf-8");
          }
        }
      } catch (error: any) {
        // File doesn't exist yet, no conflict
        if (error.name !== "NotFound" && error.$metadata?.httpStatusCode !== 404) {
          console.error("Error checking for conflicts:", error);
        }
      }

      // Resolve conflicts if content differs
      let finalContent = content;
      let hasConflict = false;
      let conflictMessage: string | undefined;
      
      if (currentContent && currentContent !== content) {
        // Attempt merge (using current S3 content as base, new content as local, current as remote)
        // Actually, for PUT requests, we'll use last-write-wins (the new content wins)
        // But we can log the conflict
        hasConflict = true;
        conflictMessage = "File was modified, overwriting with new content";
      }

      // Write the final content to S3
      const putCommand = new PutObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
        Body: contentBuffer,
        ContentType: contentType,
        ContentLength: contentBuffer.length,
      });

      const putResult = await bucketS3Client.send(putCommand);
      const etag = putResult.ETag;

      // Broadcast file change to WebSocket clients
      try {
        const { broadcastFileChange } = require("../services/fileSyncService");
        broadcastFileChange({
          bucketId,
          filePath,
          content: finalContent,
          etag: etag || undefined,
          source: "frontend",
          userId,
          timestamp: Date.now(),
        });
      } catch (error) {
        // Log but don't fail the request if broadcast fails
        console.error("Failed to broadcast file change:", error);
      }

      return res.json({ message: "File saved successfully", path: filePath, etag });
    } catch (s3Error: any) {
      console.error("S3 file write failed:", s3Error);
      return res.status(500).json({
        error: "Failed to save file",
        details: s3Error.message || s3Error.Code || "Unknown S3 error",
      });
    }
  })
);

/**
 * DELETE /api/s3buckets/:bucketId/files/*
 * Delete file from S3
 */
router.delete(
  "/:bucketId/files/*",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const filePath = req.params[0]; // Everything after /files/

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket) {
      // For non-test buckets, require authentication
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        // Handle both WorkOS users and managed students
        if (sessionData.isManagedStudent) {
          // For managed students, use userId directly from session
          // Managed students are never admins
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          // For WorkOS users, look up by workos_user_id (include is_admin)
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      // Test bucket - use test user ID
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket and verify ownership
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Snapshot buckets are read-only
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets are read-only" });
    }

    // Check if user has permission to modify this bucket
    // Deleting files requires write permission
    if (!isTestBucket) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'write');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to modify this bucket",
        });
      }
    }

    try {
      const bucketRegion = bucket.region || S3_DEFAULT_REGION;
      const bucketS3Client = new S3Client({
        region: bucketRegion,
        credentials:
          process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

      // Delete file from S3
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
      });

      await bucketS3Client.send(deleteCommand);

      // Clean up OT document
      try {
        const { cleanupDocument: cleanupOTDocument, getDocumentId: getOTDocumentId } = await import("../services/otProviderService");
        cleanupOTDocument(getOTDocumentId(bucketId, filePath), true);
        logger.info(`[File Delete] Cleaned up OT document for: ${filePath}`);
      } catch (otError: any) {
        logger.warn(`[File Delete] Failed to clean up OT document:`, otError);
      }

      // Broadcast file-tree-change so other clients update their tree
      try {
        const { getIO } = await import("../services/websocket");
        const io = getIO();
        io.of("/ot").to(`bucket:${bucketId}`).emit("file-tree-change", {
          bucketId,
          filePath,
          action: "delete",
        });
      } catch (error: any) {
        logger.warn(`[File Delete] Failed to broadcast file-tree-change:`, error);
      }

      return res.json({ message: "File deleted successfully", path: filePath });
    } catch (s3Error: any) {
      logger.error("S3 file delete failed:", s3Error);
      return res.status(500).json({
        error: "Failed to delete file",
        details: s3Error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files/sync-from-container
 * Sync file from container to S3 (container-only endpoint with service token auth)
 */
router.post(
  "/:bucketId/files/sync-from-container",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const { filePath, content, encoding } = req.body;
    const serviceToken = req.headers["x-container-service-token"] as string;

    // Verify service token
    const expectedToken = process.env.CONTAINER_SERVICE_TOKEN;
    if (!expectedToken || serviceToken !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing service token" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    if (content === undefined) {
      return res.status(400).json({ error: "File content is required" });
    }

    // Fetch bucket (no user ownership check for container sync)
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Snapshot buckets are read-only
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets are read-only" });
    }

    try {
      const { getBucketMode, applyContainerContent } = await import("../services/otProviderService");
      const { getIO } = await import("../services/websocket");
      const mode = getBucketMode(bucketId);
      const isBinary = encoding === 'base64';

      // Mode B text files: skip S3 write (OT + background timer handles persistence)
      // Mode B binary files: ALWAYS write to S3 (no OT path for binaries)
      // Mode A: always write to S3
      const skipS3 = mode === 'B' && !isBinary;
      let isNewFile = false;

      if (!skipS3) {
        const bucketRegion = bucket.region || S3_DEFAULT_REGION;
        const bucketS3Client = new S3Client({
          region: bucketRegion,
          credentials:
            process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
              ? {
                  accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
                  secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
                }
              : undefined,
        });

        const contentBuffer = encoding === 'base64'
          ? Buffer.from(content, 'base64')
          : (typeof content === "string" ? Buffer.from(content, "utf-8") : content);

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
          class: "application/java-vm",
          jar: "application/java-archive",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          pdf: "application/pdf",
          zip: "application/zip",
        };
        const contentType = contentTypeMap[extension || ""] || "text/plain";

        // Check if file already exists in S3 (to detect new files for tree updates)
        try {
          await bucketS3Client.send(new HeadObjectCommand({
            Bucket: bucket.bucket_name,
            Key: filePath,
          }));
        } catch (headError: any) {
          if (headError.name === "NotFound" || headError.$metadata?.httpStatusCode === 404) {
            isNewFile = true;
          }
        }

        const putCommand = new PutObjectCommand({
          Bucket: bucket.bucket_name,
          Key: filePath,
          Body: contentBuffer,
          ContentType: contentType,
          ContentLength: contentBuffer.length,
        });

        await bucketS3Client.send(putCommand);
      }

      // Always update OT for text files (binary files can't be collaboratively edited)
      if (encoding !== 'base64') {
        try {
          const newContent = typeof content === "string" ? content : content.toString("utf-8");
          await applyContainerContent(bucketId, filePath, newContent, getIO());
        } catch (error: any) {
          logger.error(`[Container Sync] Failed to update OT document from container sync:`, error);
        }
      }

      // In Mode B, detect new files by checking if OT doc existed before
      // (we can't check S3 since we skipped the write)
      if (mode === 'B' && !isNewFile) {
        // For Mode B, we rely on the OT server to detect new files
        // The file-tree-change event will be broadcast if the OT doc was newly created
        // But we need to detect truly new files — check if a document existed
        const { getDocumentContent } = await import("../services/otProviderService");
        const existingContent = getDocumentContent(bucketId, filePath);
        if (existingContent === null && encoding !== 'base64') {
          isNewFile = true;
        }
      }

      // Notify frontend clients about new files so file tree updates instantly
      if (isNewFile) {
        try {
          const io = getIO();
          const bucketRoom = `bucket:${bucketId}`;
          io.of("/ot").to(bucketRoom).emit("file-tree-change", {
            bucketId,
            filePath,
            action: "create",
          });
        } catch (error: any) {
          logger.error(`[Container Sync] Failed to broadcast file-tree-change:`, error);
        }
      }

      return res.json({
        message: "File synced successfully from container",
        path: filePath,
      });
    } catch (s3Error: any) {
      console.error("Error syncing file from container:", s3Error);
      return res.status(500).json({
        error: "Failed to sync file",
        details: s3Error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files/rename
 * Rename (move) a file within an S3 bucket server-side.
 * Uses CopyObject + DeleteObject so binary content never passes through the frontend.
 */
router.post(
  "/:bucketId/files/rename",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res.status(400).json({ error: "oldPath and newPath are required" });
    }

    if (oldPath === newPath) {
      return res.status(400).json({ error: "oldPath and newPath must be different" });
    }

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket) {
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        if (sessionData.isManagedStudent) {
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Snapshot buckets are read-only
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets are read-only" });
    }

    // Check write permission
    if (!isTestBucket) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'write');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to modify this bucket",
        });
      }
    }

    try {
      // Force save OT document to S3 BEFORE the rename
      // This ensures the CopyObject gets the latest editor content,
      // not stale S3 content from before the user's recent edits
      try {
        const { forceSaveDocument: forceSaveOT } = await import("../services/otProviderService");
        await forceSaveOT(bucketId, oldPath);
        logger.info(`[File Rename] Force saved OT document to S3 before rename: ${oldPath}`);
      } catch (saveError: any) {
        // Non-fatal: document may not be open in OT (e.g. binary files)
        logger.debug(`[File Rename] OT force save skipped for ${oldPath}: ${saveError.message}`);
      }

      // Copy object to new key (now with up-to-date content)
      await s3Client.send(new CopyObjectCommand({
        CopySource: `${bucket.bucket_name}/${oldPath}`,
        Bucket: bucket.bucket_name,
        Key: newPath,
      }));

      // Delete old object
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucket.bucket_name,
        Key: oldPath,
      }));

      // Clean up OT document for old path (skipSave=true since we already force-saved above)
      try {
        const { cleanupDocument: cleanupOTDocument, getDocumentId: getOTDocumentId } = await import("../services/otProviderService");
        cleanupOTDocument(getOTDocumentId(bucketId, oldPath), true);
        logger.info(`[File Rename] Cleaned up OT document for old path: ${oldPath}`);
      } catch (otError: any) {
        logger.warn(`[File Rename] Failed to clean up OT document:`, otError);
      }

      // Note: We intentionally do NOT delete build artifacts (.class, .js, .pyc) from S3
      // during rename. The Dockerfile's `rm -f *.class` handles cleanup before compilation,
      // and deleting them here causes confusing UI where files vanish from the tree.

      // Broadcast file-tree-change events
      try {
        const { getIO } = await import("../services/websocket");
        const io = getIO();
        const bucketRoom = `bucket:${bucketId}`;
        io.of("/ot").to(bucketRoom).emit("file-tree-change", {
          bucketId,
          filePath: oldPath,
          action: "delete",
        });
        io.of("/ot").to(bucketRoom).emit("file-tree-change", {
          bucketId,
          filePath: newPath,
          action: "create",
        });
      } catch (error: any) {
        logger.error(`[File Rename] Failed to broadcast file-tree-change:`, error);
      }

      return res.json({ message: "File renamed successfully", oldPath, newPath });
    } catch (s3Error: any) {
      if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: "Source file not found", path: oldPath });
      }
      logger.error("S3 file rename failed:", s3Error);
      return res.status(500).json({
        error: "Failed to rename file",
        details: s3Error.message,
      });
    }
  })
);

/**
 * POST /api/s3buckets/:bucketId/files
 * Create new file in S3
 */
router.post(
  "/:bucketId/files",
  asyncHandler(async (req: Request, res: Response) => {
    const { bucketId } = req.params;
    const { path: filePath, content } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Allow test bucket without authentication in development
    const isTestBucket = process.env.NODE_ENV === 'development' &&
                         bucketId === '00000000-0000-0000-0000-000000000001';

    let userId: string | undefined;
    let isAdmin: boolean = false;
    if (!isTestBucket) {
      // For non-test buckets, require authentication
      try {
        const sessionData = await sessionManagementService.validateSession(req);
        if (!sessionData) {
          throw new AuthenticationError("Valid session is required");
        }

        // Handle both WorkOS users and managed students
        if (sessionData.isManagedStudent) {
          // For managed students, use userId directly from session
          // Managed students are never admins
          userId = sessionData.userId;
          isAdmin = false;
        } else {
          // For WorkOS users, look up by workos_user_id (include is_admin)
          const { data: userData } = await supabase
            .from("users")
            .select("id, is_admin")
            .eq("workos_user_id", sessionData.workosUserId)
            .single();

          if (userData) {
            userId = userData.id;
            isAdmin = userData.is_admin || false;
          }
        }

        if (!userId) {
          throw new AuthenticationError("User not found");
        }
      } catch (error) {
        return res.status(401).json({ error: "Valid session is required" });
      }
    } else {
      // Test bucket - use test user ID
      userId = "00000000-0000-0000-0000-000000000000";
      isAdmin = false;
    }

    // Fetch bucket and verify ownership
    const { data: bucket, error: fetchError } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", bucketId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !bucket) {
      return res.status(404).json({ error: "Bucket not found" });
    }

    // Snapshot buckets are read-only
    if (bucket.is_snapshot) {
      return res.status(403).json({ error: "Snapshot buckets are read-only" });
    }

    // Check if user has permission to modify this bucket
    // Creating files requires write permission
    if (!isTestBucket) {
      const hasAccess = await canAccessBucket(userId, bucket, isAdmin, 'write');
      if (!hasAccess) {
        return res.status(403).json({
          error: "You do not have permission to modify this bucket",
        });
      }
    }

    try {
      // Check if file already exists
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: bucket.bucket_name,
          Key: filePath,
        });
        await s3Client.send(headCommand);
        return res.status(409).json({ error: "File already exists" });
      } catch (error: any) {
        // File doesn't exist, which is what we want
        if (error.name !== "NotFound" && error.$metadata?.httpStatusCode !== 404) {
          throw error;
        }
      }

      // Convert content to Buffer if it's a string
      const contentBuffer =
        typeof content === "string" ? Buffer.from(content || "", "utf-8") : content || Buffer.from("");

      // Determine content type based on file extension
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

      // Create file in S3
      const putCommand = new PutObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
        Body: contentBuffer,
        ContentType: contentType,
      });

      await s3Client.send(putCommand);

      return res.status(201).json({
        message: "File created successfully",
        path: filePath,
      });
    } catch (s3Error: any) {
      console.error("S3 file create failed:", s3Error);
      return res.status(500).json({
        error: "Failed to create file",
        details: s3Error.message,
      });
    }
  })
);

export default router;
