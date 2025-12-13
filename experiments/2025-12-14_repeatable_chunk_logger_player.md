# Repeatable Chunk Logger & Player Implementation

**作成日**: 2025-12-14
**ステータス**: 🟡 In Progress

---

## 目的

手動操作で発生する chunk を JSONL 形式で記録し、再生可能にすることで：
1. **手動操作の自動化** - 記録した chunk を再生して E2E テスト化
2. **Chunk 変換の検証** - 各変換ポイントでの入出力を記録・比較
3. **デバッグの効率化** - 問題の再現が容易に
4. **回帰テスト** - 実際の chunk データでテスト

---

## 背景

### 現在の3つのモード

#### 1. Gemini Direct
- Frontend: DefaultChatTransport
- Backend: Next.js API (`app/api/chat/route.ts`)
- 通信: HTTP POST → SSE response

#### 2. ADK SSE
- Frontend: DefaultChatTransport
- Backend: FastAPI (`stream_protocol.py`)
- 通信: HTTP POST → SSE response
- 変換: ADK Event → AI SDK v6 Data Stream Protocol

#### 3. ADK BIDI
- Frontend: WebSocketChatTransport
- Backend: FastAPI (`stream_protocol.py`)
- 通信: WebSocket bidirectional
- 変換: ADK Event → AI SDK v6 Data Stream Protocol → WebSocket message

### Chunk の流れ

```
=== Backend ===
ADK Events
    ↓
[Logger Point 1] stream_protocol.py: convert_event()
    ↓
SSE chunks (AI SDK v6 Data Stream Protocol)
    ↓
    ├─ ADK SSE: HTTP SSE → Frontend
    └─ ADK BIDI: WebSocket → Frontend

=== Frontend ===

[Gemini Direct Path]
Next.js API route.ts
    ↓
[Logger Point 2] DefaultChatTransport
    ↓
useChat (messages, UI)

[ADK SSE Path]
DefaultChatTransport
    ↓
[Logger Point 3] (SSE chunk reception)
    ↓
useChat (messages, UI)

[ADK BIDI Path]
WebSocket
    ↓
[Logger Point 4] websocket-chat-transport.ts
    ↓ (WS→SSE conversion)
SSE chunks
    ↓
useChat (messages, UI)
```

### 現在のデバッグログ

**Backend (Python):**
```python
# stream_protocol.py:_format_sse_event()
logger.debug(f"[ADK→SSE] {event_data}")
```

**Frontend (TypeScript):**
```typescript
// lib/websocket-chat-transport.ts
console.debug("[WS→useChat]", chunk);
console.debug("[WS→Backend]", eventWithTimestamp.type, eventWithTimestamp);
```

---

## 設計

### Logger 機構

#### 記録フォーマット: JSONL (JSON Lines)
- 1行 = 1 chunk
- 各行は完全な JSON オブジェクト
- ファイル拡張子: `.jsonl`

#### Chunk エントリ構造
```typescript
interface ChunkLogEntry {
  // メタデータ
  timestamp: number;           // Unix timestamp (ms)
  sessionId: string;           // セッション識別子
  mode: "gemini" | "adk-sse" | "adk-bidi";
  location: LogLocation;       // 記録ポイント
  direction: "in" | "out";     // 入力/出力
  sequenceNumber: number;      // chunk 順序番号

  // Chunk データ
  chunk: unknown;              // 実際の chunk データ (型は location による)

  // Optional: デバッグ情報
  metadata?: {
    userAgent?: string;
    backendVersion?: string;
    [key: string]: unknown;
  };
}

type LogLocation =
  | "backend-adk-event"        // ADK raw event
  | "backend-sse-event"        // SSE formatted event
  | "frontend-api-response"    // Next.js API response (Gemini Direct)
  | "frontend-sse-chunk"       // SSE chunk (ADK SSE)
  | "frontend-ws-chunk"        // WebSocket chunk (ADK BIDI)
  | "frontend-useChat-chunk";  // useChat に渡される chunk (共通)
```

#### 環境変数による制御
```bash
# Backend (Python)
CHUNK_LOGGER_ENABLED=true
CHUNK_LOGGER_OUTPUT_DIR=./chunk_logs
CHUNK_LOGGER_SESSION_ID=session-2025-12-14-001

# Frontend (TypeScript)
NEXT_PUBLIC_CHUNK_LOGGER_ENABLED=true
NEXT_PUBLIC_CHUNK_LOGGER_OUTPUT_DIR=./chunk_logs
NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID=session-2025-12-14-001
```

