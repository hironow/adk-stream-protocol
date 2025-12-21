# Frontend E2E Tests

このディレクトリには、フロントエンドのエンドツーエンド (E2E) テストが格納されています。

## 目的

フロントエンド E2E テストは、ブラウザ上で動作するフロントエンドコンポーネントの統合動作を検証します。
バックエンドAPIとの実際の通信を含む、完全なユーザーフローをテストします。

### Unit vs Integration vs E2E (Frontend)

| タイプ | 対象 | 環境 | モック | 例 |
|--------|------|------|--------|-----|
| **Unit** | 単一関数/コンポーネント | Node.js | 全て | `chunk-player.test.ts` |
| **Integration** | 2-3 コンポーネント | Node.js | 部分 | `bidi-event-flow.test.ts` |
| **E2E** | フロントエンド全体 | ブラウザ | バックエンドのみ | `chat-flow.e2e.test.ts` |

**E2E の特徴:**
- 実際のブラウザで実行 (Playwright/Puppeteer)
- 実際のDOM操作とイベント
- 実際のWebSocket/HTTP通信
- ユーザー視点でのテスト

## テスト戦略

### 対象シナリオ

1. **チャットフロー** (フロントエンドUI + バックエンドAPI)
   - メッセージ入力、送信ボタンクリック
   - ストリーミングレスポンスのリアルタイム表示
   - メッセージ履歴の表示と保持

2. **ツール実行** (UI インタラクション)
   - ツール実行中のローディング表示
   - 承認ダイアログの表示と操作
   - 結果の表示確認

3. **モード切替** (状態管理 + 通信切替)
   - モード選択UIの操作
   - 接続状態の視覚的フィードバック
   - メッセージ履歴の保持確認

4. **マルチモーダル** (ブラウザAPI + UI)
   - 音声録音ボタンの操作
   - 音声再生の確認
   - 画像アップロードUI
   - BGM再生制御

5. **エラーシナリオ** (エラーハンドリング + UI)
   - エラーメッセージの表示
   - リトライボタンの動作
   - ネットワーク切断時のUI状態

## テスト環境

### 前提条件

```bash
# バックエンドサーバーの起動（実環境でテストする場合）
python server.py

# または、モックバックエンドの使用（推奨）
# E2E テストはフロントエンドフォーカスなので
# MSW や専用モックサーバーでバックエンドを模擬可能
```

### 実行方法

```bash
# Playwright で E2E テスト実行
pnpm playwright test lib/tests/e2e/

# 特定のテスト実行
pnpm playwright test lib/tests/e2e/chat-flow.e2e.test.ts

# ヘッドレスモード解除（ブラウザ表示）
pnpm playwright test --headed

# デバッグモード
pnpm playwright test --debug
```

## ファイル命名規則

```
{feature}.e2e.test.ts
```

- `chat-flow.e2e.test.ts` - チャット基本フロー
- `tool-execution.e2e.test.ts` - ツール実行
- `mode-switching.e2e.test.ts` - モード切替
- `audio-control.e2e.test.ts` - 音声制御
- `error-handling.e2e.test.ts` - エラーハンドリング

## データ管理

### Fixtures

共通の `lib/tests/fixtures/` を使用:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const baseline = JSON.parse(
  readFileSync(
    join(__dirname, "..", "fixtures", "get_weather-bidi-baseline.json"),
    "utヘルパー
f-8"
  )
);

// テストでbaselineと実際の結果を比較
expect(actualChunks).toEqual(baseline.chunks);
```

### テストヘルパー

共通の `lib/tests/helpers/` を使用:

```typescript
import { setupWebSocketMock, simulateWebSocketMessage } from "../helpers";
import { waitForBackend, createTestSession } from "../helpers/e2e-environment";

## ベストプラクティス

### 1. テストの独立性

各テストは独立して実行可能にする:

import { test, expect } from "@playwright/test";

test.describe("Chat Flow E2E", () => {
  test.beforeEach(async ({ page }) => {
    // 各テストで新しいページをロード
    await page.goto("http://localhost:3000");
    // ストレージをクリア
    await page.evaluate(() => localStorage.clear());
  });

  test("should send message and receive response", async ({ page }) => {
    // テスト実装
  });
});
```

### 2. セレクター戦略

安定したセレクターを使用:

```typescript
// ✅ data-testid 使用（推奨）
await page.getByTestId("chat-input").fill("Hello");
await page.getByTestId("send-button").click();

// ✅ role ベース
await page.getByRole("textbox", { name: "Chat input" }).fill("Hello");
await page.getByRole("button", { name: "Send" }).click();

// ❌ CSS セレクター（脆弱）
await page.locator(".chat-input").fill("Hello");
```

### 3. 待機戦略

適切な待機を使用:

```typescript
// ✅ 要素が表示されるまで待機
await page.getByText("AI response").waitFor();

// ✅ ネットワークアイドル待機
await page.waitForLoadState("networkidle");

// 

// ❌ 固定時間待機（避ける）
await page.waitForTimeout(3000);
```

## デバッグ

### ✅ カスタム条件待機
await page.waitForFunction(() => {
  return document.querySelectorAll(".message").length > 1;
});スクリーンショット/ビデオ

```typescript
import { test } from "@playwright/test";

test("chat flow", async ({ page }) => {
  // 失敗時に自動スクリーンショット
  await page.goto("http://localhost:3000");
  
  // 手動スクリーンショット
  await page.screenshot({ path: "debug-screenshot.png" });
});
```

設定で自動化:
開発者ツール

```bash
# デバッグモードで実行（一時停止可能）
pnpm playwright test --debug

# UIモード（インタラクティブ）
pnpm playwright test --ui
```

### コンソールログ

```typescript
test("check console errors", async ({ page }) => {
  page.on("console", msg => {
    if (msg.type() === "error") {
      console.log("Browser error:", msg.text());
    }
  });
  
  await page.goto("http://localhost:3000");
});
```

## CI/CD 統合

### GitHub Action
```typescript
// playwright.config.ts
export default {
  use: {
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
};
```

### ブラウザInstall Playwright Browsers
  run: pnpm playwright install --with-deps

- name: Start Backend (Mock)
  run: |
    # モックサーバー起動 or 実際のバックエンド
    python server.py &
    sleep 2

- name: Build Frontend
  run: pnpm build

- name: Run E2E Tests
  run: pnpm playwright test

- name: Upload Test Results
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-results
    path: playwright-report/
```

### テストの選択的実行

```bash
# 軽量なテストのみ (PR)
pnpm playwright test --grep "@smoke"

# 完全なテストスイート (main merge)
pnpm playwright test
```

## トラブルシューティング

### よくある問題

1. **タイムアウト**: デフォルトタイムアウトを増やす
   ```typescript
   test.setTimeout(60000); // 60秒
   ```

2. **ポート競合**: 別のポート番号を使用
   ```bash
   PORT=3001 pnpm dev
   ```

3. **認証エラー**: テスト用の認証トークンを設定

4. **データ汚染**: beforeEach で確実にリセット

## 参考資料

- [Playwright Documentation](https://playwright.dev/)
- [Testing Library Guiding Principles](https://testing-library.com/docs/guiding-principles/)
- [Frontend Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

