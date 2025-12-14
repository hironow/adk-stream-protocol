# Temporary FAQ

このファイルは一時的なFAQです。内容が確定したら適切なドキュメントに統合してください。

---

## Q1: Backend toolとFrontend-delegated toolはどのように区別されていますか？

**A:**

すべてのtoolはbackend（`server.py`）に定義されていますが、一部のtoolは実行をfrontendに委譲します。

**区別方法:**

```python
# server.py:333
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}
```

このセットに含まれるtoolがfrontend-delegated toolです。

**実装パターンの違い:**

**Backend tool（サーバーで完結）:**
```python
async def get_weather(location: str) -> dict[str, Any]:
    """
    Weather APIを直接呼び出し、frontendには委譲しない
    """
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            data = await response.json()
            return {
                "location": location,
                "temperature": data["main"]["temp"],
                "description": data["weather"][0]["description"],
            }
```

**Frontend-delegated tool（ブラウザAPIが必要）:**
```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    """
    AudioContext APIはブラウザでしか使えないため、frontendに実行を委譲
    """
    # Connection-specific delegateを取得
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    tool_call_id = tool_context.function_call_id

    # Frontendに実行を委譲してawait
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )
    return result
```

**Frontend-delegated toolが必要な理由:**

- **ブラウザAPI依存**: AudioContext, Geolocation など
- **セキュリティ**: ブラウザのsandbox内で実行する必要がある
- **ユーザー承認**: ブラウザのpermission APIが必要

**Tool定義の場所:**

- すべてのtoolは`server.py`に定義（AIがtoolの存在を認識するため）
- Frontend実行が必要なtoolは`delegate.execute_on_frontend()`で委譲
- Frontend側の実装は`components/chat.tsx`の`handleToolCall`関数

---

## Q2: FrontendToolDelegateパターンはPromiseのようにresolveとrejectが完全に分離できますか？

**A:**

はい、完全に分離できます。`asyncio.Future`を使用したPromise的パターンで実装されています。

**実装（`tool_delegate.py`）:**

```python
class FrontendToolDelegate:
    def __init__(self) -> None:
        # tool_call_idをキーにFutureを管理
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def execute_on_frontend(
        self, tool_call_id: str, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Frontendに実行を委譲してawait（Promiseのようにブロック）
        """
        # 1. Future作成
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[tool_call_id] = future

        logger.info(f"[FrontendDelegate] Awaiting result for tool_call_id={tool_call_id}")

        # 2. Futureをawait（結果が来るまでブロック）
        result = await future

        logger.info(f"[FrontendDelegate] Received result for tool_call_id={tool_call_id}")
        return result

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        """
        Success時に呼ばれる（Promise.resolve相当）
        """
        if tool_call_id in self._pending_calls:
            logger.info(f"[FrontendDelegate] Resolving tool_call_id={tool_call_id}")
            self._pending_calls[tool_call_id].set_result(result)
            del self._pending_calls[tool_call_id]
        else:
            logger.warning(f"[FrontendDelegate] Unknown tool_call_id={tool_call_id}")

    def reject_tool_call(self, tool_call_id: str, reason: str) -> None:
        """
        Reject時に呼ばれる（Promise.reject相当）
        """
        if tool_call_id in self._pending_calls:
            logger.info(f"[FrontendDelegate] Rejecting tool_call_id={tool_call_id}")

            # 注意: set_exception()ではなくset_result()を使用
            rejection_result = {
                "success": False,
                "error": reason,
                "denied": True,
            }
            self._pending_calls[tool_call_id].set_result(rejection_result)
            del self._pending_calls[tool_call_id]
        else:
            logger.warning(f"[FrontendDelegate] Unknown tool_call_id={tool_call_id}")
```

**重要な設計判断:**

- **`reject_tool_call()`は`future.set_exception()`を使わない**
- **代わりに`future.set_result(rejection_result)`を使用**
- **理由**: Tool関数側で例外処理が不要になり、Success/Reject両方を統一された`dict[str, Any]`型で扱える

**フロー（Success時）:**

```
1. Backend tool関数
   └─> await delegate.execute_on_frontend(tool_call_id, tool_name, args)
       └─> Future作成、_pending_calls[tool_call_id] = future
       └─> await future （ブロック）

2. Frontend（ブラウザ）
   └─> User approves → addToolApprovalResponse({approved: true})
   └─> Tool実行 → audioContext.switchTrack(...)
   └─> addToolOutput({toolCallId, output: {success: true}})
   └─> WebSocket送信

3. Backend WebSocket handler
   └─> delegate.resolve_tool_result(tool_call_id, result)
       └─> future.set_result(result)

4. Backend tool関数
   └─> await解除、resultを取得
   └─> return result（AIに返す）
```

**フロー（Reject時）:**

```
1. Backend tool関数
   └─> await delegate.execute_on_frontend(...)（同上）

2. Frontend（ブラウザ）
   └─> User denies → addToolApprovalResponse({approved: false, reason: "..."})
   └─> WebSocket送信

3. Backend WebSocket handler
   └─> delegate.reject_tool_call(tool_call_id, reason)
       └─> future.set_result({"success": False, "denied": True, "error": reason})

4. Backend tool関数
   └─> await解除、rejection_resultを取得
   └─> return {"success": False, "denied": True}（AIに返す）
```

**呼び出し元の処理:**

Backend tool関数側は例外処理が不要で、統一された型で扱えます：

```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    delegate = tool_context.state.get("temp:delegate")
    tool_call_id = tool_context.function_call_id

    # Success/Reject両方とも同じ型で返る
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )

    # 例外処理不要、resultの中身をチェックするだけ
    # result = {"success": True, ...} または {"success": False, "denied": True, ...}
    return result
```

**まとめ:**

- ✅ `resolve_tool_result()`と`reject_tool_call()`は完全に分離
- ✅ Promise的なawaitパターン（`asyncio.Future`）
- ✅ Rejectも例外ではなく結果として扱う設計（`set_result()`で統一）
- ✅ Tool関数側は統一された`dict[str, Any]`型で扱える

---

## Q3: Tool approval後、結果はどのようにbackendに送られますか？（Step 7の詳細）

**A:**

AI SDK v6の`sendAutomaticallyWhen`機能により、`addToolApprovalResponse()`または`addToolOutput()`呼び出し後、条件が満たされると**自動的に**`transport.sendMessages()`が呼ばれます。

**完全なフロー:**

```
1. User sends message
   └─> useChat.append({ role: 'user', content: '...' })
   └─> useChat internally calls transport.sendMessages(options)
   └─> Transport sends to Backend

2. Backend processes and sends tool-approval-request
   └─> Backend → WebSocket → Transport
   └─> Transport enqueues UIMessageChunk to ReadableStream
   └─> ReadableStream → useChat

3. useChat receives tool-approval-request
   └─> AI SDK v6 detects approval-requested state
   └─> UI renders approval dialog

4. User approves/denies in UI
   └─> Frontend calls addToolApprovalResponse(approvalId, {approved: true/false})
   └─> useChat state updated: "approval-responded"

5. (Optional) Frontend executes tool and provides result
   └─> Frontend calls addToolOutput(toolCallId, result)
   └─> useChat state updated: "output-available"

6. AI SDK v6 checks sendAutomaticallyWhen condition
   └─> Calls lastAssistantMessageIsCompleteWithApprovalResponses(options)
   └─> Returns true if:
       - At least one approval-responded exists
       - All tools are complete (output-available, output-error, or approval-responded)

7. AI SDK v6 automatically calls transport.sendMessages()
   └─> transport.sendMessages(options) with updated messages array
   └─> Transport sends tool_result to Backend

8. Backend receives and processes result
   └─> WebSocket handler receives tool_result event
   └─> delegate.resolve_tool_result(tool_call_id, result)
   └─> Tool function's Future resolves
   └─> Tool function returns result to AI

9. Backend continues generation
   └─> AI uses tool result to continue
   └─> Backend → text-delta events → Transport → useChat
   └─> UI shows AI's response
```

**重要なポイント（Step 7の詳細）:**

**設定（`lib/build-use-chat-options.ts`）:**

```typescript
// ADK SSE mode
const adkSseOptions = {
  transport: adkSseTransport,
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};

// ADK BIDI mode
const adkBidiOptions = {
  transport: websocketTransport,
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};
```

**AI SDK v6の自動送信ロジック:**

1. `addToolApprovalResponse()`または`addToolOutput()`が呼ばれる
2. useChat内部でmessages配列が更新される
3. AI SDK v6が`sendAutomaticallyWhen(options)`を呼び出す
4. 関数が`true`を返したら、自動的に`transport.sendMessages(options)`を呼ぶ
5. Transport（DefaultChatTransportまたはWebSocketChatTransport）がBackendに送信

**条件判定関数の動作:**

```typescript
// AI SDK v6提供の標準関数
function lastAssistantMessageIsCompleteWithApprovalResponses(options: {
  messages: UIMessage[];
}): boolean {
  const lastMessage = options.messages[options.messages.length - 1];

  // 1. 最後のメッセージがassistantかチェック
  if (lastMessage.role !== 'assistant') return false;

  // 2. approval-respondedが少なくとも1つあるかチェック
  const hasApprovalResponse = lastMessage.parts.some(
    part => part.type === 'approval-responded'
  );
  if (!hasApprovalResponse) return false;

  // 3. すべてのtoolが完了状態かチェック
  const allToolsComplete = lastMessage.parts
    .filter(part => part.type === 'tool-call')
    .every(toolCall => {
      // 対応するoutput/error/approval-respondedが存在するか
      return lastMessage.parts.some(part =>
        (part.type === 'tool-output' ||
         part.type === 'tool-output-error' ||
         part.type === 'approval-responded') &&
        part.toolCallId === toolCall.toolCallId
      );
    });

  return allToolsComplete;
}
```

**実装の証拠:**

`lib/websocket-chat-transport.ts:295`のコメント:
```typescript
// sendToolResult() removed - use AI SDK v6's standard addToolApprovalResponse flow
// Tool approval flow: addToolApprovalResponse() → sendAutomaticallyWhen → transport.sendMessages()
```

**単一ツールの場合の動作:**

```
User approves
└─> addToolApprovalResponse()
    └─> state: "approval-responded" (all tools complete!)
    └─> sendAutomaticallyWhen() returns true
    └─> transport.sendMessages() automatically called
    └─> Result sent to backend
```

**複数ツールの場合の動作:**

```
Tool 1: User approves
└─> addToolApprovalResponse()
    └─> state: "approval-responded" (but Tool 2 still pending)
    └─> sendAutomaticallyWhen() returns false
    └─> No automatic send yet

Tool 2: User approves and executes
└─> addToolApprovalResponse()
└─> addToolOutput()
    └─> state: "output-available" (all tools complete!)
    └─> sendAutomaticallyWhen() returns true
    └─> transport.sendMessages() automatically called
    └─> All results sent to backend
```

**簡易版の答え:**

```
useChat
↓
addToolApprovalResponse() / addToolOutput()
↓
AI SDK v6 checks sendAutomaticallyWhen()
↓
If true → AI SDK v6 automatically calls transport.sendMessages()
↓
Transport sends to Backend
```

**まとめ:**

- ✅ Step 7は`sendAutomaticallyWhen`機能による自動送信
- ✅ `lastAssistantMessageIsCompleteWithApprovalResponses`が条件判定
- ✅ 手動で`transport.sendMessages()`を呼ぶ必要はない
- ✅ AI SDK v6が自動的に適切なタイミングで送信
- ✅ 単一ツール：`addToolApprovalResponse()`直後に送信
- ✅ 複数ツール：すべてのツールが完了してから送信

---

## Q4: Chunk Loggerの設計にData Integrity（データ整合性）の観点から問題はありますか？

**A:**

はい、いくつかの問題があります。主にデバッグ・テスト用途のため現状は許容範囲ですが、本番環境やクリティカルなデータ記録には改善が必要です。

### Backend (chunk_logger.py) の問題点

**1. ファイル書き込みのエラーハンドリングがない**

```python
# chunk_logger.py:186-188 (現状)
file_handle = self._get_file_handle(location)
json_line = json.dumps(asdict(entry), ensure_ascii=False)
file_handle.write(json_line + "\n")  # 失敗してもエラーハンドリングなし
```

**問題:**
- ディスク容量不足、権限エラー、I/Oエラーが発生してもサイレントに失敗
- アプリケーションは正常動作を続けるが、ログが失われる

**影響:** 中 - デバッグ時にchunkが欠落していても気づかない

---

**2. Concurrent writes保護がない**

```python
# 複数のasyncタスクから同じlocationに書き込む可能性
async def handle_request_1():
    chunk_logger.log_chunk(location="backend-sse-event", ...)  # Task 1

async def handle_request_2():
    chunk_logger.log_chunk(location="backend-sse-event", ...)  # Task 2
```

**問題:**
- 同じファイルハンドルに並行書き込み
- JSONL行が混在する可能性（partial writeによるデータ破損）
- Sequence numberの順序保証がない

**影響:** 高 - データ破損、JSONパースエラー、再生不可能

---

**3. Atomic writesではない**

```python
# chunk_logger.py:188
file_handle.write(json_line + "\n")  # Partial writeの可能性
```

**問題:**
- OSレベルでwrite()が中断された場合、不完全なJSON行が記録される
- 例: `{"timestamp": 123456789,` ← 途中で終わる

**影響:** 中 - Chunk playerでのパースエラー、該当chunkがスキップされる

---

**4. JSON serialization失敗の処理がない**

```python
# chunk_logger.py:187
json_line = json.dumps(asdict(entry), ensure_ascii=False)  # 例外の可能性
```

**問題:**
- Circular reference、Non-serializable objectがあると例外
- 例外が発生するとアプリケーション全体が停止する可能性
- Sequence numberが増加した後に失敗するとgapが発生

**影響:** 高 - アプリケーションクラッシュ、sequence numberのgap

---

**5. File handle leakの可能性**

```python
# chunk_logger.py:138-140
self._file_handles[location] = open(
    file_path, "a", encoding="utf-8", buffering=1
)  # 例外時にcloseされない
```

**問題:**
- `__exit__()`が呼ばれない場合（context manager未使用時）、file handleがリーク
- 長時間稼働でfile descriptor枯渇の可能性

**影響:** 低 - デバッグ用途では短期間のため問題になりにくい

---

**6. Flush/fsync保証がない**

```python
# chunk_logger.py:138-140
file_handle = open(file_path, "a", encoding="utf-8", buffering=1)  # Line buffering
file_handle.write(json_line + "\n")  # flushは改行で自動だがfsyncなし
```

**問題:**
- Line bufferingで改行時にflushされるが、OSバッファにはまだ残っている
- クラッシュ時に最後の数行がロストする可能性
- `fsync()`呼び出しがないためディスク書き込み保証なし

**影響:** 中 - クラッシュ時の数行ロスト（数百ms分）

---

### Frontend (lib/chunk-logger.ts) の問題点

**1. メモリ上に全て保持（メモリリーク、ページリロードでロスト）**

```typescript
// lib/chunk-logger.ts:74
private _entries: ChunkLogEntry[] = [];

// lib/chunk-logger.ts:158
this._entries.push(entry);  // 無制限に増加
```

**問題:**
- ページリロード時にすべてロスト（IndexedDBやlocalStorageに保存していない）
- 長時間記録でメモリ使用量が増加し続ける
- ブラウザタブクラッシュでデータ全ロスト

**影響:** 高 - 長時間セッションでOOM、ページリロードでデータ全ロスト

---

**2. JSON.stringify()失敗時の処理がない**

```typescript
// lib/chunk-logger.ts:172
const jsonl = this._entries
  .map((entry) => JSON.stringify(entry))  // 例外の可能性
  .join("\n");
```

**問題:**
- Circular reference、BigInt、Functionなどがあると例外
- Sequence numberが増加した後に失敗するとgap発生

**影響:** 中 - export失敗、sequence numberのgap

---

**3. Circular reference対策がない**

```typescript
// WebSocketオブジェクトなどがchunkに含まれる可能性
chunkLogger.logChunk({
  location: "frontend-ws-chunk",
  chunk: wsMessage,  // wsMessageがcircular referenceを持つ場合
});
```

**問題:**
- `JSON.stringify()`が`TypeError: Converting circular structure to JSON`で失敗

**影響:** 中 - Chunk記録失敗、export失敗

