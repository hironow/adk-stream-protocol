# E2E Frontend Testing Guide

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
│     → tests/fixtures/e2e-chunks/pattern*/frontend-chunks.jsonl │
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
- **tests/fixtures/e2e-chunks/**
  - `README.md` - Pattern overview and recording procedures for all patterns
  - `pattern1-gemini-only/frontend-chunks.jsonl` - Fixture (to be recorded)
  - `pattern2-adk-sse-only/frontend-chunks.jsonl` - Fixture (to be recorded)
  - `pattern3-adk-bidi-only/frontend-chunks.jsonl` - Fixture (to be recorded)
  - `pattern4-mode-switching/frontend-chunks.jsonl` - Fixture (to be recorded)

- **public/fixtures/e2e-chunks/**
  - Symlinks to `tests/fixtures/e2e-chunks/pattern*/`
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
   localStorage.setItem('CHUNK_LOGGER_SESSION_ID', 'pattern1-gemini-only');
   location.reload();
   ```

2. **Execute Test Scenario**

   Follow the detailed steps in `tests/fixtures/e2e-chunks/README.md` for each pattern:
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

   This downloads a file like `pattern1-gemini-only.jsonl`.

4. **Save Fixture**

   Move the downloaded file to the fixture directory:
   ```bash
   mv ~/Downloads/pattern1-gemini-only.jsonl \
      tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
   ```

5. **Verify Fixture**

   Check the file exists and has content:
   ```bash
   wc -l tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
   head -n 3 tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
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
   ls -la public/fixtures/e2e-chunks/
   ```

2. Verify Next.js dev server is running:
   ```bash
   curl http://localhost:3000/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
   ```

3. Check browser console for fetch errors

### Tests Failing

**Symptom**: Tests fail with timeout or incorrect message count

**Solution**:
1. Verify fixture files exist and have content:
   ```bash
   ls -lh tests/fixtures/e2e-chunks/pattern*/frontend-chunks.jsonl
   ```

2. Check JSONL format is valid:
   ```bash
   cat tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl | jq
   ```

3. Re-record fixture following `tests/fixtures/e2e-chunks/README.md` exactly

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
   mkdir -p tests/fixtures/e2e-chunks/pattern5-new-scenario
   ```

2. Document recording steps in `tests/fixtures/e2e-chunks/README.md`

3. Create symlink in public:
   ```bash
   cd public/fixtures/e2e-chunks
   ln -sf ../../../tests/fixtures/e2e-chunks/pattern5-new-scenario .
   ```

4. Add test case in `e2e/chunk-player-ui-verification.spec.ts`

5. Record fixture following `tests/fixtures/e2e-chunks/README.md`

6. Run test and iterate

### Updating Existing Fixtures

When UI or backend behavior changes:

1. Delete old fixture:
   ```bash
   rm tests/fixtures/e2e-chunks/pattern1-gemini-only/frontend-chunks.jsonl
   ```

2. Re-record using `tests/fixtures/e2e-chunks/README.md`

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

- ✅ Record fixtures following `tests/fixtures/e2e-chunks/README.md` exactly
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

- `tests/fixtures/e2e-chunks/README.md` - Fixture recording guide and pattern details
- `lib/chunk-player-transport.ts` - Transport implementation
- `e2e/chunk-player-ui-verification.spec.ts` - Test implementation
- `CLAUDE.md` - Project-wide development guidelines

## Future Enhancements

- [ ] Automated fixture validation (JSONL format, chunk types)
- [ ] Fixture diff tool for comparing old vs new recordings
- [ ] Visual regression testing with chunk player
- [ ] Performance benchmarking with chunk player (no LLM latency)
- [ ] Server-side chunk player for backend E2E tests
