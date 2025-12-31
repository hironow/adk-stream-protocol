# Current Implementation Notes

**Last Updated:** 2025-12-31

> **Note**: Historical BIDI mode investigation (2025-12-26/27) has been archived to `last-test-plans.md`. This file now contains only recent implementation notes and current understanding.

---

## AI SDK v6 Stable Release: Approval Flow Changes (2025-01-28)

### Upgrade Context

**Packages Upgraded**:
- `@ai-sdk/google`: `3.0.0-beta.72` → `3.0.1` (stable)
- `@ai-sdk/react`: `3.0.0-beta.151` → `3.0.3` (stable)
- `ai`: `6.0.0-beta.148` → `6.0.3` (stable)

**Impact**: Beta から stable への大規模アップグレード

### Correct Behavior per AI SDK Documentation (vercel/ai DeepWiki)

#### 1. Tool Approval State Management

**AI SDK v6 Stable の承認フロー（正規の挙動）**:

```typescript
// ユーザーが addToolApprovalResponse() を呼び出すと：
result.current.addToolApprovalResponse({
  id: toolCallId,
  approved: true,
  reason: "User approved",  // optional
});

// → Tool part の状態変化（即座にローカルで発生）：
{
  type: "tool-{toolName}",
  state: "approval-responded",  // ✅ 即座に変わる！
  toolCallId: "...",
  input: {...},
  approval: {
    id: toolCallId,
    approved: true,           // ✅ approved フィールドが含まれる
    reason: "User approved",  // ✅ reason も含まれる（optional）
  }
}
```

**Key Points (per DeepWiki vercel/ai documentation)**:

1. **State は即座に変わる**: `addToolApprovalResponse()` を呼ぶと `state` が `"approval-requested"` → `"approval-responded"` に即座に変わる
2. **approval オブジェクトが完全に保存される**: `approval: {id, approved, reason?}` の形で完全に保存される
3. **approved/denied はローカルに保存される**: 承認/却下の決定はローカルの message に保存され、その後バックエンドにも送られる
4. **Backend への送信はその後**: `sendAutomaticallyWhen` が true を返すと、承認情報を含むメッセージがバックエンドに送信される

**Implementation Evidence from vercel/ai repo**:

DeepWiki が示す `packages/ai/src/ui/chat.ts` の実装：

```typescript
const updatePart = (
  part: UIMessagePart<UIDataTypes, UITools>,
): UIMessagePart<UIDataTypes, UITools> =>
  isToolUIPart(part) &&
  part.state === 'approval-requested' &&
  part.approval.id === id
    ? {
        ...part,
        state: 'approval-responded',      // ← state を変更
        approval: { id, approved, reason }, // ← 完全な approval オブジェクト
      }
    : part;

// update the message to trigger an immediate UI update
this.state.replaceMessage(messages.length - 1, {
  ...lastMessage,
  parts: lastMessage.parts.map(updatePart),
});
```

#### 1.1 観測された挙動との相違（要調査）

⚠️ **DISCREPANCY**: 実際のテスト実行では、以下の挙動が観測されている：

```typescript
// デバッグログから（SSE frontend-execute テスト実行時）：
[SSE sendAutomaticallyWhen] No pending approvals. Parts: [
  {
    type: 'tool-get_location',
    state: 'approval-requested',  // ← 'approval-responded' でなく 'approval-requested'
    toolCallId: 'orig-location',
    hasApproval: true             // ← approval オブジェクトは存在
  }
]
```

この観測は DeepWiki の説明と矛盾する。考えられる原因：
1. ADK confirmation flow の特殊な実装？
2. test helper の問題？
3. 実装のバグ？

**TODO**: この相違を詳細に調査する必要がある

#### 2. Type Guards の変更

**廃止された Type Guard**:
```typescript
// ❌ Beta で使われていたが、Stable では機能しない
isApprovalRequestPart(part)
// → 別の "tool-approval-request" という part type を探すが、
//    AI SDK v6 ではそのような別 part は作られない
```

