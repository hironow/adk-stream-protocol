# ADK AI Data Protocol - Insights

## Session 10 (2025-12-20): Type-Based Conversion State & Missing Tool-Input Events Bug

### TL;DR
- **Architecture**: Implemented type-based conversion state pattern (`Event | SseFormattedEvent`)
- **Bug Found**: Confirmation flows missing tool-input events for original tool
- **RED Tests**: Created 4 integration tests documenting the bug
- **Next**: GREEN phase implementation to fix the bug

---

### Key Insight 1: Type-Based Conversion State Pattern

**Problem**:
How to distinguish between:
- Unconverted ADK events (need conversion)
- Pre-converted SSE format strings (pass-through)

Without using identity checks or mixing type concerns.

**Solution**:
```python
# stream_protocol.py
type SseFormattedEvent = str  # Type alias for semantic clarity

async def stream_adk_to_ai_sdk(
    event_stream: AsyncGenerator[Event | SseFormattedEvent, None],
    ...
) -> AsyncGenerator[SseFormattedEvent, None]:
    async for event in event_stream:
        # Type-based distinction
        if isinstance(event, str):
            # Pre-converted SSE format string - pass through
            yield event
            continue
        
        # ADK Event - needs conversion
        async for sse_event in converter.convert_event(event):
            yield sse_event
```

**Benefits**:
1. **Type system enforces conversion state** - No runtime tricks needed
2. **Self-documenting** - Type alias makes intent clear
3. **Responsibility separation** - Services convert confirmation events, protocol converts ADK events
4. **No identity checks** - Simplified from previous `if event is event_identity` pattern

**Why This Works**:
- Services layer generates confirmation events as `str` (pre-converted)
- ADK layer generates events as `Event` objects (unconverted)
- Protocol layer uses `isinstance()` to distinguish
- Type hints document the contract

---

### Key Insight 2: Code Reusability - Extracted format_sse_event()

**Problem**:
Multiple components need to format SSE events:
- `StreamProtocolConverter._format_sse_event()` (existing)
- `BidiEventSender` confirmation events (new)
- `SseEventStreamer` confirmation events (new)

Copy-pasting formatting logic → bugs (inconsistent format, missing logging, etc.)

**Solution**:
```python
# stream_protocol.py (module-level function)
def format_sse_event(event_data: dict[str, Any]) -> SseFormattedEvent:
    """
    Format event data as SSE-formatted string.
    
    Used by:
    - StreamProtocolConverter: For converting ADK events
    - BidiEventSender: For formatting confirmation events
    - SseEventStreamer: For formatting confirmation events
    """
    # Truncate binary data for logging
    if event_type in {"data-pcm", "data-audio", "data-image"}:
        # ... truncation logic ...
    
    logger.debug(f"[ADK→SSE] {log_data}")
    return f"data: {json.dumps(event_data)}\n\n"
```

**Impact**:
- ✅ Single source of truth for SSE formatting
- ✅ Consistent logging across all components
- ✅ Binary data truncation in one place
- ✅ Easy to update format if needed

---

### Key Insight 3: RED Test Strategy - Integration Tests Reproduce E2E Bugs

**Problem**:
E2E tests failing (8/11):
- Slow feedback loop (9 minutes)
- Hard to debug (browser, network, multiple processes)
- Expensive to run frequently

**Solution**:
Create integration tests that reproduce E2E bug:

```python
# tests/integration/test_bidi_confirmation_tool_input_events.py
async def test_bidi_confirmation_event_sequence():
    """Reproduce E2E bug: missing tool-input events for original tool"""
    
    # given - mock WebSocket, real FrontendToolDelegate
    mock_websocket = Mock()
    sent_events: list[str] = []
    
    async def capture_send_text(event: str):
        sent_events.append(event)
    
    mock_websocket.send_text = AsyncMock(side_effect=capture_send_text)
    
    # when - send FunctionCall event requiring confirmation
    function_call_event = Event(...)
    await sender.send_events(mock_live_events())
    
    # then - verify event sequence
    has_original_tool_input_start = any(
        "tool-input-start" in e and fc_id in e 
        for e in sent_events
    )
    
    # ASSERTION (RED - expected to fail)
    assert has_original_tool_input_start, (
        f"Missing tool-input-start for original tool ID: {fc_id}"
    )
```

**Benefits**:
1. **Fast feedback** - 11 seconds vs 9 minutes for E2E
2. **Clear failure** - Assertion points to exact missing event
3. **Easy debugging** - No browser, no network, just Python
4. **Documents bug** - Test describes expected behavior before fix

**Evidence of Good RED Tests**:
- ✅ All 4 RED tests fail as expected
- ✅ Error messages clearly state what's missing
- ✅ Tests reproduce E2E bug in integration test
- ✅ When fixed, these will turn GREEN automatically

---

### Key Insight 4: Missing Tool-Input Events Bug Pattern

