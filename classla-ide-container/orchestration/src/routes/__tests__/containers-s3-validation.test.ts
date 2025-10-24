import request from "supertest";
import express, { Express } from "express";
import containersRouter from "../containers";
import { errorHandler } from "../../middleware/errorHandler";
import {
  containerService,
  stateManager,
  resourceMonitor,
  s3ValidationService,
} from "../../services/serviceInstances";

// Mock the services
jest.mock("../../services/serviceInstances", () => ({
  containerService: {
    createContainer: jest.fn(),
    stopContainer: jest.fn(),
    getContainer: jest.fn(),
    listContainers: jest.fn(),
  },
  stateManager: {
    saveContainer: jest.fn(),
    getContainer: jest.fn(),
    listContainers: jest.fn(),
    getContainerCount: jest.fn(),
    updateContainerLifecycle: jest.fn(),
  },
  resourceMonitor: {
    canStartContainer: jest.fn(),
  },
  healthMonitor: {
    getContainerHealth: jest.fn(),
    removeContainerHealth: jest.fn(),
  },
  s3ValidationService: {
    validateBucket: jest.fn(),
  },
}));

describe("POST /api/containers/start - S3 Validation", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api/containers", containersRouter);
    app.use(errorHandler);

    // Reset mocks
    jest.clearAllMocks();

    // Default mock implementations
    (resourceMonitor.canStartContainer as jest.Mock).mockResolvedValue({
      allowed: true,
    });
  });

  it("should reject request when S3 bucket validation fails", async () => {
    // Mock S3 validation to fail
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: false,
      error: "S3 bucket 'non-existent-bucket' does not exist",
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "non-existent-bucket",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_S3_BUCKET");
    expect(response.body.error.message).toContain("does not exist");

    // Verify container was not created
    expect(containerService.createContainer).not.toHaveBeenCalled();
    expect(stateManager.saveContainer).not.toHaveBeenCalled();
  });

  it("should reject request when S3 access is denied", async () => {
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: false,
      error:
        "Access denied to S3 bucket 'forbidden-bucket'. Verify that the credentials have the necessary permissions.",
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "forbidden-bucket",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_S3_BUCKET");
    expect(response.body.error.message).toContain("Access denied");
    expect(response.body.error.message).toContain("permissions");

    expect(containerService.createContainer).not.toHaveBeenCalled();
  });

  it("should reject request when AWS credentials are invalid", async () => {
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: false,
      error:
        "Invalid AWS credentials. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "my-bucket",
      awsAccessKeyId: "invalid-key",
      awsSecretAccessKey: "invalid-secret",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_S3_BUCKET");
    expect(response.body.error.message).toContain("Invalid AWS credentials");

    expect(containerService.createContainer).not.toHaveBeenCalled();
  });

  it("should accept request when S3 bucket is valid", async () => {
    // Mock S3 validation to succeed
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: true,
      region: "us-west-2",
    });

    // Mock container creation
    (containerService.createContainer as jest.Mock).mockResolvedValue({
      id: "test-123",
      serviceName: "ide-test-123",
      status: "starting",
      urls: {
        vnc: "https://test-123-vnc.example.com",
        codeServer: "https://test-123-code.example.com",
        webServer: "https://test-123-web.example.com",
      },
      s3Bucket: "valid-bucket",
      createdAt: new Date(),
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "valid-bucket",
      s3Region: "us-west-2",
    });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("test-123");
    expect(response.body.status).toBe("starting");

    // Verify S3 validation was called with correct parameters
    expect(s3ValidationService.validateBucket).toHaveBeenCalledWith(
      "valid-bucket",
      "us-west-2",
      undefined
    );

    // Verify container was created with validated region
    expect(containerService.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        s3Bucket: "valid-bucket",
        s3Region: "us-west-2",
      })
    );
  });

  it("should use validated region from S3 service", async () => {
    // Mock S3 validation to return a different region
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: true,
      region: "eu-west-1", // Different from requested region
    });

    (containerService.createContainer as jest.Mock).mockResolvedValue({
      id: "test-456",
      serviceName: "ide-test-456",
      status: "starting",
      urls: {
        vnc: "https://test-456-vnc.example.com",
        codeServer: "https://test-456-code.example.com",
        webServer: "https://test-456-web.example.com",
      },
      s3Bucket: "eu-bucket",
      createdAt: new Date(),
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "eu-bucket",
      s3Region: "us-east-1", // Request with us-east-1
    });

    expect(response.status).toBe(201);

    // Verify container was created with the validated region (eu-west-1)
    expect(containerService.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        s3Bucket: "eu-bucket",
        s3Region: "eu-west-1", // Should use validated region
      })
    );

    // Verify state manager saved with validated region
    expect(stateManager.saveContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        s3Region: "eu-west-1",
      })
    );
  });

  it("should pass custom credentials to S3 validation", async () => {
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: true,
      region: "us-west-2",
    });

    (containerService.createContainer as jest.Mock).mockResolvedValue({
      id: "test-789",
      serviceName: "ide-test-789",
      status: "starting",
      urls: {
        vnc: "https://test-789-vnc.example.com",
        codeServer: "https://test-789-code.example.com",
        webServer: "https://test-789-web.example.com",
      },
      s3Bucket: "custom-creds-bucket",
      createdAt: new Date(),
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "custom-creds-bucket",
      awsAccessKeyId: "custom-key",
      awsSecretAccessKey: "custom-secret",
    });

    expect(response.status).toBe(201);

    // Verify S3 validation was called with custom credentials
    expect(s3ValidationService.validateBucket).toHaveBeenCalledWith(
      "custom-creds-bucket",
      expect.any(String),
      {
        accessKeyId: "custom-key",
        secretAccessKey: "custom-secret",
      }
    );
  });

  it("should reject invalid bucket name format before calling S3", async () => {
    // Mock S3 validation to reject invalid format
    (s3ValidationService.validateBucket as jest.Mock).mockResolvedValue({
      valid: false,
      error:
        "Invalid bucket name format. Bucket names must be 3-63 characters long, start and end with a lowercase letter or number, and contain only lowercase letters, numbers, hyphens, and periods.",
    });

    const response = await request(app).post("/api/containers/start").send({
      s3Bucket: "Invalid_Bucket_Name",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_S3_BUCKET");
    expect(response.body.error.message).toContain("Invalid bucket name format");

    // S3 validation should be called (it does the format validation)
    expect(s3ValidationService.validateBucket).toHaveBeenCalled();
  });
});
