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
} from "@aws-sdk/client-s3";
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
  is_template: boolean;
  region: string;
  status: string;
  deleted_at: string | null;
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
    const { user_id, course_id, assignment_id, block_id, status, include_deleted } = req.query;

    let query = supabase.from("s3_buckets").select("*");

    // By default, exclude deleted buckets unless explicitly requested
    if (include_deleted !== "true") {
      query = query.is("deleted_at", null);
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
      let isNewFile = false;
      try {
        await bucketS3Client.send(new HeadObjectCommand({
          Bucket: bucket.bucket_name,
          Key: filePath,
        }));
      } catch (headError: any) {
        if (headError.name === "NotFound" || headError.$metadata?.httpStatusCode === 404) {
          isNewFile = true;
        }
        // Other errors are non-fatal — proceed with the put regardless
      }

      const putCommand = new PutObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
        Body: contentBuffer,
        ContentType: contentType,
        ContentLength: contentBuffer.length,
      });

      const putResult = await bucketS3Client.send(putCommand);
      const etag = putResult.ETag;

      // Only update OT for text files (binary files can't be collaboratively edited)
      if (encoding !== 'base64') {
        try {
          const { applyContainerContent } = await import("../services/otProviderService");
          const { getIO } = await import("../services/websocket");
          const newContent = typeof content === "string" ? content : content.toString("utf-8");
          await applyContainerContent(bucketId, filePath, newContent, getIO());
        } catch (error: any) {
          logger.error(`[Container Sync] Failed to update OT document from container sync:`, error);
        }
      }

      // Notify frontend clients about new files so file tree updates instantly
      if (isNewFile) {
        try {
          const { getIO } = await import("../services/websocket");
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
