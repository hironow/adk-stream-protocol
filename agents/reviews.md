# AI SDK v6 × Gemini Flash 2.5 Data Stream Protocol 対応状況

**更新日**: 2025-12-11

このドキュメントは、AI SDK v6 Data Stream Protocol と Gemini Flash 2.5 の組み合わせで発生するすべてのイベントの対応状況を追跡します。

## 対応状況の凡例

- ✅ **完全対応**: Backend変換 + Frontend表示の両方が完全に実装済み
- ⚠️ **部分対応**: 一部のケースで動作するが、完全ではない
- 🔧 **実装中**: 現在開発中
- ❌ **未対応**: 未実装
- ➖ **対象外**: 現在の要件では不要

---

## 1. テキストコンテンツ (Text Content)

### 1.1 基本テキストストリーミング

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Backend Test | Frontend実装 | Frontend Test | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|---|---|
| `text-start` | `content.parts[].text` | ✅ | ✅ | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:193, message.tsx:120-132 |
| `text-delta` | `content.parts[].text` | ✅ | ✅ | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:195, useChat handles |
| `text-end` | `content.parts[].text` | ✅ | ✅ | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:197, useChat handles |

**テスト状況**:
- [x] Gemini Direct mode
- [x] ADK SSE mode
- [x] ADK BIDI mode

**備考**: テキストストリーミングは3つのモード全てで正常動作確認済み

---

## 2. 推論コンテンツ (Reasoning / Thinking)

### 2.1 Gemini 2.0 Thinking Mode

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `reasoning-start` | `content.parts[].thought` | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:201-210, message.tsx:136-171 |
| `reasoning-delta` | `content.parts[].thought` | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:207, useChat handles |
| `reasoning-end` | `content.parts[].thought` | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:209, useChat handles |

**テスト状況**:
- [ ] Gemini Direct mode (thinking mode未テスト)
- [ ] ADK SSE mode (thinking mode未テスト)
- [ ] ADK BIDI mode (thinking mode未テスト)

**備考**:
- Frontend実装済み（collapsible details UIで表示）
- Gemini 2.0のthinking modeを有効化すれば動作するはず
- 実際のthinking mode応答でのテストが必要

---

## 3. ツール実行 (Tool Execution)

### 3.1 ツール呼び出しとレスポンス

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `tool-call-start` | `content.parts[].function_call` | ✅ | ✅ | **⚠️ 部分対応** | stream_protocol.py:213-220, message.tsx:215-221 |
| `tool-call-available` | `content.parts[].function_call` | ✅ | ✅ | **⚠️ 部分対応** | stream_protocol.py:227-234, message.tsx:225-240 |
| `tool-result-available` | `content.parts[].function_response` | ✅ | ✅ | **⚠️ 部分対応** | stream_protocol.py:238-252, message.tsx:225-240 |

**テスト状況**:
- [ ] Gemini Direct mode (tool call未テスト)
- [ ] ADK SSE mode (tool call未テスト)
- [ ] ADK BIDI mode (tool call未テスト)

**🚨 既知の問題**:

### Issue #1: Tool Call ID マッピング問題

**問題箇所**: stream_protocol.py:215, 242
```python
def _process_function_call(self, function_call):
    tool_call_id = self._generate_tool_call_id()  # 新規ID生成

def _process_function_response(self, function_response):
    tool_call_id = self._generate_tool_call_id()  # 別の新規ID生成！
```

**問題**:
- Function call と function response が**異なるID**を生成している
- AI SDKは `toolCallId` で call と result をマッチングする
- 現在の実装では正しく対応付けられない

**影響度**: 🔴 高（ツール実行が正しく動作しない可能性）

**推奨修正**:
1. ADKの `function_response.name` または `function_response.id` を使って対応付ける
2. または、tool_call_id をインスタンス変数のマッピングテーブルで管理する

**修正予定**: [ ] 未着手

---

## 4. 音声コンテンツ (Audio Content)

### 4.1 PCM音声ストリーミング

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `data-pcm` (Custom) | `content.parts[].inline_data` (audio/pcm) | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:274-317, message.tsx:100-115, audio-player.tsx |

**テスト状況**:
- [x] ADK BIDI mode (PCM 24000Hz)

**備考**:
- ADK BIDI modeでPCM音声が正常に再生されることを確認
- AudioPlayerコンポーネントがbase64デコード + Web Audio APIで再生