---

**4. 大量データでのOOM (Out of Memory)**

```typescript
// 1万チャンク、各チャンク1KB = 10MB
// 10万チャンク、各チャンク1KB = 100MB
// メモリに全て保持
```

**問題:**
- 長時間BIDIモードでPCM chunkが大量に記録される
- ブラウザのメモリ制限に到達してクラッシュ

**影響:** 高 - ブラウザタブクラッシュ、データ全ロスト

---

**5. export()がブロッキング（大量データ時UI freeze）**

```typescript
// lib/chunk-logger.ts:171-173
const jsonl = this._entries
  .map((entry) => JSON.stringify(entry))  // 同期処理、大量データでUI freeze
  .join("\n");
```

**問題:**
- 10万entriesのJSON.stringify()とjoin()が同期的に実行
- メインスレッドブロック、UIフリーズ数秒

**影響:** 中 - UX低下、"ページが応答しません"警告

---

**6. Sequence numberのgap（失敗時）**

```typescript
// lib/chunk-logger.ts:142-158
const nextSeq = currentSeq + 1;
this._sequenceCounters.set(location, nextSeq);  // ここで増加

const entry: ChunkLogEntry = { ... };
this._entries.push(entry);  // この後に例外が発生する可能性
```

**問題:**
- Sequence numberを増加させた後、`push()`前に例外が発生するとgap
- 例: 1, 2, 4, 5（3が欠落）

**影響:** 低 - Debugレベルでは許容範囲

---

### 改善提案（優先度順）

**🔴 High Priority（データ破損を防ぐ）:**

1. **Backend: Concurrent writes保護**
   ```python
   import asyncio

   class ChunkLogger:
       def __init__(self):
           self._write_locks: dict[LogLocation, asyncio.Lock] = {}

       async def log_chunk_async(self, location, ...):
           if location not in self._write_locks:
               self._write_locks[location] = asyncio.Lock()

           async with self._write_locks[location]:
               # Critical section: write to file
               ...
   ```

2. **Backend: JSON serialization error handling**
   ```python
   try:
       json_line = json.dumps(asdict(entry), ensure_ascii=False)
   except (TypeError, ValueError) as e:
       logger.error(f"Failed to serialize chunk: {e}")
       # Fallback: 最小限のメタデータだけ記録
       json_line = json.dumps({
           "timestamp": entry.timestamp,
           "sequence_number": entry.sequence_number,
           "error": "serialization_failed",
       })
   ```

3. **Frontend: Circular reference対策**
   ```typescript
   // JSON.stringify with replacer to handle circular refs
   const seen = new WeakSet();
   const jsonl = this._entries.map((entry) =>
     JSON.stringify(entry, (key, value) => {
       if (typeof value === "object" && value !== null) {
         if (seen.has(value)) return "[Circular]";
         seen.add(value);
       }
       return value;
     })
   ).join("\n");
   ```

**🟡 Medium Priority（データロストを防ぐ）:**

4. **Frontend: IndexedDBまたはlocalStorage永続化**
   ```typescript
   // ページリロード対策
   logChunk(options: LogChunkOptions): void {
       const entry = { ... };
       this._entries.push(entry);

       // Periodic save to IndexedDB
       if (this._entries.length % 100 === 0) {
           this._saveToIndexedDB();
       }
   }
   ```

5. **Backend: Write error handling**
   ```python
   try:
       file_handle.write(json_line + "\n")
       file_handle.flush()  # Ensure OS buffer write
   except OSError as e:
       logger.error(f"Failed to write chunk log: {e}")
   ```

**🟢 Low Priority（UX改善）:**

6. **Frontend: Web Worker for export**
   ```typescript
   async export(): Promise<void> {
       const worker = new Worker(new URL('./chunk-export-worker.ts', import.meta.url));
       worker.postMessage(this._entries);
       // ... handle download in worker
   }
   ```

7. **Frontend: Memory limit**
   ```typescript
   private readonly MAX_ENTRIES = 10000;

   logChunk(options: LogChunkOptions): void {
       if (this._entries.length >= this.MAX_ENTRIES) {
           console.warn("ChunkLogger: Max entries reached, dropping oldest");
           this._entries.shift();  // FIFO
       }
       this._entries.push(entry);
   }
   ```

---

### まとめ

**現状評価:**
- ✅ デバッグ用途では十分機能
- ⚠️ 本番環境やクリティカルなデータ記録には不十分
- ❌ 長時間稼働や大量データには不適合

**推奨対応:**
- **即座に対応**: Concurrent writes保護（Backend）
- **短期**: Error handling追加（Backend + Frontend）
- **中期**: IndexedDB永続化（Frontend）
- **長期**: 本番用途なら専用のロギング基盤（Elasticsearch、CloudWatch Logsなど）を使用

**用途別の判断:**
- **デバッグ・開発**: 現状で問題なし
- **E2Eテスト**: Error handling追加を推奨
- **本番環境**: 現在の実装は使用不可、専用ロギング基盤を使用

---

## Q5: なぜAI SDK v6を選んだのですか？

**A:**

このプロジェクトでは、AI SDK v6 beta（`3.0.0-beta.*`系）を選択しました。v3/v4ではなくv6を選んだ決定的な理由がいくつかあります。

### 🎯 主な選定理由

**1. ネイティブのTool Approval API（最重要）**

AI SDK v6は公式にTool Approval機能を提供しています：

```typescript
// AI SDK v6提供の標準型
type UIMessageChunk =
  | { type: 'tool-approval-request'; approvalId: string; toolCall: ToolCall }
  | { type: 'approval-responded'; approvalId: string; approved: boolean }
  | ...

// AI SDK v6提供の標準API
const { addToolApprovalResponse } = useChat();
addToolApprovalResponse(approvalId, true);  // Approve
addToolApprovalResponse(approvalId, false, "User denied"); // Deny
```

**v3/v4では不可能だったこと:**
- Tool approval requestがUIMessageChunk型に含まれていない
- `addToolApprovalResponse()`メソッドが存在しない
- カスタムコールバック機構を自前で実装する必要がある

**v6での実装の簡潔さ:**
```typescript
// ❌ v3/v4: カスタム実装が必要
interface CustomTransport {
  onToolApprovalRequest?: (approval: { approvalId: string; ... }) => void;
}

// ✅ v6: フレームワーク標準機能
// tool-approval-request eventがuseChatに自動的に流れる
// addToolApprovalResponse()で応答するだけ
```

**実装の証拠:**
- `experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md` - Tool Approval調査
- Commit `abe2278`: "Migrate to AI SDK v6 beta with proper image upload support"

---

**2. Custom Transport支援（WebSocket双方向ストリーミング）**

AI SDK v6の`ChatTransport`インターフェースにより、カスタムトランスポート層を実装できます：

```typescript
// AI SDK v6提供のインターフェース
interface ChatTransport<UI_MESSAGE extends UIMessage> {
  sendMessages: (options: {
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
    ...
  }) => Promise<ReadableStream<UIMessageChunk>>;
}

// 実装例: lib/websocket-chat-transport.ts
export class WebSocketChatTransport implements ChatTransport {
  async sendMessages(options: SendMessagesParams): Promise<ReadableStream<UIMessageChunk>> {
    // WebSocket経由でbackendに送信
    // ADK BIDIモード（run_live()）と統合
    // SSE format over WebSocketでチャンクをストリーミング
  }
}
```

**ADK BIDIモードとの統合が可能に:**
- Gemini Live APIのWebSocketプロトコル
- リアルタイム音声エージェント
- ユーザーによる応答の中断
- 低遅延マルチモーダル入力

**v3/v4では:**
- SSE（Server-Sent Events）のみサポート
- 双方向ストリーミングには非公式のworkaroundが必要
- コミュニティ実装が不安定

**実装の証拠:**
- `experiments/2025-12-11_adk_bidi_ai_sdk_v6_integration.md` - BIDI統合実験
- `lib/websocket-chat-transport.ts` - カスタムWebSocketトランスポート実装
- Commit `cb73c42`: "Introduce AI SDK 6 Beta and Tool Approval Patterns"

---

**3. Multimodal Support（UIMessage parts構造）**

AI SDK v6はmessage.partsという構造で複数のコンテンツタイプをサポートします：

```typescript
// AI SDK v6の標準型
interface UIMessage {
  role: 'user' | 'assistant';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; filename: string; mediaType: string; url: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
    | { type: 'tool-output'; toolCallId: string; output: any }
    | { type: 'approval-requested'; approvalId: string; toolCall: ToolCall }
    | { type: 'approval-responded'; approvalId: string; approved: boolean }
  >;
}
```

**v3/v4では:**
```typescript
// v3/v4の旧型
interface Message {
  role: 'user' | 'assistant';
  content: string;  // テキストのみ！
}
```

**画像アップロード実装の比較:**

**v3/v4:**
```typescript
// 非標準的な実装が必要
const handleImageUpload = (file: File) => {
  // カスタムロジックでbase64エンコード
  // appendのcontentに埋め込む（非推奨）
};
```

**v6:**
```typescript
// lib/build-use-chat-options.ts:142-155
const handleImageUpload = (file: File) => {
  const reader = new FileReader();
  reader.onload = () => {
    sendMessage({
      text: input || "",
      files: [{
        type: "file",
        filename: file.name,
        mediaType: file.type,
        url: reader.result as string,  // Data URL
      }],
    });
  };
  reader.readAsDataURL(file);
};
```

**実装の証拠:**
- Commit `abe2278`: "proper image upload support"の詳細
- Commit `c638026`: "Migrate to AI SDK v6 files API for image uploads"

---

**4. Data Stream Protocol（カスタムイベント拡張）**

AI SDK v6のData Stream Protocolは`data-*`パターンでカスタムイベントをサポートします：

```typescript
// AI SDK v6提供のカスタムイベント拡張パターン
type UIMessageChunk =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-input-available'; ... }
  | { type: 'data-image'; ... }          // カスタムイベント（画像）
  | { type: 'data-pcm'; ... }            // カスタムイベント（音声PCM）
  | { type: 'data-transcription'; ... }  // カスタムイベント（音声テキスト化）
```

**ADK固有の機能をAI SDK v6プロトコルにマッピング:**

```python
# stream_protocol.py: ADK Event → AI SDK v6 Data Stream Protocol変換
if hasattr(event, "server_content") and event.server_content:
    for part in event.server_content.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            # 画像データをdata-imageイベントに変換
            yield {
                "type": "data-image",
                "image": f"data:{mime_type};base64,{base64_data}",
            }
        elif part.inline_data and part.inline_data.mime_type == "audio/pcm":
            # PCM音声データをdata-pcmイベントに変換
            yield {
                "type": "data-pcm",
                "pcm": base64_data,
                "sampleRate": 24000,
            }
```

**v3/v4では:**
- カスタムイベントのサポートが限定的
- 拡張フォーマットの型定義が不十分
- マルチモーダルデータのストリーミングが困難

**実装の証拠:**
- `stream_protocol.py:742-878` - ADK Event → AI SDK v6 変換ロジック
- `experiments/2025-12-12_adk_field_mapping_completeness.md` - フィールドマッピング調査

---

**5. sendAutomaticallyWhen（Tool approval自動再送信）**

AI SDK v6は条件付き自動メッセージ送信機能を提供します：

```typescript
// lib/build-use-chat-options.ts:273-274
const adkBidiOptions = {
  transport: websocketTransport,
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};
```

**動作:**
1. User approves tool → `addToolApprovalResponse(id, true)`
2. AI SDK v6が`sendAutomaticallyWhen()`を呼び出し
3. 条件が`true`なら自動的に`transport.sendMessages()`を呼ぶ
4. Frontend開発者は手動送信コードを書く必要なし

**v3/v4では:**
- 手動で`sendMessage()`を呼ぶ必要がある
- Tool approval後の再送信タイミングを自前で管理
- 複数ツールの同時承認処理が複雑

**実装の証拠:**
- TEMP_FAQ.md Q3 - Tool approval Step 7の詳細
- `lib/build-use-chat-options.ts:249-250, 273-274`

---

**6. 改善されたReact統合（useChat hook）**

AI SDK v6のuseChatフックは状態管理が改善されています：

```typescript
// v6の標準API
const {
  messages,           // UIMessage[]
  sendMessage,        // (options: { text: string; files?: File[] }) => void
  addToolOutput,      // (toolCallId: string, output: any) => void
  addToolApprovalResponse,  // (id: string, approved: boolean) => void
  status,             // 'idle' | 'submitted' | 'streaming' | 'error'
} = useChat(options);
```

**v3/v4との違い:**
```typescript
// v3/v4の旧API
const {
  messages,           // Message[] (content: string only)
  input,              // string
  handleInputChange,  // (e: React.ChangeEvent) => void
  handleSubmit,       // (e: React.FormEvent) => void
  isLoading,          // boolean
} = useChat();
```

**v6の利点:**
- `status`フィールドで詳細な状態管理（idle/submitted/streaming/error）
- `sendMessage()`でファイル添付が標準サポート
- Tool approval/outputのimperative API
- より柔軟なメッセージ送信（テキスト入力フィールドと分離）

**実装の証拠:**
- `docs/GETTING_STARTED.md:336-371` - AI SDK v6 Migration Notes
- Commit `abe2278` - useChat API変更の詳細

---

### 🚀 実装上の利点まとめ

**1. 開発速度の向上:**
- Tool approval機能が標準提供 → カスタム実装不要
- WebSocketトランスポートの型定義完備 → 安全な実装
- Multimodal APIが標準 → 画像・音声の扱いが簡単

**2. コードの保守性:**
- フレームワークの標準機能を使用 → 将来のアップデートに追従しやすい
- 型安全性の向上（UIMessage parts構造）
- カスタムコールバック不要 → コードが簡潔

**3. ADKとの統合:**
- ADK BIDI mode（WebSocket）と完全統合
- ADK固有イベント（data-*）のサポート
- StreamProtocolConverterで既存のSSE変換ロジックを再利用

**4. ユーザー体験:**
- リアルタイム音声エージェント（BIDI mode）
- 画像・音声のストリーミング表示
- Tool approvalの統一されたUI/UX

---

### ⚠️ AI SDK v6の注意点

**1. Beta版のため破壊的変更の可能性:**
- 現在`3.0.0-beta.72`（@ai-sdk/google）と`3.0.0-beta.151`（@ai-sdk/react）
- 正式リリース時にAPIが変更される可能性
- プロダクション環境では慎重な検証が必要

**2. 移行作業が必要:**
- `Message` → `UIMessage`の型変更
- `message.content` → `message.parts`の構造変更
- `handleSubmit()` → `sendMessage()`のAPI変更
- 詳細は`docs/GETTING_STARTED.md:336-471`を参照

**3. コミュニティサポート:**
- v6はまだ新しく、StackOverflowの情報が少ない
- 公式ドキュメントが主な情報源

---

### 📊 選択の根拠（Decision Matrix）

| 機能 | AI SDK v3/v4 | AI SDK v6 | このプロジェクトでの重要度 |
|------|--------------|-----------|---------------------------|
| Tool Approval API | ❌ カスタム実装必要 | ✅ ネイティブサポート | 🔴 Critical |
| WebSocket Transport | ⚠️ 非公式workaround | ✅ ChatTransport interface | 🔴 Critical |
| Multimodal (Images) | ⚠️ 非標準的な実装 | ✅ UIMessage parts | 🟡 High |
| Custom Events | ⚠️ 限定的 | ✅ data-* pattern | 🟡 High |
| Auto Message Send | ❌ 手動実装必要 | ✅ sendAutomaticallyWhen | 🟢 Medium |
| React Hook API | ⚠️ 旧API | ✅ 改善されたAPI | 🟢 Medium |
| 安定性 | ✅ Stable | ⚠️ Beta | 🟡 High |
| ドキュメント | ✅ 豊富 | ⚠️ 限定的 | 🟢 Medium |

**結論:** Tool Approval APIとWebSocket Transportの2つのCritical要件により、AI SDK v6を選択することが必須でした。

---

### 🔗 関連リソース

**Experiment Notes:**
- `experiments/2025-12-11_adk_bidi_ai_sdk_v6_integration.md` - BIDI統合の成功実証
- `experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md` - Tool Approval調査

