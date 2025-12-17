# ADK BIDI Mode Issues Resolution Plan

**Date:** 2025-12-17
**Status:** 🟡 Planning → Implementation
**Related:** `BUG-ADK-BIDI-TOOL-CONFIRMATION.md`

---

## 🎯 Goals

Resolve ADK BIDI mode critical issues by implementing frontend tool delegate pattern:

1. **Issue 1:** Tool confirmation not working in BIDI mode (ADK limitation)
2. **Issue 2:** Client-side tool approval not supported in either SSE/BIDI mode
3. **Issue 3:** Missing text response after tool execution in BIDI mode (separate investigation)

---

## 📐 Design Principles

### 1. Single Pipeline Principle
- すべての処理は `stream_protocol.py` を経由
- Manual event injectionは避ける（stream_converterの外に別経路を作らない）
- ADK Events → stream_protocol.py → AI SDK v6 Events の一本道

### 2. Gradual Complexity Increase
- 3つのCheckpointで段階的に機能追加
- 各Checkpointで動作確認してから次へ進む
- 問題発生時の切り分けが容易

### 3. Test-Driven with Mock + Spy
- Unit Tests: Mock + Spy でcall回数・順序を厳密にテスト
- Integration Tests: 最小限のmockでpipeline全体をテスト
- E2E Tests: 実際のUI動作確認（mockなし）

---

## 🔧 Implementation Mechanism

### tool_context["temp:delegate"] Pattern

**Overview:**
ADK ToolContext の `temp` dictionary を使ってfrontend delegateを渡す。

**Code Pattern:**
```python
# Delegate creation and injection
delegate = FrontendToolDelegate(websocket=ws)
tool_context = ToolContext()
tool_context["temp:delegate"] = delegate

# Tool function usage
async def some_tool(tool_context: ToolContext) -> dict:
    delegate = tool_context["temp:delegate"]
    result = await delegate.execute("tool_name", params)
    return result
```

### ADK SSE vs BIDI Delegate Lifecycle

**ADK SSE (Global Delegate):**
- アプリケーション起動時にグローバルdelegate作成
- すべてのSSE requestで共有
- Session-specificな情報はcallback引数で渡す

**ADK BIDI (Per-Connection Delegate):**
- WebSocket接続確立時にsession単位でdelegate作成
- 接続ごとに独立したdelegate instance
- WebSocket切断時にcleanup

**Reference Implementation:**
以前のfrontend delegate実装を参考にする（完全に同じである必要はない）

---

## 📋 3-Checkpoint Implementation Plan

### Checkpoint 1: change_bgm - BIDI Mode Delegate Only

**Objective:** SSE/BIDI互換性の基本確認

**Implementation Scope:**
- `change_bgm` をBIDI modeのみdelegateパターンに変更
- SSE modeは従来通り（delegateなし）
- Frontend delegateの基本実装

**Files to Modify:**
1. `adk_ag_tools.py` - change_bgm function signature変更
2. `adk_ag_runner.py` - BIDI agentにdelegate injection
3. `server.py` - BIDI mode delegate作成・設定
4. `components/tool-invocation.tsx` - change_bgm delegate handler
5. `tests/unit/test_adk_ag_tools.py` - Mock + Spy tests

**Test Strategy:**
```python
# Unit Test with Spy
async def test_change_bgm_bidi_mode_delegates_once(mocker):
    """BIDI mode: change_bgm calls delegate exactly once"""
    mock_delegate = mocker.AsyncMock()
    mock_context = ToolContext()
    mock_context["temp:delegate"] = mock_delegate

    await change_bgm(track=1, tool_context=mock_context)

    # Spy verification
    assert mock_delegate.execute.call_count == 1
    call_args = mock_delegate.execute.call_args
    assert call_args[0][0] == "change_bgm"
    assert call_args[0][1] == {"track": 1}

async def test_change_bgm_sse_mode_no_delegate():
    """SSE mode: change_bgm works without delegate"""
    result = await change_bgm(track=1, tool_context=None)
    assert result["success"] is True
```

**Success Criteria:**
- ✅ SSE mode: change_bgm works as before
- ✅ BIDI mode: change_bgm delegates to frontend
- ✅ UI updates correctly in both modes
- ✅ Unit tests: Call count verified (1 call, no duplicates)
- ✅ No unintended backend execution

**Expected Issues:**
- tool_context typing (Optional[ToolContext])
- Delegate async/await handling
- Frontend response parsing

---

### Checkpoint 2: get_location - Both Modes Delegate

