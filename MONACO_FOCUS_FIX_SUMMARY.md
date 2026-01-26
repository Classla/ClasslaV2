# Monaco Editor Focus Loss Fix - Implementation Summary

## Problem Solved
Fixed the issue where typing in the Monaco editor caused focus loss and character flickering when a container was connected. This was caused by a feedback loop in the YJS synchronization system.

## Root Cause
Every keystroke triggered this chain:
1. User types in Monaco → YJS update sent to backend
2. Backend forwards to container → Container applies YJS update
3. Container immediately writes to filesystem → File watcher detects change
4. Container syncs file back to YJS → Backend broadcasts to Monaco
5. Monaco receives its own update back → Full content replacement → **Focus lost**

## Changes Made

### 1. Container-Side Debouncing (`classla-ide-container/yjs-container-sync.js`)

**Added:**
- `pendingFileWrites` Map - tracks files waiting to be written
- `lastRemoteUpdateTime` Map - tracks when last remote update was received
- `scheduleBatchedFileWrite()` method - debounces filesystem writes with 2.5 second delay

**Modified:**
- `handleYjsUpdate()` - no longer immediately writes remote updates to filesystem, schedules batched write instead
- `syncYjsToFile()` - added `forceImmediate` parameter for terminal-triggered changes
- `handleFileChange()` - cancels pending batched writes when real filesystem changes detected
- `stop()` - cleans up pending write timers

**Result:** Remote updates from IDE typing are debounced and only written to filesystem after 2.5 seconds of inactivity, breaking the feedback loop.

### 2. Client ID Tracking (`classla-frontend/src/components/Blocks/IDE/MonacoIDE.tsx`)

**Added:**
- `generateClientId()` function - creates unique ID for each IDE instance
- `clientIdRef` - stores client ID for this IDE instance
- Client ID used as transaction origin instead of generic 'monaco'

**Modified:**
- `setupYjsBinding()` - uses client ID in transaction origins
- `yjsObserver` - checks if incoming update origin matches our client ID, skips if it does
- `monacoDisposable` - uses client ID when creating transactions

**Result:** Each IDE instance can identify its own updates and skip applying them, preventing double-updates.

### 3. Improved Cursor Restoration (`classla-frontend/src/components/Blocks/IDE/MonacoIDE.tsx`)

**Changes:**
- Use `model.pushEditOperations()` instead of `model.applyEdits()` for better performance
- Check `editor.hasTextFocus()` before saving/restoring cursor to avoid stealing focus
- Only restore cursor position if it actually moved during the update
- Remove unnecessary `editor.focus()` calls that caused flickering
- Synchronous cursor restoration (no setTimeout/nextTick)

**Result:** Cursor stays in place during YJS updates, no focus loss, smoother typing experience.

### 4. Echo Prevention with Change Tracking (`classla-frontend/src/components/Blocks/IDE/MonacoIDE.tsx`)

**Problem:** Even with client ID tracking, updates sent from Monaco come back from the server with origin "server" (not our client ID), causing the observer to apply them and lose focus.

**Added:**
- `lastMonacoChangeRef` - tracks the last change we made (filePath, content, timestamp)
- Check in `yjsObserver` - if incoming update matches our recent change (within 2 seconds), skip it entirely
- Update tracking in `monacoDisposable` - record every change we make

**Result:** Our own updates never get applied back to Monaco, preventing the echo that caused focus loss.

## How It Works Now

**Before (Feedback Loop):**
```
Type → YJS → Backend → Container → File Write → File Watch → YJS → Backend → Monaco → FOCUS LOST 🔴
       ↓
       Backend echoes back to us (origin: "server") → Monaco applies own update → FOCUS LOST 🔴
```

**After (Fixed):**
```
Type → YJS → Backend → Container → Scheduled Write (2.5s delay) ✅
       ↓                             ↓
       Backend echoes back       Only writes after
       ↓                         you stop typing
       Detected as our own update
       ↓
       Skipped, no Monaco update ✅
```

