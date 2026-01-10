# Server API Reference

Swift App開発者向けのサーバーAPI仕様書。

---

## Overview

このサーバーは **AI SDK v6 Data Stream Protocol** を実装し、ADK (Agent Development Kit) バックエンドと通信するためのAPIを提供する。

### 通信モード

| Mode | Protocol | Endpoint | 特徴 |
|------|----------|----------|------|
| **SSE** | HTTP + Server-Sent Events | `POST /stream` | シンプル、ステートレス |
| **BIDI** | WebSocket | `ws://host/live` | リアルタイム、音声対応、ステートフル |

---

## Quick Start

### 1. サーバー起動確認

```bash
curl http://localhost:8000/
# {"service": "ADK Data Protocol Server", "status": "running"}

curl http://localhost:8000/health
# {"status": "healthy"}
```

### 2. 最初のメッセージ送信 (SSE)

```bash
curl -X POST http://localhost:8000/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}' \
  --no-buffer
```

レスポンス (SSE形式):

```
data: {"type":"start","messageId":"abc123"}

data: {"type":"text-delta","textDelta":"Hello"}

data: {"type":"text-delta","textDelta":" there!"}

data: {"type":"finish","finishReason":"stop"}

data: [DONE]
```

---

## Endpoints

### GET /

サーバーステータス確認。

**Response:**

```json
{"service": "ADK Data Protocol Server", "status": "running"}
```

---

### GET /health

ヘルスチェック。

**Response:**

```json
{"status": "healthy"}
```

---

### POST /stream (SSE Mode)

テキスト/画像/ツールのストリーミング応答。

**Request:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What's the weather?"
    }
  ],
  "chatId": "optional-session-id"
}
```

**Response Headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
x-vercel-ai-ui-message-stream: v1
```

**Response Body:** SSE形式のイベントストリーム (後述の Event Types 参照)

#### Swift 実装例 (URLSession)

```swift
import Foundation

struct ChatRequest: Codable {
    let messages: [Message]
    let chatId: String?
}

struct Message: Codable {
    let role: String
    let content: String
}

func sendSSERequest() async throws {
    let url = URL(string: "http://localhost:8000/stream")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let chatRequest = ChatRequest(
        messages: [Message(role: "user", content: "Hello")],
        chatId: nil
    )
    request.httpBody = try JSONEncoder().encode(chatRequest)

    let (bytes, _) = try await URLSession.shared.bytes(for: request)

    for try await line in bytes.lines {
        guard line.hasPrefix("data: ") else { continue }
        let jsonString = String(line.dropFirst(6))

        if jsonString == "[DONE]" {
            print("Stream complete")
            break
        }

        // Parse JSON event
        if let data = jsonString.data(using: .utf8),
           let event = try? JSONDecoder().decode(SSEEvent.self, from: data) {
            handleEvent(event)
        }
    }
}

struct SSEEvent: Codable {
    let type: String
    let textDelta: String?
    let messageId: String?
    let finishReason: String?
}

func handleEvent(_ event: SSEEvent) {
    switch event.type {
    case "start":
        print("Message started: \(event.messageId ?? "")")
    case "text-delta":
        print(event.textDelta ?? "", terminator: "")
    case "finish":
        print("\nFinished: \(event.finishReason ?? "")")
    default:
        break
    }
}
```

---

### WebSocket /live (BIDI Mode)

リアルタイム双方向通信。音声入出力対応。

**接続:**

```
ws://localhost:8000/live
```

**Client → Server (送信メッセージ):**

```json
{
  "type": "message",
  "data": {
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "chatId": "session-123"
  }
}
```

**Server → Client (受信):** SSE形式と同じイベント構造

#### Swift 実装例 (URLSessionWebSocketTask)

```swift
import Foundation

class WebSocketClient {
    private var task: URLSessionWebSocketTask?

    func connect() {
        let url = URL(string: "ws://localhost:8000/live")!
        task = URLSession.shared.webSocketTask(with: url)
        task?.resume()
        receiveLoop()
    }

    func sendMessage(_ text: String) async throws {
        let message: [String: Any] = [
            "type": "message",
            "data": [
                "messages": [["role": "user", "content": text]],
                "chatId": UUID().uuidString
            ]
        ]
        let jsonData = try JSONSerialization.data(withJSONObject: message)
        let jsonString = String(data: jsonData, encoding: .utf8)!
        try await task?.send(.string(jsonString))
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.parseSSEMessages(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self?.parseSSEMessages(text)
                    }
                @unknown default:
                    break
                }
                self?.receiveLoop() // Continue listening

            case .failure(let error):
                print("WebSocket error: \(error)")
            }
        }
    }

    private func parseSSEMessages(_ text: String) {
        // WebSocket経由でもSSE形式で受信
        let lines = text.components(separatedBy: "\n")
        for line in lines {
            guard line.hasPrefix("data: ") else { continue }
            let json = String(line.dropFirst(6))
            if json == "[DONE]" {
                print("Turn complete")
            } else {
                // Parse and handle event
                print("Event: \(json)")
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
    }
}
```

