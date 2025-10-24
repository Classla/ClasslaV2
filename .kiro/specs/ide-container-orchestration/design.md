# Design Document

## Overview

The IDE Container Orchestration system is a Node.js/Express-based management API that orchestrates multiple IDE containers on a VPS using Docker Swarm and Traefik. The system provides REST endpoints to dynamically create, manage, and destroy isolated development environments, each with its own S3-backed workspace. Traefik handles automatic service discovery and routing, providing unique subdomains for each container's services.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Internet                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Traefik (Port 80/443)                     │
│  - SSL/TLS Termination                                       │
│  - Automatic Service Discovery                               │
│  - Dynamic Routing Rules                                     │
└─────┬───────────────────────────────────────────────────────┘
      │
      ├──────────────────┬──────────────────┬─────────────────┐
      ▼                  ▼                  ▼                 ▼
┌──────────┐   ┌──────────────────┐   ┌──────────────────┐  ...
│ Mgmt API │   │  IDE Container 1 │   │  IDE Container 2 │
│ (Port    │   │  - noVNC (6080)  │   │  - noVNC (6080)  │
│  3001)   │   │  - code-server   │   │  - code-server   │
│          │   │    (8080)        │   │    (8080)        │
│          │   │  - web (3000)    │   │  - web (3000)    │
└────┬─────┘   └────────┬─────────┘   └────────┬─────────┘
     │                  │                      │
     ▼                  ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│              Docker Swarm Manager                         │
│  - Service Orchestration                                  │
│  - Health Checks                                          │
│  - Resource Management                                    │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                    AWS S3                                 │
│  - Workspace Persistence                                  │
│  - Per-Container Buckets                                  │
└──────────────────────────────────────────────────────────┘
```

### Component Architecture

```
Management API (Node.js/Express)
├── Routes
│   ├── POST   /api/containers/start
│   ├── GET    /api/containers
│   ├── GET    /api/containers/:id
│   ├── DELETE /api/containers/:id
│   ├── GET    /api/health
│   ├── GET    /dashboard (serve dashboard UI)
│   ├── GET    /api/dashboard/overview
│   ├── GET    /api/dashboard/nodes
│   ├── GET    /api/dashboard/logs (SSE)
│   └── POST   /api/dashboard/container/:id/action
├── Services
│   ├── ContainerService (Docker Swarm operations)
│   ├── TraefikService (Label generation)
│   ├── StateManager (Container metadata storage)
│   ├── ResourceMonitor (System resource tracking)
│   └── NodeMonitor (Per-node metrics)
├── Middleware
│   ├── AuthMiddleware (API key validation)
│   └── ErrorHandler (Centralized error handling)
├── Models
│   └── Container (Metadata structure)
└── Dashboard (React SPA)
    ├── pages/
    │   ├── Overview.tsx
    │   ├── Nodes.tsx
    │   ├── Containers.tsx
    │   └── Logs.tsx
    └── components/
        ├── MetricsCard.tsx
        ├── NodeCard.tsx
        ├── ContainerTable.tsx
        └── LogViewer.tsx
```

## Components and Interfaces

### 1. Management API Server

**Technology:** Node.js with Express

**Responsibilities:**

- Handle HTTP requests for container management
- Interact with Docker Swarm API
- Track container state and metadata
- Monitor system resources
- Enforce authentication

**Key Files:**

```
classla-ide-container/orchestration/
├── src/
│   ├── server.ts                 # Express app setup
│   ├── routes/
│   │   ├── containers.ts         # Container management endpoints
│   │   ├── dashboard.ts          # Dashboard API endpoints
│   │   └── health.ts             # Health check endpoint
│   ├── services/
│   │   ├── containerService.ts   # Docker Swarm operations
│   │   ├── traefikService.ts     # Traefik label generation
│   │   ├── stateManager.ts       # Container state persistence
│   │   ├── resourceMonitor.ts    # System resource monitoring
│   │   └── nodeMonitor.ts        # Per-node metrics
│   ├── middleware/
│   │   ├── auth.ts               # API key authentication
│   │   └── errorHandler.ts       # Error handling
│   ├── models/
│   │   └── container.ts          # Container metadata model
│   └── config/
│       └── index.ts              # Configuration management
├── dashboard/                     # React dashboard
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Overview.tsx
│   │   │   ├── Nodes.tsx
│   │   │   ├── Containers.tsx
│   │   │   └── Logs.tsx
│   │   └── components/
│   │       ├── MetricsCard.tsx
│   │       ├── NodeCard.tsx
│   │       ├── ContainerTable.tsx
│   │       └── LogViewer.tsx
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── SETUP.md                  # Complete setup guide
│   ├── QUICKSTART.md             # 5-minute quick start
│   ├── TROUBLESHOOTING.md        # Common issues
│   ├── SCALING.md                # Adding nodes guide
│   └── API.md                    # API documentation
├── package.json
├── tsconfig.json
└── Dockerfile                     # Management API container
```

### 2. Docker Swarm Service Manager

**Technology:** Dockerode (Docker API client for Node.js)

**Responsibilities:**

- Create Docker Swarm services for IDE containers
- Apply resource limits and constraints
- Manage service lifecycle
- Query service status and health

**Interface:**

```typescript
interface ContainerService {
  createContainer(config: ContainerConfig): Promise<ContainerInfo>;
  stopContainer(containerId: string): Promise<void>;
  getContainer(containerId: string): Promise<ContainerInfo | null>;
  listContainers(filter?: ContainerFilter): Promise<ContainerInfo[]>;
  getContainerLogs(containerId: string): Promise<string>;
}

