# lib/tests/ テストディレクトリ構成

Frontend library (`lib/`) のテスト構成とヘルパー関数のドキュメント。

## ディレクトリ構成

```
lib/tests/
├── unit/                    # ユニットテスト (Public API)
│   ├── chunk_logs-public-api.test.ts
│   ├── bidi-public-api.test.ts
│   ├── sse-public-api.test.ts
│   └── ... (その他のユニットテスト)
├── integration/             # インテグレーションテスト
│   ├── chunk_logs-integration.test.ts
│   ├── sse-integration.test.ts
│   ├── sendAutomaticallyWhen-integration.test.ts
│   └── ... (その他の統合テスト)
├── e2e/                     # エンドツーエンドテスト
│   ├── chat-flow.e2e.test.ts
│   ├── tool-execution.e2e.test.ts
│   └── ... (その他のE2Eテスト)
├── helpers/                 # テストヘルパー関数
│   ├── sse-response-builders.ts
│   ├── websocket-message-builders.ts
│   └── ... (その他のヘルパー)
└── shared-mocks/            # 再利用可能なMock定義
    ├── msw-server.ts
    ├── websocket.ts
    └── audio-context.ts
```

## ユニットテスト (lib/tests/unit/)

Public API のみを使用したテスト。内部実装には依存しない。

### 特徴

- **Parametrized Tests**: `it.each()` パターンで複数シナリオを効率的にテスト
- **Public API Only**: `lib/*/index.ts` からexportされたAPIのみ使用
- **No Mocks**: 実際のクラスインスタンスを使用 (ネットワーク通信を除く)

### テストファイル

1. **chunk_logs-public-api.test.ts** (18 tests)
   - ChunkPlayer JSONL parsing and playback
   - ChunkLoggingTransport wrapper behavior
   - ChunkPlayerTransport fixture loading
   - chunkLogger singleton API

2. **bidi-public-api.test.ts** (15 tests)
   - buildUseChatOptions configuration
   - sendAutomaticallyWhen confirmation detection
   - WebSocketChatTransport creation
   - Audio context integration

3. **sse-public-api.test.ts** (23 tests)
   - buildUseChatOptions for both modes (gemini, adk-sse)
   - sendAutomaticallyWhen (adk-sse only)
   - Mode-specific behavior validation
   - Unified API naming verification

## インテグレーションテスト (lib/tests/integration/)

MSW (Mock Service Worker) とMockWebSocketを使用した通信層のテスト。

### 特徴

- **MSW**: HTTP/SSE リクエストをインターセプト
- **MockWebSocket**: WebSocket通信をシミュレート
- **Payload Validation**: リクエスト/レスポンスのペイロード検証
- **Confirmation Flow**: `adk_request_confirmation` フローの統合テスト

### テストファイル

1. **chunk_logs-integration.test.ts**
   - ChunkLoggingTransport wrapping with real transport
   - ChunkPlayer JSONL replay (fast-forward mode)
   - ChunkPlayerTransport fixture loading
   - chunkLogger sequence tracking

2. **sse-integration.test.ts**
   - Gemini mode HTTP SSE communication
   - ADK SSE mode with custom backend URL
   - Confirmation flow with MSW

3. **sendAutomaticallyWhen-integration.test.ts**
   - Tool approval auto-submit logic
   - Confirmation detection across modes

4. **bidi-flat-structure-integration.test.ts**
   - WebSocket message structure tests
   - BIDI protocol verification

## テストヘルパー (lib/tests/helpers/)

再利用可能なレスポンスビルダー関数。

### sse-response-builders.ts

SSE (Server-Sent Events) レスポンスを生成するヘルパー関数。

```typescript
import { createTextResponse, createAdkConfirmationRequest } from '@/lib/tests/helpers/sse-response-builders';

// Simple text response
server.use(
  http.post('/api/chat', () => {
    return createTextResponse('Hello', ' World');
  })
);

// Confirmation request
server.use(
  http.post('/stream', () => {
    return createAdkConfirmationRequest({
      id: 'orig-1',
      name: 'dangerous_operation',
      args: { param: 'value' },
    });
  })
);
```

**提供関数**:

- `createSseStreamResponse(chunks)` - SSE ストリームレスポンスを作成
- `createTextResponse(...textParts)` - テキストデルタレスポンス
- `createAdkConfirmationRequest(originalFunctionCall)` - 確認リクエスト

### websocket-message-builders.ts

WebSocket メッセージ (ADK BIDI protocol) を生成するヘルパー関数。

