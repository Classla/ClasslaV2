# Requirements Document

## Introduction

This feature enables dynamic orchestration of multiple IDE containers on a single VPS using Docker Swarm. Users can request IDE containers via API endpoints, with each container getting its own isolated workspace backed by S3 storage. The system uses Traefik as a reverse proxy to route traffic to individual containers, providing unique URLs for each service (noVNC, code-server, and the in-container web server). Containers automatically shut down after 10 minutes of inactivity to optimize resource usage.

## Requirements

### Requirement 1: Container Management API

**User Story:** As a system administrator, I want to start, stop, and manage IDE containers via REST API endpoints, so that I can programmatically provision development environments for users.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/containers/start` with an S3 bucket ID THEN the system SHALL create a new Docker Swarm service running the IDE container
2. WHEN a container is successfully started THEN the system SHALL return a JSON response containing the noVNC URL, code-server URL, and web server URL
3. WHEN a GET request is made to `/api/containers/:containerId` THEN the system SHALL return the current status and URLs for that container
4. WHEN a DELETE request is made to `/api/containers/:containerId` THEN the system SHALL gracefully stop and remove the container service
5. WHEN a GET request is made to `/api/containers` THEN the system SHALL return a list of all running containers with their metadata
6. IF a container start request fails THEN the system SHALL return an appropriate error message with HTTP status code

### Requirement 2: Traefik Reverse Proxy Integration

**User Story:** As a user, I want to access my IDE container services through unique, predictable URLs, so that I can easily connect to my development environment without dealing with port numbers.

#### Acceptance Criteria

1. WHEN a container is started THEN Traefik SHALL automatically configure routing rules for that container
2. WHEN accessing the noVNC service THEN the URL SHALL follow the pattern `https://{containerId}-vnc.{domain}`
3. WHEN accessing the code-server service THEN the URL SHALL follow the pattern `https://{containerId}-code.{domain}`
4. WHEN accessing the web server service THEN the URL SHALL follow the pattern `https://{containerId}-web.{domain}`
5. WHEN a container is stopped THEN Traefik SHALL automatically remove the routing rules
6. WHEN SSL/TLS is configured THEN all services SHALL be accessible via HTTPS with valid certificates

### Requirement 3: Docker Swarm Orchestration

**User Story:** As a system administrator, I want containers to be managed by Docker Swarm, so that I can leverage container orchestration features like health checks, resource limits, and automatic restarts.

#### Acceptance Criteria

1. WHEN the system starts THEN Docker Swarm SHALL be initialized on the VPS
2. WHEN a container is created THEN it SHALL be deployed as a Docker Swarm service with appropriate labels
3. WHEN a container exceeds resource limits THEN Docker Swarm SHALL enforce CPU and memory constraints
4. WHEN a container crashes THEN Docker Swarm SHALL NOT automatically restart it (restart policy: on-failure with max 3 attempts)
5. WHEN deploying a container THEN the system SHALL apply Traefik labels for automatic service discovery
6. WHEN a container is removed THEN Docker Swarm SHALL clean up all associated resources

### Requirement 4: S3 Workspace Persistence

**User Story:** As a developer, I want my workspace files to be persisted in S3, so that my work is saved even when the container shuts down.

#### Acceptance Criteria

1. WHEN a container starts THEN it SHALL be configured with the provided S3 bucket ID as an environment variable
2. WHEN a container initializes THEN it SHALL download existing workspace files from the S3 bucket
3. WHEN files are modified in the container THEN they SHALL be synced to S3 every 15 seconds
4. WHEN a container shuts down THEN it SHALL perform a final sync to S3 before terminating
5. IF S3 sync fails THEN the container SHALL log the error but continue operating
6. WHEN multiple containers use the same S3 bucket THEN they SHALL operate independently without conflicts

### Requirement 5: Automatic Inactivity Shutdown

**User Story:** As a system administrator, I want containers to automatically shut down after 10 minutes of inactivity, so that I can optimize resource usage and reduce costs.

#### Acceptance Criteria

