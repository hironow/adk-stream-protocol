# Testing Strategy

**Last Updated:** 2026-01-18

Comprehensive testing strategy for the ADK AI Data Protocol project.

---

## 🚀 Quick Start

### Running Tests (Unified Test Runner)

**推奨: justfile コマンドを使用**

```bash
# 全テスト（外部依存なし）- 最速、並列実行
just test-fast

# ユニットテストのみ
just test-unified-unit

# 統合テストのみ
just test-unified-integration

# E2Eテスト（バックエンドサーバー必要）
just test-unified-e2e

# フルスタックテスト（バックエンド + フロントエンド + ブラウザ必要）
just test-full-stack

# 全テスト
just test-unified-all
```

### 直接実行

**Backend (pytest)**:

```bash
# All tests
uv run pytest

# Specific layer
uv run pytest tests/unit/
uv run pytest tests/integration/
uv run pytest tests/e2e/
```

**Frontend (Vitest)**:

```bash
# All frontend tests
bun vitest run lib/tests/

# Specific layer
bun vitest run lib/tests/unit/
bun vitest run lib/tests/integration/
bun vitest run lib/tests/e2e/

# Component tests
bun vitest run components/
bun vitest run app/
```

**E2E (Playwright)**:

```bash
# Full E2E tests
bunx playwright test

# Interactive UI mode
bunx playwright test --ui
```

---

## 🏗️ Test Architecture

### Test Pyramid

```
                     E2E Tests
                /                    \
        Playwright (scenarios/)    pytest (tests/e2e/)
              |                          |
        Integration Tests          Integration Tests
    /                    \              |
lib/tests/integration  app/tests/  tests/integration/
      (Vitest)         integration  (pytest)
          |            (Vitest)          |
      Unit Tests                     Unit Tests
    /           \                        |
lib/tests/unit  components/tests/   tests/unit/
  (Vitest)         unit (Vitest)     (pytest)
```

**Legend / 凡例**:

- E2E Tests: エンドツーエンドテスト (Playwright/pytest)
- Integration Tests: 統合テスト (Vitest/pytest)
- Unit Tests: 単体テスト (Vitest/pytest)

### Test Layer Philosophy

**Unit Tests** - Fast, isolated, focused:

- Single function/class testing
- Minimal mocking
- High coverage (80%+)

**Integration Tests** - Cross-component verification:

- 2-3 components working together
- Real instances where possible
- Critical path coverage (100%)

**E2E Tests** - Full system validation:

- Complete user flows
- Real browser/server
- Major scenarios (100%)

---

## 🐍 Backend Tests (pytest)

### Directory Structure

```
tests/
├── unit/              # Backend unit tests (~19 files)
│   ├── test_stream_protocol.py
│   ├── test_bidi_event_handler.py
│   ├── test_adk_ag_tools.py
│   └── ...
├── integration/       # Backend integration tests (~8 files)
│   ├── test_bidi_confirmation_tool_input_events.py
│   ├── test_deferred_approval_flow.py
│   └── ...
├── e2e/               # Backend E2E tests
│   └── (see testing_E2E.md for details)
└── utils/             # Shared test utilities
```

### Unit Tests (tests/unit/)

**Scope**: Pure Python backend logic

**Test Targets**:

- `StreamProtocolConverter` - ADK ↔ AI SDK v6 conversion
- `BIDIEventHandler` / `BIDIEventSender` - WebSocket events
- `ADKAgTools` - ADK tool integration
- `FrontendToolService` - Frontend tool delegation
- `ChunkLogger` - Debug logging

**Mock Strategy**:

- Minimal mocking (external dependencies only)
- Use real Python objects
- Mock LLM responses via fixtures

**Example Pattern**:

```python
def test_stream_protocol_converts_text_delta():
    # given
    adk_event = create_text_event(delta="Hello")

    # when
    result = converter.convert(adk_event)

    # then
    assert result["type"] == "text-delta"
    assert result["delta"] == "Hello"
```

### Integration Tests (tests/integration/)

**Scope**: Cross-component backend integration

**Test Targets**:

- BIDI confirmation flow with real ADK `run_live()`
- Deferred approval patterns
- Frontend tool delegation with ADK
- Event sender/receiver integration

**Mock Strategy**:

