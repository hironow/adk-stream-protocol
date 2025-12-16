# Phase 5: ADK Tool Confirmation Simplification Plan

**Date**: 2025-12-17
**Status**: 🟡 Planning

## Background

Phase 5で実装したADK Tool Confirmation機能が複雑すぎて、`originalFunctionCall`を運ぶ実装になっている。
ADKの仕様（`assets/adk/action-confirmation.txt`）を読み直したところ、**これは不要な複雑さ**であることが判明。

## Current Problems

1. **不要な`originalFunctionCall`の運搬**
   - `lib/adk_compat.ts` (line 139): `originalFunctionCall`を抽出して送信
   - `ai_sdk_v6_compat.py` (line 395-396): `originalFunctionCall`を取得して処理
   - ADKの仕様では`id`フィールドだけでツール呼び出しを識別するため、`originalFunctionCall`全体を運ぶ必要がない

2. **既に持っているIDを再取得している**
   - `part.tool_call_id`で既にIDを持っているのに、`originalFunctionCall.id`から取得しようとしている
   - これにより`originalFunctionCall`が`undefined`の場合にエラーになる

3. **複雑なデータ構造**
   ```typescript
   // 現在（複雑）
   output: {
     originalFunctionCall: {...},  // 不要！
     toolConfirmation: { confirmed: true }
   }

   // ADKの仕様（シンプル）
   output: { confirmed: true }
   ```

## ADK Specification (assets/adk/action-confirmation.txt)

ADKが期待する確認応答フォーマット（line 182-202）:

```json
{
  "function_response": {
    "id": "adk-13b84a8c-c95c-4d66-b006-d72b30447e35",
    "name": "adk_request_confirmation",
    "response": {
      "confirmed": true
    }
  }
}
```

**重要なポイント**:
- `id`: RequestConfirmationの`function_call_id`と一致（これは`tool_call_id`と同じ）
- `name`: `"adk_request_confirmation"`
- `response`: `{"confirmed": true/false}` **だけ**で良い

## Solution: Simplify to ADK Specification

### Principle

1. **ADKの仕様に厳密に従う** - 不要な情報を運ばない
2. **既に持っている情報を再利用** - `tool_call_id`を直接使う
3. **データフローをシンプルに** - Frontend → Backend → ADKの変換を最小限に

### Data Flow

```
ADK RequestConfirmation
  ↓ (tool_call_id="adk-xxxxx")
Backend (stream_protocol.py)
  ↓ (toolCallId="adk-xxxxx")
Frontend (tool-invocation.tsx)
  ↓ (confirmed=true, toolCallId="adk-xxxxx")
Backend (ai_sdk_v6_compat.py)
  ↓ (id="adk-xxxxx", confirmed=true)
ADK FunctionResponse
```

## Architecture Overview: Tool Confirmation Flow

### Current Data Flow (Complex)

```
ADK RequestConfirmation
  ↓ (function_call with args)
stream_protocol.py
  ↓ (toolCallId, toolName, input={originalFunctionCall: {...}})
Frontend receives tool-input-available event
  ↓
components/chat.tsx (useChat hook)
  ↓ (addToolOutput, addToolApprovalResponse)
components/message.tsx
  ↓ (passes props down)
components/tool-invocation.tsx
  ↓ (User clicks Approve button)
lib/adk_compat.ts::createAdkConfirmationOutput
  ↓ (tries to extract originalFunctionCall from input - FAILS)
addToolOutput({ tool, toolCallId, output: {originalFunctionCall: undefined, toolConfirmation: {confirmed: true}} })
  ↓
server.py (receives assistant message with tool output)
  ↓ (Phase 5: Detects adk_request_confirmation)
ai_sdk_v6_compat.py::ChatMessage.to_adk_content()
  ↓ (tries to extract originalFunctionCall.id - FAILS)
ERROR: originalFunctionCall.id is None
```

### Simplified Data Flow (Target)

```
ADK RequestConfirmation
  ↓ (function_call with tool_call_id="adk-xxxxx")
stream_protocol.py
  ↓ (toolCallId="adk-xxxxx", toolName, input={...})
Frontend receives tool-input-available event
  ↓
components/chat.tsx (useChat hook)
  ↓ (addToolOutput from useChat)
components/message.tsx
  ↓ (passes addToolOutput down)
components/tool-invocation.tsx
  ↓ (User clicks Approve button)
lib/adk_compat.ts::createAdkConfirmationOutput
  ↓ (simple: just confirmed=true)
addToolOutput({ tool, toolCallId: "adk-xxxxx", output: {confirmed: true} })
  ↓
server.py (receives assistant message with tool output)
  ↓ (Phase 5: Detects adk_request_confirmation)
ai_sdk_v6_compat.py::ChatMessage.to_adk_content()
  ↓ (uses part.tool_call_id directly, extracts confirmed from output)
ADK FunctionResponse(id="adk-xxxxx", name="adk_request_confirmation", response={"confirmed": true})
  ↓
ADK continues workflow
```