**Implementation Files:**
- `lib/websocket-chat-transport.ts` - WebSocket custom transport
- `lib/build-use-chat-options.ts` - useChat設定とsendAutomaticallyWhen
- `stream_protocol.py` - ADK → AI SDK v6プロトコル変換

**Documentation:**
- `docs/GETTING_STARTED.md:336-471` - AI SDK v6 Migration Notes
- AI SDK v6 Beta Documentation: https://v6.ai-sdk.dev/

**Commits:**
- `abe2278` - Migrate to AI SDK v6 beta with proper image upload support
- `cb73c42` - Introduce AI SDK 6 Beta and Tool Approval Patterns
- `c638026` - Migrate to AI SDK v6 files API for image uploads

---

### まとめ

AI SDK v6を選んだ決定的な理由：

1. ✅ **Tool Approval API** - ADKのtool approval機能を標準APIで実装可能
2. ✅ **WebSocket Transport** - ADK BIDI mode（Gemini Live API）との完全統合
3. ✅ **Multimodal Support** - 画像・音声のストリーミング表示
4. ✅ **Data Stream Protocol** - ADK固有イベントのマッピング
5. ✅ **sendAutomaticallyWhen** - Tool approval後の自動再送信

**トレードオフ:**
- Beta版のためAPIが変更される可能性
- コミュニティサポートが限定的

**判断:**
このプロジェクトの要件（ADK統合、Tool Approval、BIDI streaming）を満たすには、AI SDK v6が唯一の選択肢でした。Beta版のリスクよりも、提供される機能の価値が上回ると判断しました。

---

## Q6: FrontendToolDelegateパターンはAP2（Agent Protocol 2）と同じ設計思想ですか？

**A:**

はい、**全く同じ設計思想**です。どちらも「委譲パターン + awaitパターン」で、ツール関数が実際の結果を返せるようにしています。

### 🎯 AP2との比較

**AP2（Agent-to-Agent Protocol）:**

```python
# AP2のパターン（Agent間通信）
async def find_products(query: str, merchant_agent_client) -> dict:
    """他のAgentに処理を委譲し、結果をawait"""

    # 1. メッセージを送信
    task = await merchant_agent_client.send_a2a_message(message)

    # 2. 実際の結果を返す
    return _parse_cart_mandates(task.artifacts)
```

**我々の実装（Frontend-Backend Protocol）:**

```python
# tool_delegate.py + server.py
async def change_bgm(track: int, tool_context: ToolContext) -> dict:
    """Frontendに処理を委譲し、結果をawait"""

    # 1. Frontendに委譲
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_context.function_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )

    # 2. 実際の結果を返す
    return result
```

**パターンの一致:**

```
┌─────────────────────────────────────────────────────────────┐
│ AP2: Agent-to-Agent                                         │
├─────────────────────────────────────────────────────────────┤
│ Agent A                                                     │
│   └─> send_a2a_message() → await → Agent B processes       │
│                                      └─> returns result     │
│   └─> return actual result                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 我々: Frontend-Backend                                      │
├─────────────────────────────────────────────────────────────┤
│ Backend Tool                                                │
│   └─> execute_on_frontend() → await → Frontend executes    │
│                                         └─> returns result  │
│   └─> return actual result                                 │
└─────────────────────────────────────────────────────────────┘
```

Legend / 凡例:
- Agent A / Backend Tool: 委譲元（処理を依頼する側）
- Agent B / Frontend: 委譲先（実際に処理を実行する側）
- send_a2a_message() / execute_on_frontend(): 委譲メソッド
- await: 結果が返るまでブロック
- return actual result: 実際の結果を返す（プレースホルダーではない）

---

### ✅ 設計思想の共通点

**1. 委譲パターン（Delegation Pattern）**

**AP2:**
- Agent Aが処理をAgent Bに委譲
- Agent Bが実際の処理を実行
- Agent Aは結果を受け取る

**我々:**
- Backend toolが処理をFrontendに委譲
- Frontendが実際の処理を実行（ブラウザAPI）
- Backend toolは結果を受け取る

---

**2. Awaitパターン（Promise-like Async Pattern）**

**AP2:**
```python
task = await merchant_agent_client.send_a2a_message(message)
# ↑ Agent Bの処理が完了するまでブロック
```

**我々:**
```python
result = await delegate.execute_on_frontend(...)
# ↑ Frontendの処理が完了するまでブロック
```

**共通点:**
- 非同期処理（async/await）
- 結果が返るまでブロック
- 完了後に次の処理を実行

---

**3. 実際の結果を返す（Not a Placeholder）**

**AP2:**
```python
# ❌ プレースホルダーではない
# return {"status": "pending"}  # ← こうではない

# ✅ 実際の結果
return _parse_cart_mandates(task.artifacts)  # ← Agent Bの結果
```

**我々:**
```python
# ❌ プレースホルダーではない
# return {"_client_side": True}  # ← before_tool_callbackパターン（旧）

# ✅ 実際の結果
return result  # ← Frontendの結果（success: true, current_track: 1など）
```

---

**4. ツール関数がシンプル（ロジックのカプセル化）**

**AP2:**
```python
async def find_products(query: str, merchant_agent_client) -> dict:
    # 委譲ロジックはmerchant_agent_client内にカプセル化
    task = await merchant_agent_client.send_a2a_message(message)
    return _parse_cart_mandates(task.artifacts)
```

**我々:**
```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict:
    # 委譲ロジックはFrontendToolDelegate内にカプセル化
    result = await delegate.execute_on_frontend(...)
    return result
```

**共通点:**
- ツール関数は「委譲→await→結果を返す」だけ
- 通信プロトコルの詳細は隠蔽されている
- テストが容易（delegateをmock可能）

---

### 🔄 内部実装の類似性

**AP2の内部実装（推測）:**

```python
class MerchantAgentClient:
    def __init__(self):
        self._pending_tasks: dict[str, asyncio.Future] = {}

    async def send_a2a_message(self, message: dict) -> Task:
        task_id = generate_task_id()

        # Futureを作成
        future = asyncio.Future()
        self._pending_tasks[task_id] = future

        # メッセージ送信（Agent Bへ）
        await self._send_to_agent_b(task_id, message)

        # 結果をawait
        result = await future
        return result

    def _on_task_result_received(self, task_id: str, result: Task):
        """Agent Bからの結果を受信したときに呼ばれる"""
        if task_id in self._pending_tasks:
            self._pending_tasks[task_id].set_result(result)
            del self._pending_tasks[task_id]
```

**我々の実装（tool_delegate.py）:**

```python
class FrontendToolDelegate:
    def __init__(self) -> None:
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def execute_on_frontend(
        self, tool_call_id: str, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        # Futureを作成
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[tool_call_id] = future

        # tool-approval-requestイベントがstream_protocol.pyから自動送信される

        # 結果をawait
        result = await future
        return result

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        """Frontendからの結果を受信したときに呼ばれる（WebSocketハンドラー経由）"""
        if tool_call_id in self._pending_calls:
            self._pending_calls[tool_call_id].set_result(result)
            del self._pending_calls[tool_call_id]
```

**完全に同じパターン！**

---

### 📊 比較表

| 要素 | AP2（Agent-to-Agent） | 我々（Frontend-Backend） |
|------|----------------------|-------------------------|
| 委譲先 | Agent B（他のバックエンド） | Frontend（ブラウザ） |
| 通信手段 | A2Aプロトコル（HTTP/gRPC等） | WebSocket（tool-approval-request） |
| awaitの実装 | asyncio.Future | asyncio.Future（同じ！） |
| 結果の受信 | `_on_task_result_received()` | `resolve_tool_result()` |
| ツール関数 | `async def find_products(...)` | `async def change_bgm(...)` |
| 実際の結果 | ✅ `task.artifacts` | ✅ `result` |
| プレースホルダー | ❌ 使用しない | ❌ 使用しない |

---

### 🚀 設計思想の本質

**「委譲」の一般化:**

```
┌────────────────────────────────────────────────────────────┐
│ 委譲パターンの本質                                         │
├────────────────────────────────────────────────────────────┤
│ 1. 処理を他のコンポーネントに委譲する                     │
│ 2. 結果が返るまでawaitする（ブロック）                    │
│ 3. 実際の結果を受け取る                                   │
│ 4. 呼び出し元は委譲の詳細を知らない（カプセル化）         │
└────────────────────────────────────────────────────────────┘
```

**この思想の適用例:**

1. **AP2: Agent-to-Agent**
   - Merchant Agent → Product Search Agent
   - バックエンド間の分散処理

2. **我々: Frontend-Backend**
   - Backend Tool → Frontend Browser API
   - クライアント-サーバー間の役割分担

3. **その他の可能性:**
   - Backend → External API（Stripe決済など）
   - Backend → Database Query
   - Backend → Machine Learning Model

**全て同じパターンで実装可能！**

---

### ❌ before_tool_callbackパターンとの違い

**before_tool_callback（旧）:**

```python
# ❌ 同期的、プレースホルダーを返す
def client_side_tool_interceptor(...) -> Optional[Dict]:
    return {"_client_side": True}  # ← プレースホルダー！

# 問題点:
# - ツールの戻り値 ≠ 実際の結果
# - AIはプレースホルダーを見てしまう
# - 実際の結果を別の方法で送る必要がある
```

**FrontendToolDelegate（現在）:**

```python
# ✅ 非同期的、実際の結果を返す
async def change_bgm(track: int, tool_context: ToolContext) -> dict:
    result = await delegate.execute_on_frontend(...)
    return result  # ← 実際の結果！

# 利点:
# - ツールの戻り値 = 実際の結果
# - AIは正しい結果を見る
# - AP2と同じパターン
```

---

### 🎯 なぜAP2と同じ設計が重要か

**1. 学習コストの削減:**
- AP2を知っている開発者なら即座に理解できる
- 既存のAgent開発のベストプラクティスを適用可能

**2. パターンの再利用:**
- `asyncio.Future`ベースの委譲パターンは汎用的
- 他の委譲シナリオ（External API、ML Modelなど）にも適用可能

**3. コードの保守性:**
- 統一されたパターンでコードが書かれている
- ツール関数がシンプル（委譲ロジックは隠蔽）

**4. テスト容易性:**
- delegateをmockして単体テスト可能
- AP2と同じテスト戦略を適用可能

---

### 📝 実装の証拠

**tool_delegate.py（完全なAP2パターン実装）:**
```python
class FrontendToolDelegate:
    """Makes frontend tool execution awaitable using asyncio.Future.

    This follows the same delegation pattern as AP2 (Agent Protocol 2):
    - Create a Future for each tool call
    - Await the result
    - Resolve the Future when the result arrives
    """

    def __init__(self) -> None:
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def execute_on_frontend(...) -> dict[str, Any]:
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[tool_call_id] = future
        result = await future  # ← AP2と同じ！
        return result

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        if tool_call_id in self._pending_calls:
            self._pending_calls[tool_call_id].set_result(result)
            del self._pending_calls[tool_call_id]
```

**server.py（ツール関数でAP2パターンを使用）:**
```python
# Lines 254-290
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    """Change BGM track (executed on frontend).

    This tool delegates execution to the frontend and awaits the result,
    following the same pattern as AP2 agent-to-agent communication.
    """
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate

    # AP2と同じパターン！
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_context.function_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )

    return result  # 実際の結果を返す
```

---

### まとめ

**Q: FrontendToolDelegateパターンはAP2と同じ設計思想ですか？**

**A: はい、完全に同じです。**

**共通する設計思想:**

1. ✅ **委譲パターン** - 処理を他のコンポーネントに委ねる
2. ✅ **Awaitパターン** - `asyncio.Future`で結果をawait
3. ✅ **実際の結果を返す** - プレースホルダーではない
4. ✅ **ロジックのカプセル化** - ツール関数がシンプル

**違いは委譲先だけ:**
- AP2: Agent B（バックエンド）
- 我々: Frontend（ブラウザ）

**実装の本質は同じ:**
- `asyncio.Future`でPromise的なパターンを実現
- `await`で結果が返るまでブロック
- `set_result()`でFutureを解決

**この設計により:**
- ✅ before_tool_callbackパターン不要
- ✅ ツール関数が実際の結果を返せる
- ✅ AIが正しい結果を認識できる
- ✅ AP2の知見を活用できる

**関連リソース:**
- TEMP_FAQ.md Q2 - FrontendToolDelegateのresolve/reject分離
- `tool_delegate.py` - AP2パターンの実装
- `server.py:254-328` - change_bgm, get_location関数

---

## Q7: tool_call_idの採番（ID付与）はADK由来ですか？

**A:**

はい、**tool_call_idの採番はADK由来**です。ADKが`function_call.id`を自動生成し、それを`ToolContext.function_call_id`で取得できます。

### 🎯 ID生成のフロー

**完全なフロー:**

```
1. AIがツール呼び出しを決定
   └─> ADK内部でFunctionCallオブジェクト生成

2. ADKが自動的にIDを生成
   └─> function_call.id = "adk-2b9230a6-..." ← ADKが採番！

3. ToolContext経由でツール関数に渡される
   └─> tool_context.function_call_id = "adk-2b9230a6-..."

4. ツール関数がIDを使用
   └─> await delegate.execute_on_frontend(tool_call_id=tool_context.function_call_id)

5. StreamProtocolConverterがAI SDK v6イベントに変換
   └─> {"type": "tool-input-start", "toolCallId": "adk-2b9230a6-..."}

6. Frontendが同じIDで結果を返す
   └─> {"type": "tool_result", "data": {"toolCallId": "adk-2b9230a6-...", "result": {...}}}

7. FrontendToolDelegateがFutureを解決
   └─> _pending_calls["adk-2b9230a6-..."].set_result(result)
```

Legend / 凡例:
- FunctionCall: ADKのツール呼び出しオブジェクト
- function_call.id: ADKが自動生成するユニークID
- ToolContext: ADKがツール関数に渡すコンテキストオブジェクト
- StreamProtocolConverter: ADKイベント→AI SDK v6形式の変換層
- FrontendToolDelegate: Frontend委譲を管理するクラス

---

### 📝 実装の証拠

**stream_protocol.py:445-455（ID取得部分）:**

```python
def _process_function_call(self, function_call: types.FunctionCall) -> list[str]:
    """Process function call into tool-input-* events (AI SDK v6 spec).

    Phase 4: If tool requires approval, also generate tool-approval-request event.
    """
    # ✅ ADKのfunction_call.idを使用（ADKが自動生成）
    if function_call.id:
        tool_call_id = function_call.id  # e.g., "adk-2b9230a6-..."
    else:
        # Fallback for cases where ADK doesn't provide ID
        tool_call_id = self._generate_tool_call_id()  # "call_0", "call_1", ...
        logger.warning(
            f"[FUNCTION CALL] function_call.id is None for tool '{function_call.name}', "
            f"using fallback ID: {tool_call_id}"
        )

    tool_name = function_call.name
    tool_args = function_call.args
    # ...
```

**重要なポイント:**
1. **Primary:** `function_call.id`を使用（ADKが生成）
2. **Fallback:** ADKがIDを提供しない場合のみ自前で生成（`self._generate_tool_call_id()`）
3. **実際には:** ADKは常にIDを提供するため、fallbackは実行されない

**server.py:274-278（ツール関数でID取得）:**

```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    # Get tool_call_id from ToolContext
    tool_call_id = tool_context.function_call_id  # ← ADK由来のID
    if not tool_call_id:
        error_msg = "Missing function_call_id in ToolContext"
        logger.error(f"[change_bgm] {error_msg}")
        return {"success": False, "error": error_msg}

    # Delegate execution to frontend and await result
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,  # ← ADK由来のIDを使用
        tool_name="change_bgm",
        args={"track": track},
    )
```

---

### ✅ なぜADK由来のIDが重要か

**1. 一貫性の保証:**
- ADKが管理する唯一のID
- Frontend-Backend間で同じIDを使用
- ツール呼び出し→結果のマッピングが確実

**2. 衝突の回避:**
- ADKが生成するため、グローバルにユニーク
- 複数セッション、複数ツール呼び出しでも衝突しない
- UUIDベースの生成（推測）

**3. トレーサビリティ:**
- ログでツール呼び出しを追跡可能
- デバッグ時にIDでフロー全体を追える
- E2Eテストでのアサーションが容易

**4. プロトコル準拠:**
- ADKのFunctionCall仕様に準拠
- AI SDK v6のtoolCallIdにマッピング
- 両プロトコル間の橋渡し

