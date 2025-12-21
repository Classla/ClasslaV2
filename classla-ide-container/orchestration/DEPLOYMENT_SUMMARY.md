# Deployment Summary: M1 Mac vs Hetzner

## Quick Answer

**Yes, there are differences**, but they're minimal. The main differences are:

1. **Architecture**: M1 Mac is ARM64, Hetzner is x86_64
2. **Network**: Use public IP or domain instead of localhost
3. **HTTPS**: You're skipping HTTPS, so use the HTTP-only configuration

## What's Different

### 1. Architecture (ARM64 vs x86_64)

**M1 Mac (Local)**:
- Native ARM64 architecture
- Docker images built for ARM64 work directly

**Hetzner (Cloud)**:
- x86_64 (amd64) architecture
- **Solution**: Build images directly on Hetzner server, or use `--platform linux/amd64` when building

### 2. Network Configuration

**M1 Mac (Local)**:
- Uses `localhost` and `.localhost` domains
- No firewall concerns
- Services accessible at `http://localhost:8080`

**Hetzner (Cloud)**:
- Uses public IP address or domain name
- Must configure firewall (open ports 80, 8080)
- Services accessible at `http://YOUR_SERVER_IP` or `http://your-domain.com`

### 3. HTTPS/SSL

**M1 Mac (Local)**:
- HTTP only for development (`deploy-traefik-local.sh`)

**Hetzner (Cloud - Your Setup)**:
- HTTP only (no SSL certificates)
- Use `deploy-http.sh` or `./start.sh` (local mode)

**Production**:
- HTTPS with Let's Encrypt
- Use `./start.sh --production` or `deploy.sh` with unified `docker-compose.yml`

## Scripts Overview

### Essential Scripts (Used)

- **`init-swarm.sh`** - Initialize Docker Swarm (run first)
- **`deploy-http.sh`** - Deploy with HTTP only (for Hetzner)
- **`deploy.sh`** - Deploy with HTTPS (for production with SSL)
- **`cleanup.sh`** - Remove deployment and clean up

### Traefik-Specific Scripts

- **`deploy-traefik-local.sh`** - Local dev (HTTP only)
- **`deploy-traefik.sh`** - Production Traefik (HTTPS)

### Utility Scripts

- **`create-network.sh`** - Create overlay network (called by other scripts)

## Deployment Files

### Docker Compose Files

1. **`docker-compose.yml`** - Unified compose file for both local and production
   - Local mode: HTTP only, localhost
   - Production mode: HTTPS with Let's Encrypt, ide.classla.org
   - Controlled via `./start.sh --production` flag or environment variables

## Step-by-Step: Hetzner Deployment

```bash
# 1. SSH into your Hetzner server
ssh user@your-hetzner-ip

# 2. Clone repository
git clone <your-repo>
cd ClasslaV2/classla-ide-container/orchestration

# 3. Initialize Swarm
./scripts/init-swarm.sh

# 4. Create .env file
# (See HETZNER_DEPLOYMENT.md for required variables)

# 5. Deploy (HTTP only)
./scripts/deploy-http.sh
```

## Key Configuration Differences

### .env File

**Local (M1 Mac)**:
```bash
DOMAIN=localhost
# No SERVER_IP needed
```

**Hetzner**:
```bash
DOMAIN=your-domain.com  # Optional
SERVER_IP=your.hetzner.ip.address  # Recommended
API_KEYS=your-api-key
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Firewall Configuration (Hetzner)

```bash
# Allow HTTP traffic
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp  # For Traefik dashboard
sudo ufw enable
```

## Access URLs

**Local (M1 Mac)**:
- API: `http://localhost:3001`
- Dashboard: `http://localhost:3001`
- Traefik: `http://localhost:8080`

**Hetzner**:
- API: `http://YOUR_SERVER_IP` or `http://api.your-domain.com`
- Dashboard: `http://YOUR_SERVER_IP` or `http://dashboard.your-domain.com`
- Traefik: `http://YOUR_SERVER_IP:8080`

## Troubleshooting

### Architecture Issues

If you see architecture errors:
```bash
# Build directly on Hetzner (recommended)
docker build -t ide-orchestration-api:latest -f Dockerfile .

# Or from Mac with buildx
docker buildx build --platform linux/amd64 -t ide-orchestration-api:latest -f Dockerfile --load .
```

### Port Already in Use

```bash
# Check what's using port 80
sudo lsof -i :80
# Or
sudo netstat -tulpn | grep :80
```

### Services Not Starting

```bash
# Check service status
docker stack services ide-management

# Check logs
docker service logs ide-management_management-api -f
docker service logs ide-management_traefik -f
```

## Summary

**For Hetzner deployment without HTTPS:**

1. ✅ Use `deploy-http.sh` or `./start.sh` (local mode)
2. ✅ Uses unified `docker-compose.yml` (automatically configured for HTTP mode)
3. ✅ Build images on Hetzner server (or use `--platform linux/amd64`)
4. ✅ Configure firewall (ports 80, 8080)
5. ✅ Set `SERVER_IP` in `.env` (or let script auto-detect)

**For production deployment with HTTPS:**

1. ✅ Use `./start.sh --production` or `deploy.sh`
2. ✅ Uses unified `docker-compose.yml` (automatically configured for HTTPS mode)
3. ✅ Set `DOMAIN=ide.classla.org` and `ACME_EMAIL` in `.env`
4. ✅ Configure firewall (ports 80, 443)
5. ✅ Ensure DNS is pointing to your server

**Everything else is the same!** Traefik handles all the routing and reverse proxying the same way on both platforms.
