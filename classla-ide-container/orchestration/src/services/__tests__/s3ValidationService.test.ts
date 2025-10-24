import { S3ValidationService } from "../s3ValidationService";
import { S3Client } from "@aws-sdk/client-s3";

// Mock the AWS SDK
jest.mock("@aws-sdk/client-s3");

describe("S3ValidationService", () => {
  let service: S3ValidationService;
  let mockS3Client: jest.Mocked<S3Client>;

  beforeEach(() => {
    service = new S3ValidationService();
    mockS3Client = new S3Client({}) as jest.Mocked<S3Client>;
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () => mockS3Client
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("validateBucket", () => {
    it("should return valid for an accessible bucket", async () => {
      // Mock successful HeadBucket and GetBucketLocation
      mockS3Client.send = jest
        .fn()
        .mockResolvedValueOnce({}) // HeadBucket success
        .mockResolvedValueOnce({ LocationConstraint: "us-west-2" }); // GetBucketLocation

      const result = await service.validateBucket(
        "my-test-bucket",
        "us-west-2"
      );

      expect(result.valid).toBe(true);
      expect(result.region).toBe("us-west-2");
      expect(result.error).toBeUndefined();
    });

    it("should return valid with us-east-1 when LocationConstraint is null", async () => {
      mockS3Client.send = jest
        .fn()
        .mockResolvedValueOnce({}) // HeadBucket success
        .mockResolvedValueOnce({ LocationConstraint: null }); // GetBucketLocation returns null for us-east-1

      const result = await service.validateBucket("my-test-bucket");

      expect(result.valid).toBe(true);
      expect(result.region).toBe("us-east-1");
    });

    it("should return invalid for empty bucket name", async () => {
      const result = await service.validateBucket("");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should return invalid for non-string bucket name", async () => {
      const result = await service.validateBucket(null as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should return invalid for bucket name with invalid format", async () => {
      const result = await service.validateBucket("Invalid_Bucket_Name");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid bucket name format");
    });

    it("should return invalid for bucket name that is too short", async () => {
      const result = await service.validateBucket("ab");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid bucket name format");
    });

    it("should return invalid for bucket name that is too long", async () => {
      const longName = "a".repeat(64);
      const result = await service.validateBucket(longName);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid bucket name format");
    });

    it("should return invalid when bucket does not exist", async () => {
      mockS3Client.send = jest.fn().mockRejectedValueOnce({
        name: "NoSuchBucket",
        message: "The specified bucket does not exist",
      });

      const result = await service.validateBucket("non-existent-bucket");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    it("should return invalid when access is denied", async () => {
      mockS3Client.send = jest.fn().mockRejectedValueOnce({
        name: "AccessDenied",
        message: "Access Denied",
      });

      const result = await service.validateBucket("forbidden-bucket");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Access denied");
      expect(result.error).toContain("permissions");
    });

    it("should return invalid when credentials are invalid", async () => {
      mockS3Client.send = jest.fn().mockRejectedValueOnce({
        name: "InvalidAccessKeyId",
        message: "The AWS Access Key Id you provided does not exist",
      });

      const result = await service.validateBucket("my-bucket");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid AWS credentials");
    });

    it("should return invalid when credentials cannot be loaded", async () => {
      mockS3Client.send = jest.fn().mockRejectedValueOnce({
        name: "CredentialsProviderError",
        message: "Could not load credentials",
      });

      const result = await service.validateBucket("my-bucket");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Could not load AWS credentials");
    });

    it("should handle generic errors", async () => {
      mockS3Client.send = jest
        .fn()
        .mockRejectedValueOnce(new Error("Network error"));

      const result = await service.validateBucket("my-bucket");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should use provided credentials", async () => {
      mockS3Client.send = jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ LocationConstraint: "us-west-2" });

      const credentials = {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
      };

      const result = await service.validateBucket(
        "my-bucket",
        "us-west-2",
        credentials
      );

      expect(result.valid).toBe(true);
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: "us-west-2",
          credentials: credentials,
        })
      );
    });

    it("should continue validation even if GetBucketLocation fails", async () => {
      mockS3Client.send = jest
        .fn()
        .mockResolvedValueOnce({}) // HeadBucket success
        .mockRejectedValueOnce(new Error("Cannot get location")); // GetBucketLocation fails

      const result = await service.validateBucket("my-bucket", "us-west-2");

      expect(result.valid).toBe(true);
      expect(result.region).toBe("us-west-2"); // Should use provided region
    });
  });

  describe("validateBucketOrThrow", () => {
    it("should return region when bucket is valid", async () => {
      mockS3Client.send = jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ LocationConstraint: "us-west-2" });

      const region = await service.validateBucketOrThrow(
        "my-bucket",
        "us-west-2"
      );

      expect(region).toBe("us-west-2");
    });

    it("should throw error when bucket is invalid", async () => {
      mockS3Client.send = jest.fn().mockRejectedValueOnce({
        name: "NoSuchBucket",
        message: "The specified bucket does not exist",
      });

      await expect(
        service.validateBucketOrThrow("non-existent-bucket")
      ).rejects.toThrow("does not exist");
    });

    it("should throw error for invalid bucket name format", async () => {
      await expect(
        service.validateBucketOrThrow("Invalid_Name")
      ).rejects.toThrow("Invalid bucket name format");
    });
  });
});