---

## Request/Response Format

### ChatRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | `UIMessage[]` | Yes | 会話履歴 |
| `chatId` | `string` | No | セッションID |
| `trigger` | `string` | No | `"submit-message"` or `"regenerate-message"` |

### UIMessage

| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | `"user"`, `"assistant"`, `"system"`, `"tool"` |
| `content` | `string` or `Part[]` | メッセージ内容 |
| `id` | `string` | メッセージID (optional) |

### MessagePart Types

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `text: string` | テキスト |
| `file` | `url: string, mediaType: string` | 画像 (base64 data URL) |
| `tool-result` | `toolCallId, toolName, result` | ツール実行結果 |

---

## Event Types Reference

### Message Control

| Event | Fields | Description |
|-------|--------|-------------|
| `start` | `messageId` | ストリーム開始 |
| `finish` | `finishReason`, `usage` | ストリーム終了 |
| `[DONE]` | - | ターン完了マーカー |

### Text Streaming

| Event | Fields | Description |
|-------|--------|-------------|
| `text-delta` | `textDelta` | テキストチャンク |

### Reasoning (Gemini 2.0)

| Event | Fields | Description |
|-------|--------|-------------|
| `reasoning` | `textDelta` | 思考プロセス |

### Tool Execution

| Event | Fields | Description |
|-------|--------|-------------|
| `tool-call` | `toolCallId`, `toolName`, `args` | ツール呼び出し |
| `tool-result` | `toolCallId`, `result` | ツール実行結果 |
| `tool-call-streaming-start` | `toolCallId`, `toolName` | ツール呼び出し開始 |
| `tool-call-delta` | `toolCallId`, `argsTextDelta` | 引数ストリーミング |

### Tool Approval

| Event | Fields | Description |
|-------|--------|-------------|
| `tool-approval-request` | `toolCallId`, `toolName`, `args` | 承認要求 |

### Multimodal (Custom Extensions)

| Event | Fields | Description |
|-------|--------|-------------|
| `data-pcm` | `data.content`, `data.sampleRate`, `data.channels`, `data.bitDepth` | 音声PCMデータ (24kHz, 1ch, 16bit) |
| `data-image` | `data`, `mediaType` | 画像データ |
| `data-executable-code` | `code`, `language` | コード実行要求 |
| `data-code-execution-result` | `output` | コード実行結果 |

### Error

| Event | Fields | Description |
|-------|--------|-------------|
| `error` | `error.message`, `error.code` | エラー |

---

## Tool Approval Flow

一部のツール（`process_payment`, `get_location` など）はユーザー承認が必要。

### フロー

```
Server → tool-approval-request (承認要求)
    ↓
Client → UI表示 → ユーザー判断
    ↓
Client → tool-result (承認/拒否を送信)
    ↓
Server → 処理続行
```

### SSE Mode での承認応答

新しいリクエストで `tool-result` を含むメッセージを送信:

```json
{
  "messages": [
    {"role": "user", "content": "approve"},
    {
      "role": "assistant",
      "content": [{
        "type": "tool-result",
        "toolCallId": "call_123",
        "toolName": "process_payment",
        "result": {"approved": true, "user_message": "User approved"}
      }]
    }
  ]
}
```

### BIDI Mode での承認応答

WebSocket経由で直接送信:

```json
{
  "type": "message",
  "data": {
    "messages": [{
      "role": "user",
      "content": [{
        "type": "tool-result",
        "toolCallId": "call_123",
        "toolName": "process_payment",
        "result": {"approved": true}
      }]
    }]
  }
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | 成功 (SSEストリーム開始) |
| 400 | Bad Request |
| 422 | Validation Error (不正なメッセージ形式) |
| 500 | Internal Server Error |

### Error Event

```json
{
  "type": "error",
  "error": {
    "message": "Rate limit exceeded",
    "code": "rate_limit_error"
  }
}
```

### Finish Reasons

| Reason | Description |
|--------|-------------|
| `stop` | 正常終了 |
| `length` | トークン上限 |
| `content-filter` | 安全フィルター |
| `error` | エラー終了 |

---

## Session Management

### SSE Mode

- 各リクエストは独立
- `chatId` で会話を継続可能
- サーバー側でセッション状態を保持

### BIDI Mode

- WebSocket接続ごとに独立したセッション
- 接続中は状態を保持
- 切断時にセッションクリア

### セッションクリア (開発用)

```bash
curl -X POST http://localhost:8000/clear-sessions
# {"status": "success", "message": "All sessions cleared"}
```

---

## Further Reading

詳細な仕様については以下を参照:

- **[Protocol Implementation](../spec_PROTOCOL.md)** - ADK ↔ AI SDK v6 プロトコル詳細
- **[Architecture Overview](../spec_ARCHITECTURE.md)** - システムアーキテクチャ
- **[Tool Approval Architecture](../adr/0002-tool-approval-architecture.md)** - ツール承認の設計思想

---

**Last Updated**: 2026-01-10
