# Viewing Logs for Failed/Killed Containers

## Docker Swarm Service Logs

Even if a container has stopped or crashed, you can still view its logs using Docker Swarm service commands:

### View Logs for a Specific Container Service

```bash
# View recent logs (last 100 lines)
docker service logs ide-<container-id> --tail 100

# View all logs
docker service logs ide-<container-id>

# Follow logs in real-time
docker service logs ide-<container-id> -f

# View logs with timestamps
docker service logs ide-<container-id> --timestamps
```

### View Logs for All Tasks (Including Failed Ones)

```bash
# List all tasks for a service (including failed ones)
docker service ps ide-<container-id> --no-trunc

# Get the task ID from the output, then view logs for that specific task
docker service logs ide-<container-id> --task-id <task-id>
```

### View Logs for Stopped/Failed Tasks

If a task has stopped, you can still view its logs:

```bash
# List all tasks (including stopped ones)
docker service ps ide-<container-id> --no-trunc

# View logs for a specific stopped task
# The task ID is shown in the output (first column)
docker service logs ide-<container-id> --task-id <task-id>
```

### View Container Logs Directly (If Container Still Exists)

If the container still exists (even if stopped):

```bash
# Find the container ID
docker ps -a | grep ide-<container-id>

# View logs
docker logs <container-id>

# View logs with timestamps
docker logs <container-id> --timestamps

# Follow logs
docker logs <container-id> -f
```

### View Logs via Management API

The management API also provides log streaming:

```bash
# Stream logs via API (if container is still running)
curl http://localhost/api/dashboard/api/logs?containerId=<container-id>
```

### Log Retention Configuration

**IMPORTANT**: Docker Swarm services now have log retention configured:
- **Max log file size**: 10MB per file
- **Max log files**: 5 files (50MB total per service)
- **Log driver**: json-file

This means logs are kept for much longer than default. If logs are still missing, check:

1. **Docker daemon log settings**: The daemon may have global log limits
2. **Service was removed**: If the service was deleted, logs are lost
3. **Check immediately**: Even with retention, check logs as soon as possible

### Common Issues

1. **Logs are gone**: 
   - Docker Swarm may clean up old task logs if the service was removed
   - Check immediately after a crash (within minutes)
   - Use `docker service ps` to find task IDs before they're cleaned up
2. **Service not found**: If the service was removed, logs may be lost. Check Docker Swarm task history.
3. **Task ID needed**: For stopped tasks, you need the specific task ID to view logs.
4. **Docker daemon limits**: Check `/etc/docker/daemon.json` for global log limits that might override service settings

### Example Workflow

```bash
# 1. Find the container ID that crashed
docker service ls | grep ide-

# 2. Check service status and get task IDs
docker service ps ide-<container-id> --no-trunc

# 3. View logs for the most recent task (even if failed)
docker service logs ide-<container-id> --tail 200

# 4. If you see a specific task ID that failed, view its logs
docker service logs ide-<container-id> --task-id <task-id>
```
