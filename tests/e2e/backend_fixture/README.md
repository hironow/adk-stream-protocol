# Backend Fixture-based E2E Tests

Backend behavior verification using frontend baseline fixtures as golden files.

## Overview

These tests verify that **backend generates correct rawEvents** for each invocation scenario by comparing actual backend output against expected output captured in frontend baseline fixtures.

**Test Strategy**: Golden file regression testing

- **Input**: `fixtures/frontend/*.json` → `input.messages`
- **Expected Output**: `fixtures/frontend/*.json` → `output.rawEvents`
- **Actual Output**: Real backend server response
- **Comparison**: Actual vs Expected (with dynamic field normalization)

## Test Structure

### One Fixture = One Test File

Each frontend fixture file has a corresponding test file:

| Fixture File | Test File | Invocation | Turns |
|--------------|-----------|------------|-------|
| `get_weather-sse-baseline.json` | `test_get_weather_sse_baseline.py` | 1 | 1 |
| `process_payment-approved-sse-baseline.json` | `test_process_payment_approved_sse_baseline.py` | 1 | 2 |
| `process_payment-denied-sse-baseline.json` | `test_process_payment_denied_sse_baseline.py` | 1 | 2 |
| `change_bgm-sse-baseline.json` | `test_change_bgm_sse_baseline.py` | 1 | 1 |
| `get_location-approved-sse-baseline.json` | `test_get_location_approved_sse_baseline.py` | 1 | 2 |
| `get_location-denied-sse-baseline.json` | `test_get_location_denied_sse_baseline.py` | 1 | 2 |
| `get_weather-bidi-baseline.json` | `test_get_weather_bidi_baseline.py` (TODO) | 1 | 1 |

**Note**: BIDI mode tests are placeholders (WebSocket client not yet implemented).

## Test Pattern

Each test follows this structure:

```python
@pytest.mark.asyncio
async def test_<fixture_name>(frontend_fixture_dir: Path):
    """Should generate correct rawEvents for <scenario>."""
    # Given: Frontend baseline fixture
    fixture_path = frontend_fixture_dir / "<fixture_name>.json"
    fixture = await load_frontend_fixture(fixture_path)

    input_messages = fixture["input"]["messages"]
    expected_events = fixture["output"]["rawEvents"]
    expected_done_count = fixture["output"]["expectedDoneCount"]

    # When: Send request to backend
    actual_events = await send_sse_request(
        messages=input_messages,
        backend_url="http://localhost:8000/stream",
    )

    # Then: rawEvents should match expected
    is_match, diff_msg = compare_raw_events(
        actual=actual_events,
        expected=expected_events,
        normalize=True,  # Normalize dynamic fields
    )
    assert is_match, f"rawEvents mismatch:\\n{diff_msg}"

    # And: [DONE] count should match
    actual_done_count = count_done_markers(actual_events)
    assert actual_done_count == expected_done_count
```

## Helper Functions

**`helpers.py`** provides:

| Function | Purpose |
|----------|---------|
| `load_frontend_fixture()` | Load fixture JSON file |
| `send_sse_request()` | Send HTTP request to backend SSE endpoint |
| `send_bidi_request()` | Send WebSocket request (TODO: not yet implemented) |
| `count_done_markers()` | Count [DONE] markers in rawEvents |
| `normalize_event()` | Normalize dynamic fields (messageId, toolCallId) |
| `compare_raw_events()` | Compare actual vs expected with normalization |

## Dynamic Field Normalization

Backend generates dynamic values that change between runs:

- **messageId**: UUIDs like `"3bee2e30-c491-4e05-a471-4058e58806ee"`
- **toolCallId**: UUIDs like `"adk-37911c3c-a17d-4b80-83a9-c48d297b10a7"`

**Normalization** replaces these with placeholders:

- `messageId` → `"DYNAMIC_MESSAGE_ID"`
- `toolCallId` → `"adk-DYNAMIC_ID"`

This allows golden file comparison to focus on **event structure and content**, not random IDs.

## Multi-Turn Tool Handling

Multi-turn tools (e.g., `process_payment`, `get_location`) require 2 HTTP requests:

1. **Turn 1**: Initial user message → confirmation request → `[DONE]`
2. **Turn 2**: Approval/denial response → tool execution/rejection → `[DONE]`

**Current Test Coverage**:

- ✅ Tests verify **Turn 1 only** (confirmation request)
- ❌ Turn 2 requires separate HTTP request with approval response (not yet implemented)

**Fixture Structure**:

- Fixtures contain **both turns** (complete invocation)
- Tests extract Turn 1 events for comparison: `expected_events[:first_done_index + 1]`

**Future Enhancement**:

- Implement Turn 2 tests that send approval/denial response
- Verify complete 2-turn flow end-to-end

## ADR-0007 Verification

These tests provide **physical evidence** for [ADR-0007](../../../docs/adr/0007-approval-value-independence-in-auto-submit.md):

**Approved vs Denied fixtures**:

- `process_payment-approved-sse-baseline.json` (Turn 1)
- `process_payment-denied-sse-baseline.json` (Turn 1)

→ **Turn 1 events are IDENTICAL** (only Turn 2 differs)

This proves that approval timing does NOT depend on `approved: true/false` value.

## Running Tests

### Run all backend fixture tests:

```bash
just test tests/e2e/backend_fixture/
```

### Run specific test:

```bash
just test tests/e2e/backend_fixture/test_get_weather_sse_baseline.py
```

### Prerequisites:

1. **Backend server must be running**: `just dev` (starts backend at `localhost:8000`)
2. **Fixtures must be up-to-date**: Run E2E tests to generate latest fixtures

## Per CLAUDE.md Guidelines

- ✅ **No mocks** in E2E tests - uses real backend server
- ✅ **Given-When-Then** structure in all tests
- ✅ **One test per fixture** for clear traceability
- ✅ **Comments explain WHY** (e.g., ADR-0007 references)

## Future Work

### BIDI Mode Tests

- [ ] Implement `send_bidi_request()` using `websockets` library
- [ ] Remove `@pytest.mark.skip` from BIDI tests
- [ ] Create BIDI test files for all fixtures

### Multi-Turn Flow Tests

- [ ] Implement Turn 2 request helper (send approval/denial response)
- [ ] Add tests for complete 2-turn flows
- [ ] Verify Turn 1 → Turn 2 state transitions

### Additional Fixtures

- [ ] Audio output tests (`data-pcm` events)
- [ ] Audio input tests (`audio_control`, `audio_chunk` events)
- [ ] Image tests (`data-image` events)
- [ ] Multi-tool invocation tests (ADR-0004)

---

**Last Updated**: 2025-12-25
**Maintainer**: Review when fixtures are updated or backend behavior changes
