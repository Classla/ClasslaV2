# Container Sync Test Instructions

## Prerequisites
1. Backend running on http://localhost:8000 ✅
2. Container started with S3 bucket assigned
3. Container ID and Bucket ID available

## Test Steps

### 1. Run Python code in container
```bash
curl -X POST http://localhost:8000/api/ide-blocks/container/{CONTAINER_ID}/run \
  -H "Content-Type: application/json" \
  -d '{
    "code": "with open(\"test.txt\", \"w\") as f: f.write(\"Hello world\")
print(\"Created test.txt\")",
    "language": "python"
  }'
```

### 2. Check if file appears in IDE immediately
- Open IDE in browser
- Look for test.txt in file tree (should appear ~5 seconds after code runs)

### 3. Verify content persistence
- Refresh the page
- Open test.txt
- Should contain "Hello world" (not be blank)

### 4. Run the test script
```bash
./run-container-test.sh {CONTAINER_ID} {BUCKET_ID}
```

## Expected Results
- ✅ test.txt appears in IDE file tree immediately
- ✅ test.txt has content "Hello world" after page refresh
- ✅ Container logs show sync activity (not crashes)

## Debug Steps
If test fails:
1. Check container logs for Y.js sync errors
2. Check backend logs for file-tree-change broadcasts  
3. Check frontend console for WebSocket connection issues
4. Verify container can write to /workspace directory

The fixes implemented should resolve:
- Container crashes (error handling added)
- Files not syncing (filesystem-sync updates now sent)
- Files appearing blank (Y.js saves to S3 with file content)
