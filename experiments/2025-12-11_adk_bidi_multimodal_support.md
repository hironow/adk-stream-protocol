# ADK BIDI Multimodal Support in AI SDK v6 Data Stream Protocol

**Date:** 2025-12-11
**Status:** 🟡 In Progress
**Objective:** Investigate and implement ADK BIDI mode's multimodal capabilities (audio, video, images) within AI SDK v6 Data Stream Protocol constraints

## Background

Following the successful integration of ADK BIDI mode with AI SDK v6 useChat hook via WebSocket, we now investigate how much of BIDI mode's unique multimodal capabilities can be supported through the AI SDK v6 Data Stream Protocol.

**Key Question:** Can we "force" BIDI mode's advanced features into AI SDK v6's Data Stream Protocol format?

## Research Findings

### AI SDK v6 Data Stream Protocol Capabilities

**Supported Event Types:**

**Text Content:**
- `text-start`, `text-delta`, `text-end` - Text streaming
- `reasoning-start`, `reasoning-delta`, `reasoning-end` - Model reasoning

**Tool Integration:**
- `tool-input-start`, `tool-input-delta`, `tool-input-available` - Tool parameter streaming
- `tool-output-available` - Tool execution results

**File References:**
- `file` - File references with media types (e.g., "image/png", "audio/wav")
- `source-document` - Document references with media types
- `source-url` - External URL references

**Custom Data:**
- `data-*` pattern - Arbitrary structured data with custom type suffixes
- Examples: `data-audio-chunk`, `data-video-frame`, `data-image`

**Message Control:**
- `start`, `finish-step`, `finish`, `error`, `[DONE]`

**Key Constraint:**
- `useCompletion`: Supports only `text` and `data` stream parts
- `useChat`: Supports full protocol range including files and sources
- **No native audio/video streaming UI support in useChat**

### ADK BIDI Mode Exclusive Features

**1. Real-Time Audio/Video Streaming**
- BIDI mode exclusively supports native audio models
- `send_realtime(audio)` for continuous audio blob streaming
- Live audio streaming with immediate turn-taking
- Voice Activity Detection (VAD) configuration

**2. Bidirectional Communication**
- Simultaneous sending and receiving via WebSocket
- Unlike SSE's request-then-stream pattern
- Mid-response interruption support

**3. LiveRequestQueue Advanced Capabilities**
- `send_content(text)` - New conversational turns
- `send_realtime(audio)` - Real-time audio streaming
- Dynamic content injection during streaming

**4. Advanced Session Features**
- Audio transcription (user speech + model output)
- Proactivity and affective dialog (emotional adaptation)
- Session resumption with automatic reconnection
- Context window compression for unlimited sessions
- Natural turn detection via `turn_complete` flag

**Critical Constraint:**
- **Single response modality per session**: TEXT or AUDIO output (not both)
- Multimodal input (text, voice, video) always available
- Current implementation uses `response_modalities=["TEXT"]`

## Gap Analysis: Current Implementation vs BIDI Capabilities

### Current Implementation (server.py:469-578)

```python
@app.websocket("/live")
async def live_chat(websocket: WebSocket):
    # ...
    run_config = RunConfig(response_modalities=["TEXT"])  # ← TEXT only!

    live_events = agent_runner.run_live(
        user_id="live_user",
        session_id=session.id,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )
```

**What Works Now:**
- ✅ Text input/output via WebSocket
- ✅ Tool calling
- ✅ SSE format protocol conversion
- ✅ Bidirectional message flow

**What's Missing:**
- ❌ Multimodal input (images, audio, video)
- ❌ Audio output streaming
- ❌ Real-time audio with `send_realtime()`
- ❌ Custom data events for media

## Compatibility Matrix

| Feature | ADK BIDI Support | AI SDK v6 Protocol | Frontend (useChat) | Feasibility |
|---------|------------------|--------------------|--------------------|-------------|
| **Text I/O** | ✅ Full | ✅ `text-*` events | ✅ Native | ✅ **Working** |
| **Tool Calling** | ✅ Full | ✅ `tool-*` events | ✅ Native | ✅ **Working** |
| **Image Input** | ✅ Full | ✅ `file` event | ⚠️ Custom UI | 🟡 **Possible** |
| **Image Output** | ✅ Full | ✅ `file` event | ⚠️ Custom UI | 🟡 **Possible** |
| **Audio Input** | ✅ `send_realtime()` | ⚠️ `data-audio-*` custom | ❌ No native UI | 🟠 **Difficult** |
| **Audio Output** | ✅ `AUDIO` modality | ⚠️ `data-audio-*` custom | ❌ No native UI | 🟠 **Difficult** |
| **Video I/O** | ✅ Full | ⚠️ `data-video-*` custom | ❌ No native UI | 🟠 **Difficult** |
| **VAD** | ✅ Live API | ❌ Not applicable | ❌ Custom needed | ❌ **Not feasible** |
| **Turn Detection** | ✅ `turn_complete` | ⚠️ Map to `finish` | ⚠️ Partial | 🟡 **Possible** |
| **Interruption** | ✅ Mid-response | ✅ WebSocket | ⚠️ Custom logic | 🟡 **Possible** |

