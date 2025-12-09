import axios from "axios";
import { ContainerService } from "./containerService.js";
import { StateManager } from "./stateManager.js";
import { ContainerStatsService } from "./containerStatsService.js";

export interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "starting";
  lastCheck: Date;
  checks: {
    codeServer: boolean;
    vnc: boolean;
    webServer: boolean;
  };
  consecutiveFailures: number;
}

interface ContainerHealthState {
  containerId: string;
  consecutiveFailures: number;
  lastCheck: Date;
  restartAttempted: boolean;
}

export class HealthMonitor {
  private containerService: ContainerService;
  private stateManager: StateManager;
  private containerStatsService: ContainerStatsService;
  private healthStates: Map<string, ContainerHealthState>;
  private checkInterval: NodeJS.Timeout | null;
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly REQUEST_TIMEOUT_MS = 5000; // 5 seconds
  private codeServerAvailableTracked: Set<string> = new Set(); // Track which containers have had code-server availability recorded

  constructor(
    containerService: ContainerService,
    stateManager: StateManager,
    containerStatsService?: ContainerStatsService
  ) {
    this.containerService = containerService;
    this.stateManager = stateManager;
    this.containerStatsService = containerStatsService || new ContainerStatsService();
    this.healthStates = new Map();
    this.checkInterval = null;
  }

  /**
   * Start the health monitoring system
   */
  start(): void {
    if (this.checkInterval) {
      console.log("Health monitor already running");
      return;
    }

    console.log("Starting health monitor...");
    this.checkInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        console.error("Error during health checks:", error);
      });
    }, this.CHECK_INTERVAL_MS);

    // Perform initial check immediately
    this.performHealthChecks().catch((error) => {
      console.error("Error during initial health check:", error);
    });
  }

  /**
   * Stop the health monitoring system
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log("Health monitor stopped");
    }
  }

  /**
   * Perform health checks on all running containers
   */
  private async performHealthChecks(): Promise<void> {
    // Get all running containers from state manager
    const containers = this.stateManager.listContainers({
      status: "running",
    });

    for (const container of containers) {
      try {
        await this.checkContainerHealth(container.id, container.urls);
      } catch (error) {
        console.error(
          `Error checking health for container ${container.id}:`,
          error
        );
      }
    }
  }

  /**
   * Check health of a specific container
   */
  private async checkContainerHealth(
    containerId: string,
    urls: { vnc: string; codeServer: string; webServer: string }
  ): Promise<void> {
    const checks = {
      codeServer: await this.checkServiceReachability(urls.codeServer),
      vnc: await this.checkServiceReachability(urls.vnc),
      webServer: await this.checkServiceReachability(urls.webServer),
    };

    const allHealthy = checks.codeServer && checks.vnc && checks.webServer;

    // Get or create health state
    let healthState = this.healthStates.get(containerId);
    if (!healthState) {
      healthState = {
        containerId,
        consecutiveFailures: 0,
        lastCheck: new Date(),
        restartAttempted: false,
      };
      this.healthStates.set(containerId, healthState);
    }

    // Update health state
    healthState.lastCheck = new Date();

    if (allHealthy) {
      // Record code-server availability on first successful check
      if (
        checks.codeServer &&
        !this.codeServerAvailableTracked.has(containerId)
      ) {
        this.codeServerAvailableTracked.add(containerId);
        await this.containerStatsService.recordCodeServerAvailable(containerId);
      }

      // Reset failure count on success
      if (healthState.consecutiveFailures > 0) {
        console.log(
          `Container ${containerId} recovered (was unhealthy for ${healthState.consecutiveFailures} checks)`
        );
      }
      healthState.consecutiveFailures = 0;
      healthState.restartAttempted = false;
    } else {
      // Increment failure count
      healthState.consecutiveFailures++;
      console.warn(
        `Container ${containerId} health check failed (${healthState.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`,
        { checks }
      );

      // Check if container should be marked unhealthy
      if (
        healthState.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES &&
        !healthState.restartAttempted
      ) {
        console.error(
          `Container ${containerId} marked as unhealthy after ${this.MAX_CONSECUTIVE_FAILURES} consecutive failures`
        );

        // Attempt recovery
        await this.attemptRecovery(containerId, healthState);
      }
    }
  }

  /**
   * Check if a service URL is reachable
   */
  private async checkServiceReachability(url: string): Promise<boolean> {
    try {
      const response = await axios.get(url, {
        timeout: this.REQUEST_TIMEOUT_MS,
        validateStatus: (status) => status < 500, // Accept any status < 500 as "reachable"
        maxRedirects: 0, // Don't follow redirects
      });
      return response.status < 500;
    } catch (error) {
      // Network errors, timeouts, etc.
      return false;
    }
  }

  /**
   * Attempt to recover an unhealthy container
   */
  private async attemptRecovery(
    containerId: string,
    healthState: ContainerHealthState
  ): Promise<void> {
    console.log(`Attempting to recover container ${containerId}...`);

    try {
      // Mark that we've attempted restart
      healthState.restartAttempted = true;

      // Get the container info
      const container = await this.containerService.getContainer(containerId);
      if (!container) {
        console.error(
          `Cannot recover container ${containerId}: not found in Docker`
        );
        return;
      }

      // Update state manager with unhealthy status
      this.stateManager.updateContainerLifecycle(containerId, {
        status: "failed",
      });

      // Log the failure
      console.error(
        `Container ${containerId} restart attempted but manual intervention may be required`
      );

      // Note: In Docker Swarm, the service will automatically attempt to restart
      // based on the restart policy. We don't need to manually restart it.
      // The restart policy is set to "on-failure" with max 3 attempts in containerService.ts
    } catch (error) {
      console.error(`Failed to recover container ${containerId}:`, error);
    }
  }

  /**
   * Get health status for a specific container
   */
  getContainerHealth(containerId: string): HealthCheckResult | null {
    const healthState = this.healthStates.get(containerId);
    if (!healthState) {
      return null;
    }

    const container = this.stateManager.getContainer(containerId);
    if (!container) {
      return null;
    }

    // Determine overall status
    let status: "healthy" | "unhealthy" | "starting";
    if (container.status === "starting") {
      status = "starting";
    } else if (
      healthState.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES
    ) {
      status = "unhealthy";
    } else {
      status = "healthy";
    }

    return {
      status,
      lastCheck: healthState.lastCheck,
      checks: {
        codeServer: healthState.consecutiveFailures === 0,
        vnc: healthState.consecutiveFailures === 0,
        webServer: healthState.consecutiveFailures === 0,
      },
      consecutiveFailures: healthState.consecutiveFailures,
    };
  }

  /**
   * Remove health state for a stopped container
   */
  removeContainerHealth(containerId: string): void {
    this.healthStates.delete(containerId);
    this.codeServerAvailableTracked.delete(containerId);
  }
}