**Objective:** Client-side tool approval動作確認（SSE/BIDI共通）

**Implementation Scope:**
- `get_location` を両modeでdelegateパターンに変更
- User approval UIの実装・テスト
- SSE mode global delegate作成

**Files to Modify:**
1. `adk_ag_tools.py` - get_location always requires tool_context
2. `adk_ag_runner.py` - SSE agentにもdelegate injection
3. `server.py` - SSE mode global delegate作成
4. `components/tool-invocation.tsx` - get_location approval UI
5. `tests/unit/test_adk_ag_tools.py` - Approval flow tests

**Test Strategy:**
```python
async def test_get_location_requires_approval_flag(mocker):
    """get_location sends require_approval=True to delegate"""
    mock_delegate = mocker.AsyncMock()
    mock_context = ToolContext()
    mock_context["temp:delegate"] = mock_delegate

    await get_location(tool_context=mock_context)

    # Verify approval flag
    call_args = mock_delegate.execute.call_args[0][1]
    assert call_args.get("require_approval") is True

async def test_get_location_approval_rejected(mocker):
    """get_location handles user rejection gracefully"""
    mock_delegate = mocker.AsyncMock(
        side_effect=ToolApprovalRejected("User denied location access")
    )
    mock_context = ToolContext()
    mock_context["temp:delegate"] = mock_delegate

    with pytest.raises(ToolApprovalRejected):
        await get_location(tool_context=mock_context)
```

**Success Criteria:**
- ✅ SSE mode: get_location delegates with approval
- ✅ BIDI mode: get_location delegates with approval
- ✅ Frontend: Approval UI appears in both modes
- ✅ User can approve/reject
- ✅ Rejection handled gracefully

**Expected Issues:**
- SSE global delegate WebSocket reference
- Approval timeout handling
- Multiple concurrent approval requests

---

### Checkpoint 3: process_payment - BIDI Delegate for Confirmation

**Objective:** Server-side tool confirmation（BIDI workaround）

**Implementation Scope:**
- `process_payment` をBIDI modeのみdelegateパターンに変更
- SSE modeはADK native confirmation継続
- BIDI confirmationのworkaround完成

**Files to Modify:**
1. `adk_ag_tools.py` - process_payment conditional delegate
2. `adk_ag_runner.py` - BIDI agent: FunctionTool wrapper削除
3. `components/tool-invocation.tsx` - process_payment approval UI
4. `tests/unit/test_adk_ag_tools.py` - Confirmation flow tests

**Implementation Detail:**
```python
# adk_ag_tools.py
async def process_payment(
    amount: float,
    recipient: str,
    tool_context: ToolContext | None = None
) -> dict:
    """Process payment with confirmation

    - SSE mode: ADK native confirmation (FunctionTool wrapper)
    - BIDI mode: Frontend delegate (ADK limitation workaround)
    """
    if tool_context and "temp:delegate" in tool_context:
        # BIDI mode - use delegate
        delegate = tool_context["temp:delegate"]
        result = await delegate.execute("process_payment", {
            "amount": amount,
            "recipient": recipient,
            "require_approval": True
        })
        return result
    else:
        # SSE mode - handled by FunctionTool wrapper
        # Actual payment processing after ADK confirmation
        return {
            "success": True,
            "amount": amount,
            "recipient": recipient,
            "transaction_id": f"tx_{uuid.uuid4()}"
        }
```

**ADK Agent Configuration:**
```python
# SSE Agent - Keep FunctionTool wrapper for ADK native confirmation
sse_agent_tools = [
    get_weather,
    FunctionTool(process_payment, require_confirmation=True),  # ADK native
    change_bgm,
    get_location,
]

# BIDI Agent - Remove FunctionTool wrapper, use delegate
bidi_agent_tools = [
    get_weather,
    process_payment,  # With ToolContext for delegate workaround
    change_bgm,
    get_location,
]
```

**Test Strategy:**
```python
async def test_process_payment_sse_mode_adk_native():
    """SSE mode: process_payment uses ADK native confirmation"""
    # No delegate - ADK FunctionTool handles confirmation
    result = await process_payment(
        amount=50.0,
        recipient="Hanako",
        tool_context=None
    )
    assert result["success"] is True

async def test_process_payment_bidi_mode_delegates(mocker):
    """BIDI mode: process_payment delegates with approval"""
    mock_delegate = mocker.AsyncMock(return_value={
        "success": True,
        "transaction_id": "tx_123"
    })
    mock_context = ToolContext()
    mock_context["temp:delegate"] = mock_delegate

    await process_payment(
        amount=50.0,
        recipient="Hanako",
        tool_context=mock_context
    )

    # Verify delegate called with approval flag
    call_args = mock_delegate.execute.call_args[0][1]
    assert call_args["require_approval"] is True
    assert call_args["amount"] == 50.0
```

