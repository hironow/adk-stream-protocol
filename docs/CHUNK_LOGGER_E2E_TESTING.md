# Chunk Logger E2E Testing Guide

## 概要

チャンクロガーは、ADK AI Data Protocolのデータフロー全体を記録・検証するためのデバッグツールです。このドキュメントでは、E2Eテストにおけるチャンクロガーの活用方法と統合テストについて説明します。

## チャンクロガーの3層構造

### 1. Backend ADK Events (`chunk_logs/{session_id}/backend-adk-event.jsonl`)

ADKエージェントから直接出力される生イベントを記録します。

**記録内容**:

- ADK Event オブジェクトの文字列表現
- ツール呼び出しの詳細（引数、ID、名前）
- モデルの応答（`role='model'`）

**形式例**:

```jsonl
{"timestamp": 1765980741, "session_id": "e2e-3", "mode": "adk-sse", "location": "backend-adk-event", "direction": "in", "sequence_number": 1, "chunk": "Event(content=Content(parts=[Part(function_call=FunctionCall(args={'amount': 50, 'currency': 'USD', 'recipient': 'Hanako'}, id='adk-91933d0c', name='process_payment'))]), role='model', ...)", "metadata": null}
```

### 2. Backend SSE Events (`chunk_logs/{session_id}/backend-sse-event.jsonl`)

Backend → Frontend に送信されるSSE形式のイベントを記録します。

**記録内容**:

- SSEプロトコルの `data:` 行
- AI SDK互換形式のJSON
- ツール入力・出力イベント

**形式例**:

```jsonl
{"timestamp": 1765980741, "session_id": "e2e-3", "mode": "adk-sse", "location": "backend-sse-event", "direction": "out", "sequence_number": 2, "chunk": "data: {\"type\": \"tool-input-start\", \"toolCallId\": \"adk-91933d0c\", \"toolName\": \"process_payment\"}\n\n", "metadata": null}
```

### 3. Frontend Events (`chunk_logs/frontend/{test-name}-{session_id}.jsonl`)

ブラウザ内で受信・処理されるイベントを記録します。

**記録内容**:

- フロントエンド側のチャンク受信イベント
- `useChat` フックで処理されたデータ
- UI表示に使用される最終的なデータ形式

**形式例**:

```jsonl
{"timestamp": 1765980741, "session_id": "e2e-3", "mode": "adk-sse", "location": "frontend-sse-chunk", "direction": "in", "sequence_number": 1, "chunk": {"type": "tool-call", "toolCallId": "adk-91933d0c", "toolName": "process_payment", "args": {"amount": 50, "currency": "USD", "recipient": "Hanako"}}, "metadata": null}
```

## E2Eテストでのチャンクロガー有効化

### 方法1: localStorage経由（推奨）

E2Eテストでは、`localStorage`経由でチャンクロガーを有効化します。これはブラウザ環境で最も確実に動作します。

```typescript
import { enableChunkLogger, navigateToChat } from "./helpers";

test("My test", async ({ page }) => {
  // Navigate first
  await navigateToChat(page);

  // Enable chunk logger
  await enableChunkLogger(page, "my-session-id");

  // Reload to apply settings
  await page.reload();
  await page.waitForLoadState("networkidle");

  // ... test logic
});
```

**ヘルパー関数**: `e2e/helpers.ts:244`

```typescript
export async function enableChunkLogger(
  page: Page,
  sessionId: string = "e2e-test",
)
```

### 方法2: 環境変数（開発時）

開発サーバー起動時に環境変数で有効化できます。

`.env.local`:

```bash
# Backend chunk logger
CHUNK_LOGGER_ENABLED=true
CHUNK_LOGGER_SESSION_ID="e2e-3"

# Frontend chunk logger
NEXT_PUBLIC_CHUNK_LOGGER_ENABLED=true
NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID="e2e-3"
```

**注意**: E2Eテストでは環境変数が期待通り動作しないケースがあるため、localStorage方式を推奨します。

