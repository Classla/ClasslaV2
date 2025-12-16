# Quick Start Guide

Get the IDE container orchestration system running in minutes.

## Local Development

### 1. Setup

```bash
cd orchestration
./scripts/setup-local.sh
```

This will:
- Initialize Docker Swarm
- Create overlay network
- Deploy Traefik for localhost
- Create `.env` file template

### 2. Build IDE Container

```bash
cd ..
docker build -t classla-ide-container:latest .
```

### 3. Start API

```bash
cd orchestration
npm install
npm start
```

The queue maintainer will automatically spawn 10 pre-warmed containers in the background.

### 4. Test

```bash
# Start a container
curl -X POST http://localhost:3001/api/containers/start \
  -H "Authorization: Bearer test-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"s3Bucket": "test-bucket", "s3Region": "us-east-1"}'

# Access container (use container ID from response)
# VS Code: http://localhost/code/<container-id>
# VNC: http://localhost/vnc/<container-id>
```

## Production Deployment

### 1. Server Setup

```bash
# On your server
docker swarm init --advertise-addr <server-ip>
docker network create --driver overlay --attachable ide-network
```

### 2. Configure Environment

```bash
cd orchestration
# Edit .env
DOMAIN=yourdomain.com
API_KEY=your-secure-key
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
PRE_WARMED_QUEUE_SIZE=10
```

### 3. Deploy Traefik (HTTPS)

```bash
./scripts/deploy-traefik.sh
```

This sets up Traefik with Let's Encrypt SSL certificates.

### 4. Build and Deploy

```bash
# Build orchestration API
docker build -t ide-orchestration-api:latest -f Dockerfile .

# Deploy
./scripts/deploy-http.sh  # or deploy-traefik.sh for HTTPS
```

### 5. Access

- API: `https://api.yourdomain.com`
- Containers: `https://yourdomain.com/code/<container-id>`
- Dashboard: `https://yourdomain.com/dashboard`

## Pre-warmed Queue

The system maintains a queue of ready containers for instant startup:

- **Default size**: 10 containers
- **Startup time**: <1 second (vs ~15s without queue)
- **Auto-replenishment**: Queue automatically refills when containers are used

Configure via `PRE_WARMED_QUEUE_SIZE` in `.env`.

## Troubleshooting

- **Memory errors**: Increase Docker Desktop memory or adjust `MAX_MEMORY_PERCENT`
- **Containers not starting**: Check resource limits in `.env`
- **SSL issues**: Verify DNS points to server and ports 80/443 are open
- **Queue not populating**: Check system resources allow spawning containers

## Next Steps

- See `orchestration/README.md` for detailed documentation
- See `orchestration/ENVIRONMENT_VARIABLES.md` for all configuration options
