# E2E Testing Guide

This document describes the E2E testing strategy for both frontend and backend using the Chunk Player pattern. This approach enables deterministic testing without requiring real LLM API calls.

---

## Directory Structure

このプロジェクトには3つのレイヤーのテストが存在します：

### Test Directory Overview

```
adk-stream-protocol/
├── scenarios/                    # 🎯 Full E2E Tests (統合テスト)
│   ├── features/                 # Playwright E2E specs
│   │   ├── chunk-player-ui-verification.spec.ts
│   │   ├── tool-approval.spec.ts
│   │   ├── chunk-logger-*.spec.ts
│   │   └── ...
│   ├── helpers.ts                # E2Eテストヘルパー関数
│   └── fixtures/                 # シナリオ固有のfixtureデータ
│
├── lib/                          # 📦 Frontend Library
│   └── tests/
│       ├── e2e/                  # フロントエンドE2E (lib + frontend)
│       │   ├── chat-flow.e2e.test.ts
│       │   ├── mode-switching.e2e.test.ts
│       │   ├── tool-execution.e2e.test.ts
│       │   └── README.md
│       └── fixtures/             # lib E2Eテスト用fixtures
│           ├── process_payment-*.json
│           ├── get_location-*.json
│           └── README.md
│
├── tests/                        # 🐍 Backend Tests
│   ├── e2e/                      # バックエンドE2E (server + backend)
│   │   └── test_server_chunk_player.py
│   └── fixtures/                 # バックエンドE2E用fixtures
│       ├── pattern1-frontend.jsonl
│       ├── pattern1-backend.jsonl
│       ├── pattern2-*.jsonl
│       └── README.md
│
└── public/
    └── fixtures/                 # ← symlink to tests/fixtures/
```

### Test Layers

#### 1. `scenarios/` - Full E2E Tests (システム全体)

**目的**: システム全体の統合テスト（フロントエンド + バックエンド + ブラウザ）

**特徴**:
- Playwrightを使用した実際のブラウザテスト
- フロントエンドUIとバックエンドAPIの両方を含む
- ユーザーシナリオ全体を検証
- Chunk Player/Loggerを使ったLLMモック

**主要テスト**:
- UI検証 (`chunk-player-ui-verification.spec.ts`)
- Tool承認フロー (`tool-approval.spec.ts`)
- Chunk Logger記録 (`chunk-logger-*.spec.ts`)
- モード切替 (`mode-testing.spec.ts`)

#### 2. `lib/tests/e2e/` - Frontend E2E Tests (フロントエンド世界)

**目的**: libとそれを利用するフロントエンドコンポーネントのテスト

**特徴**:
- フロントエンドロジックとUI統合
- バックエンドAPIをモック
- ブラウザ環境での動作検証
- React Hooksとコンポーネントの統合

**主要テスト**:
- チャットフロー (`chat-flow.e2e.test.ts`)
- モード切替 (`mode-switching.e2e.test.ts`)
- ツール実行 (`tool-execution.e2e.test.ts`)
- 音声制御 (`audio-control.e2e.test.ts`)

**Fixtures**: `lib/tests/fixtures/` - Tool confirmationの期待値データ (JSON)

#### 3. `tests/e2e/` - Backend E2E Tests (バックエンド世界)

**目的**: serverとそれを利用するバックエンド処理のテスト

**特徴**:
- Python FastAPIサーバーのテスト
- Chunk Playerによる決定論的テスト
- LLM APIなしでのバックエンド検証
- ストリーミング処理の検証

**主要テスト**:
- Chunk Player動作 (`test_server_chunk_player.py`)

**Fixtures**: `tests/fixtures/` - Backend/Frontend chunks (JSONL)
- Pattern 1-4のバックエンド/フロントエンドチャンク
- 記録済みのLLMレスポンス

### Fixture Access

```
Frontend access:
  public/fixtures/  → (symlink) → tests/fixtures/
  ↓
  ChunkPlayerTransport loads from /fixtures/pattern*.jsonl

Backend access:
  tests/fixtures/pattern*-backend.jsonl
  ↓
  ChunkPlayer reads directly
```

