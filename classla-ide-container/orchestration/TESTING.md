# Testing Guide

## Pre-warmed Queue Testing

### Expected Behavior

1. **Queue Maintainer**: Automatically spawns 10 pre-warmed containers on startup
2. **Instant Start**: When a container is requested, if a pre-warmed container is available, it's assigned instantly (<1s)
3. **Fallback**: If no pre-warmed container is available, a new container is created (~15s)
4. **Auto-replenishment**: When a pre-warmed container is used, a new one is spawned to maintain queue size

### Testing Pre-warming

1. **Start fresh system:**
   ```bash
   # Clean state
   rm -f data/containers.db
   docker service ls | grep "ide-" | awk '{print $2}' | xargs docker service rm
   
   # Start API
   npm start
   ```

2. **Wait for queue to populate:**
   - Queue maintainer checks every 30 seconds
   - Should spawn 10 containers (may take 5-10 minutes depending on resources)
   - Check logs: `tail -f /tmp/orchestration-api.log | grep QueueMaintainer`

3. **Test instant start:**
   ```bash
   time curl -X POST http://localhost:3001/api/containers/start \
     -H "Authorization: Bearer test-api-key-12345" \
     -H "Content-Type: application/json" \
     -d '{"s3Bucket": "test-bucket", "s3Region": "us-east-1"}'
   ```
   
   **Expected**: Response in <1 second if queue container is used

4. **Verify queue usage:**
   - Check logs for "Using pre-warmed container" message
   - Container should be immediately accessible
   - Queue maintainer should spawn replacement

### Resource Constraints

If system memory is high (>90%), the queue maintainer may not be able to spawn containers. To test:

1. **Temporarily increase threshold:**
   ```bash
   echo "MAX_MEMORY_PERCENT=100" >> .env
   ```

2. **Or reduce queue size:**
   ```bash
   echo "PRE_WARMED_QUEUE_SIZE=2" >> .env
   ```

### Verifying Queue Status

Check queue statistics:
```bash
# Via API (if endpoint exists)
curl http://localhost:3001/api/dashboard/stats

# Or check logs
grep "QueueMaintainer" /tmp/orchestration-api.log | tail -20
```

### Performance Comparison

**Without Pre-warming:**
- Container creation: ~15 seconds
- Total time to ready: ~15-20 seconds

**With Pre-warming:**
- Container assignment: <1 second
- Total time to ready: <1 second (only S3 sync time)

## Integration Testing

### Full Flow Test

1. Start API and wait for queue to populate
2. Request container via API
3. Verify container is accessible via Traefik routes
4. Verify S3 bucket is assigned and syncing
5. Verify queue maintains target size

### Container Access Test

```bash
# Get container ID from start response
CONTAINER_ID="your-container-id"

# Test code-server
curl -I http://localhost/code/$CONTAINER_ID

# Test VNC
curl -I http://localhost/vnc/$CONTAINER_ID

# Test web server
curl http://localhost/web/$CONTAINER_ID/health
```

All should return 200/302 (successful).

## Troubleshooting

- **Queue not populating**: Check resource limits and system memory
- **Containers not instant**: Verify queue has available containers
- **Assignment fails**: Check container health and S3 bucket validity
- **Queue maintainer not starting**: Check server logs for errors