**Success Criteria:**
- ✅ SSE mode: ADK native confirmation flow works
- ✅ BIDI mode: Frontend delegate confirmation works
- ✅ Same UX in both modes
- ✅ No duplicate confirmation requests
- ✅ Rejection handled correctly

**Expected Issues:**
- SSE/BIDI behavior divergence (acceptable)
- Error message consistency
- Transaction rollback on rejection

---

## 🧪 Testing Strategy

### Unit Tests (Mock + Spy)

**Pattern 1: Exact Call Count Verification**
```python
def test_tool_delegates_exactly_once(mocker):
    """Verify delegate called exactly once"""
    spy = mocker.spy(delegate, 'execute')
    await tool_function(tool_context=context)
    assert spy.call_count == 1
```

**Pattern 2: No Unintended Calls**
```python
def test_no_backend_execution_when_delegating(mocker):
    """Verify backend logic not called when delegating"""
    spy_backend = mocker.spy(backend_module, 'execute')
    await tool_function(tool_context=context)
    spy_backend.assert_not_called()
```

**Pattern 3: Correct Parameters Passed**
```python
def test_delegate_receives_correct_params(mocker):
    """Verify delegate receives expected parameters"""
    mock_delegate = mocker.AsyncMock()
    context["temp:delegate"] = mock_delegate

    await tool_function(param1="value1", tool_context=context)

    call_args = mock_delegate.execute.call_args[0]
    assert call_args[0] == "tool_name"
    assert call_args[1]["param1"] == "value1"
```

### Integration Tests

**Pattern: Full Pipeline with Mocked Delegate**
```python
async def test_full_delegate_pipeline():
    """Test complete flow from ADK event to frontend delegate"""
    # Mock only the final delegate handler
    mock_delegate = AsyncMock()

    # Run through stream_protocol.py conversion
    async for sse_event in stream_adk_to_ai_sdk(adk_events, delegate=mock_delegate):
        # Verify SSE events generated correctly
        assert sse_event.type in ["tool-input-start", "tool-input-available"]

    # Verify delegate called
    assert mock_delegate.execute.call_count == 1
```

### E2E Tests

**Pattern: Real UI Interaction**
```playwright
test('change_bgm in BIDI mode updates UI', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('text=ADK BIDI ⚡');

  // Send message requesting BGM change
  await page.fill('[placeholder="Type your message..."]', 'Change BGM to track 1');
  await page.click('text=Send');

  // Verify UI updated (no approval needed)
  await expect(page.locator('text=🎵 BGM 2')).toBeVisible();
});

test('get_location in SSE mode shows approval UI', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('text=ADK SSE');

  // Send message requesting location
  await page.fill('[placeholder="Type your message..."]', 'What is my location?');
  await page.click('text=Send');

  // Verify approval UI appears
  await expect(page.locator('text=Approve')).toBeVisible();
  await expect(page.locator('text=Reject')).toBeVisible();

  // Approve and verify execution
  await page.click('text=Approve');
  await expect(page.locator('text=Completed')).toBeVisible();
});
```

---

## 📁 File Structure

### Backend Files

```
adk_ag_tools.py              # Tool functions with conditional delegate
adk_ag_runner.py             # Agent configuration with delegate injection
server.py                    # Delegate creation (SSE global, BIDI per-connection)
stream_protocol.py           # Single pipeline (no changes needed)
tests/unit/test_adk_ag_tools.py  # Unit tests with Mock + Spy
```

### Frontend Files

```
components/tool-invocation.tsx   # Delegate handler + Approval UI
lib/adk_compat.ts               # Delegate helper functions
lib/adk_compat.test.ts          # TypeScript unit tests with spy
```

### Test Files

```
tests/unit/test_adk_ag_tools.py     # Python unit tests (Mock + Spy)
lib/adk_compat.test.ts              # TypeScript unit tests (Vitest spy)
e2e/adk-tool-confirmation.spec.ts   # Playwright E2E tests
```

---

## 🚧 Known Risks and Mitigation

### Risk 1: tool_context Typing Complexity

**Risk:** Optional[ToolContext] makes code harder to type-check

