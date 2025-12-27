# Test Fixtures

## Overview

このディレクトリには、テスト用のフィクスチャファイルが格納されています。

## Directory Structure

```
fixtures/
├── README.md              ← このファイル
├── backend/               ← Backend E2E テスト用 (JSONL - frontendから自動変換)
│   ├── get_weather-sse-from-frontend.jsonl
│   ├── get_weather-bidi-from-frontend.jsonl
│   ├── get_location-approved-sse-from-frontend.jsonl
│   ├── get_location-approved-bidi-from-frontend.jsonl
│   ├── get_location-denied-sse-from-frontend.jsonl
│   ├── get_location-denied-bidi-from-frontend.jsonl
│   ├── process_payment-approved-sse-from-frontend.jsonl
│   ├── process_payment-approved-bidi-from-frontend.jsonl
│   ├── process_payment-denied-sse-from-frontend.jsonl
│   ├── process_payment-denied-bidi-from-frontend.jsonl
│   ├── change_bgm-sse-from-frontend.jsonl
│   └── change_bgm-bidi-from-frontend.jsonl
├── frontend/              ← Frontend統合テスト用 (JSON - 正解データ)
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
└── scenarios/             ← テストシナリオ用リソース
    └── test-image.png     # シナリオテスト用画像 (scripts/create-test-image.js で生成)
```

---

## Backend Fixtures (`backend/`)

### Purpose
Backend E2Eテスト用のChunk Player fixturesです。Frontend統合テストのrawEventsから自動変換されます。

### File Format: JSON Lines (JSONL)
```jsonl
{"timestamp": 1766600712686, "session_id": "converted-from-frontend", "mode": "adk-sse", "location": "frontend-sse-event", "direction": "out", "sequence_number": 1, "chunk": {...}}
{"timestamp": 1766600712687, "session_id": "converted-from-frontend", "mode": "adk-sse", "location": "frontend-sse-event", "direction": "out", "sequence_number": 2, "chunk": {...}}
```

### Usage (Backend)

```python
from pathlib import Path
from adk_stream_protocol import ChunkPlayer

# tests/conftest.py のfixture_dirを使用（自動的に fixtures/backend/ を指す）
player = ChunkPlayer.from_file(fixture_dir / "get_weather-sse-from-frontend.jsonl")

async for entry in player.play(mode="fast-forward"):
    # Process chunk
    print(entry.chunk)
```

### Converted Fixtures (Backend)

Backend fixturesはFrontend統合テストのrawEventsから自動変換されます：

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

### Converted Fixtures Test Coverage by Tool

#### 簡潔版マトリックス (2モード x 4ツール)

| ツール | SSE | BIDI | 備考 |
|--------|-----|------|------|
| **get_weather** | ✓✓✓ | ✓✓- | SSE: 全テストpass |
| **get_location** | ✓✓- | ✓✓- | approval/denial両シナリオあり |
| **process_payment** | ✓✓✓ | -✓- | approval/denial両シナリオあり |
| **change_bgm** | -✓- | ✓✓✓ | BIDI: 全テストpass |

**凡例**: 1文字目=ChunkPlayer, 2文字目=Consistency, 3文字目=Structure

**テスト種別**:
- **C** (ChunkPlayer): ChunkPlayerがfixtureを読み込み・再生できるか
- **S** (Consistency): Frontend rawEventsとBackend JSONL変換結果が完全一致するか
- **V** (Structure Validation): 実サーバー出力のイベント構造がfixtureと一致するか

---

#### 詳細テーブル

全12個の変換済みfixture（`*-from-frontend.jsonl`）のテスト結果詳細：

