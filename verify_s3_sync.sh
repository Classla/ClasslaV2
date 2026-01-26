#!/bin/bash
# Comprehensive S3 sync verification script
# This script will test if files are actually being synced to S3

echo "=== S3 Sync Verification Script ==="
echo ""
echo "This script will:"
echo "1. Find a container with S3 assignment"
echo "2. Create a test file"
echo "3. Wait for sync"
echo "4. Verify with AWS CLI that file is in S3"
echo ""

# Find container with S3 assignment
CONTAINER_ID=""
for id in $(docker ps -q --filter "name=ide-"); do
    if docker exec $id ls /tmp/s3-assignment.json 2>/dev/null > /dev/null; then
        CONTAINER_ID=$id
        echo "✅ Found container with S3 assignment: $CONTAINER_ID"
        break
    fi
done

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ No container with S3 assignment found."
    echo "   Please start a container from the frontend first."
    exit 1
fi

# Get S3 credentials
echo ""
echo "=== Getting S3 credentials ==="
docker exec $CONTAINER_ID cat /tmp/s3-assignment.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('BUCKET=' + d.get('bucket', ''))
print('REGION=' + d.get('region', 'us-east-1'))
print('ACCESS_KEY=' + d.get('accessKeyId', ''))
print('SECRET_KEY=' + d.get('secretAccessKey', ''))
" > /tmp/s3_creds.txt

BUCKET=$(grep "^BUCKET=" /tmp/s3_creds.txt | cut -d'=' -f2)
REGION=$(grep "^REGION=" /tmp/s3_creds.txt | cut -d'=' -f2)
ACCESS_KEY=$(grep "^ACCESS_KEY=" /tmp/s3_creds.txt | cut -d'=' -f2)
SECRET_KEY=$(grep "^SECRET_KEY=" /tmp/s3_creds.txt | cut -d'=' -f2)

echo "Bucket: $BUCKET"
echo "Region: $REGION"
echo ""

# Create test file
echo "=== Step 1: Creating test file ==="
TEST_CONTENT="S3_VERIFY_$(date +%s)_$(date +%N)"
docker exec $CONTAINER_ID bash -c "echo '$TEST_CONTENT' > /workspace/s3_verify_test.txt && cat /workspace/s3_verify_test.txt"
echo ""

# Check S3 BEFORE sync
echo "=== Step 2: Checking S3 BEFORE sync ==="
export AWS_ACCESS_KEY_ID=$ACCESS_KEY
export AWS_SECRET_ACCESS_KEY=$SECRET_KEY
export AWS_DEFAULT_REGION=$REGION

if aws s3 ls s3://$BUCKET/s3_verify_test.txt --region $REGION 2>&1 | grep -q "s3_verify_test.txt"; then
    echo "⚠️  File already exists in S3 (from previous test)"
else
    echo "✅ File not in S3 yet (expected)"
fi
echo ""

# Wait for sync
echo "=== Step 3: Waiting 25 seconds for sync cycle ==="
sleep 25
echo ""

# Check container logs
echo "=== Step 4: Checking container sync logs ==="
docker logs $CONTAINER_ID 2>&1 | grep -E "(s3_verify_test|Pushing|push|Transferred|Copied)" | tail -15
echo ""

# Check sync processes
echo "=== Step 5: Checking if sync processes are running ==="
if docker exec $CONTAINER_ID ps aux | grep -E "(rclone|rsync)" | grep -v grep > /dev/null; then
    echo "✅ Sync processes are running"
    docker exec $CONTAINER_ID ps aux | grep -E "(rclone|rsync)" | grep -v grep
else
    echo "❌ No sync processes running!"
fi
echo ""

# Check S3 AFTER sync with AWS CLI
echo "=== Step 6: Verifying file in S3 with AWS CLI ==="
if aws s3 ls s3://$BUCKET/s3_verify_test.txt --region $REGION 2>&1 | grep -q "s3_verify_test.txt"; then
    echo "✅ SUCCESS: File found in S3!"
    echo ""
    echo "File content in S3:"
    aws s3 cp s3://$BUCKET/s3_verify_test.txt - --region $REGION 2>&1
    echo ""
    echo "File content in container:"
    docker exec $CONTAINER_ID cat /workspace/s3_verify_test.txt
    echo ""
    if [ "$(aws s3 cp s3://$BUCKET/s3_verify_test.txt - --region $REGION 2>&1)" = "$TEST_CONTENT" ]; then
        echo "✅ Content matches!"
    else
        echo "❌ Content mismatch!"
    fi
else
    echo "❌ FAILED: File NOT found in S3!"
    echo ""
    echo "Listing all files in bucket:"
    aws s3 ls s3://$BUCKET/ --region $REGION 2>&1 | head -20
    echo ""
    echo "This means sync is NOT working. Check container logs for errors."
fi

