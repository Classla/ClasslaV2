import { config } from "../config/index";

export type ContainerQueueState = "pre-warmed" | "assigned" | "running";

export interface QueuedContainer {
  containerId: string;
  serviceName: string;
  state: ContainerQueueState;
  createdAt: Date;
  assignedAt?: Date;
  s3Bucket?: string;
}

/**
 * QueueManager manages the pool of pre-warmed containers
 * that are ready to be assigned S3 buckets on demand.
 */
export class QueueManager {
  private queue: Map<string, QueuedContainer> = new Map();
  private targetQueueSize: number;

  constructor() {
    this.targetQueueSize = config.preWarmedQueueSize;
  }

  /**
   * Get an available pre-warmed container from the queue and mark it as assigned atomically
   * This prevents race conditions where multiple requests get the same container
   * Returns null if no container is available
   */
  getAvailableContainer(): QueuedContainer | null {
    for (const container of this.queue.values()) {
      if (container.state === "pre-warmed") {
        // Atomically mark as assigned to prevent race conditions
        // We'll update with the S3 bucket later, but mark as assigned now
        container.state = "assigned";
        container.assignedAt = new Date();
        this.queue.set(container.containerId, container);
        return container;
      }
    }
    return null;
  }

  /**
   * Mark a container as assigned (moved from pre-warmed to assigned)
   * Note: getAvailableContainer now does this atomically, but this method
   * is kept for updating the S3 bucket and for backward compatibility
   */
  markAsAssigned(containerId: string, s3Bucket: string): boolean {
    const container = this.queue.get(containerId);
    if (!container || container.state !== "assigned") {
      // Container should already be assigned by getAvailableContainer
      // But if it's not, we can't assign it
      return false;
    }

    // Update with S3 bucket info
    container.s3Bucket = s3Bucket;
    this.queue.set(containerId, container);
    return true;
  }

  /**
   * Add a new container to the pre-warmed queue
   */
  addToQueue(containerId: string, serviceName: string): void {
    const container: QueuedContainer = {
      containerId,
      serviceName,
      state: "pre-warmed",
      createdAt: new Date(),
    };
    this.queue.set(containerId, container);
  }

  /**
   * Remove a container from the queue (e.g., when it's stopped or failed)
   */
  removeFromQueue(containerId: string): boolean {
    return this.queue.delete(containerId);
  }

  /**
   * Return a container to pre-warmed state (e.g., if assignment failed)
   * This allows the container to be reused
   */
  returnToQueue(containerId: string): boolean {
    const container = this.queue.get(containerId);
    if (!container) {
      return false;
    }
    
    // Reset to pre-warmed state
    container.state = "pre-warmed";
    container.assignedAt = undefined;
    container.s3Bucket = undefined;
    this.queue.set(containerId, container);
    return true;
  }

  /**
   * Get the current queue size (number of pre-warmed containers)
   */
  getQueueSize(): number {
    let count = 0;
    for (const container of this.queue.values()) {
      if (container.state === "pre-warmed") {
        count++;
      }
    }
    return count;
  }

  /**
   * Get the total number of containers tracked (all states)
   */
  getTotalSize(): number {
    return this.queue.size;
  }

  /**
   * Check if a new container should be spawned to maintain queue size
   */
  shouldSpawnNewContainer(): boolean {
    return this.getQueueSize() < this.targetQueueSize;
  }

  /**
   * Get how many containers need to be spawned to reach target size
   */
  getContainersNeeded(): number {
    const currentSize = this.getQueueSize();
    return Math.max(0, this.targetQueueSize - currentSize);
  }

  /**
   * Get all containers in a specific state
   */
  getContainersByState(state: ContainerQueueState): QueuedContainer[] {
    const containers: QueuedContainer[] = [];
    for (const container of this.queue.values()) {
      if (container.state === state) {
        containers.push(container);
      }
    }
    return containers;
  }

  /**
   * Get a container by ID
   */
  getContainer(containerId: string): QueuedContainer | undefined {
    return this.queue.get(containerId);
  }

  /**
   * Get all container IDs in the queue
   */
  getAllContainerIds(): string[] {
    return Array.from(this.queue.keys());
  }

  /**
   * Update container state
   */
  updateContainerState(
    containerId: string,
    state: ContainerQueueState
  ): boolean {
    const container = this.queue.get(containerId);
    if (!container) {
      return false;
    }

    container.state = state;
    if (state === "assigned" && !container.assignedAt) {
      container.assignedAt = new Date();
    }
    this.queue.set(containerId, container);
    return true;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = {
      preWarmed: 0,
      assigned: 0,
      running: 0,
      total: this.queue.size,
      targetSize: this.targetQueueSize,
    };

    for (const container of this.queue.values()) {
      switch (container.state) {
        case "pre-warmed":
          stats.preWarmed++;
          break;
        case "assigned":
          stats.assigned++;
          break;
        case "running":
          stats.running++;
          break;
      }
    }

    return stats;
  }

  /**
   * Clear all containers from the queue (useful for testing or cleanup)
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Update target queue size
   */
  setTargetQueueSize(size: number): void {
    this.targetQueueSize = size;
  }
}

