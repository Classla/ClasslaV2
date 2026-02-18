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
   * and deleting stale records from the database
   */
  private async cleanupStoppedContainers(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // First, archive old records (stopped > 24h) to prevent unbounded growth
      try {
        const archived = this.stateManager.archiveOldContainers();
        if (archived > 0) {
          console.log(
            `[ContainerCleanup] Archived ${archived} old container record(s)`
          );
        }
      } catch (archiveError) {
        console.error("[ContainerCleanup] Error archiving old containers:", archiveError);
      }

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
      let deletedCount = 0;
      let errorCount = 0;

      for (const container of stoppedContainers) {
        try {
          // Try to stop/remove the Docker service
          await this.containerService.stopContainer(container.id);
          // Docker service was still running, now removed - delete the DB record
          this.stateManager.deleteContainer(container.id);
          cleanedCount++;
          deletedCount++;
        } catch (error) {
          // If service doesn't exist (404), delete the stale DB record
          if (
            error &&
            typeof error === "object" &&
            "statusCode" in error &&
            error.statusCode === 404
          ) {
            this.stateManager.deleteContainer(container.id);
            deletedCount++;
          } else {
            errorCount++;
            console.error(
              `[ContainerCleanup] Failed to remove Docker service for container ${container.id}:`,
              error
            );
          }
        }
      }

      if (cleanedCount > 0 || deletedCount > 0 || errorCount > 0) {
        console.log(
          `[ContainerCleanup] Cleanup complete: ${cleanedCount} Docker services removed, ${deletedCount} DB records deleted, ${errorCount} errors`
        );
      }
    } catch (error) {
      console.error("[ContainerCleanup] Error during cleanup:", error);
    }
  }

  /**
   * Reconcile state manager with actual Docker services.
   * Deletes container records from the DB if their Docker service no longer exists.
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
      const stoppedContainers = this.stateManager.listContainers({
        status: "stopped",
      });
      const allContainers = [...runningContainers, ...startingContainers, ...stoppedContainers];

      if (allContainers.length === 0) {
        return;
      }

      console.log(
        `[ContainerCleanup] Reconciling ${allContainers.length} container(s) in state manager with Docker (${runningContainers.length} running, ${startingContainers.length} starting, ${stoppedContainers.length} stopped)...`
      );

      let staleCount = 0;
      for (const container of allContainers) {
        const dockerContainer = await this.containerService.getContainer(container.id);
        if (!dockerContainer) {
          // Docker service doesn't exist - delete the stale DB record entirely
          this.stateManager.deleteContainer(container.id);
          staleCount++;
        }
      }

      if (staleCount > 0) {
        console.log(
          `[ContainerCleanup] Reconciliation complete: ${staleCount} stale record(s) deleted from DB`
        );
      } else {
        console.log(
          `[ContainerCleanup] Reconciliation complete: all ${allContainers.length} container(s) verified in Docker`
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

