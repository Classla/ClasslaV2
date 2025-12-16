# IDE Container

Docker container providing a complete development environment with VS Code, VNC desktop, and S3 workspace sync.

## Features

- **VS Code (code-server)**: Full VS Code experience in browser (port 8080)
- **VNC Desktop**: Remote desktop with noVNC web client (port 6080)
- **Web Server**: API for executing code remotely (port 3000)
- **S3 Sync**: Bidirectional sync with S3 buckets
- **Pre-installed**: Python 3.10, Node.js 18, Java 17

## Quick Start

### Build

```bash
docker build -t classla-ide-container:latest .
```

### Run Locally

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -p 3000:3000 \
  -e VNC_PASSWORD=test123 \
  -e S3_BUCKET=my-bucket \
  -e S3_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=your-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret \
  --name ide-container \
  classla-ide-container:latest
```

### Access

- **VS Code**: http://localhost:8080
- **VNC Desktop**: http://localhost:6080
- **Web Server API**: http://localhost:3000

## Pre-warmed Mode

Containers can run in "pre-warmed" mode without an S3 bucket, then be assigned a bucket dynamically:

1. Start container without `S3_BUCKET` environment variable
2. Container starts and waits for S3 assignment
3. Assign bucket via HTTP endpoint: `POST /assign-s3-bucket`
4. Container begins syncing with S3 bucket

This enables near-instant container startup when using the orchestration system.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_BUCKET` | S3 bucket name for workspace | - |
| `S3_REGION` | AWS region | `us-east-1` |
| `VNC_PASSWORD` | VNC password | `vncpassword` |
| `ENABLE_INACTIVITY_SHUTDOWN` | Auto-shutdown after 10 min | `true` |
| `CODE_BASE_PATH` | Base path for code-server routing | - |
| `VNC_BASE_PATH` | Base path for VNC routing | - |

## Web Server API

### Health Check
```bash
GET /health
```

### Run Code
```bash
POST /run
Content-Type: application/json

{
  "filename": "test.py",
  "language": "python"
}
```

### Assign S3 Bucket (Pre-warmed Mode)
```bash
POST /assign-s3-bucket
Content-Type: application/json

{
  "bucket": "my-bucket",
  "region": "us-east-1",
  "accessKeyId": "optional",
  "secretAccessKey": "optional"
}
```

## S3 Workspace Sync

- **Initial Sync**: Downloads workspace from S3 on startup (if bucket assigned)
- **Continuous Sync**: Uploads changes to S3 every 15 seconds
- **Final Sync**: Performs final sync before shutdown

Excludes: `.git/`, `node_modules/`, `__pycache__/`, `.vscode/`, `.idea/`

## Production Use

For production, use with the orchestration system which provides:
- Docker Swarm deployment
- Traefik reverse proxy
- Pre-warmed container queue
- Health monitoring
- Automatic scaling

See `orchestration/README.md` for deployment instructions.

## Troubleshooting

- **Container won't start**: Check Docker resources (memory/CPU)
- **S3 sync fails**: Verify AWS credentials and bucket permissions
- **VNC not accessible**: Check port 6080 is exposed and firewall rules
- **Code-server not loading**: Check port 8080 and container logs

