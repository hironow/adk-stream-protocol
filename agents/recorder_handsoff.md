# Recorder Agent Handoff

## Mission

フロントエンドのE2Eテスト用チャンクフィクスチャを手動で記録する。

## Background

Chunk Player E2E テストインフラストラクチャが実装されました。現在、4つのテストパターン用の空のフィクスチャファイルが存在しますが、実際のチャンクデータはまだ記録されていません。

テストを実行可能にするには、各パターンの `frontend-chunks.jsonl` ファイルを実際のチャンクデータで埋める必要があります。

## Current State

### Implemented Components

- ✅ ChunkPlayerTransport (`lib/chunk-player-transport.ts`)
- ✅ E2E test helpers (`e2e/helpers.ts`)
- ✅ Playwright test scenarios (`e2e/chunk-player-ui-verification.spec.ts`)
- ✅ Build options integration (`lib/build-use-chat-options.ts`)
- ✅ Fixture directory structure (`tests/fixtures/e2e-chunks/pattern*`)
- ✅ Recording procedures (`tests/fixtures/e2e-chunks/pattern*/recording-steps.md`)
- ✅ Empty fixture files (ready to be filled)
- ✅ Documentation (`E2E_FRONTEND_GUIDE.md`, `tests/fixtures/e2e-chunks/README.md`)

### Files to Record

```
tests/fixtures/e2e-chunks/
├── pattern1-gemini-only/
│   └── frontend-chunks.jsonl  ← EMPTY (needs recording)
├── pattern2-adk-sse-only/
│   └── frontend-chunks.jsonl  ← EMPTY (needs recording)
├── pattern3-adk-bidi-only/
│   └── frontend-chunks.jsonl  ← EMPTY (needs recording)
└── pattern4-mode-switching/
    └── frontend-chunks.jsonl  ← EMPTY (needs recording)
```

## Task

4つのテストパターンすべてのフロントエンドチャンクを記録してください。

### Pattern 1: Gemini Direct Only
- **Mode**: Gemini Direct (固定)
- **Steps**: 4メッセージ
- **Recording Procedure**: `tests/fixtures/e2e-chunks/pattern1-gemini-only/recording-steps.md`
- **Expected Result**: 8メッセージ分のチャンク（4 user + 4 assistant）

### Pattern 2: ADK SSE Only
- **Mode**: ADK SSE (固定)
- **Steps**: 4メッセージ
- **Recording Procedure**: `tests/fixtures/e2e-chunks/pattern2-adk-sse-only/recording-steps.md`
- **Expected Result**: 8メッセージ分のチャンク + token count metadata

### Pattern 3: ADK BIDI Only
- **Mode**: ADK BIDI (固定)
- **Steps**: 4メッセージ
- **Recording Procedure**: `tests/fixtures/e2e-chunks/pattern3-adk-bidi-only/recording-steps.md`
- **Expected Result**: 8メッセージ分のチャンク + audio chunks

### Pattern 4: Mode Switching (CRITICAL)
- **Mode**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Steps**: 5メッセージ（各モードで1つ）
- **Recording Procedure**: `tests/fixtures/e2e-chunks/pattern4-mode-switching/recording-steps.md`
- **Expected Result**: 10メッセージ分のチャンク（5 user + 5 assistant）
- **CRITICAL**: 全5ステップのメッセージ履歴が保持されることを確認

## Prerequisites

### 1. Start Backend Server

```bash
# Terminal 1
uv run uvicorn server:app --reload
```

確認: http://localhost:8000/health が正常に応答すること

### 2. Start Frontend Dev Server

```bash
# Terminal 2
pnpm dev
```

確認: http://localhost:3000 が正常に表示されること

### 3. Open Browser

```bash
open http://localhost:3000
```

## Recording Procedure (Per Pattern)

### Step 1: Enable Chunk Logger

ブラウザのコンソールを開き、以下を実行：

```javascript
// Pattern 1の場合
localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true');
localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern1-gemini-only');
location.reload();
```

**重要**: `CHUNK_LOGGER_SESSION_ID` は各パターンで異なる値に設定：
- Pattern 1: `'pattern1-gemini-only'`
- Pattern 2: `'pattern2-adk-sse-only'`
- Pattern 3: `'pattern3-adk-bidi-only'`
- Pattern 4: `'pattern4-mode-switching'`