**正しい Type Guards（Stable）**:
```typescript
// ✅ 承認リクエスト待ちのツールを探す
isApprovalRequestedTool(part)
// → type: "tool-{toolName}", state: "approval-requested" を探す

// ✅ ユーザーが承認したツールを探す（DeepWiki per）
isApprovalRespondedTool(part)
// → type: "tool-{toolName}", state: "approval-responded" を探す
```

#### 3. 承認完了の判定方法

**正しいパターン（per DeepWiki）**:
```typescript
// ✅ パターン1: addToolApprovalResponse 直後の state 変化を確認
await act(async () => {
  result.current.addToolApprovalResponse({
    id: toolCallId,
    approved: true,
  });
});

await waitFor(() => {
  const part = msg.parts.find(p => isApprovalRespondedTool(p));
  expect(part).toBeDefined();
  expect(part?.state).toBe("approval-responded");
  expect(part?.approval?.approved).toBe(true);
}, { timeout: 3000 });

// ✅ パターン2: バックエンドからの次の応答を待つ（推奨）
// State は "approval-responded" になっている状態で、backend の応答を待つ
await waitFor(() => {
  const lastMsg = result.current.messages[result.current.messages.length - 1];
  // 次のツール確認リクエストまたは最終レスポンスを待つ
  return lastMsg.parts.some(p => isTextUIPartFromAISDKv6(p) || isApprovalRequestedTool(p));
}, { timeout: 5000 });
```

#### 4. MSW Handler の修正

**正しいパターン（per DeepWiki）**:
```typescript
// ✅ approval.approved フィールドで明示的にチェック
const hasApproval = messages.some(msg =>
  msg.parts.some(part =>
    part.toolCallId === "tool-1" &&
    part.state === "approval-responded" &&
    part.approval?.approved === true
  )
);

// または state だけで判定
const hasApprovedTool = messages.some(msg =>
  msg.parts.some(part =>
    part.toolCallId === "tool-1" &&
    part.state === "approval-responded"
  )
);
```

#### 5. Two-Phase Approval Tracking の必要性

**⚠️ NOTE**: DeepWiki によると、AI SDK v6 では `addToolApprovalResponse` を呼ぶと state が即座に `"approval-responded"` に変わるため、理論的には two-phase tracking は不要のはず。

しかし、実際のテストでは異なる挙動が観測されているため、現在の実装では two-phase tracking を使用している：

```typescript
// lib/bidi/send-automatically-when.ts と lib/sse/send-automatically-when.ts
const receivedApprovalRequests = new Set<string>();

export function sendAutomaticallyWhen({ messages }: { messages: any[] }): boolean {
  const approvalKey = `${messageId}:${toolCallId}`;

  if (!receivedApprovalRequests.has(approvalKey)) {
    // Phase 1: イベント受信 → ユーザーの応答を待つ
    receivedApprovalRequests.add(approvalKey);
    return false;
  }

  // Phase 2: ユーザーが応答済み → バックエンドに送信
  receivedApprovalRequests.delete(approvalKey);
  return true;
}
```

**TODO**: DeepWiki の説明通りに state が変わるなら、two-phase tracking は以下のように単純化できるはず：
```typescript
export function sendAutomaticallyWhen({ messages }: { messages: any[] }): boolean {
  const lastMessage = messages[messages.length - 1];

  // 承認済みツールがあればtrue、なければfalse
  return lastMessage.parts.some(p => isApprovalRespondedTool(p));
}
```

### Migration Guide: Beta to Stable

#### 必要な変更:

1. **Import 修正**:
   ```typescript
   // Before (Beta)
   import { isApprovalRequestPart } from "../../utils";

   // After (Stable)
   import { isApprovalRequestedTool } from "../../utils";
   ```

2. **Type Guard 置換**:
   ```typescript
   // Before
   const part = message.parts.find(p => isApprovalRequestPart(p));

   // After
   const part = message.parts.find(p => isApprovalRequestedTool(p));
   ```

3. **State チェック削除**:
   ```typescript
   // Before
   expect(part?.state).toBe("approval-responded");

   // After
   expect(part?.approval).toBeDefined();
   // または次のバックエンド応答を待つ
   ```

