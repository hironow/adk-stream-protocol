# E2E Test Fixtures

## Overview

このディレクトリには、E2Eテスト用のChunk Playerフィクスチャが格納されています。

## File Structure

```
tests/fixtures/
├── README.md                  ← このファイル
├── pattern1-frontend.jsonl    ← Pattern 1: Gemini Direct (Frontend)
├── pattern1-backend.jsonl     ← Pattern 1: Gemini Direct (Backend - 空)
├── pattern2-frontend.jsonl    ← Pattern 2: ADK SSE (Frontend)
├── pattern2-backend.jsonl     ← Pattern 2: ADK SSE (Backend)
├── pattern3-frontend.jsonl    ← Pattern 3: ADK BIDI (Frontend)
├── pattern3-backend.jsonl     ← Pattern 3: ADK BIDI (Backend)
├── pattern4-frontend.jsonl    ← Pattern 4: Mode Switching (Frontend)
└── pattern4-backend.jsonl     ← Pattern 4: Mode Switching (Backend)
```

## Test Patterns

### Pattern 1: Gemini Direct
- **Mode**: Gemini Direct固定（Backendを経由しない）
- **Files**: `pattern1-{frontend,backend}.jsonl`
- **Note**: backend.jsonlは空（Gemini Directはfrontend直接通信）

### Pattern 2: ADK SSE
- **Mode**: ADK SSE固定（Server-Sent Events）
- **Files**: `pattern2-{frontend,backend}.jsonl`
- **Features**: Tool invocations, Token count, Model name

### Pattern 3: ADK BIDI
- **Mode**: ADK BIDI固定（WebSocket双方向通信）
- **Files**: `pattern3-{frontend,backend}.jsonl`
- **Features**: Audio chunks, WebSocket latency monitoring

### Pattern 4: Mode Switching ⚠️ CRITICAL
- **Modes**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Files**: `pattern4-{frontend,backend}.jsonl`
- **Purpose**: モード切り替え時のメッセージ履歴保持を検証

## File Format

各`.jsonl`ファイルは、1行1JSONの形式（JSON Lines）で記録されます：

```jsonl
{"sequence_number":1,"timestamp":"2025-12-21T00:00:00.000Z","mode":"adk-sse","direction":"request","chunk":{...}}
{"sequence_number":2,"timestamp":"2025-12-21T00:00:01.000Z","mode":"adk-sse","direction":"response","chunk":{...}}
```

## Frontend Access

Frontend E2Eテスト（Playwright）は、`public/fixtures/`経由でこれらのファイルにアクセスします：

```
Browser → HTTP GET: /fixtures/pattern1-frontend.jsonl
       ↓
Next.js public/ directory
       ↓
Symlink: public/fixtures/pattern1-frontend.jsonl
       → tests/fixtures/pattern1-frontend.jsonl
```

**Setup**:
```bash
# Symlinkの作成
cd public
ln -sf ../tests/fixtures fixtures
```

## Recording Procedure

### 1. Enable Chunk Logger

```javascript
// Frontendの場合
localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true');
localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern1');  // pattern{1-4}
location.reload();
```

```bash
# Backendの場合
export CHUNK_LOGGER_ENABLED=true
export CHUNK_LOGGER_OUTPUT_DIR=./tests/fixtures
export CHUNK_LOGGER_SESSION_ID=pattern1  # pattern{1-4}
```

### 2. Execute Test Scenario

各パターンの手順に従って操作を実行します。

### 3. Verify Recording

```bash
# ファイルサイズを確認
ls -lh tests/fixtures/pattern*.jsonl

# 内容を確認（最初の3行）
head -n 3 tests/fixtures/pattern1-frontend.jsonl
```

### 4. Rename Output

Chunk Loggerは `{session_id}-{frontend|backend}-chunks.jsonl` で出力するため、リネームが必要：

```bash
# 例: pattern1の場合
mv tests/fixtures/pattern1-frontend-chunks.jsonl tests/fixtures/pattern1-frontend.jsonl
mv tests/fixtures/pattern1-backend-chunks.jsonl tests/fixtures/pattern1-backend.jsonl
```

## Usage in Tests

### Backend (Python)

```python
from pathlib import Path
from adk_stream_protocol import ChunkPlayer

fixture_dir = Path(__file__).parent.parent / "fixtures"
player = ChunkPlayer.from_file(fixture_dir / "pattern2-backend.jsonl")

async for entry in player.play(mode="fast-forward"):
    # Process chunk
    print(entry.chunk)
```

### Frontend (TypeScript)

```typescript
import { ChunkPlayerTransport } from '@/lib/chunk-player-transport';

const transport = ChunkPlayerTransport.fromFixture(
  '/fixtures/pattern2-frontend.jsonl'
);

for await (const chunk of transport.receiveStream()) {
  // Process chunk
  console.log(chunk);
}
```

## Troubleshooting

### Fixtures Not Found

```bash
# Backend
ls -la tests/fixtures/pattern*.jsonl

# Frontend (symlink確認)
ls -la public/fixtures
```

### Empty Fixtures

空のfixtureは記録待ちの状態です。テストは空ファイルでも正常に動作します（`count: 0`）。

### Recording Failed

1. `CHUNK_LOGGER_ENABLED=true` が設定されているか確認
2. ブラウザコンソール/サーバーログでエラーを確認
3. ファイル書き込み権限を確認
