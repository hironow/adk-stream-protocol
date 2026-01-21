# Fixtures と ADR の対応関係

このドキュメントは `fixtures/frontend/` 配下の JSON ファイルが、どの ADR（Architecture Decision Record）に準拠しているかをまとめたものである。

## 概要

### Fixture の役割

- バックエンドの実際の挙動をキャプチャした JSON ファイル
- フロントエンドの E2E テストのベースライン
- ADR で定義されたプロトコルの具体的な実装例

### ツール分類

| ツール | 承認要否 | 実行場所 | パターン (ADR) |
|--------|---------|---------|---------------|
| `process_payment` | 必要 | バックエンド | Server Execute |
| `get_location` | 必要 | フロントエンド | Frontend Execute (ADR 0005) |
| `change_bgm` | 不要 | フロントエンド | Frontend Delegation |
| `get_weather` | 不要 | バックエンド | Server Execute |

**実行パターンの違い**:
- **Server Execute**: バックエンドがツールを実行し結果を返す
- **Frontend Execute**: 承認後、フロントエンドがブラウザAPI（Geolocation等）を実行し `addToolOutput()` で結果送信
- **Frontend Delegation**: 承認不要、フロントエンドに委譲

---

## ADR 別マッピング

### ADR 0003: SSE vs BIDI Confirmation Protocol Differences

**要点**: SSE と BIDI では異なるプロトコルが必要。SSE は並列承認可能、BIDI は順次実行のみ。

| Fixture | Mode | 準拠内容 |
|---------|------|---------|
| `process_payment-approved-sse-baseline.json` | SSE | 2 HTTP リクエスト、`expectedDoneCount: 2` |
| `process_payment-denied-sse-baseline.json` | SSE | 同上 |
| `multiple-payments-approved-sse-baseline.json` | SSE | **並列承認**: 2 つの `tool-approval-request` が同一レスポンス |
| `multiple-payments-sequential-bidi-baseline.json` | BIDI | **順次実行**: Alice → 承認 → Bob → 承認 |

**検証ポイント**:

```
SSE Mode:
- expectedDoneCount: 2 (2つのHTTPリクエスト)
- 複数ツールで並列に tool-approval-request を送信可能

BIDI Mode:
- expectedDoneCount: 1 (単一ストリーム)
- 複数ツールは順次実行のみ
```

---

### ADR 0009: BIDI Blocking Mode for Tool Approval Flow

**要点**: BIDI では `types.Behavior.BLOCKING` を使用し、単一ストリームで処理。

| Fixture | 準拠内容 |
|---------|---------|
| `process_payment-approved-bidi-baseline.json` | `expectedDoneCount: 1`、単一ストリーム |
| `process_payment-denied-bidi-baseline.json` | denial 時に `tool-output-error` |
| `get_location-approved-bidi-baseline.json` | `expectedDoneCount: 1` |
| `get_location-denied-bidi-baseline.json` | denial 時に `tool-output-error` |
| `multiple-payments-sequential-bidi-baseline.json` | 複数ツールでも `expectedDoneCount: 1` |

**検証ポイント**:

```json
{
  "expectedDoneCount": 1,
  "expectedStreamCompletion": true
}
```

---

### ADR 0011: BIDI Approval Deadlock - finish-step Injection Solution

**要点**: デッドロック解消のため、`tool-approval-request` の前後に `start-step`/`finish-step` を注入。

| Fixture | 準拠内容 |
|---------|---------|
| `process_payment-approved-bidi-baseline.json` | `start-step` → `tool-approval-request` → `finish-step` |
| `process_payment-denied-bidi-baseline.json` | 同上 |
| `get_location-approved-bidi-baseline.json` | 同上 |
| `get_location-denied-bidi-baseline.json` | 同上 |
| `multiple-payments-sequential-bidi-baseline.json` | 各承認に `start-step`/`finish-step` あり |

**検証ポイント** (イベント順序):

