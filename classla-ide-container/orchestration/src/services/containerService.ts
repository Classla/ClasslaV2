import Docker from "dockerode";
import { config } from "../config/index";
import { TraefikService } from "./traefikService";
import { ContainerIdService } from "./containerIdService";
import {
  containerStartFailed,
  containerStopFailed,
  dockerError,
} from "../middleware/errors";

export interface ContainerConfig {
  s3Bucket?: string; // Optional for pre-warmed containers
  s3BucketId?: string; // Optional: bucketId for file sync
  s3Region?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  vncPassword?: string;
  domain: string;
  skipS3Bucket?: boolean; // If true, don't set S3_BUCKET env var (pre-warmed container)
}

export interface ContainerInfo {
  id: string;
  serviceName: string;
  status: "starting" | "running" | "stopping" | "stopped" | "failed";
  urls: {
    vnc: string;
    codeServer: string;
    webServer: string;
  };
  s3Bucket: string;
  createdAt: Date;
  lastActivity?: Date;
  resourceUsage?: {
    cpu: number;
    memory: number;
  };
}

export interface ContainerFilter {
  status?: string;
  limit?: number;
  offset?: number;
}

export class ContainerService {
  private docker: Docker;
  private traefikService: TraefikService;
  private containerIdService: ContainerIdService;

  constructor() {
    // Auto-detect Docker socket path (Mac vs Linux)
    const socketPath =
      process.env.DOCKER_SOCKET ||
      (process.platform === "darwin"
        ? `${process.env.HOME}/.docker/run/docker.sock`
        : "/var/run/docker.sock");
    this.docker = new Docker({ socketPath });
    this.traefikService = new TraefikService();
    this.containerIdService = new ContainerIdService();
  }

