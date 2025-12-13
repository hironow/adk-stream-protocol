# E2E Chunk Player Fixtures

## Overview

### Fixture File Structure

このディレクトリには、Chunk Playerを使ったE2Eテスト用のfixtureが格納されています。

```
tests/fixtures/e2e-chunks/          ← 実体（gitで管理）
├── README.md                        ← このファイル
├── pattern1-gemini-only/
│   ├── frontend-chunks.jsonl       ← Frontend記録データ
│   └── backend-chunks.jsonl        ← Backend記録データ（Gemini Directは空）
├── pattern2-adk-sse-only/
│   ├── frontend-chunks.jsonl
│   └── backend-chunks.jsonl
├── pattern3-adk-bidi-only/
│   ├── frontend-chunks.jsonl
│   └── backend-chunks.jsonl
└── pattern4-mode-switching/
    ├── frontend-chunks.jsonl
    └── backend-chunks.jsonl
```

### Why `public/fixtures/e2e-chunks/` Symlinks?

**Frontend E2E tests run in browser** and need HTTP access to fixture files.

```
Browser (Playwright E2E Test)
  ↓
ChunkPlayerTransport.fromFixture("/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl")
  ↓
HTTP GET: http://localhost:3000/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
  ↓
Next.js serves from public/ directory
  ↓
Symlink: public/fixtures/e2e-chunks/pattern1-gemini-only
  → tests/fixtures/e2e-chunks/pattern1-gemini-only  ← 実体
```

**利点**:
- ✅ 単一の真実の源: Fixtureは `tests/fixtures/` に1つだけ存在
- ✅ Backend/Frontend共有: Server E2Eテストも同じfixtureを使える
- ✅ 管理が簡単: Fixture更新時、1箇所だけ変更すればOK
- ✅ Gitで追跡: `tests/fixtures/` をcommitすれば、symlinkも自動的に有効

**Symlinkの作成**:
```bash
# 自動作成（推奨）
just setup-e2e-fixtures

# 手動作成
cd public/fixtures/e2e-chunks
ln -sf ../../../tests/fixtures/e2e-chunks/pattern1-gemini-only .
```

### Test Objective

Chunk Playerで記録済みのchunkを再生し、**Frontend UIの状態を検証**する。
特に、**モード切り替え時にメッセージ履歴が保持される**ことを確認する（Pattern 4）。

## Test Patterns

### Pattern 1: Gemini Direct のみ
- **Mode**: Gemini Direct固定（Backendを経由しない）
- **Steps**: 4ステップ（挨拶、天気tool、計算tool、お礼）
- **Expected**:
  - 8メッセージ（4 user + 4 assistant）
  - 2 tool invocations (weather, calculator)
  - Backend chunks: なし（Gemini Directはfrontend直接）

### Pattern 2: ADK SSE のみ
- **Mode**: ADK SSE固定（Server-Sent Events）
- **Steps**: 4ステップ（同上）
- **Expected**:
  - 8メッセージ（4 user + 4 assistant）
  - 2 tool invocations
  - Token count表示
  - Model name表示 (gemini-2.5-flash)

### Pattern 3: ADK BIDI のみ
- **Mode**: ADK BIDI固定（WebSocket双方向通信）
- **Steps**: 4ステップ（同上）
- **Expected**:
  - 8メッセージ（4 user + 4 assistant）
  - 2 tool invocations
  - 4 audio players表示
  - WebSocket latency表示

### Pattern 4: Mode切り替え ⚠️ CRITICAL
- **Modes**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Steps**: 5ステップ（各モードで1つずつ）
- **Expected**:
  - 10メッセージ（5 user + 5 assistant）
  - 2 tool invocations
  - 1 audio player（Step 3のみ）
  - **重要**: モード切り替え後も全メッセージ履歴が保持される

**Pattern 4の目的**: UIがモード切り替えで履歴を失わないことを検証（最重要テスト）

## Common Test Steps

全パターンで使用する基本的なメッセージ:

| Step | Message | Purpose |
|------|---------|---------|
| 1 | "こんにちは" | 普通の会話 |
| 2 | "東京の天気を教えて" | Tool use (weather) |
| 3 | "123 + 456は？" | Tool use (calculator) |
| 4 | "ありがとう" | 普通の会話 |
| 5* | "さようなら" | 普通の会話（Pattern 4のみ） |

