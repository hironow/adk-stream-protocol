# 0012. Frontend Approval UI Display Timing

**Date:** 2026-01-18
**Status:** Accepted

## Context

Vercel AI SDK v6 の `useChat` フックを使用してフロントエンドを実装している。Tool approval フローにおいて、以下の要素が関係する：

1. **Backend からのイベントストリーム**: `tool-input-start` → `tool-input-available` → `tool-approval-request` の順序で送信
2. **AI SDK v6 の状態管理**: `toolInvocations` 配列で各ツールの状態を追跡
3. **`sendAutomaticallyWhen` コールバック**: ユーザー承認後の自動送信タイミングを制御

### 問題点

AI SDK v6 のドキュメントでは「ストリームが閉じる必要はない」と記載されているが、実際の実装では `sendAutomaticallyWhen` の評価は `status !== "streaming"` の条件下でのみ実行される（ADR 0011 参照）。

これにより、ADK の BLOCKING モードでは以下のデッドロックが発生する：

- フロントエンドは `sendAutomaticallyWhen` の発火を待つ
- バックエンドは承認レスポンスを待って `finish` を送信しない
- 結果：相互待機状態

## Decision

### 1. UI 表示タイミング

承認 UI は `tool-approval-request` イベント受信時に表示する。

```
Backend Event                    Frontend State
─────────────────────────────────────────────────
tool-input-start           →    toolInvocation: { state: 'partial-call' }
tool-input-available       →    toolInvocation: { state: 'call', args: {...} }
tool-approval-request      →    toolInvocation: { state: 'approval-requested' }  ← UI表示
                                ↓
                           [ユーザーが承認/拒否を選択]
                                ↓
                           addToolApprovalResponse() 呼び出し
```

### 2. `finish-step` Injection の採用

BIDI モードでは `tool-approval-request` の前後に `start-step` / `finish-step` を注入する（ADR 0011）。

```
Backend Event Sequence (BIDI)
─────────────────────────────────────────────────
tool-input-start
tool-input-available
start-step               ← ADR 0011: ストリーム継続を示す
tool-approval-request    ← UI表示トリガー
finish-step              ← ADR 0011: sendAutomaticallyWhen 評価を可能に
[待機: ユーザー承認]
tool-output-available    ← 承認後にバックエンドが実行結果を送信
```

### 3. Fixture との対応

| Fixture Event | Frontend Action |
|---------------|-----------------|
| `tool-input-start` | ツール呼び出し開始を認識 |
| `tool-input-available` | ツールの引数を表示可能 |
| `tool-approval-request` | **承認 UI を表示** |
| `finish-step` (BIDI) | `sendAutomaticallyWhen` 評価が可能になる |
| `tool-output-available` | 実行結果を表示 |
| `tool-output-error` | エラーを表示（拒否時） |

## Consequences

### Positive

- AI SDK v6 の `useChat` フックと自然に統合できる
- `tool-approval-request` イベントが明確な UI 表示トリガーとなる
- `finish-step` injection によりデッドロックを回避

### Negative

- BIDI モードでは追加のイベント（`start-step`/`finish-step`）が必要
- SSE モードと BIDI モードで微妙に異なるイベントシーケンスを処理する必要がある

### Neutral

- フロントエンドは `toolInvocations` の `state` フィールドを監視するだけでよい
- バックエンドが適切なイベントシーケンスを保証する責任を持つ

## Related ADRs

- ADR 0003: SSE vs BIDI Confirmation Protocol Differences
- ADR 0009: BIDI Blocking Mode for Tool Approval Flow
- ADR 0011: BIDI Approval Deadlock - finish-step Injection Solution
