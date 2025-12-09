import Docker from "dockerode";
import { config } from "../config/index.js";
import { TraefikService } from "./traefikService.js";
import { ContainerIdService } from "./containerIdService.js";
import {
  containerStartFailed,
  containerStopFailed,
  dockerError,
} from "../middleware/errors.js";

export interface ContainerConfig {
  s3Bucket: string;
  s3Region?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  vncPassword?: string;
  domain: string;
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
      `S3_BUCKET=${containerConfig.s3Bucket}`,
      `S3_REGION=${containerConfig.s3Region || "us-east-1"}`,
      // Base paths for path-based routing
      `CODE_BASE_PATH=/code/${containerId}`,
      `VNC_BASE_PATH=/vnc/${containerId}`,
    ];

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
      await this.docker.createService(serviceSpec);

      // Ensure the service is attached to the ide-network
      // Dockerode sometimes doesn't apply Networks correctly during creation, so we update it
      try {
        // Wait a moment for service to be fully created
        await new Promise((resolve) => setTimeout(resolve, 500));
        
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
        s3Bucket: containerConfig.s3Bucket,
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