*Pattern 4は5ステップ、他は4ステップ

## Recording Procedure

### Prerequisites

全パターン共通の準備:

```bash
# Backend起動（Pattern 1以外）
uv run uvicorn server:app --reload

# Frontend起動（全パターン）
pnpm dev

# ブラウザを開く
open http://localhost:3000
```

**注意**: Pattern 1 (Gemini Direct) はBackend不要

### Step 1: Enable Frontend Chunk Logger

ブラウザのコンソールで実行（**パターンごとにsession_idを変更**）:

```javascript
localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true');
localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern1-gemini-only');  // ← パターンに応じて変更
location.reload();
```

**Session ID一覧**:
- Pattern 1: `'pattern1-gemini-only'`
- Pattern 2: `'pattern2-adk-sse-only'`
- Pattern 3: `'pattern3-adk-bidi-only'`
- Pattern 4: `'pattern4-mode-switching'`

### Step 2: Execute Scenario

各パターンの詳細手順は以下を参照:

#### Pattern 1: Gemini Direct のみ

**Mode**: Gemini Direct（デフォルト、変更不要）

1. **Step 1**: "こんにちは" → Send
2. **Step 2**: "東京の天気を教えて" → Send → Weather tool確認
3. **Step 3**: "123 + 456は？" → Send → Calculator tool確認
4. **Step 4**: "ありがとう" → Send

#### Pattern 2: ADK SSE のみ

**準備**: "ADK SSE Frontend → ADK (SSE)" ボタンをクリック

1. **Step 1**: "こんにちは" → Send → **Token count確認**
2. **Step 2**: "東京の天気を教えて" → Send → Weather tool確認
3. **Step 3**: "123 + 456は？" → Send → Calculator tool確認
4. **Step 4**: "ありがとう" → Send

#### Pattern 3: ADK BIDI のみ

**準備**: "ADK BIDI ⚡ Frontend ↔ ADK (WS)" ボタンをクリック → WebSocket接続待機

1. **Step 1**: "こんにちは" → Send → **Audio player確認**
2. **Step 2**: "東京の天気を教えて" → Send → Weather tool & Audio確認
3. **Step 3**: "123 + 456は？" → Send → Calculator tool & Audio確認
4. **Step 4**: "ありがとう" → Send → Audio確認

#### Pattern 4: Mode切り替え ⚠️ CRITICAL

**重要**: 各ステップでモードを切り替え、**メッセージ履歴が保持される**ことを確認

| Step | Mode | Message | 確認事項 |
|------|------|---------|----------|
| 1 | Gemini Direct<br/>(デフォルト) | "こんにちは" | - |
| 2 | ADK SSE<br/>（切り替え） | "東京の天気を教えて" | ✅ Step 1が残っている<br/>Weather tool |
| 3 | ADK BIDI<br/>（切り替え） | "123 + 456は？" | ✅ Step 1-2が残っている<br/>Calculator tool<br/>Audio player |
| 4 | ADK SSE<br/>（切り替え） | "ありがとう" | ✅ Step 1-3が残っている |
| 5 | Gemini Direct<br/>（切り替え） | "さようなら" | ✅ Step 1-4が残っている |

**最終確認**: 全5ステップのメッセージ（10メッセージ: 5 user + 5 assistant）が表示されていること

**もし履歴が消えたら**: それはバグです。記録を中止してバグ修正を優先してください。

### Step 3: Export Chunks

ブラウザのコンソールで実行:

```javascript
window.__chunkLogger__.export();
// ダウンロードされるファイル: pattern1-gemini-only.jsonl（session_idに応じて変化）
```

### Step 4: Save Fixture

ダウンロードしたファイルを適切な場所に移動:

```bash
# Pattern 1の例
mv ~/Downloads/pattern1-gemini-only.jsonl \
   tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl

# Pattern 2の例
mv ~/Downloads/pattern2-adk-sse-only.jsonl \
   tests/fixtures/e2e-chunks/pattern2-adk-sse-only/frontend-chunks.jsonl

# Pattern 3の例
mv ~/Downloads/pattern3-adk-bidi-only.jsonl \
   tests/fixtures/e2e-chunks/pattern3-adk-bidi-only/frontend-chunks.jsonl

# Pattern 4の例
mv ~/Downloads/pattern4-mode-switching.jsonl \
   tests/fixtures/e2e-chunks/pattern4-mode-switching/frontend-chunks.jsonl
```

