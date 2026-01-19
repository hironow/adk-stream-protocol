# E2E Testing Guide

Complete guide for end-to-end testing across frontend and backend.

---

## 🚀 Quick Start

### Running Tests

**Backend E2E (pytest)**:

```bash
# All backend E2E tests
uv run pytest tests/e2e/ -v

# Specific test file
uv run pytest tests/e2e/test_server_chunk_player.py
```

**Frontend E2E (Vitest)**:

```bash
# All frontend E2E tests
bunx vitest run lib/tests/e2e/

# Specific test
bunx vitest run lib/tests/e2e/chat-flow.e2e.test.ts
```

**Full E2E (Playwright)** - UI固有テストのみ (13ファイル):

```bash
# UI固有テスト実行（要サーバー）
just test-browser

# スナップショット更新
just test-browser-update

# UI mode (interactive)
bunx playwright test scenarios/ --ui
```

### Prerequisites

1. **Backend server running**: `just dev` (starts at `localhost:8000`)
2. **Frontend server running**: `bun dev` (starts at `localhost:3000`)
3. **Fixtures up-to-date**: Run tests to generate latest fixtures

---

## 📋 Test Architecture

### Three Test Layers

```
┌─────────────────────────────────────────────┐
│  Playwright E2E (scenarios/)                │  UI-specific
│  Browser + Frontend + Backend               │  13 files
│  Visual regression, A11y, UI rendering     │  NO protocol tests
└─────────────────────────────────────────────┘
         ↓ UI tests only (protocol tests moved to Vitest)
┌─────────────────────────────────────────────┐
│  Frontend E2E (lib/tests/e2e/)              │  Protocol/Logic
│  Vitest + React + AI SDK v6 + MSW          │  ~20 files
│  Tool approval, mode switching, etc.       │  Component integration
└─────────────────────────────────────────────┘
         ↓ uses baseline fixtures
┌─────────────────────────────────────────────┐
│  Backend E2E (tests/e2e/)                   │  Backend only
│  Python + FastAPI + ADK                     │  API golden files
└─────────────────────────────────────────────┘
```

**Legend / 凡例**:

- Playwright E2E: UI固有テスト（レンダリング、スナップショット、A11y）
- Frontend E2E (Vitest): プロトコル/ロジックテスト（ツール承認、モード切替）
- Backend E2E: バックエンドAPI検証

### Layer Comparison

| Layer | Tool | Environment | Scope | Mock Strategy |
|-------|------|-------------|-------|---------------|
| **Playwright E2E** | Playwright | Real browser | UI rendering | Real backend |
| **Frontend E2E** | Vitest | jsdom | Protocol/Logic | Backend API (MSW) |
| **Backend E2E** | pytest | Python | Backend API | LLM (Chunk Player) |

**Note**: Playwright は UI 固有テスト（visual regression, accessibility）に特化。プロトコル検証は Vitest に委譲。

---

## 🐍 Backend E2E (pytest)

### Overview

Backend E2E tests verify API correctness using **golden file regression testing**:

- **Input**: Frontend baseline fixtures → `input.messages`
- **Expected**: Frontend baseline fixtures → `output.rawEvents`
- **Actual**: Real backend server response
- **Validation**: Byte-level comparison with dynamic field normalization

### Test Pattern

Each frontend baseline fixture has a corresponding backend test:

| Fixture | Test | Scenario |
|---------|------|----------|
| `get_weather-sse-baseline.json` | `test_get_weather_sse_baseline.py` | Simple tool execution |
| `get_location-approved-sse-baseline.json` | `test_get_location_approved_sse_baseline.py` | Tool with approval (granted) |
| `process_payment-denied-sse-baseline.json` | `test_process_payment_denied_sse_baseline.py` | Tool with approval (denied) |

**Test Structure** (Given-When-Then):