## Testing Instructions

### Test 1: Typing in Monaco (Primary Fix)
1. Start the backend and frontend
2. Create or open a Python IDE block
3. Start a machine and wait for it to connect
4. Open a file (e.g., `main.py`)
5. **Type continuously** - cursor should stay in editor, no focus loss
6. Characters should appear smoothly without flickering

**Expected:** Smooth typing experience, cursor never leaves the editor.

### Test 2: Terminal-to-IDE Sync (Must Still Work)
1. With machine running, open terminal
2. Run: `echo "# Added from terminal" >> main.py`
3. Check Monaco editor

**Expected:** The new line appears in Monaco within 1-2 seconds.

### Test 3: IDE-to-Filesystem Sync (Debounced)
1. Type some text in Monaco editor
2. Wait 3 seconds (debounce period)
3. In terminal, run: `cat main.py`

**Expected:** File shows the changes you typed after ~2.5 seconds.

### Test 4: Multi-Tab Sync (Client ID Verification)
1. Open the same IDE block in two browser tabs
2. Type in Tab 1
3. Observe Tab 2

**Expected:** Changes appear in Tab 2, no focus loss in either tab.

### Test 5: Rapid File Edits from Terminal
1. Run a script that edits files rapidly:
   ```bash
   for i in {1..10}; do echo "Line $i" >> test.txt; sleep 0.1; done
   ```
2. Watch Monaco editor

**Expected:** Updates appear smoothly in Monaco, terminal changes take priority over debounced IDE writes.

## Rollback Instructions
If issues occur, revert these files:
- `classla-ide-container/yjs-container-sync.js`
- `classla-frontend/src/components/Blocks/IDE/MonacoIDE.tsx`

## Performance Impact

### Positive:
- Reduced network traffic (fewer redundant YJS updates)
- Smoother typing experience in Monaco
- Less CPU usage from reduced filesystem writes

### Trade-off:
- IDE changes take 2.5 seconds to appear in container filesystem (acceptable for most workflows)
- Terminal/command-line changes still sync immediately (no impact on development workflow)

## Technical Details

### Debounce Timing
- **2.5 seconds** chosen as optimal balance between:
  - Batching multiple keystrokes (typical typing speed: 3-5 chars/second)
  - Not delaying too long for users who run code immediately after editing
  
### Client ID Format
- Format: `monaco-{timestamp}-{random}`
- Example: `monaco-1705419234567-x8k2m9p3q`
- Unique per browser tab/IDE instance

### Why This Works
1. **Breaks feedback loop:** Container no longer echoes back IDE keystrokes immediately
2. **Identifies update source:** Client IDs prevent clients from applying their own updates twice
3. **Preserves focus:** Better cursor restoration prevents Monaco from losing focus
4. **Maintains correctness:** Terminal changes still sync immediately, filesystem eventually consistent

## Monitoring
Watch console logs for these messages:

**Good signs (expected during typing):**
- `⏰ Scheduled batched write` - Remote update debounced
- `⏭️ Skipping Y.js update - matches our recent Monaco change` - **Echo prevented!**
- `📤 Monaco -> Y.js: Updated Y.js` - Your change sent to YJS
- `💾 Writing batched update to filesystem` - Debounced write executing (after idle)

**Expected events:**
- `✅ Cancelled pending batched write` - Terminal change overrode debounce
- `📥 Y.js -> Monaco: Updated` - Real remote update applied (from terminal/other tab)

**Bad signs (should not see when typing):**
- `📥 Y.js -> Monaco: Updated` immediately after `📤 Monaco -> Y.js` - Echo not caught
- Multiple rapid Monaco updates - Indicates feedback loop still occurring

## Known Limitations
- Container filesystem lags behind IDE by up to 2.5 seconds during active editing
  - This is **intentional** and prevents the feedback loop
  - Users should wait ~3 seconds after typing before running code
  - Or press a "Save All" button if implemented
