# Critical Bug Fixes Session

**Date:** 2025-12-15
**Status:** 🟢 Complete
**Objective:** Fix 4 critical bugs discovered during testing

## Bugs Identified

1. **Server chunk recorder not working** - Environment variables not being read
2. **WebSocket capacity error broke ADK BIDI** - Previous payload size management was too aggressive
3. **BGM plays when tab inactive** - No visibility handling implemented
4. **Audio file UI overlaps send button** - Poor positioning of audio completion indicator

## Bug Analysis & Fixes

### Bug 1: Server Chunk Recorder Not Working

**Root Cause:**
- `chunk_logger.py` was being imported before `load_dotenv()` was called
- ChunkLogger singleton was initialized with environment variables not yet loaded
- Result: `CHUNK_LOGGER_ENABLED` was always false

**Fix Applied:**
```python
# server.py:20-24
from dotenv import load_dotenv

# Load environment variables from .env.local BEFORE any local imports
# This ensures ChunkLogger reads the correct environment variables
load_dotenv(".env.local")

from stream_protocol import stream_adk_to_ai_sdk  # Now this gets correct env
```

**Verification:**
```python
>>> from chunk_logger import chunk_logger
>>> print(chunk_logger._enabled)
True  # Now correctly reads from .env.local
```

### Bug 2: WebSocket Capacity Error Broke ADK BIDI

**Root Cause:**
- Previous session added aggressive message truncation (limit 50 messages)
- This was breaking ADK BIDI which needs full conversation context
- Truncation was causing context loss in multi-turn conversations

**Previous (Broken) Implementation:**
```typescript
// lib/websocket-chat-transport.ts
const truncatedMessages =
  allMessages.length > MAX_MESSAGES_TO_SEND
    ? allMessages.slice(-MAX_MESSAGES_TO_SEND)  // Only last 50!
    : allMessages;
```

**Fix Applied:**
```typescript
// Send ALL messages without truncation
const event: MessageEvent = {
  type: "message",
  version: "1.0",
  data: {
    messages: options.messages,  // Full history preserved
  },
};

// Adjusted thresholds for warnings only (no truncation)
private static readonly WARN_SIZE_KB = 500;  // Was 100KB
private static readonly ERROR_SIZE_MB = 10;   // Was 5MB
```

**Impact:**
- ADK BIDI now maintains full context
- Only logs warnings for large payloads, doesn't truncate
- Removed obsolete test file: `lib/websocket-chat-transport-payload.test.ts`

### Bug 3: BGM Plays When Tab Inactive

**Root Cause:**
- No `visibilitychange` event listener implemented
- BGM continued playing when user switched tabs

**Fix Applied:**
```typescript
// lib/audio-context.tsx:256-295
const handleVisibilityChange = () => {
  const bgmGain1 = bgmGain1Ref.current;
  const bgmGain2 = bgmGain2Ref.current;
  const audioContext = audioContextRef.current;

  if (document.hidden) {
    // Tab is inactive - fade out BGM
    console.log("[AudioContext] Tab inactive - pausing BGM");
    const now = audioContext.currentTime;

    if (bgmGain1 && bgmGain1.gain.value > 0) {
      bgmGain1.gain.setTargetAtTime(0, now, 0.1); // Fade out quickly
    }
    if (bgmGain2 && bgmGain2.gain.value > 0) {
      bgmGain2.gain.setTargetAtTime(0, now, 0.1);
    }
  } else {
    // Tab is active - restore BGM (unless ducked)
    console.log("[AudioContext] Tab active - resuming BGM");
    const isDucked = isPlayingRef.current;
    const targetVolume = isDucked ? 0.1 : 0.3; // 10% if ducked, 30% normal

    const currentTrack = currentBgmTrackRef.current || 0;
    if (currentTrack === 0 && bgmGain1) {
      bgmGain1.gain.setTargetAtTime(targetVolume, now, 0.3);
    } else if (currentTrack === 1 && bgmGain2) {
      bgmGain2.gain.setTargetAtTime(targetVolume, now, 0.3);
    }
  }
};

document.addEventListener("visibilitychange", handleVisibilityChange);
```

**Additional Changes:**
- Added refs to track state: `currentBgmTrackRef`, `isPlayingRef`
- Updated all state setters to also update refs for visibility handler access

### Bug 4: Audio File UI Overlaps Send Button

**Root Cause:**
- Audio completion indicator positioned at bottom-right
- Overlapped with message send button

**Previous Position:**
```typescript
position: "fixed",
bottom: "1rem",
right: "1rem",
```

**Fix Applied:**
```typescript
// components/chat.tsx

// 1. Added state for auto-hide
const [showAudioCompletion, setShowAudioCompletion] = useState(false);
const audioCompletionTimerRef = useRef<NodeJS.Timeout | null>(null);

// 2. Auto-hide after 3 seconds
useEffect(() => {
  if (mode === "adk-bidi" && audioContext.voiceChannel.lastCompletion) {
    setShowAudioCompletion(true);

    audioCompletionTimerRef.current = setTimeout(() => {
      setShowAudioCompletion(false);
      audioCompletionTimerRef.current = null;
    }, 3000);  // Hide after 3 seconds
  }
}, [mode, audioContext.voiceChannel.lastCompletion]);

// 3. New position: next to WebSocket latency indicator
position: "fixed",
top: "1rem",
left: audioContext.wsLatency !== null ? "calc(50% + 100px)" : "50%",
transform: audioContext.wsLatency !== null ? "none" : "translateX(-50%)",
```

## Test Results

### Python Tests
```bash
============================= 133 passed in 1.84s ==============================
```

### JavaScript/TypeScript Tests
```bash
Test Files  9 passed (13)
Tests      200 passed | 2 skipped (202)
Duration   3.14s
```

**Note:** Removed 8 obsolete truncation tests from `lib/websocket-chat-transport-payload.test.ts`

## Lessons Learned

1. **Import Order Matters**: Environment variables must be loaded before importing modules that use them
2. **Context Preservation**: ADK BIDI requires full message history - truncation breaks functionality
3. **User Experience**: Tab visibility handling is essential for audio/media features
4. **UI Positioning**: Fixed positioning needs careful consideration to avoid overlaps

## Critical Review

The previous session's WebSocket payload size management (commit f428627) was well-intentioned but too aggressive. The truncation at 50 messages was breaking ADK BIDI's ability to maintain conversation context. The fix was to remove truncation entirely while keeping size monitoring for debugging purposes.

## Commits

```bash
commit 08e2c37
fix: Critical bug fixes for chunk recorder, WebSocket, BGM, and audio UI

- Fix server chunk recorder by loading dotenv before imports
- Fix ADK BIDI by removing aggressive message truncation
- Add tab visibility handling to pause BGM when tab is inactive
- Move audio completion UI to top and add 3-second auto-hide
```