- Use real ADK instances
- Mock LLM responses when needed
- Real WebSocket connections (in-memory)

**Example Pattern**:

```python
@pytest.mark.asyncio
async def test_bidi_confirmation_flow():
    # given
    adk_agent = create_real_adk_agent()

    # when
    result = await adk_agent.run_live(messages)

    # then
    assert result.status == "approval-requested"
```

### E2E Tests (tests/e2e/)

**See**: **[E2E Testing Guide](testing_E2E.md)** for complete documentation

**Quick Summary**:

- Golden file regression testing
- Fixture-based deterministic LLM behavior
- ChunkPlayer for recorded responses

---

## ⚛️ Frontend Tests (Vitest)

### Directory Structure

```
lib/tests/
├── unit/              # Frontend logic unit tests
│   ├── bidi-public-api.test.ts
│   ├── sse-public-api.test.ts
│   ├── chunk_logs-public-api.test.ts
│   └── ...
├── integration/       # Cross-mode integration tests
│   ├── sendAutomaticallyWhen-integration.test.ts
│   ├── bidi-flat-structure.test.ts
│   └── ...
├── e2e/               # Frontend E2E tests
│   └── (see testing_E2E.md for details)
└── shared-mocks/      # Centralized mock implementations
    ├── websocket.ts
    └── audio-context.ts

components/tests/
└── unit/              # React component unit tests
    ├── chat.test.tsx
    ├── message.test.tsx
    └── ...

app/tests/
└── integration/       # UI integration tests
    ├── chat-integration.test.tsx
    └── ...
```

### Unit Tests (lib/tests/unit/)

**Scope**: Pure business logic

**Test Targets**:

- `sendAutomaticallyWhen` logic
- `WebSocketChatTransport` class
- AudioContext, AudioRecorder
- ChunkLogger, ChunkPlayer

**Mock Strategy**:

- Minimal mocking (external dependencies only)
- Use shared mocks (`lib/tests/shared-mocks/`)

**Example Pattern**:

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

### Integration Tests (lib/tests/integration/)

**Scope**: Cross-mode/cross-feature integration

**Test Targets**:

- `sendAutomaticallyWhen` complex scenarios
- BIDI flat structure
- Chunk logging transport
- Infinite loop prevention (CRITICAL)

**Mock Strategy**:

- Partial mocking
- Real WebSocket instances
- No MSW (unnecessary at this layer)

**Critical Example** (Infinite Loop Prevention):

```typescript
it('CRITICAL: returns false after backend responds to prevent infinite loop', () => {
  // given
  const messages = [
    { role: 'user', content: 'test' },
    { role: 'assistant', content: '', toolInvocations: [confirmed_tool] },
  ];

  // when
  const result = sendAutomaticallyWhen({ messages });

  // then
  expect(result).toBe(false); // Must not auto-send again!
});
```

### E2E Tests (lib/tests/e2e/)

**See**: **[E2E Testing Guide](testing_E2E.md)** for complete documentation

**Quick Summary**:

- Complete user flows with `useChat`
- MSW for backend mocking
- Real React hooks and transports

### Component Tests (components/tests/unit/)

**Scope**: React component rendering and props

**Test Targets**:

- Chat component (message history, callbacks)
- Message component (part types display)
- ToolInvocation component (approval UI)
- Audio/Image components

**Mock Strategy**:

- Shared WebSocket mock
- Minimal external dependencies

**Example Pattern**:

```typescript
describe('Chat Component', () => {
  it('should pass initialMessages to buildUseChatOptions', () => {
    // given
    const initialMessages: UIMessage[] = [...];

    // when
    render(<Chat initialMessages={initialMessages} mode="gemini" />);

    // then
    expect(buildUseChatOptions).toHaveBeenCalledWith(
      expect.objectContaining({ initialMessages })
    );
  });
});
```

### UI Integration Tests (app/tests/integration/)

**Scope**: UI + lib integration

**Test Targets**:

- Chat + buildUseChatOptions integration
- Mode switching UI
- Message parts rendering

**Mock Strategy**:

- Shared WebSocket mock
- Shared AudioContext mock
- vi.fn for fetch

---

## 🎭 Mock Strategy

### Centralized Mocks

**Location**: `lib/tests/shared-mocks/`

**Rule**: Always use shared mocks, never inline definitions

### Available Mocks

