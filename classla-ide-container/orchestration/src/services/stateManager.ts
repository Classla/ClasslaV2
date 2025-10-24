import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type ContainerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";
export type ShutdownReason =
  | "inactivity"
  | "manual"
  | "error"
  | "resource_limit";

interface ContainerRow {
  id: string;
  service_name: string;
  s3_bucket: string;
  s3_region: string;
  status: string;
  created_at: number;
  started_at: number | null;
  stopped_at: number | null;
  last_activity: number | null;
  shutdown_reason: string | null;
  vnc_url: string;
  code_server_url: string;
  web_server_url: string;
  cpu_limit: string;
  memory_limit: string;
}

export interface ContainerMetadata {
  id: string;
  serviceName: string;
  s3Bucket: string;
  s3Region: string;
  status: ContainerStatus;
  createdAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  lastActivity?: Date;
  shutdownReason?: ShutdownReason;
  urls: {
    vnc: string;
    codeServer: string;
    webServer: string;
  };
  resourceLimits: {
    cpuLimit: string;
    memoryLimit: string;
  };
}

export interface ContainerFilter {
  status?: ContainerStatus;
  limit?: number;
  offset?: number;
}

export class StateManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    // Default to data/containers.db if no path provided
    const finalPath =
      dbPath || path.join(process.cwd(), "data", "containers.db");

    // Ensure data directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Create containers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        service_name TEXT NOT NULL,
        s3_bucket TEXT NOT NULL,
        s3_region TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        stopped_at INTEGER,
        last_activity INTEGER,
        shutdown_reason TEXT,
        vnc_url TEXT NOT NULL,
        code_server_url TEXT NOT NULL,
        web_server_url TEXT NOT NULL,
        cpu_limit TEXT NOT NULL,
        memory_limit TEXT NOT NULL
      )
    `);

    // Create index on status for faster filtering
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status)
    `);

    // Create index on stopped_at for archival queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_containers_stopped_at ON containers(stopped_at)
    `);
  }

  /**
   * Save a new container or update an existing one
   */
  saveContainer(container: ContainerMetadata): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO containers (
        id, service_name, s3_bucket, s3_region, status,
        created_at, started_at, stopped_at, last_activity, shutdown_reason,
        vnc_url, code_server_url, web_server_url,
        cpu_limit, memory_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      container.id,
      container.serviceName,
      container.s3Bucket,
      container.s3Region,
      container.status,
      container.createdAt.getTime(),
      container.startedAt?.getTime() || null,
      container.stoppedAt?.getTime() || null,
      container.lastActivity?.getTime() || null,
      container.shutdownReason || null,
      container.urls.vnc,
      container.urls.codeServer,
      container.urls.webServer,
      container.resourceLimits.cpuLimit,
      container.resourceLimits.memoryLimit
    );
  }

  /**
   * Get a container by ID
   */
  getContainer(id: string): ContainerMetadata | null {
    const stmt = this.db.prepare(`
      SELECT * FROM containers WHERE id = ?
    `);

    const row = stmt.get(id) as ContainerRow | undefined;
    if (!row) {
      return null;
    }

    return this.rowToContainer(row);
  }

  /**
   * List containers with optional filtering
   */
  listContainers(filter?: ContainerFilter): ContainerMetadata[] {
    let query = "SELECT * FROM containers";
    const params: (string | number)[] = [];

    if (filter?.status) {
      query += " WHERE status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC";

    if (filter?.limit) {
      query += " LIMIT ?";
      params.push(filter.limit);
    }

    if (filter?.offset) {
      query += " OFFSET ?";
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as ContainerRow[];

    return rows.map((row) => this.rowToContainer(row));
  }

  /**
   * Update container status
   */
  updateContainerStatus(id: string, status: ContainerStatus): void {
    const stmt = this.db.prepare(`
      UPDATE containers SET status = ? WHERE id = ?
    `);

    stmt.run(status, id);
  }

  /**
   * Update container with lifecycle timestamps
   */
  updateContainerLifecycle(
    id: string,
    updates: {
      status?: ContainerStatus;
      startedAt?: Date;
      stoppedAt?: Date;
      lastActivity?: Date;
      shutdownReason?: ShutdownReason;
    }
  ): void {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }

    if (updates.startedAt !== undefined) {
      fields.push("started_at = ?");
      values.push(updates.startedAt.getTime());
    }

    if (updates.stoppedAt !== undefined) {
      fields.push("stopped_at = ?");
      values.push(updates.stoppedAt.getTime());
    }

    if (updates.lastActivity !== undefined) {
      fields.push("last_activity = ?");
      values.push(updates.lastActivity.getTime());
    }

    if (updates.shutdownReason !== undefined) {
      fields.push("shutdown_reason = ?");
      values.push(updates.shutdownReason);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE containers SET ${fields.join(", ")} WHERE id = ?
    `);

    stmt.run(...values);
  }

  /**
   * Archive old containers (stopped for more than 24 hours)
   */
  archiveOldContainers(): number {
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Create archive table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers_archive (
        id TEXT PRIMARY KEY,
        service_name TEXT NOT NULL,
        s3_bucket TEXT NOT NULL,
        s3_region TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        stopped_at INTEGER,
        last_activity INTEGER,
        shutdown_reason TEXT,
        vnc_url TEXT NOT NULL,
        code_server_url TEXT NOT NULL,
        web_server_url TEXT NOT NULL,
        cpu_limit TEXT NOT NULL,
        memory_limit TEXT NOT NULL,
        archived_at INTEGER NOT NULL
      )
    `);

    // Move old stopped containers to archive
    const stmt = this.db.prepare(`
      INSERT INTO containers_archive
      SELECT *, ? as archived_at
      FROM containers
      WHERE status = 'stopped' AND stopped_at < ?
    `);

    const result = stmt.run(Date.now(), twentyFourHoursAgo);

    // Delete archived containers from main table
    const deleteStmt = this.db.prepare(`
      DELETE FROM containers
      WHERE status = 'stopped' AND stopped_at < ?
    `);

    deleteStmt.run(twentyFourHoursAgo);

    return result.changes;
  }

  /**
   * Get total count of containers by status
   */
  getContainerCount(status?: ContainerStatus): number {
    let query = "SELECT COUNT(*) as count FROM containers";
    const params: string[] = [];

    if (status) {
      query += " WHERE status = ?";
      params.push(status);
    }

    const stmt = this.db.prepare(query);
    const row = stmt.get(...params) as { count: number };

    return row.count;
  }

  /**
   * Convert database row to ContainerMetadata
   */
  private rowToContainer(row: ContainerRow): ContainerMetadata {
    return {
      id: row.id,
      serviceName: row.service_name,
      s3Bucket: row.s3_bucket,
      s3Region: row.s3_region,
      status: row.status as ContainerStatus,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      stoppedAt: row.stopped_at ? new Date(row.stopped_at) : undefined,
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
      shutdownReason: row.shutdown_reason as ShutdownReason | undefined,
      urls: {
        vnc: row.vnc_url,
        codeServer: row.code_server_url,
        webServer: row.web_server_url,
      },
      resourceLimits: {
        cpuLimit: row.cpu_limit,
        memoryLimit: row.memory_limit,
      },
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