---

## Overview

This document describes the E2E testing strategy for the frontend using the Chunk Player pattern. This approach enables deterministic UI testing without requiring real LLM API calls.

## Architecture

### Chunk Player Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    Recording Phase (Manual)                      │
│                                                                   │
│  1. Enable Chunk Logger in Browser                              │
│     → localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true')      │
│                                                                   │
│  2. Perform Test Scenario                                       │
│     → Send messages, use tools, switch modes                    │
│                                                                   │
│  3. Export Chunks                                               │
│     → window.__chunkLogger__.export()                           │
│     → Downloads frontend-chunks.jsonl                           │
│                                                                   │
│  4. Save to Fixture Directory                                   │
│     → tests/fixtures/pattern*-{frontend,backend}.jsonl         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Playback Phase (E2E Test)                     │
│                                                                   │
│  1. Enable Chunk Player Mode                                    │
│     → enableChunkPlayerMode(page, fixturePath)                  │
│     → Sets E2E_CHUNK_PLAYER_MODE=true in localStorage          │
│                                                                   │
│  2. Navigate to Chat                                            │
│     → buildUseChatOptions detects E2E mode                      │
│     → Creates ChunkPlayerTransport instead of real transport    │
│                                                                   │
│  3. Send Messages                                               │
│     → UI calls transport.sendMessages()                         │
│     → ChunkPlayerTransport replays pre-recorded chunks          │
│     → UI updates with deterministic responses                   │
│                                                                   │
│  4. Verify UI State                                             │
│     → Check message count, tool invocations, mode features      │
└─────────────────────────────────────────────────────────────────┘
```

Legend / 凡例:

- Recording Phase: 記録フェーズ
- Playback Phase: 再生フェーズ
- Chunk Logger: チャンクロガー
- Chunk Player: チャンクプレイヤー
- localStorage: ローカルストレージ
- Transport: トランスポート

## Test Patterns

### Pattern 1: Gemini Direct Only

- **Mode**: Gemini Direct (fixed throughout test)
- **Steps**: 4 messages
  1. "こんにちは" (greeting)
  2. "東京の天気を教えて" (weather tool)
  3. "123 + 456は？" (calculator tool)
  4. "ありがとう" (thanks)
- **Verifies**:
    - Basic message rendering
    - Tool invocation UI
    - Mode indicator shows Gemini Direct

### Pattern 2: ADK SSE Only

- **Mode**: ADK SSE (fixed throughout test)
- **Steps**: 4 messages (same as Pattern 1)
- **Verifies**:
    - Token count display
    - Model name display (gemini-2.5-flash)
    - Mode indicator shows ADK SSE

### Pattern 3: ADK BIDI Only

- **Mode**: ADK BIDI (fixed throughout test)
- **Steps**: 4 messages (same as Pattern 1)
- **Verifies**:
    - Audio player rendering (one per assistant message)
    - WebSocket latency display
    - Mode indicator shows ADK BIDI

### Pattern 4: Mode Switching (CRITICAL)

- **Mode**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Steps**: 5 messages (one per mode)
  1. Gemini Direct: "こんにちは"
  2. ADK SSE: "東京の天気を教えて"
  3. ADK BIDI: "123 + 456は？"
  4. ADK SSE: "ありがとう"
  5. Gemini Direct: "さようなら"
- **Verifies**:
    - **CRITICAL**: Message history preservation across mode switches
    - Final message count: exactly 10 (5 user + 5 assistant)
    - All messages remain visible after each mode switch

## Implementation Files

### Core Transport Layer

- **lib/chunk-player-transport.ts**
    - Implements `ChatTransport<UIMessage>` interface
    - Lazy-loads fixture files on first `sendMessages()` call
    - Replays chunks in fast-forward mode (no delays)

- **lib/chunk-player.ts**
    - JSONL chunk player engine (already exists)
    - Loads chunks from URL or File object
    - Supports real-time and fast-forward playback

### E2E Test Files

- **e2e/chunk-player-ui-verification.spec.ts**
    - Test scenarios for all 4 patterns
    - Pattern 4 has two tests (general + critical message count)

- **e2e/helpers.ts**
    - `enableChunkPlayerMode(page, fixturePath)` - Setup helper
    - `disableChunkPlayerMode(page)` - Cleanup helper
    - `getChunkPlayerFixturePath(patternName)` - Path resolver

### Integration Point

- **lib/build-use-chat-options.ts**
    - Checks `localStorage.getItem('E2E_CHUNK_PLAYER_MODE')`
    - If enabled, creates ChunkPlayerTransport
    - Otherwise, creates normal transport (Default, WebSocket)

### Fixture Files

- **tests/fixtures/**
    - `README.md` - Pattern overview and recording procedures
    - `pattern{1-4}-frontend.jsonl` - Frontend fixtures (to be recorded)
    - `pattern{1-4}-backend.jsonl` - Backend fixtures (to be recorded)

- **public/fixtures/**
    - Symlink to `tests/fixtures/`
    - Allows HTTP access via Next.js dev server

## Recording Fixtures (Manual Process)

### Prerequisites

1. Start backend server:

   ```bash
   uv run uvicorn server:app --reload
   ```

2. Start frontend dev server:

   ```bash
   pnpm dev
   ```

3. Open browser:

   ```bash
   open http://localhost:3000
   ```

### Recording Steps

**For each pattern (1-4):**

1. **Enable Chunk Logger**

   Open browser console and execute:

   ```javascript
   localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true');
   localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern1');
   location.reload();
   ```

2. **Execute Test Scenario**

   Follow the detailed steps in `tests/fixtures/README.md` for each pattern:
   - Pattern 1: Gemini Direct only
   - Pattern 2: ADK SSE only
   - Pattern 3: ADK BIDI only
   - Pattern 4: Mode switching

   **IMPORTANT for Pattern 4**:
   - Carefully switch modes between each message
   - Verify message history is preserved after each switch
   - Final UI should show all 10 messages (5 user + 5 assistant)

3. **Export Chunks**

   Open browser console and execute:

   ```javascript
   window.__chunkLogger__.export();
   ```

   This downloads a file like `pattern1-frontend.jsonl`.

4. **Save Fixture**

   Move the downloaded file to the fixture directory:

   ```bash
   mv ~/Downloads/pattern1-frontend.jsonl \
      tests/fixtures/pattern1-frontend.jsonl
   ```

5. **Verify Fixture**

   Check the file exists and has content:

   ```bash
   wc -l tests/fixtures/pattern1-frontend.jsonl
   head -n 3 tests/fixtures/pattern1-frontend.jsonl
   ```

### Recording Checklist

- [ ] Pattern 1: Gemini Direct only (4 steps)
- [ ] Pattern 2: ADK SSE only (4 steps)
- [ ] Pattern 3: ADK BIDI only (4 steps with audio)
- [ ] Pattern 4: Mode switching (5 steps, **verify history preservation**)

## Running E2E Tests

### Run All Tests

```bash
pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts
```

### Run Specific Pattern

```bash
pnpm exec playwright test -g "Pattern 1"
pnpm exec playwright test -g "Pattern 4"
```

### Run with UI Mode

```bash
pnpm exec playwright test --ui
```

### Run with Debug Mode

```bash
PWDEBUG=1 pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts
```

## Test Scenarios

### Empty Fixture Test

Before fixtures are recorded, there's a test that verifies the UI behavior with an empty fixture:

```bash
pnpm exec playwright test -g "empty fixture"
```

This test ensures:

- No error when fixture file is empty
- No messages are displayed
- UI remains in initial state

### Pattern Tests (After Fixtures Recorded)

After recording all fixtures, run the full test suite:

```bash
pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts
```

Expected results:

- ✅ Pattern 1: Gemini Direct - 8 messages rendered
- ✅ Pattern 2: ADK SSE - 8 messages with token counts
- ✅ Pattern 3: ADK BIDI - 8 messages with audio players
- ✅ Pattern 4: Mode switching - 10 messages preserved
- ✅ Pattern 4 Critical: Exactly 10 unique messages

## Troubleshooting

### Fixtures Not Loading

**Symptom**: Test fails with "Failed to load fixture"

**Solution**:

1. Check symlinks exist:

   ```bash
   ls -la public/fixtures/
   ```

2. Verify Next.js dev server is running:

   ```bash
   curl http://localhost:3000/fixtures/pattern1-frontend.jsonl
   ```

3. Check browser console for fetch errors

### Tests Failing

**Symptom**: Tests fail with timeout or incorrect message count

**Solution**:

1. Verify fixture files exist and have content:

   ```bash
   ls -lh tests/fixtures/pattern*.jsonl
   ```

2. Check JSONL format is valid:

   ```bash
   cat tests/fixtures/pattern1-frontend.jsonl | jq
   ```

3. Re-record fixture following `tests/fixtures/README.md` exactly

### Recording Issues

**Symptom**: Chunk logger not working, no chunks captured

**Solution**:

1. Verify chunk logger is enabled:

   ```javascript
   localStorage.getItem('CHUNK_LOGGER_ENABLED')  // Should return "true"
   ```

2. Check `window.__chunkLogger__` exists:

   ```javascript
   console.log(window.__chunkLogger__)
   ```

3. Look for chunk logger output in browser console during message sending

### Pattern 4 History Not Preserved

**Symptom**: Messages disappear after mode switch in recording

**Solution**:

- This is a bug in the application, not the test
- Do NOT proceed with recording - fix the bug first
- Pattern 4 is designed to catch this exact issue

## Development Workflow

### Adding New Test Patterns

1. Create pattern directory:

   ```bash
   touch tests/fixtures/pattern5-frontend.jsonl
   touch tests/fixtures/pattern5-backend.jsonl
   ```

2. Document recording steps in `tests/fixtures/README.md`

3. Create symlink in public:

   Symlink already exists (public/fixtures/ points to tests/fixtures/)

4. Add test case in `e2e/chunk-player-ui-verification.spec.ts`

5. Record fixture following `tests/fixtures/README.md`

6. Run test and iterate

### Updating Existing Fixtures

When UI or backend behavior changes:

1. Delete old fixture:

   ```bash
   rm tests/fixtures/pattern1-frontend.jsonl
   ```

2. Re-record using `tests/fixtures/README.md`

3. Run tests to verify:

   ```bash
   pnpm exec playwright test -g "Pattern 1"
   ```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Frontend Tests

on: [push, pull_request]

jobs:
  e2e-chunk-player:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E tests
        run: pnpm exec playwright test e2e/chunk-player-ui-verification.spec.ts

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

**Note**: Fixtures must be committed to the repository for CI to work.

## Best Practices

### DO

- ✅ Record fixtures following `tests/fixtures/README.md` exactly
- ✅ Verify message history preservation in Pattern 4
- ✅ Commit fixture files to git for CI
- ✅ Re-record fixtures when UI/backend changes
- ✅ Use chunk player for deterministic UI testing
- ✅ Write assertions that verify actual UI elements

### DON'T

- ❌ Modify fixture JSONL files manually
- ❌ Skip verification steps during recording
- ❌ Use chunk player for testing backend logic
- ❌ Record fixtures with incomplete scenarios
- ❌ Proceed with Pattern 4 recording if history not preserved

## Related Documentation

- `tests/fixtures/README.md` - Fixture recording guide and pattern details
- `lib/chunk-player-transport.ts` - Transport implementation
- `e2e/chunk-player-ui-verification.spec.ts` - Test implementation
- `CLAUDE.md` - Project-wide development guidelines

## Future Enhancements

- [ ] Automated fixture validation (JSONL format, chunk types)
- [ ] Fixture diff tool for comparing old vs new recordings
- [ ] Visual regression testing with chunk player
- [ ] Performance benchmarking with chunk player (no LLM latency)
- [ ] Server-side chunk player for backend E2E tests

---

## Backend E2E Testing

## Overview

This document describes the E2E testing strategy for the backend server using the Chunk Player pattern. This approach enables deterministic backend testing without requiring real LLM API calls.

## Architecture

### Chunk Player Pattern (Server)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Recording Phase (Manual)                      │
│                                                                   │
│  1. Enable Chunk Logger via Environment Variables               │
│     → export CHUNK_LOGGER_ENABLED=true                          │
│     → export CHUNK_LOGGER_SESSION_ID=pattern1-backend           │
│                                                                   │
│  2. Start Backend Server                                        │
│     → uv run uvicorn server:app --reload                        │
│                                                                   │
│  3. Execute Test Scenario                                       │
│     → Frontend sends requests to backend                        │
│     → Backend processes and logs chunks                         │
│                                                                   │
│  4. Collect Logged Chunks                                       │
│     → chunk_logs/pattern1-backend/backend-adk-event.jsonl       │
│     → chunk_logs/pattern1-backend/backend-sse-event.jsonl       │
│                                                                   │
│  5. Save to Fixture Directory                                   │
│     → tests/fixtures/pattern*-backend.jsonl                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Playback Phase (E2E Test)                     │
│                                                                   │
│  1. Set Environment Variables                                   │
│     → export E2E_CHUNK_PLAYER_MODE=true                         │
│     → export E2E_CHUNK_PLAYER_FIXTURE=path/to/fixture.jsonl     │
│                                                                   │
│  2. Backend Code Detects E2E Mode                               │
│     → ChunkPlayerManager.is_enabled() returns True              │
│     → ChunkPlayerManager.create_player() loads fixture          │
│                                                                   │
│  3. Replace Real Processing with Chunk Player                   │
│     → Instead of calling LLM, replay pre-recorded chunks        │
│     → ChunkPlayer yields chunks in fast-forward mode            │
│                                                                   │
│  4. Verify Backend Behavior                                     │
│     → Check response format, timing, error handling             │
└─────────────────────────────────────────────────────────────────┘
```

