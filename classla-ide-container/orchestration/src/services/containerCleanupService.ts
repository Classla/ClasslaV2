import { ContainerService } from "./containerService";
import { StateManager } from "./stateManager";

/**
 * ContainerCleanupService - Periodically cleans up stopped containers
 * 
 * This service:
 * - Checks for containers marked as "stopped" in the database
 * - Removes their Docker Swarm services if they still exist
 * - Ensures stopped containers are fully cleaned up
 */
export class ContainerCleanupService {
  private containerService: ContainerService;
  private stateManager: StateManager;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private cleanupIntervalMs: number = 60000; // Check every 60 seconds

  constructor(containerService: ContainerService, stateManager: StateManager) {
    this.containerService = containerService;
    this.stateManager = stateManager;
  }

  /**
   * Start the cleanup service
   */
  start(): void {
    if (this.isRunning) {
      console.warn("[ContainerCleanup] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[ContainerCleanup] Starting container cleanup service...");

    // Reconcile state manager with actual Docker services on startup
    // This catches ghost containers left behind when kill.sh removes Docker services
    // but the SQLite DB (in a Docker volume) persists
    this.reconcileWithDocker().catch((error) => {
      console.error("[ContainerCleanup] Error in startup reconciliation:", error);
    });

    // Do initial cleanup immediately
    this.cleanupStoppedContainers().catch((error) => {
      console.error("[ContainerCleanup] Error in initial cleanup:", error);
    });

    // Then cleanup periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanupStoppedContainers().catch((error) => {
        console.error("[ContainerCleanup] Error in periodic cleanup:", error);
      });
    }, this.cleanupIntervalMs);
  }

  /**
   * Stop the cleanup service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.log("[ContainerCleanup] Stopped");
  }

  /**
   * Clean up stopped containers by removing their Docker services
   */
  private async cleanupStoppedContainers(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Get all containers marked as stopped
      const stoppedContainers = this.stateManager.listContainers({
        status: "stopped",
      });

      if (stoppedContainers.length === 0) {
        return; // No stopped containers to clean up
      }

      console.log(
        `[ContainerCleanup] Found ${stoppedContainers.length} stopped container(s) to clean up`
      );

      let cleanedCount = 0;
      let errorCount = 0;

      for (const container of stoppedContainers) {
        try {
          // Try to stop/remove the Docker service
          await this.containerService.stopContainer(container.id);
          cleanedCount++;
          console.log(
            `[ContainerCleanup] Successfully removed Docker service for stopped container ${container.id}`
          );
        } catch (error) {
          // If service doesn't exist (404), that's fine - it's already cleaned up
          if (
            error &&
            typeof error === "object" &&
            "statusCode" in error &&
            error.statusCode === 404
          ) {
            // Service already removed, nothing to do
            cleanedCount++;
          } else {
            errorCount++;
            console.error(
              `[ContainerCleanup] Failed to remove Docker service for container ${container.id}:`,
              error
            );
          }
        }
      }

      if (cleanedCount > 0 || errorCount > 0) {
        console.log(
          `[ContainerCleanup] Cleanup complete: ${cleanedCount} cleaned, ${errorCount} errors`
        );
      }
    } catch (error) {
      console.error("[ContainerCleanup] Error during cleanup:", error);
    }
  }

  /**
   * Reconcile state manager with actual Docker services.
   * Marks containers as "stopped" in the DB if their Docker service no longer exists.
   */
  private async reconcileWithDocker(): Promise<void> {
    try {
      // Get all containers the state manager thinks are running or starting
      const runningContainers = this.stateManager.listContainers({
        status: "running",
      });
      const startingContainers = this.stateManager.listContainers({
        status: "starting",
      });
      const allActive = [...runningContainers, ...startingContainers];

      if (allActive.length === 0) {
        return;
      }

      console.log(
        `[ContainerCleanup] Reconciling ${allActive.length} active container(s) in state manager with Docker...`
      );

      let staleCount = 0;
      for (const container of allActive) {
        const dockerContainer = await this.containerService.getContainer(container.id);
        if (!dockerContainer) {
          console.warn(
            `[ContainerCleanup] Container ${container.id} marked as "${container.status}" but Docker service doesn't exist. Marking as stopped.`
          );
          this.stateManager.updateContainerStatus(container.id, "stopped");
          staleCount++;
        }
      }

      if (staleCount > 0) {
        console.log(
          `[ContainerCleanup] Reconciliation complete: ${staleCount} stale container(s) marked as stopped`
        );
      } else {
        console.log(
          `[ContainerCleanup] Reconciliation complete: all ${allActive.length} container(s) verified in Docker`
        );
      }
    } catch (error) {
      console.error("[ContainerCleanup] Error during reconciliation:", error);
    }
  }

  /**
   * Manually trigger cleanup (useful for testing)
   */
  async cleanup(): Promise<void> {
    await this.cleanupStoppedContainers();
  }
}