### Step 2: Verify Logger is Active

コンソールで確認：

```javascript
window.__chunkLogger__
// → ChunkLogger インスタンスが表示されるはず
```

### Step 3: Execute Test Scenario

該当パターンの `recording-steps.md` に記載された手順を **正確に** 実行してください。

**Pattern 4 の注意事項**:
- 各ステップでモード切り替えボタンをクリック
- モード切り替え後、過去のメッセージが残っているか **必ず確認**
- もし消えたら、それはバグなので **記録を中止** してバグ修正を優先

### Step 4: Export Chunks

ブラウザのコンソールで実行：

```javascript
window.__chunkLogger__.export();
```

ファイル `pattern1-gemini-only.jsonl` （パターンに応じた名前）がダウンロードされます。

### Step 5: Save Fixture

ダウンロードしたファイルを適切な場所に移動：

```bash
# Pattern 1の場合
mv ~/Downloads/pattern1-gemini-only.jsonl \
   tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
```

### Step 6: Verify Fixture

ファイルが正しく保存されたか確認：

```bash
# ファイルサイズと行数を確認
wc -l tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
ls -lh tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl

# 最初の数行を確認（JSONLフォーマット）
head -n 3 tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
```

### Step 7: Clean Up

次のパターン記録前に、ローカルストレージをクリア：

```javascript
localStorage.removeItem('CHUNK_LOGGER_ENABLED');
localStorage.removeItem('CHUNK_LOGGER_SESSION_ID');
location.reload();
```

## Recording Checklist

各パターンを記録する際、以下を確認してください：

### Pattern 1: Gemini Direct Only
- [ ] Backend & Frontend サーバー起動確認
- [ ] Chunk logger 有効化（session ID: `pattern1-gemini-only`）
- [ ] `recording-steps.md` の全4ステップを正確に実行
- [ ] 2つのtool invocation確認（weather, calculator）
- [ ] Chunks export成功
- [ ] Fixture保存完了: `tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl`
- [ ] ファイルサイズ > 0バイト確認

### Pattern 2: ADK SSE Only
- [ ] Backend & Frontend サーバー起動確認
- [ ] Chunk logger 有効化（session ID: `pattern2-adk-sse-only`）
- [ ] Mode切り替え: "ADK SSE" ボタンクリック
- [ ] `recording-steps.md` の全4ステップを正確に実行
- [ ] Token count表示確認
- [ ] Model name表示確認（gemini-2.5-flash）
- [ ] Chunks export成功
- [ ] Fixture保存完了: `tests/fixtures/e2e-chunks/pattern2-adk-sse-only/frontend-chunks.jsonl`
- [ ] ファイルサイズ > 0バイト確認

### Pattern 3: ADK BIDI Only
- [ ] Backend & Frontend サーバー起動確認
- [ ] Chunk logger 有効化（session ID: `pattern3-adk-bidi-only`）
- [ ] Mode切り替え: "ADK BIDI ⚡" ボタンクリック
- [ ] WebSocket接続確立確認
- [ ] `recording-steps.md` の全4ステップを正確に実行
- [ ] Audio player表示確認（各assistant messageに1つ）
- [ ] WebSocket latency表示確認
- [ ] Chunks export成功
- [ ] Fixture保存完了: `tests/fixtures/e2e-chunks/pattern3-adk-bidi-only/frontend-chunks.jsonl`
- [ ] ファイルサイズ > 0バイト確認

### Pattern 4: Mode Switching (CRITICAL)
- [ ] Backend & Frontend サーバー起動確認
- [ ] Chunk logger 有効化（session ID: `pattern4-mode-switching`）
- [ ] Step 1 (Gemini): メッセージ送信 → 履歴確認
- [ ] Step 2 (ADK SSE): モード切り替え → **履歴保持確認** → メッセージ送信
- [ ] Step 3 (ADK BIDI): モード切り替え → **履歴保持確認** → メッセージ送信
- [ ] Step 4 (ADK SSE): モード切り替え → **履歴保持確認** → メッセージ送信
- [ ] Step 5 (Gemini): モード切り替え → **履歴保持確認** → メッセージ送信
- [ ] 最終確認: 全10メッセージ（5 user + 5 assistant）が表示されている
- [ ] Chunks export成功
- [ ] Fixture保存完了: `tests/fixtures/e2e-chunks/pattern4-mode-switching/frontend-chunks.jsonl`
- [ ] ファイルサイズ > 0バイト確認