**Mitigation:**
- Use type guards: `if tool_context and "temp:delegate" in tool_context:`
- Document behavior clearly in docstrings
- Add runtime validation in tool functions

### Risk 2: SSE Global Delegate WebSocket Reference

**Risk:** SSE uses HTTP, not WebSocket - how to send delegate responses?

**Mitigation:**
- Use Server-Sent Events channel for responses
- Store pending delegate requests with request IDs
- Client polls or waits for SSE events

### Risk 3: Delegate Response Timeout

**Risk:** User never approves/rejects, request hangs

**Mitigation:**
- Implement timeout (e.g., 60 seconds)
- Return error to AI on timeout
- Clear pending requests on timeout

### Risk 4: Issue 3 (Missing Text) Remains

**Risk:** Delegate doesn't fix missing AI text response in BIDI

**Status:** **Expected** - Issue 3 is separate from delegate pattern

**Next Steps:**
- Complete delegate implementation first
- Investigate Issue 3 separately (agent instructions, RunConfig, model)
- Worst case: Document SSE mode as recommended

---

## 📊 Progress Tracking

### Checkpoint 1: change_bgm (BIDI Delegate)
- [ ] Backend: adk_ag_tools.py change_bgm signature
- [ ] Backend: adk_ag_runner.py BIDI delegate injection
- [ ] Backend: server.py BIDI delegate creation
- [ ] Frontend: tool-invocation.tsx change_bgm handler
- [ ] Tests: Unit tests with Mock + Spy
- [ ] Tests: Integration test
- [ ] Tests: E2E test
- [ ] Verify: SSE mode unchanged
- [ ] Verify: BIDI mode delegates correctly

### Checkpoint 2: get_location (Both Modes)
- [ ] Backend: adk_ag_tools.py get_location requires context
- [ ] Backend: adk_ag_runner.py SSE delegate injection
- [ ] Backend: server.py SSE global delegate
- [ ] Frontend: tool-invocation.tsx approval UI
- [ ] Tests: Approval flow unit tests
- [ ] Tests: Rejection handling tests
- [ ] Tests: E2E approval UI test
- [ ] Verify: Both modes show approval
- [ ] Verify: Approval/rejection works

### Checkpoint 3: process_payment (BIDI Delegate)
- [ ] Backend: adk_ag_tools.py conditional delegate
- [ ] Backend: adk_ag_runner.py remove BIDI FunctionTool
- [ ] Frontend: tool-invocation.tsx payment approval
- [ ] Tests: SSE native confirmation test
- [ ] Tests: BIDI delegate confirmation test
- [ ] Tests: E2E comparison test
- [ ] Verify: SSE uses ADK native
- [ ] Verify: BIDI uses delegate
- [ ] Verify: Same UX in both modes

---

## 🎯 Success Criteria (Final)

**Checkpoint 1 Complete:**
- ✅ change_bgm works in both SSE and BIDI modes
- ✅ BIDI mode uses delegate, SSE mode does not
- ✅ All tests passing (unit + integration + E2E)

**Checkpoint 2 Complete:**
- ✅ get_location works in both SSE and BIDI modes
- ✅ Both modes show approval UI
- ✅ User can approve/reject in both modes
- ✅ All tests passing

**Checkpoint 3 Complete:**
- ✅ process_payment works in both SSE and BIDI modes
- ✅ SSE uses ADK native confirmation
- ✅ BIDI uses frontend delegate
- ✅ Same UX in both modes
- ✅ All tests passing

**Overall Success:**
- ✅ Issue 1 (BIDI confirmation) resolved via delegate
- ✅ Issue 2 (client-side approval) resolved via delegate
- ⏳ Issue 3 (missing text) separate investigation
- ✅ All 4 tools working in both modes
- ✅ Single pipeline principle maintained
- ✅ Test coverage: unit (mock+spy) + integration + E2E

---

## 📝 Notes

- **迷ったらこのplanに戻る**: Implementation中に不明点があればここを参照
- **段階的に進める**: 各Checkpointを完全に終えてから次へ
- **Test-Driven**: Mock + Spy で厳密にテストしながら進める
- **以前の実装を参考**: 完全に同じである必要はない、必要な部分を採用

---

## 🔗 Related Documents

- `BUG-ADK-BIDI-TOOL-CONFIRMATION.md` - 問題の詳細分析
- `agents/tasks.md` - 全体タスク管理
- `agents/handsoff.md` - セッション記録
- `experiments/2025-12-17_tool_architecture_refactoring.md` - 実験記録
