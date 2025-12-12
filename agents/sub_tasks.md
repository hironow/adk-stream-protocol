# Agent Sub-Tasks (Handoff Queue)

This file contains implementation tasks that are ready to be handed off to other developers or agents.

---

## [ST-1] Frontend Audio Recording for Message Replay

**Status:** ✅ Complete (Implemented 2025-12-12)
**Priority:** Medium
**Actual Effort:** ~2 hours

### Objective

Add a second audio pipeline that records PCM chunks on the frontend and allows users to replay audio for each message in the chat history. This feature is completely independent from the existing low-latency PCM streaming (Pipeline 1).

### Background

Currently, the application has a low-latency PCM audio streaming system (Pipeline 1):
- WebSocket receives PCM chunks → AudioWorklet for immediate playback
- Audio is not saved, only played once in real-time
- Users cannot replay audio from past messages

This task adds a second, independent pipeline (Pipeline 2):
- Buffer PCM chunks on the frontend during streaming
- Convert to WAV and encode as base64 data URI on turn completion
- Save to message.parts for replay via standard HTML5 `<audio>` element

### Key Design Principles

1. **Two Independent Pipelines:** Pipeline 1 (real-time) and Pipeline 2 (recording) do not interfere with each other
2. **Frontend-Only Implementation:** No backend changes required, all processing happens in the browser
3. **Simple Base64 Storage:** Audio stored as `data:audio/wav;base64,...` in message history
4. **No PCM-Player-Processor Changes:** Keep AudioWorklet simple, add recording logic to WebSocket transport layer

### Architecture

```
WebSocket PCM Chunk Reception
    ↓
    ├─→ Pipeline 1: AudioWorklet (immediate low-latency playback) ✅ Already implemented
    │
    └─→ Pipeline 2: Frontend Recording Buffer (new feature)
              ↓
          On turn completion ([DONE] message):
              1. Combine all PCM chunks
              2. Convert to WAV format
              3. Encode as base64 data URI
              4. Add to message.parts as audio-info
              ↓
          User can replay via <audio> element
```

### Implementation Details

#### 1. WebSocket Transport Layer (lib/websocket-chat-transport.ts)

**Add recording buffer:**

```typescript
export class WebSocketChatTransport implements ChatTransport<UIMessage> {
  // New: Recording buffer for Pipeline 2
  private currentTurnPCMBuffer: Int16Array[] = [];
  private currentTurnChunkCount = 0;

  private handleWebSocketMessage(data: string, controller: ReadableStreamDefaultController<UIMessageChunk>): void {
    // ... existing code ...

    if (chunk.type === "data-pcm" && this.config.audioContext) {
      // Pipeline 1: Existing low-latency playback (DO NOT CHANGE)
      this.config.audioContext.voiceChannel.sendChunk({
        content: chunk.data.content,
        sampleRate: chunk.data.sampleRate,
        channels: chunk.data.channels,
        bitDepth: chunk.data.bitDepth,
      });

      // Pipeline 2: NEW - Buffer for recording
      const pcmData = this.base64ToInt16Array(chunk.data.content);
      this.currentTurnPCMBuffer.push(pcmData);
      this.currentTurnChunkCount++;

      return;
    }

    // On turn completion
    if (jsonStr === "[DONE]") {
      // NEW - Finalize recording
      if (this.currentTurnPCMBuffer.length > 0) {
        await this.finalizeRecording(controller);
      }

      controller.close();
      this.audioChunkIndex = 0;
      return;
    }
  }
}
```

**Add helper methods:**