Legend / 凡例:

- Recording Phase: 記録フェーズ
- Playback Phase: 再生フェーズ
- Chunk Logger: チャンクロガー
- Chunk Player: チャンクプレイヤー
- Environment Variables: 環境変数

## Test Patterns

### Pattern 1: Gemini Direct (No Backend Processing)

- **Mode**: Gemini Direct
- **Backend Involvement**: None (frontend calls Gemini directly)
- **Expected**: No backend chunks recorded
- **Note**: This pattern exists for frontend testing only

### Pattern 2: ADK SSE Only

- **Mode**: ADK SSE (Server-Sent Events)
- **Steps**: 4 messages (same as frontend)
- **Backend Chunks**:
    - `backend-adk-event.jsonl` - Raw ADK events
    - `backend-sse-event.jsonl` - Formatted SSE events
- **Verifies**:
    - SSE event formatting
    - Tool invocation handling (weather, calculator)
    - Token count metadata

### Pattern 3: ADK BIDI Only

- **Mode**: ADK BIDI (WebSocket)
- **Steps**: 4 messages (same as frontend)
- **Backend Chunks**:
    - `backend-adk-event.jsonl` - Raw ADK events
    - `backend-sse-event.jsonl` - Formatted events (converted to SSE format)
- **Verifies**:
    - WebSocket message handling
    - Audio chunk processing (PCM data)
    - Latency measurement

