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
    const { user_id, course_id, assignment_id, region, is_template, bucket_id } = req.body;

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
    const { user_id, course_id, assignment_id, status, include_deleted } = req.query;

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
    const { course_id, assignment_id, region } = req.body;

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

    // Check if user has permission to access this bucket
    // Reading file content requires read permission
    if (!isTestBucket) {
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
      
      // Convert stream to string
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

      // Verify the write by reading it back immediately
      try {
        // Small delay to account for S3 eventual consistency
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const verifyCommand = new GetObjectCommand({
          Bucket: bucket.bucket_name,
          Key: filePath,
        });
        const verifyResponse = await bucketS3Client.send(verifyCommand);
        const streamToString = (stream: any): Promise<string> =>
          new Promise((resolve, reject) => {
            const chunks: Uint8Array[] = [];
            stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
            stream.on("error", reject);
            stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          });
        const verifiedContent = await streamToString(verifyResponse.Body);
        
        if (verifiedContent !== content) {
          return res.status(500).json({
            error: "File saved but verification failed",
            details: "Content mismatch after write",
          });
        }
      } catch (verifyError: any) {
        // Verification failed - could be due to eventual consistency
        // Continue anyway as the write succeeded
      }

      return res.json({ message: "File saved successfully", path: filePath });
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

      // CRITICAL: Also delete Y.js document state from S3
      // This prevents the file from being recreated when the page reloads
      // Y.js state is stored in .yjs/ folder
      const { getSnapshotKey, getUpdatesKey } = await import("../services/yjsPersistenceService");
      const snapshotKey = getSnapshotKey(filePath);
      const updatesKey = getUpdatesKey(filePath);

      try {
        // Delete Y.js snapshot
        await bucketS3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket.bucket_name,
            Key: snapshotKey,
          })
        );
        logger.info(`[File Delete] Deleted Y.js snapshot: ${snapshotKey}`);
      } catch (snapshotError: any) {
        // Ignore if snapshot doesn't exist
        if (snapshotError.name !== "NoSuchKey") {
          logger.warn(`[File Delete] Failed to delete Y.js snapshot ${snapshotKey}:`, snapshotError);
        }
      }

      try {
        // Delete Y.js updates
        await bucketS3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket.bucket_name,
            Key: updatesKey,
          })
        );
        logger.info(`[File Delete] Deleted Y.js updates: ${updatesKey}`);
      } catch (updatesError: any) {
        // Ignore if updates don't exist
        if (updatesError.name !== "NoSuchKey") {
          logger.warn(`[File Delete] Failed to delete Y.js updates ${updatesKey}:`, updatesError);
        }
      }

      // Also clean up the in-memory Y.js document if it exists
      // CRITICAL: Pass skipSave=true to prevent saving the document state (which would recreate the file)
      try {
        const yjsProviderService = await import("../services/yjsProviderService");
        const docId = yjsProviderService.getDocumentId(bucketId, filePath);
        yjsProviderService.cleanupDocument(docId, true); // skipSave=true to prevent recreating the file
        logger.info(`[File Delete] Cleaned up in-memory Y.js document: ${docId}`);
      } catch (yjsError: any) {
        logger.warn(`[File Delete] Failed to clean up Y.js document:`, yjsError);
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
    const { filePath, content } = req.body;
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

      const contentBuffer =
        typeof content === "string" ? Buffer.from(content, "utf-8") : content;

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

      const putCommand = new PutObjectCommand({
        Bucket: bucket.bucket_name,
        Key: filePath,
        Body: contentBuffer,
        ContentType: contentType,
        ContentLength: contentBuffer.length,
      });

      const putResult = await bucketS3Client.send(putCommand);
      const etag = putResult.ETag;

      // Update Y.js document so web clients see the change immediately
      // This ensures bidirectional sync: container → Y.js → web clients
      try {
        const { getYjsDocument, getOrCreateDocument } = await import("../services/yjsProviderService");
        const { getIO } = await import("../services/websocket");
        const Y = await import("yjs");
        
        const doc = getYjsDocument(bucketId, filePath);
        let isNewFile = false;
        
        if (doc) {
          const ytext = doc.getText("content");
          const currentContent = ytext.toString();
          const newContent = typeof content === "string" ? content : content.toString("utf-8");
          
          // Check if this is a new file (Y.js document is empty)
          isNewFile = currentContent.length === 0 && newContent.length > 0;
          
          // Only update if content is different
          if (currentContent !== newContent) {
            // Capture update by temporarily listening to update events
            let capturedUpdate: Uint8Array | null = null;
            const updateHandler = (update: Uint8Array, origin: any) => {
              if (origin !== "container-sync") {
                capturedUpdate = update;
              }
            };
            
            doc.on("update", updateHandler);
            
            // Update Y.js document with "container-sync" origin (this will trigger the update handler)
            doc.transact(() => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, newContent);
            }, "container-sync");
            
            // Remove the update handler
            doc.off("update", updateHandler);
            
            // Broadcast to all connected clients via WebSocket if we captured an update
            if (capturedUpdate) {
              const io = getIO();
              const yjsNamespace = io.of("/yjs");
              const docId = `${bucketId}:${filePath}`;
              const updateBase64 = Buffer.from(capturedUpdate).toString("base64");
              
              // Broadcast to all clients subscribed to this document
              yjsNamespace.to(docId).emit("yjs-update", {
                bucketId,
                filePath,
                update: updateBase64,
              });
              
              logger.info(`[Container Sync] Updated and broadcasted Y.js document from container: ${filePath}`, {
                contentLength: newContent.length,
                previousLength: currentContent.length
              });
            } else {
              // Fallback: send full document state if update wasn't captured
              const state = Y.encodeStateAsUpdate(doc);
              const stateBase64 = Buffer.from(state).toString("base64");
              
              const io = getIO();
              const yjsNamespace = io.of("/yjs");
              const docId = `${bucketId}:${filePath}`;
              
              yjsNamespace.to(docId).emit("document-state", {
                bucketId,
                filePath,
                state: stateBase64,
              });
              
              logger.info(`[Container Sync] Updated Y.js document (sent full state) from container: ${filePath}`);
            }
            
            // The Y.js document's update handler will automatically save to S3
          } else {
            logger.debug(`[Container Sync] Y.js document already in sync: ${filePath}`);
          }
        } else {
          // Document doesn't exist yet - create it now
          logger.info(`[Container Sync] Y.js document not found for ${filePath}, creating it.`);
          const newDoc = await getOrCreateDocument(bucketId, filePath, {
            bucket_name: bucket.bucket_name,
            region: bucketRegion,
          });
          const ytext = newDoc.getText("content");
          const newContent = typeof content === "string" ? content : content.toString("utf-8");
          ytext.insert(0, newContent);
          
          // Force a save to S3
          const { forceSaveDocument } = await import("../services/yjsProviderService");
          await forceSaveDocument(bucketId, filePath);
          
          logger.info(`[Container Sync] Created new Y.js document from container: ${filePath}`);
          isNewFile = true; // This is definitely a new file
        }
        
        // Broadcast file-tree-change event if this is a new file
        if (isNewFile) {
          const io = getIO();
          const yjsNamespace = io.of("/yjs");
          const bucketRoom = `bucket:${bucketId}`;
          
          // Broadcast to all clients subscribed to this bucket
          yjsNamespace.to(bucketRoom).emit("file-tree-change", {
            bucketId,
            filePath,
            action: "create",
          });
          
          logger.info(`[Container Sync] 📢 Broadcasted file-tree-change (create) for new file: ${filePath}`, {
            bucketId,
            bucketRoom
          });
        }
      } catch (error: any) {
        // Don't fail the request - S3 save succeeded
        logger.error(`[Container Sync] Failed to update Y.js document from container sync:`, error);
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