## Related Files and Their Roles

### Python Backend Files

1. **`server.py`** (Phase 5 modification at line 336-372)
   - **Role**: HTTP endpoint that receives UI messages and routes to ADK
   - **Current Issue**: Phase 5 added assistant message handling, but it depends on `originalFunctionCall` in output
   - **Required Change**: No change needed (already handles assistant messages correctly)
   - **Status**: ✅ Already fixed in previous session

2. **`ai_sdk_v6_compat.py`** (line 388-419)
   - **Role**: Converts AI SDK v6 messages to ADK Content format
   - **Current Issue**: Tries to extract `originalFunctionCall` from output, uses complex nested structure
   - **Required Change**: Use `part.tool_call_id` directly, extract `confirmed` from `output` (not `output.toolConfirmation.confirmed`)
   - **Status**: ❌ Needs simplification

3. **`stream_protocol.py`** (line 480-539)
   - **Role**: Converts ADK events to AI SDK v6 SSE format
   - **Current Issue**: Debug logging added at line 504-506
   - **Required Change**: Remove debug logging
   - **Status**: ⚠️ Cleanup needed (Phase 4)

4. **`adk_compat.py`**
   - **Role**: Session management for ADK
   - **Tool Confirmation Involvement**: None (no changes needed)
   - **Status**: ✅ No changes required

### TypeScript Frontend Files

1. **`lib/adk_compat.ts`** (line 37-73, 134-149)
   - **Role**: Provides ADK-specific utilities
     - `sendAutomaticallyWhenAdkConfirmation`: Detects when to auto-send after confirmation
     - `createAdkConfirmationOutput`: Creates output object for `addToolOutput`
   - **Current Issue**:
     - `createAdkConfirmationOutput` extracts `originalFunctionCall` from `toolInvocation.input` (undefined)
     - Returns complex nested structure
   - **Required Change**: Simplify to return just `{ confirmed: boolean }`
   - **Status**: ❌ Needs simplification

2. **`lib/build-use-chat-options.ts`** (line 6, 239, 252)
   - **Role**: Configures `useChat` hook options based on backend mode
   - **Tool Confirmation Involvement**:
     - Imports `sendAutomaticallyWhenAdkConfirmation`
     - Sets it as `sendAutomaticallyWhen` option for adk-sse and adk-bidi modes
   - **Required Change**: None (uses simplified function from `lib/adk_compat.ts`)
   - **Status**: ✅ No changes required (depends on lib/adk_compat.ts)

3. **`components/chat.tsx`** (line 3, 44-63, 79, 230, 240)
   - **Role**: Main chat component
     - Calls `buildUseChatOptions` to get options
     - Uses `useChat` hook which provides `addToolOutput`, `addToolApprovalResponse`
     - Implements `onToolCall` for client-side tool execution (e.g., change_bgm)
     - Passes `addToolOutput` down to MessageComponent
   - **Tool Confirmation Involvement**:
     - `useChat` provides `addToolOutput` function (line 60)
     - Passes it to `MessageComponent` which passes to `ToolInvocationComponent`
   - **Required Change**: None (just passes props through)
   - **Status**: ✅ No changes required

4. **`components/message.tsx`** (line 58-73, 383, 413, 641)
   - **Role**: Renders individual messages
     - Receives `addToolOutput`, `addToolApprovalResponse` from Chat component
     - Passes them to `ToolInvocationComponent` for each tool invocation
   - **Tool Confirmation Involvement**: Props passthrough
   - **Required Change**: None (just passes props through)
   - **Status**: ✅ No changes required

5. **`components/tool-invocation.tsx`** (line 43-48, 127-200, 156-176)
   - **Role**: Renders tool invocation UI with approval buttons
   - **Current Issue**:
     - ADK-specific approval UI (line 127-200) that checks `isAdkConfirmation`
     - Approve button calls `createAdkConfirmationOutput` with debug logging (line 156-176)
   - **Required Change**:
     - Remove ADK-specific UI (line 43-48, 127-200) - not needed, standard tool UI is sufficient
     - Remove debug logging (line 162-174)
   - **Status**: ⚠️ Needs cleanup (Phase 3 & 4)

