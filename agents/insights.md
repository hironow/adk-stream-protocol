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

総finishイベント数: 81回 = 81回のループ反復
```

**重要な発見**:
- フロントエンドは同じメッセージを74回再送信していたのではなく、毎回**新しいリクエスト**（新しいmessageId）を作成していた
- `sendAutomaticallyWhenAdkConfirmation`が**全てのメッセージ更新時**に`true`を返していた（初回だけでなく）
- バックエンドは正常に動作していた（tool-output-error → finish → [DONE]の順序は正しい）

### 修正後のテスト結果（23:12のログ）

```bash
Tool ID: adk-1b831275-78cb-43dd-a7ed-970136ae4d18
イベント数: 2件のみ
- tool-input-start
- tool-input-available

パターン: テストは実行されたが、拒否シナリオには到達しなかった
```

## テスト状況

### 実行したテスト

```bash
pnpm exec playwright test --grep "infinite loop"
```

**結果**: Exit code 0（成功）

**注意点**:
- "infinite loop"という文字列を含むテストファイルは存在しない可能性がある
- 実行されたテストは支払いフローをトリガーしたが、拒否シナリオには到達しなかった
- 完全な検証には、明示的に拒否（Deny）をテストするシナリオの実行が必要

### 検証が必要なシナリオ

無限ループは以下の条件で発生する:
1. ユーザーが支払い確認UIで**"Deny"をクリック**
2. フロントエンドが確認完了を受信
3. sendAutomatically ロジックが発動 → **1回だけ**発動すべき（74回ではなく）

## 技術的洞察

### なぜテキストコンテンツ検出が有効か

1. **観測可能な副作用**: AIが応答すると必ずテキストが生成される（説明や謝罪など）
2. **状態に依存しない**: ツールの内部状態（`state`プロパティなど）の更新タイミングに左右されない
3. **シンプル**: 複雑なツールID追跡ロジックが不要

### チャンクロガーの二重構造

- **バックエンド**: ディスクに永続化（`chunk_logs/`）→ サーバー再起動後も分析可能
- **フロントエンド**: メモリ内保持 → オンデマンドでダウンロード可能

この二重構造により、異なるデバッグワークフローに対応:
- バックエンドログ: プログラマティックな分析（grep、jqなど）
- フロントエンドログ: ユーザーセッション状態の正確なキャプチャ

## 今後の検証推奨事項

### オプションA: 拒否シナリオのターゲットテスト

```bash
pnpm exec playwright test --grep "denial"  # または "deny" / "reject"
```

### オプションB: 手動検証

1. 開発サーバー起動: `just dev`
2. ブラウザで http://localhost:3000 を開く
3. 支払いをリクエスト（例: "Send $100 to Alice"）
4. 確認UIで**"Deny"をクリック**
5. ブラウザコンソールで`[sendAutomaticallyWhen]`ログを確認
6. 自動送信が**1回だけ**発生することを確認（74回ではない）

### オプションC: フルE2Eスイート

```bash
just test-e2e-clean
```

全ての確認シナリオ（承認・拒否）を網羅的にテスト。

## E2Eテストでのフロントエンドチャンクログ保存

### 実装内容

E2Eテスト実行時に、フロントエンドのチャンクログを自動的に`chunk_logs/frontend/`ディレクトリに保存する機能を追加。

**ファイル**: `e2e/helpers.ts`, `e2e/adk-tool-confirmation.spec.ts`

### 動作フロー

1. **テスト実行**: E2Eテストが実行される
2. **afterEachフック**: テスト完了後、`downloadFrontendChunkLogs()`が実行される
3. **ダウンロードボタンクリック**: "📥 Download Chunks"ボタンを自動クリック
4. **ファイル保存**: Playwrightのダウンロードイベントをキャプチャし、`chunk_logs/frontend/`に保存
5. **ファイル名**: `{test-name}-{session_id}.jsonl` 形式（例: `should-display-approval-ui-e2e-3.jsonl`）

### ヘルパー関数

```typescript
export async function downloadFrontendChunkLogs(
  page: Page,
  testName?: string,
)
```

- Playwrightの`page.waitForEvent("download")`を使用
- ダウンロードボタンが存在しない場合は警告のみ（テスト失敗させない）
- テスト名をファイル名のプレフィックスとして使用

### 使用例

```typescript
test.afterEach(async ({ page }, testInfo) => {
  const testName = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await downloadFrontendChunkLogs(page, testName);
});
```

### 保存場所

```
chunk_logs/
├── frontend/              # E2Eテストで保存されるフロントエンドログ
│   ├── {test-name}-{session_id}.jsonl
│   └── ...
└── {session_id}/          # バックエンドログ（従来通り）
    ├── backend-adk-event.jsonl
    └── backend-sse-event.jsonl
