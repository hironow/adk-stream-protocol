# Technical Details - AI SDK v6 Integration

このドキュメントでは、プロジェクトで使用しているAI SDK v6の技術的な詳細、特にツール実行の自動送信機能について説明します。

---

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

### Scenario 1: Tool with Approval Only

**State:**
```javascript
parts: [
  { toolCallId: "1", state: "approval-responded" }
]
```

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ✅ **Auto-submit** | Condition 1: ✅ Condition 2: ✅ |
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

### Scenario 3: Mixed - Approval + Output

**State:**
```javascript
parts: [
  { toolCallId: "1", state: "approval-responded" },
  { toolCallId: "2", state: "output-available", output: {...} }
]
```

| Function | Result | Reason |
|----------|--------|--------|
| `...WithApprovalResponses` | ✅ **Auto-submit** | Condition 1: ✅ Condition 2: ✅ |
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
| **承認のみで送信** | ✅ Yes | ❌ No |
| **出力のみで送信** | ❌ No | ✅ Yes |
| **混在で送信** | ✅ Yes | ⚠️ Depends |
| **ユースケース** | Frontend-delegated | Server-side |
| **このプロジェクト** | ✅ 使用中 | - |

### Design Decision

このプロジェクトでは**セキュリティとユーザー体験**を重視し、`lastAssistantMessageIsCompleteWithApprovalResponses`を採用しています。

**Key Benefits:**
- ✅ ユーザーに明示的な制御権を与える
- ✅ プライバシー保護（位置情報など）
- ✅ 予期しない動作を防ぐ（BGM変更など）
- ✅ AI SDK v6標準APIとの完全な互換性

---

## References

- **AI SDK v6 Documentation**: https://sdk.vercel.ai/docs
- **Source Code**: `node_modules/ai/dist/index.mjs:11342-11383`
- **Our Implementation**: `lib/build-use-chat-options.ts`
- **Integration Tests**: `lib/use-chat-integration.test.tsx`
- **Experiment Notes**: `experiments/2025-12-13_lib_test_coverage_investigation.md`
- **Critical Lessons**: `experiments/README.md` - "Integration Testing: Critical Lessons"