1. WHEN a container starts THEN the inactivity monitor SHALL be enabled by default
2. WHEN no file changes occur for 10 minutes THEN the container SHALL initiate shutdown
3. WHEN shutdown is initiated THEN the container SHALL perform a final S3 sync
4. WHEN shutdown completes THEN the Docker Swarm service SHALL be removed
5. WHEN file activity is detected THEN the inactivity timer SHALL reset to 10 minutes
6. WHEN the management API receives a shutdown signal THEN it SHALL update the container status to "stopped"

### Requirement 6: Container Lifecycle Tracking

**User Story:** As a system administrator, I want to track the lifecycle of each container, so that I can monitor usage, debug issues, and manage resources effectively.

#### Acceptance Criteria

1. WHEN a container is created THEN the system SHALL store metadata including container ID, S3 bucket, creation time, and status
2. WHEN a container status changes THEN the system SHALL update the stored metadata
3. WHEN querying container status THEN the system SHALL return current state (starting, running, stopping, stopped)
4. WHEN a container shuts down THEN the system SHALL record the shutdown time and reason
5. WHEN listing containers THEN the system SHALL support filtering by status
6. WHEN a container has been stopped for 24 hours THEN the system SHALL archive its metadata

### Requirement 7: Resource Management and Limits

**User Story:** As a system administrator, I want to enforce resource limits on containers, so that a single container cannot consume all available resources and impact other containers.

#### Acceptance Criteria

1. WHEN a container is created THEN it SHALL be limited to 2 CPU cores maximum
2. WHEN a container is created THEN it SHALL be limited to 4GB memory maximum
3. WHEN the VPS reaches 90% memory usage THEN the system SHALL reject new container start requests
4. WHEN the VPS reaches 90% CPU usage THEN the system SHALL log a warning
5. WHEN querying system status THEN the API SHALL return current resource usage statistics
6. WHEN a container exceeds memory limits THEN Docker Swarm SHALL terminate it

### Requirement 8: Health Monitoring and Status Reporting

**User Story:** As a system administrator, I want to monitor the health of running containers, so that I can identify and resolve issues quickly.

#### Acceptance Criteria

1. WHEN a container is running THEN the system SHALL perform health checks every 30 seconds
2. WHEN a health check fails 3 consecutive times THEN the container SHALL be marked as unhealthy
3. WHEN a container is unhealthy THEN the system SHALL log the failure and attempt to restart it once
4. WHEN querying container health THEN the API SHALL return the last health check result and timestamp
5. WHEN a container's code-server service is unreachable THEN the health check SHALL fail
6. WHEN all services are responding THEN the health check SHALL pass

### Requirement 9: Security and Isolation

**User Story:** As a security-conscious administrator, I want containers to be isolated from each other and the host system, so that security vulnerabilities in one container don't affect others.

#### Acceptance Criteria

1. WHEN containers are created THEN they SHALL run on an isolated Docker network
2. WHEN containers communicate THEN they SHALL only be able to access their own services
3. WHEN accessing containers externally THEN all traffic SHALL go through Traefik reverse proxy
4. WHEN S3 credentials are needed THEN they SHALL be passed as environment variables, not stored in the image
5. WHEN containers are removed THEN all associated data SHALL be cleaned up from the host
6. WHEN Traefik is configured THEN it SHALL use secure headers and HTTPS redirects

### Requirement 10: Management API Authentication

**User Story:** As a system administrator, I want the management API to be protected by authentication, so that only authorized users can create and manage containers.

#### Acceptance Criteria

1. WHEN accessing any API endpoint THEN the request SHALL include a valid API key in the Authorization header
2. WHEN an invalid API key is provided THEN the system SHALL return HTTP 401 Unauthorized
3. WHEN no API key is provided THEN the system SHALL return HTTP 401 Unauthorized
4. WHEN a valid API key is provided THEN the request SHALL be processed normally
5. WHEN the system starts THEN it SHALL load API keys from environment variables or a configuration file
6. WHEN API keys are stored THEN they SHALL be hashed and not stored in plain text
