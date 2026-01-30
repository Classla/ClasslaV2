import { ResourceMonitor, SystemResources } from "./resourceMonitor";
import { ContainerService } from "./containerService";

// Discord webhook URL for resource alerts
const DISCORD_WEBHOOK_URL =
  "https://canary.discord.com/api/webhooks/1465743912160198918/YP5IN8beY31l0g7OnSKcA-k1eULvASg5m9mQbGzUzPwVOTlzcD7FeCzT0Tf1d40Yr2M4";

// Alert thresholds
const CPU_THRESHOLD = 90; // Percentage
const MEMORY_THRESHOLD = 90; // Percentage
const CHECK_INTERVAL = 60 * 1000; // 60 seconds
const ALERT_COOLDOWN = 5 * 60 * 1000; // 5 minutes between alerts

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp: string;
}

interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// Helper function to format bytes to human readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Helper function to format duration from seconds
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

export class DiscordAlertService {
  private resourceMonitor: ResourceMonitor;
  private containerService: ContainerService;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastAlertTime: number = 0;
  private isRunning: boolean = false;

  constructor(resourceMonitor: ResourceMonitor, containerService: ContainerService) {
    this.resourceMonitor = resourceMonitor;
    this.containerService = containerService;
  }

  /**
   * Start the alert monitoring service
   */
  start(): void {
    if (this.isRunning) {
      console.log("[DiscordAlertService] Already running");
      return;
    }

    this.isRunning = true;
    console.log(
      `[DiscordAlertService] Started (check interval: ${CHECK_INTERVAL / 1000}s, cooldown: ${ALERT_COOLDOWN / 1000}s)`
    );

    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.checkAndAlert().catch((error) => {
        console.error("[DiscordAlertService] Error checking resources:", error);
      });
    }, CHECK_INTERVAL);

    // Run initial check after a short delay (let other services initialize)
    setTimeout(() => {
      this.checkAndAlert().catch((error) => {
        console.error(
          "[DiscordAlertService] Error on initial resource check:",
          error
        );
      });
    }, 5000);
  }

  /**
   * Stop the alert monitoring service
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log("[DiscordAlertService] Stopped");
  }

  /**
   * Check resources and send alert if thresholds exceeded
   */
  private async checkAndAlert(): Promise<void> {
    try {
      const resources = await this.resourceMonitor.getSystemResources();

      const cpuExceeded = resources.cpu.usage > CPU_THRESHOLD;
      const memoryExceeded =
        resources.memory.usagePercent > MEMORY_THRESHOLD;

      if (cpuExceeded || memoryExceeded) {
        // Check cooldown
        const now = Date.now();
        if (now - this.lastAlertTime < ALERT_COOLDOWN) {
          console.log(
            `[DiscordAlertService] Alert suppressed (cooldown active, ${Math.round((ALERT_COOLDOWN - (now - this.lastAlertTime)) / 1000)}s remaining)`
          );
          return;
        }

        // Send alert
        await this.sendAlert(resources, cpuExceeded, memoryExceeded);
        this.lastAlertTime = now;
      }
    } catch (error) {
      console.error("[DiscordAlertService] Failed to check resources:", error);
    }
  }

  /**
   * Send Discord webhook alert
   */
  private async sendAlert(
    resources: SystemResources,
    cpuExceeded: boolean,
    memoryExceeded: boolean
  ): Promise<void> {
    try {
      // Get LIVE container data from Docker (not stale SQLite)
      const liveContainers = await this.containerService.listContainers();
      const now = Date.now();

      // Filter out management containers
      const ideContainers = liveContainers.filter(
        (c) => !c.serviceName.includes("traefik") && !c.serviceName.includes("management-api")
      );

      const ages = ideContainers
        .filter((c) => c.createdAt)
        .map((c) => Math.floor((now - c.createdAt.getTime()) / 1000));

      const containerCount = ideContainers.length;
      const averageAge =
        ages.length > 0
          ? Math.floor(ages.reduce((a, b) => a + b, 0) / ages.length)
          : 0;
      const oldestAge = ages.length > 0 ? Math.max(...ages) : 0;

      // Build alert description
      const alertReasons: string[] = [];
      if (cpuExceeded) {
        alertReasons.push(`CPU usage is at ${resources.cpu.usage.toFixed(1)}%`);
      }
      if (memoryExceeded) {
        alertReasons.push(
          `Memory usage is at ${resources.memory.usagePercent.toFixed(1)}%`
        );
      }

      const payload: DiscordWebhookPayload = {
        embeds: [
          {
            title: "IDE System Resource Alert",
            description: alertReasons.join(" and ") + ". Consider stopping idle containers to free up resources.",
            color: 0xe74c3c, // Red
            fields: [
              {
                name: "CPU Usage",
                value: `${resources.cpu.usage.toFixed(1)}% (${resources.cpu.available} cores)`,
                inline: true,
              },
              {
                name: "RAM Usage",
                value: `${formatBytes(resources.memory.used)} / ${formatBytes(resources.memory.total)} (${resources.memory.usagePercent.toFixed(1)}%)`,
                inline: true,
              },
              {
                name: "Disk Usage",
                value: `${formatBytes(resources.disk.used)} / ${formatBytes(resources.disk.total)} (${resources.disk.usagePercent.toFixed(1)}%)`,
                inline: true,
              },
              {
                name: "Container Count",
                value: `${containerCount} running`,
                inline: true,
              },
              {
                name: "Average Container Age",
                value: formatDuration(averageAge),
                inline: true,
              },
              {
                name: "Oldest Container",
                value: formatDuration(oldestAge),
                inline: true,
              },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[DiscordAlertService] Failed to send webhook: ${response.status}`,
          errorText
        );
      } else {
        console.log(
          `[DiscordAlertService] Alert sent: CPU=${resources.cpu.usage.toFixed(1)}%, RAM=${resources.memory.usagePercent.toFixed(1)}%, Containers=${containerCount}`
        );
      }
    } catch (error) {
      console.error("[DiscordAlertService] Failed to send alert:", error);
    }
  }

  /**
   * Manually trigger an alert (for testing)
   */
  async sendTestAlert(): Promise<void> {
    const resources = await this.resourceMonitor.getSystemResources();
    await this.sendAlert(resources, true, true);
  }
}
