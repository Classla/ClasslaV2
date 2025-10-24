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
  disk?: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  containers: {
    running: number;
    stopped: number;
    total: number;
  };
}

export interface OverviewData {
  resources: SystemResources;
  timestamp: string;
}

export interface NodeInfo {
  id: string;
  hostname: string;
  role: "manager" | "worker";
  status: "ready" | "down" | "unknown";
  availability: "active" | "pause" | "drain";
  address: string;
  resources: {
    cpu: {
      usage: number;
      total: number;
    };
    memory: {
      usage: number;
      total: number;
      usagePercent: number;
    };
    disk?: {
      usage: number;
      total: number;
      usagePercent: number;
    };
  };
  containerCount: number;
  labels?: Record<string, string>;
}

export interface NodesData {
  nodes: NodeInfo[];
  timestamp: string;
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
  createdAt: string;
  lastActivity?: string;
  uptime?: number;
  health?: {
    status: "healthy" | "unhealthy" | "starting";
    lastCheck: string;
    checks: {
      codeServer: boolean;
      vnc: boolean;
      webServer: boolean;
    };
  };
  resourceUsage?: {
    cpu: number;
    memory: number;
  };
}

export interface ContainersData {
  containers: ContainerInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  containerId?: string;
  nodeId?: string;
  message: string;
}
