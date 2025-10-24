import Dockerode from "dockerode";

export interface NodeInfo {
  id: string;
  hostname: string;
  role: "manager" | "worker";
  status: "ready" | "down" | "unknown";
  availability: "active" | "pause" | "drain";
  resources: {
    cpuCores: number;
    memoryBytes: number;
  };
  containerCount: number;
}

export interface NodeMetrics {
  nodeId: string;
  hostname: string;
  cpuUsage: number; // Percentage
  memoryUsage: number; // Bytes
  memoryUsagePercent: number;
  containerCount: number;
  health: "healthy" | "unhealthy" | "unknown";
}

export interface AggregatedMetrics {
  totalNodes: number;
  healthyNodes: number;
  totalCpuCores: number;
  totalMemoryBytes: number;
  totalContainers: number;
  nodes: NodeMetrics[];
}

export class NodeMonitor {
  private docker: Dockerode;

  constructor(docker: Dockerode) {
    this.docker = docker;
  }

  /**
   * Get list of all Swarm nodes with basic information
   */
  async getNodes(): Promise<NodeInfo[]> {
    try {
      const nodes = await this.docker.listNodes();

      return nodes.map((node) => {
        const spec = node.Spec || {};
        const status = node.Status || {};
        const description = node.Description || {};
        const resources = description.Resources || {};

        return {
          id: node.ID || "",
          hostname: description.Hostname || "unknown",
          role: spec.Role === "manager" ? "manager" : "worker",
          status: this.mapNodeStatus(status.State),
          availability:
            (spec.Availability?.toLowerCase() as
              | "active"
              | "pause"
              | "drain") || "active",
          resources: {
            cpuCores: resources.NanoCPUs
              ? resources.NanoCPUs / 1_000_000_000
              : 0,
            memoryBytes: resources.MemoryBytes || 0,
          },
          containerCount: 0, // Will be populated by getNodeMetrics
        };
      });
    } catch (error) {
      console.error("[NodeMonitor] Error fetching nodes:", error);
      return [];
    }
  }

  /**
   * Get per-node resource usage metrics
   */
  async getNodeMetrics(): Promise<NodeMetrics[]> {
    const nodes = await this.getNodes();
    const tasks = await this.docker.listTasks();

    const metrics: NodeMetrics[] = [];

    for (const node of nodes) {
      // Count containers (tasks) running on this node
      const nodeTasks = tasks.filter(
        (task) =>
          task.NodeID === node.id &&
          task.Status?.State === "running" &&
          task.DesiredState === "running"
      );

      // Calculate resource usage based on running tasks
      let totalCpuUsage = 0;
      let totalMemoryUsage = 0;

      for (const task of nodeTasks) {
        const resources = task.Spec?.Resources;
        if (resources?.Limits) {
          // CPU is in nano CPUs (1 CPU = 1,000,000,000 nano CPUs)
          if (resources.Limits.NanoCPUs) {
            totalCpuUsage += resources.Limits.NanoCPUs / 1_000_000_000;
          }
          // Memory is in bytes
          if (resources.Limits.MemoryBytes) {
            totalMemoryUsage += resources.Limits.MemoryBytes;
          }
        }
      }

      // Calculate percentages
      const cpuUsagePercent = node.resources.cpuCores
        ? (totalCpuUsage / node.resources.cpuCores) * 100
        : 0;
      const memoryUsagePercent = node.resources.memoryBytes
        ? (totalMemoryUsage / node.resources.memoryBytes) * 100
        : 0;

      // Determine health status
      const health = this.determineNodeHealth(
        node.status,
        cpuUsagePercent,
        memoryUsagePercent
      );

      metrics.push({
        nodeId: node.id,
        hostname: node.hostname,
        cpuUsage: cpuUsagePercent,
        memoryUsage: totalMemoryUsage,
        memoryUsagePercent,
        containerCount: nodeTasks.length,
        health,
      });
    }

    return metrics;
  }

  /**
   * Get aggregated metrics across all nodes
   */
  async getAggregatedMetrics(): Promise<AggregatedMetrics> {
    const nodes = await this.getNodes();
    const nodeMetrics = await this.getNodeMetrics();

    const totalCpuCores = nodes.reduce(
      (sum, node) => sum + node.resources.cpuCores,
      0
    );
    const totalMemoryBytes = nodes.reduce(
      (sum, node) => sum + node.resources.memoryBytes,
      0
    );
    const totalContainers = nodeMetrics.reduce(
      (sum, metric) => sum + metric.containerCount,
      0
    );
    const healthyNodes = nodeMetrics.filter(
      (metric) => metric.health === "healthy"
    ).length;

    return {
      totalNodes: nodes.length,
      healthyNodes,
      totalCpuCores,
      totalMemoryBytes,
      totalContainers,
      nodes: nodeMetrics,
    };
  }

  /**
   * Check health status of a specific node
   */
  async getNodeHealth(nodeId: string): Promise<{
    healthy: boolean;
    status: string;
    reason?: string;
  }> {
    const nodes = await this.getNodes();
    const node = nodes.find((n) => n.id === nodeId);

    if (!node) {
      return {
        healthy: false,
        status: "unknown",
        reason: "Node not found",
      };
    }

    if (node.status !== "ready") {
      return {
        healthy: false,
        status: node.status,
        reason: `Node status is ${node.status}`,
      };
    }

    if (node.availability !== "active") {
      return {
        healthy: false,
        status: node.availability,
        reason: `Node availability is ${node.availability}`,
      };
    }

    return {
      healthy: true,
      status: "ready",
    };
  }

  /**
   * Map Docker node state to our status enum
   */
  private mapNodeStatus(
    state: string | undefined
  ): "ready" | "down" | "unknown" {
    if (!state) return "unknown";

    const lowerState = state.toLowerCase();
    if (lowerState === "ready") return "ready";
    if (lowerState === "down") return "down";
    return "unknown";
  }

  /**
   * Determine node health based on status and resource usage
   */
  private determineNodeHealth(
    status: "ready" | "down" | "unknown",
    cpuUsagePercent: number,
    memoryUsagePercent: number
  ): "healthy" | "unhealthy" | "unknown" {
    if (status === "down") return "unhealthy";
    if (status === "unknown") return "unknown";

    // Node is unhealthy if CPU or memory usage is above 95%
    if (cpuUsagePercent > 95 || memoryUsagePercent > 95) {
      return "unhealthy";
    }

    return "healthy";
  }
}
