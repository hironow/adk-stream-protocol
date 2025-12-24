# Test Fixtures

## Overview

このディレクトリには、テスト用のフィクスチャファイルが格納されています。

## Directory Structure

```
fixtures/
├── README.md              ← このファイル
├── backend/               ← Backend E2E テスト用 (JSONL)
│   ├── pattern1-backend.jsonl          # Recorded: Gemini Direct
│   ├── pattern1-frontend.jsonl         # Recorded: Gemini Direct
│   ├── pattern2-backend.jsonl          # Recorded: ADK SSE (記録待ち)
│   ├── pattern2-frontend.jsonl         # Recorded: ADK SSE (記録待ち)
│   ├── pattern3-backend.jsonl          # Recorded: ADK BIDI (記録待ち)
│   ├── pattern3-frontend.jsonl         # Recorded: ADK BIDI (記録待ち)
│   ├── pattern4-backend.jsonl          # Recorded: Mode Switching (記録待ち)
│   ├── pattern4-frontend.jsonl         # Recorded: Mode Switching (記録待ち)
│   ├── get_weather-sse-from-frontend.jsonl           # Converted
│   ├── get_weather-bidi-from-frontend.jsonl          # Converted
│   ├── get_location-approved-sse-from-frontend.jsonl # Converted
│   ├── get_location-approved-bidi-from-frontend.jsonl # Converted
│   ├── get_location-denied-sse-from-frontend.jsonl   # Converted
│   ├── get_location-denied-bidi-from-frontend.jsonl  # Converted
│   ├── process_payment-approved-sse-from-frontend.jsonl # Converted
│   ├── process_payment-approved-bidi-from-frontend.jsonl # Converted
│   ├── process_payment-denied-sse-from-frontend.jsonl # Converted
│   ├── process_payment-denied-bidi-from-frontend.jsonl # Converted
│   ├── change_bgm-sse-from-frontend.jsonl            # Converted
│   └── change_bgm-bidi-from-frontend.jsonl           # Converted
├── frontend/              ← Frontend統合テスト用 (JSON)
│   ├── change_bgm-bidi-baseline.json
│   ├── change_bgm-sse-baseline.json
│   ├── get_location-approved-bidi-baseline.json
│   ├── get_location-approved-sse-baseline.json
│   ├── get_location-denied-bidi-baseline.json
│   ├── get_location-denied-sse-baseline.json
│   ├── get_weather-bidi-baseline.json
│   ├── get_weather-sse-baseline.json
│   ├── process_payment-approved-bidi-baseline.json
│   ├── process_payment-approved-sse-baseline.json
│   ├── process_payment-denied-bidi-baseline.json
│   ├── process_payment-denied-sse-baseline.json
│   ├── process_payment-error-handling-green.json   # Test specification
│   └── process_payment-failing-bidi-red.json       # Failing case (TDD RED)
└── public/                ← Web公開用 (backend/へのsymlink)
    ├── pattern1-backend.jsonl -> ../backend/pattern1-backend.jsonl
    ├── pattern1-frontend.jsonl -> ../backend/pattern1-frontend.jsonl
    └── ...
```

---

## Backend Fixtures (`backend/`)

### Purpose
Backend E2Eテスト用のChunk Player fixturesです。実際のLLM APIコールの代わりに、事前に記録したchunksを再生します。

### File Format: JSON Lines (JSONL)
```jsonl
{"sequence_number":1,"timestamp":"2025-12-21T00:00:00.000Z","mode":"adk-sse","direction":"request","chunk":{...}}
{"sequence_number":2,"timestamp":"2025-12-21T00:00:01.000Z","mode":"adk-sse","direction":"response","chunk":{...}}
```

### Test Patterns

#### Pattern 1: Gemini Direct
- **Mode**: Gemini Direct固定（Backendを経由しない）
- **Files**: `pattern1-{frontend,backend}.jsonl`
- **Note**: backend.jsonlは空（Gemini Directはfrontend直接通信）

