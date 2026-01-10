# Frontend E2E Tests (lib/tests/e2e)

**Purpose:** End-to-end testing of frontend components using **MSW (Mock Service Worker)** for backend simulation.

## Important: These are NOT True E2E Tests

Despite the `e2e/` directory name, **these tests use mocks** and are more accurately described as **frontend integration tests** or **mock-based E2E tests**.

### Why "E2E" is Misleading

**True E2E Tests (scenarios/):**
- Real backend server running
- Real WebSocket/HTTP connections
- Real database and external services
- Full system integration
- Located in: `scenarios/`

**These Tests (lib/tests/e2e/):**
- Mock backend using MSW
- Simulated WebSocket/HTTP responses
- No real backend required
- Frontend-focused integration testing
- Located in: `lib/tests/e2e/`

## Mock Usage

All tests in this directory use **MSW (Mock Service Worker)** to simulate backend responses:

### SSE Mode Tests
- Mock HTTP POST `/stream` endpoint
- Simulate Server-Sent Events responses
- Control exact SSE chunk sequences
- Test frontend SSE handling logic

**Example:**
```typescript
import { http } from 'msw';
import { createMswServer } from '../shared-mocks/msw-server';

const server = createMswServer();

server.use(
  http.post('http://localhost:8000/stream', async () => {
    // Return simulated SSE stream
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  })
);
```

### BIDI Mode Tests
- Mock WebSocket connections using `msw/node` ws API
- Simulate bidirectional WebSocket messages
- Control message timing and sequences
- Test frontend BIDI protocol handling

**Example:**
```typescript
import { createBidiWebSocketLink, createCustomHandler } from '../helpers/bidi-ws-handlers';

const chat = createBidiWebSocketLink();

server.use(
  createCustomHandler(chat, ({ client }) => {
    client.addEventListener('message', (event) => {
      // Simulate backend WebSocket responses
      client.send('data: {"type": "text-delta", "delta": "Hello"}\\n\\n');
    });
  })
);
```

## Directory Purpose

This directory tests **frontend protocol implementations** in isolation:

1. **SSE Protocol (`lib/sse/`):**
   - HTTP SSE request/response handling
   - Stream parsing and state management
   - addToolApprovalResponse() API

2. **BIDI Protocol (`lib/bidi/`):**
   - WebSocket bidirectional communication
   - Message serialization/deserialization
   - Tool approval flow in BIDI mode

3. **useChat Hook Integration:**
   - AI SDK v6 useChat integration
   - Message state management
   - Tool approval UI state transitions

## Test Categories

### Protocol Tests
- `frontend-execute-sse.e2e.test.tsx` - SSE Frontend Execute pattern
- `frontend-execute-bidi.e2e.test.tsx` - BIDI Frontend Execute pattern
- `sse-use-chat.e2e.test.tsx` - SSE useChat integration
- `bidi-use-chat.e2e.test.tsx` - BIDI useChat integration

### Feature Tests
- `process-payment-double*.e2e.test.tsx` - Multi-tool approval scenarios
- `multi-tool-execution-e2e.test.tsx` - Parallel tool execution
- `bidi-sequential-only-execution.e2e.test.tsx` - Sequential execution verification (ADR 0003)
- `protocol-comparison-sse-vs-bidi.e2e.test.tsx` - Protocol difference verification (ADR 0003)

### Event & Stream Tests
- `bidi-event-receiver.e2e.test.tsx` - BIDI event handling
- `chunk-logging-e2e.test.tsx` - Chunk logging functionality

## When to Add Tests Here

Add tests to `lib/tests/e2e/` when:
- Testing frontend protocol logic in isolation
- Needing precise control over backend responses
- Testing edge cases requiring specific message sequences
- Testing frontend error handling without backend dependency

**Do NOT add tests here when:**
- Testing full system integration → Use `scenarios/`
- Testing backend logic → Use `tests/e2e/backend_fixture/`
- Testing single components → Use `lib/tests/unit/`

## Shared Resources

### Mocks
- `lib/tests/shared-mocks/` - Centralized mock implementations
- `lib/tests/helpers/` - Test helper functions (SSE/BIDI handlers)

See: `lib/tests/shared-mocks/README.md` for mock usage details

### Fixtures
Tests use MSW to simulate backend responses with precise control over:
- Message timing (delays, race conditions)
- Error scenarios (network failures, malformed data)
- Edge cases (empty responses, partial streams)
- Protocol compliance (SSE format, WebSocket frames)

## Naming Convention Consideration

**Current name:** `lib/tests/e2e/`
**Proposed alternative:** `lib/tests/frontend-e2e/` or `lib/tests/mock-e2e/`

The current name `e2e/` may be misleading since true E2E tests are in `scenarios/`. Consider renaming to clarify that these tests use mocks.

## Relationship to Other Test Directories

```
lib/tests/
├── e2e/              ← YOU ARE HERE (mock-based frontend E2E)
├── integration/      ← Component integration (smaller scope)
├── unit/             ← Isolated unit tests
├── shared-mocks/     ← Centralized mocks
└── helpers/          ← Test utilities

scenarios/            ← True E2E tests (real backend)

tests/                ← Backend tests (Python)
├── e2e/backend_fixture/  ← Backend E2E tests
├── integration/          ← Backend integration tests
└── unit/                 ← Backend unit tests
```

## Best Practices

1. **Use Shared Mocks:** Import from `../shared-mocks/` instead of creating inline mocks
2. **Leverage Helpers:** Use `../helpers/bidi-ws-handlers.ts` and `../helpers/sse-response-builders.ts`
3. **Clean Up:** Always call `server.resetHandlers()` in `afterEach`
4. **Isolate Tests:** Each test should be independent
5. **Document Mock Behavior:** Add comments explaining why specific mock responses are used

## Running These Tests

```bash
# Run all lib E2E tests
bun test:lib:e2e

# Run all lib tests (includes e2e, integration, unit)
bun test:lib

# Run specific test file
bunx vitest run lib/tests/e2e/frontend-execute-sse.e2e.test.tsx
```

## Future Consideration

The name `e2e/` should potentially be changed to `frontend-e2e/` or `mock-e2e/` to better reflect that these tests use mocks, distinguishing them from true E2E tests in `scenarios/`.