#### ファイル命名規則
```
chunk_logs/
  ├─ session-2025-12-14-001/
  │   ├─ backend-adk-event.jsonl
  │   ├─ backend-sse-event.jsonl
  │   ├─ frontend-ws-chunk.jsonl
  │   └─ frontend-useChat-chunk.jsonl
  └─ session-2025-12-14-002/
      └─ ...
```

### Player 機構

#### 基本機能
1. **JSONL ファイル読み込み**
   - 指定 session の chunk を読み込み
   - location でフィルタリング可能

2. **再生モード**
   - **Real-time mode**: timestamp 差分を尊重して再生
   - **Fast-forward mode**: 即座に次の chunk へ
   - **Step-by-step mode**: 1 chunk ずつ手動で進める

3. **注入ポイント**
   - Backend: ADK イベントを mock
   - Frontend: Transport layer を mock

#### Player API 設計

**Backend (Python):**
```python
from chunk_player import ChunkPlayer

# Usage in tests
player = ChunkPlayer(
    session_id="session-2025-12-14-001",
    location="backend-adk-event",
    mode="fast-forward"
)

for chunk in player.play():
    # Inject chunk into stream_protocol
    await stream_protocol.process_event(chunk)
```

**Frontend (TypeScript):**
```typescript
import { ChunkPlayer } from '@/lib/chunk-player';

// Usage in tests
const player = new ChunkPlayer({
  sessionId: 'session-2025-12-14-001',
  location: 'frontend-ws-chunk',
  mode: 'fast-forward'
});

for await (const chunk of player.play()) {
  // Inject chunk into transport
  transport.injectChunk(chunk);
}
```

---

## 差し込みポイント詳細

### Backend (Python)

#### Point 1: ADK Event (Input)
**ファイル**: `stream_protocol.py`
**場所**: ADK SDK からのイベント受信直後
```python
async def _handle_adk_event(self, event: GenerateContentResponse):
    # Logger injection
    if chunk_logger.is_enabled():
        chunk_logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk=event
        )

    # Existing processing
    ...
```

#### Point 2: SSE Event (Output)
**ファイル**: `stream_protocol.py`
**場所**: `_format_sse_event()` または `convert_event()`
```python
def _format_sse_event(self, event_data: dict) -> str:
    # Logger injection
    if chunk_logger.is_enabled():
        chunk_logger.log_chunk(
            location="backend-sse-event",
            direction="out",
            chunk=event_data
        )

    # Existing: Debug log
    logger.debug(f"[ADK→SSE] {event_data}")
    return f"data: {json.dumps(event_data)}\n\n"
```

### Frontend (TypeScript)

#### Point 3: Next.js API Response (Gemini Direct)
**ファイル**: `app/api/chat/route.ts`
**場所**: Gemini response → SSE 変換後
```typescript
// Log each chunk before sending
if (chunkLogger.isEnabled()) {
  await chunkLogger.logChunk({
    location: 'frontend-api-response',
    direction: 'out',
    chunk: event
  });
}
```

#### Point 4: WebSocket Chunk (ADK BIDI)
**ファイル**: `lib/websocket-chat-transport.ts`
**場所**: WebSocket message 受信直後
```typescript
this.ws.onmessage = (event) => {
  const chunk = JSON.parse(event.data);

  // Logger injection
  if (chunkLogger.isEnabled()) {
    chunkLogger.logChunk({
      location: 'frontend-ws-chunk',
      direction: 'in',
      chunk
    });
  }

  // Existing: Debug log
  console.debug("[WS→useChat]", chunk);

  // Continue processing...
};
```

#### Point 5: useChat Chunk (共通)
**ファイル**: `lib/websocket-chat-transport.ts` または wrapper
**場所**: `controller.enqueue(chunk)` 直前
```typescript
// Logger injection - final chunk before useChat
if (chunkLogger.isEnabled()) {
  await chunkLogger.logChunk({
    location: 'frontend-useChat-chunk',
    direction: 'out',
    chunk
  });
}

controller.enqueue(chunk as UIMessageChunk);
```

---

## 実装計画

### Phase 1: Backend Logger (Python) ✅ **COMPLETED 2025-12-14**
**目標**: ADK イベントと SSE イベントを記録

**Tasks**:
- [x] `chunk_logger.py` 作成（root に配置、lib/ は TypeScript 用）
  - [x] `ChunkLogger` クラス実装
  - [x] JSONL 書き込み機能
  - [x] 環境変数による有効化
  - [x] Session ID 管理
- [x] `stream_protocol.py` に logger 差し込み
  - [x] ADK event logging (stream_adk_to_ai_sdk, Line ~921-927)
  - [x] SSE event logging (stream_adk_to_ai_sdk, Line ~854-869)
  - [x] Final event logging (stream_adk_to_ai_sdk, Line ~915-928)