---

### 🔄 ID生成のタイミング

**ADK内部（推測）:**

```python
# ADK内部（実際のコードではない、推測）
class ADKRuntime:
    async def invoke_tool(self, tool_name: str, args: dict):
        # 1. FunctionCallオブジェクト生成
        function_call = FunctionCall(
            name=tool_name,
            args=args,
            id=self._generate_unique_id()  # ← ここでADKが生成！
        )

        # 2. ToolContextにIDを含める
        tool_context = ToolContext(
            function_call_id=function_call.id,  # ← IDを渡す
            state=session_state,
            # ...
        )

        # 3. ツール関数を実行
        result = await tool_function(args, tool_context=tool_context)

        return result
```

**我々の実装:**

```python
# server.py - ツール関数
async def change_bgm(track: int, tool_context: ToolContext) -> dict:
    # ToolContextからADK由来のIDを取得するだけ
    tool_call_id = tool_context.function_call_id  # ← 既に生成済み
    # ...
```

---

### 📊 ID形式の例

**ADK生成のID形式:**

```
adk-2b9230a6-8f4a-4e3b-9c1d-5a6b7c8d9e0f
adk-a1b2c3d4-e5f6-7890-abcd-ef1234567890
adk-12345678-1234-1234-1234-123456789abc
```

**特徴:**
- プレフィックス: `adk-`
- UUID v4形式（推測）
- 128-bit random number
- 衝突確率: ほぼゼロ

**Fallback ID形式（実際には使われない）:**

```python
# stream_protocol.py
def _generate_tool_call_id(self) -> str:
    """Generate fallback tool call ID (sequential)."""
    tool_call_id = f"call_{self.tool_call_id_counter}"
    self.tool_call_id_counter += 1
    return tool_call_id
```

**形式:**
```
call_0
call_1
call_2
```

**Fallbackが使われないことの確認:**

実際の運用では`function_call.id`は常に存在するため、fallbackコードは実行されません。これは以下で確認できます：
- ログに"function_call.id is None"のwarningが出ていない
- すべてのtool_call_idが`adk-`プレフィックスで始まる

---

### 🎯 設計の利点

**1. 責任分離（Separation of Concerns）:**

```
┌─────────────────────────────────────────────────┐
│ ADKの責任                                       │
├─────────────────────────────────────────────────┤
│ - ツール呼び出しの決定                         │
│ - ユニークIDの生成 ✅                          │
│ - ToolContextへのID注入                        │
│ - FunctionCallイベントの発行                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 我々の責任                                     │
├─────────────────────────────────────────────────┤
│ - ToolContext.function_call_idの取得           │
│ - Frontend委譲パターンの実装                   │
│ - IDを使ったFuture管理                         │
│ - AI SDK v6プロトコルへのマッピング            │
└─────────────────────────────────────────────────┘
```

**2. IDライフサイクル管理:**

```
ADK生成 → ToolContext → ツール関数 → StreamProtocol → Frontend → WebSocket → FrontendDelegate → Future解決
   ↑                                                                                              ↓
   └──────────────────────────────────────────────────────────────────────────────────────────────┘
   同じIDがフロー全体を通して使用される
```

**3. デバッグの容易性:**

```bash
# ログ例（同じIDでフロー全体を追跡）
[Tool] change_bgm called with tool_call_id=adk-2b9230a6-...
[StreamProtocol] Sending tool-input-start: toolCallId=adk-2b9230a6-...
[WebSocket] Sent tool-approval-request: approvalId=approval_0, toolCallId=adk-2b9230a6-...
[Frontend] Received tool-approval-request for adk-2b9230a6-...
[Frontend] User approved tool adk-2b9230a6-...
[WebSocket] Received tool_result for adk-2b9230a6-...
[FrontendDelegate] Resolving tool_call_id=adk-2b9230a6-...
[Tool] change_bgm result for adk-2b9230a6-...: {success: true}
```

---

### 🔍 関連調査

**experiments/2025-12-13_toolCallId_compatibility_investigation.md:**

このexperimentで、以下を確認しました：
- ADKが`function_call.id`を自動生成すること
- `ToolContext.function_call_id`で取得可能なこと
- AI SDK v6の`toolCallId`とマッピング可能なこと

**重要な発見:**
```python
# ADKの仕様（確認済み）
class ToolContext:
    @property
    def function_call_id(self) -> str:
        """The unique ID for this function call, generated by ADK."""
        return self._function_call.id
```

---

### ❌ 誤った認識（過去）

**当初の懸念:**

> ❌ "tool_call_idを自前で生成する必要がある"
> ❌ "ToolContextからIDを取得できない"
> ❌ "Frontend-Backend間でID同期が困難"

**実際:**

> ✅ ADKが自動生成（UUIDベース）
> ✅ ToolContext.function_call_idで取得可能
> ✅ 同じIDがフロー全体で使用される

**before_tool_callbackパターンでの問題:**

```python
# ❌ 旧パターン（IDの取得が困難）
def client_side_tool_interceptor(...):
    # tool_call_idをどこから取得する？
    # ToolContextにアクセスできない！
    return {"_client_side": True}
```

**FrontendToolDelegateパターンの解決:**

```python
# ✅ 新パターン（ToolContextからID取得）
async def change_bgm(track: int, tool_context: ToolContext):
    tool_call_id = tool_context.function_call_id  # ← 簡単！
    result = await delegate.execute_on_frontend(tool_call_id=tool_call_id, ...)
    return result
```

---

### まとめ

**Q: tool_call_idの採番（ID付与）はADK由来ですか？**

**A: はい、ADK由来です。**

**ID生成の責任:**
- ✅ **ADK**: `function_call.id`を自動生成（UUID v4形式）
- ✅ **ToolContext**: `function_call_id`プロパティで提供
- ✅ **ツール関数**: `tool_context.function_call_id`で取得

**設計の利点:**
1. ✅ グローバルにユニークなID
2. ✅ 責任分離（ADKがID管理）
3. ✅ フロー全体で同じIDを使用
4. ✅ デバッグ・トレーサビリティの向上

**実装のシンプルさ:**
```python
# これだけ！
tool_call_id = tool_context.function_call_id
```

**関連リソース:**
- `stream_protocol.py:445-455` - ADK IDの取得とfallback処理
- `server.py:274, 312` - ToolContext.function_call_idの使用
- `tool_delegate.py` - tool_call_idを使ったFuture管理
- `experiments/2025-12-13_toolCallId_compatibility_investigation.md` - 調査ノート

---

## Q8: Tool Approvalの完全なアーキテクチャを教えてください

**A:**

はい、以下が**完全なTool Approvalアーキテクチャ**です。Frontend（AI SDK v6）とBackend（ADK + FrontendToolDelegate）の役割分担が明確です。

### 🎯 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (useChat + AI SDK v6)                             │
├─────────────────────────────────────────────────────────────┤
│ 1. tool-approval-request イベント受信（useChatが自動処理） │
│    └─> messages配列に自動追加                              │
│    └─> pendingToolApproval = derived state                 │
│                                                             │
│ 2. UI: 承認ダイアログ表示                                  │
│    └─> User clicks "Approve" or "Deny"                     │
│                                                             │
│ 3. addToolApprovalResponse({ id, approved })               │
│    └─> AI SDK v6が tool-approval-response を送信          │
│                                                             │
│ 4. ブラウザAPIを実行（change_bgm, get_locationなど）       │
│                                                             │
│ 5. addToolOutput({ tool, toolCallId, output })             │
│    └─> AI SDK v6が tool-result イベントを送信             │
│                                                             │
│ 6. sendAutomaticallyWhen 条件チェック ✅                   │
│    └─> 自動的に transport.sendMessages() 呼び出し         │
└─────────────────────────────────────────────────────────────┘
         ↓ WebSocket (Data Stream Protocol)
┌─────────────────────────────────────────────────────────────┐
│ Backend (server.py + tool_delegate.py)                     │
├─────────────────────────────────────────────────────────────┤
│ 1. Tool関数がFrontendに委譲                                │
│    └─> await delegate.execute_on_frontend(tool_call_id)   │
│                                                             │
│ 2. StreamProtocolがtool-approval-requestを送信             │
│    └─> WebSocket経由でFrontendへ                           │
│                                                             │
│ 3. FrontendToolDelegate: Futureを作成してawait             │
│    └─> _pending_calls[tool_call_id] = future              │
│    └─> result = await future  ← ここでブロック             │
│                                                             │
│ 4. WebSocketハンドラー: tool_resultイベント受信            │
│    └─> delegate.resolve_tool_result(tool_call_id, result) │
│                                                             │
│ 5. Future解決 → Tool関数のawait解除                        │
│    └─> return result  ← 実際の結果を返す                  │
└─────────────────────────────────────────────────────────────┘
```

Legend / 凡例:
- tool-approval-request: ツール承認要求イベント（Backend → Frontend）
- addToolApprovalResponse: AI SDK v6のツール承認応答API
- addToolOutput: AI SDK v6のツール結果送信API
- tool-result: ツール実行結果イベント（Frontend → Backend）
- sendAutomaticallyWhen: AI SDK v6の自動メッセージ送信機能
- FrontendToolDelegate: Frontend委譲を管理するクラス
- Future: asyncio.Futureを使ったPromise的パターン

---

### ✅ あなたの理解は正しいです

**1. Frontend (useChat):**
```typescript
const {
  messages,
  sendMessage,
  status,
  error,
  addToolOutput,          // ✅ ツール結果を送信
  addToolApprovalResponse // ✅ 承認/拒否を送信
} = useChat(useChatOptions);
```

**2. Backend (server.py):**
```python
# FrontendToolDelegate が await で待ち受け
result = await delegate.execute_on_frontend(
    tool_call_id=tool_call_id,
    tool_name="change_bgm",
    args={"track": track}
)  # ← Frontendからの結果を await
```

**3. onToolCall が不要な理由:**
- ✅ onToolCall = **クライアント側ローカル実行用**
- ✅ 今回は **Backend が tool call を知っている**
- ✅ tool-call イベントは **Backend から来る**
- ✅ Frontend は **実行だけを担当**（決定権はBackendにある）

---

### 📝 完全な実装フロー

**Step 1: Backend Tool関数がFrontendに委譲**

```python
# server.py:254-290
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    tool_call_id = tool_context.function_call_id

    # ✅ Step 1: Frontendに委譲してawait（ブロック）
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )

    return result  # ← Step 8で解除される
```

**Step 2: FrontendToolDelegate がFutureを作成**

```python
# tool_delegate.py:24-38
async def execute_on_frontend(
    self, tool_call_id: str, tool_name: str, args: dict[str, Any]
) -> dict[str, Any]:
    # ✅ Step 2: Futureを作成
    future: asyncio.Future[dict[str, Any]] = asyncio.Future()
    self._pending_calls[tool_call_id] = future

    logger.info(f"[FrontendDelegate] Awaiting result for tool_call_id={tool_call_id}")

    # ✅ Step 3: await（Frontendからの結果を待つ）
    result = await future  # ← ここでブロック

    return result
```

**Step 3: StreamProtocol が tool-approval-request を送信**

```python
# stream_protocol.py:486-500
# tool-approval-request event を生成
approval_id = f"approval_{self.approval_id_counter}"
self.approval_id_counter += 1

# Frontend → Backend のマッピングを保存
self.pending_approvals[approval_id] = tool_call_id

# ✅ Step 3: AI SDK v6形式のイベント送信
approval_event = f"event: tool-approval-request\ndata: {json.dumps({
    'type': 'tool-approval-request',
    'approvalId': approval_id,
    'toolCallId': tool_call_id
})}\n\n"
events.append(approval_event)
```

**Step 4: Frontend useChatが自動的にイベントを処理**

```typescript
// AI SDK v6内部（自動処理）
// useChat hookが tool-approval-request を受信
// messages配列に自動追加
// pendingToolApproval = derived state として計算される
```

**Step 5: UI が承認ダイアログを表示**

```typescript
// components/chat.tsx:249-262
{pendingToolApproval && (
  <div className="tool-approval-dialog">
    <h3>Tool Approval Required</h3>
    <p>Tool: {pendingToolApproval.toolName}</p>
    <p>Args: {JSON.stringify(pendingToolApproval.args)}</p>
    <button onClick={handleApproveTools}>Approve</button>
    <button onClick={handleRejectTool}>Deny</button>
  </div>
)}
```

**Step 6: User が承認 → addToolApprovalResponse()**

```typescript
// components/chat.tsx:92-101
const handleApproveTools = useCallback(async () => {
  if (!pendingToolApproval || !addToolOutput) return;

  console.log("[Chat] User approved tool:", pendingToolApproval);

  // ✅ Step 6a: 承認を送信（AI SDK v6標準API）
  addToolApprovalResponse?.({
    id: pendingToolApproval.approvalId,
    approved: true,
  });

  // ... ブラウザAPI実行 ...
}, [pendingToolApproval, addToolApprovalResponse, addToolOutput]);
```

**Step 7: ブラウザAPIを実行 → addToolOutput()**

```typescript
// components/chat.tsx:103-177
// Execute browser API based on tool name
if (pendingToolApproval.toolName === "change_bgm") {
  const track = pendingToolApproval.args?.track ?? 0;
  result = {
    success: true,
    message: `BGM changed to track ${track}`,
    current_track: track,
  };

  // AudioContext API実行
  if (audioContext?.isReady) {
    audioContext.voiceChannel.sendChunk({
      content: btoa(String.fromCharCode(...new Uint8Array([/* ... */]))),
      sampleRate: 24000,
      channels: 1,
      bitDepth: 16,
    });
  }
}

console.log("[Chat] Tool execution result:", result);

// ✅ Step 7: 結果を送信（AI SDK v6標準API）
addToolOutput({
  tool: pendingToolApproval.toolName || "unknown",
  toolCallId: pendingToolApproval.toolCallId,
  output: result,
});
```

**Step 8: AI SDK v6 が sendAutomaticallyWhen をチェック**

```typescript
// AI SDK v6内部（自動処理）
// addToolOutput()が呼ばれた後

// 1. messages配列を更新
// 2. sendAutomaticallyWhen() を呼び出し
//    └─> lastAssistantMessageIsCompleteWithApprovalResponses(options)
//    └─> すべてのツールが完了していればtrue
// 3. trueなら自動的に transport.sendMessages() を呼ぶ
```

**Step 9: Backend WebSocket Handler が tool_result を受信**

```python
# server.py:1042-1053
elif event_type == "tool_result":
    result_data = event.get("data", {})
    tool_call_id = result_data.get("toolCallId")
    result = result_data.get("result")

    logger.info(f"[Tool] Received result for {tool_call_id}")

    # ✅ Step 9: FutureをResolve
    # Connection-specific delegate lookup
    delegate = connection_states.get(connection_signature, {}).get("delegate")
    if delegate:
        delegate.resolve_tool_result(tool_call_id, result)
    else:
        # Fallback to global delegate (for SSE mode)
        frontend_delegate.resolve_tool_result(tool_call_id, result)
```

**Step 10: Future解決 → Tool関数のawait解除**

```python
# tool_delegate.py:40-47
def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
    """Called by WebSocket handler when frontend sends tool result."""
    if tool_call_id in self._pending_calls:
        logger.info(f"[FrontendDelegate] Resolving tool_call_id={tool_call_id}")

        # ✅ Step 10: Futureを解決
        self._pending_calls[tool_call_id].set_result(result)
        del self._pending_calls[tool_call_id]
    else:
        logger.warning(f"[FrontendDelegate] Unknown tool_call_id={tool_call_id}")
```

**Step 11: Tool関数が実際の結果を返す**

```python
# server.py:254-290 (続き)
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    # ...
    result = await delegate.execute_on_frontend(...)  # ← ここでawait解除！

    logger.info(f"[change_bgm] result={result}")
    return result  # ✅ Step 11: 実際の結果をAIに返す
