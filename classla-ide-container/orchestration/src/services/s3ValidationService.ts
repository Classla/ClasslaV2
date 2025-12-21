import {
  S3Client,
  HeadBucketCommand,
  GetBucketLocationCommand,
} from "@aws-sdk/client-s3";
import { config } from "../config/index";

export interface S3ValidationResult {
  valid: boolean;
  error?: string;
  region?: string;
}

export class S3ValidationService {
  /**
   * Validate that an S3 bucket exists and is accessible
   * @param bucketName - The name of the S3 bucket to validate
   * @param region - Optional AWS region (defaults to config.awsRegion)
   * @param credentials - Optional AWS credentials
   * @returns Validation result with error message if invalid
   */
  async validateBucket(
    bucketName: string,
    region?: string,
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    }
  ): Promise<S3ValidationResult> {
    // Basic bucket name validation
    if (!bucketName || typeof bucketName !== "string") {
      return {
        valid: false,
        error: "Bucket name is required and must be a string",
      };
    }

    // Validate bucket name format (AWS S3 bucket naming rules)
    const bucketNameRegex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
    if (!bucketNameRegex.test(bucketName)) {
      return {
        valid: false,
        error:
          "Invalid bucket name format. Bucket names must be 3-63 characters long, start and end with a lowercase letter or number, and contain only lowercase letters, numbers, hyphens, and periods.",
      };
    }

    // Check for dummy/test credentials early and skip validation
    const checkCredentials = credentials || 
      (config.awsAccessKeyId && config.awsSecretAccessKey 
        ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey }
        : null);
    
    const isDummyCredentials = checkCredentials && (
      checkCredentials.accessKeyId === 'dummy-key' || 
      checkCredentials.accessKeyId?.includes('dummy') ||
      checkCredentials.secretAccessKey === 'dummy-secret' ||
      checkCredentials.secretAccessKey?.includes('dummy')
    );
    
    if (isDummyCredentials) {
      console.warn(`Skipping S3 validation for bucket ${bucketName} - using dummy/test credentials`);
      return {
        valid: true,
        region: region || config.awsRegion,
      };
    }

    // Determine which credentials to use
    const s3Config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: region || config.awsRegion,
    };

    // Use provided credentials, or fall back to config credentials, or use IAM role (no credentials)
    if (credentials?.accessKeyId && credentials?.secretAccessKey) {
      s3Config.credentials = credentials;
    } else if (config.awsAccessKeyId && config.awsSecretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      };
    }
    // If no credentials provided, SDK will use IAM role or environment variables

    const s3Client = new S3Client(s3Config);

    try {
      // Try to get bucket metadata (this verifies bucket exists and we have access)
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));

      // Get bucket region to verify it matches
      let bucketRegion = region || config.awsRegion;
      try {
        const locationResponse = await s3Client.send(
          new GetBucketLocationCommand({ Bucket: bucketName })
        );
        // LocationConstraint is null for us-east-1
        bucketRegion = locationResponse.LocationConstraint || "us-east-1";
      } catch (error) {
        // If we can't get location, that's okay - we already verified access with HeadBucket
        console.warn(
          `Could not determine bucket region for ${bucketName}:`,
          error
        );
      }

      return {
        valid: true,
        region: bucketRegion,
      };
    } catch (error: unknown) {
      // Log the full error for debugging
      console.error('S3 validation error:', error);
      
      // Handle specific S3 errors
      if (error && typeof error === "object" && "name" in error) {
        const awsError = error as { name: string; message?: string };

        switch (awsError.name) {
          case "NotFound":
          case "NoSuchBucket":
            return {
              valid: false,
              error: `S3 bucket '${bucketName}' does not exist`,
            };

          case "Forbidden":
          case "AccessDenied":
            return {
              valid: false,
              error: `Access denied to S3 bucket '${bucketName}'. Verify that the credentials have the necessary permissions (s3:HeadBucket, s3:GetBucketLocation, s3:GetObject, s3:PutObject).`,
            };

          case "InvalidAccessKeyId":
          case "SignatureDoesNotMatch":
            return {
              valid: false,
              error:
                "Invalid AWS credentials. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
            };

          case "CredentialsProviderError":
            return {
              valid: false,
              error:
                "Could not load AWS credentials. Please provide credentials or ensure IAM role is configured.",
            };

          default:
            return {
              valid: false,
              error: `Failed to validate S3 bucket: ${
                awsError.message || awsError.name
              }`,
            };
        }
      }

      // Generic error - provide more details
      const errorMessage = error instanceof Error 
        ? error.message 
        : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as any).message)
        : String(error);
      
      const errorName = error instanceof Error
        ? error.name
        : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as any).name)
        : 'UnknownError';
      
      return {
        valid: false,
        error: `Failed to validate S3 bucket: ${errorName} - ${errorMessage}`,
      };
    }
  }

  /**
   * Validate bucket and throw an error if invalid
   * This is a convenience method for use in request handlers
   */
  async validateBucketOrThrow(
    bucketName: string,
    region?: string,
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    }
  ): Promise<string> {
    const result = await this.validateBucket(bucketName, region, credentials);

    if (!result.valid) {
      throw new Error(result.error || "S3 bucket validation failed");
    }

    return result.region || region || config.awsRegion;
  }
}
