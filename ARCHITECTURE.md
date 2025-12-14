# Architecture Documentation

**Last Updated:** 2025-12-14

This document describes the key architectural patterns and technical implementations in the ADK AI Data Protocol project.

## Table of Contents

1. [AudioWorklet PCM Streaming](#audioworklet-pcm-streaming)
2. [Tool Approval Flow (Frontend Delegation Pattern)](#tool-approval-flow)
3. [Per-Connection State Management](#per-connection-state-management)
4. [Multimodal Support Architecture](#multimodal-support-architecture)
5. [Known Limitations](#known-limitations)

---

## AudioWorklet PCM Streaming

### Overview

The project implements real-time audio input using the Web Audio API's AudioWorklet for low-latency PCM (Pulse Code Modulation) recording. This enables bidirectional voice communication with ADK's native-audio models.

### Architecture

```
User Microphone
    |
    v
MediaDevices.getUserMedia()
    |
    v
MediaStreamSource (16kHz, mono)
    |
    v
AudioWorklet (pcm-recorder-processor)
    |  (Float32 samples in AudioContext)
    v
convertFloat32ToPCM16()
    |  (Int16Array PCM samples)
    v
AudioRecorder.onChunk callback
    |
    v
WebSocket → ADK Live API
```

**Legend / 凡例:**
- MediaDevices.getUserMedia(): マイクアクセスAPI
- MediaStreamSource: メディアストリームソース
- AudioWorklet: 低レイテンシ音声処理ワークレット
- convertFloat32ToPCM16(): Float32からPCM16への変換
- AudioRecorder.onChunk: 音声チャンクコールバック

### Implementation Details

**File:** `lib/audio-recorder.ts`

**Key Components:**

1. **AudioContext Configuration:**
   ```typescript
   new AudioContext({
     sampleRate: 16000, // ADK requirement: 16kHz
   })
   ```

2. **Microphone Constraints:**
   ```typescript
   navigator.mediaDevices.getUserMedia({
     audio: {
       channelCount: 1,        // Mono
       sampleRate: 16000,      // 16kHz
       echoCancellation: true,
       noiseSuppression: true,
       autoGainControl: true,
     }
   })
   ```

3. **AudioWorklet Processing:**
   - **Processor:** `/public/pcm-recorder-processor.js`
   - **Function:** Converts Float32 audio samples to Int16 PCM
   - **Format:** 16-bit PCM, 16kHz sample rate, mono

4. **Push-to-Talk Control:**
   - **Trigger:** CMD key (Mac) / Ctrl key (Windows/Linux)
   - **Implementation:** `components/chat.tsx:226-243`
   - **Reason:** Browser-based Voice Activity Detection (VAD) not implemented

### ADK Audio Format Requirements

| Parameter | Value | Reason |
|-----------|-------|--------|
| Sample Rate | 16kHz | ADK Live API requirement |
| Bit Depth | 16-bit | Standard PCM format |
| Channels | 1 (mono) | Reduces bandwidth, sufficient for voice |
| Encoding | Linear PCM | Uncompressed for real-time streaming |

---

## Tool Approval Flow

### Overview

The tool approval mechanism implements a **frontend delegation pattern** where certain tools require explicit user approval before execution. This prevents unauthorized actions (e.g., executing browser APIs, accessing location) without user consent.

### Architecture

```
AI Agent (ADK)
    |
    | (tool call request)
    v
Backend (server.py)
    |
    | Check: tool in tools_requiring_approval?
    v
+---YES--> Send tool-approval event → Frontend
|             |
|             v
|          User approves/rejects
|             |
|             v
|          Frontend sends tool_result event
|             |
|             v
|          Backend receives approval
|             |
+-------------+
|
+---NO---> Execute tool directly
             |
             v
          Return result to agent
```

**Legend / 凡例:**
- AI Agent: AIエージェント（ADK）
- Backend: バックエンドサーバー
- Frontend: フロントエンドUI
- tool-approval event: ツール承認イベント
- tool_result event: ツール実行結果イベント

### Implementation Details

**Backend:** `stream_protocol.py:445-522` (StreamProtocolConverter._process_tool_call_part)

```python
# Check if tool requires user approval
if (
    tools_requiring_approval
    and tool_name in tools_requiring_approval
):
    # Send approval request to frontend
    yield SSEEvent(
        "tool-approval",
        {
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "args": args_dict,
        },
    ).to_sse_string()

    # Wait for user approval (delegation)
    # Frontend sends approval back via WebSocket
```

**Frontend:** `lib/websocket-chat-transport.ts:handleWebSocketMessage()`

```typescript
case "tool-approval": {
  // Prompt user for approval
  const approved = await promptUserApproval(
    data.toolName,
    data.args
  );

  // Send approval result back
  websocket.send(JSON.stringify({
    type: "tool_result",
    data: {
      toolCallId: data.toolCallId,
      result: approved ? executeResult : null,
      status: approved ? "approved" : "rejected",
    },
  }));
}
```

### Configuration

**Tools Requiring Approval:** `server.py:38-50`

```python
# Phase 4: Define tools that require user approval
TOOLS_REQUIRING_APPROVAL: set[str] = {
    # Browser API tools (security concern)
    "execute_browser_api",

    # Location access (privacy concern)
    "get_location",

    # Potentially dangerous operations
    # (add more as needed)
}
```

### Security Benefits

1. **Prevents Unauthorized Actions:** User must explicitly approve sensitive operations
2. **Privacy Protection:** Location and browser API access require consent
3. **Transparency:** User sees exactly what the AI wants to do
4. **Auditable:** All tool approvals are logged

---

## Per-Connection State Management

### Overview

Each WebSocket connection maintains **isolated state** with its own session and delegate. This prevents race conditions and enables proper concurrent handling of multiple clients.

### Architecture

```
Client 1 WebSocket               Client 2 WebSocket
    |                                |
    v                                v
Session 1 (unique)              Session 2 (unique)
    |                                |
    v                                v
ToolApprovalDelegate 1          ToolApprovalDelegate 2
    |                                |
    v                                v
LiveRequestQueue 1              LiveRequestQueue 2
    |                                |
    v                                v
ADK Agent Runner (shared)       ADK Agent Runner (shared)
```

**Legend / 凡例:**
- Client WebSocket: クライアントWebSocket接続
- Session: セッション（接続ごとに一意）
- ToolApprovalDelegate: ツール承認デリゲート
- LiveRequestQueue: ライブリクエストキュー
- ADK Agent Runner: ADKエージェントランナー（共有）

### Implementation Details

**File:** `server.py:651-940` (live_chat function)

**Per-Connection State:**

```python
async def live_chat(websocket: WebSocket):
    # 1. Each connection gets unique session
    session = await agent_runner.create_session()
    logger.info(f"[BIDI] Created session: {session.id}")

    # 2. Each connection gets its own delegate
    delegate = ToolApprovalDelegate(
        websocket=websocket,
        tools_requiring_approval=TOOLS_REQUIRING_APPROVAL,
    )

    # 3. Each connection gets its own queue
    live_request_queue = LiveRequestQueue()

    # 4. Run ADK agent with isolated state
    live_events = agent_runner.run_live(
        user_id="live_user",
        session_id=session.id,  # Unique session
        live_request_queue=live_request_queue,
        run_config=run_config,
        delegate=delegate,  # Unique delegate
    )
```

### Why Per-Connection State?

**Problem Without Isolation:**
- Multiple clients would share the same session
- Tool approval requests would interfere
- Message history would mix between users
- Race conditions in queue processing

**Solution:**
1. **Unique Session ID:** Each connection creates a new ADK session
2. **Isolated Delegate:** Tool approvals go to the correct client
3. **Separate Queue:** Messages don't interfere across connections
4. **Clean Lifecycle:** When WebSocket closes, state is cleaned up

### Session Lifecycle

```
WebSocket Connect
    |
    v
Create Session (unique ID)
    |
    v
Create Delegate + Queue
    |
    v
Start ADK agent_runner.run_live()
    |
    v
Process messages bidirectionally
    |
    v
WebSocket Disconnect
    |
    v
Clean up session (no automatic resumption)
```

**Legend / 凡例:**
- WebSocket Connect: WebSocket接続
- Create Session: セッション作成
- Create Delegate + Queue: デリゲートとキュー作成
- Start ADK agent_runner: ADKエージェント起動
- Process messages: メッセージ処理
- WebSocket Disconnect: WebSocket切断
- Clean up session: セッションクリーンアップ

---

## Multimodal Support Architecture

### Overview

The project implements **Phase 1-3 of multimodal support** through ADK's BIDI mode:
- ✅ **Phase 1:** Images (input/output)
- ✅ **Phase 2:** Audio Output (PCM streaming)
- ✅ **Phase 3:** Audio Input (microphone recording)
- ⬜ **Phase 4:** Video (future work)

### Implementation Status

| Feature | ADK Support | AI SDK v6 Protocol | Frontend | Status |
|---------|-------------|-------------------|----------|--------|
| **Text I/O** | ✅ Full | ✅ `text-*` events | ✅ Native | ✅ **Working** |
| **Tool Calling** | ✅ Full | ✅ `tool-*` events | ✅ Native | ✅ **Working** |
| **Image Input** | ✅ Full | ✅ `data-image` custom | ✅ Custom UI | ✅ **Working** |
| **Image Output** | ✅ Full | ✅ `data-image` custom | ✅ Custom UI | ✅ **Working** |
| **Audio Input** | ✅ `send_realtime()` | ✅ WebSocket binary | ✅ AudioWorklet | ✅ **Working** |
| **Audio Output** | ✅ `AUDIO` modality | ✅ `data-pcm` custom | ✅ Custom Player | ✅ **Working** |
| **Video I/O** | ✅ Full | ⚠️ `data-video-*` custom | ❌ No UI | ⬜ **Future** |

### Protocol Flow: Images

```
User Uploads Image (PNG/JPEG/WebP)
    |
    v
Frontend: Convert to base64
    |
    v
WebSocket: Send message with experimental_attachments
    {
      role: "user",
      experimental_attachments: [
        { type: "text", text: "What's in this image?" },
        { type: "image", data: "base64...", media_type: "image/png" }
      ]
    }
    |
    v
Backend: ChatMessage.to_adk_content()
    → types.Part(inline_data={mime_type, data})
    |
    v
ADK Agent (Gemini Vision)
    |
    v
stream_adk_to_ai_sdk(): Convert response
    |
    v
SSE: data: {"type":"data-image","mediaType":"image/png","data":"base64..."}
    |
    v
Frontend: Custom ImageDisplay component
```

**Legend / 凡例:**
- User Uploads Image: ユーザーが画像をアップロード
- Frontend: フロントエンド
- WebSocket: WebSocket接続
- Backend: バックエンド
- ADK Agent (Gemini Vision): ADKエージェント（Gemini Vision）
- stream_adk_to_ai_sdk(): プロトコル変換関数
- Custom ImageDisplay component: カスタム画像表示コンポーネント

### Protocol Flow: Audio Output

```
ADK Agent (native-audio model)
    |
    | Generate audio chunks (PCM)
    v
Backend: stream_adk_to_ai_sdk()
    |
    | Convert to SSE format
    v
SSE: data: {"type":"data-pcm","chunk":"base64...","sampleRate":24000}
    |
    v
Frontend: Accumulate PCM chunks
    |
    v
Custom Audio Player (WAV format)
    |
    | Add WAV header + combine chunks
    v
Browser Audio Playback
```

**Legend / 凡例:**
- ADK Agent (native-audio model): ADKエージェント（ネイティブ音声モデル）
- Generate audio chunks: 音声チャンク生成
- Convert to SSE format: SSE形式に変換
- Accumulate PCM chunks: PCMチャンク蓄積
- Custom Audio Player: カスタム音声プレイヤー
- Add WAV header: WAVヘッダー追加
- Browser Audio Playback: ブラウザ音声再生

### Protocol Flow: Audio Input

```
User Holds CMD Key
    |
    v
Frontend: AudioRecorder.start()
    |
    v
AudioWorklet: Capture microphone (16kHz PCM)
    |
    v
Convert Float32 → Int16 PCM chunks
    |
    v
WebSocket: Send audio_chunk event
    {
      type: "audio_chunk",
      data: {
        chunk: "base64...",
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16
      }
    }
    |
    v
Backend: Decode base64 → PCM bytes
    |
    v
live_request_queue.send_realtime(audio_blob)
    |
    v
ADK Live API (native-audio model)
    |
    v
Response (text + transcription)
```

**Legend / 凡例:**
- User Holds CMD Key: ユーザーがCMDキーを押下
- AudioRecorder.start(): 音声録音開始
- AudioWorklet: 音声ワークレット
- Capture microphone: マイク入力キャプチャ
- Convert Float32 → Int16: Float32からInt16への変換
- send_realtime(audio_blob): リアルタイム音声送信
- ADK Live API: ADK Live API
- Response (text + transcription): 応答（テキスト＋文字起こし）

### Custom Event Types

The project uses AI SDK v6's extensible `data-*` pattern for multimodal content:

| Event Type | Purpose | Data Format |
|------------|---------|-------------|
| `data-image` | Image display | `{ mediaType: "image/png", data: "base64..." }` |
| `data-pcm` | Audio PCM chunk | `{ chunk: "base64...", sampleRate: 24000 }` |
| `audio_chunk` | Audio input (WebSocket) | `{ chunk: "base64...", sampleRate: 16000, channels: 1, bitDepth: 16 }` |

---

## Known Limitations

### 1. WebSocket Reconnection with Session IDs

**Issue:** WebSocket disconnections create new sessions with different IDs, losing conversation history.

**Status:** Deferred (not critical for MVP)

**Workaround:** Users must refresh the page to restart conversation.

**Future Solution:** Implement session resumption with persistent session IDs.

---

### 2. No Native Voice Activity Detection (VAD)

**Issue:** Browser-based VAD is not implemented.

**Status:** CMD key push-to-talk workaround in place

**Limitation:** Users must manually trigger audio recording (not hands-free).

**Future Solution:**
- Implement browser-based VAD using Web Audio API analysis
- Detect speech start/stop automatically

---

### 3. Cannot Mix TEXT and AUDIO Response Modalities

**Issue:** ADK constraint - must choose either TEXT or AUDIO output per session.

**Status:** Fundamental ADK limitation (not fixable)

**Current Behavior:**
- BIDI mode uses `response_modalities=["AUDIO"]` for native-audio models
- Text responses are provided via transcription only
- Cannot switch modalities mid-session

**Reason:** ADK's architecture requires committing to one response modality when creating a session.

---

### 4. Progressive Audio Playback Not Implemented

**Issue:** Audio chunks are accumulated before playback, causing delay.

**Status:** Future enhancement

**Current Behavior:** All PCM chunks are collected, then WAV file is played.

**Future Solution:** Use Web Audio API for progressive streaming playback.

---

## References

- **ADK Documentation:** https://developers.google.com/gemini/docs/adk
- **AI SDK v6 Documentation:** https://sdk.vercel.ai/docs
- **AudioWorklet API:** https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- **Experiment Notes:** `experiments/2025-12-11_adk_bidi_multimodal_support.md`
- **Tool Approval Tests:** `tests/unit/test_tool_approval.py`, `tests/integration/test_backend_tool_approval.py`
- **WebSocket Event Tests:** `tests/unit/test_websocket_events.py`

---

**Last Updated:** 2025-12-14
**Status:** Phase 1-3 Complete, Phase 4 (Video) Future Work