**MockWebSocket** (`websocket.ts`):

```typescript
import { MockWebSocket } from '@/lib/tests/shared-mocks';

beforeEach(() => {
  global.WebSocket = MockWebSocket as any;
});
```

**createMockAudioContext** (`audio-context.ts`):

```typescript
import { createMockAudioContext } from '@/lib/tests/shared-mocks';

vi.mock('@/lib/audio-context', () => ({
  useAudio: () => createMockAudioContext(),
}));
```

### Mock Usage Matrix

| Test Layer | WebSocket | AudioContext | MSW |
|------------|-----------|--------------|-----|
| lib/tests/unit/ | Shared mock | Shared mock | ❌ |
| lib/tests/integration/ | Real instance | - | ❌ |
| lib/tests/e2e/ | - | - | ✅ |
| components/tests/unit/ | Shared mock | - | ❌ |
| app/tests/integration/ | Shared mock | Shared mock | ❌ |

**Legend / 凡例**:

- Shared mock: 共通モック使用
- Real instance: 実インスタンス使用
- MSW: Mock Service Worker 使用

---

## ✅ Best Practices

### 1. Given-When-Then Structure

```typescript
it('should do something', () => {
  // Given: Setup test data
  const input = createTestData();

  // When: Execute the operation
  const result = doSomething(input);

  // Then: Verify the outcome
  expect(result).toBe(expected);
});
```

### 2. Guaranteed Cleanup

```typescript
// ✅ GOOD: afterEach ensures cleanup even on failure
let currentTransport: any = null;

afterEach(() => {
  if (currentTransport) {
    try {
      currentTransport._close();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
    currentTransport = null;
  }
});

it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  currentTransport = transport; // Register for cleanup
  // Test logic...
});
```

**Why try-catch?** Cleanup failures shouldn't cascade to other tests.

### 3. Error Handling in Tests

```typescript
// ✅ GOOD: Handle WebSocket errors
client.addEventListener('error', (error) => {
  console.error('WebSocket error:', error);
});

client.addEventListener('close', (event) => {
  console.log('WebSocket closed:', event.code);
});
```

**Why?** Unhandled errors cause Vitest worker crashes.

### 4. Async Waiting

```typescript
// ✅ GOOD: Wait for conditions with waitFor
await waitFor(
  () => {
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
  },
  { timeout: 3000 }
);
```

### 5. React State Updates

```typescript
// ✅ GOOD: Wrap state updates with act()
await act(async () => {
  result.current.sendMessage({ text: 'Hello' });
});
```

---

## ❌ Anti-Patterns

### 1. Duplicate Mock Definitions

```typescript
// ❌ BAD: Inline mock
class MockWebSocket { /* ... */ }

// ✅ GOOD: Shared mock
import { MockWebSocket } from '@/lib/tests/shared-mocks';
```

**Why?** Duplicates create maintenance burden.

### 2. Manual Cleanup Only

```typescript
// ❌ BAD: Cleanup skipped on test failure
it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  // Test logic...
  transport._close(); // Never executed if test fails!
});

// ✅ GOOD: afterEach cleanup
afterEach(() => {
  currentTransport?._close();
});
```

**Impact**: Resource leaks → flaky tests → worker crashes

### 3. try-catch in Test Logic

```typescript
// ❌ BAD: try-catch hides errors
it('should throw', () => {
  try {
    doSomething();
    expect(true).toBe(false); // Never reached
  } catch (error) {
    expect(error).toBeDefined();
  }
});

// ✅ GOOD: Use expect().toThrow()
it('should throw', () => {
  expect(() => doSomething()).toThrow();
});
```

---

## 📊 Test Coverage

### Current Status

| Layer | Files | Tests | Pass Rate |
|-------|-------|-------|-----------|
| app/tests/integration | 3 | 34 | 100% |
| components/tests/unit | 7 | 73 | 100% |
| lib/tests/unit | 15 | ~200 | 100% |
| lib/tests/integration | 9 | ~100 | 100% |
| lib/tests/e2e | 12 | ~158 | 100% |
| tests/unit (Backend) | 19 | ~150 | 100% |
| tests/integration (Backend) | 8 | ~50 | 100% |
| **Total** | **73** | **~765** | **100%** |

### Coverage Goals