#### Pattern 2: ADK SSE
- **Mode**: ADK SSE固定（Server-Sent Events）
- **Files**: `pattern2-{frontend,backend}.jsonl`
- **Features**: Tool invocations, Token count, Model name

#### Pattern 3: ADK BIDI
- **Mode**: ADK BIDI固定（WebSocket双方向通信）
- **Files**: `pattern3-{frontend,backend}.jsonl`
- **Features**: Audio chunks, WebSocket latency monitoring

#### Pattern 4: Mode Switching ⚠️ CRITICAL
- **Modes**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Files**: `pattern4-{frontend,backend}.jsonl`
- **Purpose**: モード切り替え時のメッセージ履歴保持を検証

### Usage (Backend)

```python
from pathlib import Path
from adk_stream_protocol import ChunkPlayer

# tests/conftest.py のfixture_dirを使用（自動的に fixtures/backend/ を指す）
player = ChunkPlayer.from_file(fixture_dir / "pattern2-backend.jsonl")

async for entry in player.play(mode="fast-forward"):
    # Process chunk
    print(entry.chunk)
```

### Recording Procedure (Backend)

#### 1. Enable Chunk Logger
```bash
export CHUNK_LOGGER_ENABLED=true
export CHUNK_LOGGER_OUTPUT_DIR=./fixtures/backend
export CHUNK_LOGGER_SESSION_ID=pattern1  # pattern{1-4}
```

#### 2. Execute Test Scenario
各パターンの手順に従って操作を実行します。

#### 3. Verify Recording
```bash
# ファイルサイズを確認
ls -lh fixtures/backend/pattern*.jsonl

# 内容を確認（最初の3行）
head -n 3 fixtures/backend/pattern1-frontend.jsonl
```

#### 4. Rename Output
Chunk Loggerは `{session_id}-{frontend|backend}-chunks.jsonl` で出力するため、リネームが必要：
```bash
mv fixtures/backend/pattern1-frontend-chunks.jsonl fixtures/backend/pattern1-frontend.jsonl
mv fixtures/backend/pattern1-backend-chunks.jsonl fixtures/backend/pattern1-backend.jsonl
```

### Converted Fixtures (Backend)

Backend fixturesは2つのソースから生成されます：

#### 1. Recorded Fixtures（記録ベース）
- **ファイル**: `pattern*-{frontend,backend}.jsonl`
- **生成方法**: Chunk Loggerで実際のLLM通信を記録
- **目的**: E2Eフルフロー検証（モード切り替え含む）
- **状態**: pattern1のみ記録済み（pattern2-4は記録待ち）

#### 2. Converted Fixtures（変換ベース）
- **ファイル**: `*-from-frontend.jsonl`
- **生成方法**: Frontend統合テストのrawEventsから自動変換
- **目的**: 個別ツール実行の検証（get_weather, get_location, process_payment, change_bgm）
- **状態**: 12ファイル生成済み（148 chunks）

#### 変換スクリプトの使用

Frontend baseline fixtures（`fixtures/frontend/*.json`）をBackend ChunkPlayer形式（JSONL）に変換：

```bash
# 全てのfrontend fixturesを変換
uv run python scripts/convert_frontend_to_backend_fixture.py

# 出力例
✓ get_weather-sse-baseline.json -> get_weather-sse-from-frontend.jsonl (9 chunks)
✓ change_bgm-bidi-baseline.json -> change_bgm-bidi-from-frontend.jsonl (9 chunks)
⊘ process_payment-error-handling-green.json (skipped - no rawEvents)
```

**変換されるファイル**:
- rawEventsを持つbaseline fixtureのみ（12ファイル）
- テスト仕様書やfailingケースはスキップ（2ファイル）