**Legend:**
- ✅ Full support
- ⚠️ Partial or custom implementation needed
- ❌ Not supported
- 🟢 **Working** - Already implemented
- 🟡 **Possible** - Requires extension but feasible
- 🟠 **Difficult** - Significant custom work required
- ❌ **Not feasible** - Fundamental incompatibility

## Hypothesis: Multimodal Extension Strategy

### Phase 1: Image Input/Output (Most Feasible)

**Approach:**
1. Extend `ChatMessage.to_adk_content()` to handle image parts
2. Use AI SDK v6 `file` event type for images
3. Add custom UI components to render images in chat

**Protocol Flow:**
```
Frontend (Image Upload)
  ↓
WebSocket JSON: {
  messages: [{
    role: "user",
    parts: [
      { type: "text", text: "What's in this image?" },
      { type: "file", data: "base64...", mediaType: "image/png" }
    ]
  }]
}
  ↓
server.py: ChatMessage.to_adk_content()
  → types.Content(parts=[
      types.Part(text="..."),
      types.Part(inline_data={"mime_type": "image/png", "data": base64_bytes})
    ])
  ↓
ADK Agent processes multimodal input
  ↓
stream_adk_to_ai_sdk() converts response
  ↓
SSE: data: {"type":"file","mediaType":"image/png","data":"base64..."}
  ↓
WebSocketChatTransport parses
  ↓
Custom UI renders image
```

**Implementation Requirements:**
- [ ] Extend `ChatMessage` model to support `parts` with file type
- [ ] Add image encoding/decoding in `to_adk_content()`
- [ ] Extend `stream_protocol.py` to handle image output parts
- [ ] Add `data-image` custom event type
- [ ] Create custom React component for image display

### Phase 2: Audio Streaming (More Complex)

**Approach:**
1. Use `data-audio-chunk` custom events
2. Implement audio recording in frontend (Web Audio API)
3. Stream audio via WebSocket with `send_realtime()`
4. Change `response_modalities=["AUDIO"]`

**Protocol Flow:**
```
Frontend (Microphone)
  ↓ Web Audio API
WebSocket: { type: "realtime-audio", data: ArrayBuffer }
  ↓
server.py: live_request_queue.send_realtime(audio_bytes)
  ↓
ADK Live API processes audio
  ↓
Output: Audio response chunks
  ↓
stream_adk_to_ai_sdk():
  SSE: data: {"type":"data-audio-chunk","chunk":"base64..."}
  ↓
Custom Audio Player in Frontend
```

**Challenges:**
- AI SDK v6 `useChat` has no native audio playback
- Need custom audio player component
- Real-time audio buffering and playback synchronization
- Latency management

### Phase 3: Video (Most Complex)

Similar to audio but with higher bandwidth and complexity.

## Experiment Design

### Objective
Implement image input/output support in ADK BIDI mode while maintaining AI SDK v6 Data Stream Protocol compatibility.

### Scope (Phase 1 Focus)
- **In Scope:** Image upload and display via custom events
- **Out of Scope:** Audio/video streaming (future experiment)

### Expected Results
- User can upload images in chat
- ADK agent can analyze images (via Gemini vision capabilities)
- Agent responses with images render correctly
- All existing text/tool functionality preserved

### Implementation Steps

**Backend (server.py, stream_protocol.py):**
1. Add `InlineData` and `FileData` to `ChatMessage` model
2. Extend `to_adk_content()` to handle image parts
3. Add image output handling in `StreamProtocolConverter`
4. Create `_process_inline_data_part()` method
5. Use `data-image` custom event type

**Frontend (lib/websocket-chat-transport.ts, components/):**
1. Add file upload input component
2. Convert uploaded images to base64
3. Send image parts via WebSocket
4. Handle `data-image` events in transport
5. Create `ImageDisplay` component
6. Integrate with existing `MessageComponent`

### Success Criteria
- [ ] User can upload PNG/JPEG images in chat UI
- [ ] Images sent via WebSocket in correct format
- [ ] ADK agent receives and processes images
- [ ] Agent can describe image contents
- [ ] Agent-generated images (if any) display correctly
- [ ] No regression in text/tool functionality
- [ ] Protocol stays compatible with AI SDK v6

## Risks and Mitigation

### Risk 1: AI SDK v6 Strict Protocol Validation
**Mitigation:** Use `data-*` custom events as escape hatch

### Risk 2: Performance Issues with Base64 Encoding
**Mitigation:**
- Compress images before upload
- Use progressive loading for large images
- Consider binary WebSocket frames (separate experiment)

