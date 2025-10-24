import { ResourceMonitor } from "../resourceMonitor";
import { ContainerService } from "../containerService";
import * as si from "systeminformation";

// Mock systeminformation
jest.mock("systeminformation");

// Mock ContainerService
jest.mock("../containerService");

describe("ResourceMonitor", () => {
  let resourceMonitor: ResourceMonitor;
  let mockContainerService: jest.Mocked<ContainerService>;

  beforeEach(() => {
    // Create mock container service
    mockContainerService = {
      listContainers: jest.fn(),
    } as any;

    resourceMonitor = new ResourceMonitor(mockContainerService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe("getSystemResources", () => {
    it("should return system resource information", async () => {
      // Mock systeminformation responses
      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 45.5,
      });

      (si.cpu as jest.Mock).mockResolvedValue({
        cores: 4,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592, // 8GB
        used: 4294967296, // 4GB
        available: 4294967296, // 4GB
      });

      (si.fsSize as jest.Mock).mockResolvedValue([
        {
          mount: "/",
          size: 107374182400, // 100GB
          used: 53687091200, // 50GB
          available: 53687091200, // 50GB
          use: 50,
        },
      ]);

      mockContainerService.listContainers.mockResolvedValue([
        { status: "running" } as any,
        { status: "running" } as any,
        { status: "stopped" } as any,
      ]);

      const resources = await resourceMonitor.getSystemResources();

      expect(resources).toEqual({
        cpu: {
          usage: 45.5,
          available: 4,
        },
        memory: {
          total: 8589934592,
          used: 4294967296,
          available: 4294967296,
          usagePercent: 50,
        },
        disk: {
          total: 107374182400,
          used: 53687091200,
          available: 53687091200,
          usagePercent: 50,
        },
        containers: {
          running: 2,
          total: 3,
        },
      });
    });

    it("should handle multiple disk mounts and use root mount", async () => {
      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 10,
      });

      (si.cpu as jest.Mock).mockResolvedValue({
        cores: 2,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 4294967296,
        used: 1073741824,
        available: 3221225472,
      });

      (si.fsSize as jest.Mock).mockResolvedValue([
        {
          mount: "/boot",
          size: 1073741824,
          used: 536870912,
          available: 536870912,
          use: 50,
        },
        {
          mount: "/",
          size: 107374182400,
          used: 21474836480,
          available: 85899345920,
          use: 20,
        },
      ]);

      mockContainerService.listContainers.mockResolvedValue([]);

      const resources = await resourceMonitor.getSystemResources();

      expect(resources.disk.total).toBe(107374182400);
      expect(resources.disk.usagePercent).toBe(20);
    });
  });

  describe("canStartContainer", () => {
    beforeEach(() => {
      (si.cpu as jest.Mock).mockResolvedValue({ cores: 4 });
      (si.fsSize as jest.Mock).mockResolvedValue([
        {
          mount: "/",
          size: 107374182400,
          used: 53687091200,
          available: 53687091200,
          use: 50,
        },
      ]);
      mockContainerService.listContainers.mockResolvedValue([]);
    });

    it("should allow container start when resources are below threshold", async () => {
      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 50,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592,
        used: 4294967296, // 50% usage
        available: 4294967296,
      });

      const result = await resourceMonitor.canStartContainer();

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should block container start when memory exceeds 90% threshold", async () => {
      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 50,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592,
        used: 7730941133, // Just over 90% usage
        available: 858993459,
      });

      const result = await resourceMonitor.canStartContainer();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Memory usage at 90.0%");
      expect(result.reason).toContain("exceeds threshold of 90%");
    });

    it("should block container start when memory exceeds threshold", async () => {
      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 50,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592,
        used: 8160437862, // 95% usage
        available: 429496730,
      });

      const result = await resourceMonitor.canStartContainer();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Memory usage");
      expect(result.reason).toContain("exceeds threshold");
    });

    it("should log warning but allow start when CPU exceeds 90% threshold", async () => {
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 92,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592,
        used: 4294967296, // 50% usage
        available: 4294967296,
      });

      const result = await resourceMonitor.canStartContainer();

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("CPU usage at 92.0%")
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("exceeds threshold of 90%")
      );

      consoleWarnSpy.mockRestore();
    });

    it("should use custom thresholds when provided", async () => {
      const customMonitor = new ResourceMonitor(mockContainerService, {
        memoryPercent: 80,
        cpuPercent: 80,
      });

      (si.currentLoad as jest.Mock).mockResolvedValue({
        currentLoad: 85,
      });

      (si.mem as jest.Mock).mockResolvedValue({
        total: 8589934592,
        used: 6871947674, // Just over 80% usage
        available: 1717986918,
      });

      const result = await customMonitor.canStartContainer();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds threshold of 80%");
    });
  });

  describe("getThresholds and setThresholds", () => {
    it("should return default thresholds", () => {
      const thresholds = resourceMonitor.getThresholds();

      expect(thresholds).toEqual({
        memoryPercent: 90,
        cpuPercent: 90,
      });
    });

    it("should update thresholds", () => {
      resourceMonitor.setThresholds({ memoryPercent: 85 });

      const thresholds = resourceMonitor.getThresholds();

      expect(thresholds).toEqual({
        memoryPercent: 85,
        cpuPercent: 90,
      });
    });

    it("should partially update thresholds", () => {
      resourceMonitor.setThresholds({ cpuPercent: 95 });

      const thresholds = resourceMonitor.getThresholds();

      expect(thresholds).toEqual({
        memoryPercent: 90,
        cpuPercent: 95,
      });
    });
  });
});