## フロントエンドチャンクログのダウンロード

### 自動ダウンロード（推奨）

`afterEach` フックで自動的にダウンロードします。

```typescript
test.afterEach(async ({ page }, testInfo) => {
  const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await downloadFrontendChunkLogs(page, testName);
});
```

**ヘルパー関数**: `e2e/helpers.ts:336`

```typescript
export async function downloadFrontendChunkLogs(
  page: Page,
  testName?: string,
): Promise<string | null>
```

**保存先**: `chunk_logs/frontend/{test-name}-{session_id}.jsonl`

### 手動ダウンロード

開発サーバー実行中、ブラウザUIから手動でダウンロード可能です。

1. チャットページを開く
2. "📥 Download Chunks" ボタンをクリック
3. `{session_id}.jsonl` がダウンロードされる

**実装**: `app/page.tsx:156-179`

## チャンクログ解析

### JSONLファイルのパース

```typescript
import { parseChunkLog } from "./helpers";

const events = await parseChunkLog("chunk_logs/e2e-3/backend-sse-event.jsonl");
console.log(`Total events: ${events.length}`);
```

**ヘルパー関数**: `e2e/helpers.ts:389`

### 整合性分析

3つのログファイル間で整合性を検証します。

```typescript
import { analyzeChunkLogConsistency } from "./helpers";

const analysis = await analyzeChunkLogConsistency(
  "my-session-id",
  frontendLogPath,
);

console.log(`Consistent: ${analysis.isConsistent}`);
console.log(`Tool calls found: ${analysis.toolCalls.length}`);

for (const toolCall of analysis.toolCalls) {
  console.log(`Tool: ${toolCall.toolName}`);
  console.log(`  Backend ADK: ${toolCall.foundInBackendAdk ? "✅" : "❌"}`);
  console.log(`  Backend SSE: ${toolCall.foundInBackendSse ? "✅" : "❌"}`);
  console.log(`  Frontend: ${toolCall.foundInFrontend ? "✅" : "❌"}`);
}
```

**ヘルパー関数**: `e2e/helpers.ts:411`

**戻り値**:

```typescript
interface ConsistencyAnalysis {
  backendAdkEvents: number;      // Backend ADKイベント数
  backendSseEvents: number;      // Backend SSEイベント数
  frontendEvents: number;        // Frontendイベント数
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    foundInBackendAdk: boolean;
    foundInBackendSse: boolean;
    foundInFrontend: boolean;
  }>;
  isConsistent: boolean;         // 整合性チェック結果
  errors: string[];              // 不整合のリスト
}
```

## 統合テストスイート

### 概要

`e2e/chunk-logger-integration.spec.ts`には、3層間の整合性を検証する包括的なテストスイートが実装されています。

**テストケース数**: 8パターン

- 基本シナリオ: 4パターン（承認2、拒否2）
- 複合シナリオ: 2パターン（承認→拒否、拒否→承認）
- エッジケース: 2パターン（連続承認3回、連続拒否3回）

### テストケース詳細

#### 1. Small payment (50 USD) - APPROVE

```typescript
test("should maintain log consistency when approving small payment", async ({ page }) => {
  await sendTextMessage(page, "花子さんに50ドル送金してください");
  await page.getByRole("button", { name: "Approve" }).click();
  await waitForAssistantResponse(page, { timeout: 45000 });

  const frontendLogPath = await downloadFrontendChunkLogs(page, "approve-small-payment");
  const analysis = await analyzeChunkLogConsistency(SESSION_ID, frontendLogPath!);

  expect(analysis.isConsistent).toBe(true);
  expect(analysis.errors).toHaveLength(0);
});
```

**検証項目**:

- `process_payment` ツールが3つのログ全てに記録されているか
- `adk_request_confirmation` ツールが3つのログ全てに記録されているか
- ツールIDが一致しているか

#### 2. International payment (JPY) - DENY

拒否シナリオでも同様に整合性を検証します。

