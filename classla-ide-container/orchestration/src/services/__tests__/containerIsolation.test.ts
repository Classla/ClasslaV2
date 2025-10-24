/**
 * Tests for container isolation and network security
 */

import { ContainerService } from "../containerService.js";

describe("Container Isolation", () => {
  let containerService: ContainerService;

  beforeEach(() => {
    containerService = new ContainerService();
  });

  describe("Network Configuration", () => {
    it("should configure containers with isolated network settings", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      // Mock Docker API
      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      // Verify service was created with correct network configuration
      expect(mockCreateService).toHaveBeenCalledWith(
        expect.objectContaining({
          Networks: expect.arrayContaining([
            expect.objectContaining({
              Target: "ide-network",
              Aliases: expect.any(Array),
            }),
          ]),
          EndpointSpec: expect.objectContaining({
            Mode: "vip",
            Ports: [],
          }),
        })
      );
    });

    it("should not expose any ports directly", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      const serviceSpec = mockCreateService.mock.calls[0][0];
      expect(serviceSpec.EndpointSpec.Ports).toEqual([]);
    });

    it("should use VIP mode for network isolation", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      const serviceSpec = mockCreateService.mock.calls[0][0];
      expect(serviceSpec.EndpointSpec.Mode).toBe("vip");
    });

    it("should only attach to ide-network", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      const serviceSpec = mockCreateService.mock.calls[0][0];
      expect(serviceSpec.Networks).toHaveLength(1);
      expect(serviceSpec.Networks[0].Target).toBe("ide-network");
    });
  });

  describe("Traefik-Only Access", () => {
    it("should generate Traefik labels for all services", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      const serviceSpec = mockCreateService.mock.calls[0][0];
      const labels = serviceSpec.Labels;

      // Verify Traefik is enabled
      expect(labels["traefik.enable"]).toBe("true");

      // Verify all three services have routing rules
      const labelKeys = Object.keys(labels);
      const vncRouters = labelKeys.filter(
        (k) => k.includes("vnc") && k.includes("rule")
      );
      const codeRouters = labelKeys.filter(
        (k) => k.includes("code") && k.includes("rule")
      );
      const webRouters = labelKeys.filter(
        (k) => k.includes("web") && k.includes("rule")
      );

      expect(vncRouters.length).toBeGreaterThan(0);
      expect(codeRouters.length).toBeGreaterThan(0);
      expect(webRouters.length).toBeGreaterThan(0);
    });

    it("should specify ide-network for Traefik routing", async () => {
      const mockConfig = {
        s3Bucket: "test-bucket",
        domain: "test.example.com",
      };

      const mockCreateService = jest.fn().mockResolvedValue({});
      (containerService as any).docker.createService = mockCreateService;

      await containerService.createContainer(mockConfig);

      const serviceSpec = mockCreateService.mock.calls[0][0];
      const labels = serviceSpec.Labels;

      expect(labels["traefik.docker.network"]).toBe("ide-network");
    });
  });
});