```

### 利点

- **テスト後の分析**: テスト失敗時、フロントエンドとバックエンド両方のログを比較分析可能
- **デバッグ効率化**: ブラウザコンソールを開かずにSSEイベントの流れを確認
- **CI/CD対応**: 自動テスト環境でもログが保存され、後から確認可能

## 関連ファイル

- `chunk_logger.py`: バックエンドチャンクロガー実装
- `server.py`: サーバー起動ログ
- `app/page.tsx`: チャットUI（ダウンロードボタン）
- `lib/adk_compat.ts`: 無限ループ修正ロジック
- `lib/chunk-logger.ts`: フロントエンドチャンクロガー実装
- `e2e/helpers.ts`: E2Eテストヘルパー（ダウンロード機能）
- `e2e/adk-tool-confirmation.spec.ts`: ツール確認フローテスト

## チャンクロガー統合テスト

### 概要

3つのチャンクログソース（Backend ADK、Backend SSE、Frontend）間の整合性を検証する包括的なE2E統合テストスイート。

**ファイル**: `e2e/chunk-logger-integration.spec.ts`

### テストケース（8パターン）

#### 基本シナリオ（4パターン）

1. **Small payment (50 USD) - APPROVE**: 少額送金の承認
2. **Large payment (500 USD) - APPROVE**: 高額送金の承認
3. **International payment (JPY) - DENY**: 国際送金の拒否
4. **Multiple recipients - DENY**: 複数受取人への送金拒否

#### 複合シナリオ（2パターン）

5. **Approve then Deny sequence**: 承認→拒否の連続操作
6. **Deny then Approve sequence**: 拒否→承認の連続操作

#### エッジケース（2パターン）

7. **Rapid approve sequence**: 連続3回の迅速承認
8. **Rapid deny sequence**: 連続3回の迅速拒否

### 整合性チェックロジック

**ヘルパー関数**: `analyzeChunkLogConsistency()`

```typescript
interface ConsistencyAnalysis {
  backendAdkEvents: number;      // Backend ADKイベント数
  backendSseEvents: number;      // Backend SSEイベント数
  frontendEvents: number;        // Frontendイベント数
  toolCalls: ToolCallInfo[];     // 検出されたツール呼び出し
  isConsistent: boolean;         // 整合性チェック結果
  errors: string[];              // 不整合のリスト
}
```

#### チェック項目

1. **ツールIDの一致**: 各ツール呼び出しが3つのログ全てに存在するか
2. **イベント順序**: イベントの発生順序が論理的に正しいか
3. **データ完全性**: 必須フィールドが全てのログに記録されているか

### ツール呼び出し抽出ロジック

**Backend ADK events**:
```typescript
const toolCallMatch = e.chunk.match(/id='(adk-[^']+)'/);
const toolNameMatch = e.chunk.match(/name='([^']+)'/);
```

**Backend SSE events**:
```typescript
const chunkData = JSON.parse(chunkMatch[1]);
if (chunkData.toolCallId && chunkData.toolName) {
  toolCalls.set(chunkData.toolCallId, chunkData.toolName);
}
```

**Frontend events**:
```typescript
if (chunk.type === "tool-call") {
  toolCalls.set(toolCall.toolCallId, toolCall.toolName);
}
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

