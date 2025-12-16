# IDE Container Orchestration

Orchestration system for managing IDE containers with pre-warmed queue support for near-instant startup.

## Features

- **Pre-warmed Container Queue**: Maintains a pool of ready containers for instant startup (<1s)
- **Docker Swarm Integration**: Scalable container orchestration
- **Traefik Routing**: Automatic reverse proxy with path-based routing
- **Health Monitoring**: Automatic health checks and status tracking
- **S3 Workspace Sync**: Automatic bidirectional sync with S3 buckets

## Local Development

### Prerequisites

- Docker Desktop (with Swarm mode)
- Node.js 18+
- IDE container image built

### Quick Start

1. **Initialize Docker Swarm and deploy Traefik:**
   ```bash
   ./scripts/setup-local.sh
   ```

2. **Build the IDE container image:**
   ```bash
   cd ..
   docker build -t classla-ide-container:latest .
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (see ENVIRONMENT_VARIABLES.md)
   ```

4. **Start the orchestration API:**
   ```bash
   npm install
   npm start
   ```

5. **Test container creation:**
   ```bash
   curl -X POST http://localhost:3001/api/containers/start \
     -H "Authorization: Bearer test-api-key-12345" \
     -H "Content-Type: application/json" \
     -d '{"s3Bucket": "test-bucket", "s3Region": "us-east-1"}'
   ```

6. **Access container:**
   - VS Code: `http://localhost/code/<container-id>`
   - VNC Desktop: `http://localhost/vnc/<container-id>`
   - Web Server: `http://localhost/web/<container-id>`

### Pre-warmed Queue

The system automatically maintains a queue of pre-warmed containers (default: 10). When a container is requested:

1. If a pre-warmed container is available, it's assigned the S3 bucket instantly (<1s)
2. If not available, a new container is created (fallback, ~15s)
3. The queue maintainer automatically spawns replacements

Queue size is configurable via `PRE_WARMED_QUEUE_SIZE` in `.env`.

## Production Deployment

### Prerequisites

- Linux server with Docker installed
- Domain name with DNS configured
- SSL certificate (Let's Encrypt via Traefik)

### Deployment Steps

1. **Initialize Docker Swarm:**
   ```bash
   docker swarm init --advertise-addr <your-server-ip>
   ```

2. **Create overlay network:**
   ```bash
   docker network create --driver overlay --attachable ide-network
   ```

3. **Build and push IDE container image:**
   ```bash
   docker build -t your-registry/classla-ide-container:latest .
   docker push your-registry/classla-ide-container:latest
   ```

4. **Configure environment:**
   ```bash
   # Set in .env or environment variables
   DOMAIN=yourdomain.com
   API_KEY=your-secure-api-key
   AWS_ACCESS_KEY_ID=your-aws-key
   AWS_SECRET_ACCESS_KEY=your-aws-secret
   PRE_WARMED_QUEUE_SIZE=10
   ```

5. **Deploy Traefik (HTTPS):**
   ```bash
   ./scripts/deploy-traefik.sh
   ```

6. **Build orchestration API:**
   ```bash
   docker build -t ide-orchestration-api:latest -f Dockerfile .
   ```

7. **Deploy orchestration API:**
   ```bash
   ./scripts/deploy-http.sh  # or deploy-traefik.sh for HTTPS
   ```

8. **Start the API service:**
   ```bash
   docker stack deploy -c docker-compose.http.yml ide-management
   ```

### SSL/HTTPS Configuration

Traefik automatically handles SSL certificates via Let's Encrypt when `DOMAIN` is set to a domain name (not IP).

Required environment variables:
- `DOMAIN`: Your domain name
- `ACME_EMAIL`: Email for Let's Encrypt certificates

Traefik will automatically:
- Obtain SSL certificates
- Renew certificates automatically
- Route traffic via HTTPS

### Access URLs (Production)

- Management API: `https://api.yourdomain.com`
- IDE Containers: `https://yourdomain.com/code/<container-id>`
- VNC Access: `https://yourdomain.com/vnc/<container-id>`
- Traefik Dashboard: `https://traefik.yourdomain.com`

## Configuration

See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) for all configuration options.

Key settings:
- `PRE_WARMED_QUEUE_SIZE`: Number of pre-warmed containers (default: 10)
- `RESOURCE_CPU_LIMIT`: CPU limit per container (default: 2 cores)
- `RESOURCE_MEMORY_LIMIT`: Memory limit per container (default: 4GB)
- `MAX_MEMORY_PERCENT`: System memory threshold (default: 90%)

## Monitoring

- **Health Check**: `GET /api/health`
- **Container List**: `GET /api/containers`
- **Container Details**: `GET /api/containers/:id`
- **Dashboard**: `http://localhost:3001/dashboard` (local) or via Traefik (production)

## Troubleshooting

- **Containers not starting**: Check resource limits and system memory
- **Queue not populating**: Verify resource thresholds allow spawning
- **Traefik routing issues**: Check service labels and network configuration
- **SSL certificate issues**: Verify DNS points to server and ports 80/443 are open

## Architecture

- **Queue Manager**: Tracks pre-warmed and assigned containers
- **Queue Maintainer**: Background service that maintains queue size
- **Container Service**: Creates and manages Docker Swarm services
- **Health Monitor**: Monitors container health and availability
- **Resource Monitor**: Enforces system resource limits
