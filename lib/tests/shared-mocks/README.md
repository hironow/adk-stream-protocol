# Shared Test Mocks

Centralized location for all test mocks to eliminate duplication and ensure consistent behavior across test layers.

## Purpose

This directory contains reusable mock implementations that are shared across:
- Unit tests (`lib/tests/unit/`)
- E2E tests (`lib/tests/e2e/`)
- Integration tests (`lib/tests/integration/`)

## Available Mocks

### MSW Server (`msw-server.ts`)

Provides a configured MSW server instance for HTTP and WebSocket request mocking.

**Usage:**
```typescript
import { createMswServer } from '@/lib/tests/shared-mocks/msw-server';

const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Alternative (with automatic lifecycle):**
```typescript
import { setupMswServer } from '@/lib/tests/helpers/msw-setup';

const server = setupMswServer(); // Automatically sets up beforeAll/afterEach/afterAll
```

### WebSocket Mock (`websocket.ts`)

Mock WebSocket implementation for testing WebSocket-based features.

**Usage:**
```typescript
import { MockWebSocket } from '@/lib/tests/shared-mocks';

// Your WebSocket mocking code here
```

### Audio Context Mock (`audio-context.ts`)

Mock Web Audio API for testing audio-related features without browser environment.

**Usage:**
```typescript
import { createMockAudioContext, setupAudioContextMock } from '@/lib/tests/shared-mocks';

// Create mock
const mockContext = createMockAudioContext();

// Or setup automatically for tests
setupAudioContextMock();
```

## Common Patterns

### BIDI WebSocket Testing

For testing ADK BIDI protocol with WebSocket, use helpers from `lib/tests/helpers/bidi-ws-handlers.ts`:

```typescript
import { createBidiWebSocketLink, createCustomHandler } from '@/lib/tests/helpers/bidi-ws-handlers';
import { createMswServer } from '@/lib/tests/shared-mocks/msw-server';

const server = createMswServer();
const chat = createBidiWebSocketLink();

server.use(
  createCustomHandler(chat, ({ server, client }) => {
    client.addEventListener('message', (event) => {
      // Handle WebSocket messages
      client.send('data: {"type": "text-delta", "delta": "Hello"}\n\n');
      client.send('data: [DONE]\n\n');
    });
  })
);
```

### SSE Response Testing

For testing SSE responses, use helpers from `lib/tests/helpers/sse-response-builders.ts`:

```typescript
import { createSseResponseBuilder } from '@/lib/tests/helpers/sse-response-builders';

// Build SSE responses
const sseBuilder = createSseResponseBuilder();
const response = sseBuilder.addTextDelta('Hello').finish();
```

## Directory Structure

```
lib/tests/
├── shared-mocks/          # Centralized mocks (this directory)
│   ├── README.md          # This file
│   ├── index.ts           # Exports all mocks
│   ├── msw-server.ts      # MSW server setup
│   ├── websocket.ts       # WebSocket mock
│   └── audio-context.ts   # Audio Context mock
├── helpers/               # Test helper functions
│   ├── bidi-ws-handlers.ts        # BIDI WebSocket handlers
│   ├── sse-response-builders.ts   # SSE response builders
│   ├── websocket-message-builders.ts
│   ├── msw-setup.ts               # MSW lifecycle helper
│   └── ...
├── e2e/                   # E2E tests using these mocks
├── integration/           # Integration tests
└── unit/                  # Unit tests
```

## Best Practices

### 1. Use Shared Mocks Instead of Inline Mocks

**Bad (inline mock):**
```typescript
const mockServer = setupServer(); // Duplicates setup logic
```

**Good (shared mock):**
```typescript
import { createMswServer } from '@/lib/tests/shared-mocks/msw-server';
const server = createMswServer();
```

### 2. Prefer Helper Functions for Common Patterns

Instead of manually creating WebSocket handlers, use helper functions:

**Bad (manual):**
```typescript
const chat = ws.link('ws://localhost:8000/live');
chat.addEventListener('connection', ({ client }) => {
  // ... complex setup
});
```

**Good (helper):**
```typescript
import { createBidiWebSocketLink, createTextResponseHandler } from '@/lib/tests/helpers/bidi-ws-handlers';

const chat = createBidiWebSocketLink();
server.use(createTextResponseHandler(chat, 'Hello', ' World'));
```

### 3. Clean Up After Tests

Always clean up mock state to prevent test pollution:

```typescript
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers()); // Reset between tests
afterAll(() => server.close());          // Clean up after suite
```

## Adding New Mocks

When adding a new shared mock:

1. **Create the mock file** in `lib/tests/shared-mocks/`
2. **Export it** from `index.ts`
3. **Document usage** in this README
4. **Update existing tests** to use the new shared mock
5. **Remove duplicate implementations** from individual test files

## Related Documentation

- [MSW Documentation](https://mswjs.io/)
- [AI SDK v6 Testing Guide](https://sdk.vercel.ai/docs/ai-sdk-core/testing)
- [`lib/tests/helpers/README.md`](../helpers/README.md) (if exists)

## Maintenance

- **Keep mocks simple and focused** - Each mock should have a single, clear responsibility
- **Avoid test-specific logic** - Mocks should be generic and configurable
- **Document breaking changes** - If a mock API changes, update this README and all affected tests