### Pattern 4: Mode Switching

- **Mode**: Gemini → ADK SSE → ADK BIDI → ADK SSE → Gemini
- **Steps**: 5 messages
- **Backend Chunks**:
    - Mixed ADK SSE and BIDI events
    - Mode transitions visible in chunk metadata
- **Verifies**:
    - Backend handles mode transitions correctly
    - No state leakage between modes

## Implementation Files

### Core Server Files

- **chunk_logger.py**
    - Logs chunks during execution
    - Outputs JSONL files per location
    - Environment variable configuration

- **chunk_player.py**
    - Replays chunks from JSONL files
    - `ChunkPlayer` class with `from_file()` method
    - `ChunkPlayerManager` for E2E mode detection

- **stream_protocol.py**
    - Contains `stream_adk_to_ai_sdk()` function
    - Integration point for chunk player (future)

- **server.py**
    - FastAPI application
    - SSE and WebSocket endpoints
    - Integration point for chunk player (future)

### Test Files (Future)

- **tests/e2e/test_server_chunk_player.py** (to be created)
    - Pytest-based E2E tests
    - One test per pattern
    - Verifies response format and behavior

### Fixture Files

- **tests/fixtures/pattern*-backend.jsonl**
    - Pre-recorded backend chunks
    - Combined from all backend locations
    - Used by E2E tests