### Step 5: Verify Fixture

ファイルが正しく保存されたか確認:

```bash
# ファイルサイズと行数を確認
wc -l tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
ls -lh tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl

# JSONL形式の確認（最初の3行）
head -n 3 tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl | jq
```

## Expected Results Summary

| Pattern | Messages | Tool Invocations | Special Features |
|---------|----------|------------------|------------------|
| Pattern 1 | 8 (4+4) | 2 (weather, calc) | - |
| Pattern 2 | 8 (4+4) | 2 (weather, calc) | Token count, Model name |
| Pattern 3 | 8 (4+4) | 2 (weather, calc) | 4 Audio players, WS latency |
| Pattern 4 | 10 (5+5) | 2 (weather, calc) | 1 Audio player, **History preservation** |

## Adding New Patterns

新しいパターンを追加する場合は、以下の標準に従ってください:

### 1. ディレクトリ作成

```bash
mkdir -p tests/fixtures/e2e-chunks/pattern5-new-scenario
touch tests/fixtures/e2e-chunks/pattern5-new-scenario/frontend-chunks.jsonl
touch tests/fixtures/e2e-chunks/pattern5-new-scenario/backend-chunks.jsonl
```

### 2. Symlinkの作成

```bash
# justfileを更新
# setup-e2e-fixtures コマンドにpattern5を追加

# または手動作成
cd public/fixtures/e2e-chunks
ln -sf ../../../tests/fixtures/e2e-chunks/pattern5-new-scenario .
```

### 3. このREADME.mdに追加

#### Test Patternsセクション:
```markdown
### Pattern 5: [パターン名]
- **Mode**: [モード情報]
- **Steps**: [ステップ数とステップ内容]
- **Expected**:
  - [期待される結果]
```

#### Recording Procedureセクション（必要に応じて）:
```markdown
#### Pattern 5: [パターン名]

**準備**: [モード切り替え等]

1. **Step 1**: [メッセージ] → Send → [確認事項]
2. **Step 2**: ...
```

### 4. E2Eテストの追加

`e2e/chunk-player-ui-verification.spec.ts` に新しいテストケースを追加:

```typescript
test("Pattern 5: [パターン名] - should [検証内容]", async ({ page }) => {
  await setupChunkPlayerMode(page, "pattern5-new-scenario");
  // テストロジック
});
```

### 5. 記録の実行

このREADMEの「Recording Procedure」に従って記録を実行してください。

## Troubleshooting

### Chunks not recorded

**Symptom**: `window.__chunkLogger__.export()` でダウンロードが始まらない

**Solution**:
1. `window.__chunkLogger__` が存在するか確認
2. `localStorage.getItem('CHUNK_LOGGER_ENABLED')` が `"true"` か確認
3. ページをリロードして再試行

### Empty fixture file

**Symptom**: ダウンロードされたファイルが空

**Solution**:
1. ブラウザのコンソールでエラーを確認
2. 実際にメッセージを送信したか確認
3. Chunk loggerが有効になっているか確認

### Pattern 4: History lost after mode switch

**Symptom**: モード切り替え後、以前のメッセージが消える

**Solution**:
- **これはバグです。記録を中止してください**
- Pattern 4はこのバグを検出するためのテストです
- バグ修正を優先してください

## Running E2E Tests

Fixtureを記録した後、E2Eテストを実行:

```bash
# Frontend E2E tests (Playwright)
pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts

# 特定のパターンのみ
pnpm exec playwright test -g "Pattern 1"
pnpm exec playwright test -g "Pattern 4"

# Server E2E tests (pytest)
uv run pytest tests/e2e/test_server_chunk_player.py
```

## Related Documentation

- **E2E_FRONTEND_GUIDE.md** - Frontend E2Eテストの詳細ガイド
- **E2E_SERVER_GUIDE.md** - Server E2Eテストの詳細ガイド
- **agents/recorder_handsoff.md** - 手動記録の引き継ぎドキュメント