```typescript
import {
  createTextDeltaEvent,
  createBidiConfirmationRequest,
  createBidiEndOfTurnEvent
} from '@/lib/tests/helpers/websocket-message-builders';

// Simulate server messages
mockWebSocket.simulateMessage(JSON.stringify(createTextDeltaEvent('Hello')));
mockWebSocket.simulateMessage(JSON.stringify(createBidiEndOfTurnEvent()));
```

**提供関数**:

- `createBidiMessageEvent(content)` - メッセージイベント
- `createBidiToolUseEvent(id, name, input)` - ツール使用イベント
- `createBidiEndOfTurnEvent()` - ターン終了イベント
- `createBidiConfirmationRequest(originalFunctionCall)` - 確認リクエスト
- `createTextDeltaEvent(textDelta)` - テキストデルタイベント

## Mock定義 (lib/tests/shared-mocks/)

再利用可能なMock実装。

### msw-server.ts

MSW (Mock Service Worker) サーバーのセットアップ。

```typescript
import { createMswServer } from '@/lib/tests/shared-mocks/msw-server';

const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### websocket.ts

WebSocket のモック実装。インスタンストラッキング機能付き。

```typescript
import {
  MockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket
} from '@/lib/tests/shared-mocks/websocket';

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  originalWebSocket = installMockWebSocket();
});

afterEach(() => {
  restoreMockWebSocket(originalWebSocket);
});

// Get created instance
const mockWs = MockWebSocket.instances[0];
mockWs.simulateMessage('...');
```

**主要機能**:

- `MockWebSocket` class - WebSocket実装のモック
- `installMockWebSocket()` - グローバルWebSocketを置き換え
- `restoreMockWebSocket(original)` - 元のWebSocketに復元
- `MockWebSocket.instances[]` - 作成されたインスタンスの追跡

## 使用例

### ユニットテスト

```typescript
import { buildUseChatOptions } from '@/lib/chunk_logs';

describe('chunk_logs Public API', () => {
  it('creates ChunkLoggingTransport', () => {
    const transport = new ChunkLoggingTransport(mockDelegate, 'adk-sse');
    expect(transport).toBeDefined();
  });
});
```

### インテグレーションテスト (SSE)

```typescript
import { createMswServer } from '@/lib/tests/shared-mocks/msw-server';
import { createTextResponse } from '@/lib/tests/helpers/sse-response-builders';

const server = createMswServer();

beforeAll(() => server.listen());

it('handles SSE response', async () => {
  server.use(
    http.post('http://localhost/api/chat', () => {
      return createTextResponse('Hello', ' World');
    })
  );

  const { useChatOptions } = buildUseChatOptions({
    mode: 'gemini',
    initialMessages: [],
    apiEndpoint: 'http://localhost/api/chat',
  });

  const result = await useChatOptions.transport.sendMessages({...});
  // ... verify chunks
});
```

### インテグレーションテスト (WebSocket)

```typescript
import { installMockWebSocket, MockWebSocket } from '@/lib/tests/shared-mocks/websocket';
import { createTextDeltaEvent } from '@/lib/tests/helpers/websocket-message-builders';

beforeEach(() => installMockWebSocket());

it('handles WebSocket messages', async () => {
  const { useChatOptions } = buildUseChatOptions({...});

  const sendPromise = useChatOptions.transport.sendMessages({...});

  await new Promise(resolve => setTimeout(resolve, 10));

  const mockWs = MockWebSocket.instances[0];
  mockWs.simulateMessage(JSON.stringify(createTextDeltaEvent('Hello')));

  const result = await sendPromise;
  // ... verify chunks
});
```

## テスト実行

```bash
# すべてのユニットテスト
bunx vitest run lib/tests/unit/

# すべてのインテグレーションテスト
bunx vitest run lib/tests/integration/

# 特定のテストファイル
bunx vitest run lib/tests/unit/chunk_logs-public-api.test.ts

# Watch mode
bunx vitest lib/tests/unit/
```

## 注意事項

### MSW使用時

- Node.js環境では**完全なURLが必要** (`http://localhost/api/chat`)
- 相対パス (`/api/chat`) は動作しない
- `apiEndpoint` オプションで完全なURLを指定

### MockWebSocket使用時

- `MockWebSocket.instances[]` で作成されたインスタンスにアクセス
- `beforeEach` で `installMockWebSocket()` を呼び出す
- `afterEach` で `restoreMockWebSocket()` で復元

### Parametrized Tests

```typescript
it.each<{ mode: Mode; expected: boolean }>([
  { mode: 'adk-bidi', expected: true },
  { mode: 'adk-sse', expected: true },
  { mode: 'gemini', expected: false },
])('$mode mode test', ({ mode, expected }) => {
  // test implementation
});
```
