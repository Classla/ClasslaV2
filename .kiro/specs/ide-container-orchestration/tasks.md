# Implementation Plan

- [x] 1. Set up project structure and core configuration

  - Create orchestration directory structure with src/, dashboard/, and docs/ folders
  - Initialize Node.js project with TypeScript configuration
  - Set up Express server with basic middleware
  - Create configuration management system for environment variables
  - _Requirements: All requirements depend on this foundation_

- [x] 2. Implement Docker Swarm service management

  - [x] 2.1 Create ContainerService with Dockerode integration

    - Install and configure dockerode package
    - Implement createContainer method to create Docker Swarm services
    - Implement stopContainer method to remove services
    - Implement getContainer method to query service status
    - Implement listContainers method with filtering support
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.2 Implement resource limits and constraints
    - Add CPU limit configuration (2 cores per container)
    - Add memory limit configuration (4GB per container)
    - Configure restart policy (on-failure, max 3 attempts)
    - Add placement constraints for Swarm scheduling
    - _Requirements: 3.3, 3.4, 7.1, 7.2, 7.6_

- [x] 3. Implement Traefik label generation

  - [x] 3.1 Create TraefikService for dynamic routing

    - Implement generateTraefikLabels function
    - Generate labels for noVNC service (port 6080)
    - Generate labels for code-server service (port 8080)
    - Generate labels for web server service (port 3000)
    - Configure SSL/TLS with Let's Encrypt resolver
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.6_

  - [x] 3.2 Implement container ID generation
    - Create unique container ID generator (short UUID or readable names)
    - Ensure IDs are URL-safe and DNS-compatible
    - Implement ID collision detection
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Implement state management and persistence

  - [x] 4.1 Create StateManager with SQLite storage

    - Set up SQLite database with container metadata schema
    - Implement saveContainer method
    - Implement getContainer method
    - Implement listContainers method with filtering
    - Implement updateContainerStatus method
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.2 Implement container lifecycle tracking
    - Track creation time, start time, stop time
    - Record shutdown reason (inactivity, manual, error, resource_limit)
    - Store last activity timestamp
    - Implement metadata archival for old containers
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5. Implement resource monitoring

  - [x] 5.1 Create ResourceMonitor for system-wide metrics

    - Install systeminformation package
    - Implement getSystemResources method (CPU, memory, disk)
    - Implement canStartContainer method with threshold checks
    - Add 90% memory usage threshold enforcement
    - Add 90% CPU usage warning logging
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 5.2 Create NodeMonitor for per-node metrics
    - Query Docker Swarm API for node list
    - Get per-node resource usage via Swarm stats
    - Aggregate metrics across all nodes
    - Implement node health status checking
    - _Requirements: 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

- [x] 6. Implement container management API endpoints

  - [x] 6.1 Create POST /api/containers/start endpoint

    - Validate request body (s3Bucket required)
    - Check system resources before starting
    - Generate unique container ID
    - Create Docker Swarm service with Traefik labels
    - Save container metadata to state manager
    - Return container info with URLs
    - _Requirements: 1.1, 1.2, 1.6, 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Create GET /api/containers endpoint

    - Implement container listing with optional status filter
    - Support pagination (limit, offset)
    - Return container array with metadata
    - _Requirements: 1.5_

  - [x] 6.3 Create GET /api/containers/:id endpoint

    - Validate container ID parameter
    - Query container from state manager
    - Fetch current status from Docker Swarm
    - Return detailed container info with health status
    - _Requirements: 1.3, 8.4_

  - [x] 6.4 Create DELETE /api/containers/:id endpoint

    - Validate container ID parameter
    - Stop Docker Swarm service
    - Update container status to 'stopped'
    - Record shutdown reason as 'manual'
    - Return success response
    - _Requirements: 1.4, 5.3, 5.4_

  - [x] 6.5 Create GET /api/health endpoint
    - Return API health status
    - Check Docker daemon connectivity
    - Return system resource summary
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 7. Implement authentication middleware

  - [x] 7.1 Create API key authentication

    - Load API keys from environment variables
    - Implement auth middleware to validate Authorization header
    - Return 401 for missing or invalid API keys
    - Allow requests with valid API keys
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 7.2 Implement API key hashing
    - Hash API keys before storing
    - Compare hashed keys during authentication
    - Support multiple API keys
    - _Requirements: 10.6_

- [x] 8. Implement error handling

  - [x] 8.1 Create centralized error handler middleware

    - Define error response format
    - Map error types to HTTP status codes
    - Log errors with stack traces
    - Return sanitized error messages to clients
    - _Requirements: All requirements (error handling is cross-cutting)_

  - [x] 8.2 Define error codes and messages
    - CONTAINER_NOT_FOUND (404)
    - CONTAINER_START_FAILED (500)
    - CONTAINER_STOP_FAILED (500)
    - RESOURCE_LIMIT_EXCEEDED (503)
    - INVALID_S3_BUCKET (400)
    - AUTHENTICATION_FAILED (401)
    - DOCKER_ERROR (500)
    - INTERNAL_ERROR (500)
    - _Requirements: All requirements (error handling is cross-cutting)_