```
tool-input-start
tool-input-available
start-step          ← ADR 0011
tool-approval-request
finish-step         ← ADR 0011
tool-output-available (承認後)
```

---

## ツール別 Fixture 一覧

### process_payment (承認必要 / Server Execute)

**実行パターン**: Server Execute
- 承認後、バックエンドが決済処理を実行
- 結果は `tool-output-available` でストリーム送信

**承認フロー (ADR 0012)**:

```
[Backend]                              [Frontend]
─────────────────────────────────────────────────────────────
tool-input-start                 →     ツール呼び出し認識
tool-input-available             →     引数表示 (recipient, amount, currency)
start-step (BIDI only)           →     -
tool-approval-request            →     ★ 承認UI表示
finish-step (BIDI only)          →     sendAutomaticallyWhen 評価可能
                                       ↓
                                 [ユーザー選択]
                                       ↓
─────────────────────────────────────────────────────────────
[承認時 OK]
                                 ←     addToolApprovalResponse(approved)
tool-output-available            →     決済結果表示 (transaction_id, wallet_balance)
text-delta                       →     AIの応答テキスト
─────────────────────────────────────────────────────────────
[拒否時 NG]
                                 ←     addToolApprovalResponse(denied)
tool-output-error                →     エラー表示 ("User denied the tool call")
text-delta                       →     AIの応答テキスト
```

| Fixture | Mode | シナリオ |
|---------|------|---------|
| `process_payment-approved-bidi-baseline.json` | BIDI | 承認フロー |
| `process_payment-denied-bidi-baseline.json` | BIDI | 拒否フロー |
| `process_payment-timeout-bidi-baseline.json` | BIDI | タイムアウト |
| `process_payment-approved-sse-baseline.json` | SSE | 承認フロー |
| `process_payment-denied-sse-baseline.json` | SSE | 拒否フロー |

### get_location (承認必要 / Frontend Execute)

**実行パターン**: Frontend Execute (ADR 0005)
- 承認後、フロントエンドがブラウザの Geolocation API を実行
- `addToolOutput()` で位置情報をバックエンドに送信

**承認フロー (ADR 0012 + ADR 0005)**:

```
[Backend]                              [Frontend]
─────────────────────────────────────────────────────────────
tool-input-start                 →     ツール呼び出し認識
tool-input-available             →     引数表示 (なし or オプション)
start-step (BIDI only)           →     -
tool-approval-request            →     ★ 承認UI表示 (位置情報取得の許可)
finish-step (BIDI only)          →     sendAutomaticallyWhen 評価可能
                                       ↓
                                 [ユーザー選択]
                                       ↓
─────────────────────────────────────────────────────────────
[承認時 OK]
                                 ←     addToolApprovalResponse(approved)
                                       ↓
                                 [フロントエンドがブラウザAPI実行]
                                       navigator.geolocation.getCurrentPosition()
                                       ↓
                                 ←     addToolOutput({latitude, longitude})
tool-output-available            →     位置情報結果表示
text-delta                       →     AIの応答テキスト
─────────────────────────────────────────────────────────────
[拒否時 NG]
                                 ←     addToolApprovalResponse(denied)
tool-output-error                →     エラー表示 ("User denied the tool call")
text-delta                       →     AIの応答テキスト
```

**Server Execute との違い**:
- Server Execute: 承認後、バックエンドが即座に実行
- Frontend Execute: 承認後、フロントエンドがブラウザAPIを実行し、`addToolOutput()` で結果を送信

| Fixture | Mode | シナリオ |
|---------|------|---------|
| `get_location-approved-bidi-baseline.json` | BIDI | 承認フロー |
| `get_location-denied-bidi-baseline.json` | BIDI | 拒否フロー |
| `get_location-approved-sse-baseline.json` | SSE | 承認フロー |
| `get_location-denied-sse-baseline.json` | SSE | 拒否フロー |

### multiple-payments (複数ツール)