### Test Files to Update

1. **`tests/unit/test_ai_sdk_v6_compat.py`** (line 773-837)
   - Tests: `test_adk_request_confirmation_approved`, `test_adk_request_confirmation_denied`
   - **Required Change**: Update output format to `{"confirmed": true}` instead of nested structure
   - **Status**: ❌ Needs update

2. **`lib/adk_compat.test.ts`** (line 580-671)
   - **Tests for `createAdkConfirmationOutput`**:
     - Line 581-607: Test with `originalFunctionCall` in input (approved case)
     - Line 609-635: Test with `originalFunctionCall` in input (denied case)
     - Line 637-653: Test missing `originalFunctionCall` (returns undefined)
     - Line 655-671: Test missing `input` entirely (returns undefined)
   - **Required Change**:
     - Remove all `originalFunctionCall` assertions from output
     - Test that output is `{confirmed: boolean}` only
     - Remove tests for missing `originalFunctionCall` (no longer relevant)
   - **Tests for `sendAutomaticallyWhenAdkConfirmation`**:
     - Line 203-482: Many tests reference `originalFunctionCall` in test data
     - **No change needed**: Function doesn't inspect `originalFunctionCall`, just checks for tool state
   - **Status**: ❌ Needs update

3. **`e2e/adk-tool-confirmation.spec.ts`**
   - **Role**: E2E test for the complete confirmation flow
   - **Tool Confirmation Involvement**: Tests detection of `adk_request_confirmation completed` log
   - **Required Change**: None (tests behavior, not data structure)
   - **Status**: ✅ No changes required

## Files to Modify

### 1. `lib/adk_compat.ts` (line 134-149)

**Before**:
```typescript
export function createAdkConfirmationOutput(
  toolInvocation: any,
  confirmed: boolean
): { tool: string; toolCallId: string; output: unknown } {
  const originalToolCall = toolInvocation.input?.originalFunctionCall;

  return {
    tool: "adk_request_confirmation",
    toolCallId: toolInvocation.toolCallId,
    output: {
      originalFunctionCall: originalToolCall,  // ❌ 不要
      toolConfirmation: { confirmed },          // ❌ ネストが不要
    },
  };
}
```

**After**:
```typescript
export function createAdkConfirmationOutput(
  toolInvocation: any,
  confirmed: boolean
): { tool: string; toolCallId: string; output: unknown } {
  return {
    tool: "adk_request_confirmation",
    toolCallId: toolInvocation.toolCallId,
    output: { confirmed },  // ✅ シンプル！
  };
}
```

### 2. `ai_sdk_v6_compat.py` (line 388-419)

**Before**:
```python
if part.tool_name == "adk_request_confirmation" and part.state == ToolCallState.OUTPUT_AVAILABLE:
    if part.output and isinstance(part.output, dict):
        tool_confirmation = part.output.get("toolConfirmation", {})  # ❌ ネストが不要
        confirmed = tool_confirmation.get("confirmed", False)

        # ❌ originalFunctionCallを取得（不要）
        original_function_call = part.output.get("originalFunctionCall", {})
        original_id = original_function_call.get("id") if isinstance(original_function_call, dict) else None

        if original_id:
            function_response = types.FunctionResponse(
                id=original_id,  # ❌ 複雑な取得方法
                name="adk_request_confirmation",
                response={"confirmed": confirmed}
            )
            adk_parts.append(types.Part(function_response=function_response))
        else:
            logger.error(...)  # ❌ エラーになる可能性
```

**After**:
```python
if part.tool_name == "adk_request_confirmation" and part.state == ToolCallState.OUTPUT_AVAILABLE:
    if part.output and isinstance(part.output, dict):
        confirmed = part.output.get("confirmed", False)  # ✅ シンプル！

        logger.info(
            f"[ADK Confirmation] Converting AI SDK tool output to ADK FunctionResponse "
            f"(id={part.tool_call_id}, confirmed={confirmed})"
        )

        function_response = types.FunctionResponse(
            id=part.tool_call_id,  # ✅ 既に持っている！
            name="adk_request_confirmation",
            response={"confirmed": confirmed}
        )
        adk_parts.append(types.Part(function_response=function_response))
    else:
        logger.warning(
            f"[ADK Confirmation] Invalid output format for adk_request_confirmation: {part.output}"
        )
```

### 3. `components/tool-invocation.tsx` (line 126-199)

**ADK Confirmation UI部分は削除**

現在のコードでは2つの承認UIがある：
1. AI SDK v6標準の`approval-requested`状態（line 203-289）
2. ADK専用の`isAdkConfirmation`チェック（line 127-200）