4. **MSW Handler 修正**:
   ```typescript
   // Before
   const hasApproval = part.approval?.approved === true;

   // After
   const hasApproval = part.approval !== undefined;
   ```

### Test Failures After Upgrade

**Failed Tests** (4 tests in `frontend-execute-bidi.e2e.test.tsx`):
1. "should execute tool on frontend and send result with addToolOutput"
2. "should handle frontend execution failure"
3. "should handle user denying frontend tool execution"
4. "should handle two sequential tool approvals (Alice → Bob)"

**Root Cause**: これらのテストはまだ Beta の動作を前提にしている：
- `isApprovalRequestPart` を使用
- `state === "approval-responded"` をチェック
- `approval.approved` フィールドを期待

**Fix Required**: SSE テストと同じパターンで修正する必要がある

### Conclusion

AI SDK v6 の Beta → Stable アップグレードで、承認フローの実装の細部が変更されました：

1. ✅ **Tool part の構造は変わらない**: type, state, toolCallId, input, approval
2. ✅ **approval オブジェクトの内容が変更**: `{id, approved}` → `{id}` のみ
3. ✅ **状態遷移のタイミングが変更**: ローカルでは `approval-requested` のまま、バックエンド応答で変化
4. ✅ **Two-phase tracking は引き続き必要**: イベント到着時に approval オブジェクトが追加されるため

**Next Steps**:
1. ✅ frontend-execute-bidi テストを SSE と同じパターンで修正
2. ✅ すべての `approval-responded` チェックを削除
3. ✅ MSW handler を approval オブジェクト存在チェックに変更

---

## SSE Mode Complete Fix (2025-01-29)

### Executive Summary

**All previous documentation about "state doesn't change" was INCORRECT.** The root cause of all test failures was using **wrong ID parameter** in `addToolApprovalResponse()`.

### The Critical Discovery

#### ❌ WRONG (What we were doing):
```typescript
result.current.addToolApprovalResponse({
  id: toolCallId,  // ← WRONG! This is the tool's ID
  approved: true,
});
// Result: Nothing happens, state stays "approval-requested"
```

#### ✅ CORRECT (What we should do):
```typescript
result.current.addToolApprovalResponse({
  id: confirmationPart.approval.id,  // ← CORRECT! Use approval.id
  approved: true,
});
// Result: State changes to "approval-responded" immediately
```

### AI SDK v6 Stable: Actual Behavior (Verified)

When using **correct** `approval.id`:

1. **State changes immediately**: `"approval-requested"` → `"approval-responded"`
2. **Approval object becomes complete**: `{id, approved, reason?}`
3. **DeepWiki documentation is accurate**: All documented behavior works correctly

#### Tool Part Structure After Approval (Correct):

```typescript
{
  type: "tool-{toolName}",
  state: "approval-responded",  // ✅ Changes immediately!
  toolCallId: "orig-123",
  input: {...},
  approval: {
    id: "approval-id",
    approved: true,           // ✅ Complete object!
    reason: undefined,
  }
}
```

### Complete SSE Fix Summary

#### Files Fixed:

1. **lib/sse/send-automatically-when.ts**
   - ✅ Simplified: Removed two-phase tracking
   - ✅ Simple state check: `isApprovalRespondedTool(part)`
   - ✅ No complex tracking needed

2. **lib/tests/e2e/frontend-execute-sse.e2e.test.tsx**
   - ✅ Changed all `addToolApprovalResponse` calls to use `approval.id`
   - ✅ Updated waitFor to check for `approval-responded` state
   - ✅ All 3 tests passing

3. **lib/tests/integration/sse-integration.test.ts**
   - ✅ Updated expectations to reflect correct state transitions
   - ✅ Created separate message states for "waiting" vs "approved"
   - ✅ All 6 tests passing

