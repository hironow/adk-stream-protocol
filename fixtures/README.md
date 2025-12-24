# Test Fixtures

## Overview

このディレクトリには、テスト用のフィクスチャファイルが格納されています。

## Directory Structure

```
fixtures/
├── README.md              ← このファイル
├── backend/               ← Backend E2E テスト用 (JSONL)
│   ├── pattern1-backend.jsonl
│   ├── pattern1-frontend.jsonl
│   ├── pattern2-backend.jsonl
│   ├── pattern2-frontend.jsonl
│   ├── pattern3-backend.jsonl
│   ├── pattern3-frontend.jsonl
│   ├── pattern4-backend.jsonl
│   └── pattern4-frontend.jsonl
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
│   ├── process_payment-error-handling-green.json
│   └── process_payment-failing-bidi-red.json
└── public/                ← Web公開用 (backend/へのsymlink)
    ├── pattern1-backend.jsonl -> ../backend/pattern1-backend.jsonl
    ├── pattern1-frontend.jsonl -> ../backend/pattern1-frontend.jsonl
    └── ...
```

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

## Frontend Fixtures (`frontend/`)

### Purpose
Frontend統合テスト用のbaseline fixtures です。実際のAPI通信の代わりに、期待されるchunk sequenceを検証します。

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

### Baseline Types

#### Tool-Level Baselines
- **Single-turn tools**: `change_bgm`, `get_weather`
- **Multi-turn tools**: `get_location` (with approval), `process_payment` (with approval/denial)

#### Transport Modes
- **SSE mode**: `*-sse-baseline.json` - Per-turn connection
- **BIDI mode**: `*-bidi-baseline.json` - Persistent WebSocket

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
```

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

## Recording Procedure

### Backend Fixtures

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

### Frontend Fixtures

Frontend baseline fixturesは、E2Eテストの実行ログから手動で作成します。詳細は `lib/tests/integration/transport-done-baseline.test.ts` を参照してください。

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

## Related Documentation

- **Backend Tests**: `tests/e2e/test_server_chunk_player.py`
- **Frontend Tests**: `lib/tests/integration/transport-done-baseline.test.ts`
- **Chunk Player**: `adk_stream_protocol/chunk_player.py`
- **Setup Command**: `justfile` の `setup-e2e-fixtures`
