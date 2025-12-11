# IDE Container Orchestration

## Local Development Instructions

First, build the IDE container image:

```bash
cd classla-ide-container
docker build -t classla-ide-container:latest .
```

# run individual container

this is good for testing individual behavior of the container itself.

```bash
docker run -d \
  -p 6080:6080 \
  -p 8080:8080 \
  -p 3000:3000 \
  -e VNC_PASSWORD=test123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=true \
  --name test-ide \
  classla-ide-container
```

# running docker swarm

This is what production will run on (with SSL of course.)
Start docker swarm:

```bash
docker swarm init
```

Start Traefik local:

```bash
cd classla-ide-container/orchestration
./scripts/deploy-traefik-local.sh
```

start the IDE container orchestration API:

```bash
cd classla-ide-container/orchestration
npm start
```

Open `test-ide.html` in your browser to test the full flow.

Note: If you do not have an s3 bucket already, the backend needs to be running for `test-ide.html` to be able to create a bucket for you. You start the backend with

```bash
cd classla-ide-container/backend
npm start
```

## Production Deployment

The deployment uses:
- **Docker Swarm** for orchestration
- **Traefik v2.11** for reverse proxying and routing
- **Path-based routing** (`/code/<container-id>`, `/vnc/<container-id>`)
- **HTTPS support** with Let's Encrypt (when DOMAIN is configured)
- **Optimized for fast startup** (<5 seconds from request to accessible)

### Performance Optimizations

The system has been optimized to achieve **<5 second container startup time**:

1. **Health Monitoring**: 5-second check interval (was 30s) with 2-second quick check
2. **Traefik Discovery**: 2-second polling (was 15s default)
3. **Code-Server**: Starts immediately before other setup tasks
4. **S3 Sync**: Non-blocking background process
5. **Network Attachment**: Reduced delay to 100ms
6. **Image Pre-pulling**: Images cached on all Swarm nodes

### Quick Start (Recommended)

For a fresh server, use the automated setup script:

```bash
cd classla-ide-container
./start.sh
```

This script will:
- Install Docker if needed
- Initialize Docker Swarm
- Create the overlay network
- Set up environment variables
- Build and deploy everything
- **Auto-detect HTTP vs HTTPS** based on DOMAIN configuration

**HTTPS Setup:**
- Set `DOMAIN=yourdomain.com` in `orchestration/.env`
- Ensure DNS points to your server
- The script will automatically use `docker-compose.https.yml`

**HTTP Setup:**
- Leave `DOMAIN` unset or set to IP address
- The script will use `docker-compose.http.yml`

### Manual Deployment

If you prefer manual setup:

```bash
# Initialize Swarm
./scripts/init-swarm.sh

# Deploy (HTTP)
./scripts/deploy-http.sh

# OR Deploy (HTTPS)
./scripts/deploy-traefik.sh
```
