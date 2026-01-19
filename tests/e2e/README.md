# E2E Tests

End-to-end tests for the ADK Stream Protocol.

These tests require an external backend server running on `localhost:8000`.

## Directory Structure

```
tests/e2e/
├── requires_server/  # Tests connecting to localhost:8000 (BIDI/SSE)
└── README.md
```

## Running E2E Tests

**Before running:**

```bash
# Start the backend server
just server
```

**Run tests:**

```bash
# Using just command
just test-py-e2e

# Or directly
uv run pytest tests/e2e/requires_server/ -n auto
```

## Protocol Coverage

| Protocol | Endpoint | Test Files |
|----------|----------|------------|
| BIDI | `ws://localhost:8000/live` | `*_bidi_*.py` |
| SSE | `http://localhost:8000/stream` | `*_sse_*.py` |

## Note

Tests that don't require an external server (TestClient, fixture validation) are located in `tests/integration/`.