**ChunkPlayer形式**:
```jsonl
{"timestamp": 1766600712686, "session_id": "converted-from-frontend", "mode": "adk-sse", "location": "frontend-sse-event", "direction": "out", "sequence_number": 1, "chunk": {"type": "start", "messageId": "..."}}
```

**使用例**:
```python
# Backend E2Eテストで使用
from adk_stream_protocol import ChunkPlayer

player = ChunkPlayer.from_file(fixture_dir / "get_weather-sse-from-frontend.jsonl")
async for entry in player.play(mode="fast-forward"):
    assert entry.mode == "adk-sse"
    assert entry.chunk  # Frontend rawEventsと同じchunk
```

**メリット**:
1. Frontend統合テストと同じ「正解データ」でBackendを検証
2. 記録作業不要（frontend/から機械的に生成）
3. 一貫性保証（フロントエンドが期待するイベント = バックエンドが生成すべきイベント）

**再生成**:
Frontend fixturesを更新した場合、変換スクリプトを再実行：
```bash
uv run python scripts/convert_frontend_to_backend_fixture.py
# 既存ファイルは上書きされます
```

---

## Frontend Fixtures (`frontend/`)

### Purpose
Frontend統合テスト用のbaseline fixtures です。実際のAPI通信の代わりに、期待されるchunk sequenceを検証します。

**配置理由**:
- 統合テストから共通利用
- 将来的なE2Eテストからも共通利用
- テストデータの一元管理

### File Format: JSON
```json
{
  "description": "Tool execution with approval",
  "mode": "sse",
  "input": {
    "messages": [...],
    "trigger": "submit-message"
  },
  "output": {
    "rawEvents": [...],
    "expectedChunks": [...],
    "expectedDoneCount": 1,
    "expectedStreamCompletion": true
  }
}
```

### Naming Convention

```
{function-name}-{status}-{mode}-baseline.json
```

- `function-name`: テスト対象の機能名 (get_weather, process_payment など)
- `status`: 実行結果の状態 (approved, denied, error-handling など)
- `mode`: 通信モード (bidi, sse)
- `baseline`: ベースラインデータであることを示す接尾辞

### File Catalog

#### get_weather (天気取得 - シンプルなツール実行)
- `get_weather-bidi-baseline.json` - BIDI モードでの通常実行
- `get_weather-sse-baseline.json` - SSE モードでの通常実行

#### get_location (位置情報取得 - 承認フロー)
- `get_location-approved-bidi-baseline.json` - BIDI モードで承認
- `get_location-approved-sse-baseline.json` - SSE モードで承認
- `get_location-denied-bidi-baseline.json` - BIDI モードで拒否
- `get_location-denied-sse-baseline.json` - SSE モードで拒否

#### process_payment (決済処理 - 承認フロー + エラーハンドリング)
- `process_payment-approved-bidi-baseline.json` - BIDI モードで承認
- `process_payment-approved-sse-baseline.json` - SSE モードで承認
- `process_payment-denied-bidi-baseline.json` - BIDI モードで拒否
- `process_payment-denied-sse-baseline.json` - SSE モードで拒否
- `process_payment-error-handling-green.json` - エラーハンドリング成功ケース
- `process_payment-failing-bidi-red.json` - BIDI モード失敗ケース (TDD RED phase)

#### change_bgm (BGM変更 - Frontend Tool Execution)
- `change_bgm-bidi-baseline.json` - BIDI モードでのBGM変更
- `change_bgm-sse-baseline.json` - SSE モードでのBGM変更

