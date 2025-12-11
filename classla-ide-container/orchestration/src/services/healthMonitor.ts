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
  private readonly CHECK_INTERVAL_MS = 5000; // 5 seconds - optimized for faster startup detection
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly REQUEST_TIMEOUT_MS = 3000; // 3 seconds - reduced timeout for faster checks
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

    console.log(`Starting health monitor (check interval: ${this.CHECK_INTERVAL_MS}ms)...`);
    this.checkInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        console.error("Error during health checks:", error);
      });
    }, this.CHECK_INTERVAL_MS);

    // Perform initial check immediately for faster detection
    this.performHealthChecks().catch((error) => {
      console.error("Error during initial health check:", error);
    });
    
    // Also perform a quick check after 2 seconds for newly created containers
    setTimeout(() => {
      this.performHealthChecks().catch((error) => {
        console.error("Error during quick health check:", error);
      });
    }, 2000);
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
    // Get all running and starting containers from state manager
    // We check "starting" containers too because they might be ready but status hasn't updated yet
    const runningContainers = this.stateManager.listContainers({
      status: "running",
    });
    const startingContainers = this.stateManager.listContainers({
      status: "starting",
    });
    const containers = [...runningContainers, ...startingContainers];

    console.log(
      `[HealthMonitor] Performing health checks on ${containers.length} container(s) (${runningContainers.length} running, ${startingContainers.length} starting)`
    );

    for (const container of containers) {
      try {
        await this.checkContainerHealth(container.id, container.urls);
      } catch (error) {
        console.error(
          `[HealthMonitor] Error checking health for container ${container.id}:`,
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
    console.log(
      `[HealthMonitor] Checking health for container ${containerId}, codeServer URL: ${urls.codeServer}`
    );
    
    const checks = {
      codeServer: await this.checkServiceReachability(urls.codeServer),
      vnc: await this.checkServiceReachability(urls.vnc),
      webServer: await this.checkServiceReachability(urls.webServer),
    };

    console.log(
      `[HealthMonitor] Container ${containerId} health checks: codeServer=${checks.codeServer}, vnc=${checks.vnc}, webServer=${checks.webServer}`
    );

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

    // Record code-server availability on first successful check (independent of other services)
    if (
      checks.codeServer &&
      !this.codeServerAvailableTracked.has(containerId)
    ) {
      console.log(
        `[HealthMonitor] ✅ Code-server is reachable for container ${containerId}, recording availability...`
      );
      this.codeServerAvailableTracked.add(containerId);
      try {
        await this.containerStatsService.recordCodeServerAvailable(containerId);
        console.log(
          `[HealthMonitor] ✅ Successfully recorded code-server availability for container ${containerId}`
        );
      } catch (error) {
        console.error(
          `[HealthMonitor] ❌ Failed to record code-server availability for container ${containerId}:`,
          error
        );
        // Re-remove from tracked set so we can retry
        this.codeServerAvailableTracked.delete(containerId);
      }
    } else if (!checks.codeServer) {
      console.log(
        `[HealthMonitor] ⏳ Code-server not yet reachable for container ${containerId} (URL: ${urls.codeServer})`
      );
    } else if (this.codeServerAvailableTracked.has(containerId)) {
      console.log(
        `[HealthMonitor] ℹ️ Code-server availability already recorded for container ${containerId}`
      );
    }

    if (allHealthy) {
      // Update container status to "running" if it was "starting"
      const container = this.stateManager.getContainer(containerId);
      if (container && container.status === "starting") {
        console.log(
          `[HealthMonitor] Container ${containerId} is healthy, updating status from "starting" to "running"`
        );
        this.stateManager.updateContainerLifecycle(containerId, {
          status: "running",
        });
      }

      // Reset failure count on success
      if (healthState.consecutiveFailures > 0) {
        console.log(
          `[HealthMonitor] Container ${containerId} recovered (was unhealthy for ${healthState.consecutiveFailures} checks)`
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
      // Accept 200, 302 (redirect), 404 (service exists but route not found), etc. as "reachable"
      // Only 5xx errors indicate the service is not available
      const isReachable = response.status < 500;
      if (!isReachable) {
        console.log(
          `[HealthMonitor] Service at ${url} returned status ${response.status} (not reachable)`
        );
      } else {
        console.log(
          `[HealthMonitor] Service at ${url} is reachable (status: ${response.status})`
        );
      }
      return isReachable;
    } catch (error) {
      // Network errors, timeouts, etc. indicate service is not reachable
      if (axios.isAxiosError(error)) {
        const errorMsg = error.code === 'ECONNREFUSED' 
          ? 'Connection refused' 
          : error.code === 'ETIMEDOUT' 
          ? 'Timeout' 
          : error.message;
        console.log(
          `[HealthMonitor] Service at ${url} is not reachable: ${errorMsg}`
        );
      } else {
        console.log(
          `[HealthMonitor] Service at ${url} check failed: ${error}`
        );
      }
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
