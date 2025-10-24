import { HealthMonitor } from "../healthMonitor";
import { ContainerService } from "../containerService";
import { StateManager } from "../stateManager";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock dependencies
jest.mock("../containerService");
jest.mock("../stateManager");

describe("HealthMonitor", () => {
  let healthMonitor: HealthMonitor;
  let mockContainerService: jest.Mocked<ContainerService>;
  let mockStateManager: jest.Mocked<StateManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockContainerService =
      new ContainerService() as jest.Mocked<ContainerService>;
    mockStateManager = new StateManager() as jest.Mocked<StateManager>;

    // Default mock: no containers
    mockStateManager.listContainers.mockReturnValue([]);

    healthMonitor = new HealthMonitor(mockContainerService, mockStateManager);
  });

  afterEach(() => {
    healthMonitor.stop();
    jest.useRealTimers();
  });

  describe("start and stop", () => {
    it("should start health monitoring", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      healthMonitor.start();

      expect(consoleSpy).toHaveBeenCalledWith("Starting health monitor...");

      consoleSpy.mockRestore();
    });

    it("should not start if already running", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      healthMonitor.start();
      healthMonitor.start();

      expect(consoleSpy).toHaveBeenCalledWith("Health monitor already running");

      consoleSpy.mockRestore();
    });

    it("should stop health monitoring", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      healthMonitor.start();
      healthMonitor.stop();

      expect(consoleSpy).toHaveBeenCalledWith("Health monitor stopped");

      consoleSpy.mockRestore();
    });
  });

  describe("health checks", () => {
    const testContainer = {
      id: "test-container-1",
      serviceName: "ide-test-container-1",
      s3Bucket: "test-bucket",
      s3Region: "us-east-1",
      status: "running" as const,
      createdAt: new Date(),
      urls: {
        vnc: "https://test-container-1-vnc.example.com",
        codeServer: "https://test-container-1-code.example.com",
        webServer: "https://test-container-1-web.example.com",
      },
      resourceLimits: {
        cpuLimit: "2",
        memoryLimit: "4294967296",
      },
    };

    beforeEach(() => {
      mockStateManager.listContainers.mockReturnValue([testContainer]);
      mockStateManager.getContainer.mockReturnValue(testContainer);
    });

    it("should mark container as healthy when all services are reachable", async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });

      healthMonitor.start();

      // Wait for initial check
      await jest.runOnlyPendingTimersAsync();

      const health = healthMonitor.getContainerHealth("test-container-1");

      expect(health).toMatchObject({
        status: "healthy",
        consecutiveFailures: 0,
        checks: {
          codeServer: true,
          vnc: true,
          webServer: true,
        },
      });
    });

    it("should increment consecutive failures when services are unreachable", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));

      // Start (triggers initial check immediately)
      healthMonitor.start();
      // Wait for all pending promises (the initial check)
      await jest.advanceTimersByTimeAsync(0);

      let health = healthMonitor.getContainerHealth("test-container-1");
      expect(health?.consecutiveFailures).toBe(1);

      // Run interval timer for second check
      await jest.runOnlyPendingTimersAsync();

      health = healthMonitor.getContainerHealth("test-container-1");
      expect(health?.consecutiveFailures).toBe(2);
    });

    it("should mark container as unhealthy after 3 consecutive failures", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));

      // Start (initial check)
      healthMonitor.start();
      await jest.advanceTimersByTimeAsync(0);
      // Run interval timers for 2nd and 3rd checks
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();

      const health = healthMonitor.getContainerHealth("test-container-1");

      expect(health?.status).toBe("unhealthy");
      expect(health?.consecutiveFailures).toBe(3);
    });

    it("should reset consecutive failures when container recovers", async () => {
      // First check - all 3 services fail (initial check)
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));
      healthMonitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(
        healthMonitor.getContainerHealth("test-container-1")
          ?.consecutiveFailures
      ).toBe(1);

      // Second check - all 3 services fail (interval timer)
      await jest.runOnlyPendingTimersAsync();
      expect(
        healthMonitor.getContainerHealth("test-container-1")
          ?.consecutiveFailures
      ).toBe(2);

      // Third check - all 3 services succeed (recovery)
      mockedAxios.get.mockResolvedValue({ status: 200 });
      await jest.runOnlyPendingTimersAsync();
      expect(
        healthMonitor.getContainerHealth("test-container-1")
          ?.consecutiveFailures
      ).toBe(0);
    });

    it("should check all three services", async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });

      healthMonitor.start();

      await jest.runOnlyPendingTimersAsync();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://test-container-1-vnc.example.com",
        expect.any(Object)
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://test-container-1-code.example.com",
        expect.any(Object)
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://test-container-1-web.example.com",
        expect.any(Object)
      );
    });

    it("should use 5 second timeout for health checks", async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });

      healthMonitor.start();

      await jest.runOnlyPendingTimersAsync();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it("should accept status codes < 500 as healthy", async () => {
      mockedAxios.get.mockResolvedValue({ status: 404 });

      healthMonitor.start();

      await jest.runOnlyPendingTimersAsync();

      const health = healthMonitor.getContainerHealth("test-container-1");
      expect(health?.status).toBe("healthy");
    });
  });

  describe("recovery", () => {
    beforeEach(() => {
      mockStateManager.listContainers.mockReturnValue([
        {
          id: "test-container-1",
          serviceName: "ide-test-container-1",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "running",
          createdAt: new Date(),
          urls: {
            vnc: "https://test-container-1-vnc.example.com",
            codeServer: "https://test-container-1-code.example.com",
            webServer: "https://test-container-1-web.example.com",
          },
          resourceLimits: {
            cpuLimit: "2",
            memoryLimit: "4294967296",
          },
        },
      ]);

      mockContainerService.getContainer.mockResolvedValue({
        id: "test-container-1",
        serviceName: "ide-test-container-1",
        status: "running",
        urls: {
          vnc: "https://test-container-1-vnc.example.com",
          codeServer: "https://test-container-1-code.example.com",
          webServer: "https://test-container-1-web.example.com",
        },
        s3Bucket: "test-bucket",
        createdAt: new Date(),
      });
    });

    it("should attempt recovery after 3 consecutive failures", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));

      healthMonitor.start();

      // Run 3 checks to trigger recovery
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();

      expect(mockStateManager.updateContainerLifecycle).toHaveBeenCalledWith(
        "test-container-1",
        { status: "failed" }
      );
    });

    it("should only attempt recovery once", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));

      healthMonitor.start();

      // Run 5 checks
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();

      // Should only update once
      expect(mockStateManager.updateContainerLifecycle).toHaveBeenCalledTimes(
        1
      );
    });

    it("should log recovery attempt", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));

      healthMonitor.start();

      // Run 3 checks to trigger recovery
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();
      await jest.runOnlyPendingTimersAsync();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Attempting to recover container")
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getContainerHealth", () => {
    it("should return null for unknown container", () => {
      const health = healthMonitor.getContainerHealth("unknown-container");
      expect(health).toBeNull();
    });

    it("should return starting status for starting containers", async () => {
      mockStateManager.listContainers.mockReturnValue([
        {
          id: "test-container-1",
          serviceName: "ide-test-container-1",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "starting",
          createdAt: new Date(),
          urls: {
            vnc: "https://test-container-1-vnc.example.com",
            codeServer: "https://test-container-1-code.example.com",
            webServer: "https://test-container-1-web.example.com",
          },
          resourceLimits: {
            cpuLimit: "2",
            memoryLimit: "4294967296",
          },
        },
      ]);

      mockStateManager.getContainer.mockReturnValue({
        id: "test-container-1",
        serviceName: "ide-test-container-1",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "starting",
        createdAt: new Date(),
        urls: {
          vnc: "https://test-container-1-vnc.example.com",
          codeServer: "https://test-container-1-code.example.com",
          webServer: "https://test-container-1-web.example.com",
        },
        resourceLimits: {
          cpuLimit: "2",
          memoryLimit: "4294967296",
        },
      });

      mockedAxios.get.mockResolvedValue({ status: 200 });

      healthMonitor.start();

      // Wait for initial check to run
      await jest.runOnlyPendingTimersAsync();

      const health = healthMonitor.getContainerHealth("test-container-1");
      expect(health?.status).toBe("starting");
    });
  });

  describe("removeContainerHealth", () => {
    it("should remove health state for stopped container", async () => {
      const container = {
        id: "test-container-1",
        serviceName: "ide-test-container-1",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "running" as const,
        createdAt: new Date(),
        urls: {
          vnc: "https://test-container-1-vnc.example.com",
          codeServer: "https://test-container-1-code.example.com",
          webServer: "https://test-container-1-web.example.com",
        },
        resourceLimits: {
          cpuLimit: "2",
          memoryLimit: "4294967296",
        },
      };

      mockStateManager.listContainers.mockReturnValue([container]);
      mockStateManager.getContainer.mockReturnValue(container);

      mockedAxios.get.mockResolvedValue({ status: 200 });

      healthMonitor.start();
      await jest.runOnlyPendingTimersAsync();

      expect(
        healthMonitor.getContainerHealth("test-container-1")
      ).not.toBeNull();

      healthMonitor.removeContainerHealth("test-container-1");

      expect(healthMonitor.getContainerHealth("test-container-1")).toBeNull();
    });
  });
});
