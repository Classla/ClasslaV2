# Monaco Focus Loss - Enhanced Debugging Guide

## New Logging Features

I've added comprehensive logging and monitoring to help diagnose the focus loss issue. Here's what's been added:

### 1. Typing State Tracking
- **`isTypingRef`** - Tracks when user is actively typing
- **`typingTimeoutRef`** - Clears typing state after 500ms of inactivity
- **Effect**: Remote YJS updates are **blocked** while user is typing to prevent focus loss

### 2. Detailed Update Logging
- **`yjsUpdateLogRef`** - Logs all YJS updates with:
  - Timestamp
  - File path
  - Origin (server/client ID)
  - Content preview
  - Whether update was skipped and why

### 3. Enhanced Console Logging
Every YJS update now logs:
- Whether user is typing
- Update origin
- Content lengths
- Whether focus was maintained
- Whether cursor moved
- Why updates were skipped

### 4. Browser Console Debugging Tools

Open browser console and use these commands:

```javascript
// View last 20 YJS updates in a table
monacoIDEUpdateLog()

// View full update log
monacoIDEUpdateLog().forEach(entry => console.log(entry))

// Clear the log
monacoIDEClearLog()

// Check current typing state
monacoIDETypingState()
```

## What to Look For

### Good Signs (Expected Behavior)
When typing, you should see:
```
[MonacoIDE] 🔔 Monaco content changed for main.py!
[MonacoIDE] 📤 Monaco -> Y.js: Sending update for main.py
[MonacoIDE] ✅ Monaco -> Y.js: Successfully updated Y.js for main.py
[MonacoIDE] ⌨️  Typing state cleared (500ms idle)
```

When remote update comes in while typing:
```
[MonacoIDE] 🔍 YJS Observer triggered for main.py
[MonacoIDE] ⏭️  Skipping Y.js update - user is actively typing
```

### Bad Signs (Indicates Problem)
If you see these, there's still an issue:

1. **Updates applied while typing:**
```
[MonacoIDE] 📥 APPLYING Y.js update to Monaco for main.py
  isTyping: true  ← BAD! Should be false
```

2. **Echo not detected:**
```
[MonacoIDE] 📤 Monaco -> Y.js: Sending update
[MonacoIDE] 📥 APPLYING Y.js update to Monaco  ← Should be skipped!
```

3. **Focus loss:**
```
[MonacoIDE] ✅ Y.js -> Monaco: Successfully updated
  hadFocus: false  ← Lost focus!
```

## Debugging Steps

1. **Open browser console** before typing
2. **Type continuously** in the editor
3. **Check console logs** for:
   - Are updates being blocked while typing? (should see "user is actively typing")
   - Are echoes being caught? (should see "matches our recent Monaco change")
   - Is focus maintained? (check `hadFocus` in logs)

4. **Run debug commands:**
   ```javascript
   // Check typing state
   monacoIDETypingState()
   
   // See recent updates
   monacoIDEUpdateLog()
   ```

5. **Look for patterns:**
   - If updates are applied while `isTyping: true` → typing detection not working
   - If echoes aren't caught → change tracking needs improvement
   - If focus is lost → cursor restoration needs work

## Key Improvements Made

### 1. Typing State Blocking
```typescript
// When user types
isTypingRef.current = true;
setTimeout(() => {
  isTypingRef.current = false;
}, 500);

// In YJS observer
if (isTypingRef.current) {
  console.log('⏭️ Skipping - user is actively typing');
  return; // Block update!
}
```

### 2. Enhanced Echo Detection
- Tracks last Monaco change (content + timestamp)
- Compares incoming YJS updates against recent changes
- Skips if content matches within 2 seconds

### 3. Better Cursor Restoration
- Uses `requestAnimationFrame` for smoother cursor restoration
- Only restores if cursor actually moved
- Avoids unnecessary focus() calls

## Next Steps

If focus loss still occurs:

1. **Check the logs** - What pattern do you see?
2. **Share the console output** - Especially the update log
3. **Check timing** - Are updates happening too fast?
4. **Verify typing detection** - Is `isTypingRef` working?

The logs will tell us exactly where the problem is!