ADKの`adk_request_confirmation`は普通のtool callとして扱われるため、**ADK専用UIは不要**。
AI SDK v6標準のtool call UIで十分表示される。

**削除対象**:
- line 43-48: `isAdkConfirmation`チェック
- line 127-200: ADK専用の承認UI

**理由**: `adk_request_confirmation`は他のtoolと同じように`tool-adk_request_confirmation`として表示され、
`input`と`output`が自動的に表示される。特別なUIは不要。

### 4. Debug Logging (追加したもの)

以下の一時的なデバッグコードを削除：
- `stream_protocol.py` (line 504-506): デバッグログ
- `components/tool-invocation.tsx` (line 162-174): デバッグログ

## Test Updates Required

### Python Unit Tests (`tests/unit/test_ai_sdk_v6_compat.py`)

**修正が必要なテスト**:

1. `test_adk_request_confirmation_approved` (line 773-804)
2. `test_adk_request_confirmation_denied` (line 805-837)

**Before**:
```python
output={
    "originalFunctionCall": {...},  # ❌ 削除
    "toolConfirmation": {"confirmed": True},  # ❌ ネスト削除
},
```

**After**:
```python
output={"confirmed": True},  # ✅ シンプル！
```

### TypeScript Unit Tests (`tests/unit/adk_compat.test.ts`)

**修正が必要なテスト**:

1. `createAdkConfirmationOutput`のテスト
   - `originalFunctionCall`の検証を削除
   - `output.confirmed`が直接設定されることを検証

## Expected Results

### Before (Current)
```
Frontend sends:
{
  tool: "adk_request_confirmation",
  toolCallId: "adk-xxxxx",
  output: {
    originalFunctionCall: undefined,  // ❌ エラー原因
    toolConfirmation: { confirmed: true }
  }
}

Backend tries to extract:
original_id = output["originalFunctionCall"]["id"]  // ❌ undefined["id"] → Error
```

### After (Fixed)
```
Frontend sends:
{
  tool: "adk_request_confirmation",
  toolCallId: "adk-xxxxx",
  output: { confirmed: true }  // ✅ シンプル！
}

Backend uses directly:
id = part.tool_call_id  // ✅ 既に持っている
confirmed = output["confirmed"]  // ✅ 直接取得
```

## Migration Strategy

### Phase 1: Backend Simplification (Safe)
1. `ai_sdk_v6_compat.py` を修正
   - `part.tool_call_id`を直接使用
   - `originalFunctionCall`の取得を削除
   - `toolConfirmation`のネストを削除し、直接`confirmed`を取得
2. Python unit testsを修正
3. すべてのPython testsがパスすることを確認

### Phase 2: Frontend Simplification (Breaking Change)
1. `lib/adk_compat.ts` の`createAdkConfirmationOutput`を修正
   - `originalFunctionCall`の抽出を削除
   - `toolConfirmation`のネストを削除
2. TypeScript unit testsを修正
3. E2E testを実行して動作確認

### Phase 3: UI Cleanup (Optional)
1. `components/tool-invocation.tsx`のADK専用UIを削除
2. 標準のtool invocation UIで表示されることを確認

### Phase 4: Debug Code Removal
1. 追加したデバッグログを削除
2. 最終的なE2E testで動作確認

## Risk Assessment

### Low Risk ✅
- Backend simplification (Phase 1)
  - 既存のunit testsで保護されている
  - `tool_call_id`は確実に存在する

### Medium Risk ⚠️
- Frontend simplification (Phase 2)
  - データ構造の変更
  - E2E testで検証必要

### Low Risk ✅
- UI cleanup (Phase 3)
  - 標準UIで代替可能
  - 視覚的な変更のみ

## Success Criteria

1. ✅ All Python unit tests pass (32 tests)
2. ✅ All TypeScript unit tests pass (260 tests)
3. ✅ E2E test passes without infinite loop
4. ✅ Agent continues after approval and completes payment
5. ✅ Code is significantly simpler and follows ADK specification

## Next Steps

1. Review this plan with team
2. Get approval to proceed
3. Execute Phase 1 (Backend simplification)
4. Execute Phase 2 (Frontend simplification)
5. Execute Phase 3 (UI cleanup) if approved
6. Execute Phase 4 (Debug code removal)
7. Document the simplified architecture

## References

- `assets/adk/action-confirmation.txt` - ADK Tool Confirmation specification
- `experiments/2025-12-17_tool_architecture_refactoring.md` - Phase 5 implementation notes