```

---

### 🔍 重要なポイント

**1. onToolCall が不要な理由**

```typescript
// ❌ onToolCall パターン（使用しない）
const { messages } = useChat({
  onToolCall: async (toolCall) => {
    // クライアント側でツールを実行
    const result = await executeLocalTool(toolCall);
    return result;
  }
});
```

**なぜ不要？**
- onToolCall = **Frontendがツール実行の決定権を持つ**
- 今回 = **Backendがツール実行の決定権を持つ**
- tool-approval-request = **BackendからFrontendへの委譲要求**
- Frontend = **実行のみを担当**（承認UI + ブラウザAPI）

**2. tool-approval-request イベントの自動処理**

```typescript
// AI SDK v6 が自動的に処理（コード不要）
// 1. tool-approval-request を受信
// 2. messages配列に追加
// 3. pendingToolApproval を計算（derived state）
```

**我々がやること:**
```typescript
// messages から pending approval を検出
const pendingToolApproval = useMemo(() => {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role !== "assistant") return null;

  const approvalRequest = lastMessage.parts.find(
    (part) => part.type === "approval-requested"
  );
  return approvalRequest ? {
    approvalId: approvalRequest.approvalId,
    toolCallId: approvalRequest.toolCall.toolCallId,
    toolName: approvalRequest.toolCall.toolName,
    args: approvalRequest.toolCall.args,
  } : null;
}, [messages]);
```

**3. sendAutomaticallyWhen による自動送信**

```typescript
// lib/build-use-chat-options.ts:249-250, 273-274
const adkSseOptions = {
  transport: adkSseTransport,
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};
```

**動作:**
- addToolOutput() 呼び出し後
- AI SDK v6 が自動的に条件チェック
- true なら transport.sendMessages() を呼ぶ
- **手動で sendMessage() する必要なし**

---

### 📊 データフロー図

```
┌────────────────────────────────────────────────────────────────┐
│ Frontend                                                       │
├────────────────────────────────────────────────────────────────┤
│ useChat() messages配列                                         │
│   ↓                                                            │
│ pendingToolApproval = derived state                            │
│   ↓                                                            │
│ UI: 承認ダイアログ表示                                         │
│   ↓ (User clicks "Approve")                                   │
│ addToolApprovalResponse({ id, approved: true })                │
│   ↓ (AI SDK v6 sends tool-approval-response)                  │
│ ブラウザAPI実行 (AudioContext, Geolocation, etc.)              │
│   ↓                                                            │
│ addToolOutput({ tool, toolCallId, output })                    │
│   ↓ (AI SDK v6 sends tool-result)                             │
│ sendAutomaticallyWhen() → true                                 │
│   ↓                                                            │
│ transport.sendMessages() 自動呼び出し                          │
└────────────────────────────────────────────────────────────────┘
         ↓ WebSocket (tool-result event)
┌────────────────────────────────────────────────────────────────┐
│ Backend                                                        │
├────────────────────────────────────────────────────────────────┤
│ WebSocket Handler: tool_result受信                            │
│   ↓                                                            │
│ delegate.resolve_tool_result(tool_call_id, result)            │
│   ↓                                                            │
│ future.set_result(result)                                      │
│   ↓                                                            │
│ Tool関数の await 解除                                          │
│   ↓                                                            │
│ return result ← AIに返す                                       │
└────────────────────────────────────────────────────────────────┘
```

---

### ✅ 実装の方向性（あなたの理解）

**あなたの理解:**
> useChat() に addToolOutput と addToolApprovalResponse を追加：
> そして、useToolExecutor を修正して：
> 1. Tool call イベントを受信（現在の toolCallCallback 経由）
> 2. 承認UI表示
> 3. 承認されたら addToolApprovalResponse()
> 4. ブラウザAPI実行
> 5. addToolOutput() で結果送信

**実装の現実:**
1. ✅ useChat() に addToolOutput と addToolApprovalResponse を追加 **← 既に実装済み**
2. ✅ Tool call イベントを受信 **← useChatが自動処理、pendingToolApprovalで検出**
3. ✅ 承認UI表示 **← components/chat.tsx で実装済み**
4. ✅ 承認されたら addToolApprovalResponse() **← handleApproveToolsで実装済み**
5. ✅ ブラウザAPI実行 **← handleApproveToolsで実装済み**
6. ✅ addToolOutput() で結果送信 **← handleApproveToolsで実装済み**

**useToolExecutor は不要:**
- すべて components/chat.tsx で直接実装済み
- useCallback フックを使用
- pendingToolApproval を derived state として計算

---

### まとめ

**Q: Tool Approvalの完全なアーキテクチャは？**

**A: 以下の通りです。**

**Frontend責任:**
1. ✅ tool-approval-request を受信（useChatが自動処理）
2. ✅ 承認UIを表示
3. ✅ addToolApprovalResponse() で承認/拒否を送信
4. ✅ ブラウザAPIを実行（change_bgm, get_location）
5. ✅ addToolOutput() で結果を送信
6. ✅ sendAutomaticallyWhen により自動再送信

**Backend責任:**
1. ✅ Tool関数でFrontendに委譲
2. ✅ FrontendToolDelegate で Future管理
3. ✅ tool-approval-request を送信
4. ✅ tool_result を受信
5. ✅ Future解決 → Tool関数のawait解除
6. ✅ 実際の結果をAIに返す

**onToolCallが不要な理由:**
- ✅ Backendがツール実行の決定権を持つ
- ✅ Frontendは実行のみを担当
- ✅ tool-approval-request = Backend → Frontend の委譲要求

**あなたの理解:**
- ✅ **完全に正しいです**
- ✅ 既に components/chat.tsx で実装済み
- ✅ useToolExecutor は不要（直接実装の方がシンプル）

**関連リソース:**
- TEMP_FAQ.md Q3 - Tool approval Step 7の詳細
- TEMP_FAQ.md Q6 - AP2との設計思想の一致
- `components/chat.tsx:92-224` - Tool approval実装
- `server.py:1042-1053` - WebSocket handler
- `tool_delegate.py` - FrontendToolDelegate実装

---

## Q9: AI SDK v6のuseChatを使う方が正統的なアプローチですか？BIDIモードでもSSEモードでも同じように扱えますか？

**A:**

はい、**AI SDK v6のuseChatを使う方が正統的**で、それを採用しています。そして**BIDIモードでもSSEモードでも完全に同じように扱えます**。

**重要な訂正:** 過去のやり取りで言及されていた「toolCallCallback」や「onToolCall」は**既に削除済み**で、現在は**AI SDK v6の標準パターンのみ**を使用しています。

### 🎯 現在の実装（AI SDK v6標準パターン）

**components/chat.tsx:31-38:**

```typescript
const {
  messages,
  sendMessage,
  status,
  error,
  addToolOutput,          // ✅ AI SDK v6標準API
  addToolApprovalResponse // ✅ AI SDK v6標準API
} = useChat(useChatOptions);

// ❌ onToolCall は使っていない
// ❌ toolCallCallback も使っていない
// ❌ onToolApprovalRequest も削除済み
```

**理由:**
- ✅ AI SDK v6が tool-approval-request を**ネイティブサポート**
- ✅ カスタムコールバックは**不要**（フレームワークが処理）
- ✅ BIDIモードでもSSEモードでも**同じコード**

---

### ❌ 過去の誤ったアプローチ（削除済み）

**旧実装（experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md で削除）:**

```typescript
// ❌ カスタムコールバック（削除済み）
export interface WebSocketChatTransportConfig {
  url: string;
  onToolApprovalRequest?: (approval: {  // ← 削除！
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    args?: any;
  }) => void;
}

// ❌ イベントフィルタリング（削除済み）
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    this.config.onToolApprovalRequest({...});
  }
  return true; // ← イベントをuseChatに流さない（BUG!）
}
```

**問題点:**
1. ❌ AI SDK v6のネイティブ機能を無視
2. ❌ tool-approval-requestイベントをフィルタリング（useChatに届かない）
3. ❌ カスタムコールバック機構を自前で実装
4. ❌ BIDIモード専用の実装（SSEモードで使えない）

---

### ✅ 現在のアプローチ（AI SDK v6標準）

**1. Transport層は透過的**

```typescript
// lib/build-use-chat-options.ts:249-274
// SSEモード
const adkSseOptions = {
  transport: adkSseTransport,  // ← DefaultChatTransport
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};

// BIDIモード
const adkBidiOptions = {
  transport: websocketTransport,  // ← WebSocketChatTransport
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
};
```

**重要:**
- どちらも**同じ AI SDK v6 Data Stream Protocol**
- どちらも**同じ sendAutomaticallyWhen**
- Frontendコードは**完全に同じ**

---

**2. useChatフックは統一**

```typescript
// components/chat.tsx
// BIDIモードでもSSEモードでも同じコード！
const {
  messages,
  sendMessage,
  status,
  error,
  addToolOutput,
  addToolApprovalResponse
} = useChat(useChatOptions);

// Tool approval処理（BIDIでもSSEでも同じ）
const handleApproveTools = useCallback(async () => {
  // 1. 承認を送信
  addToolApprovalResponse?.({
    id: pendingToolApproval.approvalId,
    approved: true,
  });

  // 2. ブラウザAPI実行
  const result = executeBrowserAPI(pendingToolApproval);

  // 3. 結果を送信
  addToolOutput({
    tool: pendingToolApproval.toolName,
    toolCallId: pendingToolApproval.toolCallId,
    output: result,
  });
}, [pendingToolApproval, addToolApprovalResponse, addToolOutput]);
```

**ポイント:**
- ✅ BIDIモードでもSSEモードでも**完全に同じコード**
- ✅ Transport層の違いは**透過的**
- ✅ AI SDK v6の標準APIのみ使用

---

### 🔍 onToolCallを使わない理由

**過去のやり取りで言及されていたonToolCallパターン:**

```typescript
// ❌ これは使っていない
const { messages, addToolOutput, addToolApprovalResponse } = useChat({
  async onToolCall({ toolCall }) {
    // クライアントサイドツールの実行
    if (toolCall.toolName === 'change_bgm') {
      const { track } = toolCall.input;
      audioContext.switchTrack(track);

      addToolOutput({
        tool: 'change_bgm',
        toolCallId: toolCall.toolCallId,
        output: { success: true, track }
      });
    }
  }
});
```

**なぜ使わないのか？**

| 要素 | onToolCallパターン | 我々の実装 |
|------|-------------------|-----------|
| ツール実行の決定権 | **Frontend** | **Backend** |
| ツール定義の場所 | Frontend | Backend (server.py) |
| 承認UI | 不要（自動実行） | **必要**（TOOLS_REQUIRING_APPROVAL） |
| 適用シナリオ | クライアント側ローカルツール | **ブラウザAPI + Backend判断** |
| AIの認識 | Frontendで勝手に実行 | **Backendが承認要求を送信** |

**我々のシナリオ:**
1. ✅ **Backend** がツール実行を決定（AIがBackendで判断）
2. ✅ **Backend** が tool-approval-request を送信
3. ✅ **Frontend** はBackendからの委譲要求に応答
4. ✅ **User** が承認/拒否を判断
5. ✅ **Frontend** がブラウザAPIを実行
6. ✅ **Backend** が結果を受け取り、AIに返す

**onToolCallパターンのシナリオ:**
1. ❌ **Frontend** がツール実行を決定（AIの判断なし）
2. ❌ ユーザー承認なし（自動実行）
3. ❌ Backendは関与しない

---

### 📊 BIDIモードとSSEモードの統一性

**完全に同じコード:**

```typescript
// Frontendコード（BIDIでもSSEでも同じ）
const { messages, addToolOutput, addToolApprovalResponse } = useChat(useChatOptions);

// 1. tool-approval-request を受信（useChatが自動処理）
// 2. pendingToolApproval = derived state
const pendingToolApproval = useMemo(() => {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role !== "assistant") return null;

  const approvalRequest = lastMessage.parts.find(
    (part) => part.type === "approval-requested"
  );
  return approvalRequest ? { ... } : null;
}, [messages]);

// 3. 承認ハンドラー（BIDIでもSSEでも同じ）
const handleApproveTools = useCallback(async () => {
  addToolApprovalResponse?.({ id: pendingToolApproval.approvalId, approved: true });
  const result = executeBrowserAPI(pendingToolApproval);
  addToolOutput({ tool, toolCallId, output: result });
}, [pendingToolApproval, addToolApprovalResponse, addToolOutput]);
```

**Transport層の違い:**

```
┌────────────────────────────────────────────────────────────┐
│ SSEモード: DefaultChatTransport                            │
├────────────────────────────────────────────────────────────┤
│ Frontend → HTTP POST /api/chat → Backend                  │
│ Backend → HTTP SSE stream → Frontend                      │
│                                                            │
│ tool-approval-request → SSE event                         │
│ tool-result → HTTP POST body                              │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ BIDIモード: WebSocketChatTransport                         │
├────────────────────────────────────────────────────────────┤
│ Frontend ⇄ WebSocket /live ⇄ Backend                      │
│                                                            │
│ tool-approval-request → WebSocket message (SSE format)    │
│ tool-result → WebSocket message                           │
└────────────────────────────────────────────────────────────┘
```

**重要:**
- どちらも **AI SDK v6 Data Stream Protocol** を使用
- SSE format over WebSocket（BIDIモード）
- Frontendコードは**完全に同じ**

---

### ✅ なぜAI SDK v6標準パターンが正統的か

**1. フレームワーク統合:**
- ✅ AI SDK v6のネイティブ機能を使用
- ✅ カスタム実装不要
- ✅ 将来のアップデートに追従しやすい

**2. コードの保守性:**
- ✅ BIDIモードでもSSEモードでも同じコード
- ✅ Transport層の違いは透過的
- ✅ useChat APIの標準的な使い方

**3. プロトコル準拠:**
- ✅ AI SDK v6 Data Stream Protocol
- ✅ tool-approval-request/response イベント
- ✅ addToolApprovalResponse/addToolOutput API

**4. コミュニティサポート:**
- ✅ 公式ドキュメントに従った実装
- ✅ 他の開発者が理解しやすい
- ✅ トラブルシューティングが容易

---

### 🔄 削除したカスタム実装

**experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md の調査結果:**

**削除したもの:**
1. ❌ `onToolApprovalRequest` カスタムコールバック
2. ❌ tool-approval-request イベントのフィルタリング
3. ❌ カスタムコールバック関連のテストコード
4. ❌ BIDIモード専用の実装

**移行先:**
1. ✅ AI SDK v6の `addToolApprovalResponse()`
2. ✅ tool-approval-request を useChat に流す
3. ✅ AI SDK v6標準のテストパターン
4. ✅ BIDIモードでもSSEモードでも同じ実装

**Commit:**
- `d62dfdf` - refactor: Use AI SDK v6 standard message-based tool approval flow

---

### 📝 実装の証拠

**1. カスタムコールバックの削除:**

```typescript
// lib/websocket-chat-transport.ts
// ❌ Before (削除済み)
export interface WebSocketChatTransportConfig {
  url: string;
  onToolApprovalRequest?: (approval: {...}) => void;  // ← 削除！
}

// ✅ After (現在)
export interface WebSocketChatTransportConfig {
  url: string;
  timeout?: number;
  audioContext?: AudioContextValue;
  latencyCallback?: (latency: number) => void;
}
```

**2. イベントフィルタリングの削除:**

```typescript
// lib/websocket-chat-transport.ts
// ❌ Before (削除済み)
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    this.config.onToolApprovalRequest({...});
  }
  return true; // ← イベントをブロック（BUG!）
}