interface ContainerConfig {
  s3Bucket: string;
  s3Region?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  vncPassword?: string;
  domain: string;
}

interface ContainerInfo {
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
```

### 3. Traefik Configuration

**Technology:** Traefik v2.x with Docker provider

**Responsibilities:**

- Automatic service discovery via Docker labels
- Dynamic routing rule generation
- SSL/TLS certificate management (Let's Encrypt)
- Load balancing and health checks

**Configuration:**

```yaml
# traefik.yml
api:
  dashboard: true
  insecure: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    swarmMode: true
    exposedByDefault: false
    network: ide-network

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

**Docker Labels for IDE Containers:**

```typescript
function generateTraefikLabels(containerId: string, domain: string) {
  return {
    // Enable Traefik
    "traefik.enable": "true",
    "traefik.docker.network": "ide-network",

    // noVNC service (port 6080)
    "traefik.http.routers.vnc-${containerId}.rule": `Host(\`${containerId}-vnc.${domain}\`)`,
    "traefik.http.routers.vnc-${containerId}.entrypoints": "websecure",
    "traefik.http.routers.vnc-${containerId}.tls.certresolver": "letsencrypt",
    "traefik.http.services.vnc-${containerId}.loadbalancer.server.port": "6080",

    // code-server service (port 8080)
    "traefik.http.routers.code-${containerId}.rule": `Host(\`${containerId}-code.${domain}\`)`,
    "traefik.http.routers.code-${containerId}.entrypoints": "websecure",
    "traefik.http.routers.code-${containerId}.tls.certresolver": "letsencrypt",
    "traefik.http.services.code-${containerId}.loadbalancer.server.port":
      "8080",

    // web server service (port 3000)
    "traefik.http.routers.web-${containerId}.rule": `Host(\`${containerId}-web.${domain}\`)`,
    "traefik.http.routers.web-${containerId}.entrypoints": "websecure",
    "traefik.http.routers.web-${containerId}.tls.certresolver": "letsencrypt",
    "traefik.http.services.web-${containerId}.loadbalancer.server.port": "3000",
  };
}
```

### 4. State Management

**Technology:** SQLite or JSON file storage

**Responsibilities:**

- Persist container metadata
- Track container lifecycle events
- Store resource usage history
- Enable container queries and filtering

**Schema:**

```typescript
interface ContainerMetadata {
  id: string;
  serviceName: string;
  s3Bucket: string;
  s3Region: string;
  status: ContainerStatus;
  createdAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  lastActivity?: Date;
  shutdownReason?: "inactivity" | "manual" | "error" | "resource_limit";
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

type ContainerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";
```

### 5. Resource Monitor

**Technology:** Node.js with systeminformation package

**Responsibilities:**

- Monitor VPS CPU and memory usage
- Track per-container resource consumption
- Enforce system-wide resource limits
- Provide resource usage metrics via API

**Interface:**

```typescript
interface ResourceMonitor {
  getSystemResources(): Promise<SystemResources>;
  canStartContainer(): Promise<boolean>;
  getContainerResources(containerId: string): Promise<ContainerResources>;
}

interface SystemResources {
  cpu: {
    usage: number; // Percentage
    available: number; // Cores
  };
  memory: {
    total: number; // Bytes
    used: number; // Bytes
    available: number; // Bytes
    usagePercent: number;
  };
  containers: {
    running: number;
    total: number;
  };
}

interface ContainerResources {
  cpu: number; // Percentage
  memory: number; // Bytes
  memoryPercent: number;
}
```

## Data Models

### Container Configuration

```typescript
interface CreateContainerRequest {
  s3Bucket: string; // Required: S3 bucket ID for workspace
  s3Region?: string; // Optional: AWS region (default: us-east-1)
  vncPassword?: string; // Optional: VNC password (default: random)
  awsAccessKeyId?: string; // Optional: AWS credentials (prefer IAM role)
  awsSecretAccessKey?: string;
}

interface CreateContainerResponse {
  id: string;
  serviceName: string;
  status: "starting";
  urls: {
    vnc: string;
    codeServer: string;
    webServer: string;
  };
  message: string;
}
```

### Container Status

```typescript
interface GetContainerResponse {
  id: string;
  serviceName: string;
  status: ContainerStatus;
  urls: {
    vnc: string;
    codeServer: string;
    webServer: string;
  };
  s3Bucket: string;
  createdAt: string;
  lastActivity?: string;
  uptime?: number; // Seconds
  health?: {
    status: "healthy" | "unhealthy" | "starting";
    lastCheck: string;
    checks: {
      codeServer: boolean;
      vnc: boolean;
      webServer: boolean;
    };
  };
}
```

### List Containers

```typescript
interface ListContainersRequest {
  status?: ContainerStatus;
  limit?: number;
  offset?: number;
}

interface ListContainersResponse {
  containers: GetContainerResponse[];
  total: number;
  limit: number;
  offset: number;
}
```

## Error Handling

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
}
```

### Error Codes

- `CONTAINER_NOT_FOUND`: Container ID does not exist
- `CONTAINER_START_FAILED`: Failed to start container service
- `CONTAINER_STOP_FAILED`: Failed to stop container service
- `RESOURCE_LIMIT_EXCEEDED`: System resources exhausted
- `INVALID_S3_BUCKET`: S3 bucket ID is invalid or inaccessible
- `AUTHENTICATION_FAILED`: Invalid or missing API key
- `DOCKER_ERROR`: Docker daemon error
- `INTERNAL_ERROR`: Unexpected server error

### Error Handling Strategy

1. **Validation Errors (400)**: Return immediately with descriptive message
2. **Authentication Errors (401)**: Return with generic message for security
3. **Resource Errors (503)**: Return with retry-after header
4. **Docker Errors**: Log full error, return sanitized message to client
5. **Unexpected Errors (500)**: Log stack trace, return generic message

## Testing Strategy

### Unit Tests

**Target Coverage:** 80%+

**Test Files:**

```
src/services/__tests__/
├── containerService.test.ts
├── traefikService.test.ts
├── stateManager.test.ts
└── resourceMonitor.test.ts

src/routes/__tests__/
├── containers.test.ts
└── health.test.ts

src/middleware/__tests__/
├── auth.test.ts
└── errorHandler.test.ts
```

**Key Test Scenarios:**

- Container creation with valid/invalid S3 buckets
- Container lifecycle state transitions
- Traefik label generation
- Resource limit enforcement
- API authentication
- Error handling and recovery

### Integration Tests

**Test Scenarios:**

1. **Full Container Lifecycle**