## Validation

すべてのパターンを記録した後、E2Eテストを実行して検証：

```bash
# 空fixtureテストをスキップして、実際のパターンテストを実行
pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts -g "Pattern"

# 個別テスト
pnpm exec playwright test -g "Pattern 1"
pnpm exec playwright test -g "Pattern 2"
pnpm exec playwright test -g "Pattern 3"
pnpm exec playwright test -g "Pattern 4"
```

**Expected Results**:
- ✅ Pattern 1: 8メッセージ表示、2 tool invocations
- ✅ Pattern 2: 8メッセージ表示、token count & model name表示
- ✅ Pattern 3: 8メッセージ表示、4 audio players
- ✅ Pattern 4: 10メッセージ表示、履歴完全保持
- ✅ Pattern 4 Critical: Exactly 10 unique messages

## Troubleshooting

### Chunk Logger が動作しない

**Symptom**: `window.__chunkLogger__` が undefined

**Solution**:
1. ページをリロードして確認
2. コンソールエラーを確認
3. `localStorage.getItem('CHUNK_LOGGER_ENABLED')` が `"true"` か確認
4. Frontend dev server を再起動

### Export が失敗する

**Symptom**: ダウンロードが開始しない、または空ファイルがダウンロードされる

**Solution**:
1. `window.__chunkLogger__.chunks.length` でチャンク数を確認
2. 0の場合、記録が行われていないので手順を再確認
3. ブラウザのダウンロード設定を確認

### Pattern 4 で履歴が消える

**Symptom**: モード切り替え後、以前のメッセージが表示されない

**Solution**:
- **これはアプリケーションのバグです**
- 記録を中止してください
- バグ修正を優先してください
- Pattern 4は履歴保持機能の検証が目的です

## Success Criteria

以下の条件をすべて満たせばタスク完了：

1. ✅ 4つのパターンすべてで `frontend-chunks.jsonl` が記録された
2. ✅ すべてのfixtureファイルのサイズ > 0バイト
3. ✅ すべてのfixtureがJSONL形式で有効
4. ✅ Pattern 4で10メッセージの履歴が保持された
5. ✅ E2Eテスト `pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts` が全て通過

## Next Steps

このタスク完了後:

1. **Server-side chunk player implementation**
   - Backend (Python) のchunk player実装
   - Backend E2Eテスト用のfixture記録
   - 同様の手順でbackend chunksを記録

2. **Documentation updates**
   - `agents/handsoff.md` を更新（フィクスチャ記録完了を反映）
   - `agents/tasks.md` を更新（Phase 5 開始準備）

3. **CI/CD integration**
   - GitHub Actions でE2Eテストを実行
   - Fixtureファイルをgitにコミット

## References

- **Main Guide**: `E2E_FRONTEND_GUIDE.md`
- **Fixture README**: `tests/fixtures/e2e-chunks/README.md`
- **Scenario Description**: `tests/fixtures/e2e-chunks/scenario-description.md`
- **Recording Steps**:
  - `tests/fixtures/e2e-chunks/pattern1-gemini-only/recording-steps.md`
  - `tests/fixtures/e2e-chunks/pattern2-adk-sse-only/recording-steps.md`
  - `tests/fixtures/e2e-chunks/pattern3-adk-bidi-only/recording-steps.md`
  - `tests/fixtures/e2e-chunks/pattern4-mode-switching/recording-steps.md`
- **Test Implementation**: `e2e/chunk-player-ui-verification.spec.ts`

## Questions?

このハンドオフドキュメントで不明な点があれば:

1. `E2E_FRONTEND_GUIDE.md` を確認
2. `tests/fixtures/e2e-chunks/README.md` を確認
3. Recording Steps ファイルを確認
4. 前のエージェントに質問（このプロジェクトのコンテキストを継承）

---

**Status**: ⏳ Waiting for Manual Recording

**Assigned to**: Next Agent / Manual Recorder

**Priority**: High (ブロッカー - E2Eテストが実行できない)

**Estimated time**: 30-60分（全4パターン）
