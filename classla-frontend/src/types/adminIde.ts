export interface ContainerInfo {
  id: string;
  serviceName: string;
  status: "starting" | "running" | "stopping" | "stopped" | "failed";
  urls: {
    codeServer?: string;
    vnc?: string;
    webServer?: string;
  };
  s3Bucket?: string;
  s3Region?: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  lastActivity?: string;
  shutdownReason?: string;
  resourceLimits?: {
    cpuLimit: string;
    memoryLimit: string;
  };
  isPreWarmed?: boolean;
}

export interface SystemResources {
  cpu: {
    usage: number;
    available: number;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
}

export interface DashboardOverview {
  timestamp: string;
  containers: {
    total: number;
    running: number;
    starting: number;
    stopped: number;
    failed: number;
    averageUptime: number; // in seconds
  };
  resources: SystemResources;
}

export interface QueueStats {
  timestamp: string;
  preWarmed: number;
  assigned: number;
  running: number;
  total: number;
  targetSize: number;
  withS3Bucket: number;
}