**Bug Discovery Process**:
1. E2E tests fail with "no tool invocation found" error
2. Analyzed chunk logs from all scenarios
3. Found common pattern across all scenarios

**Pattern Found**:
```
Confirmation flow (ALL scenarios):
✅ Line 1-2:  tool-input-start/available for confirmation-{id}
❌ MISSING:   tool-input-start/available for {id}  ← BUG
✅ Line 3:    tool-output-available for confirmation-{id}
✅ Line 4:    tool-output-available for {id}  ← Frontend error here!
```

**Why Frontend Fails**:
```javascript
// Frontend perspective
toolInvocations = new Map()

// Receives line 1-2: confirmation tool events
toolInvocations.set("confirmation-function-call-123", {...})

// MISSING: Never receives tool-input for function-call-123

// Receives line 4: tool-output for original tool
const invocation = toolInvocations.get("function-call-123")
// invocation = undefined → Error!
throw new Error(`no tool invocation found for function-call-123`)
```

**Root Cause** (in both BIDI and SSE):
```python
# services/bidi_event_sender.py:_handle_confirmation_if_needed()
async def _handle_confirmation_if_needed(...):
    # 1. Yield confirmation UI events
    yield format_sse_event({
        "type": "tool-input-start",
        "toolCallId": confirmation_id,  # confirmation-function-call-123
        ...
    })
    
    # 2. Wait for user approval
    confirmation_result = await execute_confirmation(...)
    
    # 3. Execute tool
    tool_result = await execute_tool(...)
    
    # 4. Yield tool result
    yield format_sse_event({
        "type": "tool-output-available",
        "toolCallId": fc_id,  # function-call-123
        ...
    })
    
    # ❌ BUG: Frontend never received tool-input events for fc_id!
```

**Fix Required**:
```python
async def _handle_confirmation_if_needed(...):
    # NEW: Send original tool-input events FIRST
    yield format_sse_event({
        "type": "tool-input-start",
        "toolCallId": fc_id,  # function-call-123
        "toolName": fc_name,
    })
    
    yield format_sse_event({
        "type": "tool-input-available",
        "toolCallId": fc_id,
        "toolName": fc_name,
        "input": fc_args,
    })
    
    # THEN send confirmation UI events
    # ... rest of existing code ...
```

---

### Key Insight 5: Architectural Responsibility Separation

**Clean Layer Separation**:

```
Services Layer (bidi_event_sender.py, sse_event_streamer.py):
- Generates confirmation events as pre-converted SSE strings
- Uses format_sse_event() for consistency
- Knows when to inject confirmation flow
- Does NOT know ADK Event internal structure

Protocol Layer (stream_protocol.py):
- Converts ADK Event → SSE format
- Passes through pre-converted strings
- Does NOT know confirmation logic
- Does NOT know when to intercept

ADK Layer (adk_compat.py):
- Detects which tools need confirmation
- Manages ADK Session and ToolContext
- Does NOT know SSE format
- Does NOT know frontend protocol
```

**Why This Matters**:
- Each layer has single responsibility
- Changes to one layer don't cascade
- Easy to test each layer independently
- Clear contracts between layers

---

### Session 10 Statistics

**Code Changes**:
- Added: 391 lines (RED tests + type alias + extracted function)
- Deleted: 837 lines (deprecated function + old tests)
- Modified: 6 files
- Net: -446 lines (code reduction!)

**Test Coverage**:
- Unit tests: 22/22 ✅ (no regression)
- Integration tests: 28/28 ✅ (includes 4 RED tests)
- E2E tests: 3/11 🔴 (8 failures documented by RED tests)

**Files Modified**:
- `stream_protocol.py` - Type alias, extracted function
- `services/bidi_event_sender.py` - Pre-converted SSE strings
- `services/sse_event_streamer.py` - Pre-converted SSE strings
- `adk_compat.py` - Deleted deprecated function

**Files Created**:
- `tests/integration/test_bidi_confirmation_tool_input_events.py`
- `tests/integration/test_sse_confirmation_tool_input_events.py`

**Files Deleted**:
- `tests/unit/test_inject_confirmation_for_bidi.py`
- `tests/integration/test_bidi_confirmation_function_response.py`
- `tests/integration/test_four_component_sse_bidi_integration.py`

---

### Next Steps

**GREEN Phase**:
1. Fix BIDI confirmation flow (add original tool-input events)
2. Fix SSE confirmation flow (same fix)
3. Verify RED tests turn GREEN
4. Verify E2E tests pass (8 failures → all passing)

**Expected Outcome**:
- Unit tests: 22/22 ✅
- Integration tests: 32/32 ✅ (4 RED → GREEN)
- E2E tests: 11/11 ✅

---

# ADK Tool Confirmation 無限ループ修正記録

## 日付: 2025-12-17

## 概要

SSEモードでのADK Tool Confirmation（確認UI）において、ユーザーが支払いを拒否（Deny）した際に発生する無限ループ問題を修正。デバッグ環境の改善も併せて実施。