- [x] Tests (`tests/test_chunk_logger.py`)
  - [x] Logger が正しく JSONL を生成することを確認
  - [x] 環境変数で ON/OFF できることを確認
  - [x] 13 comprehensive tests, all passing

**Implementation Details**:
- **Injection Point**: `stream_adk_to_ai_sdk()` function
  - ADK event: Uses `repr(event)` for simple string representation
  - SSE event: Extracts JSON from SSE string format `"data: {...}\n\n"`
  - Final event: Same extraction for finalize events
- **Simplicity**: Moved from `convert_event()` to `stream_adk_to_ai_sdk()` for cleaner code
  - No complex dict conversion needed
  - All events pass through single point
  - Easier to maintain

**Actual Output**:
```jsonl
{"timestamp":1702540800000,"session_id":"session-2025-12-14-123456","mode":"adk-sse","location":"backend-adk-event","direction":"in","sequence_number":1,"chunk":"Event(...)","metadata":null}
{"timestamp":1702540800010,"session_id":"session-2025-12-14-123456","mode":"adk-sse","location":"backend-sse-event","direction":"out","sequence_number":2,"chunk":{"type":"text-delta","textDelta":"Hello"},"metadata":null}
```

**Commit**: 5dc2d14

### Phase 2: Frontend Logger (TypeScript) ✅ COMPLETED 2025-12-14
**目標**: Frontend の各ポイントで chunk を記録

**Tasks**:
- [x] `lib/chunk-logger.ts` 作成
  - [x] `ChunkLogger` クラス実装
  - [x] Browser での JSONL 保存 (Blob + Download - Option B 採用)
  - [x] localStorage による有効化 (`CHUNK_LOGGER_ENABLED`, `CHUNK_LOGGER_SESSION_ID`)
- [x] 各 Transport に logger 差し込み
  - [x] WebSocketChatTransport (ADK BIDI) - 入出力両方
  - [x] ChunkLoggingTransport wrapper (ADK SSE + Gemini Direct) - useChat chunk
- [ ] Tests (Phase 2 実装完了、テストは別途)
  - [ ] Logger が chunk を記録することを確認
  - [ ] 各モードで正しい location が記録されることを確認

**Implementation Details**:

**ChunkLogger** (`lib/chunk-logger.ts`):
- In-memory chunk storage (`ChunkLogEntry[]`)
- Session ID auto-generation: `session-YYYY-MM-DD-HHMMSS`
- Sequence numbering per location
- `export()` method: Blob + Download as JSONL
- localStorage configuration support

**Transport Integration**:

1. **WebSocketChatTransport** (ADK BIDI):
   - `handleWebSocketMessage()`: Log incoming WS chunks
     - Location: `frontend-ws-chunk`
     - Direction: `in`
     - Chunk: Raw SSE string from WebSocket
   - `sendEvent()`: Log outgoing WS events
     - Location: `frontend-ws-chunk`
     - Direction: `out`
     - Chunk: JSON stringified event

2. **ChunkLoggingTransport wrapper** (ADK SSE + Gemini Direct):
   - Created `lib/chunk-logging-transport.ts`
   - Wraps `DefaultChatTransport<UIMessage>`
   - Intercepts `UIMessageChunk` stream
   - Location: `frontend-useChat-chunk`
   - Direction: `in`
   - Logs all chunks flowing to useChat hook

3. **build-use-chat-options.ts**:
   - Gemini mode: Wrap `DefaultChatTransport` with `ChunkLoggingTransport`
   - ADK SSE mode: Wrap `DefaultChatTransport` with `ChunkLoggingTransport`
   - ADK BIDI mode: Uses `WebSocketChatTransport` directly (already has logging)

**Backend Logger Fix** (User Feedback):
- `stream_protocol.py`: Log raw SSE strings instead of parsing/re-encoding
- Prevents double-encoding issues in JSONL
- Before: `json.loads(json_str)` → log → `json.dumps()`
- After: Log `sse_event` string directly

**Browser での保存方法** (Option B 採用):
- メモリに蓄積 → `export()` で Blob 生成 → 自動ダウンロード
- ファイル名: `{session_id}.jsonl`
- 簡単で実装が楽、ユーザーが明示的にエクスポート可能

**Commit**: bd83e26

### Phase 3: Player 機構 ⬜ 優先度: Medium
**目標**: 記録した chunk を再生

**Tasks**:
- [ ] `lib/chunk_player.py` (Backend)
  - [ ] JSONL 読み込み
  - [ ] Iterator インターフェース
  - [ ] Timing 制御 (real-time/fast-forward/step)
- [ ] `lib/chunk-player.ts` (Frontend)
  - [ ] JSONL 読み込み
  - [ ] AsyncIterator インターフェース
  - [ ] Timing 制御
