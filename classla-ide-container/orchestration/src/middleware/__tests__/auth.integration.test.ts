import request from "supertest";
import app from "../../server";

describe("Authentication Integration Tests", () => {
  describe("Protected endpoints", () => {
    it("should reject requests to /api/containers without API key", async () => {
      const response = await request(app).get("/api/containers");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_FAILED");
      expect(response.body.error.message).toBe("Missing Authorization header");
    });

    it("should reject requests to /api/containers with invalid API key", async () => {
      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", "invalid-key");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_FAILED");
      expect(response.body.error.message).toBe("Invalid API key");
    });

    it("should allow requests to /api/containers with valid API key", async () => {
      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", "test-api-key-for-development");

      // Should not return 401
      expect(response.status).not.toBe(401);
    });

    it("should allow requests with Bearer token format", async () => {
      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", "Bearer test-api-key-for-development");

      // Should not return 401
      expect(response.status).not.toBe(401);
    });

    it("should reject POST requests without authentication", async () => {
      const response = await request(app)
        .post("/api/containers/start")
        .send({ s3Bucket: "test-bucket" });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_FAILED");
    });

    it("should reject DELETE requests without authentication", async () => {
      const response = await request(app).delete("/api/containers/test-id");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTHENTICATION_FAILED");
    });
  });

  describe("Public endpoints", () => {
    it("should allow access to /api/health without authentication", async () => {
      const response = await request(app).get("/api/health");

      // Should not return 401
      expect(response.status).not.toBe(401);
    });

    it("should allow access to root endpoint without authentication", async () => {
      const response = await request(app).get("/");

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("IDE Orchestration API");
    });
  });
});