| Tool Name | Scenario | Mode | Fixture File | ChunkPlayer Test | Consistency Test | Structure Test |
|-----------|----------|------|--------------|------------------|------------------|----------------|
| **get_weather** | Simple execution | SSE | `get_weather-sse-from-frontend.jsonl` | ✓ test_get_weather_sse_loads_and_replays | ✓ test_get_weather_sse_conversion_is_accurate | ✓ (in test_all) |
| **get_weather** | Simple execution | BIDI | `get_weather-bidi-from-frontend.jsonl` | ✓ test_get_weather_bidi_loads_and_replays | ✓ (in test_all) | - |
| **get_location** | Approval granted | SSE | `get_location-approved-sse-from-frontend.jsonl` | ✓ test_get_location_approved_sse_loads_and_replays | ✓ (in test_all) | - |
| **get_location** | Approval granted | BIDI | `get_location-approved-bidi-from-frontend.jsonl` | - | ✓ (in test_all) | - |
| **get_location** | Approval denied | SSE | `get_location-denied-sse-from-frontend.jsonl` | - | ✓ (in test_all) | - |
| **get_location** | Approval denied | BIDI | `get_location-denied-bidi-from-frontend.jsonl` | ✓ test_get_location_denied_bidi_loads_and_replays | ✓ (in test_all) | - |
| **process_payment** | Approval granted | SSE | `process_payment-approved-sse-from-frontend.jsonl` | ✓ test_process_payment_approved_sse_loads_and_replays | ✓ (in test_all) | - |
| **process_payment** | Approval granted | BIDI | `process_payment-approved-bidi-from-frontend.jsonl` | - | ✓ (in test_all) | - |
| **process_payment** | Approval denied | SSE | `process_payment-denied-sse-from-frontend.jsonl` | - | ✓ test_process_payment_denied_sse_conversion_is_accurate | ✓ (in test_all) |
| **process_payment** | Approval denied | BIDI | `process_payment-denied-bidi-from-frontend.jsonl` | - | ✓ (in test_all) | - |
| **change_bgm** | Frontend tool | SSE | `change_bgm-sse-from-frontend.jsonl` | - | ✓ (in test_all) | - |
| **change_bgm** | Frontend tool | BIDI | `change_bgm-bidi-from-frontend.jsonl` | ✓ test_change_bgm_bidi_loads_and_replays | ✓ test_change_bgm_bidi_conversion_is_accurate | ✓ (in test_all) |

**Test Type Legend**:
- **ChunkPlayer Test** (`test_converted_frontend_fixtures.py`): Validates ChunkPlayer can load and replay fixture
- **Consistency Test** (`test_converted_fixture_consistency.py`): Validates conversion accuracy (frontend rawEvents = backend JSONL)
- **Structure Test**: Not yet implemented for converted fixtures (would test real server output matches fixture structure)

**Coverage Summary**:
- Individual ChunkPlayer tests: 7/12 fixtures (58%)
- Individual Consistency tests: 3/12 fixtures (25%)
- **test_all_converted_fixtures_match_frontend_baselines**: 12/12 fixtures (100%) ✓

All 12 converted fixtures are validated for conversion accuracy in the comprehensive test.