   - Start container → verify URLs → stop container → verify cleanup

2. **Multiple Containers**

   - Start 3 containers → verify isolation → stop all → verify cleanup

3. **Resource Limits**

   - Start containers until resource limit → verify rejection → stop one → verify new start succeeds

4. **Inactivity Shutdown**

   - Start container → wait 10 minutes → verify auto-shutdown → verify S3 sync

5. **Traefik Routing**
   - Start container → verify all 3 URLs accessible → verify SSL certificates

### Manual Testing Checklist

- [ ] Deploy to VPS with Docker Swarm initialized
- [ ] Configure Traefik with Let's Encrypt
- [ ] Start container via API
- [ ] Access noVNC URL in browser
- [ ] Access code-server URL in browser
- [ ] Access web server URL in browser
- [ ] Verify S3 sync working
- [ ] Wait for inactivity shutdown
- [ ] Verify container removed from Swarm
- [ ] Start multiple containers simultaneously
- [ ] Verify resource limits enforced
- [ ] Test API authentication
- [ ] Test error scenarios

## Deployment Architecture

### VPS Setup

**Manager Node Requirements:**

- Ubuntu 22.04 LTS
- 8GB+ RAM
- 4+ CPU cores
- 100GB+ disk space
- Docker 24.x
- Docker Swarm initialized as manager

**Worker Node Requirements (for expansion):**

- Ubuntu 22.04 LTS
- 8GB+ RAM
- 4+ CPU cores
- 100GB+ disk space
- Docker 24.x
- Joined to Swarm as worker

**Network Configuration:**

```
ide-network (overlay network, spans all nodes)
├── Traefik (manager node only)
├── Management API (manager node only)
└── IDE Containers (distributed across all nodes)
```

**Multi-Node Expansion:**

To add a new VPS to the swarm:

1. Install Docker on the new VPS
2. Get join token from manager: `docker swarm join-token worker`
3. Run join command on new VPS
4. Containers will automatically be scheduled across all nodes
5. Traefik will discover services regardless of which node they're on

The overlay network automatically spans all nodes, so no additional configuration is needed for routing.

### Docker Compose for Management Stack

```yaml
version: "3.8"

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.dashboard=true"
      - "--providers.docker.swarmMode=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt
    networks:
      - ide-network
    deploy:
      placement:
        constraints:
          - node.role == manager

  management-api:
    image: ide-orchestration-api:latest
    environment:
      - NODE_ENV=production
      - API_KEY=${API_KEY}
      - DOMAIN=${DOMAIN}
      - AWS_REGION=${AWS_REGION}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - api-data:/app/data
    networks:
      - ide-network
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.api.rule=Host(`api.${DOMAIN}`)"
        - "traefik.http.routers.api.entrypoints=websecure"
        - "traefik.http.routers.api.tls.certresolver=letsencrypt"
        - "traefik.http.services.api.loadbalancer.server.port=3001"

networks:
  ide-network:
    driver: overlay
    attachable: true

volumes:
  traefik-certs:
  api-data:
```

### Environment Variables

```bash
# .env file for management stack
DOMAIN=ide.example.com
API_KEY=your-secure-api-key-here
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=optional-if-using-iam-role
AWS_SECRET_ACCESS_KEY=optional-if-using-iam-role
```

## Security Considerations

### 1. API Authentication

- Use strong API keys (minimum 32 characters)
- Store API keys as environment variables
- Support multiple API keys for different clients
- Implement rate limiting (100 requests/minute per key)

### 2. Container Isolation

- Run containers on isolated overlay network
- No direct container-to-container communication
- All external access through Traefik
- Non-root user inside containers

### 3. S3 Security

- Use IAM roles when possible (avoid hardcoded credentials)
- Enforce bucket policies to restrict access
- Enable S3 bucket encryption
- Use separate buckets per user/project

### 4. SSL/TLS

- Force HTTPS redirects
- Use Let's Encrypt for automatic certificate renewal
- Enable HSTS headers
- Use secure cipher suites

### 5. Resource Protection

- Enforce CPU and memory limits per container
- Implement system-wide resource thresholds
- Monitor for resource exhaustion attacks
- Implement container count limits per API key

## Performance Considerations

### 1. Container Startup Time

- Pre-pull IDE container image on VPS
- Optimize Dockerfile layers for caching
- Use overlay2 storage driver
- Target: < 15 seconds from API call to accessible URLs

### 2. Resource Efficiency

- Set appropriate resource limits (2 CPU, 4GB RAM per container)
- Monitor and tune Swarm scheduler
- Implement container packing strategies
- Use resource reservations for critical services

### 3. Scalability

- Current design: Single VPS (vertical scaling)
- Future: Multi-node Swarm cluster (horizontal scaling)
- Database: SQLite for < 100 containers, PostgreSQL for more
- Consider container placement strategies for multi-node

### 4. Monitoring

- Collect metrics: container count, resource usage, API latency
- Log aggregation for debugging
- Alert on resource thresholds
- Dashboard for system overview

### 5. Multi-Node Scalability

The architecture is designed to support multiple nodes from day one:

- **Overlay Network**: Automatically spans all Swarm nodes, no configuration needed
- **Service Discovery**: Traefik discovers services on any node via Docker Swarm API
- **Zero Code Changes**: Adding nodes requires no application code changes
- **Automatic Load Distribution**: Docker Swarm scheduler distributes containers across nodes
- **Node-Specific Placement**: Can use node labels for advanced placement (e.g., `node.labels.gpu==true`)
- **Resource Aggregation**: ResourceMonitor can query all nodes via Swarm API

**Adding a Worker Node:**

```bash
# On manager node, get join token
docker swarm join-token worker

# On new VPS, join the swarm
docker swarm join --token <token> <manager-ip>:2377

# Verify node joined
docker node ls
```

Containers will automatically be scheduled across all available nodes based on resource availability.

## Monitoring Dashboard

### Web Dashboard Features

A web-based monitoring dashboard will provide real-time visibility into the cluster:

**Dashboard Pages:**

1. **Overview Page**

