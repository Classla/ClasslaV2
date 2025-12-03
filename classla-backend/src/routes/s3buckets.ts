import express, { Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { v4 as uuidv4 } from "uuid";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials:
    process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
          secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
        }
      : undefined,
});

/**
 * POST /api/s3buckets
 * Create a new S3 bucket for IDE container workspace
 */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, course_id, assignment_id, region } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    // Generate unique bucket name
    const bucketName = `classla-ide-${user_id.substring(0, 8)}-${Date.now()}`;
    const bucketRegion = region || process.env.AWS_REGION || "us-east-1";
    const bucketId = uuidv4();

    // Insert bucket record with 'creating' status
    const { error: insertError } = await supabase.from("s3_buckets").insert({
      id: bucketId,
      bucket_name: bucketName,
      region: bucketRegion,
      user_id,
      course_id: course_id || null,
      assignment_id: assignment_id || null,
      status: "creating",
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

      res.status(201).json(bucket);
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
    const { user_id, course_id, assignment_id, status } = req.query;

    let query = supabase.from("s3_buckets").select("*");

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

    res.json({ buckets });
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

    const { data: bucket, error } = await supabase
      .from("s3_buckets")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Bucket not found" });
      }
      console.error("Error fetching bucket:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json(bucket);
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

      res.json({ message: "Bucket deleted successfully", id });
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

export default router;