**Test Results**:
- ChunkPlayer tests: 7/7 passed ✓
- Consistency tests: 4/4 passed ✓ (3 individual + 1 comprehensive covering all 12)
- Total fixtures validated: 12/12 (100%) ✓

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
# Frontend baseline fixtures
ls -la fixtures/frontend/*.json

# Backend converted fixtures
ls -la fixtures/backend/*-from-frontend.jsonl
```

### Regenerating Backend Fixtures

Backend fixturesはfrontend統合テストのrawEventsから自動生成されます：

```bash
# 全てのfrontend fixturesを変換
uv run python scripts/convert_frontend_to_backend_fixture.py

# 出力例
✓ get_weather-sse-baseline.json -> get_weather-sse-from-frontend.jsonl (9 chunks)
✓ change_bgm-bidi-baseline.json -> change_bgm-bidi-from-frontend.jsonl (9 chunks)
⊘ process_payment-error-handling-green.json (skipped - no rawEvents)
```

---

## Test Coverage Summary

### Overview

| Test Type | Location | Target | Status |
|-----------|----------|--------|--------|
| Frontend Integration | `lib/tests/integration/` | Frontend fixtures (14 files) | ✓ 458 passed |
| Backend ChunkPlayer | `tests/e2e/test_converted_frontend_fixtures.py` | Converted fixtures (12 files) | ✓ 7 passed |
| Backend Structure (SSE) | `tests/e2e/test_server_structure_validation.py` | Real server SSE output | ✓ 7 passed, ⊘ 1 skipped |
| Backend Structure (BIDI) | `tests/e2e/test_websocket_bidi_validation.py` | Real server WebSocket output | ✓ 4 passed, ✗ 2 failed |
| Backend Consistency | `tests/e2e/test_converted_fixture_consistency.py` | Conversion accuracy | ✓ 4 passed (12 fixtures) |

### Test Categories Explained

#### Frontend Integration Tests (TypeScript)
- **Location**: `lib/tests/integration/transport-done-baseline.test.ts`
- **Purpose**: Validates AI SDK integration layer with baseline fixtures
- **Coverage**: All 14 frontend baseline fixtures (458 test cases)
- **Method**: Mocked LLM responses using `expectedChunks` from fixtures

#### Backend ChunkPlayer Tests (Python)
- **Location**: `tests/e2e/test_converted_frontend_fixtures.py`
- **Purpose**: Validates ChunkPlayer can load/replay converted backend fixtures
- **Coverage**: 12 converted JSONL fixtures (SSE + BIDI modes)
- **Method**: Fast-forward playback without real server

#### Backend Structure Validation Tests (Python)
- **SSE Location**: `tests/e2e/test_server_structure_validation.py`
- **BIDI Location**: `tests/e2e/test_websocket_bidi_validation.py`
- **Purpose**: Validates real server output structure matches frontend expectations
- **Coverage**:
  - SSE: 2 fixtures tested (get_weather, change_bgm), 1 skipped (multi-turn)
  - BIDI: 1 fixture partially tested (message format issue discovered)
- **Method**: Real LLM API calls via /stream (SSE) and /live (WebSocket)
- **Validation**: Event types, field names, sequence order (NOT data content)

#### Backend Consistency Tests (Python)
- **Location**: `tests/e2e/test_converted_fixture_consistency.py`
- **Purpose**: Validates conversion script accuracy (frontend rawEvents → backend JSONL)
- **Coverage**: All 12 converted fixtures validated
- **Method**: Byte-level comparison with ID normalization, no server required

### Known Issues

#### WebSocket BIDI Message Format Incompatibility (RESOLVED ✓)
- **Status**: ✓ Resolved - tests now use correct format
- **Solution**: Updated tests to send proper BIDI event format with all required fields:
  ```json
  {
    "type": "message",
    "version": "1.0",
    "id": "chat-id",
    "messages": [...],
    "trigger": "submit-message",
    "messageId": null
  }
  ```
- **Result**: 4/6 tests now passing (up from 2/6)

#### WebSocket BIDI `finish` Event Missing `finishReason` Field
- **Status**: ✗ 2/6 tests failing (legitimate issue detected)
- **Issue**: Frontend baseline fixtures expect `finishReason` field in `finish` event
- **Actual**: Server returns `finish` event with only `messageMetadata`, no `finishReason`
- **Expected**: `{"type": "finish", "finishReason": "stop", "messageMetadata": {...}}`
- **Actual**: `{"type": "finish", "messageMetadata": {...}}`
- **Impact**: Structure validation tests correctly fail, detecting implementation gap
- **Root Cause**: Possible causes:
  1. Server implementation incomplete (should add `finishReason`)
  2. Frontend fixtures outdated (recorded with older Gemini models)
  3. BIDI mode vs SSE mode behavior difference
- **Failing Tests**:
  - `test_get_weather_bidi_websocket_structure_matches_baseline`
  - `test_change_bgm_bidi_websocket_structure_matches_baseline`
- **Passing Tests**:
  - `test_websocket_sends_sse_format` ✓
  - `test_websocket_has_start_event` ✓
  - `test_websocket_ends_with_done_marker` ✓
  - `test_websocket_tool_events_have_required_fields` ✓
- **Next Steps**: Investigate whether server should add `finishReason` or fixtures need updating

### Coverage Metrics

| Category | Total Fixtures | Tested | Passing | Skipped/Failing | Coverage % |
|----------|----------------|--------|---------|-----------------|------------|
| Frontend Baselines | 14 | 14 | 14 | 0 | 100% |
| Backend Converted | 12 | 12 | 12 | 0 | 100% |
| Backend SSE Structure | 14 | 2 | 2 | 1 multi-turn, 11 untested | 14% |
| Backend BIDI Structure | 14 | 2 | 0 | 2 finishReason issue, 12 untested | 0% |
| Backend Consistency | 12 | 12 | 12 | 0 | 100% |

**Overall Health**:
- Conversion accuracy: ✓ 100% (12/12 fixtures match frontend rawEvents exactly)
- SSE endpoint validation: ✓ Partial (2 fixtures validated, structure correct)
- BIDI endpoint validation: ⚠️ Partial (4/6 tests pass, 2 fail on finishReason field)

---

## Related Documentation

- **Backend Tests**: `tests/e2e/test_server_chunk_player.py`
- **Frontend Tests**: `lib/tests/integration/transport-done-baseline.test.ts`
- **Chunk Player**: `adk_stream_protocol/chunk_player.py`
- **Chunk Logger**: `adk_stream_protocol/chunk_logger.py`
- **Setup Command**: `justfile` の `setup-e2e-fixtures`
