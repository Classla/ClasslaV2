# Hetzner Deployment Guide (HTTP Only)

This guide covers deploying the IDE Container Orchestration API to a Hetzner cloud server without HTTPS.

## Key Differences from M1 Mac Local Development

### 1. Architecture
- **M1 Mac**: ARM64 architecture
- **Hetzner**: x86_64 (amd64) architecture
- **Solution**: Build images directly on the Hetzner server, or use `--platform linux/amd64` when building

### 2. Network Access
- **Local**: Uses `localhost` and `.localhost` domains
- **Hetzner**: Uses public IP address or domain name
- **Solution**: Configure `SERVER_IP` in `.env` or use domain name

### 3. HTTPS/SSL
- **Local**: HTTP only for development
- **Production**: Typically HTTPS with Let's Encrypt
- **This Guide**: HTTP only (no SSL certificates needed)

## Prerequisites

1. **Hetzner Cloud Server** with:
   - Ubuntu 20.04+ or Debian 11+
   - Docker installed
   - Docker Swarm initialized
   - Port 80 (and optionally 8080) open in firewall

2. **Required Software**:
   ```bash
   # Install Docker (if not already installed)
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   # Add your user to docker group
   sudo usermod -aG docker $USER
   # Log out and back in for group changes to take effect
   ```

3. **Firewall Configuration**:
   ```bash
   # Allow HTTP traffic
   sudo ufw allow 80/tcp
   sudo ufw allow 8080/tcp  # For Traefik dashboard
   sudo ufw enable
   ```

## Deployment Steps

### Step 1: Clone Repository

```bash
git clone <your-repo-url>
cd ClasslaV2/classla-ide-container/orchestration
```

### Step 2: Initialize Docker Swarm

```bash
./scripts/init-swarm.sh
```

This will:
- Initialize Docker Swarm
- Create the `ide-network` overlay network

### Step 3: Configure Environment

Create a `.env` file based on the example:

```bash
# Required
API_KEYS=your-api-key-1,your-api-key-2
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# Optional but recommended
DOMAIN=your-domain.com  # If you have a domain pointing to your server
SERVER_IP=your.hetzner.ip.address  # Your Hetzner server's public IP

# AWS Configuration
AWS_REGION=us-east-1

# Optional: Resource limits
RESOURCE_CPU_LIMIT=2
RESOURCE_MEMORY_LIMIT=4294967296  # 4GB in bytes
```

**Note**: If you don't set `SERVER_IP`, the deployment script will attempt to auto-detect it.

### Step 4: Deploy (HTTP Only)

Use the HTTP-only deployment script:

```bash
./scripts/deploy-http.sh
```

This script will:
1. Validate your `.env` configuration
2. Check Docker Swarm status
3. Ensure the overlay network exists
4. Build the Docker image for `linux/amd64`
5. Deploy Traefik and the Management API
6. Wait for services to be ready

### Step 5: Verify Deployment

Check service status:

```bash
docker stack services ide-management
```

View logs:

```bash
# Management API logs
docker service logs ide-management_management-api -f

# Traefik logs
docker service logs ide-management_traefik -f
```

### Step 6: Test Access

Access the services:

- **Management API**: `http://YOUR_SERVER_IP/api/health`
- **Dashboard**: `http://YOUR_SERVER_IP`
- **Traefik Dashboard**: `http://YOUR_SERVER_IP:8080`

If you configured a domain:

- **Management API**: `http://api.YOUR_DOMAIN/api/health`
- **Dashboard**: `http://dashboard.YOUR_DOMAIN`

## Testing the API

```bash
# Health check
curl http://YOUR_SERVER_IP/api/health

# Start a container (replace YOUR_API_KEY with one from API_KEYS)
curl -X POST http://YOUR_SERVER_IP/api/containers/start \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"s3Bucket": "my-workspace-bucket"}'
```

## Troubleshooting

### Services Not Starting

1. **Check service status**:
   ```bash
   docker stack services ide-management
   docker service ps ide-management_management-api --no-trunc
   ```

2. **Check logs**:
   ```bash
   docker service logs ide-management_management-api
   docker service logs ide-management_traefik
   ```

3. **Check Docker Swarm**:
   ```bash
   docker node ls
   docker info | grep Swarm
   ```

### Port Already in Use

If port 80 is already in use:

```bash
# Check what's using port 80
sudo lsof -i :80

# Or check with netstat
sudo netstat -tulpn | grep :80
```

### Architecture Mismatch

If you see architecture-related errors:

1. **Build directly on Hetzner server** (recommended):
   ```bash
   # SSH into your Hetzner server
   # Build the image there
   docker build -t ide-orchestration-api:latest -f Dockerfile .
   ```

2. **Or use buildx from your Mac**:
   ```bash
   docker buildx build --platform linux/amd64 -t ide-orchestration-api:latest -f Dockerfile --load .
   # Then push to a registry and pull on Hetzner
   ```

### Network Issues

If containers can't communicate:

```bash
# Check network exists
docker network ls | grep ide-network

# Inspect network
docker network inspect ide-network

# Recreate network if needed
docker network rm ide-network
docker network create --driver overlay --attachable ide-network
```

## Updating the Deployment

To update after code changes:

```bash
# Pull latest code
git pull

# Rebuild and redeploy
./scripts/deploy-http.sh
```

## Removing the Deployment

```bash
# Remove the stack
docker stack rm ide-management

# Remove network (if not needed)
docker network rm ide-network

# Leave swarm (if desired)
docker swarm leave --force
```

## Security Considerations

⚠️ **Important**: This deployment uses HTTP only (no encryption). 

For production use:
- Set up HTTPS with Let's Encrypt using `docker-compose.traefik.yml`
- Use strong API keys
- Configure firewall rules
- Consider using Hetzner Cloud Firewall for additional protection
- Regularly update Docker images and dependencies

## Additional Notes

- The `deploy-http.sh` script automatically detects your server's public IP if `SERVER_IP` is not set
- You can access services by IP address even without a domain
- Traefik dashboard is accessible on port 8080 for monitoring
- All IDE containers will be accessible via Traefik routing based on their container IDs