### Risk 3: UI Complexity
**Mitigation:**
- Keep UI simple for Phase 1
- Use existing React image components
- Incremental implementation

### Risk 4: Breaking Existing Functionality
**Mitigation:**
- Comprehensive testing of text/tool modes
- Backward compatibility checks
- Feature flags for multimodal mode

## Open Questions

1. **Q:** Should we use `file` events or `data-image` custom events?
   **A:** Start with `data-image` for more control, migrate to `file` if AI SDK adds native support

2. **Q:** How to handle multiple images in one message?
   **A:** Follow AI SDK v6 parts array pattern: `parts: [text, image1, image2]`

3. **Q:** Base64 in JSON or binary WebSocket frames?
   **A:** Phase 1: Base64 in JSON (simpler), Phase 2: Binary frames (optimal)

4. **Q:** Can we mix TEXT and AUDIO response modalities?
   **A:** No - ADK limitation. Must choose one per session.

## Implementation Decision

**Decision Date:** 2025-12-11

After analyzing the compatibility matrix and feasibility assessment, we have decided to proceed with **Phase 1: Image Support** implementation.

**Rationale:**
1. **Highest value-to-complexity ratio**: Images are widely used in modern AI applications
2. **Clear protocol path**: AI SDK v6's `data-*` custom events provide clean extension point
3. **Proven ADK capability**: Gemini models have strong vision capabilities
4. **Foundation for future work**: Image support paves the way for other multimodal features

**Scope:**
- Image upload in chat interface (PNG, JPEG, WebP)
- Image transmission via WebSocket (base64 encoded)
- ADK vision model processing
- Image display in chat messages (user uploads + agent responses)
- Backward compatibility with existing text/tool functionality

**Out of Scope (Future Phases):**
- Audio streaming (Phase 2)
- Video streaming (Phase 3)
- Binary WebSocket frames (optimization)
- Multiple response modalities (ADK limitation)

## Next Steps

1. ✅ Research AI SDK v6 and ADK BIDI capabilities (Complete)
2. ✅ Create implementation plan with detailed tasks (Complete - see agents/tasks.md)
3. ⬜ Implement image input support (backend)
4. ⬜ Implement image output support (backend)
5. ⬜ Create frontend image upload component
6. ⬜ Create frontend image display component
7. ⬜ End-to-end testing with real images
8. ⬜ Document limitations and future work

## Implementation Tasks

**Detailed implementation tasks documented in:** `agents/tasks.md`

**Current Sprint:** ADK BIDI Multimodal Support - Phase 1 (Image Support)

**Implementation Order (4 days):**
- **Day 1:** Backend Foundation (ChatMessage model, to_adk_content(), validation, output handling, unit tests)
- **Day 2:** Frontend Components (ImageUpload, ImageDisplay, WebSocketChatTransport extension, MessageComponent update)
- **Day 3:** Integration & Testing (UI integration, end-to-end testing, logging/monitoring, bug fixes)
- **Day 4:** Documentation & Polish (experiment results, README update, architecture diagrams, final testing)

**Success Criteria:** 17 acceptance criteria across 6 phases (1A-1F)

See `agents/tasks.md` for complete task breakdown with code examples and acceptance criteria.

## References

- [AI SDK v6 Data Stream Protocol](https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [ADK Streaming Guide - BIDI Mode](https://google.github.io/adk-docs/streaming/dev-guide/part4/#streamingmode-bidi-or-sse)
- [Previous Experiment: ADK BIDI Integration](./2025-12-11_adk_bidi_ai_sdk_v6_integration.md)
- [Gemini Vision API](https://ai.google.dev/gemini-api/docs/vision)
- [Implementation Tasks](../agents/tasks.md#current-sprint-adk-bidi-multimodal-support---phase-1-image-support)

## Conclusion

**Answer to Original Question:** "BIDIモードを無理やりAI SDK by Vercel ver.6のData Stream Protocolに対応させることはできるかな...？"

**Yes, partially possible:**

✅ **Feasible:**
- Image input/output via `data-image` custom events
- Maintaining bidirectional text communication
- Tool calling with multimodal context
- Custom UI for image rendering

⚠️ **Challenging but Possible:**
- Audio streaming via `data-audio-*` events (needs custom audio player)
- Video streaming (high complexity)

❌ **Not Feasible:**
- Native audio/video UI in `useChat` (fundamental limitation)
- Voice Activity Detection in browser (needs custom implementation)
- Mixing TEXT and AUDIO response modalities in one session (ADK constraint)

**Recommended Approach:**
1. **Phase 1 (Current Experiment):** Image support - highest value, lowest complexity
2. **Phase 2 (Future):** Audio streaming with custom player
3. **Phase 3 (Future):** Full voice agent mode (separate from useChat)

The "forcing" strategy works best for static multimodal content (images, documents) using AI SDK's extensible `data-*` event pattern. Real-time audio/video requires stepping outside `useChat` limitations with custom React components.