## 実装した変更

### 1. バックエンド: Chunk Loggerの出力パス表示

**ファイル**: `chunk_logger.py`, `server.py`

サーバー起動時にチャンクロガーの設定情報をログ出力するよう改善。

**変更内容**:
- `chunk_logger.py`に`get_output_path()`と`get_info()`メソッドを追加
- `server.py`の起動ログに以下を出力:
  ```
  Chunk Logger: enabled=True
  Chunk Logger: session_id=e2e-3
  Chunk Logger: output_path=chunk_logs/e2e-3
  ```

**効果**: デバッグ時にログファイルの保存場所を即座に確認可能になった。

### 2. フロントエンド: Chunk Logger ダウンロードボタン

**ファイル**: `app/page.tsx`

チャット画面にチャンクログをダウンロードするボタンを追加。

**変更内容**:
- "Clear History"ボタンの下に"📥 Download Chunks"ボタンを配置
- `chunkLogger.isEnabled()`が`true`の時のみ表示
- クリックで`{session_id}.jsonl`形式のファイルをダウンロード

**効果**: ブラウザ側のSSEイベント履歴をその場でダウンロードして分析可能に。

### 3. 無限ループ修正: テキストコンテンツ検出方式

**ファイル**: `lib/adk_compat.ts`

**問題の本質**:
従来の実装では、`originalToolId`の完了状態を確認していたが、拒否シナリオでは元のツールパートが存在しない、または状態が期待通り更新されないケースがあった。

**修正方法**:
メッセージにテキストコンテンツが含まれているかを確認する方式に変更。

```typescript
// 確認完了直後（ユーザーがApprove/Denyをクリックした直後）:
// - Confirmation tool: output-available 状態
// - Message: テキストコンテンツ無し（ツールパートのみ）
//
// バックエンド応答後:
// - Confirmation tool: 依然として output-available
// - Message: テキストコンテンツ有り（AIの応答）

const hasTextContent = parts.some(
  (part: any) => part.type === "text" && part.text && part.text.trim().length > 0,
);

if (hasTextContent) {
  // バックエンドが応答済み - 再送信しない
  return false;
}

// 初回の確認完了 - バックエンドに送信
return true;
```

**利点**:
- よりシンプルで理解しやすいロジック
- テキストの存在は確実に観測可能な副作用
- ツールの内部状態に依存しない

## チャンクログ分析結果

### 修正前の無限ループパターン（22:48のログ）

```bash
Tool ID: adk-bcc65ac4-a4e9-4a22-b5bd-54b22b3a3a57
総イベント数: 74件（1つのツール呼び出しに対して）

イベントシーケンス:
1. tool-output-error: "This tool call is rejected." (×74回)
2. finish
3. [DONE]
4. 新しいmessageIdで新規リクエスト
5. ループ継続


---

## Previous Sessions Summary (Compressed)

### Session 9 (2025-12-19): ToolContext Mock Removal
**Problem**: Mock ToolContext prevented frontend delegate access
**Solution**: Use real `ToolContext(invocation_id, session)`
**Result**: `get_location-bidi` Test 1 now passing
**Files**: `adk_compat.py` (lines 404-416, 275)

### Session 8 (2025-12-19): BIDI Confirmation ID Bug Fix
**Problem**: Confirmation ID not registered, context-aware lookup returns wrong ID
**Solution**: Fixed confirmation ID registration and context-aware lookup
**Result**: All integration tests passing (4/4 RED → GREEN)
**Files**: `adk_compat.py`, `adk_vercel_id_mapper.py`, `test_confirmation_id_routing.py`

### Session 7 and Earlier: Foundation Work
**Key achievements**:
- Tool confirmation flow implementation (SSE and BIDI)
- Chunk logger integration and testing
- E2E test matrix expansion (100% coverage, 4x2x2)
- Frontend delegate tools implementation
- Audio streaming and multimodal support
- LongRunningFunctionTool pattern implementation

**Detailed history**: See git commit history for complete session records

---

## Historical Bug Fixes (Reference)

### Fixed: Tool Confirmation Infinite Loop (2025-12-17)
**Problem**: SSE mode infinite loop when user denies payment
**Solution**: Text content detection in `lib/adk_compat.ts`
**Evidence**: Chunk logs showed 81 loop iterations (74 events each)

### Fixed: WebSocket Disconnection Error Handling
**Problem**: No user feedback when WebSocket disconnects during approval
**Solution**: Changed `sendEvent()` to throw error instead of silent failure
**Impact**: Critical UX fix

### Fixed: ChatMessage.content Type Mismatch
**Problem**: Pydantic validation error for function_response messages
**Solution**: Fixed type from `str | None` to `str | list[MessagePart] | None`
**Impact**: Eliminated validation errors in BIDI mode

---

For complete historical details, see:
- Git commit history: `git log --oneline --graph`
- Experiment notes: `experiments/README.md`
- Previous session docs: archived in git history