   - Total containers running/stopped
   - Cluster-wide resource usage (CPU, memory, disk)
   - Per-node resource breakdown
   - Active containers list with status indicators

2. **Node Management Page**

   - List of all Swarm nodes (manager + workers)
   - Per-node metrics: CPU, memory, disk, container count
   - Node health status
   - Add/remove node instructions

3. **Container Management Page**

   - Searchable/filterable container list
   - Start/stop/delete actions
   - Container details: URLs, uptime, resource usage
   - Quick access links to container services

4. **System Logs Page**
   - Real-time log streaming
   - Filter by container, node, or log level
   - Search functionality

**Technology Stack:**

- Frontend: React with Tailwind CSS (matches your existing stack)
- Backend: Same Express API with additional dashboard endpoints
- Real-time Updates: Server-Sent Events (SSE) for live metrics
- Authentication: Same API key system

**Dashboard Endpoints:**

```typescript
GET  /dashboard              # Serve dashboard HTML
GET  /api/dashboard/overview # Cluster overview metrics
GET  /api/dashboard/nodes    # Node list with metrics
GET  /api/dashboard/logs     # Log streaming (SSE)
POST /api/dashboard/container/:id/action  # Quick actions
```

## Setup Guide

A comprehensive setup guide will be included in the repository:

**Guide Structure:**

### 1. Prerequisites

- VPS provider recommendations (DigitalOcean, Linode, Hetzner)
- Domain name and DNS setup
- AWS account for S3 (optional: MinIO for self-hosted)

### 2. Initial VPS Setup

- Ubuntu 22.04 installation
- Docker installation script
- Docker Swarm initialization
- Firewall configuration (ports 80, 443, 2377, 7946, 4789)

### 3. Deploy Management Stack

- Clone repository
- Configure environment variables
- Build and push images
- Deploy with docker stack deploy
- Verify Traefik and API are running

### 4. Configure DNS

- Point wildcard DNS to VPS IP (\*.ide.example.com)
- Verify DNS propagation
- Test Let's Encrypt certificate generation

### 5. First Container Test

- Generate API key
- Make API request to start container
- Verify all three URLs accessible
- Test S3 sync

### 6. Adding Worker Nodes (Optional)

- Provision additional VPS
- Install Docker
- Join to Swarm cluster
- Verify container distribution

### 7. Monitoring and Maintenance

- Access monitoring dashboard
- Set up log rotation
- Configure backup strategy
- Update procedures

**Guide Location:**

```
classla-ide-container/orchestration/
├── docs/
│   ├── SETUP.md              # Complete setup guide
│   ├── QUICKSTART.md         # 5-minute quick start
│   ├── TROUBLESHOOTING.md    # Common issues
│   ├── SCALING.md            # Adding nodes guide
│   └── API.md                # API documentation
```

## Future Enhancements

1. **Advanced Node Placement**: Node affinity rules for specialized workloads (GPU, high-memory, etc.)
2. **User Management**: Add user accounts and per-user container limits
3. **Billing Integration**: Track container usage for billing purposes
4. **Custom Images**: Allow users to specify custom IDE container images
5. **Persistent Volumes**: Option for local persistent volumes in addition to S3
6. **WebSocket Support**: Real-time container status updates via WebSocket
7. **Container Templates**: Pre-configured environments (Python, Node.js, Java, etc.)
8. **Backup/Restore**: Snapshot and restore container workspaces
9. **Collaboration**: Share container access with multiple users
10. **Grafana Integration**: Advanced metrics and alerting
