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

For deploying to a cloud server (e.g., Hetzner) without HTTPS, see [HETZNER_DEPLOYMENT.md](./HETZNER_DEPLOYMENT.md).

The deployment uses:
- Docker Swarm for orchestration
- Traefik for reverse proxying and routing
- HTTP-only configuration (no SSL certificates required)

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

### Manual Deployment

If you prefer manual setup:

```bash
./scripts/init-swarm.sh
./scripts/deploy-http.sh
```