**承認フローの違い (ADR 0003 + ADR 0012)**:

各ツールの承認 UI 表示タイミングは `process_payment` と同じ（`tool-approval-request` 受信時）。
ただし、モードによって複数ツールの処理順序が異なる。

```
[BIDI Mode - 順次実行]
─────────────────────────────────────────────────────────────
Alice: tool-approval-request   →  ★ 承認UI表示
Alice: [ユーザー承認/拒否]
Alice: tool-output-available   →  結果表示
                                  ↓
Bob:   tool-approval-request   →  ★ 承認UI表示 (Alice完了後)
Bob:   [ユーザー承認/拒否]
Bob:   tool-output-available   →  結果表示
─────────────────────────────────────────────────────────────

[SSE Mode - 並列承認]
─────────────────────────────────────────────────────────────
Alice: tool-approval-request   →  ★ 承認UI表示
Bob:   tool-approval-request   →  ★ 承認UI表示 (同時に表示可能)
                                  ↓
[ユーザーが両方を承認/拒否]
                                  ↓
Alice: tool-output-available   →  結果表示
Bob:   tool-output-available   →  結果表示
─────────────────────────────────────────────────────────────
```

| Fixture | Mode | シナリオ |
|---------|------|---------|
| `multiple-payments-sequential-bidi-baseline.json` | BIDI | 順次実行 (Alice → Bob) |
| `multiple-payments-approved-sse-baseline.json` | SSE | 並列承認 |
| `multiple-payments-approve-deny-bidi.json` | BIDI | Alice 承認 → Bob 拒否 |
| `multiple-payments-approve-deny-sse.json` | SSE | Alice 承認 → Bob 拒否 |
| `multiple-payments-deny-approve-bidi.json` | BIDI | Alice 拒否 → Bob 承認 |
| `multiple-payments-deny-approve-sse.json` | SSE | Alice 拒否 → Bob 承認 |
| `multiple-payments-deny-deny-bidi.json` | BIDI | 両方拒否 |
| `multiple-payments-deny-deny-sse.json` | SSE | 両方拒否 |

### change_bgm (承認不要)

| Fixture | Mode | シナリオ |
|---------|------|---------|
| `change_bgm-bidi-baseline.json` | BIDI | フロントエンド委譲 |
| `change_bgm-sse-baseline.json` | SSE | フロントエンド委譲 |

### get_weather (承認不要)

| Fixture | Mode | シナリオ |
|---------|------|---------|
| `get_weather-bidi-baseline.json` | BIDI | 即時実行 |
| `get_weather-sse-baseline.json` | SSE | 即時実行 |

---

## Quick Reference: 主要な検証ポイント

### BIDI Mode チェックリスト

- [ ] `expectedDoneCount: 1`
- [ ] 承認ツールに `start-step` / `finish-step` あり
- [ ] 複数ツールは順次実行（並列なし）

### SSE Mode チェックリスト

- [ ] `expectedDoneCount: 2` (承認フローの場合)
- [ ] 複数ツールで並列に `tool-approval-request` 送信可能
- [ ] `start-step` / `finish-step` なし

### 承認ツール共通チェックリスト

- [ ] `tool-input-start` → `tool-input-available` → `tool-approval-request` の順序
- [ ] 承認時: `tool-output-available`
- [ ] 拒否時: `tool-output-error`

---

## 関連 ADR

| ADR | タイトル | 主な関連 Fixture |
|-----|---------|-----------------|
| 0003 | SSE vs BIDI Confirmation Protocol | `multiple-payments-*` |
| 0005 | Frontend Execute Pattern | `get_location-*` |
| 0009 | BIDI Blocking Mode | 全 BIDI fixture |
| 0011 | finish-step Injection | 承認必要 BIDI fixture |
| 0012 | Frontend Approval UI Display Timing | 全承認必要 fixture |

詳細は `docs/adr/` ディレクトリを参照。