```typescript
private async finalizeRecording(controller: ReadableStreamDefaultController<UIMessageChunk>) {
  try {
    // 1. Combine PCM chunks
    const totalLength = this.currentTurnPCMBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const combinedPCM = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of this.currentTurnPCMBuffer) {
      combinedPCM.set(chunk, offset);
      offset += chunk.length;
    }

    // 2. Convert to WAV
    const wavBlob = this.pcmToWav(combinedPCM, 24000, 1, 16);

    // 3. Encode as base64
    const base64Audio = await this.blobToBase64(wavBlob);

    // 4. Add to message stream
    controller.enqueue({
      type: "audio-info",
      realtimeStream: {
        chunkCount: this.currentTurnChunkCount,
        estimatedDuration: `${(this.currentTurnChunkCount * 0.04).toFixed(2)}s`
      },
      recording: {
        data: base64Audio,  // data:audio/wav;base64,...
        format: "wav",
        mimeType: "audio/wav",
        duration: combinedPCM.length / 24000
      }
    } as any);

  } catch (err) {
    console.error("[WS Transport] Error finalizing recording:", err);
  } finally {
    // Reset buffer
    this.currentTurnPCMBuffer = [];
    this.currentTurnChunkCount = 0;
  }
}

private base64ToInt16Array(base64: string): Int16Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

private pcmToWav(pcmData: Int16Array, sampleRate: number, channels: number, bitDepth: number): Blob {
  // WAV header creation
  const dataLength = pcmData.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  this.writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  this.writeString(view, 8, 'WAVE');

  // fmt chunk
  this.writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bitDepth / 8, true);
  view.setUint16(32, channels * bitDepth / 8, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  this.writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Copy PCM data
  const pcmView = new Int16Array(buffer, 44);
  pcmView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

private writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

private async blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

#### 2. Message Component (components/message.tsx)

**Update to display both pipelines:**

```typescript
const audioInfo = message.parts?.find((p: any) => p.type === "audio-info");

{audioInfo && (
  <div style={{ margin: "0.75rem 0", padding: "0.75rem", background: "#0a0a0a", borderRadius: "6px" }}>
    {/* Pipeline 1: Real-time stream info */}
    {audioInfo.realtimeStream && (
      <div style={{ fontSize: "0.875rem", color: "#888", marginBottom: "0.5rem" }}>
        🔊 Audio streamed: {audioInfo.realtimeStream.chunkCount} chunks
        (~{audioInfo.realtimeStream.estimatedDuration})
      </div>
    )}

    {/* Pipeline 2: Recording playback */}
    {audioInfo.recording && (
      <div>
        <audio
          controls
          src={audioInfo.recording.data}
          style={{ width: "100%", maxWidth: "400px" }}
        />
        <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
          Recorded audio ({audioInfo.recording.duration.toFixed(2)}s, {audioInfo.recording.format.toUpperCase()})
        </div>
      </div>
    )}
  </div>
)}
```

### Files to Modify

1. **lib/websocket-chat-transport.ts** (Primary changes)
   - Add `currentTurnPCMBuffer` and `currentTurnChunkCount` fields
   - Modify `handleWebSocketMessage()` to buffer PCM chunks
   - Add `finalizeRecording()` method
   - Add utility methods: `base64ToInt16Array()`, `pcmToWav()`, `writeString()`, `blobToBase64()`

2. **components/message.tsx** (UI changes)
   - Update audio display section to show both pipelines
   - Add `<audio>` element for recorded playback

### Testing Checklist

- [ ] Real-time audio playback still works (Pipeline 1 unchanged)
- [ ] PCM chunks are buffered during streaming
- [ ] WAV conversion produces valid audio file
- [ ] base64 encoding completes without errors
- [ ] `audio-info` chunk is enqueued to message stream
- [ ] Audio player appears in message UI
- [ ] Recorded audio can be played back
- [ ] Multiple messages each have their own recordings
- [ ] Page reload preserves recorded audio in message history
- [ ] No memory leaks with multiple recordings

### Acceptance Criteria

1. Users can replay audio from any past assistant message
2. Real-time low-latency playback (Pipeline 1) is unaffected
3. No backend changes required
4. Audio stored as base64 data URI in message history
5. Standard HTML5 `<audio>` controls for playback

### Notes

- **Data Size:** 1 minute of audio ≈ 3MB (WAV base64)
- **Future Optimization:** Can add feature flag to enable/disable recording
- **Browser Compatibility:** All modern browsers support data URIs and `<audio>` element

**Related Tasks:**
- **[P2-T7] Audio Completion Signaling** (agents/tasks.md)
  - [P2-T7] provides the completion signal via `finish` event with `messageMetadata.audio`
  - [ST-1] uses that signal in `finalizeRecording()` to know when to save recording
  - Backend already sends completion metadata (chunks, bytes, duration)
  - Frontend integration (AudioContext callback) needed for both features

### References

- Current implementation: `lib/websocket-chat-transport.ts:276-302` (Pipeline 1)
- AudioWorklet processor: `public/pcm-player-processor.js`
- Message display: `components/message.tsx:106-151`

---

**Handoff Status:** Ready for implementation
**Dependencies:** None (completely independent feature)
**Estimated Time:** 2-4 hours