- **Unit**: 80%+ code coverage
- **Integration**: 100% critical path coverage
- **E2E**: 100% major user flow coverage
- **Flaky**: 0 maintained

---

## 🔄 Test Addition Workflow

### Adding New Features

**TDD (Red → Green → Refactor)**:

1. **Write unit tests** (lib/tests/unit/ or tests/unit/)
   - Test business logic first
   - Create failing test

2. **Implement feature**
   - Write minimum code to pass test

3. **Write integration tests** (lib/tests/integration/ or tests/integration/)
   - Test cross-module interactions

4. **Write E2E tests** (lib/tests/e2e/ or tests/e2e/)
   - Test complete user flows

5. **Write UI tests** (components/tests/unit/, app/tests/integration/)
   - Test React component rendering

### Fixing Bugs

1. **Write reproduction test**
   - Create failing test at appropriate layer

2. **Fix the bug**
   - Implement fix until test passes

3. **Keep as regression test**
   - Ensure bug doesn't reoccur

---

## 📚 References

- **[E2E Testing Guide](testing_E2E.md)** - Complete E2E testing documentation
- **[Architecture Overview](spec_ARCHITECTURE.md)** - System architecture
- **[Frontend Testing Structure](frontend_TESTING_VITEST.md)** - Vitest test organization

**External**:

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [pytest Documentation](https://docs.pytest.org/)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [AI SDK v6 Testing Guide](https://sdk.vercel.ai/docs)

---

## ⚠️ Known Issues

### msw WebSocket Cleanup Issue

`lib/tests/integration/` と `lib/tests/e2e/` では msw (Mock Service Worker) を使用した WebSocket モッキングを行っている。msw の WebSocket インターセプターは vitest のテスト終了後に完全にクリーンアップされない場合があり、Worker exit error (`uv__stream_destroy` assertion failure) が発生することがある。

**影響**: 全テストがパスしても、プロセス終了時に exit code 1 が返される。

**対応**: `scripts/run-vitest-e2e.sh` ラッパースクリプトがテスト結果を解析し、全テストがパスしていれば exit code 0 を返す。`just test-fast` 等の unified test runner はこのラッパーを自動的に使用する。

### Gemini Live API Flakiness

`tests/integration/` と `scenarios/` の一部のテストは Gemini Live API に依存しており、API のレスポンス遅延やエラーによりタイムアウトすることがある。

**対応**: `@pytest.mark.xfail(strict=False)` マーカーでフレーキーテストをマーク。テストがパスしても失敗してもテストスイート全体は成功扱いになる。

### Vitest Worker Fork Error

全テスト実行時 (`bunx vitest run`) に Worker fork error が発生し、一部のテストファイルがカウントされない場合がある。

```
Error: [vitest-pool]: Worker forks emitted error.
Caused by: Error: Worker exited unexpectedly
```

または libuv assertion failure:

```
Assertion failed: (!uv__io_active(&stream->io_watcher, POLLIN | POLLOUT)),
function uv__stream_destroy, file stream.c, line 456.
```

**原因**: E2E テストで使用する WebSocket や stream リソースが Vitest の fork 終了前に完全にクリーンアップされない場合に発生。テストロジック自体の問題ではなく、Node.js/libuv レベルの環境依存問題。

**症状**:

- `Test Files: 71 passed (73)` のようにファイル数が合わない
- `Errors: 1 error` または `Errors: 2 errors` が表示される
- ただし、テスト自体は全て pass している

**対処法**:

1. **テストをディレクトリ毎に分けて実行** (推奨):

   ```bash
   # Unit + Integration (安定)
   bunx vitest run lib/tests/unit/ lib/tests/integration/

   # E2E (安定)
   bunx vitest run lib/tests/e2e/

   # E2E Fixtures + Components + App (安定)
   bunx vitest run lib/tests/e2e-fixtures/ components/tests/ app/tests/
   ```

2. **並列度を下げて実行**:

   ```bash
   bunx vitest run --no-file-parallelism
   ```

3. **justfile コマンドを使用** (ラッパースクリプトが exit code を正しく処理):

   ```bash
   just test-fast
   ```

**確認方法**: 各ディレクトリで個別にテストを実行し、全テストが pass することを確認する。Worker error が出ても、テスト自体が pass していれば問題ない。

---

**Last Review**: 2026-01-19