### 不整合が検出される場合の例

```
❌ Consistency Errors:
  - Tool call adk-xxx missing in backend ADK events
  - Tool call adk-yyy missing in frontend events
```

### 使用方法

```bash
# 全統合テストを実行
pnpm exec playwright test e2e/chunk-logger-integration.spec.ts

# 特定のシナリオのみ実行
pnpm exec playwright test --grep "small payment"
pnpm exec playwright test --grep "rapid"
```

### 検証内容

1. **イベント記録の完全性**: 全てのツール呼び出しが3つのログに記録されているか
2. **データ一貫性**: 同じツールIDが全てのログで一致しているか
3. **承認/拒否の反映**: ユーザーの操作結果がログに正しく反映されているか
4. **連続操作の処理**: 複数の操作が正しく順序付けられて記録されているか
5. **エッジケースの堅牢性**: 迅速な連続操作でもログが破損しないか

### デバッグ活用

テスト失敗時、以下のログファイルを確認：

```
chunk_logs/
├── chunk-integration-test/        # Backend logs
│   ├── backend-adk-event.jsonl
│   └── backend-sse-event.jsonl
└── frontend/                      # Frontend logs
    ├── approve-small-payment-chunk-integration-test.jsonl
    ├── deny-international-payment-chunk-integration-test.jsonl
    └── ...
```

各ログを比較することで、不整合の原因を特定可能。

## E2Eテスト Baseline 状態記録

**日付**: 2025-12-19

### テスト環境

- 4つのツール: `process_payment`, `get_location`, `get_weather`, `change_bgm`
- 2つのモード: SSE, BIDI
- 確認フロー: Approve/Deny テストパターン

### Baseline テスト結果

#### **SSE Mode: 18/18 PASSED** ✅

| Tool | Tests | Status | Notes |
|------|-------|--------|-------|
| process_payment | 6/6 | ✅ PASSED | 確認フロー完全動作 |
| get_location | 6/6 | ✅ PASSED | 確認フロー完全動作 |
| get_weather | 3/3 | ✅ PASSED | 確認不要ツール |
| change_bgm | 3/3 | ✅ PASSED | 確認不要ツール |

**結論**: SSE mode は完全に正常動作。この状態を維持すること。

---

#### **BIDI Mode: 3/21 PASSED** ❌

| Tool | Tests | Status | Error Pattern |
|------|-------|--------|---------------|
| process_payment | 0/5 | ❌ FAILED | 承認後に「Thinking...」が表示されない |
| get_location | 0/5 | ❌ FAILED | 承認後に「Thinking...」が表示されない |
| get_weather | 3/3 | ✅ PASSED | 確認不要ツール - 正常動作 |
| change_bgm | 0/3 | ❌ FAILED | 「Thinking...」が永遠に消えない (30秒タイムアウト) |

**失敗パターン分析**:

1. **確認必要ツール（process_payment, get_location）**:
   - 承認UIをクリック後、AIの応答（「Thinking...」）が表示されない
   - `waitForAssistantResponse()` の `expect(page.getByText("Thinking...")).toBeVisible()` で 10秒タイムアウト
   - Error location: `e2e/helpers.ts:111`

2. **確認不要ツール - change_bgm**:
   - 「Thinking...」は表示されるが、永遠に消えない
   - `expect(page.getByText("Thinking...")).not.toBeVisible()` で 30秒タイムアウト
   - Error location: `e2e/helpers.ts:115`

3. **確認不要ツール - get_weather**:
   - 完全に正常動作（3/3 PASSED）
   - 他の確認不要ツールと何が違うのか？

