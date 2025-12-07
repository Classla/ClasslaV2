# Local Redis Setup for Development

This guide will help you set up Redis locally for testing session management.

## Quick Start

1. **Start Redis:**
   ```bash
   npm run redis:up
   ```
   Or manually:
   ```bash
   docker-compose -f docker-compose.local.yml up -d redis
   ```

2. **Set up your environment:**
   - Copy `.env.local.example` to `.env.local` (if it doesn't exist)
   - Add `REDIS_URL=redis://localhost:6379` to your `.env.local` or `.env` file

3. **Start the backend:**
   ```bash
   npm run dev:redis
   ```
   Or start Redis separately and then:
   ```bash
   npm run dev
   ```

## Verify Redis is Working

1. **Check Redis is running:**
   ```bash
   docker ps | grep redis
   ```

2. **Check Redis logs:**
   ```bash
   npm run redis:logs
   ```

3. **Test Redis connection:**
   ```bash
   docker exec -it classla-backend-redis redis-cli ping
   ```
   Should return: `PONG`

4. **Check session keys in Redis:**
   ```bash
   docker exec classla-backend-redis redis-cli KEYS "sess:*"
   ```

## Environment Variables

Make sure your `.env.local` or `.env` file includes:

```env
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

## Troubleshooting

### Redis won't start
- Make sure Docker is running
- Check if port 6379 is already in use: `lsof -i :6379`
- If port is in use, change the port in `docker-compose.local.yml`

### Sessions not persisting
- Check that `REDIS_URL` is set correctly
- Verify Redis is running: `docker ps | grep redis`
- Check backend logs for Redis connection errors
- Verify sessions are being stored: `docker exec classla-backend-redis redis-cli KEYS "sess:*"`

### Can't connect to Redis
- Make sure Redis container is running: `docker ps`
- Check Redis logs: `npm run redis:logs`
- Verify the `REDIS_URL` in your `.env.local` matches the Docker container

## Stopping Redis

```bash
npm run redis:down
```

Or manually:
```bash
docker compose -f docker-compose.local.yml down
```

## Redis Data Persistence

Redis data is stored in a Docker volume (`redis-data`). To completely reset Redis:

```bash
docker compose -f docker-compose.local.yml down -v
```

This will remove the volume and all stored data.

