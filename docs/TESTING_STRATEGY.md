# Testing Strategy

**Last Updated:** 2024-12-24

This document defines the comprehensive testing strategy for the ADK AI Data Protocol project, including test layer responsibilities, mock strategies, and best practices for maintaining a reliable 565-test suite.

## Table of Contents

1. [Test Structure Overview](#test-structure-overview)
2. [Test Layer Responsibilities](#test-layer-responsibilities)
3. [Mock Strategy](#mock-strategy)
4. [Best Practices](#best-practices)
5. [Anti-Patterns](#anti-patterns)
6. [Test Coverage Status](#test-coverage-status)
7. [Test Addition Workflow](#test-addition-workflow)
8. [References](#references)

---

## Test Structure Overview

### Test Pyramid

```
                  E2E Tests (12 files)
                 /                  \
            Integration Tests      Integration Tests
           (9 files in lib)        (3 files in app)
          /                                          \
    Unit Tests                                    Unit Tests
  (15 files in lib)                          (7 files in components)
```

**Legend / 凡例:**

- E2E Tests: エンドツーエンドテスト
- Integration Tests: 統合テスト
- Unit Tests: 単体テスト

### Directory Structure

```
project/
├── app/tests/
│   └── integration/           # UI + lib integration tests (3 files)
├── components/tests/
│   └── unit/                  # React component unit tests (7 files)
└── lib/tests/
    ├── unit/                  # Business logic unit tests (15 files)
    ├── integration/           # Cross-mode integration tests (9 files)
    ├── e2e/                   # End-to-end tests (12 files)
    └── shared-mocks/          # Centralized mock implementations
        ├── websocket.ts       # MockWebSocket
        ├── audio-context.ts   # createMockAudioContext
        └── index.ts           # Re-exports
```

### Why No app/tests/e2e/ or components/tests/integration/?

**Rationale:**

- **lib/tests/e2e/** provides 95%+ coverage of user flows using real React hooks (useChat) and actual transport implementations
- **app/tests/integration/** already tests all component interactions from the consumer perspective
- **Component design is highly decoupled** via props/callbacks, reducing integration test necessity
- **Not a standalone component library** - consumer-focused tests are sufficient

Adding these layers would introduce Playwright/Cypress setup cost without significant value.

---

## Test Layer Responsibilities

### 1. lib/tests/unit/ - Business Logic Unit Tests

**Scope:**

- Pure business logic testing
- Function-level detailed verification
- Edge cases and error handling

**Test Targets:**

- `sendAutomaticallyWhen` logic
- `WebSocketChatTransport` class
- AudioContext, AudioRecorder, AudioWorkletManager
- ChunkLogger, ChunkPlayer

**Mock Strategy:**

- Minimal mocking (external dependencies only)
- Use shared mocks for WebSocket and AudioContext

**Naming Convention:**

```typescript
describe('sendAutomaticallyWhen', () => {
  it('should return true after confirmation approval', () => {
    // given
    const messages = [...];

    // when
    const result = sendAutomaticallyWhen({ messages });

    // then
    expect(result).toBe(true);
  });
});
```

**Key Files:**

- `lib/tests/unit/bidi-public-api.test.ts` (lib/bidi/send-automatically-when.ts:10)
- `lib/tests/unit/sse-public-api.test.ts` (lib/sse/send-automatically-when.ts:8)
- `lib/tests/unit/websocket-chat-transport.test.ts` (lib/bidi/transport.ts:142)
- `lib/tests/unit/audio-*.test.ts` (lib/audio-*.ts)

---

### 2. lib/tests/integration/ - Cross-Mode Integration Tests

**Scope:**

- Integration verification across different modes/features
- Complex scenario testing
- Critical logic testing (e.g., infinite loop prevention)

**Test Targets:**

- `sendAutomaticallyWhen` complex scenarios
- BIDI flat structure
- SSE integration
- [DONE] marker baseline
- ChunkLogging transport

**Mock Strategy:**

- Partial mocking (WebSocket uses real instances)
- No MSW (unnecessary at integration layer)

**Naming Convention:**

```typescript
describe('sendAutomaticallyWhen - Infinite Loop Prevention', () => {
  it('CRITICAL: returns false after backend responds to prevent infinite loop', () => {
    // ...
  });
});
```

**Key Files:**

- `lib/tests/integration/sendAutomaticallyWhen-integration.test.ts`
- `lib/tests/integration/bidi-flat-structure.test.ts`
- `lib/tests/integration/chunk-logging-transport.test.ts`

---

### 3. lib/tests/e2e/ - End-to-End Tests

**Scope:**

- Complete user flow testing
- Uses actual React hooks (useChat)
- Uses actual transport implementations
- Backend communication mocked via MSW

**Test Targets:**

- BIDI mode: useChat + WebSocket + confirmation flow
- SSE mode: useChat + fetch + confirmation flow
- Frontend Execute pattern
- Multi-tool execution
- Audio control and error handling

**Mock Strategy:**

- MSW (WebSocket/HTTP interception)
- **Real React hooks (useChat)**
- **Real transport implementations**
- **Real message flows**

**Critical Cleanup Pattern:**

```typescript
// ❌ BAD: Manual cleanup in test
it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  // ...
  transport._close(); // Not called when test fails!
});

// ✅ GOOD: afterEach cleanup
let currentTransport: any = null;

afterEach(() => {
  if (currentTransport) {
    try {
      currentTransport._close();
    } catch (error) {
      console.error('Error closing transport:', error);
    }
    currentTransport = null;
  }
});

it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  currentTransport = transport; // Register for cleanup
  // ...
  // Transport cleanup handled by afterEach
});
```

**Why This Pattern?**

Manual cleanup is skipped when tests fail, leading to resource leaks and Vitest worker crashes. The afterEach pattern ensures cleanup even on failure.

**Key Files:**

- `lib/tests/e2e/bidi-confirmation.e2e.test.tsx` (lib/bidi/transport.ts:142)
- `lib/tests/e2e/sse-confirmation.e2e.test.tsx` (lib/sse/transport.ts:85)
- `lib/tests/e2e/frontend-execute-bidi.e2e.test.tsx`
- `lib/tests/e2e/multi-tool-execution.e2e.test.tsx`

---

### 4. components/tests/unit/ - React Component Unit Tests

**Scope:**

- React component props/state/callback verification
- UI rendering tests
- Verify props → UI relationship

**Test Targets:**

- Chat: initialMessages, onMessagesChange
- Message: various part types display
- ToolInvocation: approval UI and callbacks
- AudioPlayer, ImageDisplay, ImageUpload

**Mock Strategy:**

- WebSocket (MockWebSocket - shared mock)
- Minimal external dependencies

**Naming Convention:**

```typescript
describe('Chat Component - Message History Preservation', () => {
  it('should pass initialMessages to buildUseChatOptions', () => {
    // given
    const initialMessages: UIMessage[] = [...];

    // when
    const options = buildUseChatOptions({ initialMessages, ... });

    // then
    expect(options.initialMessages).toEqual(initialMessages);
  });
});
```

**Key Files:**

- `components/tests/unit/chat.test.tsx` (components/chat.tsx:45)
- `components/tests/unit/message.test.tsx` (components/message.tsx:23)
- `components/tests/unit/tool-invocation.test.tsx` (components/tool-invocation.tsx:18)
- `components/tests/unit/audio-player.test.tsx` (components/audio-player.tsx:12)

---

### 5. app/tests/integration/ - UI Integration Tests

**Scope:**

- UI component (Chat, Message, ToolInvocation) + lib integration
- buildUseChatOptions integration verification
- UI rendering and callback verification

**Test Targets:**

- Chat + buildUseChatOptions integration
- sendAutomaticallyWhen UI integration
- Message parts display
- ToolInvocation approval flow

**Mock Strategy:**

- WebSocket (MockWebSocket - shared mock)
- AudioContext (createMockAudioContext - shared mock)
- fetch (vi.fn)

**Naming Convention:**

```typescript
describe('Chat Component Integration', () => {
  describe('Mode Integration', () => {
    it('should initialize with gemini mode', () => {
      // given
      const mode = 'gemini';

      // when
      render(<Chat mode={mode} />);

      // then
      expect(screen.getByTestId('chat-form')).toBeInTheDocument();
    });
  });
});
```

**Key Files:**

- `app/tests/integration/chat-integration.test.tsx` (app/chat/page.tsx:15)
- `app/tests/integration/message-integration.test.tsx`
- `app/tests/integration/tool-invocation-integration.test.tsx`

---

## Mock Strategy

### Centralized Mock Implementation

**Location:** `lib/tests/shared-mocks/`

**Rules:**

1. **Always use shared mocks** - no inline mock definitions
2. **Unified import path** - import from `@/lib/tests/shared-mocks`

### Available Shared Mocks

#### MockWebSocket

```typescript
import { MockWebSocket } from '@/lib/tests/shared-mocks';

beforeEach(() => {
  global.WebSocket = MockWebSocket as any;
});

afterEach(() => {
  global.WebSocket = originalWebSocket;
});
```

**Implementation:** lib/tests/shared-mocks/websocket.ts

**Features:**

- Simulates WebSocket connection lifecycle
- `simulateMessage()` helper for SSE format messages
- Tracks sent messages for verification

#### createMockAudioContext

```typescript
import { createMockAudioContext } from '@/lib/tests/shared-mocks';

vi.mock('@/lib/audio-context', () => ({
  useAudio: () => createMockAudioContext(),
}));
```

**Implementation:** lib/tests/shared-mocks/audio-context.ts

**Features:**

- Mocks audio input/output device management
- Provides voice and BGM channel mocks
- Tracks device ID changes

### Mock Strategy Matrix

| Layer | WebSocket | AudioContext | fetch | MSW |
|---|---|---|---|---|
| **lib/tests/unit/** | Shared mock | Shared mock | - | ❌ |
| **lib/tests/integration/** | Real instance | - | - | ❌ |
| **lib/tests/e2e/** | - | - | - | ✅ |
| **components/tests/unit/** | Shared mock | - | - | ❌ |
| **app/tests/integration/** | Shared mock | Shared mock | vi.fn | ❌ |

**Legend / 凡例:**

- Shared mock: 共通モック使用
- Real instance: 実インスタンス使用
- MSW: Mock Service Worker 使用

---

## Best Practices

### 1. Test Structure (Given-When-Then)

```typescript
it('should do something', () => {
  // Given: Setup
  const input = createTestData();

  // When: Execute
  const result = doSomething(input);

  // Then: Verify
  expect(result).toBe(expected);
});
```

### 2. Thorough Cleanup

```typescript
// ✅ GOOD: Guaranteed cleanup with afterEach
afterEach(() => {
  if (currentTransport) {
    try {
      currentTransport._close();
    } catch (error) {
      console.error('Error closing transport:', error);
    }
    currentTransport = null;
  }
  server.resetHandlers();
  vi.clearAllMocks();
});
```

**Why try-catch?** Cleanup failures shouldn't cascade to other tests.

### 3. Error Handling

```typescript
// ✅ GOOD: Add WebSocket error handling
client.addEventListener('error', (error) => {
  console.error('WebSocket error in test:', error);
});

client.addEventListener('close', (event) => {
  console.log('WebSocket closed:', event);
});
```

**Why?** Unhandled WebSocket errors cause Vitest worker crashes.

### 4. Async Waiting

```typescript
// ✅ GOOD: Wait for conditions with waitFor
await waitFor(
  () => {
    const lastMessage = result.current.messages[result.current.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
  },
  { timeout: 3000 }
);
```

### 5. Using act()

```typescript
// ✅ GOOD: Wrap React state updates with act()
await act(async () => {
  result.current.sendMessage({ text: 'Hello' });
});
```

---

## Anti-Patterns

### 1. Duplicate Mock Definitions

```typescript
// ❌ BAD: Inline mock definition
class MockWebSocket {
  // ...
}

// ✅ GOOD: Use shared mock
import { MockWebSocket } from '@/lib/tests/shared-mocks';
```

**Why?** Duplicates create maintenance burden and consistency issues.

### 2. try-catch in Tests

```typescript
// ❌ BAD: try-catch hides errors
it('should throw error', () => {
  try {
    doSomething();
    expect(true).toBe(false); // Unreachable
  } catch (error) {
    expect(error).toBeDefined();
  }
});

// ✅ GOOD: Use expect().toThrow()
it('should throw error', () => {
  expect(() => doSomething()).toThrow();
});
```

### 3. Manual Cleanup Only

```typescript
// ❌ BAD: Manual cleanup only (skipped on failure)
it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  // ...
  transport._close();
});

// ✅ GOOD: afterEach cleanup
afterEach(() => {
  currentTransport?._close();
});
```

**Impact:** Resource leaks lead to flaky tests and worker crashes.

---

## Test Coverage Status

### Current Status

| Layer | Files | Tests | Pass Rate |
|---|---|---|---|
| app/tests/integration | 3 | 34 | 100% |
| components/tests/unit | 7 | 73 | 100% |
| lib/tests/unit | 15 | ~200 | 100% |
| lib/tests/integration | 9 | ~100 | 100% |
| lib/tests/e2e | 12 | ~158 | 100% |
| **Total** | **46** | **565** | **100%** |

### Coverage Goals

- **Unit tests**: 80%+ code coverage
- **Integration tests**: 100% critical path coverage
- **E2E tests**: 100% major user flow coverage
- **Flaky tests**: 0 maintained

---

## Test Addition Workflow

### Adding New Features

1. **Write unit tests** (lib/tests/unit/)
   - Test business logic first
   - Follow TDD: Red → Green → Refactor

2. **Write integration tests** (lib/tests/integration/)
   - Test cross-module interactions

3. **Write E2E tests** (lib/tests/e2e/)
   - Test complete user flows

4. **Write UI tests** (components/tests/unit/, app/tests/integration/)
   - Test React component rendering

### Fixing Bugs

1. **Write reproduction test** (appropriate layer)
   - Create failing test that reproduces the bug

2. **Fix the bug**
   - Implement fix until test passes

3. **Keep as regression test**
   - Ensure bug doesn't reoccur

---

## References

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [AI SDK v6 Testing Guide](https://sdk.vercel.ai/docs)
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall architecture
- [E2E_GUIDE.md](./E2E_GUIDE.md) - E2E testing patterns
