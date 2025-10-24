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
export const healthMonitor = new HealthMonitor(containerService, stateManager);
export const nodeMonitor = new NodeMonitor(docker);
export const s3ValidationService = new S3ValidationService();

// Initialize existing container IDs on startup
containerService.initializeExistingIds().catch((error) => {
  console.error("Failed to initialize existing container IDs:", error);
});