### Usage (Frontend)

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadFixture(filename: string): BaselineFixture {
  const fixturePath = join(__dirname, "..", "..", "..", "fixtures", "frontend", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as BaselineFixture;
}

const fixture = loadFixture("get_location-approved-sse-baseline.json");

// テストでbaselineと実際の結果を比較
expect(actualChunks).toEqual(fixture.output.expectedChunks);
```

### Updating Baselines (Frontend)

新しい機能を追加した場合:

1. **テストを実行して正しい出力を確認**
   ```bash
   pnpm exec vitest run lib/tests/integration/transport-done-baseline.test.ts -t "specific test"
   ```

2. **出力をJSONファイルとして保存**
   - テスト実行ログから期待される出力を抽出
   - `rawEvents`, `expectedChunks`, `expectedDoneCount`を含むJSON構造を作成

3. **命名規則に従ってファイル名を設定**
   - 例: `new_feature-approved-bidi-baseline.json`

4. **このREADMEを更新**
   - File Catalogに新しいファイルを追加

**注意事項**:
- ベースラインファイルは **期待される正しい動作** を表します
- テストが失敗した場合、実装が間違っているかベースラインが古い可能性があります
- ベースライン更新時は必ず変更内容をレビューしてください

---

## Public Fixtures (`public/`)

### Purpose
Frontend E2Eテスト（Playwright）がHTTP経由でアクセスするためのsymlinksです。

### Structure
```
Browser → HTTP GET: /fixtures/pattern1-frontend.jsonl
       ↓
Next.js public/ directory
       ↓
public/fixtures/pattern1-frontend.jsonl
       → ../../fixtures/public/pattern1-frontend.jsonl
       → ../../fixtures/backend/pattern1-frontend.jsonl
```

### Setup
```bash
# Symlinkの作成（justfileコマンド使用を推奨）
just setup-e2e-fixtures

# または手動で
cd public/fixtures
for fixture in ../../fixtures/public/*.jsonl; do
  ln -sf "$fixture" "$(basename "$fixture")"
done
```

---

## Test Usage Patterns

### Backend E2E Tests
```python
# tests/e2e/test_server_chunk_player.py
from adk_stream_protocol import ChunkPlayer

def test_pattern2_replays_chunks(fixture_dir: Path):
    # Given: Recorded fixture
    fixture_path = fixture_dir / "pattern2-backend.jsonl"
    player = ChunkPlayer.from_file(fixture_path)

    # When: Play chunks
    chunks = []
    async for entry in player.play(mode="fast-forward"):
        chunks.append(entry)

    # Then: Verify
    assert len(chunks) > 0
```

### Frontend Integration Tests
```typescript
// lib/tests/integration/transport-done-baseline.test.ts
function loadFixture(filename: string): BaselineFixture {
  const fixturePath = join(__dirname, "..", "..", "..", "fixtures", "frontend", filename);
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

it("should execute tool correctly", async () => {
  const fixture = loadFixture("get_location-approved-sse-baseline.json");
  // Test implementation...
});
```

---

## Troubleshooting

### Fixtures Not Found

```bash
# Backend
ls -la fixtures/backend/pattern*.jsonl

# Frontend
ls -la fixtures/frontend/*.json

# Public symlinks
ls -la public/fixtures
ls -la fixtures/public
```

### Empty Fixtures

空のfixtureは記録待ちの状態です。テストは空ファイルでも正常に動作します（`count: 0`）。

### Recording Failed

1. `CHUNK_LOGGER_ENABLED=true` が設定されているか確認
2. ブラウザコンソール/サーバーログでエラーを確認
3. ファイル書き込み権限を確認
4. 出力ディレクトリが存在するか確認: `mkdir -p fixtures/backend`

### Symlink Issues

```bash
# 既存のsymlinkを削除して再作成
rm -rf public/fixtures/*
just setup-e2e-fixtures

# Symlinkの確認
ls -la public/fixtures/
# All files should point to: ../fixtures/public/*.jsonl
```

---

## Related Documentation

- **Backend Tests**: `tests/e2e/test_server_chunk_player.py`
- **Frontend Tests**: `lib/tests/integration/transport-done-baseline.test.ts`
- **Chunk Player**: `adk_stream_protocol/chunk_player.py`
- **Chunk Logger**: `adk_stream_protocol/chunk_logger.py`
- **Setup Command**: `justfile` の `setup-e2e-fixtures`
