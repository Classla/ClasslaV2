# IDE Container Orchestration

Orchestration system for managing IDE containers with Docker Swarm, featuring pre-warmed container queues for near-instant startup.

## Features

- **Pre-warmed Container Queue**: Maintains ready containers for <1s startup
- **Docker Swarm Integration**: Scalable container orchestration
- **Traefik Routing**: Automatic reverse proxy with path-based routing
- **Health Monitoring**: Automatic health checks and status tracking
- **Resource Management**: CPU and memory limits and monitoring
- **Auto-shutdown**: Configurable inactivity timeout with webhook notification
- **S3 Workspace Sync**: Automatic bidirectional sync with S3 buckets

## Quick Start

### Local Development

```bash
# From the root directory
cd classla-ide-container

# Build all images
./build.sh

# Start everything
./start.sh
```

The system will:
1. Initialize Docker Swarm (if needed)
2. Create overlay network
3. Deploy Traefik reverse proxy
4. Deploy management API
5. Start pre-warmed queue (1 container by default)

### Access

- **Management API**: http://localhost/api/health
- **Dashboard**: http://localhost/dashboard
- **Traefik Dashboard**: http://localhost:8080
- **Queue Stats**: http://localhost/api/dashboard/api/queue/stats

## Architecture

### Components

1. **Management API** (`ide-orchestration-api:latest`)
   - RESTful API for container management
   - Queue manager and maintainer
   - Health and resource monitoring
   - Container lifecycle management

2. **IDE Containers** (`classla-ide-container:latest`)
   - VS Code server
   - VNC desktop
   - Web server API
   - S3 sync service
   - Inactivity monitor

3. **Traefik** (reverse proxy)
   - Service discovery
   - Path-based routing
   - Load balancing

### Pre-warmed Queue System

The queue system maintains a pool of ready containers:

```
┌─────────────────┐
│  Queue Manager  │
│  (Maintainer)   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼───┐
│ Ready │ │Ready │  Pre-warmed containers
│       │ │      │  (no S3 bucket assigned)
└───┬───┘ └──┬───┘
    │        │
    └───┬────┘
        │
    Request → Assign S3 → Container Ready (<1s)
```

**Flow:**
1. Queue maintainer spawns pre-warmed containers
2. Containers wait for S3 bucket assignment
3. On request, container is assigned S3 bucket instantly
4. Queue maintainer spawns replacement

## Configuration

### Environment Variables

Key settings in `docker-compose.yml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PRE_WARMED_QUEUE_SIZE` | Number of pre-warmed containers | `1` |
| `INACTIVITY_TIMEOUT_SECONDS` | Auto-shutdown timeout | `30` (local), `600` (production) |
| `NODE_ENV` | Environment mode | `local` |
| `API_KEY` | API authentication key | `test-api-key-12345` |
| `AWS_REGION` | AWS region | `us-east-1` |

### Local vs Production

**Local** (`NODE_ENV=local`):
- 30-second inactivity timeout
- HTTP only (no HTTPS)
- Simplified configuration

**Production** (`NODE_ENV=production`):
- 10-minute inactivity timeout
- HTTPS with Let's Encrypt
- Full security features

## API Endpoints

### Container Management

```bash
# Start container
POST /api/containers/start
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "s3Bucket": "my-bucket",
  "awsAccessKeyId": "optional",
  "awsSecretAccessKey": "optional"
}

# Stop container
POST /api/containers/:id/stop
Authorization: Bearer <api-key>

# List containers
GET /api/containers
Authorization: Bearer <api-key>

# Get container details
GET /api/containers/:id
Authorization: Bearer <api-key>
```

### Queue Management

```bash
# Get queue statistics
GET /api/dashboard/api/queue/stats

# Response:
{
  "total": 1,
  "preWarmed": 1,
  "assigned": 0,
  "target": 1
}
```

### Health Check

```bash
GET /api/health

# Response:
{
  "status": "healthy",
  "timestamp": "2025-12-18T..."
}
```

## Monitoring

### Service Status

```bash
# List all services
docker service ls

# Service logs
docker service logs ide-local_management-api -f
docker service logs ide-local_traefik -f

# Container logs
docker service logs ide-<container-id> -f
```

### Queue Status

```bash
# Check queue stats
curl http://localhost/api/dashboard/api/queue/stats

# Check container list
curl http://localhost/api/containers \
  -H "Authorization: Bearer test-api-key-12345"
```

