# E2E Server Testing Guide

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
│     → tests/fixtures/e2e-chunks/pattern*/backend-chunks.jsonl   │
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
- **tests/fixtures/e2e-chunks/pattern*/backend-chunks.jsonl**
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

   Follow the recording steps for the pattern:
   - Pattern 2: `tests/fixtures/e2e-chunks/pattern2-adk-sse-only/recording-steps.md`
   - Pattern 3: `tests/fixtures/e2e-chunks/pattern3-adk-bidi-only/recording-steps.md`
   - Pattern 4: `tests/fixtures/e2e-chunks/pattern4-mode-switching/recording-steps.md`

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
       > tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl
   ```

   **Alternative**: Use just one location if that's sufficient for testing:
   ```bash
   cp chunk_logs/pattern2-backend/backend-adk-event.jsonl \
      tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl
   ```

6. **Verify Fixture**

   ```bash
   # Check file exists and has content
   wc -l tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl
   ls -lh tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl

   # Verify JSONL format
   head -n 3 tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl | jq
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
/Users/nino/workspace/r/oss/adk-ai-data-protocol/
├── chunk_logger.py                    # Chunk recording
├── chunk_player.py                    # Chunk playback (enhanced)
├── stream_protocol.py                 # To be modified for E2E
├── server.py                          # To be modified for E2E
├── tests/
│   ├── e2e/
│   │   └── test_server_chunk_player.py  # To be created
│   └── fixtures/
│       └── e2e-chunks/
│           ├── pattern1-gemini-only/
│           │   └── backend-chunks.jsonl    # Empty (no backend for Gemini Direct)
│           ├── pattern2-adk-sse-only/
│           │   └── backend-chunks.jsonl    # To be recorded
│           ├── pattern3-adk-bidi-only/
│           │   └── backend-chunks.jsonl    # To be recorded
│           └── pattern4-mode-switching/
│               └── backend-chunks.jsonl    # To be recorded
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
   export E2E_CHUNK_PLAYER_FIXTURE=tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl
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
           "tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl"

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
   rm tests/fixtures/e2e-chunks/pattern2-adk-sse-only/backend-chunks.jsonl
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
- `tests/fixtures/e2e-chunks/README.md` - Fixture recording guide
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