## Recording Fixtures (Manual Process)

### Prerequisites

1. Ensure frontend and backend are ready:

   ```bash
   # Terminal 1: Backend
   uv run uvicorn server:app --reload

   # Terminal 2: Frontend
   pnpm dev
   ```

2. Open browser:

   ```bash
   open http://localhost:3000
   ```

### Recording Steps

**For each pattern (2-4, skip pattern 1):**

1. **Set Backend Environment Variables**

   ```bash
   # Stop backend server (Ctrl+C)

   # Set environment variables
   export CHUNK_LOGGER_ENABLED=true
   export CHUNK_LOGGER_SESSION_ID=pattern2-backend
   export CHUNK_LOGGER_OUTPUT_DIR=./chunk_logs

   # Restart backend
   uv run uvicorn server:app --reload
   ```

2. **Set Frontend Chunk Logger**

   Open browser console:

   ```javascript
   localStorage.setItem('CHUNK_LOGGER_ENABLED', 'true');
   localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern2-frontend');
   location.reload();
   ```

3. **Execute Test Scenario**

   Follow the recording steps in `tests/fixtures/README.md` for the pattern:
   - Pattern 2: ADK SSE only
   - Pattern 3: ADK BIDI only
   - Pattern 4: Mode switching

4. **Collect Backend Chunks**

   Backend chunks are written to:

   ```
   chunk_logs/pattern2-backend/
   ├── backend-adk-event.jsonl
   └── backend-sse-event.jsonl
   ```

