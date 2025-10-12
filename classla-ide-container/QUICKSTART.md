# Quick Start Guide

Get up and running in 5 minutes with passwordless access and auto-scaling VNC!

## 1. Build the Image

```bash
# For M1/M2 Mac (ARM)
docker build --platform linux/arm64 -t fargate-dev-container .

# For Intel Mac/Linux (x86)
docker build -t fargate-dev-container .

# OR use Make
make build
```

## 2. Run Locally (Simple Test)

```bash
# Basic run - no passwords needed for code-server!
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e VNC_PASSWORD=myvnc123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=false \
  --name dev-container \
  fargate-dev-container

# OR use Make
make run VNC_PASSWORD=myvnc123
```

**Note:** Includes Python 3.10, Node.js 18, and Java 17 out of the box!

## 3. Access Your Environment

Wait 10-15 seconds for services to start, then open:

- **VS Code (code-server):** http://localhost:8080
  - Opens instantly, no password required! ✨
- **GUI Desktop (noVNC):** http://localhost:6080
  - Auto-connects and scales to your browser window! ✨

## 4. Test It Out

### Test Code-Server

1. Open http://localhost:8080 (loads immediately, no login)
2. Create a new file: `/workspace/test.py`
3. Write some Python code and run it in the terminal

### Test GUI Applications

1. Open http://localhost:6080 (auto-connects to desktop)
2. Open a terminal (right-click desktop → Terminal)
3. Run a GUI test:

```bash
export DISPLAY=:1
python3 << 'EOF'
import tkinter as tk
root = tk.Tk()
root.title("It Works!")
tk.Label(root, text="Hello from your dev container!").pack(pady=20)
tk.Button(root, text="Close", command=root.quit).pack()
root.mainloop()
EOF
```

### Test VNC Auto-Scaling

1. With http://localhost:6080 open, resize your browser window
2. The VNC desktop automatically scales to fit! ✨
3. No scrollbars needed - perfect fit every time

### Test Python with pip

```bash
# SSH into container
docker exec -it dev-container su - user

# Install Python packages via pip
pip3 install requests flask

# Now you have those packages available!
python3 -c "import requests, flask; print('Success!')"
```

## 5. Using with S3 (Docker Swarm / Cloud)

### Local S3 Testing with MinIO

```bash
# Start with MinIO (local S3)
docker-compose --profile with-s3 up -d

# Create a bucket in MinIO console: http://localhost:9001
# Login: minioadmin / minioadmin

# Configure dev container to use MinIO
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e S3_BUCKET=my-test-bucket \
  -e S3_REGION=us-east-1 \
  -e VNC_PASSWORD=myvnc123 \
  -e AWS_ACCESS_KEY_ID=minioadmin \
  -e AWS_SECRET_ACCESS_KEY=minioadmin \
  --link minio \
  --name dev-container \
  fargate-dev-container
```

### Deploy to Docker Swarm

```yaml
# docker-stack.yml
version: "3.8"
services:
  dev-container:
    image: your-registry/fargate-dev-container:latest
    ports:
      - "8080:8080"
      - "6080:6080"
    environment:
      - VNC_PASSWORD=changeme
      - S3_BUCKET=my-workspace-bucket
      - S3_REGION=us-east-1
      - ENABLE_INACTIVITY_SHUTDOWN=false
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker
      resources:
        limits:
          cpus: "2"
          memory: 4G
    networks:
      - dev_network

networks:
  dev_network:
    driver: overlay
```

Deploy:

```bash
docker stack deploy -c docker-stack.yml dev-env
```

### Deploy to AWS Fargate

```bash
# 1. Create ECR repository
aws ecr create-repository --repository-name fargate-dev-container

# 2. Login and push
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

docker tag fargate-dev-container YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/fargate-dev-container:latest
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/fargate-dev-container:latest

# 3. Create task definition and run service (see README.md for full example)

# OR use the Makefile:
make ecr-create-repo
make push-ecr
```

## Common Commands

```bash
# View logs
docker logs -f dev-container
# OR
make logs

# Open shell
docker exec -it dev-container su - user
# OR
make shell

# Stop container
docker stop dev-container
# OR
make stop

# Restart
docker restart dev-container
# OR
make restart

# Clean up
docker stop dev-container
docker rm dev-container
# OR
make clean
```

## Environment Variables Cheat Sheet

| Variable                     | Default       | Description                                               |
| ---------------------------- | ------------- | --------------------------------------------------------- |
| `VNC_PASSWORD`               | `vncpassword` | VNC password (embedded in URL for auto-connect)           |
| `S3_BUCKET`                  | -             | S3 bucket name for workspace sync                         |
| `S3_REGION`                  | `us-east-1`   | AWS region                                                |
| `ENABLE_INACTIVITY_SHUTDOWN` | `true`        | Auto-shutdown after 10 min (set to `false` for local dev) |

**Note:** No language configuration needed - Python, Node.js, and Java are pre-installed!

## What's New in This Version?

### ✅ Code-Server: No Password Required