```typescript
test("should maintain log consistency when denying international payment", async ({ page }) => {
  await sendTextMessage(page, "山田さんに10000円送金してください");
  await page.getByRole("button", { name: "Deny" }).click();
  await waitForAssistantResponse(page, { timeout: 45000 });

  const frontendLogPath = await downloadFrontendChunkLogs(page, "deny-international-payment");
  const analysis = await analyzeChunkLogConsistency(SESSION_ID, frontendLogPath!);

  expect(analysis.isConsistent).toBe(true);
});
```

**検証項目**:

- 拒否された場合でもツール呼び出しが記録されているか
- エラーイベントが適切に記録されているか

#### 3. Rapid approve sequence

連続操作のエッジケースを検証します。

```typescript
test("should maintain log consistency with rapid approve sequence", async ({ page }) => {
  // 3回連続で承認
  await sendTextMessage(page, "花子さんに20ドル送金してください");
  await page.getByRole("button", { name: "Approve" }).click();
  await waitForAssistantResponse(page);

  await sendTextMessage(page, "太郎さんに30ドル送金してください");
  await page.getByRole("button", { name: "Approve" }).click();
  await waitForAssistantResponse(page);

  await sendTextMessage(page, "次郎さんに40ドル送金してください");
  await page.getByRole("button", { name: "Approve" }).click();
  await waitForAssistantResponse(page);

  const analysis = await analyzeChunkLogConsistency(SESSION_ID, frontendLogPath!);

  // 3つのpayment callsが記録されているか
  const paymentCalls = analysis.toolCalls.filter(tc => tc.toolName === "process_payment");
  expect(paymentCalls.length).toBeGreaterThanOrEqual(3);
});
```

**検証項目**:

- 連続操作でもイベントが正しく順序付けられているか
- ログファイルが破損していないか
- 3つ全てのツール呼び出しが記録されているか

### テスト実行

```bash
# 全統合テストを実行
pnpm exec playwright test e2e/chunk-logger-integration.spec.ts

# 特定のシナリオのみ実行
pnpm exec playwright test --grep "small payment"
pnpm exec playwright test --grep "rapid"
pnpm exec playwright test --grep "deny"

# 詳細出力（コンソールログ表示）
pnpm exec playwright test e2e/chunk-logger-integration.spec.ts --reporter=list
```

### テスト出力例

```
📊 Chunk Log Analysis (Approve Small Payment):
  Backend ADK events: 156
  Backend SSE events: 234
  Frontend events: 189
  Tool calls found: 2

  🔧 Tool: process_payment (adk-91933d0c-071e-465e-8788-8a336b437d07)
    Backend ADK: ✅
    Backend SSE: ✅
    Frontend: ✅

  🔧 Tool: adk_request_confirmation (adk-273afab7-f96f-4a9a-9c73-3de1fa0845ab)
    Backend ADK: ✅
    Backend SSE: ✅
    Frontend: ✅

✅ All logs are consistent!
```

## トラブルシューティング

### ダウンロードボタンが表示されない

**原因**: チャンクロガーが有効化されていない

**解決策**:

1. `localStorage`を確認:

```typescript
await page.evaluate(() => {
  console.log(localStorage.getItem("CHUNK_LOGGER_ENABLED"));
  console.log(localStorage.getItem("CHUNK_LOGGER_SESSION_ID"));
});
```

1. ページリロード後に確認:

```typescript
await enableChunkLogger(page, "test-session");
await page.reload(); // 必須
await page.waitForLoadState("networkidle");
```

### ツール呼び出しが検出されない

**原因**: ログファイルのパース方法が適切でない

**解決策**:

ログファイルの実際の形式を確認し、抽出ロジックを調整:

```typescript
// Backend ADK events
const toolCallMatch = e.chunk.match(/id='(adk-[^']+)'/);
const toolNameMatch = e.chunk.match(/name='([^']+)'/);

// Backend SSE events
const chunkMatch = e.chunk.match(/data: ({.*})/);
const chunkData = JSON.parse(chunkMatch[1]);

// Frontend events
if (chunk.type === "tool-call") {
  // ...
}
```