4. **lib/tests/e2e/sse-use-chat.e2e.test.tsx**
   - ✅ Fixed all 9 `addToolApprovalResponse` calls to use `approval.id`
   - ✅ Changed state expectations from `"approval-requested"` to `"approval-responded"`
   - ✅ Updated checks from `approval !== undefined` to `isApprovalRespondedTool()`
   - ✅ All 9 tests passing

### Test Results: SSE Mode

**Total: 18/18 SSE tests PASSING ✅**

- Integration tests: 6/6 ✅
- Frontend-execute tests: 3/3 ✅
- Use-chat E2E tests: 9/9 ✅

### Key Patterns for SSE Mode

#### 1. User Approval Pattern:
```typescript
// Find the confirmation part
const confirmationPart = message.parts.find(p => isApprovalRequestedTool(p));

// Use approval.id (NOT toolCallId!)
result.current.addToolApprovalResponse({
  id: confirmationPart.approval.id,  // ← CRITICAL
  approved: true,
});

// Wait for state change
await waitFor(() => {
  const part = msg.parts.find(p => isApprovalRespondedTool(p));
  expect(part).toBeDefined();
  expect(part.state).toBe("approval-responded");
});
```

#### 2. sendAutomaticallyWhen Pattern:
```typescript
export function sendAutomaticallyWhen({ messages }): boolean {
  const lastMessage = messages[messages.length - 1];
  const parts = lastMessage.parts || [];

  // Check 1: Has text? → Backend responded, don't send
  if (parts.some(p => isTextUIPartFromAISDKv6(p))) {
    return false;
  }

  // Check 2: Has approval-responded tool? → Continue
  const hasApprovedTool = parts.some(p => isApprovalRespondedTool(p));
  if (!hasApprovedTool) {
    return false;
  }

  // Check 3: Has pending approvals? → Wait
  if (parts.some(p => isApprovalRequestedTool(p))) {
    return false;
  }

  // Check 4: Has errors? → Backend responded, don't send
  if (parts.some(p => isOutputErrorTool(p))) {
    return false;
  }

  // Check 5: Has tool output? → Frontend execute, send!
  if (parts.some(p => isOutputAvailableTool(p) && p.output)) {
    return true;
  }

  // Default: Server execute, send approval!
  return true;
}
```

#### 3. Request Payload Expectations:
```typescript
// After user approves, request payload should have:
expect(payload).toMatchObject({
  messages: [{
    role: "assistant",
    parts: [{
      type: "tool-search_web",
      state: "approval-responded",  // ← NOT "approval-requested"!
      toolCallId: "orig-123",
      approval: {
        id: "approval-id",
        approved: true,
        reason: undefined,
      }
    }]
  }]
});
```

### Lessons Learned

1. **Always use `approval.id`**: Never use `toolCallId` for `addToolApprovalResponse()`
2. **Trust AI SDK documentation**: DeepWiki was correct, our test code was wrong
3. **State DOES change locally**: When using correct ID, AI SDK v6 behaves exactly as documented
4. **Two-phase tracking NOT needed**: State transition is sufficient indicator
5. **Verification tests are valuable**: Creating `approval-state-verification.test.tsx` revealed the truth

### What Was Wrong Previously

#### ❌ Incorrect Conclusions (from previous documentation):
1. "State stays `approval-requested` locally" - **FALSE**
2. "Approval object only has `{id}`" - **FALSE**
3. "Two-phase tracking is required" - **FALSE**
4. "DeepWiki documentation doesn't match reality" - **FALSE**

#### ✅ Correct Understanding:
1. State changes to `approval-responded` immediately when using correct `approval.id`
2. Approval object becomes complete `{id, approved, reason?}` after user response
3. Simple state-based logic is sufficient (no two-phase tracking needed)
4. DeepWiki documentation is accurate - we were using wrong ID!

### Status

✅ **SSE Mode: COMPLETE**
- All 18 SSE tests passing
- sendAutomaticallyWhen simplified
- Test patterns established
- Documentation updated

🔄 **BIDI Mode: PENDING**
- Multi-tool test is in BIDI mode (skipped for now)
- Likely needs same fixes (use `approval.id`, check for `approval-responded`)
- To be addressed separately