// ✅ After (現在)
// AI SDK v6 handles tool-approval-request natively via UIMessageChunk stream
// No special handling needed - just let it flow through to useChat
```

**3. AI SDK v6標準APIの使用:**

```typescript
// components/chat.tsx:31-38
const {
  messages,
  sendMessage,
  status,
  error,
  addToolOutput,          // ✅ 標準API
  addToolApprovalResponse // ✅ 標準API
} = useChat(useChatOptions);
```

---

### まとめ

**Q: AI SDK v6のuseChatを使う方が正統的なアプローチですか？BIDIモードでもSSEモードでも同じように扱えますか？**

**A: はい、両方ともYESです。**

**AI SDK v6標準パターンを採用:**
1. ✅ `addToolApprovalResponse()` - 承認/拒否を送信
2. ✅ `addToolOutput()` - 結果を送信
3. ✅ tool-approval-request を useChat に流す
4. ✅ カスタムコールバック不要

**BIDIモードでもSSEモードでも同じ:**
1. ✅ 同じ `useChat` フック
2. ✅ 同じ `addToolApprovalResponse/addToolOutput`
3. ✅ 同じ Frontend コード
4. ✅ Transport層の違いは透過的

**onToolCallを使わない理由:**
- ✅ Backend がツール実行の決定権を持つ
- ✅ User承認が必要（TOOLS_REQUIRING_APPROVAL）
- ✅ tool-approval-request = Backend → Frontend の委譲要求

**削除したカスタム実装:**
- ❌ onToolApprovalRequest コールバック
- ❌ toolCallCallback
- ❌ イベントフィルタリング

**関連リソース:**
- `experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md` - カスタム実装削除の調査
- `components/chat.tsx:31-38` - AI SDK v6標準API使用
- `lib/websocket-chat-transport.ts` - カスタムコールバック削除済み
- Commit `d62dfdf` - AI SDK v6標準パターンへの移行

---

## Q10: 全てのFrontendで必要なtool系は移譲型になる理解であっているか？

**A: はい、完全に正しい理解です。**

### 設計原則

**Toolの実行場所は「実行に必要なAPIがどこにあるか」で決まります:**

```
Browser API が必要 → Frontend 実行 → 移譲型（FrontendToolDelegate）
Server-side API が必要 → Backend 実行 → 非移譲型（直接実行）
```

### 具体例

**Frontend実行が必須のtool（Browser APIが必要）:**

```python
# server.py:333
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}
```

**1. change_bgm - AudioContext API（ブラウザ専用）**

```python
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    """
    AudioContext APIはブラウザでしか使えない
    → Frontendに移譲する必要がある
    """
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    tool_call_id = tool_context.function_call_id

    # Frontendに実行を委譲
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="change_bgm",
        args={"track": track},
    )
    return result
```

**なぜFrontend実行が必須か:**
- AudioContext API は Web Audio API の一部
- ブラウザのJavaScript環境でのみ利用可能
- Python/Backend では実行不可能

**2. get_location - Geolocation API（ブラウザ専用）**

```python
async def get_location(tool_context: ToolContext) -> dict[str, Any]:
    """
    navigator.geolocation APIはブラウザでしか使えない
    → Frontendに移譲する必要がある
    """
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    tool_call_id = tool_context.function_call_id

    # Frontendに実行を委譲
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_call_id,
        tool_name="get_location",
        args={},
    )
    return result
```

**なぜFrontend実行が必須か:**
- navigator.geolocation は Browser Geolocation API
- ユーザーの位置情報はブラウザが管理
- ユーザー許可プロンプトもブラウザが表示
- Python/Backend では実行不可能

---

**Backend実行が可能なtool（Server-side APIで完結）:**

```python
async def get_weather(location: str) -> dict[str, Any]:
    """
    HTTP APIを直接呼び出し、Frontendには委譲しない
    """
    url = f"https://api.openweathermap.org/data/2.5/weather?q={location}&appid={api_key}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            data = await response.json()
            return {
                "location": location,
                "temperature": data["main"]["temp"],
                "description": data["weather"][0]["description"],
            }
```

**なぜBackend実行が可能か:**
- HTTP API呼び出しは Python で実行可能
- Browser API は不要
- Frontend に委譲する必要がない

---

### 過去のやり取りで指摘された本質

**ユーザーの指摘（引用）:**

> このtoolが影響を与える対象はbackendではなくfrontendです。
>
> 音が流れていて、それが切り替わる/切り替えるのはユーザの手元のブラウザです
> 地点情報を取得するbrowser location apiを使うのはユーザの手元のブラウザで、使うときには厳密にはブラウザ内部のok/ngのウィンドウも出ますよね。
>
> つまり、ADK のAIが今回のapprovalを投げかける意味は、これからあなたの手元のブラウザのこの機能を使いたいのだけどいいかな？と言う「ツールを使うことの許可」を求め、「ツールを使う」のはbackendの内部処理ではなく、「ツールを使った結果」がbackendが欲するものだよね。

**この指摘が示す設計原則:**

1. **「ツールが影響を与える対象」で実行場所が決まる**
   - 影響対象 = Frontend（ブラウザ） → Frontend実行
   - 影響対象 = Backend（サーバー） → Backend実行

2. **「ツールを使う場所」と「結果を使う場所」は異なる**
   - ツールを使う場所: Frontend（Browser API実行）
   - 結果を使う場所: Backend（ADK AIが結果を受け取る）

3. **Approval の本当の意味**
   - 「これからあなたの手元のブラウザのこの機能を使いたいのだけどいいかな？」
   - = Browser API を使う許可を求めている
   - = Frontend で実行することの許可

---

### TOOLS_REQUIRING_APPROVAL の本質

**名前の表面的な意味:**
- "Approval が必要な Tool のリスト"

**実際の本質:**
- "Frontend 実行が必要な Tool のリスト"
- = "Browser API を使う Tool のリスト"
- = "Backend では実行不可能な Tool のリスト"

**つまり:**

```python
# 表面的な名前
TOOLS_REQUIRING_APPROVAL = {"change_bgm", "get_location"}

# 本質的な意味
TOOLS_REQUIRING_FRONTEND_EXECUTION = {"change_bgm", "get_location"}
# または
TOOLS_USING_BROWSER_API = {"change_bgm", "get_location"}
```

**なぜ Approval という名前か:**
- Browser API を使う = ユーザーのプライバシー/体験に影響
- 例: Geolocation API → ユーザー位置情報（プライバシー）
- 例: AudioContext API → ブラウザの音声出力（体験）
- そのため、使用前にユーザーの許可（Approval）を求める

---

### 一般化: 全ての Frontend 必須 tool は移譲型

**命題:**
「全ての Frontend で必要な tool 系は移譲型になる」

**証明:**

1. **前提:** Tool が "Frontend で必要" = Tool が "Browser API を使う"

2. **Browser API は Backend では実行不可能** (技術的制約)
   - navigator.geolocation → Python には存在しない
   - AudioContext → Python には存在しない
   - localStorage, IndexedDB, Canvas, WebGL... → 全て Browser 専用

3. **Backend で実行不可能 → Frontend に実行を委譲する必要がある**

4. **Frontend に委譲 = FrontendToolDelegate pattern を使用**

5. **結論: 全ての Frontend で必要な tool は移譲型になる** ✅

**逆の命題も真:**
「全ての Backend で実行可能な tool は非移譲型になる」

---

### 将来の拡張例

**現在実装されていないが、同じパターンが適用される tool:**

**1. ファイルアップロード tool (File API)**
```python
async def upload_file(tool_context: ToolContext) -> dict[str, Any]:
    # FileReader API はブラウザでしか使えない
    # → Frontend に移譲
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_context.function_call_id,
        tool_name="upload_file",
        args={},
    )
    return result
```

**2. カメラ/マイク tool (MediaDevices API)**
```python
async def take_photo(tool_context: ToolContext) -> dict[str, Any]:
    # navigator.mediaDevices.getUserMedia() はブラウザでしか使えない
    # → Frontend に移譲
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_context.function_call_id,
        tool_name="take_photo",
        args={},
    )
    return result
```

**3. localStorage/IndexedDB tool (Web Storage API)**
```python
async def save_to_storage(key: str, value: str, tool_context: ToolContext) -> dict[str, Any]:
    # localStorage はブラウザでしか使えない
    # → Frontend に委譲
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    result = await delegate.execute_on_frontend(
        tool_call_id=tool_context.function_call_id,
        tool_name="save_to_storage",
        args={"key": key, "value": value},
    )
    return result
```

**これら全て同じパターン:**
- Browser API が必要
- Backend では実行不可能
- Frontend に移譲が必須
- TOOLS_REQUIRING_APPROVAL に追加

---

### まとめ

**Q: 全ての Frontend で必要な tool 系は移譲型になる理解であっているか？**

**A: はい、完全に正しい理解です。**

**理由:**

1. ✅ **Frontend で必要 = Browser API が必要**
2. ✅ **Browser API が必要 = Backend では実行不可能**（技術的制約）
3. ✅ **Backend では実行不可能 = Frontend に移譲が必須**
4. ✅ **Frontend に移譲 = FrontendToolDelegate pattern 使用**
5. ✅ **結論: Frontend 必須 tool は全て移譲型**

**設計原則:**
- Tool の実行場所は「必要な API がどこにあるか」で決まる
- Browser API 必要 → Frontend 実行 → 移譲型
- Server-side API で完結 → Backend 実行 → 非移譲型

**現在の実装:**
- change_bgm: AudioContext API → Frontend 移譲
- get_location: Geolocation API → Frontend 移譲
- get_weather: HTTP API → Backend 実行（移譲不要）

**TOOLS_REQUIRING_APPROVAL の本質:**
- 名前: "Approval が必要な Tool"
- 本質: "Frontend 実行が必要な Tool" = "Browser API を使う Tool"

**関連リソース:**
- `server.py:333` - TOOLS_REQUIRING_APPROVAL 定義
- `server.py:254-290` - change_bgm 実装（Frontend 移譲）
- `server.py:293-328` - get_location 実装（Frontend 移譲）
- `server.py:131-210` - get_weather 実装（Backend 実行）
- `tool_delegate.py` - FrontendToolDelegate 実装

---

## Q11: ESCキー中断とCMDキー音声入力は移譲型ではないのか？BIDIとSSE両方に対応していないのか？

**A: これらはtool移譲型ではなく、Frontend直接実装の機能です。また、両方ともBIDI専用機能です。**

### Tool vs Frontend機能の違い

**重要な違い:**

```
Tool（移譲型）:
  - AIの判断で実行される
  - Backend（ADK）がツール呼び出しを決定
  - ユーザーは承認/拒否のみ
  - 例: change_bgm, get_location

Frontend機能（直接実装）:
  - ユーザーの判断で実行される
  - ユーザーが直接キーを押す
  - AIは関与しない
  - 例: ESCキー中断, CMDキー音声入力
```

### 1. ESCキー中断機能

**実装場所:** `components/chat.tsx:290-304`

**コード:**
```typescript
// Phase 2: ESC key interruption support
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isLoading) {
      console.log("[Chat] ESC pressed - interrupting AI response");
      transportRef.current?.interrupt("user_abort");
      setInterrupted(true);
      // Reset interrupted state after 2 seconds
      setTimeout(() => setInterrupted(false), 2000);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isLoading]);
```

**特徴:**
- ✅ Browser API 使用: `window.addEventListener("keydown", ...)`
- ✅ Frontend で完結（Backend には通知のみ）
- ❌ Tool ではない（AI が呼び出さない）
- ❌ 移譲型ではない（FrontendToolDelegate 不使用）
- ✅ **BIDI 専用機能**

**BIDI/SSE 対応状況:**

| Mode | 対応状況 | 理由 |
|------|---------|------|
| BIDI | ✅ 対応 | `WebSocketChatTransport.interrupt()` メソッド実装済み (line 233) |
| SSE  | ❌ 未対応 | `DefaultChatTransport` に `interrupt()` メソッドなし |
| Gemini Direct | ❌ 未対応 | `DefaultChatTransport` に `interrupt()` メソッドなし |

**実装詳細（BIDI mode）:**

```typescript
// lib/websocket-chat-transport.ts:233-238
public interrupt(reason?: "user_abort" | "timeout" | "error"): void {
  const event: InterruptEvent = {
    type: "interrupt",
    version: "1.0",
    reason,
  };
  this.sendEvent(event); // WebSocket経由でBackendに通知
}
```

**なぜSSE/Gemini Directでは動かないか:**
- `transportRef.current?.interrupt()` の `?` はオプショナルチェイニング
- `DefaultChatTransport` に `interrupt()` メソッドが存在しない
- メソッド未実装なので何も起こらない（エラーも出ない）

---

### 2. CMDキー音声入力機能

**実装場所:** `components/chat.tsx:260-288`

**コード:**
```typescript
// Phase 3: CMD key push-to-talk (BIDI mode only)
useEffect(() => {
  if (mode !== "adk-bidi") return; // ← BIDI専用の条件分岐

  const handleKeyDown = (e: KeyboardEvent) => {
    // CMD key (Meta) pressed - start recording
    if (e.metaKey && !isRecording) {
      e.preventDefault();
      console.log("[Chat] CMD key pressed - starting recording");
      handleStartRecording();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    // CMD key released - stop recording and auto-send
    if (e.key === "Meta" && isRecording) {
      e.preventDefault();
      console.log("[Chat] CMD key released - stopping recording");
      handleStopRecording();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  };
}, [mode, isRecording, handleStartRecording, handleStopRecording]);
```

**特徴:**
- ✅ Browser API 使用: `window.addEventListener("keydown"/"keyup", ...)`
- ✅ Browser API 使用: `navigator.mediaDevices.getUserMedia()` (AudioRecorder内部)
- ✅ Frontend で完結
- ❌ Tool ではない（AI が呼び出さない）
- ❌ 移譲型ではない（FrontendToolDelegate 不使用）
- ✅ **明示的に BIDI 専用機能** (`if (mode !== "adk-bidi") return`)

**BIDI/SSE 対応状況:**

| Mode | 対応状況 | 理由 |
|------|---------|------|
| BIDI | ✅ 対応 | AudioRecorder + WebSocket でリアルタイム音声送信 |
| SSE  | ❌ 未対応 | 明示的に `if (mode !== "adk-bidi") return` で除外 |
| Gemini Direct | ❌ 未対応 | 明示的に `if (mode !== "adk-bidi") return` で除外 |

**なぜBIDI専用か:**
- **リアルタイム双方向通信が必要**: 音声入力しながら同時にAIからの応答を受け取る
- **WebSocket が必須**: HTTP SSE は単方向（Server → Client のみ）
- **AudioRecorder**: PCM データをリアルタイムで WebSocket 経由送信
- **VAD (Voice Activity Detection)**: ADK 側が音声終了を検知して自動応答

**SSE/Gemini Direct での代替手段:**

ユーザーの質問にあった通り:

> BIDI以外は、ブラウザの音声入力をONにして使う
> メッセージ入力欄にテキスト入力が完了した状態になる、キーボード入力で訂正が可能であり、手動でsendを押す必要がある

つまり:
- **BIDI モード**: CMDキー押下 → リアルタイム音声送信 → VAD自動検知 → 自動送信
- **SSE/Gemini モード**: ブラウザの音声入力機能 → テキスト変換 → 手動編集可能 → 手動Send

---

### なぜこれらはtool移譲型ではないのか？

**Tool移譲型の定義（復習）:**

```python
# Backend tool function
async def change_bgm(track: int, tool_context: ToolContext) -> dict[str, Any]:
    # 1. AIが「BGMを変えたい」と判断
    # 2. ADKがchange_bgm toolを呼び出し
    # 3. Backendがtool_call_idを生成
    # 4. Frontendに実行委譲（FrontendToolDelegate）
    # 5. Frontendがユーザーに承認を求める
    # 6. 承認後、AudioContext APIを実行
    # 7. 結果をBackendに返す
    delegate = tool_context.state.get("temp:delegate") or frontend_delegate
    result = await delegate.execute_on_frontend(...)
    return result
```

**Frontend直接実装の定義:**

```typescript
// Frontend feature
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // 1. ユーザーがESCキーを押す（直接操作）
      // 2. Frontendがイベントをキャッチ
      // 3. Frontendが処理を実行
      // 4. Backend には通知のみ（必要に応じて）
      transportRef.current?.interrupt("user_abort");
    }
  };
  window.addEventListener("keydown", handleKeyDown);
}, []);
```

**違いの表:**

| 観点 | Tool移譲型 | Frontend直接実装 |
|------|-----------|----------------|
| **実行判断** | AIが判断 | ユーザーが判断 |
| **呼び出し元** | Backend (ADK) | Frontend (Browser) |
| **ユーザー関与** | 承認/拒否のみ | 直接実行 |
| **FrontendToolDelegate** | 使用 | 不使用 |
| **tool_call_id** | 生成される | 生成されない |
| **Data Stream Protocol** | tool-call/tool-result イベント | 独自イベント or なし |
| **AIの認識** | AIが結果を受け取る | AIは関与しない |

---

### ユーザーの質問への回答

**Q: 以下の1.と2.はtool系の移譲型ではないのか？**

**A: いいえ、移譲型ではありません。**

**理由:**
1. ✅ Browser API は使っている
2. ❌ Tool として実装されていない
3. ❌ FrontendToolDelegate を使っていない
4. ❌ AI が呼び出さない（ユーザーが直接実行）

**Q: BIDIとSSEの両方には対応していないのか？**

**A: いいえ、両方ともBIDI専用機能です。**

**対応状況:**

| 機能 | BIDI | SSE | Gemini Direct |
|------|------|-----|---------------|
| ESCキー中断 | ✅ | ❌ | ❌ |
| CMDキー音声入力 | ✅ | ❌ | ❌ |

**ESCキー中断がSSE未対応の理由:**
- `DefaultChatTransport` に `interrupt()` メソッドが実装されていない
- 技術的には実装可能だが、現状は BIDI 専用

**CMDキー音声入力がSSE未対応の理由:**
- **技術的制約**: リアルタイム双方向通信が必須
- HTTP SSE は Server → Client のみ（単方向）
- WebSocket が必要（Client ⇄ Server 双方向）
- 明示的に `if (mode !== "adk-bidi") return` で除外

---

### まとめ

**Q: ESCキー中断とCMDキー音声入力は移譲型ではないのか？**

**A: 移譲型ではなく、Frontend直接実装です。**

**理由:**
1. ❌ Tool ではない（Backend に定義されていない）
2. ❌ FrontendToolDelegate 不使用
3. ❌ AI が呼び出さない（ユーザーが直接実行）
4. ✅ Browser API は使っている（Keyboard Events API, MediaDevices API）
5. ✅ Frontend で完結する機能

**Q: BIDIとSSE両方に対応していないのか？**

**A: 両方ともBIDI専用機能です。**

**対応状況:**
- ESCキー中断: BIDI のみ（SSE は `interrupt()` メソッド未実装）
- CMDキー音声入力: BIDI のみ（技術的制約: WebSocket 必須）

**設計の違い:**

```
Tool移譲型（change_bgm, get_location）:
  ┌─────────┐         ┌─────────┐
  │   AI    │ ──判断→ │ Backend │ ──委譲→ Frontend
  └─────────┘         └─────────┘