5. **Merge Backend Chunks**

   For E2E tests, we need a single consolidated file:

   ```bash
   # Pattern 2 example
   cat chunk_logs/pattern2-backend/backend-adk-event.jsonl \
       chunk_logs/pattern2-backend/backend-sse-event.jsonl \
       > tests/fixtures/pattern2-backend.jsonl
   ```

   **Alternative**: Use just one location if that's sufficient for testing:

   ```bash
   cp chunk_logs/pattern2-backend/backend-adk-event.jsonl \
      tests/fixtures/pattern2-backend.jsonl
   ```

6. **Verify Fixture**

   ```bash
   # Check file exists and has content
   wc -l tests/fixtures/pattern2-backend.jsonl
   ls -lh tests/fixtures/pattern2-backend.jsonl

   # Verify JSONL format
   head -n 3 tests/fixtures/pattern2-backend.jsonl | jq
   ```

7. **Clean Up**

   ```bash
   # Stop backend (Ctrl+C)
   # Unset environment variables
   unset CHUNK_LOGGER_ENABLED
   unset CHUNK_LOGGER_SESSION_ID
   unset CHUNK_LOGGER_OUTPUT_DIR
   ```

### Recording Checklist

- [ ] Pattern 1: Gemini Direct - **No backend recording needed** (frontend only)
- [ ] Pattern 2: ADK SSE - Backend chunks recorded and merged
- [ ] Pattern 3: ADK BIDI - Backend chunks recorded and merged
- [ ] Pattern 4: Mode switching - Backend chunks recorded and merged

## Running E2E Tests (Future)

Once backend E2E tests are implemented:

### Run All Tests