  /**
   * Create a new Docker Swarm service for an IDE container
   */
  async createContainer(
    containerConfig: ContainerConfig
  ): Promise<ContainerInfo> {
    const containerId = this.containerIdService.generateUniqueId();
    const serviceName = `ide-${containerId}`;

    // Generate environment variables for the container
    const env = [
      // Base paths for path-based routing
      `CODE_BASE_PATH=/code/${containerId}`,
      `VNC_BASE_PATH=/vnc/${containerId}`,
      // Inactivity timeout (10 minutes default, configurable via INACTIVITY_TIMEOUT_SECONDS env var)
      `INACTIVITY_TIMEOUT_SECONDS=${process.env.INACTIVITY_TIMEOUT_SECONDS || "600"}`,
      // Management API URL for shutdown webhook
      `MANAGEMENT_API_URL=http://ide-local_management-api:3001`,
      `CONTAINER_ID=${containerId}`,
      // Backend API URL for file sync
      `BACKEND_API_URL=${config.backendApiUrl || "http://localhost:8000/api"}`,
      // Container service token for authentication
      `CONTAINER_SERVICE_TOKEN=${config.containerServiceToken || ""}`,
    ];

    // Only set S3_BUCKET if not skipping (for pre-warmed containers)
    if (!containerConfig.skipS3Bucket && containerConfig.s3Bucket) {
      env.push(`S3_BUCKET=${containerConfig.s3Bucket}`);
      env.push(`S3_REGION=${containerConfig.s3Region || "us-east-1"}`);
      // Also set bucketId if provided (for new containers)
      if (containerConfig.s3BucketId) {
        env.push(`S3_BUCKET_ID=${containerConfig.s3BucketId}`);
      }
    } else if (!containerConfig.skipS3Bucket) {
      // If skipS3Bucket is false but no bucket provided, still set region
      env.push(`S3_REGION=${containerConfig.s3Region || "us-east-1"}`);
    }

    if (containerConfig.awsAccessKeyId) {
      env.push(`AWS_ACCESS_KEY_ID=${containerConfig.awsAccessKeyId}`);
    }
    if (containerConfig.awsSecretAccessKey) {
      env.push(`AWS_SECRET_ACCESS_KEY=${containerConfig.awsSecretAccessKey}`);
    }
    if (containerConfig.vncPassword) {
      env.push(`VNC_PASSWORD=${containerConfig.vncPassword}`);
    }

    // Generate Traefik labels for routing
    const labels = this.traefikService.generateTraefikLabels(
      containerId,
      containerConfig.domain
    );

    // Create service specification
    // Note: In Docker Swarm mode, Traefik reads labels from service level, not container spec
    const serviceSpec = {
      Name: serviceName,
      TaskTemplate: {
        ContainerSpec: {
          Image: config.ideContainerImage,
          Env: env,
          // Labels removed from ContainerSpec - Traefik reads from service level in Swarm mode
        },
        LogDriver: {
          Name: "json-file",
          Options: {
            "max-size": "10m",      // Maximum size of log file before rotation
            "max-file": "5",        // Maximum number of log files to keep
            "labels": "container_id,service_name", // Add labels to logs for easier filtering
          },
        },
        Resources: {
          Limits: {
            NanoCPUs: config.containerCpuLimit * 1000000000, // Convert cores to NanoCPUs
            MemoryBytes: config.containerMemoryLimit, // 4GB default
          },
        },
        RestartPolicy: {
          Condition: "on-failure",
          MaxAttempts: 3,
        },
        Placement: {
          Constraints: [
            // Can add node-specific constraints here if needed
            // e.g., 'node.labels.type==ide-worker'
          ],
        },
      },
      Mode: {
        Replicated: {
          Replicas: 1,
        },
      },
      Networks: [
        {
          Target: "ide-network",
          Aliases: [serviceName], // Only allow access via service name, not container-to-container
        },
      ],
      Labels: labels,
      EndpointSpec: {
        Mode: "vip", // Virtual IP mode for better isolation
        Ports: [], // All access through Traefik (no direct port publishing)
      },
    };

    try {
      // Create service - use update mode to ensure network is attached immediately
      const createStartTime = Date.now();
      await this.docker.createService(serviceSpec);
      const createDuration = Date.now() - createStartTime;
      
      console.log(
        `[ContainerService] Service ${serviceName} created in ${createDuration}ms, ensuring network attachment...`
      );

      // Ensure the service is attached to the ide-network
      // Dockerode sometimes doesn't apply Networks correctly during creation, so we update it
      try {
        // Reduced delay for faster startup - check immediately
        await new Promise((resolve) => setTimeout(resolve, 100));
        
        const service = this.docker.getService(serviceName);
        const inspect = await service.inspect();
        const currentNetworks = inspect.Spec?.TaskTemplate?.Networks || [];
        
        // Check if ide-network is already attached
        const hasIdeNetwork = currentNetworks.some(
          (net: { Target?: string }) => net.Target === "ide-network"
        );

        if (!hasIdeNetwork) {
          // Get the service version for the update
          const version = inspect.Version?.Index;
          if (version !== undefined) {
            // Update the service to add the network
            const updateSpec = {
              ...inspect.Spec,
              TaskTemplate: {
                ...inspect.Spec.TaskTemplate,
                Networks: [
                  ...currentNetworks,
                  {
                    Target: "ide-network",
                    Aliases: [serviceName],
                  },
                ],
              },
            };

            try {
              await service.update({
                version: version,
                ...updateSpec,
              } as any);
              console.log(
                `Successfully attached network to service ${serviceName} using dockerode API`
              );
            } catch (updateErr) {
              console.error(
                `Dockerode API update failed for ${serviceName}:`,
                updateErr instanceof Error ? updateErr.message : String(updateErr)
              );
              throw updateErr; // Re-throw to trigger outer catch
            }
          } else {
            console.warn(
              `Could not get service version for ${serviceName}, network attachment may fail`
            );
            throw new Error("Service version not available");
          }
        } else {
          console.log(`Network already attached to service ${serviceName}`);
        }
      } catch (updateError) {
        // Log but don't fail - network might already be attached or service might be starting
        console.error(
          `Failed to update network for service ${serviceName} using dockerode API:`,
          updateError instanceof Error ? updateError.message : String(updateError)
        );
        console.error(
          `Network attachment failed for ${serviceName}. The Networks field in serviceSpec should have attached it, but dockerode may not be applying it correctly. Manual attachment may be required.`
        );
      }

      const containerInfo: ContainerInfo = {
        id: containerId,
        serviceName,
        status: "starting",
        urls: this.traefikService.generateServiceUrls(
          containerId,
          containerConfig.domain
        ),
        s3Bucket: containerConfig.s3Bucket || "", // Empty string for pre-warmed containers
        createdAt: new Date(),
      };

      return containerInfo;
    } catch (error) {
      throw containerStartFailed(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Stop and remove a Docker Swarm service
   */
  async stopContainer(containerId: string): Promise<void> {
    const serviceName = `ide-${containerId}`;

    try {
      const service = this.docker.getService(serviceName);
      await service.remove();

      // Release the container ID back to the pool
      this.containerIdService.releaseId(containerId);
    } catch (error) {
      throw containerStopFailed(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get information about a specific container
   */
  async getContainer(containerId: string): Promise<ContainerInfo | null> {
    const serviceName = `ide-${containerId}`;

    try {
      const service = this.docker.getService(serviceName);
      const inspect = await service.inspect();

      // Determine status based on service state
      let status: ContainerInfo["status"] = "running";
      if (inspect.UpdateStatus?.State === "updating") {
        status = "starting";
      }

      // Extract domain from labels
      const labels = inspect.Spec?.Labels || {};
      const domain = this.traefikService.extractDomainFromLabels(labels);

      const containerInfo: ContainerInfo = {
        id: containerId,
        serviceName,
        status,
        urls: this.traefikService.generateServiceUrls(containerId, domain),
        s3Bucket: this.extractS3BucketFromService(inspect),
        createdAt: new Date(inspect.CreatedAt || Date.now()),
      };

      return containerInfo;
    } catch (error) {
      // Service not found
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 404
      ) {
        return null;
      }
      throw dockerError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * List all containers with optional filtering
   */
  async listContainers(filter?: ContainerFilter): Promise<ContainerInfo[]> {
    try {
      const services = await this.docker.listServices({
        filters: {
          name: ["ide-"],
        },
      });

      const containers: ContainerInfo[] = [];

      for (const service of services) {
        const containerId = service.Spec?.Name?.replace("ide-", "") || "";
        const labels = service.Spec?.Labels || {};
        const domain = this.traefikService.extractDomainFromLabels(labels);

        // Determine status
        let status: ContainerInfo["status"] = "running";
        if (service.UpdateStatus?.State === "updating") {
          status = "starting";
        }

        const containerInfo: ContainerInfo = {
          id: containerId,
          serviceName: service.Spec?.Name || "",
          status,
          urls: this.traefikService.generateServiceUrls(containerId, domain),
          s3Bucket: this.extractS3BucketFromService(
            service as unknown as Record<string, unknown>
          ),
          createdAt: new Date(service.CreatedAt || Date.now()),
        };

        containers.push(containerInfo);
      }

      // Apply filtering
      let filtered = containers;
      if (filter?.status) {
        filtered = filtered.filter((c) => c.status === filter.status);
      }

      // Apply pagination
      const offset = filter?.offset || 0;
      const limit = filter?.limit || filtered.length;
      filtered = filtered.slice(offset, offset + limit);

      return filtered;
    } catch (error) {
      throw dockerError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Initialize the service by loading existing container IDs
   *
   * This should be called on startup to prevent ID collisions with existing containers.
   */
  async initializeExistingIds(): Promise<void> {
    try {
      const services = await this.docker.listServices({
        filters: {
          name: ["ide-"],
        },
      });

      for (const service of services) {
        const containerId = service.Spec?.Name?.replace("ide-", "") || "";
        if (containerId) {
          this.containerIdService.markIdAsUsed(containerId);
        }
      }
    } catch (error) {
      // Log error but don't throw - service can still function
      console.error("Failed to initialize existing container IDs:", error);
    }
  }

  /**
   * Get logs from a container service
   * Returns a stream of logs
   */
  async getContainerLogs(
    containerId: string,
    options?: {
      tail?: number;
      follow?: boolean;
      timestamps?: boolean;
    }
  ): Promise<NodeJS.ReadableStream> {
    const serviceName = `ide-${containerId}`;

    try {
      // Get tasks for this service
      const allTasks = await this.docker.listTasks({
        filters: {
          service: [serviceName],
        },
      });

      if (allTasks.length === 0) {
        throw new Error("No tasks found for service");
      }

      // Get the most recent task
      const task = allTasks[0];
      const taskContainerId = task.Status?.ContainerStatus?.ContainerID;

      if (!taskContainerId) {
        throw new Error("No container ID found for task");
      }

      const container = this.docker.getContainer(taskContainerId);

      // Handle follow parameter properly for TypeScript
      let logStream: unknown;
      if (options?.follow === true) {
        logStream = await container.logs({
          stdout: true,
          stderr: true,
          follow: true,
          tail: options?.tail || 100,
          timestamps: options?.timestamps !== false,
        });
      } else {
        logStream = await container.logs({
          stdout: true,
          stderr: true,
          follow: false,
          tail: options?.tail || 100,
          timestamps: options?.timestamps !== false,
        });
      }

      return logStream as NodeJS.ReadableStream;
    } catch (error) {
      throw dockerError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Assign S3 bucket to a pre-warmed container via HTTP endpoint
   */
  async assignS3BucketToContainer(
    containerId: string,
    s3Config: {
      bucket: string;
      bucketId?: string;
      region?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    }
  ): Promise<void> {
    try {
      // Get container info to get the web server URL
      const containerInfo = await this.getContainer(containerId);
      if (!containerInfo) {
        throw new Error(`Container ${containerId} not found`);
      }

      // Construct the web server URL (port 3000)
      // For internal Docker network calls, use the container service name directly
      // This avoids going through Traefik and is more reliable for internal API calls
      const serviceName = `ide-${containerId}`;
      const webServerUrl = `http://${serviceName}:3000`;
      
      console.log(
        `[ContainerService] Assigning S3 bucket ${s3Config.bucket} to container ${containerId} via ${webServerUrl}/assign-s3-bucket`
      );
      
      // Wait for web server to be ready (with retries)
      // Pre-warmed containers should have the web server running, but we'll wait a bit if needed
      // The web server starts at the same time as code-server, so it should be ready soon
      let webServerReady = false;
      const maxRetries = 15; // Increased retries - web server might take a bit longer
      const retryDelay = 1000; // 1 second
      
      // Give web server a moment to start (pre-warmed containers might have just started)
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let timeoutId: NodeJS.Timeout | null = null;
        try {
          // Use AbortController for timeout
          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), 2000);
          
          const healthCheck = await fetch(`${webServerUrl}/health`, {
            method: "GET",
            signal: controller.signal,
          });
          
          if (timeoutId) clearTimeout(timeoutId);
          
          if (healthCheck.ok) {
            webServerReady = true;
            console.log(
              `[ContainerService] Web server for container ${containerId} is ready (attempt ${attempt}/${maxRetries})`
            );
            break;
          }
        } catch (error: any) {
          if (timeoutId) clearTimeout(timeoutId);
          if (attempt < maxRetries) {
            console.log(
              `[ContainerService] Web server for container ${containerId} not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          } else {
            console.warn(
              `[ContainerService] Web server for container ${containerId} not ready after ${maxRetries} attempts: ${error.message || String(error)}`
            );
          }
        }
      }
      
      // CRITICAL FIX: Even if web server health check fails, try assignment anyway
      // The web server might be running but health endpoint might not be responding yet
      // We should attempt assignment regardless - the endpoint will handle errors gracefully
      if (!webServerReady) {
        console.warn(
          `[ContainerService] Web server health check failed for container ${containerId}, but attempting S3 assignment anyway (web server might still be starting)`
        );
      }
      
      // CRITICAL: Warn if bucketId is missing - Y.js sync will NOT work without it
      if (!s3Config.bucketId) {
        console.error(
          `[ContainerService] ⚠️ WARNING: bucketId is missing for container ${containerId}! Y.js file sync will NOT work.`
        );
        console.error(
          `[ContainerService] s3Config received:`, JSON.stringify(s3Config, null, 2)
        );
      } else {
        console.log(
          `[ContainerService] Assigning S3 bucket with bucketId: ${s3Config.bucketId}`
        );
      }

      // Call the /assign-s3-bucket endpoint (even if health check failed)
      const response = await fetch(`${webServerUrl}/assign-s3-bucket`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucket: s3Config.bucket,
          bucketId: s3Config.bucketId,
          region: s3Config.region || "us-east-1",
          accessKeyId: s3Config.accessKeyId,
          secretAccessKey: s3Config.secretAccessKey,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to assign S3 bucket: ${response.status} ${errorText}`
        );
      }

      const result = (await response.json()) as {
        status?: string;
        error?: string;
      };
      if (result.status !== "success" && result.status !== "already_assigned") {
        throw new Error(
          `S3 bucket assignment failed: ${result.error || "Unknown error"}`
        );
      }

      console.log(
        `[ContainerService] Successfully assigned S3 bucket ${s3Config.bucket} to container ${containerId}`
      );
    } catch (error) {
      console.error(
        `[ContainerService] Error assigning S3 bucket to container ${containerId}:`,
        error
      );
      throw dockerError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Extract S3 bucket from service environment variables
   */
  private extractS3BucketFromService(service: Record<string, unknown>): string {
    const spec = (
      service as {
        Spec?: { TaskTemplate?: { ContainerSpec?: { Env?: string[] } } };
      }
    ).Spec;
    const env = spec?.TaskTemplate?.ContainerSpec?.Env || [];
    for (const envVar of env) {
      if (typeof envVar === "string" && envVar.startsWith("S3_BUCKET=")) {
        return envVar.replace("S3_BUCKET=", "");
      }
    }
    return "";
  }
}