### Resource Usage

```bash
# System resources
docker stats

# Service resource usage
docker service ps ide-local_management-api --no-trunc
```

## Inactivity Shutdown

Containers automatically shut down after a period of inactivity:

1. **Monitor**: Inactivity monitor watches for file changes
2. **Timeout**: After timeout (30s local, 10min production), shutdown is triggered
3. **Webhook**: Container calls management API to report shutdown
4. **Cleanup**: Management API stops Docker service and updates state

**Configuration:**
- `INACTIVITY_TIMEOUT_SECONDS`: Timeout in seconds
- `NODE_ENV`: Determines default timeout (local=30s, production=600s)
- `MANAGEMENT_API_URL`: API URL for shutdown webhook
- `CONTAINER_ID`: Container identifier

## Production Deployment

### Prerequisites

- Linux server with Docker installed
- Domain name with DNS configured
- SSL certificate (Let's Encrypt via Traefik)

### Deployment Steps

1. **Initialize Swarm:**
   ```bash
   docker swarm init --advertise-addr <server-ip>
   ```

2. **Create Network:**
   ```bash
   docker network create --driver overlay --attachable ide-network
   ```

3. **Build Images:**
   ```bash
   ./build.sh
   ```

4. **Configure Environment:**
   - Set `DOMAIN` to your domain name
   - Set `API_KEY` to a secure key
   - Configure AWS credentials
   - Set `NODE_ENV=production`

5. **Deploy:**
   ```bash
   docker stack deploy -c docker-compose.yml ide-management
   ```

### HTTPS Configuration

Traefik automatically handles SSL certificates via Let's Encrypt when `DOMAIN` is set to a domain name.

Required:
- `DOMAIN`: Your domain name
- `ACME_EMAIL`: Email for Let's Encrypt certificates
- Ports 80 and 443 open in firewall

## Troubleshooting

### Containers Not Starting

- **Check resources**: `docker system df`
- **Check logs**: `docker service logs ide-local_management-api`
- **Verify Swarm**: `docker info | grep Swarm`
- **Check network**: `docker network ls | grep ide-network`

### Queue Not Populating

- **Check resource thresholds**: System may be at capacity
- **Verify configuration**: `PRE_WARMED_QUEUE_SIZE` set correctly
- **Check logs**: Queue maintainer logs in management API

### Inactivity Shutdown Not Working

- **Verify timeout**: Check `INACTIVITY_TIMEOUT_SECONDS` in container
- **Check webhook**: Verify `MANAGEMENT_API_URL` is accessible from container
- **Check logs**: Container logs should show "Notifying management API"
- **Verify endpoint**: Test webhook endpoint manually

### Traefik Routing Issues

- **Check labels**: Verify service labels are correct
- **Check network**: Ensure services are on `ide-network`
- **Check Traefik logs**: `docker service logs ide-local_traefik`

## Scripts

### Available Scripts

- `build.sh`: Build all Docker images (platform detection)
- `start.sh`: Start the entire system
- `orchestration/scripts/cleanup.sh`: Remove stack and clean up
- `orchestration/scripts/init-swarm.sh`: Initialize Docker Swarm
- `orchestration/scripts/create-network.sh`: Create overlay network

### Additional Scripts (not used by build.sh/start.sh)

The following scripts are available for manual deployment but not used by `build.sh`/`start.sh`:
- `orchestration/scripts/deploy.sh`: Production deployment
- `orchestration/scripts/deploy-http.sh`: HTTP deployment
- `orchestration/scripts/deploy-traefik.sh`: Traefik deployment
- `orchestration/scripts/deploy-traefik-local.sh`: Local Traefik
- `orchestration/scripts/setup-local.sh`: Local setup

## Development

### Project Structure

```
orchestration/
├── src/
│   ├── services/        # Core services (queue, health, resources)
│   ├── routes/          # API routes
│   ├── middleware/       # Auth, rate limiting, error handling
│   └── config/          # Configuration
├── docker-compose.yml  # Unified stack (local and production)
├── Dockerfile           # Management API image
└── scripts/             # Deployment scripts
```

### Building

```bash
# Build TypeScript
npm run build

# Build Docker image
docker build -t ide-orchestration-api:latest .
```

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## License

See LICENSE file for details.