```bash
# Set environment for E2E mode
export E2E_CHUNK_PLAYER_MODE=true

# Run backend E2E tests
just test-e2e-server

# Or directly with pytest
uv run pytest tests/e2e/test_server_chunk_player.py
```

### Run Specific Pattern

```bash
export E2E_CHUNK_PLAYER_MODE=true
uv run pytest tests/e2e/test_server_chunk_player.py -k "pattern2"
```

### Run with Verbose Output

```bash
export E2E_CHUNK_PLAYER_MODE=true
uv run pytest tests/e2e/test_server_chunk_player.py -v -s
```

## Integration Points (To Be Implemented)

### 1. Modify `stream_adk_to_ai_sdk()` Function

The function in `stream_protocol.py` needs to detect E2E mode and use ChunkPlayer:

```python
async def stream_adk_to_ai_sdk(
    event_stream: AsyncGenerator[Event, None],
    message_id: str | None = None,
    tools_requiring_approval: set[str] | None = None,
    mode: str = "adk-sse",
) -> AsyncGenerator[str, None]:
    # E2E Mode: Use chunk player instead of real event stream
    from chunk_player import ChunkPlayerManager

    player = ChunkPlayerManager.create_player()
    if player:
        # Replay chunks instead of processing real events
        async for entry in player.play(mode="fast-forward"):
            # Convert chunk back to SSE format
            yield entry.chunk
        return

    # Normal mode: process real event stream
    # ... existing implementation ...
```

### 2. WebSocket Endpoint Integration

The WebSocket endpoint in `server.py` needs similar integration:

```python
@app.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    # E2E Mode check
    from chunk_player import ChunkPlayerManager

    player = ChunkPlayerManager.create_player()
    if player:
        # Replay chunks for E2E testing
        await websocket.accept()
        async for entry in player.play(mode="fast-forward"):
            await websocket.send_text(entry.chunk)
        await websocket.close()
        return

    # Normal mode: real WebSocket processing
    # ... existing implementation ...
```

## File Structure

```
/
├── chunk_logger.py                    # Chunk recording
├── chunk_player.py                    # Chunk playback (enhanced)
├── stream_protocol.py                 # To be modified for E2E
├── server.py                          # To be modified for E2E
├── tests/
│   ├── e2e/
│   │   └── test_server_chunk_player.py
│   └── fixtures/
│       ├── pattern1-frontend.jsonl
│       ├── pattern1-backend.jsonl
│       ├── pattern2-frontend.jsonl
│       ├── pattern2-backend.jsonl
│       ├── pattern3-frontend.jsonl
│       ├── pattern3-backend.jsonl
│       ├── pattern4-frontend.jsonl
│       ├── pattern4-backend.jsonl
│       └── README.md
└── E2E_SERVER_GUIDE.md                # This file
```

## Troubleshooting

### Chunks Not Being Logged

**Symptom**: `chunk_logs/` directory empty or missing files

**Solution**:

1. Verify environment variables are set:

   ```bash
   echo $CHUNK_LOGGER_ENABLED  # Should print "true"
   echo $CHUNK_LOGGER_SESSION_ID
   ```

2. Check backend logs for chunk logger initialization

3. Ensure backend server was restarted after setting env vars

### Empty Fixture Files

**Symptom**: `backend-chunks.jsonl` has 0 bytes

**Solution**:

1. Verify you executed the test scenario correctly
2. Check that you're using ADK SSE or BIDI mode (Gemini Direct doesn't use backend)
3. Look for `chunk_logs/` directory - files should be there first

### Invalid JSONL Format

**Symptom**: Tests fail with "Invalid JSONL format"

**Solution**:

1. Validate JSONL syntax:

   ```bash
   cat backend-chunks.jsonl | jq
   ```

2. Check for corrupt lines:

   ```bash
   while IFS= read -r line; do echo "$line" | jq .; done < backend-chunks.jsonl
   ```

3. Re-record the fixture if corrupted

### Chunk Player Not Activating

**Symptom**: E2E tests still call real LLM

**Solution**:

1. Verify environment variables:

   ```bash
   export E2E_CHUNK_PLAYER_MODE=true
   export E2E_CHUNK_PLAYER_FIXTURE=tests/fixtures/pattern2-backend.jsonl
   ```

2. Check that integration code is implemented (see "Integration Points" section)

3. Add debug logging to verify `ChunkPlayerManager.is_enabled()` returns True

## Development Workflow

### Adding Backend E2E Tests

1. **Create test file**:

   ```bash
   touch tests/e2e/test_server_chunk_player.py
   ```

2. **Write test skeleton**:

   ```python
   import pytest
   from chunk_player import ChunkPlayerManager

   @pytest.mark.asyncio
   async def test_pattern2_adk_sse():
       # Arrange: Set E2E environment
       import os
       os.environ["E2E_CHUNK_PLAYER_MODE"] = "true"
       os.environ["E2E_CHUNK_PLAYER_FIXTURE"] = \
           "tests/fixtures/pattern2-backend.jsonl"

       # Act: Call backend endpoint
       # (requires integration in stream_protocol.py)

       # Assert: Verify response
       pass
   ```

3. **Implement integration in `stream_protocol.py` and `server.py`**

4. **Record fixtures** following this guide

5. **Run tests**:

   ```bash
   export E2E_CHUNK_PLAYER_MODE=true
   uv run pytest tests/e2e/test_server_chunk_player.py
   ```

### Updating Existing Fixtures

When backend behavior changes:

1. Delete old fixture:

   ```bash
   rm tests/fixtures/pattern2-backend.jsonl
   ```

2. Re-record using recording steps

3. Run tests to verify:

   ```bash
   export E2E_CHUNK_PLAYER_MODE=true
   uv run pytest tests/e2e/test_server_chunk_player.py -k "pattern2"
   ```

## Best Practices

### DO

- ✅ Record backend and frontend chunks in the same session
- ✅ Merge all backend location files into single fixture
- ✅ Verify JSONL format after recording
- ✅ Commit fixture files to git for CI
- ✅ Re-record fixtures when backend logic changes
- ✅ Use fast-forward mode for deterministic testing

### DON'T

- ❌ Manually edit JSONL fixture files
- ❌ Mix chunks from different sessions
- ❌ Skip verification steps during recording
- ❌ Use chunk player for production deployments
- ❌ Record fixtures with incomplete scenarios

## CI/CD Integration

### Environment Variables for CI

```yaml
# .github/workflows/e2e-backend.yml
env:
  E2E_CHUNK_PLAYER_MODE: true
  CHUNK_LOGGER_ENABLED: false  # Don't log in tests
```

### Pytest Configuration

```ini
# pytest.ini
[pytest]
markers =
    e2e: End-to-end tests (require fixtures)
    chunk_player: Tests using chunk player

# Run E2E tests
# pytest -m e2e
```

## Related Documentation

- `E2E_FRONTEND_GUIDE.md` - Frontend E2E testing guide
- `tests/fixtures/README.md` - Fixture recording guide
- `chunk_player.py` - Python chunk player implementation
- `chunk_logger.py` - Python chunk logger implementation
- `agents/recorder_handsoff.md` - Manual recording handoff
- `CLAUDE.md` - Project-wide development guidelines

## Future Enhancements

- [ ] Implement backend E2E test file (`tests/e2e/test_server_chunk_player.py`)
- [ ] Integrate ChunkPlayer into `stream_protocol.py`
- [ ] Integrate ChunkPlayer into WebSocket endpoint (`server.py`)
- [ ] Add fixture validation CLI tool
- [ ] Add chunk diff tool for comparing fixtures
- [ ] Performance benchmarking with chunk player
- [ ] Automated fixture update detection in CI

## Summary

Backend E2E testing with chunk player provides:

- **Deterministic Tests**: No LLM API calls, consistent results
- **Fast Execution**: Replay chunks without network latency
- **Regression Detection**: Verify backend behavior changes
- **CI/CD Ready**: Fixtures committed to git for automated testing

Once integration is complete, backend E2E tests will run alongside frontend tests to ensure full system correctness.
