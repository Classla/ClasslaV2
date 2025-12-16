/**
 * Shared service instances
 *
 * This module provides singleton instances of services that need to be shared
 * across the application (routes, server, etc.)
 */

import { ContainerService } from "./containerService.js";
import { StateManager } from "./stateManager.js";
import { ResourceMonitor } from "./resourceMonitor.js";
import { HealthMonitor } from "./healthMonitor.js";
import { NodeMonitor } from "./nodeMonitor.js";
import { S3ValidationService } from "./s3ValidationService.js";
import { ContainerStatsService } from "./containerStatsService.js";
import { QueueManager } from "./queueManager.js";
import { QueueMaintainer } from "./queueMaintainer.js";
import { ContainerCleanupService } from "./containerCleanupService.js";
import { config } from "../config/index.js";
import Docker from "dockerode";

// Create singleton instances
const docker = new Docker({ socketPath: config.dockerSocket });
export const containerService = new ContainerService();
export const stateManager = new StateManager();
export const resourceMonitor = new ResourceMonitor(containerService, {
  memoryPercent: config.maxMemoryPercent,
  cpuPercent: config.maxCpuPercent,
});
export const containerStatsService = new ContainerStatsService();
export const healthMonitor = new HealthMonitor(
  containerService,
  stateManager,
  containerStatsService
);
export const nodeMonitor = new NodeMonitor(docker);
export const s3ValidationService = new S3ValidationService();
export const queueManager = new QueueManager();
export const queueMaintainer = new QueueMaintainer(
  queueManager,
  containerService,
  stateManager,
  resourceMonitor,
  healthMonitor
);
export const containerCleanupService = new ContainerCleanupService(
  containerService,
  stateManager
);

// Initialize existing container IDs on startup
containerService.initializeExistingIds().catch((error: unknown) => {
  console.error("Failed to initialize existing container IDs:", error);
});
