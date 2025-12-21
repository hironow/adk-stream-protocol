# ADK AI Data Protocol - Agents ディレクトリサマリー

**最終更新**: 2025-12-21  
**ブランチ**: `hironow/fix-confirm`  
**プルリクエスト**: [#1 WIP] fix confirm process on BIDI mode

---

## 📖 目次

1. [概要](#概要)
2. [現在の状況](#現在の状況)
3. [テスト失敗一覧](#テスト失敗一覧)
4. [進行中の調査](#進行中の調査)
5. [タスク管理](#タスク管理)
6. [技術的知見](#技術的知見)
7. [開発履歴](#開発履歴)

---

## 概要

このディレクトリは、ADK AI Data Protocolプロジェクトの開発記録を管理します。エージェント（AI開発アシスタント）との作業セッションで生成されたドキュメント群です。

### 各ファイルの役割

- **[current_tests_fails.md](current_tests_fails.md)** - 現在失敗しているテストの完全なリスト（Python 44個、TypeScript 19個）
- **[tasks.md](tasks.md)** - 現在進行中のタスクと次のアクションアイテム
- **[bidi-tool-execution-investigation.md](bidi-tool-execution-investigation.md)** - BIDIモードのツール実行プロトコルミスマッチ調査
- **[handsoff.md](handsoff.md)** - セッション間の引き継ぎ情報（最新: Session 10）
- **[insights.md](insights.md)** - 技術的知見とアーキテクチャの意思決定記録

---

## 🎯 現在取り組んでいる主要トピック

**全体**: ツール確認フロー（Tool Confirmation Flow）の修正と完成

**3つの主要課題**:

1. **BIDIプロトコルミスマッチ修正** 🔴 CRITICAL
   - 問題: カスタムWebSocketイベントでなくAI SDK v6標準メッセージフォーマットが必要
   - 影響: E2E BIDIテストでAIが誤応答（"waiting for approval"）
   - 対応: `lib/confirmation-handler.ts` のプロトコル変更

2. **Missing Tool-Input Events バグ修正** 🟡 HIGH  
   - 問題: 確認フローで元のツールIDの`tool-input-*`イベントが欠落
   - 影響: フロントエンドが「tool invocation not found」エラー
   - 対応: `services/bidi_event_sender.py`, `services/sse_event_streamer.py` にイベント追加

3. **ID Mapper実装ギャップ解消** 🟡 HIGH
   - 問題: ID登録後に`get_function_call_id()`でIDが見つからない
   - 影響: Python unit test 44個失敗（confirmation系、delegate系）
   - 対応: `adk_vercel_id_mapper.py` のルックアップロジック修正

---

## 現在の状況

### 全体テスト状況

| カテゴリ | 状況 | 詳細 |
|---------|------|------|
| Python Unit | 🔴 303 passed, **44 failed** | ID Mapper実装ギャップ |
| TypeScript | 🔴 426 passed, **19 failed**, 7 skipped | WebSocket/Audio未実装 |
| Integration | 🔴 29 passed, **9 failed** | 確認フロー関連の失敗 |
| E2E | 🔴 3/11 passing | ツール確認フロー問題 |

### 最重要課題（優先度順）

1. **BIDI確認フロー: プロトコルミスマッチ** 🔴 CRITICAL  
   → [bidi-tool-execution-investigation.md](bidi-tool-execution-investigation.md#phase-2-protocol-mismatch-current-) 参照

2. **Missing Tool-Input Events** 🟡 HIGH  
   → [handsoff.md](handsoff.md#bug-being-fixed) 参照

3. **ID Mapper実装ギャップ** 🟡 HIGH  
   → [current_tests_fails.md](current_tests_fails.md#python側) の根本原因参照

---

## テスト失敗一覧

**詳細**: [current_tests_fails.md](current_tests_fails.md)

### Python失敗の内訳（44個）

| ファイル | 失敗数 | 主な原因 |
|---------|--------|---------|
| test_confirmation_interceptor.py | 8 | `Function call ID not found for tool: adk_request_confirmation` |
| test_global_delegate_pattern.py | 15 | 同上（グローバルデリゲートパターン） |
| test_frontend_tool_service.py | 14 | 同上（IDマッパー登録後に取得失敗） |
| test_frontend_delegate.py | 6 | 同上（Future解決フロー） |
| test_bidi_event_sender.py | 1 | WebSocket切断処理未実装 |

**共通根本原因**: ID Mapperへの登録後、`get_function_call_id()`でIDが見つからない問題

### TypeScript失敗の内訳（19個）

| ファイル | 失敗数 | 主な原因 |
|---------|--------|---------|
| websocket-chat-transport.test.ts | 5 | `connectionId`未初期化、Controller管理 |
| websocket-no-truncation.test.ts | 5 | メッセージ送信機能未実装 |
| bidi-event-receiver.test.ts | 4 | PCMオーディオ処理未実装 |
| transport-integration.test.ts | 2 | WebSocketChatTransport統合未完成 |
| build-use-chat-options.test.ts | 2 | Transport作成ロジック未実装 |
| bidi-event-flow.test.ts | 1 | PCMオーディオフロー未実装 |

**共通根本原因**: WebSocket接続管理とオーディオストリーミング機能の未実装

---

## 進行中の調査

### 1. BIDIツール実行プロトコルミスマッチ

**詳細**: [bidi-tool-execution-investigation.md](bidi-tool-execution-investigation.md)

**問題**: SSE確認フロー修正後、BIDI E2Eテストがタイムアウト

**調査フェーズ**:
- ✅ Phase 1: `this`バインディング問題 → 解決済み
- 🔴 Phase 2: プロトコルミスマッチ → **現在調査中**

**症状**:
```
期待: "Transfer completed!"
実際: "I'm waiting for your approval..."
```

**根本原因**:
```typescript
// ❌ 現在の実装（間違い）
transport.websocket.sendToolResult(
  "confirmation-function-call-...",  // 確認ツールID
  { confirmed: true }                 // カスタムフォーマット
)

// ✅ ベースライン（正しい）
// ユーザーメッセージとして送信
{"type":"message", "data":{"messages":[{
  "role":"user",
  "content":[{
    "type":"tool-result",
    "toolCallId":"function-call-123",  // 元のツールID
    "toolName":"process_payment",
    "result":{"approved":true}
  }]
}]}}
```

**次のアクション**:
1. AI SDK v6の標準フローを使用（`addToolApprovalResponse`）
2. または手動でユーザーメッセージを構築
3. ベースラインのチャンクログと比較検証

### 2. Missing Tool-Input Events バグ

**詳細**: [handsoff.md](handsoff.md#bug-being-fixed)

**問題**: フロントエンドが見たことのないツールIDで`tool-output-available`を受信

**期待イベントシーケンス**:
```
1. tool-input-start (元のID: function-call-123)         ← 欠落
2. tool-input-available (元のID: function-call-123)     ← 欠落
3. tool-input-start (確認ID: confirmation-function-call-123)
4. tool-input-available (確認ID: confirmation-function-call-123)
5. tool-output-available (確認ID)
6. tool-output-available (元のID: function-call-123)  ← エラー発生
```

**RED tests作成済み** (意図的な失敗):
- `tests/integration/test_bidi_confirmation_tool_input_events.py` (2個)
- `tests/integration/test_sse_confirmation_tool_input_events.py` (2個)

**修正箇所**:
- `services/bidi_event_sender.py:_handle_confirmation_if_needed()`
- `services/sse_event_streamer.py:_handle_confirmation_if_needed()`

---

## タスク管理

**詳細**: [tasks.md](tasks.md)

> **現在進行中の作業**: [tasks.md](tasks.md) にアクティブタスクと完了済みタスクの完全なリストあり  
> **セッション引き継ぎ**: [handsoff.md](handsoff.md) に最新のSession 10作業内容と次のステップの詳細あり

### アクティブタスク

**🔴 CRITICAL: BIDIプロトコル修正**
- **状況**: プロトコルミスマッチ特定済み
- **ブランチ**: `hironow/fix-confirm`
- **実装箇所**: `lib/confirmation-handler.ts`
- **期待**: ユーザーメッセージとして承認を送信（WebSocketイベントではなく）

### 完了済み（Session 11）

- ✅ SSE確認フロー修正（ADKネイティブハンドリングへのパススルー）
- ✅ BIDI `this`バインディング修正（`createConfirmationTransport`ヘルパー）
- ✅ フロントエンド確認ハンドラー作成（9テスト全て通過）

### 主要ファイル（Session 11で作成/修正）

**作成**:
- `lib/confirmation-handler.ts` - 確認処理ロジック（プロトコル修正必要）
- `lib/confirmation-handler.test.ts` - ユニットテスト（9テスト）
- `agents/bidi-tool-execution-investigation.md` - 調査ノート

**修正**:
- `components/tool-invocation.tsx` - 確認ハンドラー使用
- `services/sse_event_streamer.py` - パススルーに簡略化

---

## 技術的知見

**詳細**: [insights.md](insights.md)

### Session 11の重要な学び

> **詳細**: [insights.md](insights.md#session-11-2025-12-20-frontend-confirmation-handler--protocol-mismatch) に完全な分析あり

#### 1. SSE vs BIDI確認アーキテクチャ

*SSEはADKネイティブ対応（2リクエスト）、BIDIは手動でAI SDK v6メッセージ構築が必要*

**SSE Mode（2つのHTTPリクエスト）**:
```
Request 1: ユーザー入力 → 確認UI表示 → [DONE]
Request 2: ツール承認 → ツール実行 → AI応答 → [DONE]
```

**BIDI Mode（単一WebSocket接続）**:
```
ユーザー入力 → 確認UI表示
↓
ユーザー承認（AI SDK v6フォーマット必須！）
↓
ツール実行 → AI応答
```

**重要な違い**: SSEはADKがネイティブ対応、BIDIは手動でメッセージ構築が必要

#### 2. JavaScript `this`バインディングの罠

*メソッド参照の抽出で`this`コンテキストが失われる問題と、アロー関数ラッパーによる解決*

**問題**:
```typescript
// メソッド参照を抽出すると'this'コンテキストを失う
const transport = {
  websocket: {
    sendToolResult: websocketTransport.sendToolResult  // ❌ this喪失
  }
}
```

**解決**:
```typescript
// アロー関数ラッパーで'this'を保持
export function createConfirmationTransport(websocketTransport) {
  return {
    websocket: websocketTransport ? {
      sendToolResult: (toolCallId, result) =>
        websocketTransport.sendToolResult(toolCallId, result)  // ✅
    } : undefined
  }
}
```

#### 3. プロトコルを勝手に作らない

*カスタムWebSocketイベントではなく、AI SDK v6標準メッセージフォーマットを使用すべき教訓*

**失敗例**:
カスタムWebSocketイベントで確認を送信（間違い）

**教訓**:
既存の動作実装（ベースライン）を先に調査してから、標準プロトコル（AI SDK v6）を使用すること

### Session 10の重要な学び

> **詳細**: [insights.md](insights.md#session-10-2025-12-20-type-based-conversion-state--missing-tool-input-events-bug) に完全な分析あり

#### 1. 型ベースの変換状態パターン

*`Event | SseFormattedEvent`型で変換状態を表現し、`isinstance(event, str)`で判別*

```python
# stream_protocol.py
type SseFormattedEvent = str  # 型エイリアス

async def stream_adk_to_ai_sdk(
    event_stream: AsyncGenerator[Event | SseFormattedEvent, None],
    ...
) -> AsyncGenerator[SseFormattedEvent, None]:
    async for event in event_stream:
        if isinstance(event, str):  # 型で判別
            yield event  # 変換済み → パススルー
            continue
        # Event → 変換が必要
        async for sse_event in converter.convert_event(event):
            yield sse_event
```

**利点**:
- 型システムが変換状態を強制
- ランタイムトリック不要
- 責任分離が明確
- 自己文書化

#### 2. コード再利用性

*SSEフォーマット処理を`format_sse_event()`として抽出し、複数コンポーネントで共通利用*

`format_sse_event()`を抽出してモジュールレベル関数化:
- BidiEventSender、SseEventStreamer、StreamProtocolConverter で共通使用
- SSEフォーマットの単一情報源
- コピペバグ防止

#### 3. REDテスト戦略

*E2Eバグを高速な統合テストで再現し、実装前に期待動作をドキュメント化*

**E2Eバグを統合テストで再現**:
- 高速フィードバック（11秒 vs E2Eの9分）
- 明確な失敗メッセージ
- デバッグが容易
- バグをドキュメント化

**証拠**:
- 4つのREDテスト全てが期待通り失敗
- エラーメッセージが欠落イベントを明示
- 修正後に自動的にGREENに転換

---

## 開発履歴

### Session 11 (2025-12-20): フロントエンド確認ハンドラー & プロトコルミスマッチ

**達成**:
- SSE修正完了（パススルー） ✅
- BIDI部分修正（`this`バインディング） ✅
- プロトコルミスマッチ発見 🔴

**統計**:
- 新規ファイル: 2個（confirmation-handler関連）
- 修正: 3ファイル
- 新規コード: ~350行（プロトコル修正後にリファクタリング必要）

**テスト結果**:
- Unit: 全て通過 ✅
- Integration: 全て通過 ✅
- E2E SSE: 全て通過 ✅
- E2E BIDI: 失敗 🔴（AI応答が間違い）

### Session 10 (2025-12-20): 型ベース変換 & Missing Tool-Input Events

**達成**:
- 型ベース変換状態パターン実装 ✅
- `format_sse_event()`抽出 ✅
- REDテスト作成（4個） ✅
- 非推奨コード削除（837行） ✅

**統計**:
- 追加: 391行
- 削除: 837行
- 正味: -446行（コード削減！）

**テスト結果**:
- Unit: 22/22 ✅
- Integration: 28/28 ✅（4 REDテスト含む）
- E2E: 3/11 🔴（8失敗をREDテストでドキュメント化）

### Session 9 (2025-12-19): ToolContext Mock削除

**問題**: MockがFrontendDelegate アクセスを妨害  
**解決**: 実際の`ToolContext(invocation_id, session)`使用  
**結果**: `get_location-bidi` Test 1が通過

### Session 8 (2025-12-19): BIDI確認IDバグ修正

**問題**: 確認IDが未登録、コンテキスト認識ルックアップが誤ID返却  
**解決**: 確認ID登録とルックアップ修正  
**結果**: 統合テスト全て通過（4/4 RED→GREEN）

### Session 7以前: 基盤作業

> **詳細**: [insights.md](insights.md#-adk-tool-confirmation-無限ループ修正記録) にツール確認無限ループ修正の完全な記録あり

**主な達成**:
- ツール確認フロー実装（SSE/BIDI）
- チャンクロガー統合とテスト（出力パス表示、ダウンロードボタン）
- E2Eテストマトリックス拡張（100%カバレッジ、4x2x2）
- フロントエンドデリゲートツール実装
- オーディオストリーミングとマルチモーダルサポート
- LongRunningFunctionToolパターン実装
- **ツール確認無限ループ修正（2025-12-17）** - テキストコンテンツ検出方式に変更

**歴史的バグ修正** ([insights.md](insights.md#historical-bug-fixes-reference) 参照):
- WebSocket切断時のエラーハンドリング改善
- ChatMessage.content型ミスマッチ修正

**詳細**: Gitコミット履歴、experiments/README.md参照

---

## クイックスタート

### 現在のテスト失敗を確認

```bash
# Python失敗リスト
uv run pytest tests/unit/ --tb=no -q 2>&1 | grep "^FAILED"

# TypeScript失敗リスト
pnpm exec vitest --run --reporter=verbose 2>&1 | grep "FAIL"
```

### REDテストを実行

```bash
# Missing tool-input events（意図的失敗）
uv run pytest tests/integration/test_bidi_confirmation_tool_input_events.py -v
uv run pytest tests/integration/test_sse_confirmation_tool_input_events.py -v
```

### 次のアクション

1. **BIDIプロトコル修正**: [bidi-tool-execution-investigation.md](bidi-tool-execution-investigation.md#next-steps) 参照
2. **Missing Events修正**: [handsoff.md](handsoff.md#next-steps-green-phase) 参照
3. **ID Mapper修正**: [current_tests_fails.md](current_tests_fails.md#根本原因) 参照

---

## 参考リンク

### Agents ディレクトリ（このディレクトリ）
- **[current_tests_fails.md](current_tests_fails.md)** - 全テスト失敗の完全なリスト（Python 44個、TypeScript 19個）
- **[tasks.md](tasks.md)** - 現在進行中のタスクと次のアクション
- **[bidi-tool-execution-investigation.md](bidi-tool-execution-investigation.md)** - BIDIプロトコルミスマッチ調査の詳細
- **[handsoff.md](handsoff.md)** - Session 10の完全な作業記録と次のステップ
- **[insights.md](insights.md)** - 技術的知見の完全な記録（Session 11, 10, 歴史的バグ修正）

### プロジェクト内部
- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) - システム全体アーキテクチャ
- [TEST_COVERAGE_AUDIT.md](../docs/TEST_COVERAGE_AUDIT.md) - テストカバレッジ詳細
- [E2E_GUIDE.md](../docs/E2E_GUIDE.md) - E2Eテスト実行ガイド

### チャンクログ
- `chunk_logs/e2e-baseline/` - 動作確認済みベースライン（BIDIプロトコル比較用）
- `chunk_logs/scenario-**/` - 各テストシナリオのログ

### 外部リソース
- [Vercel AI SDK v6](https://sdk.vercel.ai/docs) - AI SDKドキュメント
- [ADK Documentation](https://developer.anthropic.com/en/docs/) - Anthropic ADK
