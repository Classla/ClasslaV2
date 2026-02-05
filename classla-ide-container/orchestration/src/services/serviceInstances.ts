/**
 * Shared service instances
 *
 * This module provides singleton instances of services that need to be shared
 * across the application (routes, server, etc.)
 */

import { ContainerService } from "./containerService";
import { StateManager } from "./stateManager";
import { ResourceMonitor } from "./resourceMonitor";
import { HealthMonitor } from "./healthMonitor";
import { NodeMonitor } from "./nodeMonitor";
import { S3ValidationService } from "./s3ValidationService";
import { ContainerStatsService } from "./containerStatsService";
import { QueueManager } from "./queueManager";
import { QueueMaintainer } from "./queueMaintainer";
import { ContainerCleanupService } from "./containerCleanupService";
import { DiscordAlertService } from "./discordAlertService";
import { LoadTestService } from "./loadTestService";
import { config } from "../config/index";
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
export const discordAlertService = new DiscordAlertService(
  resourceMonitor,
  containerService
);
export const loadTestService = new LoadTestService(
  containerService,
  stateManager,
  healthMonitor,
  resourceMonitor
);

// Initialize existing container IDs on startup
containerService.initializeExistingIds().catch((error) => {
  console.error("Failed to initialize existing container IDs:", error);
});