```python
@pytest.mark.asyncio
async def test_get_weather_sse(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for get_weather tool."""
    # Given: Frontend baseline fixture
    fixture = await load_frontend_fixture(
        frontend_fixture_dir / "get_weather-sse-baseline.json"
    )

    # When: Send request to backend
    actual_events = await send_sse_request(
        messages=fixture["input"]["messages"],
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected
    is_match, diff = compare_raw_events(
        actual=actual_events,
        expected=fixture["output"]["rawEvents"],
        normalize=True,  # Normalize UUIDs
    )
    assert is_match, f"rawEvents mismatch:\n{diff}"
```

### Dynamic Field Normalization

Backend generates UUIDs that change between runs:

- `messageId`: `"3bee2e30-..."` → `"DYNAMIC_MESSAGE_ID"`
- `toolCallId`: `"adk-37911c3c-..."` → `"adk-DYNAMIC_ID"`

Normalization allows golden file comparison to focus on **structure and content**, not random IDs.

### Multi-Turn Tool Handling

Multi-turn tools (approval required) need 2 HTTP requests:

1. **Turn 1**: User message → Confirmation request → `[DONE]`
2. **Turn 2**: Approval response → Tool execution → `[DONE]`

**Current coverage**: Turn 1 only (Turn 2 requires separate request, not yet implemented)

### ADR-0007 Verification

Backend E2E tests provide **physical evidence** for [ADR-0007](adr/0007-approval-value-independence-in-auto-submit.md):

**Approved vs Denied fixtures** (Turn 1 only):

- `process_payment-approved-sse-baseline.json`
- `process_payment-denied-sse-baseline.json`

→ **Turn 1 events are IDENTICAL** (only Turn 2 differs)

This proves approval timing does NOT depend on `approved: true/false` value.

---

## ⚛️ Frontend E2E (Vitest)

### Overview

Frontend E2E tests verify component integration in a browser environment using **Vitest browser mode**.

**Scope**:

- Frontend UI components (React)
- AI SDK v6 integration (`useChat`)
- Browser APIs (WebSocket, AudioWorklet)
- User interaction flows

**Mock Strategy**:

- Backend API: Mocked with MSW
- LLM responses: Baseline fixtures
- Browser APIs: Mock implementations

### Test Scenarios

1. **Chat Flow** (`chat-flow.e2e.test.ts`)
   - Message input and submission
   - Streaming response display
   - Message history persistence

2. **Tool Execution** (`tool-execution.e2e.test.ts`)
   - Loading states during execution
   - Approval dialog interaction
   - Result display

3. **Mode Switching** (`mode-switching.e2e.test.ts`)
   - Mode selection UI
   - Connection state feedback
   - History preservation

4. **Audio Control** (`audio-control.e2e.test.ts`)
   - Microphone recording
   - Audio playback
   - BGM controls

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, userEvent } from '@testing-library/react';

