# Architecture Documentation

**Last Updated:** 2025-12-24

This document describes the key architectural patterns and technical implementations in the ADK AI Data Protocol project.

## Table of Contents

1. [AudioWorklet PCM Streaming](#audioworklet-pcm-streaming)
2. [Tool Approval Flow (Frontend Delegation Pattern)](#tool-approval-flow)
3. [Per-Connection State Management](#per-connection-state-management)
4. [Multimodal Support Architecture](#multimodal-support-architecture)
5. [Tool Approval Auto-Submit (AI SDK v6)](#tool-approval-auto-submit-ai-sdk-v6)
6. [Known Limitations](#known-limitations)

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
   - **Implementation:** `components/chat.tsx` (handleStartRecording function)
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

**Backend:** `stream_protocol.py` (StreamProtocolConverter._process_function_call method)

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

**Tools Requiring Approval:** `server.py` (TOOLS_REQUIRING_APPROVAL constant)

```python
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}
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
- Session: セッション（接続ごとに一意、connection_signature使用）
- ToolApprovalDelegate: ツール承認デリゲート（FrontendToolDelegate）
- LiveRequestQueue: ライブリクエストキュー
- ADK Agent Runner: ADKエージェントランナー（共有）

### Implementation Details

**File:** `server.py` (live_chat async function)

**Key Implementation Points:**

- Session creation: `get_or_create_session()` with `connection_signature` parameter
- Delegate storage: `session.state["temp:delegate"]` (connection-specific)
- Tool access: Tools retrieve delegate from `tool_context.state.get("temp:delegate")`
- Session ID format: `session_{user_id}_{connection_signature}`

**Per-Connection State:**

```python
async def live_chat(websocket: WebSocket):
    # 1. Generate unique connection signature
    connection_signature = str(uuid.uuid4())
    logger.info(f"[BIDI] New connection: {connection_signature}")

    # 2. Each connection gets unique session
    user_id = "live_user"
    session = await get_or_create_session(
        user_id, bidi_agent_runner, "agents",
        connection_signature=connection_signature
    )
    logger.info(f"[BIDI] Session created: {session.id}")

    # 3. Each connection gets its own delegate
    connection_delegate = FrontendToolDelegate()

    # 4. Store delegate in session state
    session.state["temp:delegate"] = connection_delegate
    session.state["client_identifier"] = connection_signature

    # 5. Each connection gets its own queue
    live_request_queue = LiveRequestQueue()

    # 6. Run ADK agent with isolated state
    live_events = bidi_agent_runner.run_live(
        user_id=user_id,
        session_id=session.id,  # Unique session per connection
        live_request_queue=live_request_queue,
        run_config=run_config,
    )
```

### Why Per-Connection State?

**Problem Without Isolation:**

- Multiple clients would share the same session
- Tool approval requests would interfere
- Message history would mix between users
- Race conditions in queue processing

**Solution:**

1. **Unique Session ID:** Each connection generates `connection_signature` (UUID) for unique session
2. **Isolated Delegate:** `FrontendToolDelegate` stored in `session.state["temp:delegate"]`
3. **Separate Queue:** Each connection has its own `LiveRequestQueue`
4. **Clean Lifecycle:** When WebSocket closes, state is cleaned up

**Design Decision:** See `docs/adr/0001-per-connection-state-management.md` for detailed rationale

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

---

## Tool Approval Auto-Submit (AI SDK v6)

このセクションでは、AI SDK v6のツール実行自動送信機能について詳しく説明します。

## Auto-Submit Functions: `sendAutomaticallyWhen`

AI SDK v6は、ツール実行が完了したときに自動的にメッセージを再送信する機能を提供しています。
この機能は`sendAutomaticallyWhen`オプションで制御され、2つの組み込み関数が用意されています。

### Overview

| Function | Purpose | Use Case |
|----------|---------|----------|
| `lastAssistantMessageIsCompleteWithApprovalResponses` | ユーザー承認が必要なツール実行フロー | フロントエンド委譲型ツール実行 |
| `lastAssistantMessageIsCompleteWithToolCalls` | 自動実行されるツールのフロー | サーバー側ツール実行 |

---

## Function 1: `lastAssistantMessageIsCompleteWithApprovalResponses`

### Purpose

**ユーザー承認が必要なツール実行**のための自動送信関数。

### Implementation

**Source:** `node_modules/ai/dist/index.mjs:11342-11363`

```javascript
function lastAssistantMessageIsCompleteWithApprovalResponses({
  messages
}) {
  const message = messages[messages.length - 1];
  if (!message) {
    return false;
  }
  if (message.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === "step-start" ? index : lastIndex;
  }, -1);
  const lastStepToolInvocations = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolOrDynamicToolUIPart)
    .filter((part) => !part.providerExecuted);

  return (
    // Condition 1: At least one approval-responded exists
    lastStepToolInvocations.filter(
      (part) => part.state === "approval-responded"
    ).length > 0 &&
    // Condition 2: All tools are complete
    lastStepToolInvocations.every(
      (part) =>
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded"
    )
  );
}
```

### Conditions

自動送信が実行されるのは、**両方の条件**が満たされたときのみ：

1. **Condition 1**: 少なくとも1つの`approval-responded`が存在する
2. **Condition 2**: すべてのツールが完了状態である

### Accepted States

以下の状態がツール完了として認められます：

- `output-available` - ツール実行成功
- `output-error` - ツール実行失敗（エラーも完了扱い）
- `approval-responded` - ユーザーが承認済み（出力がなくてもOK）

### Use Cases

✅ **セキュリティ・プライバシーに関わる操作**

- ブラウザAPI（AudioContext、Geolocation、Camera）
- ファイルアクセス
- ネットワークリクエスト

✅ **フロントエンド委譲型ツール実行**

- バックエンドでツールを定義
- フロントエンドで実行
- ユーザー承認が必須

✅ **コンプライアンス要件**

- ユーザー同意の記録が必要
- 規制対応

### Example Usage

```typescript
const { messages, addToolApprovalResponse, addToolOutput } = useChat({
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

// Step 1: User approves tool
addToolApprovalResponse({
  id: "approval-1",
  approved: true,
  reason: "User approved BGM change"
});
// ⚠️ Auto-submit does NOT happen yet (condition 2 not satisfied)

// Step 2: Execute and provide result
const result = await audioContext.switchTrack(args.track_name);
addToolOutput({
  toolCallId: "call-1",
  tool: "change_bgm",
  output: { success: true, track: args.track_name }
});
// ✅ Auto-submit happens NOW (both conditions satisfied)
// Sends once with BOTH approval response + tool output combined
```

---

## Function 2: `lastAssistantMessageIsCompleteWithToolCalls`

### Purpose

**自動実行されるツール**のための自動送信関数。承認プロセスなし。

### Implementation

**Source:** `node_modules/ai/dist/index.mjs:11366-11383`

```javascript
function lastAssistantMessageIsCompleteWithToolCalls({
  messages
}) {
  const message = messages[messages.length - 1];
  if (!message) {
    return false;
  }
  if (message.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === "step-start" ? index : lastIndex;
  }, -1);
  const lastStepToolInvocations = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolOrDynamicToolUIPart)
    .filter((part) => !part.providerExecuted);

  return (
    lastStepToolInvocations.length > 0 &&
    lastStepToolInvocations.every(
      (part) =>
        part.state === "output-available" ||
        part.state === "output-error"
    )
  );
}
```

### Conditions

自動送信が実行されるのは、以下の条件が満たされたときのみ：

1. 少なくとも1つのツール呼び出しが存在する
2. すべてのツールが実行完了している

### Accepted States

以下の状態のみがツール完了として認められます：

- `output-available` - ツール実行成功
- `output-error` - ツール実行失敗（エラーも完了扱い）

**NOT Accepted:**

- ❌ `approval-responded` - 承認のみでは不十分（出力が必要）

### Use Cases

✅ **安全な読み取り専用操作**

- データ取得
- 計算処理
- フォーマット・パース

✅ **サーバー側ツール実行**

- データベースクエリ
- ファイル読み取り（サーバー上）
- 内部API呼び出し

✅ **承認不要な信頼された操作**

- 非機密データアクセス
- 自動化されたワークフロー

### Example Usage

```typescript
const { messages, addToolOutput } = useChat({
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
});

// Tool executes automatically (no approval needed)
addToolOutput({
  toolCallId: "call-1",
  tool: "calculate",
  output: { result: 42 }
});
// ✅ Auto-submit happens immediately (condition satisfied)
```

---

## Behavior Comparison Matrix

**IMPORTANT:** The `approved` value (true/false) in `approval-responded` state does NOT affect auto-submit behavior. Only the **state** and **all tools complete** conditions matter. See [ADR-0007](adr/0007-approval-value-independence-in-auto-submit.md) for detailed rationale.

### Scenario 1: Single Tool with Approval Response

**State:**

```javascript
parts: [
  { toolCallId: "1", state: "approval-responded", approval: { approved: true/false } }
]
```

**Note:** This scenario applies to BOTH `approved: true` AND `approved: false`. The timing is identical.

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ✅ **Auto-submit** | Condition 1: ✅ Condition 2: ✅ (only 1 tool, complete) |
| `...WithToolCalls` | ❌ **No submit** | Not `output-available` |

### Scenario 2: Tool with Output Only

**State:**

```javascript
parts: [
  { toolCallId: "1", state: "output-available", output: {...} }
]
```

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ❌ **No submit** | Condition 1: ❌ (no approval) |
| `...WithToolCalls` | ✅ **Auto-submit** | Has output |

### Scenario 3: Multiple Tools - Mixed States

**State:**

```javascript
parts: [
  { toolCallId: "1", state: "approval-responded", approval: { approved: true/false } },
  { toolCallId: "2", state: "output-available", output: {...} }
]
```

**Note:** This scenario applies regardless of `approved` value in Tool-1. What matters is that ALL tools are complete.

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ✅ **Auto-submit** | Condition 1: ✅ Condition 2: ✅ (both tools complete) |
| `...WithToolCalls` | ❌ **No submit** | Tool-1 has no output |

### Scenario 4: Incomplete Tools

**State:**

```javascript
parts: [
  { toolCallId: "1", state: "approval-requested" }, // Not responded
  { toolCallId: "2", state: "call" }                // Not executed
]
```

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ❌ **No submit** | Both conditions fail |
| `...WithToolCalls` | ❌ **No submit** | No output available |

---

## Key Implementation Details

### 1. Step Boundaries

両方の関数は**ステップ境界**を考慮します：

```javascript
const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
  return part.type === "step-start" ? index : lastIndex;
}, -1);
```

**Why?**

- マルチステップ推論では複数のツール呼び出しラウンドが発生する可能性がある
- **最新ステップのツールのみ**が自動送信の判定対象
- 過去のステップは既に完了済み

### 2. Provider-Executed Tools

両方の関数は**プロバイダー実行ツール**を除外します：

```javascript
.filter((part) => !part.providerExecuted)
```

**Why?**

- 一部のLLMプロバイダー（Claude、GPT-4など）はツールを**サーバー側**で実行する
- これらのツールはクライアント側での出力や承認が不要
- **クライアント側ツールのみ**が完了チェックの対象

### 3. State Machine

ツール呼び出しの状態遷移：

```
call → approval-requested → approval-responded → output-available
  ↓                                                    ↓
  +-------------------> output-available --------------+
  ↓                                                    ↓
  +-------------------> output-error -----------------+
```

**Complete States (完了状態):**

- `output-available` - 成功
- `output-error` - 失敗（完了扱い）
- `approval-responded` - 承認済み（WithApprovalResponsesのみ）

**Incomplete States (未完了状態):**

- `call` - 呼び出されたが待機中
- `approval-requested` - ユーザーの決定が必要

---

## Our Project's Choice

### We Use: `lastAssistantMessageIsCompleteWithApprovalResponses`

**Reason:**

1. **Tools are defined in backend** (server.py)
   - AIがツールの存在を認識できる
   - ツール定義がバックエンドに集約

2. **Execution is delegated to frontend**
   - ブラウザAPI（AudioContext、Geolocation）へのアクセス
   - セキュリティ境界を維持

3. **User approval is required**
   - プライバシー保護（位置情報）
   - ユーザーエクスペリエンス（BGM変更）

4. **Architecture: Backend Delegates, Frontend Executes**

   ```
   Backend (server.py)          Frontend (Next.js)
   ===================          ==================

   Tool function                Browser API
   await delegate() --------→   User approves
                            ←-- Execute & return result
   ```

### Configuration

**File:** `lib/build-use-chat-options.ts`

```typescript
export function buildUseChatOptions(config: BuildUseChatOptionsConfig) {
  // ...

  const useChatOptions: UseChatOptions = {
    // ...
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  };

  // ...
}
```

---

## Performance Considerations

### Complexity

両方の関数は複数の配列操作を実行します：

```javascript
// 1. Slice (O(n))
.slice(lastStepStartIndex + 1)

// 2. Filter tool invocations (O(n))
.filter(isToolOrDynamicToolUIPart)

// 3. Filter provider-executed (O(n))
.filter((part) => !part.providerExecuted)

// 4. Filter approval-responded (O(n)) - WithApprovalResponses only
.filter((part) => part.state === "approval-responded")

// 5. Every (O(n)) - short-circuits on false
.every((part) => ...)
```

**Total Complexity:** O(n) where n = message parts数

### Optimization

- `every()`は最初の`false`でショートサーキット（効率的）
- 関数は**状態変更時のみ**呼ばれる（レンダリング毎ではない）
- `jobExecutor.run()`内で実行（デバウンス、シーケンシャル）

---

## Testing

### Integration Test Coverage

**File:** `lib/use-chat-integration.test.tsx`

**Test 1: Approval Only**

```typescript
it("should verify addToolApprovalResponse triggers auto-submit when all tools complete", ...)
```

- ✅ `addToolApprovalResponse()` 呼び出し
- ✅ 条件1・2両方満足
- ✅ Auto-submit実行確認

**Test 2: Output Only**

```typescript
it("should verify addToolOutput updates message state but does NOT auto-submit", ...)
```

- ✅ `addToolOutput()` 呼び出し
- ❌ 条件1未満足（approval-respondedなし）
- ❌ Auto-submit実行されないことを確認

**Test 3: Mixed Scenario**

```typescript
it("should verify mixed approval + output triggers auto-submit", ...)
```

- ✅ Tool A: `addToolApprovalResponse()`
- ⚠️ まだ送信されない（Tool Bが未完了）
- ✅ Tool B: `addToolOutput()`
- ✅ Auto-submit実行（両方の条件満足）
- ✅ **1回の送信で両方の結果がまとめて送られる**

### Test Results

```
✅ Test Files: 7 passed (7)
✅ Tests: 163 passed | 2 skipped (165)
```

Complete test matrix coverage for all conditional logic branches.

---

## Summary

### Quick Reference

| Aspect | WithApprovalResponses | WithToolCalls |
|--------|----------------------|---------------|
| **承認が必要** | ✅ Yes | ❌ No |
| **出力が必要** | ⚠️ Optional | ✅ Yes |
| **承認のみで送信** | ✅ Yes (single tool) | ❌ No |
| **出力のみで送信** | ❌ No | ✅ Yes |
| **混在で送信** | ✅ Yes (all tools complete) | ⚠️ Depends |
| **approved値の影響** | ❌ No (timing unaffected) | N/A |
| **ユースケース** | Frontend-delegated | Server-side |
| **このプロジェクト** | ✅ 使用中 | - |

**重要な注意点:**

- `approved: true` と `approved: false` の動作は**完全に同じ**（タイミングに影響なし）
- 単一ツール: `addToolApprovalResponse` 後に即座に送信
- 複数ツール: 全ツール完了後に送信
- `approved` 値はバックエンドに送信されるが、auto-submitのタイミングには影響しない

### Design Decision

このプロジェクトでは**セキュリティとユーザー体験**を重視し、`lastAssistantMessageIsCompleteWithApprovalResponses`を採用しています。

**Key Benefits:**

- ✅ ユーザーに明示的な制御権を与える
- ✅ プライバシー保護（位置情報など）
- ✅ 予期しない動作を防ぐ（BGM変更など）
- ✅ AI SDK v6標準APIとの完全な互換性

---

## References

- **AI SDK v6 Documentation**: <https://sdk.vercel.ai/docs>
- **Source Code**: `node_modules/ai/dist/index.mjs:11342-11383`
- **Our Implementation**: `lib/build-use-chat-options.ts`
- **Integration Tests**: `lib/use-chat-integration.test.tsx`
- **Experiment Notes**: `experiments/2025-12-13_lib_test_coverage_investigation.md`
- **Critical Lessons**: `experiments/README.md` - "Integration Testing: Critical Lessons"

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

- **ADK Documentation:** <https://developers.google.com/gemini/docs/adk>
- **AI SDK v6 Documentation:** <https://sdk.vercel.ai/docs>
- **AudioWorklet API:** <https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet>
- **Experiment Notes:** `experiments/2025-12-11_adk_bidi_multimodal_support.md`
- **Tool Approval Tests:** `tests/unit/test_tool_approval.py`, `tests/integration/test_backend_tool_approval.py`
- **WebSocket Event Tests:** `tests/unit/test_websocket_events.py`
- **Architecture Decision Records:**
    - [ADR-0001](adr/0001-per-connection-state-management.md) - Per-Connection State Management
    - [ADR-0002](adr/0002-tool-approval-architecture.md) - Tool Approval Architecture
    - [ADR-0003](adr/0003-sse-vs-bidi-confirmation-protocol.md) - SSE vs BIDI Confirmation Protocol
    - [ADR-0004](adr/0004-multi-tool-response-timing.md) - Multi-Tool Response Timing
    - [ADR-0005](adr/0005-frontend-execute-pattern-and-done-timing.md) - Frontend Execute Pattern and [DONE] Timing
    - [ADR-0006](adr/0006-send-automatically-when-decision-logic-order.md) - sendAutomaticallyWhen Decision Logic Order

---

**Last Updated:** 2025-12-24
**Status:** Phase 1-3 Complete, Phase 4 (Video) Future Work