参照: `e2e/helpers.ts:448-494`

### 整合性チェックでエラーが出る

**原因**: イベントの記録タイミングのずれ、またはネットワーク遅延

**デバッグ手順**:

1. 各ログファイルを個別に確認:

```bash
# Backend ADK events
cat chunk_logs/my-session/backend-adk-event.jsonl | grep "process_payment" | wc -l

# Backend SSE events
cat chunk_logs/my-session/backend-sse-event.jsonl | grep "process_payment" | wc -l

# Frontend events
cat chunk_logs/frontend/test-my-session.jsonl | grep "process_payment" | wc -l
```

1. ツールIDが一致しているか確認:

```bash
grep -o 'adk-[a-z0-9\-]*' chunk_logs/my-session/backend-adk-event.jsonl | sort | uniq
grep -o 'adk-[a-z0-9\-]*' chunk_logs/my-session/backend-sse-event.jsonl | sort | uniq
```

1. イベントの順序を確認:

```bash
jq '.sequence_number' chunk_logs/my-session/backend-sse-event.jsonl | head -20
```

### テストタイムアウト

**原因**: AIモデルの応答が遅い、または無限ループ

**解決策**:

1. タイムアウトを延長:

```typescript
await waitForAssistantResponse(page, { timeout: 60000 }); // 60秒
```

1. チャンクログで無限ループをチェック:

```bash
grep -c '"type": "finish"' chunk_logs/my-session/backend-sse-event.jsonl
```

`finish`イベントが異常に多い場合（例: 50回以上）、無限ループの可能性があります。

## ベストプラクティス

### 1. セッションIDの命名

テストごとに一意のセッションIDを使用します。

```typescript
const SESSION_ID = "chunk-integration-test";
```

**推奨形式**: `{test-suite-name}` または `{test-suite-name}-{timestamp}`

### 2. テスト後のクリーンアップ

`afterEach`でログをダウンロードし、履歴をクリアします。

```typescript
test.afterEach(async ({ page }) => {
  await downloadFrontendChunkLogs(page, "test-name");
  await clearHistory(page);
});
```

参照: `e2e/chunk-logger-integration.spec.ts:38`

### 3. 整合性チェックの閾値

イベント数の合理性を確認します。

```typescript
expect(analysis.backendAdkEvents).toBeGreaterThan(0);
expect(analysis.backendSseEvents).toBeGreaterThan(0);
expect(analysis.frontendEvents).toBeGreaterThan(0);

// 異常に多い場合は無限ループの可能性
expect(analysis.backendSseEvents).toBeLessThan(1000);
```

### 4. ツール呼び出しの検証

期待されるツールが呼び出されたことを確認します。

```typescript
const processPaymentCall = analysis.toolCalls.find(
  tc => tc.toolName === "process_payment"
);
expect(processPaymentCall).toBeDefined();
expect(processPaymentCall?.foundInBackendAdk).toBe(true);
expect(processPaymentCall?.foundInBackendSse).toBe(true);
expect(processPaymentCall?.foundInFrontend).toBe(true);
```

## 関連ファイル

- **Backend**: `chunk_logger.py` - バックエンドチャンクロガー実装
- **Backend**: `server.py:194-199` - サーバー起動時のログ出力
- **Frontend**: `lib/chunk-logger.ts` - フロントエンドチャンクロガー実装
- **Frontend UI**: `app/page.tsx:156-179` - ダウンロードボタン
- **E2E Helpers**: `e2e/helpers.ts:244-546` - テストヘルパー関数
- **Integration Tests**: `e2e/chunk-logger-integration.spec.ts` - 統合テストスイート

## 参考リンク

- [ADK Tool Confirmation Flow](./ADK_NATIVE_TOOL_CONFIRMATION_FLOW.md)
- [E2E Test Guidelines](../CLAUDE.md#e2e-guidelines)
- [Chunk Logger Implementation](../agents/insights.md#chunk-logger)
