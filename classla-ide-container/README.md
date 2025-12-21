# Classla IDE Container

A complete cloud-based development environment with VS Code, VNC desktop, and S3 workspace synchronization. Designed for instant startup via pre-warmed container queues.

## Features

- **VS Code (code-server)**: Full VS Code experience in your browser
- **VNC Desktop**: Remote desktop access with noVNC web client
- **Web Server API**: Execute code remotely via HTTP API
- **S3 Workspace Sync**: Bidirectional sync with S3 buckets
- **Pre-warmed Queue**: Near-instant container startup (<1 second)
- **Auto-shutdown**: Automatic shutdown after inactivity (configurable timeout)
- **Pre-installed Languages**: Python 3.10, Node.js 18, Java 17

## Quick Start

### Prerequisites

- Docker Desktop (for local development) or Docker Engine (for production)
- Docker Swarm mode enabled
- AWS credentials (for S3 workspace sync)

### Build and Start

```bash
# Build all Docker images (detects platform automatically)
./build.sh

# Start the system (initializes Swarm, creates network, deploys services)
./start.sh
```

That's it! The system will:
- Initialize Docker Swarm if needed
- Create the overlay network
- Deploy Traefik reverse proxy
- Deploy the management API
- Start the pre-warmed container queue

### Access Points

- **Management API**: http://localhost/api/health
- **Dashboard**: http://localhost/dashboard
- **Traefik Dashboard**: http://localhost:8080
- **IDE Containers**: http://localhost/code/<container-id>
- **VNC Desktop**: http://localhost/vnc/<container-id>

## Usage

### Start a Container

```bash
curl -X POST http://localhost/api/containers/start \
  -H "Authorization: Bearer test-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "s3Bucket": "my-workspace-bucket",
    "awsAccessKeyId": "your-key",
    "awsSecretAccessKey": "your-secret"
  }'
```

### Stop a Container

```bash
curl -X POST http://localhost/api/containers/<container-id>/stop \
  -H "Authorization: Bearer test-api-key-12345"
```

### List Containers

```bash
curl http://localhost/api/containers \
  -H "Authorization: Bearer test-api-key-12345"
```

## Pre-warmed Queue

The system maintains a queue of ready containers for instant startup:

- **Default size**: 1 container (configurable via `PRE_WARMED_QUEUE_SIZE`)
- **Startup time**: <1 second (vs ~15s without queue)
- **Auto-replenishment**: Queue automatically refills when containers are used

When you request a container:
1. If a pre-warmed container is available, it's assigned instantly
2. The S3 bucket is synced to the container
3. A new container is spawned to replace it in the queue

## Configuration

### Environment Variables

Key settings in `orchestration/docker-compose.yml`:

- `PRE_WARMED_QUEUE_SIZE`: Number of pre-warmed containers (default: 1)
- `INACTIVITY_TIMEOUT_SECONDS`: Auto-shutdown timeout (default: 30s for local, 600s for production)
- `NODE_ENV`: Environment mode (`local` for 30s timeout, `production` for 10min)
- `API_KEY`: API authentication key

### Container Environment Variables

- `S3_BUCKET`: S3 bucket name for workspace
- `S3_REGION`: AWS region (default: `us-east-1`)
- `VNC_PASSWORD`: VNC password (default: `vncpassword`)
- `INACTIVITY_TIMEOUT_SECONDS`: Inactivity timeout in seconds
- `MANAGEMENT_API_URL`: Management API URL for shutdown webhook
- `CONTAINER_ID`: Container identifier

## Architecture

### Components

1. **IDE Container** (`classla-ide-container:latest`)
   - VS Code server (port 8080)
   - VNC desktop (port 6080)
   - Web server API (port 3000)
   - S3 sync service
   - Inactivity monitor

2. **Management API** (`ide-orchestration-api:latest`)
   - Container lifecycle management
   - Pre-warmed queue management
   - Health monitoring
   - Resource monitoring

3. **Traefik** (reverse proxy)
   - Automatic service discovery
   - Path-based routing
   - Load balancing

### Pre-warmed Queue Flow

```
Request Container
    ↓
Check Queue
    ↓
[Available?] → Yes → Assign S3 Bucket → Container Ready (<1s)
    ↓ No
Create New Container → Wait for Ready (~15s)
    ↓
Queue Maintainer → Spawn Replacement
```

## Development

### Local Development

```bash
# Build images
./build.sh

# Start services
./start.sh

# View logs
docker service logs ide-local_management-api -f
docker service logs ide-local_traefik -f

# Stop services
docker stack rm ide-local
```

### Testing

```bash
# Test health endpoint
curl http://localhost/api/health

# Test queue stats
curl http://localhost/api/dashboard/api/queue/stats

# Create test container
curl -X POST http://localhost/api/containers/start \
  -H "Authorization: Bearer test-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"s3Bucket": "test-bucket"}'
```

## Production Deployment

For production deployment, see `orchestration/README.md` for detailed instructions including:
- HTTPS/SSL configuration
- Multi-node Swarm setup
- Resource limits
- Monitoring and observability

## Troubleshooting

### Containers Not Starting

- Check Docker resources: `docker system df`
- Verify Swarm is active: `docker info | grep Swarm`
- Check service logs: `docker service logs ide-local_management-api`

### Queue Not Populating

- Check resource thresholds: `docker stats`
- Verify `PRE_WARMED_QUEUE_SIZE` is set correctly
- Check management API logs for errors

### Inactivity Shutdown Not Working

- Verify `INACTIVITY_TIMEOUT_SECONDS` is set
- Check container logs: `docker service logs ide-<container-id>`
- Verify `MANAGEMENT_API_URL` and `CONTAINER_ID` are set in container

## License

See LICENSE file for details.
