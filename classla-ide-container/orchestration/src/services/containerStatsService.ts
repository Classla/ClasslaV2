/**
 * ContainerStatsService - Tracks container lifecycle metrics for observability
 * 
 * Records:
 * - Request received timestamp
 * - Code-server availability time (startup time)
 * - Container active duration
 * - User who requested the container
 * - S3 bucket used
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface ContainerStatsRecord {
  containerId: string;
  userId?: string;
  s3Bucket: string;
  requestReceivedAt: Date;
  codeServerAvailableAt?: Date;
  containerStoppedAt?: Date;
  startupTimeMs?: number;
  activeDurationMs?: number;
  shutdownReason?: string;
}

export class ContainerStatsService {
  private supabase: SupabaseClient | null = null;
  private enabled: boolean = false;

  constructor() {
    // Initialize Supabase client if credentials are provided
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.enabled = true;
        console.log("ContainerStatsService: Supabase connection initialized");
      } catch (error) {
        console.warn(
          "ContainerStatsService: Failed to initialize Supabase client:",
          error
        );
        this.enabled = false;
      }
    } else {
      console.warn(
        "ContainerStatsService: Supabase credentials not provided, stats tracking disabled"
      );
      this.enabled = false;
    }
  }

  /**
   * Record when a container start request is received
   */
  async recordRequestReceived(
    containerId: string,
    s3Bucket: string,
    userId?: string
  ): Promise<void> {
    if (!this.enabled || !this.supabase) {
      return;
    }

    try {
      const { error } = await this.supabase.from("container_stats").insert({
        container_id: containerId,
        user_id: userId || null,
        s3_bucket: s3Bucket,
        request_received_at: new Date().toISOString(),
      });

      if (error) {
        console.error(
          `Failed to record request received for container ${containerId}:`,
          error
        );
      } else {
        console.log(
          `Recorded request received for container ${containerId}`
        );
      }
    } catch (error) {
      console.error(
        `Error recording request received for container ${containerId}:`,
        error
      );
    }
  }

  /**
   * Record when code-server becomes available (first successful health check)
   */
  async recordCodeServerAvailable(containerId: string): Promise<void> {
    if (!this.enabled || !this.supabase) {
      return;
    }

    try {
      // First, get the request_received_at to calculate startup time
      const { data: existing, error: fetchError } = await this.supabase
        .from("container_stats")
        .select("request_received_at")
        .eq("container_id", containerId)
        .single();

      if (fetchError || !existing) {
        console.warn(
          `No existing record found for container ${containerId}, cannot record code-server available`
        );
        return;
      }

      const now = new Date();
      const requestReceivedAt = new Date(existing.request_received_at);
      const startupTimeMs = now.getTime() - requestReceivedAt.getTime();

      const { error } = await this.supabase
        .from("container_stats")
        .update({
          code_server_available_at: now.toISOString(),
          startup_time_ms: startupTimeMs,
          updated_at: now.toISOString(),
        })
        .eq("container_id", containerId)
        .is("code_server_available_at", null); // Only update if not already set

      if (error) {
        console.error(
          `Failed to record code-server available for container ${containerId}:`,
          error
        );
      } else {
        console.log(
          `Recorded code-server available for container ${containerId} (startup time: ${startupTimeMs}ms)`
        );
      }
    } catch (error) {
      console.error(
        `Error recording code-server available for container ${containerId}:`,
        error
      );
    }
  }

  /**
   * Record when a container is stopped and calculate active duration
   */
  async recordContainerStopped(
    containerId: string,
    shutdownReason?: string
  ): Promise<void> {
    if (!this.enabled || !this.supabase) {
      return;
    }

    try {
      // Get the existing record to calculate duration
      const { data: existing, error: fetchError } = await this.supabase
        .from("container_stats")
        .select("code_server_available_at, request_received_at")
        .eq("container_id", containerId)
        .single();

      if (fetchError || !existing) {
        console.warn(
          `No existing record found for container ${containerId}, cannot record container stopped`
        );
        return;
      }

      const now = new Date();
      let activeDurationMs: number | null = null;

      // Calculate active duration from code-server available to now
      if (existing.code_server_available_at) {
        const codeServerAvailableAt = new Date(
          existing.code_server_available_at
        );
        activeDurationMs = now.getTime() - codeServerAvailableAt.getTime();
      } else if (existing.request_received_at) {
        // Fallback: use request time if code-server time not available
        const requestReceivedAt = new Date(existing.request_received_at);
        activeDurationMs = now.getTime() - requestReceivedAt.getTime();
      }

      const { error } = await this.supabase
        .from("container_stats")
        .update({
          container_stopped_at: now.toISOString(),
          active_duration_ms: activeDurationMs,
          shutdown_reason: shutdownReason || null,
          updated_at: now.toISOString(),
        })
        .eq("container_id", containerId);

      if (error) {
        console.error(
          `Failed to record container stopped for container ${containerId}:`,
          error
        );
      } else {
        console.log(
          `Recorded container stopped for container ${containerId} (duration: ${activeDurationMs ? `${activeDurationMs}ms` : "unknown"})`
        );
      }
    } catch (error) {
      console.error(
        `Error recording container stopped for container ${containerId}:`,
        error
      );
    }
  }
}