- [x] 9. Implement health monitoring

  - [x] 9.1 Create container health check system

    - Implement periodic health checks (every 30 seconds)
    - Check code-server service reachability
    - Check noVNC service reachability
    - Check web server service reachability
    - Mark container unhealthy after 3 consecutive failures
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 9.2 Implement health check recovery
    - Attempt container restart on unhealthy status (once)
    - Log health check failures
    - Update container metadata with health status
    - _Requirements: 8.2, 8.3_

- [x] 10. Create Traefik deployment configuration

  - [x] 10.1 Create Traefik docker-compose configuration

    - Configure Traefik with Docker Swarm provider
    - Set up HTTP and HTTPS entrypoints
    - Configure Let's Encrypt certificate resolver
    - Mount Docker socket for service discovery
    - Create persistent volume for certificates
    - _Requirements: 2.1, 2.5, 2.6, 9.6_

  - [x] 10.2 Create Docker overlay network
    - Define ide-network as overlay network
    - Make network attachable for services
    - Configure network to span all Swarm nodes
    - _Requirements: 3.1, 9.1, 9.2_

- [x] 11. Build monitoring dashboard frontend

  - [x] 11.1 Set up React dashboard project

    - Initialize Vite + React + TypeScript project
    - Install Tailwind CSS for styling
    - Set up routing with React Router
    - Create base layout component
    - _Requirements: Dashboard requirements_

  - [x] 11.2 Create Overview page

    - Display total containers (running/stopped)
    - Show cluster-wide CPU, memory, disk usage
    - Create metrics cards for key statistics
    - Add refresh button and auto-refresh toggle
    - _Requirements: Dashboard requirements_

  - [x] 11.3 Create Node Management page

    - List all Swarm nodes (manager + workers)
    - Display per-node metrics (CPU, memory, disk, container count)
    - Show node health status indicators
    - Add instructions for adding/removing nodes
    - _Requirements: Dashboard requirements_

  - [x] 11.4 Create Container Management page

    - Display searchable/filterable container table
    - Show container status, URLs, uptime, resource usage
    - Add start/stop/delete action buttons
    - Implement quick access links to container services
    - Add pagination controls
    - _Requirements: Dashboard requirements_

  - [x] 11.5 Create System Logs page
    - Implement log viewer component
    - Connect to SSE endpoint for real-time logs
    - Add filter controls (container, node, log level)
    - Implement search functionality
    - Add auto-scroll toggle
    - _Requirements: Dashboard requirements_

- [x] 12. Implement dashboard API endpoints

  - [x] 12.1 Create GET /dashboard endpoint

    - Serve dashboard HTML/JS bundle
    - Configure static file serving
    - _Requirements: Dashboard requirements_

  - [x] 12.2 Create GET /api/dashboard/overview endpoint

    - Return cluster overview metrics
    - Include total containers, resource usage
    - Aggregate data from all nodes
    - _Requirements: Dashboard requirements_

  - [x] 12.3 Create GET /api/dashboard/nodes endpoint

    - Return list of all Swarm nodes
    - Include per-node metrics and health status
    - Query Docker Swarm API for node information
    - _Requirements: Dashboard requirements_

  - [x] 12.4 Create GET /api/dashboard/logs endpoint (SSE)

    - Implement Server-Sent Events for log streaming
    - Stream logs from Docker services
    - Support filtering by container ID
    - _Requirements: Dashboard requirements_

  - [x] 12.5 Create POST /api/dashboard/container/:id/action endpoint
    - Support actions: start, stop, restart, delete
    - Validate action parameter
    - Execute action via ContainerService
    - Return updated container status
    - _Requirements: Dashboard requirements_

- [x] 13. Create deployment stack configuration

  - [x] 13.1 Create docker-compose.yml for management stack

    - Define Traefik service with Swarm mode
    - Define management-api service
    - Configure environment variables
    - Set up volumes for persistence
    - Add Traefik labels for API routing
    - _Requirements: All deployment requirements_

  - [x] 13.2 Create .env.example file
    - Document all required environment variables
    - Provide example values
    - Include comments explaining each variable
    - _Requirements: All deployment requirements_

- [x] 14. Write comprehensive documentation

  - [x] 14.1 Create SETUP.md guide

    - Document prerequisites (VPS, domain, AWS)
    - Provide step-by-step VPS setup instructions
    - Include Docker and Swarm installation commands
    - Document management stack deployment
    - Explain DNS configuration
    - Provide first container test instructions
    - _Requirements: Setup guide requirements_

  - [x] 14.2 Create QUICKSTART.md guide

    - Provide 5-minute quick start for experienced users
    - Include minimal commands to get running
    - Link to full SETUP.md for details
    - _Requirements: Setup guide requirements_

  - [x] 14.3 Create SCALING.md guide

    - Document how to add worker nodes
    - Provide join token commands
    - Explain container distribution
    - Include verification steps
    - _Requirements: Setup guide requirements, multi-node requirements_

  - [x] 14.4 Create TROUBLESHOOTING.md guide

    - Document common issues and solutions
    - Include debugging commands
    - Provide log inspection instructions
    - Add FAQ section
    - _Requirements: Setup guide requirements_

  - [x] 14.5 Create API.md documentation
    - Document all API endpoints with examples
    - Include request/response schemas
    - Provide curl examples
    - Document error codes
    - _Requirements: All API requirements_