describe('Chat Flow E2E', () => {
  it('should send message and display response', async () => {
    // Given: Chat component with MSW backend mock
    const user = userEvent.setup();
    render(<Chat mode="adk-sse" />);

    // When: User types and sends message
    const input = screen.getByRole('textbox');
    await user.type(input, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // Then: Response appears in chat
    expect(await screen.findByText(/Hello/)).toBeInTheDocument();
  });
});
```

### Baseline Fixtures

Frontend E2E tests use baseline fixtures from `fixtures/frontend/`:

- **Format**: JSON with `input` and `output` sections
- **Content**: Complete message flow including `rawEvents`
- **Usage**: MSW handlers return `expectedChunks` from fixtures

**Example** (`get_weather-sse-baseline.json`):

```json
{
  "description": "Simple tool execution without approval",
  "mode": "sse",
  "input": {
    "messages": [
      { "role": "user", "content": "What's the weather?" }
    ]
  },
  "output": {
    "rawEvents": [...],
    "expectedChunks": [...],
    "expectedDoneCount": 1
  }
}
```

---

## 🎭 Playwright Best Practices

### Selector Priority (MANDATORY)

**❌ PROHIBITED**: Text-based selectors cause strict mode violations and flaky tests

```typescript
// ❌ NEVER USE - Multiple elements can match, causes timeouts
await page.locator("text=Thank you").click();
await expect(page.locator("text=Hello")).toBeVisible();

// ❌ NEVER USE - Same problem with regex
await page.locator("text=/Hello/").click();
```

**✅ REQUIRED**: Use semantic, stable selectors in this priority order:

1. **`getByTestId()`** - Most stable, explicit (PREFERRED)

   ```typescript
   await page.getByTestId("message-user").click();
   await expect(page.getByTestId("message-text")).toContainText("Hello");
   ```

2. **`getByRole()`** - Accessibility-friendly

   ```typescript
   await page.getByRole("button", { name: /Submit/i }).click();
   ```

3. **`getByLabel()`** - For form inputs

   ```typescript
   await page.getByLabel("Email").fill("test@example.com");
   ```

### Critical Lessons Learned

**Issue**: P0 Critical timeout in mode switching test (2025-12-30)

- **Root Cause**: `locator("text=background music")` matched 2+ elements
- **Symptom**: 45-second timeout, test failed
- **Fix**: Changed to `getByTestId("message-user").nth(1).getByTestId("message-text")`
- **Result**: Test passed immediately (10.4s)

**Conclusion**: Text selectors are the PRIMARY cause of Playwright test failures in this project.

### Enforcement

**Manual Review**: Check all `.spec.ts` files before merge
**Pattern to grep**: `locator\("text=` or `locator\('text=`

```bash
# Find all text locators (must return 0 results)
grep -r 'locator("text=' scenarios/
grep -r "locator('text=" scenarios/
```

---

## 📦 Fixtures

### Directory Structure

```
fixtures/
├── backend/               # Backend E2E (JSONL, converted from frontend)
│   ├── get_weather-sse-from-frontend.jsonl
│   ├── get_location-approved-sse-from-frontend.jsonl
│   └── ... (12 files total)
├── frontend/              # Frontend E2E (JSON, baseline data)
│   ├── get_weather-sse-baseline.json
│   ├── get_location-approved-sse-baseline.json
│   └── ... (14 files total)
└── scenarios/             # Playwright E2E resources
    └── test-image.png

scenarios/                 # Playwright UI-specific tests (13 files)
├── smoke/                 # Basic UI smoke tests (3)
├── ui/                    # UI-specific tests (7)
├── integration/           # UI integration tests (2)
└── approval/              # Approval UI tests (1)
```

### Frontend Fixtures (Baseline)

**Purpose**: Golden files for frontend integration tests

**Format**: JSON

```json
{
  "description": "...",
  "mode": "sse" | "bidi",
  "input": { "messages": [...] },
  "output": {
    "rawEvents": [...],      # AI SDK v6 events
    "expectedChunks": [...],  # Parsed chunks
    "expectedDoneCount": 1
  }
}
```

**Naming Convention**:

```
{function-name}-{status}-{mode}-baseline.json
```

Examples:

- `get_weather-sse-baseline.json` - Simple execution
- `get_location-approved-sse-baseline.json` - Approved
- `process_payment-denied-bidi-baseline.json` - Denied

### Backend Fixtures (Converted)

**Purpose**: Deterministic backend E2E tests

**Format**: JSON Lines (JSONL)

```jsonl
{"timestamp": 1766600712686, "session_id": "converted-from-frontend", "mode": "adk-sse", "chunk": {...}}
```

**Generation**: Automatically converted from frontend baseline fixtures

```bash
# Convert all frontend fixtures to backend format
uv run python scripts/convert_frontend_to_backend_fixture.py

# Output
✓ get_weather-sse-baseline.json -> get_weather-sse-from-frontend.jsonl (9 chunks)
✓ change_bgm-bidi-baseline.json -> change_bgm-bidi-from-frontend.jsonl (9 chunks)
⊘ process_payment-error-handling-green.json (skipped - no rawEvents)
```

### Recording New Fixtures

**Frontend** (manual recording):

1. Run integration test to verify behavior
2. Extract `rawEvents` and `expectedChunks` from test output
3. Create JSON file following naming convention
4. Add to `fixtures/frontend/`

**Backend** (automatic conversion):

1. Update frontend baseline fixture
2. Run conversion script
3. Backend JSONL fixture is auto-generated

### Fixture Coverage

| Tool | SSE | BIDI | Scenarios |
|------|-----|------|-----------|
| get_weather | ✓ | ✓ | Simple execution |
| get_location | ✓✓ | ✓✓ | Approved + Denied |
| process_payment | ✓✓ | ✓✓ | Approved + Denied |
| change_bgm | ✓ | ✓ | Frontend tool |

**Total**: 14 frontend baselines, 12 backend converted

---

## 🔍 Chunk Logger

### Overview

Chunk Logger is a debugging tool that records all AI SDK v6 Data Stream Protocol events during E2E tests.

**Purpose**:

- Debug protocol issues
- Record golden files
- Verify event sequences
- Reproduce bugs

### Usage

**Automatic logging** (E2E tests):

```typescript
import { ChunkLoggingTransport } from '@/lib/chunk_logs';

const transport = new ChunkLoggingTransport(
  delegateTransport,
  'adk-sse'  // mode
);

// All events automatically logged to chunkLogger singleton
```

**Playback**:

```typescript
import { ChunkPlayer } from '@/lib/chunk_logs';

const player = ChunkPlayer.fromFile('chunk_logs/session-123.jsonl');

for await (const entry of player.play('fast-forward')) {
  console.log(entry.chunk);
}
```

### Log Format

**JSONL** (one event per line):

```jsonl
{"timestamp": 1766600712686, "session_id": "abc123", "mode": "adk-sse", "location": "transport", "direction": "out", "sequence_number": 1, "chunk": {"type": "start", "messageId": "..."}}
{"timestamp": 1766600712687, "session_id": "abc123", "mode": "adk-sse", "location": "transport", "direction": "out", "sequence_number": 2, "chunk": {"type": "text-delta", "textDelta": "Hello"}}
```

### Chunk Player Modes

| Mode | Speed | Use Case |
|------|-------|----------|
| `real-time` | Original timing | Visual debugging |
| `fast-forward` | No delay | Automated tests |
| `step` | Manual control | Interactive debugging |

### Recording Guidelines

**DO**:

- Record complete user flows (start to `[DONE]`)
- Include error scenarios
- Document fixture purpose in filename
- Verify recorded data before committing

**DON'T**:

- Record partial flows
- Include sensitive data
- Modify JSONL manually (regenerate instead)
- Commit logs from failed tests

---

## 🛠️ Troubleshooting

### Backend E2E

**Issue**: Test fails with "rawEvents mismatch"

**Causes**:

1. Backend implementation changed
2. Frontend fixture outdated
3. Dynamic field normalization issue

**Solution**:

1. Check diff output for actual vs expected
2. Verify backend behavior is correct
3. Re-record frontend fixture if needed
4. Update normalization logic if new dynamic fields

---

**Issue**: Multi-turn test only validates Turn 1

**Status**: Known limitation (Turn 2 not yet implemented)

**Workaround**: Manually test Turn 2 flow for now

---

### Frontend E2E

**Issue**: MSW handler not intercepting request

**Causes**:

1. URL mismatch (relative vs absolute)
2. Handler not registered
3. Wrong request method

**Solution**:

```typescript
// ✗ Wrong (relative path doesn't work in Node.js)
http.post('/api/chat', handler)

// ✓ Correct (full URL required)
http.post('http://localhost/api/chat', handler)
```

---

### Fixtures

**Issue**: Backend fixture conversion fails

**Causes**:

1. Frontend fixture missing `rawEvents`
2. Invalid JSON format
3. Conversion script bug

**Solution**:

1. Verify frontend fixture has `output.rawEvents`
2. Validate JSON with `jq`
3. Check script output for error details

---

**Issue**: Fixture data out of sync

**Prevention**:

1. Regenerate backend fixtures after updating frontend
2. Run conversion script in CI
3. Version control all fixtures

---

### Chunk Logger

**Issue**: Logs not being written

**Causes**:

1. chunkLogger not initialized
2. Transport not wrapped with ChunkLoggingTransport
3. Disk space full

**Solution**:

```typescript
// Verify transport is wrapped
const transport = new ChunkLoggingTransport(delegate, mode);
```

---

**Issue**: Playback fails with parse error

**Causes**:

1. Incomplete JSONL file (test crashed)
2. Manual editing introduced syntax error
3. Wrong file format

**Solution**:

1. Validate JSONL: `cat file.jsonl | jq empty`
2. Regenerate from clean test run
3. Never manually edit JSONL files

---

### Playwright E2E

**Issue**: BIDI mode sequential tool calls fail (Tests 3 & 5 in get-location-bidi.spec.ts)

**Symptom**: Second Approve/Deny button never appears after first tool execution completes.

**Root Cause**: BIDI WebSocket session has issues with sequential tool calls. After the first `get_location` tool completes, the AI doesn't consistently trigger a second tool call in the same session.

**Status**: Tests skipped. This is a BIDI mode specific issue, not related to Frontend Execute pattern.

**Workaround**:

- Use SSE mode for sequential tool testing (SSE mode passes)
- Or test each tool call in a fresh browser session

---

**Issue**: Geolocation permission denied test fails (Test 6 in get-location-sse.spec.ts)

**Symptom**: Tool stuck at "Processing Approval..." state, error message never appears.

**Root Cause**: Playwright's `context.grantPermissions([])` doesn't reliably deny geolocation in headless mode. The browser's geolocation API may hang indefinitely instead of rejecting with PERMISSION_DENIED.

**Status**: Test skipped due to Playwright limitation.

**Manual Testing**:

1. Open the app in a real browser (not headless)
2. Request location: "現在地を取得してください"
3. Click Approve on the tool approval dialog
4. Deny the browser's geolocation permission prompt
5. Verify error is handled gracefully without infinite loop

**Alternative Approach** (not implemented):

- Mock `navigator.geolocation` via `page.addInitScript()` to return a permission error
- This would make the test deterministic but less realistic

---

**Issue**: Frontend Execute tools don't trigger new assistant messages

**Symptom**: `waitForAssistantResponse` times out after approving tools like `get_location` or `change_bgm`.

**Root Cause**: Frontend Execute tools (ADR-0005) execute directly in the browser and call `addToolOutput()` inline. This doesn't necessarily create a new assistant message - the tool result is set directly on the existing tool invocation.

**Solution**: Use `waitForFrontendExecuteComplete` helper instead of `waitForAssistantResponse` for Frontend Execute tools.

```typescript
// ❌ Wrong - waits for message count to increase
await page.getByRole("button", { name: "Approve" }).click();
await waitForAssistantResponse(page);

// ✅ Correct - waits for tool state to complete
await page.getByRole("button", { name: "Approve" }).click();
await waitForFrontendExecuteComplete(page);
```

**Affected Tools**:

- `get_location` - Browser Geolocation API
- `change_bgm` - Audio context track switching

---

## 📚 Related Documentation

- **[Testing Strategy](testing_STRATEGY.md)** - Overall test architecture
- **[ADR-0005](adr/0005-frontend-execute-pattern.md)** - Frontend Execute pattern
- **[ADR-0007](adr/0007-approval-value-independence-in-auto-submit.md)** - Approval timing independence

---

**Last Updated**: 2026-01-19

---

## Playwright Test Strategy (Updated)

### UI-Specific Focus

Playwright E2E tests are now focused exclusively on **UI-specific testing**:

- **Visual regression** - Screenshot comparison
- **Accessibility** - A11y validation with axe-core
- **UI rendering** - Component display verification
- **Error UI** - Error message display

### Removed (Migrated to Vitest)

Protocol and logic tests have been migrated to Vitest for faster execution:

- Tool approval flows → `lib/tests/e2e/frontend-execute-*.e2e.test.tsx`
- Mode switching logic → `lib/tests/e2e/mode-switching.e2e.test.ts`
- Tool execution → `lib/tests/e2e/tool-execution.e2e.test.ts`
- Payment processing → `lib/tests/e2e/process-payment-*.e2e.test.tsx`

### Benefits

- **Faster CI**: Playwright tests reduced from 31 to 13 files
- **Better isolation**: UI tests vs protocol tests
- **Clearer responsibility**: Playwright = rendering, Vitest = logic