- [ ] Mock injection points
  - [ ] Backend: ADK event mock
  - [ ] Frontend: Transport mock
- [ ] Tests
  - [ ] Recorded chunks が正しく再生されることを確認
  - [ ] Timing が正しいことを確認

### Phase 4: E2E テスト統合 ⬜ 優先度: Low
**目標**: Player を使った E2E テスト作成

**Tasks**:
- [ ] Fixture として chunk logs を保存
  - [ ] `tests/fixtures/chunk_logs/` ディレクトリ
  - [ ] 代表的なシナリオの chunk logs
- [ ] E2E テストで Player 使用
  - [ ] Recorded chunks を再生
  - [ ] UI の動作を検証
- [ ] Documentation
  - [ ] Chunk logger/player の使い方
  - [ ] 新しい chunk logs の作成方法

---

## 期待される効果

### 1. テスト自動化
- 手動操作 → chunk 記録 → 自動テスト化のサイクル
- 実際の chunk データで E2E テスト

### 2. デバッグ効率化
- 問題が発生した chunk を記録
- 同じ chunk を何度も再生して原因調査

### 3. 回帰テスト
- 過去の chunk logs を使って新しいバージョンをテスト
- Chunk 変換ロジックの変更を検証

### 4. 3モード間の比較
- 同じシナリオでの chunk の違いを比較
- ADK SSE と ADK BIDI の変換が同じかチェック

### 5. ドキュメント化
- Chunk の実例を記録として残す
- 新しい開発者への教材

---

## 技術的考慮事項

### JSONL vs その他フォーマット

**JSONL の利点**:
- ✅ 1行=1chunk で扱いやすい
- ✅ Stream 処理に適している
- ✅ 一部だけ読み込める
- ✅ 人間が読みやすい
- ✅ `jq` などのツールで処理可能

**JSONL の欠点**:
- ❌ Binary data (audio) が Base64 になり大きくなる
- ❌ 大量の chunk で巨大ファイルになる可能性

**代替案**:
- MessagePack: Binary format, 効率的だが人間が読めない
- SQLite: クエリ可能だが overhead が大きい
- Protobuf: 効率的だが schema 管理が必要

**結論**: まずは JSONL で開始。必要に応じて圧縮や別フォーマット検討。

### Frontend での保存方法

**Option A: IndexedDB**
- ✅ 大量データを保存可能
- ✅ Offline でも動作
- ❌ 実装が複雑
- ❌ Export 機能が必要

**Option B: Blob + Download**
- ✅ 実装がシンプル
- ✅ ファイルとして直接保存
- ❌ 大量データで遅い
- ❌ ブラウザの download limit

**Option C: Backend POST**
- ✅ シンプル
- ✅ Backend と統合しやすい
- ❌ Network overhead
- ❌ Backend の実装が必要

**結論**: Phase 2 では Option B (Blob + Download) で開始。Phase 3 で Option C を検討。

### セキュリティ考慮

- Chunk に個人情報が含まれる可能性
- Production では logger を無効化
- Chunk logs を .gitignore に追加
- Session ID に UUID を使用して衝突回避

---

## 次のステップ

1. ✅ 実験ノート作成 (このファイル)
2. ✅ Phase 1: Backend Logger 実装完了 (commit 5dc2d14)
3. ✅ Phase 2: Frontend Logger 実装完了 (commit bd83e26)
4. ⬜ 手動操作で chunk 記録のテスト
5. ⬜ Phase 3: Player 機構実装
6. ⬜ Phase 4: E2E テスト統合

---

## 参考資料

- [AI SDK v6 Data Stream Protocol](https://sdk.vercel.ai/docs/ai-sdk-core/data-stream-protocol)
- [JSONL Format](http://jsonlines.org/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

---

## 変更履歴

- 2025-12-14 (continued): Phase 2 実装完了 (commit bd83e26)
  - lib/chunk-logger.ts 作成（ChunkLogger class for browser）
  - lib/chunk-logging-transport.ts 作成（DefaultChatTransport wrapper）
  - WebSocketChatTransport に logger 差し込み（入出力両方）
  - build-use-chat-options.ts を更新（ChunkLoggingTransport wrapper 使用）
  - stream_protocol.py 修正（raw SSE string logging）
  - Frontend logging: frontend-ws-chunk, frontend-useChat-chunk
  - Blob + Download での JSONL export 実装
- 2025-12-14 (03:32): Phase 1 実装完了 (commit 5dc2d14)
  - chunk_logger.py 作成、13 tests passing
  - stream_protocol.py に logger 差し込み（stream_adk_to_ai_sdk 関数内）
  - JSONL format で chunk 記録機能が動作
- 2025-12-14 (01:55): 初版作成、設計完了 (commit 646080a)