- [x] 15. Create Dockerfile for management API

  - [x] 15.1 Build multi-stage Dockerfile

    - Stage 1: Build TypeScript backend
    - Stage 2: Build React dashboard
    - Stage 3: Production image with both
    - Optimize for small image size
    - _Requirements: All deployment requirements_

  - [x] 15.2 Configure Docker image build
    - Create .dockerignore file
    - Set up build scripts in package.json
    - Test image build locally
    - _Requirements: All deployment requirements_

- [-] 16. Implement container inactivity monitoring integration

  - [x] 16.1 Create inactivity callback endpoint

    - Add webhook endpoint for containers to report shutdown
    - Update container status when inactivity shutdown occurs
    - Record shutdown reason as 'inactivity'
    - Log inactivity shutdowns
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 16.2 Update IDE container to call callback
    - Modify inactivity-monitor.sh to call management API before shutdown
    - Pass container ID and shutdown reason
    - Handle callback failures gracefully
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 17. Implement S3 workspace configuration

  - [x] 17.1 Configure S3 environment variables

    - Pass S3_BUCKET to container service
    - Pass S3_REGION to container service
    - Support optional AWS credentials
    - Prefer IAM role authentication when available
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 17.2 Validate S3 bucket accessibility
    - Check S3 bucket exists before starting container
    - Verify credentials have appropriate permissions
    - Return clear error message if S3 is inaccessible
    - _Requirements: 4.1, 4.5_

- [ ] 18. Implement security hardening

  - [x] 18.1 Configure container isolation

    - Ensure containers run on isolated overlay network
    - Disable direct container-to-container communication
    - Verify all external access goes through Traefik
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 18.2 Implement secure headers

    - Add HSTS headers in Traefik
    - Configure secure cipher suites
    - Enable HTTPS redirects
    - _Requirements: 9.4, 9.6_

  - [x] 18.3 Implement rate limiting
    - Add rate limiting middleware (100 requests/minute per API key)
    - Return 429 Too Many Requests when exceeded
    - Log rate limit violations
    - _Requirements: 10.1_

- [x] 19. Create initialization and deployment scripts

  - [x] 19.1 Create init-swarm.sh script

    - Initialize Docker Swarm if not already initialized
    - Create overlay network
    - Display join token for worker nodes
    - _Requirements: 3.1_

  - [x] 19.2 Create deploy.sh script

    - Build and tag Docker images
    - Deploy stack with docker stack deploy
    - Wait for services to be ready
    - Display access URLs
    - _Requirements: All deployment requirements_

  - [x] 19.3 Create cleanup.sh script
    - Remove Docker stack
    - Clean up volumes (with confirmation)
    - Remove stopped containers
    - _Requirements: All deployment requirements_

- [x] 20. Integration testing and validation

  - [x] 20.1 Test single container lifecycle

    - Start container via API
    - Verify all three URLs are accessible
    - Verify S3 sync is working
    - Stop container via API
    - Verify cleanup completed
    - _Requirements: All requirements_

  - [x] 20.2 Test multiple containers

    - Start 3 containers simultaneously
    - Verify isolation between containers
    - Verify unique URLs for each
    - Stop all containers
    - Verify cleanup completed
    - _Requirements: All requirements_

  - [x] 20.3 Test resource limits

    - Start containers until resource limit reached
    - Verify new container requests are rejected
    - Stop one container
    - Verify new container can now start
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 20.4 Test inactivity shutdown

    - Start container
    - Wait 10 minutes without activity
    - Verify container auto-shutdown
    - Verify final S3 sync occurred
    - Verify container status updated
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 20.5 Test multi-node deployment

    - Add worker node to Swarm
    - Start multiple containers
    - Verify containers distributed across nodes
    - Verify Traefik routes to containers on any node
    - Test container on worker node is accessible
    - _Requirements: Multi-node requirements_

  - [x] 20.6 Test monitoring dashboard

    - Access dashboard in browser
    - Verify overview metrics display correctly
    - Verify node list shows all nodes
    - Verify container table shows all containers
    - Test start/stop actions from dashboard
    - Verify real-time log streaming works
    - _Requirements: Dashboard requirements_

  - [x] 20.7 Test authentication
    - Test API requests without API key (should fail)
    - Test API requests with invalid API key (should fail)
    - Test API requests with valid API key (should succeed)
    - Test dashboard access with authentication
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