Frontend直接実装（ESC, CMD）:
  ┌─────────┐ ──直接→ ┌─────────┐
  │  User   │         │ Frontend│ ──通知→ Backend (optional)
  └─────────┘         └─────────┘
```

**Browser API 使用の共通点:**
- ✅ 両方とも Browser API を使う
- ✅ 両方とも Frontend で実行

**実行主体の違い:**
- Tool移譲型: **AI が判断** → Backend → Frontend委譲 → User承認
- Frontend直接実装: **User が判断** → Frontend直接実行 → Backend通知(optional)

**関連リソース:**
- `components/chat.tsx:290-304` - ESCキー中断実装（BIDI専用）
- `components/chat.tsx:260-288` - CMDキー音声入力実装（BIDI専用）
- `lib/websocket-chat-transport.ts:233` - interrupt() メソッド実装
- `lib/audio-recorder.ts` - AudioRecorder 実装（MediaDevices API使用）

---

## Q12: BGMの2つの切り替えはオーディオダッキングのことか？

**A: いいえ、BGMの切り替えとオーディオダッキングは別々の機能です。両方とも実装されていますが、目的と動作が異なります。**

### 実装されている2つの機能

このプロジェクトには**2つの異なるBGM関連機能**が実装されています：

1. **BGM Track Switching（トラック切り替え）** - change_bgm tool
2. **Audio Ducking（オーディオダッキング）** - AI音声再生時の自動音量調整

---

### 1. BGM Track Switching（トラック切り替え）

**実装場所:** `lib/audio-context.tsx:351-396`

**これは何か:**
- **Track 1 (bgm.wav) ⇄ Track 2 (bgm2.wav) の切り替え**
- **Crossfade（クロスフェード）技術を使用**
- 古いトラックをフェードアウト、新しいトラックをフェードイン
- 約2秒かけてスムーズに切り替わる

**実装コード:**
```typescript
// lib/audio-context.tsx:351-396
const switchTrack = () => {
  const audioContext = audioContextRef.current;
  if (!audioContext || !bgmGain1Ref.current || !bgmGain2Ref.current) {
    console.warn("[AudioContext] Cannot switch BGM - audio not ready");
    return;
  }

  const now = audioContext.currentTime;
  const fadeDuration = 0.6; // Time constant for exponential fade (~2 seconds total)

  if (currentBgmTrack === 0) {
    // Switch from Track 1 to Track 2
    console.log("[AudioContext] Switching BGM: Track 1 → Track 2 (crossfade)");

    // Fade out Track 1
    bgmGain1Ref.current.gain.setTargetAtTime(0, now, fadeDuration);

    // Fade in Track 2
    bgmGain2Ref.current.gain.setTargetAtTime(
      isPlaying ? 0.1 : 0.3, // Respect ducking state
      now,
      fadeDuration,
    );

    setCurrentBgmTrack(1);
  } else {
    // Switch from Track 2 to Track 1
    // ...同様のフェード処理
  }
};
```

**動作:**
1. ユーザーが「BGMを変えて」とAIに依頼
2. AIが `change_bgm` tool を呼び出し
3. Frontendで `switchTrack()` が実行される
4. **Track 1のゲインを 0.3 → 0 にフェードアウト**（約2秒）
5. **Track 2のゲインを 0 → 0.3 にフェードイン**（約2秒）
6. 両トラックが同時に鳴っている期間がある（クロスフェード）

**これはダッキングではない:**
- ✅ 異なる音楽トラック間の切り替え
- ✅ 両方のトラックが一時的に同時に鳴る
- ❌ メイン音声を際立たせる目的ではない
- ❌ 一時的な音量低下ではない（完全な切り替え）

---

### 2. Audio Ducking（オーディオダッキング）

**実装場所:** `lib/audio-context.tsx:135-175`

**これは何か:**
- **AI音声（Voice channel）再生中にBGMの音量を自動的に下げる**
- **音声が終わったらBGMの音量を元に戻す**
- ユーザーの指示ではなく、自動で実行される

**実装コード:**

**Duck（音量を下げる）:**
```typescript
// lib/audio-context.tsx:135-153
audioWorkletNode.port.onmessage = (event) => {
  if (event.data.type === "playback-started") {
    console.log("[AudioContext] Playback started - ducking BGM");
    setIsPlaying(true);

    // Duck BGM: Fade volume down smoothly (current → 0.1 over 0.5s)
    // Duck whichever track is currently playing
    const now = audioContext.currentTime;
    if (bgmGain1Ref.current && bgmGain1Ref.current.gain.value > 0) {
      const currentGain = bgmGain1Ref.current.gain.value;
      bgmGain1Ref.current.gain.setTargetAtTime(
        Math.min(currentGain, 0.1), // 10%に下げる
        now,
        0.15, // 約0.5秒でフェード
      );
    }
    if (bgmGain2Ref.current && bgmGain2Ref.current.gain.value > 0) {
      const currentGain = bgmGain2Ref.current.gain.value;
      bgmGain2Ref.current.gain.setTargetAtTime(
        Math.min(currentGain, 0.1), // 10%に下げる
        now,
        0.15,
      );
    }
  }
};
```

**Restore（音量を戻す）:**
```typescript
// lib/audio-context.tsx:156-175
else if (event.data.type === "playback-finished") {
  console.log("[AudioContext] Playback finished - restoring BGM");
  setIsPlaying(false);

  // Restore BGM: Fade volume back up smoothly
  // Restore to 0.3 or maintain current crossfade state
  const now = audioContext.currentTime;
  if (bgmGain1Ref.current) {
    const currentGain = bgmGain1Ref.current.gain.value;
    // Only restore if this track was ducked (gain < 0.3)
    if (currentGain > 0 && currentGain < 0.3) {
      bgmGain1Ref.current.gain.setTargetAtTime(0.3, now, 0.3); // 30%に戻す
    }
  }
  if (bgmGain2Ref.current) {
    const currentGain = bgmGain2Ref.current.gain.value;
    if (currentGain > 0 && currentGain < 0.3) {
      bgmGain2Ref.current.gain.setTargetAtTime(0.3, now, 0.3);
    }
  }
}
```

**動作:**
1. AI音声の再生が開始される (`playback-started` イベント)
2. **BGMの音量を 30% → 10% に自動で下げる**（約0.5秒でフェード）
3. AI音声がクリアに聞こえる
4. AI音声の再生が終了する (`playback-finished` イベント)
5. **BGMの音量を 10% → 30% に自動で戻す**（約1秒でフェード）

**これが本当のダッキング:**
- ✅ メイン音声（AI応答）を際立たせる
- ✅ 一時的な音量低下（10%に下げる）
- ✅ 自動復帰（音声終了後に30%に戻る）
- ✅ ユーザーの指示不要（システムが自動実行）

---

### 比較表

| 観点 | BGM Track Switching | Audio Ducking |
|------|---------------------|---------------|
| **目的** | 異なる音楽への切り替え | AI音声を際立たせる |
| **実行方法** | AIがtoolを呼び出し → Frontend実行 | Voice channel再生時に自動実行 |
| **ユーザー関与** | ユーザーがAIに依頼 | 自動（ユーザー操作不要） |
| **音量変化** | Track 1: 30% → 0%<br>Track 2: 0% → 30% | 再生中BGM: 30% → 10% → 30% |
| **期間** | 永続的（切り替え完了まで） | 一時的（音声再生中のみ） |
| **クロスフェード** | あり（両トラック同時再生） | なし（同じトラックの音量変化） |
| **実装場所** | `switchTrack()` 関数 | AudioWorklet `onmessage` |
| **トリガー** | change_bgm tool | playback-started/finished イベント |

---

### ユーザーの質問への回答

**Q: bgmの2つの切り替えが行われているがこれは下記のものか？**
> オーディオダッキング: ある音が鳴ったときに、別の音の音量を自動的に下げる技術

**A: いいえ、「BGMの2つの切り替え」はオーディオダッキングではありません。**

**「BGMの2つの切り替え」が指すもの:**
- **Track 1 (bgm.wav) と Track 2 (bgm2.wav) の切り替え**
- **Crossfade（クロスフェード）技術**
- change_bgm tool による明示的な切り替え

**ただし、別機能としてオーディオダッキングも実装されています:**
- AI音声再生中に**自動で**BGMの音量を下げる
- これがまさに「オーディオダッキング」の定義に該当

---

### 詳細: なぜ2つのトラックが必要なのか？

**Dual BGM System の理由:**

```typescript
// lib/audio-context.tsx:99-105
// Dual BGM system for crossfade switching
const bgmSource1Ref = useRef<AudioBufferSourceNode | null>(null);
const bgmGain1Ref = useRef<GainNode | null>(null);
const bgmSource2Ref = useRef<AudioBufferSourceNode | null>(null);
const bgmGain2Ref = useRef<GainNode | null>(null);
const bgmBuffer1Ref = useRef<AudioBuffer | null>(null);
const bgmBuffer2Ref = useRef<AudioBuffer | null>(null);
```

**Web Audio API の制約:**
- `AudioBufferSourceNode` は**一度しか再生開始できない**
- 停止したら再利用不可（使い捨て）
- 新しいトラックに切り替えるには新しい `AudioBufferSourceNode` が必要

**Crossfade を実現するための設計:**
1. **両トラックを常に再生状態にする**（ループ再生）
2. Track 1: Gain = 0.3（聞こえる）、Track 2: Gain = 0（無音）
3. 切り替え時に**両方のGainを同時に変更**
   - Track 1: 0.3 → 0 にフェードアウト
   - Track 2: 0 → 0.3 にフェードイン
4. 約2秒間、両トラックが混ざって聞こえる（クロスフェード）

**この設計の利点:**
- ✅ スムーズな切り替え（ブツ切り感なし）
- ✅ 即座に切り替え開始可能（バッファ読み込み待ち不要）
- ✅ ダッキング時も両トラックの状態を維持

---

### まとめ

**Q: BGMの2つの切り替えはオーディオダッキングのことか？**

**A: いいえ、別々の機能です。**

**BGM Track Switching（change_bgm tool）:**
- Track 1 ⇄ Track 2 の切り替え
- Crossfade技術を使用
- ユーザーがAIに依頼して実行
- これは「トラック切り替え」であり、「ダッキング」ではない

**Audio Ducking（自動実装）:**
- AI音声再生中にBGMを 30% → 10% に自動で下げる
- 音声終了後に 10% → 30% に自動で戻す
- これが本当の「オーディオダッキング」

**両方とも実装されている理由:**
- **BGM切り替え**: ユーザーの気分や雰囲気に合わせて音楽を変更
- **オーディオダッキング**: AI音声をクリアに聞こえるようにする

**ユーザーが説明した「ダッキング」の定義に該当するもの:**
> 「ある音（例：ナレーションやボーカル）を目立たせるために、別の音（例：BGM）の音量を自動的に一時下げて、重要な音声をクリアに聞き取れるようにする音声処理技術」

→ これは **Audio Ducking 機能** に該当します（AI音声再生時の自動BGM音量低下）

**関連リソース:**
- `lib/audio-context.tsx:351-396` - BGM Track Switching（switchTrack関数）
- `lib/audio-context.tsx:135-175` - Audio Ducking（playback-started/finished イベント処理）
- `lib/audio-context.tsx:99-105` - Dual BGM System（2トラック同時再生の仕組み）
- `server.py:254-290` - change_bgm tool 実装（Frontend委譲）

---

## Q13: Backend modeを切り替えた時に過去ログが消えるのは互換性がないからか？実装していないだけか？

**A: 互換性の問題ではなく、実装していないだけです。3つのモードは全て同じData Stream Protocolを使用しているため、技術的には完全に互換性があります。**

### 現状の実装

**問題の原因:**

**1. Reactコンポーネントの再マウント**

```typescript
// app/page.tsx:135
<Chat key={mode} mode={mode} />
```

**この実装の影響:**
- `key={mode}` が設定されている
- mode が変わると React は Chat コンポーネントを**完全に再マウント**（unmount & remount）する
- useChat hook の内部 state も**全てリセット**される
- 結果: メッセージ履歴が消える

**2. 固定の空配列 initialMessages**

```typescript
// components/chat.tsx:25-27
const { useChatOptions, transport } = buildUseChatOptions({
  mode,
  initialMessages: [], // ← 常に空配列
  audioContext,
});
```

**この実装の影響:**
- 常に空配列 `[]` を initialMessages として渡している
- mode が変わっても過去のメッセージを引き継がない
- 結果: 新しいモードでは常に空のメッセージ履歴から開始

---

### 互換性の検証

**Q: 3つのモードは互換性がないのか？**

**A: いいえ、完全に互換性があります。**

**理由:**

**1. 全てのモードが同じData Stream Protocolを使用**

```
Gemini Direct → AI SDK v6 Data Stream Protocol → UIMessage[]
ADK SSE       → AI SDK v6 Data Stream Protocol → UIMessage[]
ADK BIDI      → AI SDK v6 Data Stream Protocol → UIMessage[]
```

**2. UIMessage 型は全モード共通**

```typescript
// AI SDK v6 UIMessage structure
interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: UIMessagePart[];
  // ...
}

// 全てのモードで同じ構造
```

**3. useChat hook は mode に依存しない**

```typescript
// AI SDK v6 useChat hook
const { messages, sendMessage, ... } = useChat({
  api: ...,              // Mode依存（endpoint URL）
  transport: ...,        // Mode依存（HTTP SSE vs WebSocket）
  initialMessages: ...,  // Mode非依存（共通のUIMessage[]）
});

// messages の型は全モードで UIMessage[]
```

**証拠:**

| Mode | Transport | Protocol | Messages Type |
|------|-----------|----------|---------------|
| Gemini Direct | DefaultChatTransport (HTTP SSE) | Data Stream Protocol | `UIMessage[]` |
| ADK SSE | DefaultChatTransport (HTTP SSE) | Data Stream Protocol | `UIMessage[]` |
| ADK BIDI | WebSocketChatTransport (WebSocket) | Data Stream Protocol | `UIMessage[]` |

→ **messages の型は全て同じ `UIMessage[]`、完全互換**

---

### なぜ過去ログが消えるのか

**Reactの動作:**

```typescript
// app/page.tsx
const [mode, setMode] = useState<BackendMode>("gemini");

