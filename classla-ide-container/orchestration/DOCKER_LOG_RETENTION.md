# Docker Log Retention Configuration

## Problem

Docker Swarm services were losing logs too quickly (within 30 seconds of container crashes), making debugging impossible.

## Solution

We've configured log retention for all IDE container services:

### Service-Level Configuration

Each IDE container service now has explicit log driver configuration:

```typescript
LogDriver: {
  Name: "json-file",
  Options: {
    "max-size": "10m",      // Maximum size of log file before rotation
    "max-file": "5",        // Maximum number of log files to keep
    "labels": "container_id,service_name",
  },
}
```

This means:
- **Each log file**: Maximum 10MB
- **Total logs per service**: Up to 50MB (5 files × 10MB)
- **Log retention**: Logs are kept until the service is removed

### Docker Desktop Configuration

On Docker Desktop (Mac/Windows), you may also need to configure global log limits:

1. **Open Docker Desktop**
2. **Settings → Docker Engine**
3. Add or update the `log-opts` configuration:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

4. **Apply & Restart**

### Linux Docker Daemon Configuration

On Linux, edit `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

Then restart Docker:
```bash
sudo systemctl restart docker
```

## Verifying Log Retention

After configuring, verify logs are being retained:

```bash
# Check service log driver configuration
docker service inspect ide-<container-id> | grep -A 10 LogDriver

# Check actual log files (on the Docker host)
# For Docker Desktop, logs are in: ~/Library/Containers/com.docker.docker/Data/vms/0/data/docker/containers/
# For Linux, logs are in: /var/lib/docker/containers/
```

## Viewing Logs

Even with retention configured, view logs as soon as possible:

```bash
# View service logs (works even after container stops)
docker service logs ide-<container-id> --tail 200

# View logs for a specific task
docker service ps ide-<container-id> --no-trunc  # Get task ID
docker service logs ide-<container-id> --task-id <task-id>
```

## Notes

- **Service removal**: Logs are deleted when the service is removed
- **Task cleanup**: Docker Swarm may clean up old tasks, but logs should persist
- **Disk space**: 50MB per service × many services = monitor disk usage
- **Log location**: Logs are stored on the Docker host, not in containers
