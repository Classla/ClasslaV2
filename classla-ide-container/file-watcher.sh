#!/bin/bash
# Don't use set -e - we want to continue even if individual operations fail

echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Starting file watcher..."

S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"
WORKSPACE_PATH="/workspace"
BACKEND_API_URL="${BACKEND_API_URL:-http://localhost:8000/api}"

# Track last sync time per file to avoid loops
declare -A LAST_SYNC_TIME
SYNC_DEBOUNCE_SECONDS=2

# Function to sync a file to backend
sync_file_to_backend() {
    local file_path="$1"
    local bucket_id="$2"
    local relative_path="${file_path#$WORKSPACE_PATH/}"
    
    # Skip if recently synced
    local last_sync="${LAST_SYNC_TIME[$relative_path]:-0}"
    local now=$(date +%s)
    if [ $((now - last_sync)) -lt $SYNC_DEBOUNCE_SECONDS ]; then
        return 0
    fi
    
    # Skip if file doesn't exist or is a directory
    if [ ! -f "$file_path" ]; then
        return 0
    fi
    
    # Skip excluded directories
    if [[ "$relative_path" == .git/* ]] || [[ "$relative_path" == node_modules/* ]] || [[ "$relative_path" == __pycache__/* ]] || [[ "$relative_path" == .vscode/* ]] || [[ "$relative_path" == .idea/* ]]; then
        return 0
    fi
    
    # Read file content
    local content=$(cat "$file_path")
    
    # URL encode the file path (not strictly necessary for JSON body, but kept for reference)
    local encoded_path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$relative_path'))")
    
    # POST to backend API (container sync endpoint)
    local service_token="${CONTAINER_SERVICE_TOKEN:-}"
    
    # Create JSON payload using python to properly escape content
    local json_payload=$(python3 -c "
import sys
import json
file_path = sys.argv[1]
content = sys.stdin.read()
payload = {
    'filePath': file_path,
    'content': content
}
print(json.dumps(payload))
" "$relative_path" <<< "$content")
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_API_URL}/s3buckets/${bucket_id}/files/sync-from-container" \
        -H "Content-Type: application/json" \
        -H "X-Container-Service-Token: ${service_token}" \
        -d "$json_payload" 2>&1)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        LAST_SYNC_TIME[$relative_path]=$(date +%s)
        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Synced $relative_path to backend (HTTP $http_code)"
    else
        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] ERROR: Failed to sync $relative_path (HTTP $http_code): $body"
    fi
}

# Wait for S3 assignment file
if [ ! -f "$S3_ASSIGNMENT_FILE" ]; then
    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Waiting for S3 bucket assignment..."
    while [ ! -f "$S3_ASSIGNMENT_FILE" ]; do
        sleep 2
    done
fi

# Read bucket ID from assignment file
BUCKET_ID=$(python3 -c "import json; f=open('$S3_ASSIGNMENT_FILE'); d=json.load(f); print(d.get('bucketId', ''))" 2>/dev/null || echo "")
if [ -z "$BUCKET_ID" ]; then
    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] ERROR: Could not read bucketId from assignment file"
    exit 1
fi

echo "[$(date +%Y-%m-%d\ %H:%M:%S)] File watcher started for bucket: $BUCKET_ID"
echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Watching $WORKSPACE_PATH for changes..."

# Watch for file changes using inotifywait
inotifywait -m -r --format "%w%f %e" -e modify,create,close_write "$WORKSPACE_PATH" 2>/dev/null | while read file_path events; do
    # Debounce: wait a moment for file to be fully written
    sleep 0.5
    sync_file_to_backend "$file_path" "$BUCKET_ID"
done