return (
  <>
    <button onClick={() => setMode("adk-sse")}>Switch to ADK SSE</button>
    <Chat key={mode} mode={mode} /> {/* ← key={mode} が問題 */}
  </>
);
```

**動作シーケンス:**

1. **初期状態**: mode = "gemini"
   - React: `<Chat key="gemini" mode="gemini" />` をマウント
   - useChat: 内部で messages state を管理
   - User: メッセージを送信 → messages = [message1, message2, ...]

2. **モード切り替え**: setMode("adk-sse")
   - React: `key` が "gemini" → "adk-sse" に変更された
   - React: **古い Chat コンポーネントを unmount**（完全破棄）
   - React: **新しい Chat コンポーネントを mount**（新規作成）
   - useChat: 新しいインスタンスが作成される
   - useChat: initialMessages = [] で初期化
   - 結果: **messages = [] (空配列)**

**なぜ `key={mode}` が設定されているのか:**

コメントから推測すると、おそらく以下の理由：
- 異なる transport を使用するため、完全にリセットしたかった
- WebSocket 接続のクリーンアップを確実にしたかった
- 実装の簡略化（mode切り替え = 新規セッション）

---

### 解決策

**方法1: 親コンポーネントでメッセージを管理**

```typescript
// app/page.tsx
export default function ChatPage() {
  const [mode, setMode] = useState<BackendMode>("gemini");
  const [persistedMessages, setPersistedMessages] = useState<UIMessage[]>([]);

  return (
    <>
      <button onClick={() => setMode("adk-sse")}>Switch to ADK SSE</button>
      <Chat
        key={mode}
        mode={mode}
        initialMessages={persistedMessages}
        onMessagesChange={setPersistedMessages}
      />
    </>
  );
}
```

```typescript
// components/chat.tsx
interface ChatProps {
  mode: BackendMode;
  initialMessages: UIMessage[];
  onMessagesChange: (messages: UIMessage[]) => void;
}

export function Chat({ mode, initialMessages, onMessagesChange }: ChatProps) {
  const { useChatOptions, transport } = buildUseChatOptions({
    mode,
    initialMessages, // ← 親から受け取った履歴を渡す
    audioContext,
  });

  const { messages, ... } = useChat(useChatOptions);

  // messages が更新されたら親に通知
  useEffect(() => {
    onMessagesChange(messages);
  }, [messages, onMessagesChange]);

  // ...
}
```

**メリット:**
- ✅ モード切り替え時もメッセージ履歴を保持
- ✅ key={mode} を維持できる（transport完全リセット）
- ✅ 実装が明確

**デメリット:**
- ❌ 親子間でメッセージ同期が必要
- ❌ やや複雑

---

**方法2: key を削除してコンポーネントを再利用**

```typescript
// app/page.tsx
<Chat mode={mode} /> {/* key={mode} を削除 */}
```

```typescript
// components/chat.tsx
export function Chat({ mode }: ChatProps) {
  const [persistedMessages, setPersistedMessages] = useState<UIMessage[]>([]);

  const { useChatOptions, transport } = buildUseChatOptions({
    mode,
    initialMessages: persistedMessages,
    audioContext,
  });

  const { messages, ... } = useChat(useChatOptions);

  // mode変更時にmessagesを保存
  useEffect(() => {
    setPersistedMessages(messages);
  }, [mode]); // modeが変わる直前に保存

  // ...
}
```

**メリット:**
- ✅ シンプル
- ✅ 親コンポーネントの変更不要

**デメリット:**
- ❌ transport が変わった時のクリーンアップが複雑
- ❌ WebSocket → HTTP SSE 切り替え時のリスク

---

**方法3: localStorage で永続化**

```typescript
// components/chat.tsx
export function Chat({ mode }: ChatProps) {
  // localStorage から履歴を読み込み
  const [persistedMessages, setPersistedMessages] = useState<UIMessage[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chat-messages");
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });

  const { useChatOptions, transport } = buildUseChatOptions({
    mode,
    initialMessages: persistedMessages,
    audioContext,
  });

  const { messages, ... } = useChat(useChatOptions);

  // messages が更新されたら localStorage に保存
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("chat-messages", JSON.stringify(messages));
    }
  }, [messages]);

  // ...
}
```

**メリット:**
- ✅ ページリロード後も履歴が残る
- ✅ 実装がシンプル

**デメリット:**
- ❌ ブラウザストレージ容量制限
- ❌ セキュリティ考慮が必要（機密情報）

---

### まとめ

**Q: backend modeを切り替えた時に過去ログが消えるのは互換性がないからか？**

**A: いいえ、実装していないだけです。**

**理由:**

1. **互換性は完全にある**
   - 全モードが Data Stream Protocol 使用
   - messages の型は全て `UIMessage[]`
   - AI SDK v6 が保証する互換性

2. **実装していない理由**
   - `key={mode}` でコンポーネントが再マウント
   - `initialMessages: []` で常に空配列
   - メッセージ履歴を保持する仕組みがない

3. **実装可能**
   - 方法1: 親コンポーネントで管理
   - 方法2: key削除 + 内部state
   - 方法3: localStorage永続化

**ユーザーの理解は正しい:**
> この3つのモードは全て data stream protocols に従っているので、全ての過去ログの行き来は互換性があるはずです。

→ ✅ **完全に正しい**

> initialMessagesでそれが実現できていると思っていたけど、できていない？

→ ✅ **initialMessages で実現可能だが、現在は常に `[]` を渡しているため実現できていない**

**現状:**
- 技術的互換性: ✅ あり
- 実装: ❌ なし（常に空配列）

**次のアクション（実装する場合）:**
1. 親コンポーネントで `persistedMessages` state を追加
2. Chat に `initialMessages={persistedMessages}` を渡す
3. Chat の messages 更新を親に通知
4. mode 切り替え時も履歴が保持される

**関連リソース:**
- `app/page.tsx:135` - `key={mode}` によるコンポーネント再マウント
- `components/chat.tsx:27` - `initialMessages: []` 固定の空配列
- `lib/build-use-chat-options.ts` - useChatOptions 構築（mode依存）
- AI SDK v6 UIMessage 型定義 - 全モード共通の型

---

## Q14: WebSocketハンドラーの上書きは安全ですか？

**質問:**

```typescript
// lib/websocket-chat-transport.ts:416-432
// Update message handler for new stream
if (this.ws) {
  this.ws.onmessage = (event) => {
    this.handleWebSocketMessage(event.data, controller);
  };

  this.ws.onerror = (error) => {
    console.error("[WS Transport] Error:", error);
    this.stopPing();
    controller.error(new Error("WebSocket error"));
  };

  this.ws.onclose = () => {
    console.log("[WS Transport] Connection closed");
    this.stopPing();
    controller.close();
  };
}
```

既存のWebSocketハンドラーがある場合に上書きしています。これは安全でしょうか？エンバグの懸念はありませんか？

---

### 回答

**現状の実装は潜在的なバグを含みますが、Tool approval flowでは正常動作しています。**ただし、エラー時やエッジケースで問題が起きる可能性があります。

---

### 1. コード解析: WebSocket接続の再利用ロジック

**sendMessages() の呼び出しタイミング:**

```typescript
// lib/websocket-chat-transport.ts:342-454
async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
  return new ReadableStream<UIMessageChunk>({
    start: async (controller) => {
      // Check if we can reuse existing connection
      const needsNewConnection =
        !this.ws ||
        this.ws.readyState === WebSocket.CLOSED ||
        this.ws.readyState === WebSocket.CLOSING;

      if (needsNewConnection) {
        // Path A: 新規接続 (Lines 363-410)
        this.ws = new WebSocket(url);
        // ... 初回のハンドラー設定
      } else {
        // Path B: 既存接続再利用 (Lines 411-433)
        console.log("[WS Transport] Reusing existing connection");

        // ⚠️ ハンドラーの上書き発生
        if (this.ws) {
          this.ws.onmessage = (event) => {
            this.handleWebSocketMessage(event.data, controller);
          };
          // ... 他のハンドラーも上書き
        }
      }
    }
  });
}
```

**キーポイント:**

1. **毎回新しい `controller` が作成される** (各 `sendMessages()` 呼び出しで新しい `ReadableStream`)
2. **既存のWebSocket接続を再利用する場合、ハンドラーを上書きする** (Path B)
3. **前回の `controller` への参照が失われる**

---

### 2. 潜在的な問題点

#### 問題A: Controllerの孤立化

**シナリオ1: Tool Approval Flow**

```
User: "Change BGM to jazz"
  → sendMessages() 1回目 (controller1)
  → AI: tool-approval-request
  → User: Approve
  → sendAutomaticallyWhen triggers
  → sendMessages() 2回目 (controller2)
  → ⚠️ ハンドラー上書き: controller1 への参照が失われる
```

**シナリオ2: 複数メッセージ連続送信**

```
User: "Hello"
  → sendMessages() 1回目 (controller1)
  → AI: Streaming response...
User: "How are you?" (前の応答完了前)
  → sendMessages() 2回目 (controller2)
  → ⚠️ ハンドラー上書き: controller1 への参照が失われる
```

**結果:**

- 前回の `controller1` が正常に `close()` されない可能性
- ストリームの状態が不定になる

---

#### 問題B: エラー時の動作

**正常ケース: `[DONE]` が来る場合**

```typescript
// lib/websocket-chat-transport.ts:508-527
if (jsonStr === "[DONE]") {
  console.log("[WS Transport] Turn complete, closing stream (WebSocket stays open)");
  controller.close(); // ✅ 正常にclose
  return;
}
```

**異常ケース: `[DONE]` が来ない場合**

- Backend がクラッシュ
- ネットワークタイムアウト
- WebSocket エラー発生

この場合、前回の `controller` は `close()` されないまま放置されます。

---

### 3. 現状の動作検証

#### Tool Approval Flowでの実際の動作

**実験での確認結果:**

1. User: "Change BGM to jazz"
   - `sendMessages()` 1回目: controller1 作成
   - AI: `tool-approval-request` イベント送信
   - Frontend: `addToolApprovalResponse()` 実行
   - `sendAutomaticallyWhen` 条件満たす → 自動再送

2. 自動再送:
   - `sendMessages()` 2回目: controller2 作成
   - **ハンドラー上書き発生** (Lines 416-432)
   - controller1: `[DONE]` を受信済み（Step 1で既にclose）
   - controller2: 新しいメッセージストリーム処理

**結論: Tool approval flowでは問題なし**

理由: `tool-approval-request` 送信後、必ず `[DONE]` が来るため、controller1 は正常にcloseされる。

---

### 4. エッジケースでの懸念

#### ケース1: エラー時のcontroller放置

**発生条件:**

- Backend がエラーレスポンスを返す
- `[DONE]` が送信されない
- 次の `sendMessages()` が呼ばれる

**結果:**

```typescript
// 前回のcontrollerが未close状態で放置
controller1.close(); // 呼ばれない
// 新しいハンドラーが設定される
this.ws.onmessage = (event) => {
  this.handleWebSocketMessage(event.data, controller2); // 上書き
};
```

**影響:**

- controller1 のストリームが中途半端な状態で放置
- メモリリークの可能性は低い（JavaScriptのGCが回収）
- ただし、ストリームのライフサイクルが不定

---

#### ケース2: 複数メッセージ同時送信

**発生条件:**

- User が連続して複数のメッセージを送信
- 前のメッセージの応答が完了する前に次のメッセージを送信

**現状の動作:**

```
Message 1: "Hello"
  → controller1 作成
  → AI streaming...
Message 2: "How are you?" (前の応答完了前)
  → controller2 作成
  → ハンドラー上書き
  → controller1 は [DONE] を受け取れない可能性
```

**実際の動作検証が必要:**

- ADK backend の動作: 複数リクエストをどう処理するか？
- キューイング機能があるか？
- エラーを返すか？

---

### 5. 推奨される修正方法

#### Option A: 前のcontrollerを明示的にclose (推奨)

```typescript
export class WebSocketChatTransport implements ChatTransport<UIMessage> {
  private ws: WebSocket | null = null;
  private currentController: ReadableStreamDefaultController<UIMessageChunk> | null = null; // 追加

  async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        // ... existing connection check logic

        if (!needsNewConnection) {
          // 既存接続再利用時: 前のcontrollerをclose
          if (this.currentController) {
            console.warn("[WS Transport] Closing previous stream");
            try {
              this.currentController.close();
            } catch (err) {
              // Already closed - ignore error
            }
          }

          // 新しいcontrollerを保存
          this.currentController = controller;

          // Update message handler for new stream
          if (this.ws) {
            this.ws.onmessage = (event) => {
              this.handleWebSocketMessage(event.data, controller);
            };
            // ... 他のハンドラー
          }
        } else {
          // 新規接続時も保存
          this.currentController = controller;
          // ... existing new connection logic
        }
      },
    });
  }

  // [DONE] 受信時にもcurrentControllerをクリア
  private handleWebSocketMessage(data: string, controller): void {
    // ... existing logic
    if (jsonStr === "[DONE]") {
      console.log("[WS Transport] Turn complete, closing stream");
      controller.close();
      this.currentController = null; // クリア
      return;
    }
  }
}
```

**メリット:**

- 前のcontrollerを明示的にclose
- ストリームのライフサイクルが明確
- メモリリークの心配なし

**デメリット:**

- 若干のコード追加

---

#### Option B: WebSocketを都度closeして再接続

```typescript
async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
  return new ReadableStream<UIMessageChunk>({
    start: async (controller) => {
      // Always close existing connection
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Always create new connection
      this.ws = new WebSocket(url);
      // ... setup handlers
    },
  });
}
```

**メリット:**

- ハンドラー上書きの問題が完全に解消
- シンプルな実装

**デメリット:**

- 接続のオーバーヘッド増加
- BIDI modeの設計思想に反する（1接続で複数ターン）

---

#### Option C: メッセージキューイング

```typescript
export class WebSocketChatTransport implements ChatTransport<UIMessage> {
  private messageQueue: Array<{messages: UIMessage[], controller: ReadableStreamDefaultController}> = [];
  private isStreaming = false;

  async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        // Queue message if already streaming
        if (this.isStreaming) {
          this.messageQueue.push({ messages: options.messages, controller });
          return;
        }

        this.isStreaming = true;
        // ... send message
      },
    });
  }

  // [DONE] 受信時に次のメッセージを処理
  private handleWebSocketMessage(data: string, controller): void {
    // ... existing logic
    if (jsonStr === "[DONE]") {
      controller.close();
      this.isStreaming = false;

      // Process next message in queue
      if (this.messageQueue.length > 0) {
        const next = this.messageQueue.shift();
        // ... send next message
      }
      return;
    }
  }
}
```

**メリット:**

- 複数メッセージの安全な処理
- ストリームの状態が明確

**デメリット:**

- 実装が複雑
- Tool approval flowの動作検証が必要

---

### 6. 実装状況の評価

**短期的リスク: 中程度**

- ✅ Tool approval flowは正常動作（実験で確認済み）
- ✅ 理由: `[DONE]` が必ず来るので前のcontrollerは正常にclose
- ⚠️ ただし、明示的な保証はなし

**長期的リスク: 高**

- ❌ エラー時やタイムアウト時に `[DONE]` が来ない場合
- ❌ 複数メッセージ同時送信時の動作が不定
- ❌ エッジケースでのストリーム状態が不明確

**メモリリスク: 低**

- ✅ JavaScriptのGCが到達不能なcontrollerを回収
- ⚠️ ただし、ストリームの状態が不定になる可能性

---

### 7. 結論と推奨アクション

**現状の実装:**

```typescript
// lib/websocket-chat-transport.ts:416-432
// ⚠️ 潜在的なバグを含むが、Tool approval flowでは動作する
if (this.ws) {
  this.ws.onmessage = (event) => {
    this.handleWebSocketMessage(event.data, controller);
  };
  // ...
}
```

**推奨される修正: Option A (前のcontrollerを明示的にclose)**

理由:

1. **最小限のコード変更**で問題を解決
2. **BIDI modeの設計思想を維持**（1接続で複数ターン）
3. **ストリームのライフサイクルが明確**になる
4. **エラー時の挙動が予測可能**になる

**実装優先度: Medium**

- 現状でも動作しているため、Critical ではない
- ただし、エッジケースでの問題を防ぐため、早めの修正を推奨

---

**関連リソース:**
- `lib/websocket-chat-transport.ts:342-454` - sendMessages() 実装
- `lib/websocket-chat-transport.ts:416-432` - ハンドラー上書き箇所
- `lib/websocket-chat-transport.ts:508-527` - [DONE] 処理
- AI SDK v6 ReadableStream仕様 - controller のライフサイクル
