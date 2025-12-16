# Stage 1: Build TypeScript backend
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Copy backend package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm ci --only=development

# Copy backend source
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Build React dashboard
FROM node:20-alpine AS dashboard-builder

WORKDIR /app

# Copy dashboard package files
COPY dashboard/package*.json ./dashboard/

# Install dependencies
RUN cd dashboard && npm ci

# Copy dashboard source
COPY dashboard ./dashboard

# Build React app (outputs to /app/dist/dashboard)
RUN cd dashboard && npm run build

# Stage 3: Production image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built backend from stage 1
COPY --from=backend-builder /app/dist ./dist

# Copy built dashboard from stage 2
COPY --from=dashboard-builder /app/dist/dashboard ./dist/dashboard

# Create data directory for SQLite database
RUN mkdir -p /app/data && \
    chown -R node:node /app

# Keep running as root for Docker socket access
# This is necessary for the management service to control Docker containers
# USER node

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "dist/server.js"]
