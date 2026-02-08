import axios from "axios";
import https from "https";
import { ContainerService } from "./containerService";
import { StateManager } from "./stateManager";
import { ContainerStatsService } from "./containerStatsService";
import { config } from "../config/index";

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
  consecutiveSuccesses: number; // Track consecutive successful checks for starting containers
  firstSuccessAt?: Date; // Track when we first got a successful check
  lastCheck: Date;
  restartAttempted: boolean;
  firstUnhealthyAt?: Date; // Track when container first became unhealthy
  shutdownAttempted: boolean; // Track if we've attempted to shut down this container
}

export class HealthMonitor {
  private containerService: ContainerService;
  private stateManager: StateManager;
  private containerStatsService: ContainerStatsService;
  private healthStates: Map<string, ContainerHealthState>;
  private checkInterval: NodeJS.Timeout | null;
  private startingContainerIntervals: Map<string, NodeJS.Timeout> = new Map(); // Aggressive polling for starting containers
  private readonly CHECK_INTERVAL_MS = 5000; // 5 seconds - normal check interval for running containers
  private readonly STARTING_CHECK_INTERVAL_MS = 1000; // 1 second - aggressive polling for starting containers
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly REQUEST_TIMEOUT_MS = 3000; // 3 seconds - reduced timeout for faster checks
  private readonly STARTING_REQUEST_TIMEOUT_MS = 1000; // 1 second - very fast timeout for starting containers
  private readonly MAX_UNHEALTHY_DURATION_MS = 5 * 60 * 1000; // 5 minutes - shut down containers that stay unhealthy
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
    }
    
    // Stop all aggressive polling
    for (const [containerId] of this.startingContainerIntervals) {
      this.stopAggressivePolling(containerId);
    }
    
    console.log("Health monitor stopped");
  }

  /**
   * Perform health checks on all running containers
   * Note: Starting containers are checked via aggressive polling, not here
   */
  private async performHealthChecks(): Promise<void> {
    // Only check running containers in the normal interval
    // Starting containers have their own aggressive polling
    const runningContainers = this.stateManager.listContainers({
      status: "running",
    });

    if (runningContainers.length === 0) {
      return; // No running containers to check
    }

    for (const container of runningContainers) {
      try {
        await this.checkContainerHealth(container.id, container.urls, false);
      } catch (error) {
        console.error(
          `[HealthMonitor] Error checking health for container ${container.id}:`,
          error
        );
      }
    }
  }

  /**
   * Check a container immediately (for newly created containers)
   * This uses aggressive settings for fastest detection
   */
  async checkContainerImmediately(containerId: string): Promise<boolean> {
    const container = this.stateManager.getContainer(containerId);
    if (!container) {
      console.warn(`[HealthMonitor] Container ${containerId} not found in state manager`);
      return false;
    }

    console.log(`[HealthMonitor] Immediate health check for container ${containerId}`);
    
    // Start aggressive polling for this starting container
    this.startAggressivePolling(containerId, container.urls);
    
    // Also do an immediate check
    try {
      await this.checkContainerHealth(containerId, container.urls, true);
      const healthState = this.healthStates.get(containerId);
      return healthState ? healthState.consecutiveFailures === 0 : false;
    } catch (error) {
      console.error(`[HealthMonitor] Error in immediate check for ${containerId}:`, error);
      return false;
    }
  }

  /**
   * Start aggressive polling for a starting container
   */
  private startAggressivePolling(
    containerId: string,
    urls: { vnc: string; codeServer: string; webServer: string }
  ): void {
    // Stop any existing polling for this container
    this.stopAggressivePolling(containerId);

    console.log(`[HealthMonitor] Starting aggressive polling for container ${containerId} (${this.STARTING_CHECK_INTERVAL_MS}ms interval)`);
    
    let attempts = 0;
    const maxAttempts = 60; // Stop after 60 seconds of aggressive polling
    
    const interval = setInterval(async () => {
      attempts++;
      
      const container = this.stateManager.getContainer(containerId);
      if (!container || container.status !== "starting") {
        // Container is no longer starting, stop aggressive polling
        this.stopAggressivePolling(containerId);
        return;
      }

      if (attempts >= maxAttempts) {
        console.warn(`[HealthMonitor] Stopping aggressive polling for ${containerId} after ${maxAttempts} attempts`);
        this.stopAggressivePolling(containerId);
        return;
      }

      try {
        await this.checkContainerHealth(containerId, urls, true);
        
        // If container became healthy, stop aggressive polling
        const updatedContainer = this.stateManager.getContainer(containerId);
        if (updatedContainer && updatedContainer.status === "running") {
          console.log(`[HealthMonitor] Container ${containerId} is now running, stopping aggressive polling`);
          this.stopAggressivePolling(containerId);
        }
      } catch (error) {
        console.error(`[HealthMonitor] Error in aggressive polling for ${containerId}:`, error);
      }
    }, this.STARTING_CHECK_INTERVAL_MS);

    this.startingContainerIntervals.set(containerId, interval);
  }

  /**
   * Stop aggressive polling for a container
   */
  private stopAggressivePolling(containerId: string): void {
    const interval = this.startingContainerIntervals.get(containerId);
    if (interval) {
      clearInterval(interval);
      this.startingContainerIntervals.delete(containerId);
      console.log(`[HealthMonitor] Stopped aggressive polling for container ${containerId}`);
    }
  }

  /**
   * Check health of a specific container
   */
  private async checkContainerHealth(
    containerId: string,
    urls: { vnc: string; codeServer: string; webServer: string },
    isStarting: boolean = false
  ): Promise<void> {
    const timeout = isStarting ? this.STARTING_REQUEST_TIMEOUT_MS : this.REQUEST_TIMEOUT_MS;
    
    // For starting containers, prioritize code-server (most critical)
    // Check code-server first and in parallel with others
    const codeServerCheck = this.checkServiceReachability(urls.codeServer, true, timeout);
    
    // For starting containers, we can be more lenient with VNC and web server
    // They can start a bit later, but code-server is critical
    const otherChecks = isStarting 
      ? Promise.all([
          this.checkServiceReachability(urls.vnc, false, timeout).catch(() => false),
          this.checkServiceReachability(urls.webServer, false, timeout).catch(() => false),
        ])
      : Promise.all([
          this.checkServiceReachability(urls.vnc, false, timeout),
          this.checkServiceReachability(urls.webServer, false, timeout),
        ]);
    
    const [codeServer, [vnc, webServer]] = await Promise.all([codeServerCheck, otherChecks]);
    
    const checks = {
      codeServer,
      vnc,
      webServer,
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
        consecutiveSuccesses: 0,
        firstSuccessAt: undefined,
        lastCheck: new Date(),
        restartAttempted: false,
        shutdownAttempted: false,
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

    // For starting containers, code-server being ready is enough to mark as running
    // VNC and web server can start later
    // BUT: Require multiple consecutive successful checks to avoid false positives
    const isReady = isStarting 
      ? checks.codeServer  // Only code-server required for starting containers
      : allHealthy;         // All services required for running containers

    if (isReady) {
      // For starting containers, require 4 consecutive successful checks AND minimum 5 seconds wait
      // This prevents false positives when Traefik routing isn't fully active yet
      if (isStarting) {
        if (!healthState.consecutiveSuccesses) {
          healthState.consecutiveSuccesses = 0;
        }
        if (!healthState.firstSuccessAt) {
          healthState.firstSuccessAt = new Date();
        }
        healthState.consecutiveSuccesses++;
        
        const timeSinceFirstSuccess = Date.now() - healthState.firstSuccessAt.getTime();
        const minWaitTime = 5000; // 5 seconds minimum wait
        const requiredChecks = 4; // 4 consecutive successful checks
        
        // Require both: 4 consecutive checks AND minimum 5 seconds wait
        if (healthState.consecutiveSuccesses < requiredChecks || timeSinceFirstSuccess < minWaitTime) {
          console.log(
            `[HealthMonitor] ⏳ Container ${containerId} code-server accessible (${healthState.consecutiveSuccesses}/${requiredChecks} checks, ${Math.round(timeSinceFirstSuccess / 1000)}s/${minWaitTime / 1000}s wait), waiting for confirmation...`
          );
          return; // Don't mark as running yet
        }
      }
      
      // Update container status to "running" if it was "starting"
      const container = this.stateManager.getContainer(containerId);
      if (container && container.status === "starting") {
        console.log(
          `[HealthMonitor] ✅ Container ${containerId} is ready (code-server: ${checks.codeServer}, vnc: ${checks.vnc}, web: ${checks.webServer}), updating status from "starting" to "running"`
        );
        this.stateManager.updateContainerLifecycle(containerId, {
          status: "running",
        });
        // Stop aggressive polling since container is now running
        this.stopAggressivePolling(containerId);
      }

      // Reset failure count on success
      if (healthState.consecutiveFailures > 0) {
        console.log(
          `[HealthMonitor] Container ${containerId} recovered (was unhealthy for ${healthState.consecutiveFailures} checks)`
        );
      }
      healthState.consecutiveFailures = 0;
      healthState.restartAttempted = false;
      healthState.firstUnhealthyAt = undefined; // Reset unhealthy timestamp
      
      // Reset consecutive successes if container is already running (not starting)
      if (!isStarting) {
        healthState.consecutiveSuccesses = 0;
        healthState.firstSuccessAt = undefined;
      }
    } else {
      // Increment failure count
      healthState.consecutiveFailures++;
      // Reset consecutive successes on failure
      healthState.consecutiveSuccesses = 0;
      healthState.firstSuccessAt = undefined;
      
      // Track when container first became unhealthy
      if (!healthState.firstUnhealthyAt && healthState.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        healthState.firstUnhealthyAt = new Date();
        console.warn(
          `[HealthMonitor] Container ${containerId} first marked as unhealthy at ${healthState.firstUnhealthyAt.toISOString()}`
        );
      }
      
      console.warn(
        `[HealthMonitor] Container ${containerId} health check failed (${healthState.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`,
        { checks }
      );

      // Check if container should be marked unhealthy
      if (
        healthState.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES &&
        !healthState.restartAttempted
      ) {
        console.error(
          `[HealthMonitor] Container ${containerId} marked as unhealthy after ${this.MAX_CONSECUTIVE_FAILURES} consecutive failures`
        );

        // Attempt recovery
        await this.attemptRecovery(containerId, healthState);
      }

      // Check if container has been unhealthy for too long and should be shut down
      if (
        healthState.firstUnhealthyAt &&
        !healthState.shutdownAttempted &&
        healthState.restartAttempted
      ) {
        const unhealthyDuration = Date.now() - healthState.firstUnhealthyAt.getTime();
        if (unhealthyDuration >= this.MAX_UNHEALTHY_DURATION_MS) {
          console.error(
            `[HealthMonitor] Container ${containerId} has been unhealthy for ${Math.round(unhealthyDuration / 1000)}s (max: ${this.MAX_UNHEALTHY_DURATION_MS / 1000}s). Shutting down...`
          );
          await this.shutdownUnhealthyContainer(containerId, healthState);
        }
      }
    }
  }

  /**
   * Check if a service URL is reachable
   * For code-server, we check the actual root path through Traefik to ensure routing works
   * For other services, we check the main URL
   */
  private async checkServiceReachability(
    url: string, 
    isCodeServer: boolean = false,
    timeout: number = this.REQUEST_TIMEOUT_MS
  ): Promise<boolean> {
    // For code-server, check the actual root path (not /healthz) to verify Traefik routing works
    // This ensures the container is truly accessible, not just that code-server is running internally
    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    // Use root path to verify Traefik routing - accept 200, 302 (redirect), or 401 (auth required)
    // 404 means routing isn't working yet
    const checkUrl = isCodeServer ? `${baseUrl}/` : url;
    
    // For code-server, always use HTTPS for domain-based URLs (not localhost/IP)
    // This avoids redirect issues and ensures we check the correct endpoint
    // IMPORTANT: For localhost URLs, if we're running in Docker (management-api container),
    // we need to use the Traefik service name instead of localhost
    let finalUrl = checkUrl; // Declare at function scope for use in catch block
    if (isCodeServer) {
      // If URL contains localhost, we're checking from within Docker network
      // Replace localhost with Traefik service name for internal Docker network access
      if (checkUrl.includes('localhost')) {
        // Use Traefik service name: ide-local_traefik (from docker-compose stack name + service name)
        // Port 80 is the internal port Traefik listens on
        finalUrl = checkUrl.replace('http://localhost', 'http://ide-local_traefik:80');
      } else if (checkUrl.startsWith('http://') && !checkUrl.match(/http:\/\/\d+\.\d+\.\d+\.\d+/)) {
        // Domain-based URL - use HTTPS
        finalUrl = checkUrl.replace('http://', 'https://');
      } else if (checkUrl.match(/http:\/\/\d+\.\d+\.\d+\.\d+/)) {
        // IP address - convert to domain if we have one, otherwise use HTTPS
        // For ide.classla.org, always use HTTPS with domain
        finalUrl = checkUrl.replace(/http:\/\/\d+\.\d+\.\d+\.\d+/, 'https://ide.classla.org');
      }
    }
    
    try {
      // In local mode, disable SSL certificate validation to handle self-signed certs
      const axiosConfig: any = {
        timeout,
        validateStatus: () => true, // Accept all status codes so we can check them
        maxRedirects: 5, // Follow redirects (HTTP to HTTPS, etc.)
      };
      
      // For local development, disable SSL verification if using HTTPS or localhost
      if (config.nodeEnv === "local" || finalUrl.includes("localhost") || finalUrl.includes("ide-local_traefik")) {
        axiosConfig.httpsAgent = new https.Agent({
          rejectUnauthorized: false,
        });
      }
      
      const response = await axios.get(finalUrl, axiosConfig);
      
      // For code-server root path, accept 200 (OK), 302 (redirect), or 401 (auth required)
      // 404 means Traefik routing isn't working yet - container not ready
      if (isCodeServer) {
        const isHealthy = response.status === 200 || response.status === 302 || response.status === 401;
        // Always log the check result for debugging
        if (isHealthy) {
          console.log(
            `[HealthMonitor] ✅ Code-server route at ${finalUrl} is accessible (status: ${response.status})`
          );
        } else {
          // Log 404 specifically as it means routing isn't ready
          if (response.status === 404) {
            console.log(
              `[HealthMonitor] ⏳ Code-server route at ${finalUrl} not ready yet (404 - Traefik routing not active)`
            );
          } else if (response.status !== 301) {
            // Don't log 301 as it's just a redirect
            console.warn(
              `[HealthMonitor] Code-server route at ${finalUrl} returned status ${response.status} (unhealthy - expected 200, 302, or 401)`
            );
          }
        }
        return isHealthy;
      }
      
      // For other services (VNC, web server), accept 200-499
      // 5xx errors indicate service is not available
      const isReachable = response.status >= 200 && response.status < 500;
      if (!isReachable) {
        console.warn(
          `[HealthMonitor] Service at ${url} returned status ${response.status} (not reachable - expected 200-499)`
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
        // Log the error for debugging
        console.warn(
          `[HealthMonitor] Error checking ${isCodeServer ? 'code-server' : 'service'} at ${finalUrl}: ${error.message}${error.code ? ` (${error.code})` : ''}`
        );
        // Check if we got a response with a status code (e.g., 502 Bad Gateway)
        if (error.response) {
          const status = error.response.status;
          if (isCodeServer) {
            // For code-server root path, 404 means routing isn't ready yet
            // Only 200, 302, or 401 means it's accessible
            if (status === 404) {
              console.log(
                `[HealthMonitor] ⏳ Code-server route at ${finalUrl || url} not ready yet (404 - Traefik routing not active)`
              );
            }
            return false;
          } else {
            // For other services, only 5xx is unhealthy
            const isReachable = status < 500;
            if (!isReachable) {
              console.warn(
                `[HealthMonitor] Service at ${url} returned status ${status} (not reachable)`
              );
            }
            return isReachable;
          }
        }
        
        // Log network errors (no response received)
        const errorMsg = error.code === 'ECONNREFUSED' 
          ? 'Connection refused' 
          : error.code === 'ETIMEDOUT' 
          ? 'Timeout' 
          : error.message;
        console.warn(
          `[HealthMonitor] Error checking ${isCodeServer ? 'code-server' : 'service'} at ${finalUrl || url}: ${errorMsg}${error.code ? ` (${error.code})` : ''}`
        );
      } else {
        console.warn(
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
    console.log(`[HealthMonitor] Attempting to recover container ${containerId}...`);

    try {
      // Mark that we've attempted restart
      healthState.restartAttempted = true;

      // Get the container info
      const container = await this.containerService.getContainer(containerId);
      if (!container) {
        console.error(
          `[HealthMonitor] Cannot recover container ${containerId}: not found in Docker`
        );
        return;
      }

      // Update state manager with unhealthy status
      this.stateManager.updateContainerLifecycle(containerId, {
        status: "failed",
      });

      // Log the failure
      console.error(
        `[HealthMonitor] Container ${containerId} marked as failed. Docker Swarm will attempt restart based on restart policy.`
      );

      // Note: In Docker Swarm, the service will automatically attempt to restart
      // based on the restart policy. We don't need to manually restart it.
      // The restart policy is set to "on-failure" with max 3 attempts in containerService.ts
    } catch (error) {
      console.error(`[HealthMonitor] Failed to recover container ${containerId}:`, error);
    }
  }

  /**
   * Shut down a container that has been unhealthy for too long
   */
  private async shutdownUnhealthyContainer(
    containerId: string,
    healthState: ContainerHealthState
  ): Promise<void> {
    if (healthState.shutdownAttempted) {
      return; // Already attempted shutdown
    }

    healthState.shutdownAttempted = true;
    console.error(
      `[HealthMonitor] Shutting down container ${containerId} due to prolonged unhealthy state`
    );

    try {
      // Stop the container service
      await this.containerService.stopContainer(containerId);

      // Update state manager
      this.stateManager.updateContainerLifecycle(containerId, {
        status: "stopped",
        stoppedAt: new Date(),
        shutdownReason: "error",
      });

      // Record container stopped in stats service
      await this.containerStatsService.recordContainerStopped(containerId, "error");

      // Remove health monitoring state
      this.removeContainerHealth(containerId);

      console.log(
        `[HealthMonitor] Successfully shut down unhealthy container ${containerId}`
      );
    } catch (error) {
      console.error(
        `[HealthMonitor] Failed to shut down unhealthy container ${containerId}:`,
        error
      );
      // Reset flag so we can retry
      healthState.shutdownAttempted = false;
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
    this.stopAggressivePolling(containerId);
  }
}
