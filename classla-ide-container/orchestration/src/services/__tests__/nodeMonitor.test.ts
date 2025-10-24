import { NodeMonitor } from "../nodeMonitor";
import Dockerode from "dockerode";

// Mock Dockerode
jest.mock("dockerode");

describe("NodeMonitor", () => {
  let nodeMonitor: NodeMonitor;
  let mockDocker: jest.Mocked<Dockerode>;

  beforeEach(() => {
    mockDocker = {
      listNodes: jest.fn(),
      listTasks: jest.fn(),
    } as any;

    nodeMonitor = new NodeMonitor(mockDocker);

    jest.clearAllMocks();
  });

  describe("getNodes", () => {
    it("should return list of nodes with basic information", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: {
            Role: "manager",
            Availability: "active",
          },
          Status: {
            State: "ready",
          },
          Description: {
            Hostname: "manager-node",
            Resources: {
              NanoCPUs: 4000000000, // 4 cores
              MemoryBytes: 8589934592, // 8GB
            },
          },
        },
        {
          ID: "node2",
          Spec: {
            Role: "worker",
            Availability: "active",
          },
          Status: {
            State: "ready",
          },
          Description: {
            Hostname: "worker-node-1",
            Resources: {
              NanoCPUs: 2000000000, // 2 cores
              MemoryBytes: 4294967296, // 4GB
            },
          },
        },
      ] as any);

      const nodes = await nodeMonitor.getNodes();

      expect(nodes).toHaveLength(2);
      expect(nodes[0]).toEqual({
        id: "node1",
        hostname: "manager-node",
        role: "manager",
        status: "ready",
        availability: "active",
        resources: {
          cpuCores: 4,
          memoryBytes: 8589934592,
        },
        containerCount: 0,
      });
      expect(nodes[1]).toEqual({
        id: "node2",
        hostname: "worker-node-1",
        role: "worker",
        status: "ready",
        availability: "active",
        resources: {
          cpuCores: 2,
          memoryBytes: 4294967296,
        },
        containerCount: 0,
      });
    });

    it("should handle nodes with different availability states", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: {
            Role: "worker",
            Availability: "drain",
          },
          Status: {
            State: "ready",
          },
          Description: {
            Hostname: "draining-node",
            Resources: {
              NanoCPUs: 2000000000,
              MemoryBytes: 4294967296,
            },
          },
        },
      ] as any);

      const nodes = await nodeMonitor.getNodes();

      expect(nodes[0].availability).toBe("drain");
    });

    it("should handle nodes with down status", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: {
            Role: "worker",
            Availability: "active",
          },
          Status: {
            State: "down",
          },
          Description: {
            Hostname: "down-node",
            Resources: {
              NanoCPUs: 2000000000,
              MemoryBytes: 4294967296,
            },
          },
        },
      ] as any);

      const nodes = await nodeMonitor.getNodes();

      expect(nodes[0].status).toBe("down");
    });

    it("should handle errors gracefully", async () => {
      mockDocker.listNodes.mockRejectedValue(new Error("Docker API error"));

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const nodes = await nodeMonitor.getNodes();

      expect(nodes).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error fetching nodes"),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("getNodeMetrics", () => {
    beforeEach(() => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: {
            Role: "manager",
            Availability: "active",
          },
          Status: {
            State: "ready",
          },
          Description: {
            Hostname: "manager-node",
            Resources: {
              NanoCPUs: 4000000000, // 4 cores
              MemoryBytes: 8589934592, // 8GB
            },
          },
        },
      ] as any);
    });

    it("should calculate resource usage based on running tasks", async () => {
      mockDocker.listTasks.mockResolvedValue([
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 2000000000, // 2 cores
                MemoryBytes: 4294967296, // 4GB
              },
            },
          },
        },
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 1000000000, // 1 core
                MemoryBytes: 2147483648, // 2GB
              },
            },
          },
        },
      ] as any);

      const metrics = await nodeMonitor.getNodeMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toEqual({
        nodeId: "node1",
        hostname: "manager-node",
        cpuUsage: 75, // (2 + 1) / 4 * 100
        memoryUsage: 6442450944, // 4GB + 2GB
        memoryUsagePercent: 75, // 6GB / 8GB * 100
        containerCount: 2,
        health: "healthy",
      });
    });

    it("should only count running tasks", async () => {
      mockDocker.listTasks.mockResolvedValue([
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 1000000000,
                MemoryBytes: 2147483648,
              },
            },
          },
        },
        {
          NodeID: "node1",
          Status: { State: "shutdown" },
          DesiredState: "shutdown",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 1000000000,
                MemoryBytes: 2147483648,
              },
            },
          },
        },
      ] as any);

      const metrics = await nodeMonitor.getNodeMetrics();

      expect(metrics[0].containerCount).toBe(1);
      expect(metrics[0].cpuUsage).toBe(25); // Only 1 core out of 4
    });

    it("should mark node as unhealthy when resource usage exceeds 95%", async () => {
      mockDocker.listTasks.mockResolvedValue([
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 3900000000, // 3.9 cores (97.5%)
                MemoryBytes: 8000000000, // ~93%
              },
            },
          },
        },
      ] as any);

      const metrics = await nodeMonitor.getNodeMetrics();

      expect(metrics[0].health).toBe("unhealthy");
    });

    it("should handle tasks without resource limits", async () => {
      mockDocker.listTasks.mockResolvedValue([
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {},
          },
        },
      ] as any);

      const metrics = await nodeMonitor.getNodeMetrics();

      expect(metrics[0].cpuUsage).toBe(0);
      expect(metrics[0].memoryUsage).toBe(0);
      expect(metrics[0].containerCount).toBe(1);
    });
  });

  describe("getAggregatedMetrics", () => {
    it("should aggregate metrics across all nodes", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: { Role: "manager", Availability: "active" },
          Status: { State: "ready" },
          Description: {
            Hostname: "manager-node",
            Resources: {
              NanoCPUs: 4000000000,
              MemoryBytes: 8589934592,
            },
          },
        },
        {
          ID: "node2",
          Spec: { Role: "worker", Availability: "active" },
          Status: { State: "ready" },
          Description: {
            Hostname: "worker-node",
            Resources: {
              NanoCPUs: 2000000000,
              MemoryBytes: 4294967296,
            },
          },
        },
      ] as any);

      mockDocker.listTasks.mockResolvedValue([
        {
          NodeID: "node1",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 1000000000,
                MemoryBytes: 2147483648,
              },
            },
          },
        },
        {
          NodeID: "node2",
          Status: { State: "running" },
          DesiredState: "running",
          Spec: {
            Resources: {
              Limits: {
                NanoCPUs: 1000000000,
                MemoryBytes: 2147483648,
              },
            },
          },
        },
      ] as any);

      const aggregated = await nodeMonitor.getAggregatedMetrics();

      expect(aggregated.totalNodes).toBe(2);
      expect(aggregated.healthyNodes).toBe(2);
      expect(aggregated.totalCpuCores).toBe(6); // 4 + 2
      expect(aggregated.totalMemoryBytes).toBe(12884901888); // 8GB + 4GB
      expect(aggregated.totalContainers).toBe(2);
      expect(aggregated.nodes).toHaveLength(2);
    });
  });

  describe("getNodeHealth", () => {
    it("should return healthy for ready and active node", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: { Role: "manager", Availability: "active" },
          Status: { State: "ready" },
          Description: {
            Hostname: "manager-node",
            Resources: {
              NanoCPUs: 4000000000,
              MemoryBytes: 8589934592,
            },
          },
        },
      ] as any);

      const health = await nodeMonitor.getNodeHealth("node1");

      expect(health).toEqual({
        healthy: true,
        status: "ready",
      });
    });

    it("should return unhealthy for down node", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: { Role: "worker", Availability: "active" },
          Status: { State: "down" },
          Description: {
            Hostname: "down-node",
            Resources: {
              NanoCPUs: 2000000000,
              MemoryBytes: 4294967296,
            },
          },
        },
      ] as any);

      const health = await nodeMonitor.getNodeHealth("node1");

      expect(health).toEqual({
        healthy: false,
        status: "down",
        reason: "Node status is down",
      });
    });

    it("should return unhealthy for drained node", async () => {
      mockDocker.listNodes.mockResolvedValue([
        {
          ID: "node1",
          Spec: { Role: "worker", Availability: "drain" },
          Status: { State: "ready" },
          Description: {
            Hostname: "drained-node",
            Resources: {
              NanoCPUs: 2000000000,
              MemoryBytes: 4294967296,
            },
          },
        },
      ] as any);

      const health = await nodeMonitor.getNodeHealth("node1");

      expect(health).toEqual({
        healthy: false,
        status: "drain",
        reason: "Node availability is drain",
      });
    });

    it("should return unhealthy for non-existent node", async () => {
      mockDocker.listNodes.mockResolvedValue([]);

      const health = await nodeMonitor.getNodeHealth("nonexistent");

      expect(health).toEqual({
        healthy: false,
        status: "unknown",
        reason: "Node not found",
      });
    });
  });
});