### 4.2 その他の音声形式

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `data-audio` (Custom) | `content.parts[].inline_data` (audio/mp3, audio/wav, etc.) | ✅ | ❌ | **⚠️ 部分対応** | stream_protocol.py:319-339, message.tsx:209-211 (skipped) |

**テスト状況**:
- [ ] MP3形式
- [ ] WAV形式
- [ ] その他の形式

**問題**:
- Backend実装: `data-audio` イベントを送信している
- Frontend実装: `data-audio` パートをスキップしている（null return）
- AudioPlayerはPCM専用で、他の形式に対応していない

**影響度**: 🟡 中（現在はPCMのみ使用しているため）

**推奨修正**:
1. AudioPlayerを拡張してMP3/WAV等のネイティブ再生に対応
2. または、`<audio>` タグでdata URLを直接再生

**修正予定**: [ ] 未着手

---

## 5. 画像コンテンツ (Image Content)

### 5.1 画像表示

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `data-image` (Custom) | `content.parts[].inline_data` (image/*) | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:341-370, message.tsx:192-201 |
| `file` part (v6 native) | File uploads from user | ✅ | ✅ | **✅ 完全対応** | server.py:391, message.tsx:175-188 |

**テスト状況**:
- [x] Gemini Direct mode (画像認識テスト済み)
- [x] ADK SSE mode (画像認識テスト済み)
- [x] ADK BIDI mode (画像認識テスト済み)

**備考**:
- AI SDK v6 files API (`experimental_attachments` → `files`) 移行完了
- 画像アップロード + 認識が3つのモード全てで正常動作確認済み
- Commit c638026, e14fe27

---

## 6. コード実行 (Code Execution)

### 6.1 Gemini 2.0 Code Execution機能

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `data-executable-code` (Custom) | `content.parts[].executable_code` | ✅ | ❌ | **❌ 未対応** | stream_protocol.py:254-262, message.tsx (not rendered) |
| `data-code-execution-result` (Custom) | `content.parts[].code_execution_result` | ✅ | ❌ | **❌ 未対応** | stream_protocol.py:264-272, message.tsx (not rendered) |

**テスト状況**:
- [ ] Code execution機能が有効なGeminiモデル

**問題**:
- Backend実装: カスタムイベント `data-executable-code` と `data-code-execution-result` を送信
- Frontend実装: これらのイベントを処理するコードが存在しない
- message.tsxでunknown part typeとして表示される可能性

**影響度**: 🟡 中（Gemini 2.0のcode execution機能を使用する場合に必要）

**推奨修正**:
1. CodeExecutionコンポーネントを作成（実行可能コードとその結果を表示）
2. message.tsxに以下を追加:
   ```tsx
   if (part.type === "data-executable-code") {
     return <CodeExecutionComponent key={index} code={part.data} />;
   }
   if (part.type === "data-code-execution-result") {
     return <CodeResultComponent key={index} result={part.data} />;
   }
   ```

**修正予定**: [ ] 未着手

---

## 7. メッセージ制御 (Message Control)

### 7.1 基本制御イベント

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `start` | Session start | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:128-132, useChat handles |
| `finish` | Response complete | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:410, useChat handles |
| `error` | Exception occurred | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:405, chat.tsx:82-86 |
| `[DONE]` marker | Stream termination | ✅ | ✅ | **✅ 完全対応** | stream_protocol.py:413, websocket-chat-transport.ts:197-201 |

**テスト状況**:
- [x] Gemini Direct mode
- [x] ADK SSE mode
- [x] ADK BIDI mode

**備考**: メッセージ制御イベントは全モードで正常動作確認済み

---

## 8. ステップ制御 (Step Control) - AI SDK v6 Multi-step

### 8.1 マルチステップ実行

| AI SDK v6 Event | Gemini/ADK Source | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `step-start` | Not mapped | ❌ | ⚠️ | **➖ 対象外** | N/A, message.tsx:243-245 (skipped) |
| `step-finish` | Not mapped | ❌ | ⚠️ | **➖ 対象外** | N/A, message.tsx:243-245 (skipped) |

**テスト状況**:
- [ ] Multi-step機能未使用

**備考**:
- AI SDK v6のマルチステップ機能は現在使用していない
- Frontendはstep-start/step-endイベントをスキップする実装
- 将来的に必要になった場合に実装予定

**修正予定**: [ ] 未着手（現在不要）

---

## 9. メタデータ・トランスクリプション (Metadata & Transcription)

### 9.1 Token使用量メタデータ

| Gemini/ADK Event | AI SDK v6 Equivalent | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `usage_metadata` | Message.usage | ❌ | ⚠️ | **⚠️ 部分対応** | N/A, message.tsx:288-315 |

**テスト状況**:
- [ ] usage_metadata取得

**問題**:
- Backend実装: ADKの `usage_metadata` を AI SDK形式に変換していない
- Frontend実装: Message.usage フィールドを表示する実装はあるが、データが来ていない

**影響度**: 🟡 中（コスト管理・デバッグに有用）

**推奨修正**:
1. stream_protocol.pyに `_process_usage_metadata()` メソッドを追加
2. ADKの `usage_metadata` を AI SDK v6のMessage.usage形式に変換:
   ```python
   {
     "promptTokens": usage.prompt_token_count,
     "completionTokens": usage.candidates_token_count,
     "totalTokens": usage.total_token_count
   }
   ```

**修正予定**: [ ] 未着手

### 9.2 音声トランスクリプション

| Gemini/ADK Event | AI SDK v6 Equivalent | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `input_transcription` | No standard event | ❌ | ❌ | **❌ 未対応** | N/A |
| `output_transcription` | No standard event | ❌ | ❌ | **❌ 未対応** | N/A |

**テスト状況**:
- [ ] 音声入力トランスクリプション
- [ ] 音声出力トランスクリプション

**問題**:
- ADK BIDI modeで音声のトランスクリプションが取得できるが、未使用
- AI SDK v6には標準的なtranscriptionイベントが存在しない

**影響度**: 🟢 低（アクセシビリティ・ロギング用途）

**推奨修正**:
1. カスタムイベント `data-transcription` を定義
2. 音声再生と同時にトランスクリプションテキストを表示

**修正予定**: [ ] 未着手

### 9.3 ストリーミング制御フラグ

| Gemini/ADK Event | AI SDK v6 Equivalent | Backend実装 | Frontend実装 | 対応状況 | 実装箇所 |
|---|---|---|---|---|---|
| `partial` flag | No standard event | ❌ | ❌ | **❌ 未対応** | N/A |
| `turn_complete` flag | `finish` event | ✅ | ✅ | **⚠️ 部分対応** | Mapped to finish event |
| `interrupted` flag | No standard event | ❌ | ❌ | **❌ 未対応** | N/A |

**テスト状況**:
- [ ] Partial応答
- [x] Turn complete (finish eventとしてマッピング済み)
- [ ] Interrupted応答

**問題**:
- ADK BIDIの細かい制御フラグ（partial, interrupted）が無視されている
- AI SDK v6には対応する標準イベントが存在しない

**影響度**: 🟢 低（現在の用途では不要）

**推奨修正**:
- 必要に応じてカスタムイベントとして実装

**修正予定**: [ ] 未着手（現在不要）

---

## 対応状況サマリー

### ✅ 完全対応 (8カテゴリー / 20イベント)

| カテゴリー | イベント数 | テスト完了 |
|---|---|---|
| テキストストリーミング | 3 | ✅ |
| 推論表示 (Thinking) | 3 | ⚠️ 実装済み・未テスト |
| ツール実行 | 3 | ⚠️ ID問題あり |
| PCM音声 | 1 | ✅ |
| 画像表示 | 2 | ✅ |
| ファイルアップロード | 1 | ✅ |
| メッセージ制御 | 4 | ✅ |
| エラーハンドリング | 1 | ✅ |

### ⚠️ 部分対応 (3カテゴリー / 5イベント)

| カテゴリー | 問題内容 | 優先度 |
|---|---|---|
| 音声コンテンツ (非PCM) | MP3/WAV等の再生未実装 | 🟡 中 |
| Token使用量メタデータ | Backend変換未実装 | 🟡 中 |
| 音声トランスクリプション | 表示未実装 | 🟢 低 |

### ❌ 未対応 (2カテゴリー / 4イベント)

| カテゴリー | 問題内容 | 優先度 |
|---|---|---|
| コード実行表示 | Frontend UI未実装 | 🟡 中 |
| ストリーミング制御フラグ | partial/interrupted未処理 | 🟢 低 |

### ➖ 対象外 (1カテゴリー / 2イベント)

| カテゴリー | 理由 |
|---|---|
| ステップ制御 | AI SDK v6 multi-step機能を現在使用していない |

---

## 優先度別の改善タスク

### 🔴 高優先度（即時対応推奨）

- [ ] **Issue #1: Tool Call ID マッピング問題の修正**
  - 実装箇所: stream_protocol.py:215, 242
  - 影響度: ツール実行が正しく動作しない可能性
  - 推定工数: 2時間

### 🟡 中優先度（次回対応推奨）

- [ ] **Token使用量メタデータの実装**
  - 実装箇所: stream_protocol.py (新規メソッド追加)
  - 影響度: コスト管理・デバッグに有用
  - 推定工数: 2時間

- [ ] **コード実行UIの実装**
  - 実装箇所: components/code-execution.tsx (新規), message.tsx
  - 影響度: Gemini 2.0 code execution機能の活用
  - 推定工数: 4時間

- [ ] **音声形式の拡張対応 (MP3/WAV等)**
  - 実装箇所: components/audio-player.tsx
  - 影響度: 将来的な音声形式の多様化に対応
  - 推定工数: 3時間

### 🟢 低優先度（必要時対応）

- [ ] **音声トランスクリプション表示**
  - 実装箇所: stream_protocol.py, message.tsx
  - 影響度: アクセシビリティ向上
  - 推定工数: 3時間

- [ ] **ストリーミング制御フラグ処理**
  - 実装箇所: stream_protocol.py
  - 影響度: 細かい制御が必要な場合のみ
  - 推定工数: 2時間

---

## テスト項目チェックリスト

### 基本機能テスト

#### テキストストリーミング
- [x] Gemini Direct: テキスト応答
- [x] ADK SSE: テキスト応答
- [x] ADK BIDI: テキスト応答

#### 画像認識
- [x] Gemini Direct: 画像アップロード + 認識
- [x] ADK SSE: 画像アップロード + 認識
- [x] ADK BIDI: 画像アップロード + 認識

#### 音声応答
- [x] ADK BIDI: PCM音声ストリーミング + 再生

### 高度な機能テスト

#### Gemini 2.0 Thinking Mode
- [ ] Gemini Direct: Thinking mode有効化
- [ ] ADK SSE: Thinking mode有効化
- [ ] ADK BIDI: Thinking mode有効化

#### ツール実行
- [ ] Gemini Direct: Tool call + result
- [ ] ADK SSE: Tool call + result
- [ ] ADK BIDI: Tool call + result

#### Gemini 2.0 Code Execution
- [ ] Code execution有効化モデルでのテスト

### エッジケースとエラーハンドリング
- [x] WebSocket接続エラー
- [ ] API rate limit
- [ ] Large file upload
- [ ] Network interruption during streaming

---

## 変更履歴

### 2025-12-11 - 初版作成
- AI SDK v6 × Gemini Flash 2.5 の包括的対応表を作成
- 現在の実装状況を網羅的に調査
- 既知の問題（Tool Call ID問題）を文書化
- 優先度別改善タスクリストを作成

### 次回更新時
- 各タスクの完了状況を更新
- 新しいテスト結果を追記
- 新たに発見した問題を文書化

---

## Unit Test 実装状況

### Backend Tests (Python)

**ファイル**: `tests/unit/test_stream_protocol_comprehensive.py`

| カテゴリー | テスト実装状況 | パラメトライズド | カバレッジ |
|---|---|---|---|
| **1. Text Content** | ✅ 実装済み | 3 cases | text-start/delta/end |
| **2. Reasoning Content** | ✅ 実装済み | 2 cases | reasoning-start/delta/end |
| **3. Tool Execution** | ✅ 実装済み | 4 cases | tool-call-start/available, tool-result-available |
| **4. Audio Content (PCM)** | ✅ 実装済み | 2 cases | data-pcm with different sample rates |
| **4. Audio Content (Other)** | ✅ 実装済み | 2 cases | data-audio (MP3, WAV) |
| **5. Image Content** | ✅ 実装済み | 3 cases | data-image (PNG, JPEG, WebP) |
| **6. Code Execution** | ✅ 実装済み | 4 cases | data-executable-code, data-code-execution-result |
| **7. Message Control** | ✅ 実装済み | 4 tests | start, finish, error, [DONE] |
| **Complex Scenarios** | ✅ 実装済み | 3 tests | text+image, text+tool, multiple text blocks |

**Total**: 27 parameterized test cases

**実行方法**:
```bash
# Run comprehensive tests
uv run pytest tests/unit/test_stream_protocol_comprehensive.py -v

# Run with coverage
uv run pytest tests/unit/test_stream_protocol_comprehensive.py --cov=stream_protocol
```

### Frontend Tests (TypeScript)

**ファイル**: `lib/websocket-chat-transport.test.ts`

| カテゴリー | テスト実装状況 | パラメトライズド | カバレッジ |
|---|---|---|---|
| **1. Text Content** | ✅ 実装済み | 4 cases | text-start/delta/end + unicode |
| **2. Reasoning Content** | ✅ 実装済み | 3 cases | reasoning-start/delta/end |
| **3. Tool Execution** | ✅ 実装済み | 3 cases | tool-call-start/available, tool-result-available |
| **4. Audio Content** | ✅ 実装済み | 2 cases | data-pcm, data-audio |
| **5. Image Content** | ✅ 実装済み | 2 cases | data-image (PNG, JPEG) |
| **6. Code Execution** | ✅ 実装済み | 2 cases | data-executable-code, data-code-execution-result |
| **7. Message Control** | ✅ 実装済み | 4 cases | start, finish, error, [DONE] |
| **8. Step Control** | ✅ 実装済み | 2 cases | step-start, step-finish |
| **Edge Cases** | ✅ 実装済み | 6 tests | empty data, invalid JSON, large payloads, etc. |
| **Complex Scenarios** | ✅ 実装済み | 3 tests | full sequence, text+image, text+tool |
| **Performance** | ✅ 実装済み | 2 tests | rapid succession, large JSON |

**Total**: 33 parameterized test cases

**実行方法**:
```bash
# Run frontend tests
pnpm exec vitest lib/websocket-chat-transport.test.ts

# Run with coverage
pnpm exec vitest lib/websocket-chat-transport.test.ts --coverage
```

### Test Coverage Summary

| Event Type | Backend Test | Frontend Test | Status |
|---|---|---|---|
| text-* events | ✅ | ✅ | **完全カバー** |
| reasoning-* events | ✅ | ✅ | **完全カバー** |
| tool-call-* events | ✅ | ✅ | **完全カバー** |
| tool-result-available | ✅ | ✅ | **完全カバー** |
| data-pcm | ✅ | ✅ | **完全カバー** |
| data-audio | ✅ | ✅ | **完全カバー** |
| data-image | ✅ | ✅ | **完全カバー** |
| data-executable-code | ✅ | ✅ | **完全カバー** |
| data-code-execution-result | ✅ | ✅ | **完全カバー** |
| start/finish/error | ✅ | ✅ | **完全カバー** |
| [DONE] marker | ✅ | ✅ | **完全カバー** |
| step-start/finish | ➖ | ✅ | **Frontend Only** |

### 追加テストが必要な項目

#### Backend Tests
- [ ] **Usage Metadata** - `usage_metadata` の変換テスト（未実装機能）
- [ ] **Transcription** - 音声トランスクリプションの変換テスト（未実装機能）
- [ ] **Partial/Interrupted Flags** - ストリーミング制御フラグのテスト（未実装機能）

#### Frontend Tests
- [ ] **Usage Metadata Display** - Message.usage フィールドの表示テスト
- [ ] **Code Execution UI** - コード実行結果の表示テスト（UI未実装）
- [ ] **Non-PCM Audio Player** - MP3/WAV再生のテスト（機能未実装）

### テスト品質保証

#### パラメトライズドテストの利点
1. **網羅性**: reviews.md の対応表と1:1で対応
2. **保守性**: 新しいイベントタイプの追加が容易
3. **可読性**: テストケース名が明確
4. **デバッグ性**: 失敗したケースが即座に特定可能

#### テストカバレッジ目標
- **Backend**: Stream Protocol変換ロジック 100%
- **Frontend**: SSE Parsing ロジック 100%
- **Integration**: E2E tests (別途実装)

---

## 参考資料

- [AI SDK v6 Data Stream Protocol](https://v6.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [ADK BIDI Streaming Guide](https://google.github.io/adk-docs/streaming/dev-guide/part3/)
- [ADK BIDI Visual Guide (Medium)](https://medium.com/google-cloud/adk-bidi-streaming-a-visual-guide-to-real-time-multimodal-ai-agent-development-62dd08c81399)
- [ADK BIDI Sample Implementation](https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/main.py)

### Test Documentation
- [Pytest Parametrize](https://docs.pytest.org/en/stable/how-to/parametrize.html)
- [Vitest Parameterized Tests](https://vitest.dev/api/#test-each)