**重要**: SSE mode が完全動作していることから、ADK 自体は正常。BIDI mode 固有の問題。

### 今後の調査方針

1. **優先度 HIGH**: BIDI mode の確認フロー（process_payment または get_location）
   - なぜ承認後にAIが応答を返さないのか？
   - WebSocket通信とADK確認フローの連携問題の可能性

2. **優先度 MEDIUM**: change_bgm BIDI mode の無限 Thinking
   - なぜ get_weather は成功し、change_bgm は失敗するのか？
   - ツール実装の違いを比較

3. **禁止事項**: SSE mode の動作を変更する修正は絶対に避ける

### 修正試行履歴（失敗例）

#### 試行1: Backend での FunctionCall/FunctionResponse 抑制

**日付**: 2025-12-19

**動機**: SSE mode で `process_payment` と `adk_request_confirmation` の両方の FunctionCall が Frontend に送信され、二重承認UIが表示される問題を解決しようとした。

**実装内容**:
- `server.py`: `SSE_CONFIRMATION_TOOLS` import 追加
- `server.py`: `confirmation_tools` parameter を `stream_adk_to_ai_sdk` に渡す
- `adk_compat.py`: `inject_confirmation_for_bidi` 関数に抑制ロジック追加
  - `process_payment` FunctionCall を抑制
  - `process_payment` FunctionResponse を抑制

**結果**: **完全失敗（0/6 PASSED）**

**問題**:
- FunctionResponse の抑制により ADK の状態マシンが壊れた
- ADK はツール実行完了を認識できず、無限にリトライ
- UI に 20+ 個の重複した Assistant 応答

**教訓**:
- **ADK は状態マシンベース**: FunctionCall と FunctionResponse は対で、どちらかを抑制すると状態遷移が壊れる
- **FunctionResponse の抑制は致命的**: ADK は「ツールがまだ実行中」と判断し、無限ループ
- **Backend での介入は間違ったアプローチ**: Frontend での表示制御が正しい方向性

**Revert**: 2025-12-19 に完全に元に戻した。SSE mode は 18/18 PASSED に復帰。

---

**この Baseline を悪化させないこと！**

## BIDI Mode Frontend Delegate Deadlock 根本原因分析と修正

**日付**: 2025-12-19
**Status**: 🟢 部分的解決（approval不要ツール）/ 🔴 未解決（approval必要ツール）

### 問題の本質

BIDI mode で frontend delegate tools (change_bgm, get_location, process_payment) が失敗する根本原因を特定し、部分的に修正完了。

**デッドロックメカニズム**:
1. Backend が `tool-input-available` イベントを送信
2. Backend が `delegate.execute_on_frontend()` で Future を作成し、await でブロック (server.py:115)
3. Frontend が WebSocket 経由でイベントを受信し、UI に表示
4. **❌ 問題1: Frontend が自動実行せず、結果を Backend に送信しない** → ✅ **修正完了**
5. **❌ 問題2: Backend の ID mismatch で Future が resolve されない** → ✅ **修正完了**
6. **❌ 問題3: Approval必要ツールで adk_request_confirmation が介在しマッピングが不一致** → ❌ **未解決**

### ツール分類と動作パターン（修正後）

| Tool Type | Example | Approval | Execution | Result Method | BIDI Status | 修正状況 |
|-----------|---------|----------|-----------|---------------|------------|---------|
| Backend Tool | get_weather | No | Backend | SSE events | ✅ 3/3 PASSED | N/A（元々動作） |
| Frontend Delegate (no approval) | change_bgm | No | **Auto-execute** | **sendToolResult** | ✅ **3/3 PASSED** | ✅ **修正完了** |
| Frontend Delegate (with approval) | process_payment, get_location | Yes | Execute after approval | **sendToolResult** | ❌ **0/5 FAILED** | ❌ **未解決** |
| Long-running (ADK pattern) | LongRunningFunctionTool | Yes | Backend resumes | sendFunctionResponse | Not applicable | N/A |

