import * as si from "systeminformation";
import { ContainerService } from "./containerService";

export interface SystemResources {
  cpu: {
    usage: number; // Percentage
    available: number; // Cores
  };
  memory: {
    total: number; // Bytes
    used: number; // Bytes
    available: number; // Bytes
    usagePercent: number;
  };
  disk: {
    total: number; // Bytes
    used: number; // Bytes
    available: number; // Bytes
    usagePercent: number;
  };
  containers: {
    running: number;
    total: number;
  };
}

export interface ResourceThresholds {
  memoryPercent: number; // Default: 90
  cpuPercent: number; // Default: 90
}

export class ResourceMonitor {
  private containerService: ContainerService;
  private thresholds: ResourceThresholds;

  constructor(
    containerService: ContainerService,
    thresholds: ResourceThresholds = { memoryPercent: 90, cpuPercent: 90 }
  ) {
    this.containerService = containerService;
    this.thresholds = thresholds;
  }

  /**
   * Get current system-wide resource usage
   */
  async getSystemResources(): Promise<SystemResources> {
    // Get CPU information
    const cpuLoad = await si.currentLoad();
    const cpuInfo = await si.cpu();

    // Get memory information
    const memInfo = await si.mem();

    // Get disk information (root filesystem)
    const diskInfo = await si.fsSize();
    const rootDisk = diskInfo.find((disk) => disk.mount === "/") || diskInfo[0];

    // Get container count
    const containers = await this.containerService.listContainers();
    const runningContainers = containers.filter(
      (c) => c.status === "running"
    ).length;

    return {
      cpu: {
        usage: cpuLoad.currentLoad,
        available: cpuInfo.cores,
      },
      memory: {
        total: memInfo.total,
        used: memInfo.total - memInfo.available, // Actual used memory (excluding cache/buffers)
        available: memInfo.available,
        usagePercent: ((memInfo.total - memInfo.available) / memInfo.total) * 100,
      },
      disk: {
        total: rootDisk.size,
        used: rootDisk.used,
        available: rootDisk.available,
        usagePercent: rootDisk.use,
      },
      containers: {
        running: runningContainers,
        total: containers.length,
      },
    };
  }

  /**
   * Check if system has enough resources to start a new container
   * Enforces 90% memory threshold and logs warning for 90% CPU usage
   */
  async canStartContainer(): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const resources = await this.getSystemResources();

    // Enforce memory threshold
    if (resources.memory.usagePercent >= this.thresholds.memoryPercent) {
      return {
        allowed: false,
        reason: `Memory usage at ${resources.memory.usagePercent.toFixed(
          1
        )}% exceeds threshold of ${this.thresholds.memoryPercent}%`,
      };
    }

    // Log warning for high CPU usage but don't block
    if (resources.cpu.usage >= this.thresholds.cpuPercent) {
      console.warn(
        `[ResourceMonitor] WARNING: CPU usage at ${resources.cpu.usage.toFixed(
          1
        )}% exceeds threshold of ${this.thresholds.cpuPercent}%`
      );
    }

    return { allowed: true };
  }

  /**
   * Get current resource thresholds
   */
  getThresholds(): ResourceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update resource thresholds
   */
  setThresholds(thresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}
