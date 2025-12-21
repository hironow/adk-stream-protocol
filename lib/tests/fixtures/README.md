# Test Fixtures

このディレクトリには、統合テスト・E2Eテストで使用するベースラインデータが格納されています。

## 構造

- **BIDI Mode**: WebSocket双方向通信のテストデータ
- **SSE Mode**: Server-Sent Eventsのテストデータ

## 配置理由

`lib/tests/fixtures/` に配置することで:
- `integration/` テストから共通利用
- 将来的な `e2e/` テストからも共通利用
- テストデータの一元管理

## 命名規則

```
{function-name}-{status}-{mode}-baseline.json
```

- `function-name`: テスト対象の機能名 (get_weather, process_payment など)
- `status`: 実行結果の状態 (approved, denied, error-handling など)
- `mode`: 通信モード (bidi, sse)
- `baseline`: ベースラインデータであることを示す接尾辞

## ファイル一覧

### Tool Call Tests

#### get_weather (天気取得)
- `get_weather-bidi-baseline.json` - BIDI モードでの通常実行
- `get_weather-sse-baseline.json` - SSE モードでの通常実行

#### get_location (位置情報取得 - 承認フロー)
- `get_location-approved-bidi-baseline.json` - BIDI モードで承認
- `get_location-approved-sse-baseline.json` - SSE モードで承認
- `get_location-denied-bidi-baseline.json` - BIDI モードで拒否
- `get_location-denied-sse-baseline.json` - SSE モードで拒否

#### process_payment (決済処理 - 承認フロー)
- `process_payment-approved-bidi-baseline.json` - BIDI モードで承認
- `process_payment-approved-sse-baseline.json` - SSE モードで承認
- `process_payment-denied-bidi-baseline.json` - BIDI モードで拒否
- `process_payment-denied-sse-baseline.json` - SSE モードで拒否
- `process_payment-error-handling-green.json` - エラーハンドリング成功ケース
- `process_payment-failing-bidi-red.json` - BIDI モード失敗ケース

#### change_bgm (BGM変更)
- `change_bgm-bidi-baseline.json` - BIDI モードでのBGM変更
- `change_bgm-sse-baseline.json` - SSE モードでのBGM変更

## 使用方法

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const baseline = JSON.parse(
  readFileSync(
    join(__dirname, "..", "fixtures", "get_weather-bidi-baseline.json"),
    "utf-8"
  )
);

// テストでbaselineと実際の結果を比較
expect(actualChunks).toEqual(baseline.chunks);
```

## ベースライン更新

新しい機能を追加した場合:

1. テストを実行して正しい出力を確認
2. 出力をJSONファイルとして保存
3. 命名規則に従ってファイル名を設定
4. このREADMEを更新

## 注意事項

- ベースラインファイルは **期待される正しい動作** を表します
- テストが失敗した場合、実装が間違っているかベースラインが古い可能性があります
- ベースライン更新時は必ず変更内容をレビューしてください