### Chunk Log 証拠

#### ✅ get_weather (SUCCESS - Backend Tool)
```
sequence_number: 11  → tool-input-available
sequence_number: 42  → tool-output-available ✅
```
完全な flow: tool-input → tool-output → 正常完了

#### ❌ change_bgm (FAILURE - Frontend Delegate, No Approval)
```
sequence_number: 10  → tool-input-available
sequence_number: 11  → ping/pong keepalive (無限ループ)
```
**Missing**: tool-output-available が送信されない

#### ❌ process_payment (FAILURE - Frontend Delegate, With Approval)
```
sequence_number: 14  → tool-input-available
sequence_number: 16  → user approval sent (approved: true)
```
**Missing**: 承認後も tool-output-available が送信されない

### Backend Deadlock 証拠 (backend-adk-event.jsonl)

```python
# Line 179: change_bgm function_call 送信
{"timestamp": 1766077628391, "chunk": "Event(...function_call=FunctionCall(name='change_bgm'...)"}

# Line 180: 105秒後に次のイベント（別のテスト！）
{"timestamp": 1766077733260, "sequence_number": 180}
```

**105秒のギャップ = Test timeout (60s) + 次のテスト開始**

Backend が Future の resolve を待ち続けていることの明確な証拠。

### 既存の実装状況

#### ✅ 実装済み（使用可能）

| Component | Location | Status |
|-----------|----------|--------|
| Backend: resolve_tool_result() | server.py:111-125 | ✅ Ready |
| Backend: WebSocket handler for tool_result | server.py:784-798 | ✅ Ready |
| Frontend: sendToolResult() | websocket-chat-transport.ts:320-333 | ✅ Ready |
| Frontend: executeToolCallback() | chat.tsx:167-266 | ✅ Ready |

**全てのインフラが存在する** - 欠けているのは自動実行ロジックのみ。

#### ❌ 欠落している実装

**Location**: `components/tool-invocation.tsx` (line ~125)

**Missing logic**:
1. Frontend delegate tool の検出（state="input-available", not long-running, not confirmation）
2. useEffect での自動実行（ツール到着時にトリガー）
3. 結果の WebSocket 送信（transport.sendToolResult()）

### 現在の動作（間違っている）

```typescript
// tool-invocation.tsx:85-125
const isLongRunningTool =
  state === "input-available" && websocketTransport !== undefined;

// Long-running tool approval flow (sendFunctionResponse)
const handleLongRunningToolResponse = (approved: boolean) => {
  websocketTransport?.sendFunctionResponse(toolCallId, toolName, {...});
};

// Standard approval flow (only for approval-requested state)
onClick={async () => {
  addToolApprovalResponse?.({...});

  // Execute tool ONLY after approval
  if (executeToolCallback) {
    await executeToolCallback(toolName, toolCallId, input);
  }
}}
```

**問題**: Frontend delegate tools (approval 不要) が自動実行されない。

### 期待される動作（修正後）

```typescript
// 1. Frontend delegate tool を検出
const isFrontendDelegateTool =
  state === "input-available" &&
  websocketTransport !== undefined &&
  !isLongRunningTool &&
  !isAdkConfirmation &&
  executeToolCallback !== undefined;

// 2. useEffect で自動実行
useEffect(() => {
  if (isFrontendDelegateTool && !executionAttempted) {
    setExecutionAttempted(true);

    executeToolCallback(toolName, toolCallId, input || {})
      .then((result) => {
        // 3. 結果を WebSocket 経由で Backend に送信
        websocketTransport.sendToolResult(toolCallId, result);
      });
  }
}, [isFrontendDelegateTool, ...]);
```

### ✅ 修正完了（approval不要ツール）

#### 1. Frontend Auto-Execution 実装 (components/tool-invocation.tsx)