- Opens directly without login screen
- No password configuration needed
- Instant access to VS Code

### ✅ VNC: Auto-Connect

- No need to click "Connect" button
- Password automatically authenticated via URL
- Opens directly to desktop

### ✅ VNC: Auto-Scaling

- Desktop scales to fit browser window
- Works on any screen size (laptop, tablet, desktop)
- Resize browser = desktop resizes automatically
- No scrollbars needed

### ✅ Pre-installed Development Tools

- Python 3.10 with tkinter and pip (no setup needed)
- Node.js 18 LTS with npm
- Java 17 with JavaFX and Swing support
- Clean `$` prompt, instant terminal startup

## Troubleshooting One-Liners

```bash
# Container won't start?
docker logs dev-container

# VNC not working?
docker exec dev-container ps aux | grep vnc

# Code-server not accessible?
docker exec dev-container curl -I http://localhost:8080

# VNC not auto-connecting?
docker exec dev-container cat /opt/novnc/index.html | grep autoconnect

# VNC not scaling?
# Try Chrome/Firefox - check URL has "resize=scale"

# S3 sync issues?
docker exec -u user dev-container rclone lsd s3:your-bucket

# Python not found?
docker exec dev-container python3 --version

# Node.js not found?
docker exec dev-container node --version

# Java not found?
docker exec dev-container java -version
```

## Testing Checklist

Before considering setup complete, verify:

- [ ] Container stays running (check with `docker ps`)
- [ ] Code-server loads instantly at http://localhost:8080
- [ ] VNC desktop loads instantly at http://localhost:6080
- [ ] VNC desktop scales when you resize browser
- [ ] Can create and edit files in VS Code
- [ ] Can run commands in VS Code terminal
- [ ] Can open terminal in VNC desktop
- [ ] Python GUI apps work (tkinter test above)
- [ ] pip install works (`pip3 install requests`)
- [ ] Node.js works (`node --version`)
- [ ] Java works (`java -version`)
- [ ] S3 sync works (if configured)

## Security Note

This container is configured for **easy access** with:

- No code-server password
- VNC password in URL for auto-connect

**Recommended for:**

- ✅ Local development (Docker Desktop)
- ✅ Private VPCs (Docker Swarm)
- ✅ Internal networks with firewall protection

**Not recommended for:**

- ❌ Public internet without additional security
- ❌ Untrusted networks

**For public deployment**, add:

- Reverse proxy with authentication (Nginx, Traefik)
- VPN for network-level security
- Firewall rules to restrict access

## Performance Tips

### For M1/M2 Mac

```bash
# Use ARM build for native performance
docker build --platform linux/arm64 -t fargate-dev-container .
```

### For Docker Swarm

```bash
# Disable auto-shutdown to keep container running
-e ENABLE_INACTIVITY_SHUTDOWN=false
```

### Resource Allocation

Recommended Docker resource settings:

- **Memory:** 4-6 GB
- **CPUs:** 2-4 cores
- **Disk:** 20+ GB

## Advanced Usage

### Custom VNC Resolution

The default is 1920x1080. To change:

Edit Dockerfile line with `vncserver` command:

```bash
vncserver :1 -geometry 1920x1080 -depth 24 -localhost no
# Change to your preferred resolution, e.g.:
vncserver :1 -geometry 2560x1440 -depth 24 -localhost no
```

### Persistent Workspace Volume

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -v $(pwd)/workspace:/workspace \
  -e VNC_PASSWORD=myvnc123 \
  --name dev-container \
  fargate-dev-container
```

### Using with Docker Compose

```yaml
version: "3.8"
services:
  dev-container:
    build: .
    image: fargate-dev-container:latest
    ports:
      - "8080:8080"
      - "6080:6080"
    environment:
      - VNC_PASSWORD=vncpassword
      - ENABLE_INACTIVITY_SHUTDOWN=false
    volumes:
      - ./workspace:/workspace
    restart: unless-stopped
```

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check out [INDEX.md](INDEX.md) for complete project overview
- Review the [Makefile](Makefile) for all available commands
- See [CHANGELOG_V2.md](CHANGELOG_V2.md) for technical details on changes

## Need Help?

1. Check container logs: `docker logs dev-container`
2. Check service status: `docker exec dev-container ps aux`
3. See full troubleshooting guide in [README.md](README.md#troubleshooting)
4. Verify environment: `docker exec dev-container env`

## Success Indicators

When everything is working correctly:

```bash
$ docker ps
# Shows: dev-container running with ports 8080->8080, 6080->6080

$ curl -I http://localhost:8080
# Returns: HTTP/1.1 200 OK

$ curl -I http://localhost:6080
# Returns: HTTP/1.1 200 OK
```

And in your browser:

- http://localhost:8080 shows VS Code interface (no login)
- http://localhost:6080 shows IceWM desktop (auto-connected)
- Resizing browser window scales the VNC desktop

**All working?** You're ready to develop! 🚀

---

**Built for Docker Swarm and cloud deployments with passwordless access and auto-scaling VNC.**
