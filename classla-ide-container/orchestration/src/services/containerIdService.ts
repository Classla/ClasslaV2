/**
 * ContainerIdService - Handles generation of unique, URL-safe container IDs
 *
 * Container IDs must be:
 * - Unique across all containers
 * - URL-safe and DNS-compatible
 * - Short and readable (8 characters by default)
 * - Lowercase alphanumeric only
 */

export class ContainerIdService {
  private usedIds: Set<string>;

  constructor() {
    this.usedIds = new Set<string>();
  }

  /**
   * Generate a unique container ID
   *
   * Creates a short, URL-safe ID using lowercase alphanumeric characters.
   * Automatically checks for collisions and regenerates if needed.
   *
   * @param length - Length of the ID (default: 8)
   * @param maxAttempts - Maximum collision resolution attempts (default: 10)
   * @returns Unique container ID
   * @throws Error if unable to generate unique ID after maxAttempts
   */
  generateUniqueId(length: number = 8, maxAttempts: number = 10): string {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const id = this.generateId(length);

      if (!this.usedIds.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }

    throw new Error(
      `Failed to generate unique container ID after ${maxAttempts} attempts`
    );
  }

  /**
   * Generate a random container ID
   *
   * Uses lowercase letters and numbers only for DNS compatibility.
   *
   * @param length - Length of the ID
   * @returns Random container ID
   */
  private generateId(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";

    for (let i = 0; i < length; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return id;
  }

  /**
   * Generate a readable container ID using word combinations
   *
   * Creates IDs like "blue-tiger-42" that are easier to remember and communicate.
   *
   * @returns Readable container ID
   */
  generateReadableId(): string {
    const adjectives = [
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "fast",
      "slow",
      "happy",
      "calm",
      "bright",
      "dark",
      "cool",
      "warm",
      "swift",
      "bold",
      "quiet",
      "loud",
    ];

    const nouns = [
      "tiger",
      "eagle",
      "shark",
      "wolf",
      "bear",
      "lion",
      "falcon",
      "hawk",
      "fox",
      "lynx",
      "otter",
      "panda",
      "raven",
      "cobra",
      "viper",
      "gecko",
      "koala",
      "lemur",
    ];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 100);

    const id = `${adjective}-${noun}-${number}`;

    // Check for collision
    if (this.usedIds.has(id)) {
      // Fallback to random ID if collision occurs
      return this.generateUniqueId();
    }

    this.usedIds.add(id);
    return id;
  }

  /**
   * Mark an existing container ID as used
   *
   * Used when loading existing containers from storage to prevent ID collisions.
   *
   * @param id - Container ID to mark as used
   */
  markIdAsUsed(id: string): void {
    this.usedIds.add(id);
  }

  /**
   * Release a container ID back to the pool
   *
   * Called when a container is permanently deleted.
   *
   * @param id - Container ID to release
   */
  releaseId(id: string): void {
    this.usedIds.delete(id);
  }

  /**
   * Check if a container ID is already in use
   *
   * @param id - Container ID to check
   * @returns true if ID is in use, false otherwise
   */
  isIdInUse(id: string): boolean {
    return this.usedIds.has(id);
  }

  /**
   * Validate that a container ID is URL-safe and DNS-compatible
   *
   * Container IDs must be:
   * - Lowercase alphanumeric and hyphens only
   * - Not starting or ending with a hyphen
   * - Between 4 and 32 characters
   *
   * @param id - Container ID to validate
   * @returns true if valid, false otherwise
   */
  validateId(id: string): boolean {
    // DNS-compatible: lowercase alphanumeric and hyphens, not starting/ending with hyphen
    const dnsPattern = /^[a-z0-9]([a-z0-9-]{2,30}[a-z0-9])?$/;
    return dnsPattern.test(id);
  }

  /**
   * Get the count of currently used IDs
   *
   * @returns Number of IDs in use
   */
  getUsedIdCount(): number {
    return this.usedIds.size;
  }

  /**
   * Clear all used IDs
   *
   * WARNING: Only use this for testing or when reinitializing the service.
   */
  clearAllIds(): void {
    this.usedIds.clear();
  }
}
