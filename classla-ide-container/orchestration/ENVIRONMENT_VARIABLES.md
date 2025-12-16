# Environment Variables Reference

This document describes all environment variables used by the IDE Container Orchestration system.

## Required Variables

These variables must be set for the system to function:

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Single API key used by the application for authentication | `test-api-key-12345` |
| `API_KEYS` | Comma-separated list of API keys (used by deployment scripts) | `key1,key2,key3` |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 bucket validation | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 bucket validation | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |

**Note**: For testing, you can use dummy values like `dummy-key` and `dummy-secret`. The system will skip S3 validation when it detects dummy credentials.

## Server Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DOMAIN` | Domain name for the server (or IP address) | Auto-detected from `SERVER_IP` | No |
| `SERVER_IP` | Public IP address of the server | Auto-detected | No |

If `DOMAIN` is not set, it defaults to `SERVER_IP`. If `SERVER_IP` is not set, the `start.sh` script will attempt to auto-detect it.

## AWS Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AWS_REGION` | AWS region for S3 buckets | `us-east-1` | No |

## Resource Limits

These variables control resource allocation for IDE containers:

| Variable | Description | Default | Unit |
|----------|-------------|---------|------|
| `RESOURCE_CPU_LIMIT` | CPU limit per container | `2` | CPU cores |
| `RESOURCE_MEMORY_LIMIT` | Memory limit per container | `4294967296` | Bytes (4GB) |
| `RESOURCE_CPU_THRESHOLD` | CPU usage threshold for monitoring | `90` | Percent |
| `RESOURCE_MEMORY_THRESHOLD` | Memory usage threshold for monitoring | `90` | Percent |

## Health Check Settings

| Variable | Description | Default | Unit |
|----------|-------------|---------|------|
| `HEALTH_CHECK_INTERVAL` | Interval between health checks | `30000` | Milliseconds |
| `HEALTH_CHECK_TIMEOUT` | Timeout for health check requests | `5000` | Milliseconds |
| `HEALTH_CHECK_RETRIES` | Number of retries before marking unhealthy | `3` | Count |

## Container Restart Policy

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTAINER_RESTART_POLICY` | Docker restart policy for containers | `on-failure` |
| `CONTAINER_RESTART_MAX_ATTEMPTS` | Maximum restart attempts | `3` |

## Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level | `info` |

Valid values: `error`, `warn`, `info`, `debug`

## Pre-warmed Queue

| Variable | Description | Default |
|----------|-------------|---------|
| `PRE_WARMED_QUEUE_SIZE` | Number of pre-warmed containers to maintain | `10` |

## Example .env File

```bash
# Server Configuration
DOMAIN=5.161.59.175
SERVER_IP=5.161.59.175

# API Keys (comma-separated)
API_KEY=test-api-key-12345
API_KEYS=test-api-key-12345

# AWS Configuration (required but can be dummy for testing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=dummy-key
AWS_SECRET_ACCESS_KEY=dummy-secret

# Optional: Resource Limits
RESOURCE_CPU_LIMIT=2
RESOURCE_MEMORY_LIMIT=4294967296
RESOURCE_CPU_THRESHOLD=90
RESOURCE_MEMORY_THRESHOLD=90

# Optional: Health Check Settings
HEALTH_CHECK_INTERVAL=30000
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_RETRIES=3

# Optional: Container Restart Policy
CONTAINER_RESTART_POLICY=on-failure
CONTAINER_RESTART_MAX_ATTEMPTS=3

# Optional: Logging
LOG_LEVEL=info

# Optional: Pre-warmed Queue
PRE_WARMED_QUEUE_SIZE=10
```

## Notes

1. **API_KEY vs API_KEYS**: The application requires `API_KEY` (singular), while deployment scripts use `API_KEYS` (plural). They can be the same value, or `API_KEY` can be the first value from `API_KEYS`.

2. **Auto-detection**: The `start.sh` script will automatically detect `SERVER_IP` if not set, and set `DOMAIN` to `SERVER_IP` if not provided.

3. **Dummy AWS Credentials**: For testing, you can use `dummy-key` and `dummy-secret` as AWS credentials. The system will skip S3 validation when it detects these values.

4. **All optional variables have sensible defaults**: You only need to set the required variables for basic functionality. Optional variables are provided for fine-tuning the system behavior.