**変更内容**:
- `isFrontendDelegateTool` 検出ロジック追加（lines 94-108）
- `useEffect` による自動実行（lines 153-211）
- `executeToolCallback` の返り値型を `{ success: boolean; result?: Record<string, unknown> }` に変更
- `sendToolResult()` 呼び出しによる結果送信

**テスト結果**:
- ✅ Unit tests: 28/28 PASSED
- ✅ E2E tests (change_bgm BIDI): 3/3 PASSED

#### 2. Backend ID Mismatch 修正 (server.py)

**問題**:
- Backend が Future を `invocation_id` で登録
- Frontend が `function_call.id` で tool_result を送信
- ID 不一致で Future が resolve されない

**修正内容**:
- `_tool_name_to_id: dict[str, str]` マッピング追加（lines 75-79）
- `set_function_call_id()` メソッド追加（lines 81-92）
- `execute_on_frontend()` で `tool_name` をキーに Future 登録（lines 94-125）
- `resolve_tool_result()` で `function_call.id` → `tool_name` 逆引き（lines 127-164）
- WebSocket handler で `tool-input-available` 送信時にマッピング登録（lines 888-896）

**テスト結果**:
- ✅ Backend logs confirm mapping: `[FrontendDelegate] Mapped change_bgm → function-call-12954980071036824405`
- ✅ Successful resolution: `[FrontendDelegate] Resolving tool=change_bgm (function_call.id=...) with result: {...}`

### ❌ 未解決の問題（approval必要ツール）

#### 3. adk_request_confirmation 介在時のマッピング不一致

**問題**:
- Approval必要ツール（process_payment, get_location）では `adk_request_confirmation` ツールが介在
- マッピング: `process_payment → function-call-...` で登録
- 実際の呼び出し: `tool=adk_request_confirmation` で `execute_on_frontend()` 実行
- 結果: マッピングキーが一致せず Future が resolve されない

**ログ証拠**:
```log
[FrontendDelegate] Mapped process_payment → function-call-10191469825215847904
[ToolConfirmationInterceptor] Executing confirmation for tool=process_payment
[FrontendDelegate] Awaiting result for tool=adk_request_confirmation, invocation_id=confirmation-function-call-...
```

**テスト結果**:
- ❌ process_payment BIDI: 5/5 FAILED (timeout: "Thinking..." が消えない)

**次のステップ**:
- `adk_request_confirmation` のマッピング処理を追加実装
- または approval フローの設計を見直す

### 関連ドキュメント

- 詳細分析: `experiments/2025-12-18_bidi_frontend_delegate_deadlock_analysis.md`
- ID mismatch 分析: `experiments/2025-12-19_frontend_delegate_id_mismatch_fix.md`
- フロー図: `experiments/2025-12-18_bidi_deadlock_flow_diagram.md`
- Chunk logs: `chunk_logs/e2e-feature-1/frontend/`, `chunk_logs/e2e-feature-1/backend-adk-event.jsonl`

## 変更履歴

- **2025-12-17**: 初版作成（無限ループ修正、チャンクロガー改善）
- **2025-12-17**: E2Eテストでのフロントエンドチャンクログ自動保存機能を追加
- **2025-12-17**: チャンクロガー統合テストスイート（8パターン）を追加
- **2025-12-19**: E2E Baseline 状態記録追加（SSE: 18/18 PASSED, BIDI: 3/21 PASSED）
- **2025-12-19**: BIDI Mode Frontend Delegate Deadlock 根本原因分析追加
- **2025-12-19**: ✅ Frontend delegate tools (approval不要) 修正完了
  - Frontend auto-execution 実装（tool-invocation.tsx）
  - Backend ID mismatch 修正（server.py）
  - change_bgm BIDI tests: 3/3 PASSED
  - ❌ Approval必要ツール（process_payment）は未解決（adk_request_confirmation 介在問題）
