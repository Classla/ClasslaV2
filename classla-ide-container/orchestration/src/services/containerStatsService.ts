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
    console.log(
      `[ContainerStatsService] recordCodeServerAvailable called for container ${containerId}`
    );
    
    if (!this.enabled || !this.supabase) {
      console.warn(
        `[ContainerStatsService] Service not enabled or Supabase not initialized. enabled=${this.enabled}, supabase=${!!this.supabase}`
      );
      return;
    }

    try {
      console.log(
        `[ContainerStatsService] Fetching existing record for container ${containerId}...`
      );
      
      // First, get the request_received_at to calculate startup time
      const { data: existing, error: fetchError } = await this.supabase
        .from("container_stats")
        .select("request_received_at, code_server_available_at")
        .eq("container_id", containerId)
        .single();

      if (fetchError || !existing) {
        console.warn(
          `[ContainerStatsService] No existing record found for container ${containerId}, cannot record code-server available`
        );
        if (fetchError) {
          console.error(`[ContainerStatsService] Fetch error:`, fetchError);
        }
        return;
      }

      if (existing.code_server_available_at) {
        console.log(
          `[ContainerStatsService] Code-server availability already recorded for container ${containerId} at ${existing.code_server_available_at}`
        );
        return;
      }

      console.log(
        `[ContainerStatsService] Found existing record for container ${containerId}, request_received_at: ${existing.request_received_at}`
      );

      const now = new Date();
      const requestReceivedAt = new Date(existing.request_received_at);
      const startupTimeMs = now.getTime() - requestReceivedAt.getTime();

      console.log(
        `[ContainerStatsService] Updating record: code_server_available_at=${now.toISOString()}, startup_time_ms=${startupTimeMs}`
      );

      // Try to update - use .is() to only update if not already set, but also check if update succeeded
      // Update the record - remove .is() filter to ensure update happens
      // We already checked above if it's already set, so this should be safe
      const { data: updateData, error } = await this.supabase
        .from("container_stats")
        .update({
          code_server_available_at: now.toISOString(),
          startup_time_ms: startupTimeMs,
          updated_at: now.toISOString(),
        })
        .eq("container_id", containerId)
        .select();

      console.log(
        `[ContainerStatsService] Update query result: ${updateData?.length || 0} row(s) updated, error: ${error ? JSON.stringify(error) : 'none'}`
      );

      if (error) {
        console.error(
          `[ContainerStatsService] ❌ Failed to record code-server available for container ${containerId}:`,
          error
        );
        // Log the error details for debugging
        if (error.code) {
          console.error(`[ContainerStatsService] Supabase error code: ${error.code}`);
        }
        if (error.message) {
          console.error(`[ContainerStatsService] Supabase error message: ${error.message}`);
        }
        if (error.details) {
          console.error(`[ContainerStatsService] Supabase error details: ${error.details}`);
        }
        if (error.hint) {
          console.error(`[ContainerStatsService] Supabase error hint: ${error.hint}`);
        }
      } else {
        const rowsUpdated = updateData?.length || 0;
        if (rowsUpdated === 0) {
          console.warn(
            `[ContainerStatsService] ⚠️ Update query returned 0 rows - record may have already been updated or doesn't exist`
          );
        } else {
          console.log(
            `[ContainerStatsService] ✅ Recorded code-server available for container ${containerId} (startup time: ${startupTimeMs}ms, ${Math.round(startupTimeMs / 1000)}s)`
          );
        }
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
