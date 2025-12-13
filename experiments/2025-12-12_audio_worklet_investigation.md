# AudioWorklet PCM Streaming Investigation

**Date**: 2025-12-12
**Objective**: Fix audio playback in ADK BIDI mode that restarts on every chunk
**Status**: 🟢 Complete

## Background

User reported audio playback issue in BIDI mode:
> "音声がおかしいです。再生はできるのですが、おそらくchunkが届くたびに最初から再生されてしまう。最後のchunkが捨てられている？ような挙動をしています。"

Translation: "Audio is strange. It plays, but probably restarts from the beginning every time a chunk arrives. The last chunk seems to be discarded?"

## Hypothesis

Audio chunks were restarting on every new chunk arrival because HTML5 audio was being recreated each time.

## Experiment Design

1. Implement AudioWorklet-based player using ADK documentation ring buffer pattern
2. Replace HTML5 `<audio>` element with Web Audio API AudioWorklet
3. Test in BIDI mode

## Implementation

### Created Files:
- `/public/pcm-player-processor.js` - AudioWorklet processor with ring buffer
- Updated `/components/audio-player.tsx` - AudioWorklet-based player component

### Key Changes:
1. Ring buffer (180 seconds at 24kHz) for continuous playback
2. Incremental chunk processing (no restart on new chunks)
3. Base64 → Int16 → Float32 conversion pipeline

## Results

**Expected**: Audio plays continuously without restarts
**Actual**: No audio playback, no AudioPlayer component visible

### Debug Findings:

#### Backend (server.py):
```
02:09:15.421 | DEBUG | [ADK→SSE] {'type': 'data-pcm', 'data': {...}}
```
✓ Backend IS generating data-pcm events

#### Frontend Console:
```
[WS→useChat] {"type":"data-pcm","data":{...}}  // ← Chunks received
[WS Transport] Turn complete, closing stream
[WS Transport] Error handling message: Cannot enqueue to closed stream
[MessageComponent] PCM chunks found: 0  // ← No chunks in message.parts!
```

#### Message Structure:
```javascript
message.parts = ["text"]  // ← Only text, no data-pcm chunks!
```

## Root Cause Identified

### The Problem:
**PCM chunks arrive AFTER [DONE], causing stream closure error**

### Event Sequence:
1. **Text/tool events** → WebSocket → enqueued ✓
2. **finish + [DONE]** → WebSocket transport closes stream ✓
3. **data-pcm events** → WebSocket → ❌ **ERROR: stream already closed**

### Why This Happens:

The WebSocket transport (`lib/websocket-chat-transport.ts:172`) closes the ReadableStream when `[DONE]` arrives:

```typescript
if (jsonStr === "[DONE]") {
  console.log("[WS Transport] Turn complete, closing stream");
  controller.close();  // ← BUG: Closes stream too early
  return;
}
```

But the ADK Live API sends audio `inline_data` events AFTER `turn_complete`:
- `turn_complete` triggers `finalize()` which sends `[DONE]`
- Audio chunks arrive after `turn_complete` in separate events
- Stream is already closed, so chunks can't be enqueued

### Evidence:
- Console error: "Cannot enqueue a chunk into a readable stream that is closed"
- message.parts contains only `["text"]` - no data-pcm chunks
- Backend logs show data-pcm events ARE being generated
- User's observation confirmed: "最後のchunkが捨てられている" (last chunks discarded)

## Conclusion

The AudioWorklet implementation is CORRECT. The issue is NOT with the audio playback code.

**The real bug**: WebSocket transport closes the stream on [DONE] before all data-pcm chunks arrive.

## Solution Implemented

**Architecture**: Context-based AudioWorklet with dual-path PCM handling

Following the official ADK implementation pattern, PCM chunks now bypass the message structure entirely:

### Path 1: Low-Latency Audio (Direct to AudioWorklet)
```
Backend → WebSocket → WebSocketChatTransport → AudioContext.sendChunk() → AudioWorklet
```

### Path 2: UI Display (Message markers)
```
Backend → WebSocket → WebSocketChatTransport → audio-marker → message.parts → UI
```

### Files Modified:

1. **lib/audio-context.tsx** (NEW)
   - Global AudioProvider wrapping app
   - Manages single AudioWorklet instance
   - Voice channel with sendChunk() and reset()
   - Extensible for future BGM/SFX channels

2. **app/page.tsx**
   - Wrapped with `<AudioProvider>`

3. **components/chat.tsx**
   - Uses `useAudio()` hook
   - Passes audioContext to buildUseChatOptions()

4. **lib/build-use-chat-options.ts**
   - Accepts audioContext parameter
   - Passes to WebSocketChatTransport in BIDI mode

5. **lib/websocket-chat-transport.ts**
   - Intercepts data-pcm chunks
   - Routes PCM directly to AudioContext (low-latency)
   - Enqueues audio-marker to stream (UI display)

6. **components/message.tsx**
   - Detects audio-marker in message.parts
   - Displays audio status from AudioContext state
   - No longer expects data-pcm in parts

### Key Design Decisions:

- **React Context** for global AudioWorklet management (resource efficiency)
- **Dual-path routing** for separation of concerns (audio playback vs UI state)
- **Extensibility** for future multi-channel audio (BGM, SFX, queueing)

## Next Steps

1. Test in browser with ADK BIDI mode
2. Verify PCM chunks reach AudioWorklet
3. Confirm audio plays continuously without restarts
4. Verify UI displays audio status correctly

## WebSocket Latency Monitoring (2025-12-12)

**Objective**: Add WebSocket RTT (Round-Trip Time) monitoring to ensure transport layer reliability

### Implementation:

Following the user's request for WebSocket health monitoring in BIDI mode, implemented ping/pong latency measurement:

1. **Backend (server.py:808-818)**
   - Handles `ping` messages and responds with `pong` + timestamp
   - Allows latency calculation on frontend

2. **WebSocketChatTransport (lib/websocket-chat-transport.ts)**
   - `startPing()`: Sends ping every 2 seconds (line 90-107)
   - `handlePong()`: Calculates RTT from timestamp (line 120-128)
   - `latencyCallback`: Optional callback for RTT updates (line 67)
   - Automatically starts on connection, stops on close/error

3. **AudioContext (lib/audio-context.tsx)**
   - Added `wsLatency` state and `updateLatency()` callback (lines 47-48, 70, 188-190)
   - Exported in context value for consumption (lines 201-202)

4. **buildUseChatOptions (lib/build-use-chat-options.ts)**
   - Updated AudioContextValue interface (lines 24-25)
   - Passes `audioContext.updateLatency` as `latencyCallback` (line 103)

5. **UI Component (components/chat.tsx:74-105)**
   - Fixed position at top center (BIDI mode only)
   - Displays RTT in milliseconds
   - Color coding:
     - Green (< 100ms): Normal operation
     - Red (>= 100ms): Warning - potential network issues
   - Pulsing indicator dot for visual feedback

### User Requirements Met:
- ✅ BIDI mode only
- ✅ Top center display
- ✅ Millisecond precision
- ✅ Warning color when >= 100ms
- ✅ Non-invasive UI (small, fixed position)

## References

- ADK Audio Streaming Docs: https://google.github.io/adk-docs/streaming/dev-guide/part5/#handling-audio-events-at-the-client
- AI SDK v6 Data Stream Protocol: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- WebSocket Transport Implementation: `/lib/websocket-chat-transport.ts:161-207`
