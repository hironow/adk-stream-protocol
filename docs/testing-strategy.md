# テスト戦略

**最終更新**: 2024-12-24
**バージョン**: 1.0

このドキュメントでは、プロジェクト全体のテスト戦略、各テスト層の責任、モック戦略、ベストプラクティスを定義します。

---

## 📊 テスト構造の概要

### テストピラミッド

```
                  E2E Tests (12 files)
                 /                  \
            Integration Tests      Integration Tests
           (9 files in lib)        (3 files in app)
          /                                          \
    Unit Tests                                    Unit Tests
  (15 files in lib)                          (7 files in components)
```

### ディレクトリ構造

```
project/
├── app/tests/
│   └── integration/           # UI + lib 統合テスト (3 files)
├── components/tests/
│   └── unit/                  # React コンポーネント単体テスト (7 files)
└── lib/tests/
    ├── unit/                  # ビジネスロジック単体テスト (15 files)
    ├── integration/           # モード間統合テスト (9 files)
    ├── e2e/                   # エンドツーエンドテスト (12 files)
    └── shared-mocks/          # 共通モック (NEW)
        ├── websocket.ts
        ├── audio-context.ts
        └── index.ts
```

---

## 🎯 各層の責任

### 1. lib/tests/unit/ - ビジネスロジック単体テスト

**責任**:
- 純粋なビジネスロジックのテスト
- 関数レベルの詳細な検証
- エッジケース、エラーハンドリング

**テスト対象例**:
- `sendAutomaticallyWhen` ロジック
- `WebSocketChatTransport` クラス
- AudioContext, AudioRecorder
- ChunkLogger, ChunkPlayer

**モック戦略**:
- 最小限のモック (必要な外部依存のみ)
- WebSocket, AudioContext などは共通モックを使用

**命名規則**:
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

---

### 2. lib/tests/integration/ - モード間統合テスト

**責任**:
- 異なるモード・機能間の統合検証
- 複雑なシナリオのテスト
- クリティカルなロジック (無限ループ防止など) の検証

**テスト対象例**:
- `sendAutomaticallyWhen` の複雑なシナリオ
- BIDI flat structure
- SSE integration
- [DONE] marker baseline
- ChunkLogging transport

**モック戦略**:
- 一部のみモック (WebSocketは実際のインスタンス使用)
- MSWは使わない (integration層では不要)

**命名規則**:
```typescript
describe('sendAutomaticallyWhen - Infinite Loop Prevention', () => {
  it('CRITICAL: returns false after backend responds to prevent infinite loop', () => {
    // ...
  });
});
```

---

### 3. lib/tests/e2e/ - エンドツーエンドテスト

**責任**:
- 完全なユーザーフローのテスト
- 実際の React hooks (useChat) を使用
- 実際の transport 実装を使用
- バックエンド通信は MSW でモック

**テスト対象例**:
- BIDI mode: useChat + WebSocket + confirmation フロー
- SSE mode: useChat + fetch + confirmation フロー
- Frontend Execute パターン
- Multi-tool execution
- Audio control, error handling

**モック戦略**:
- MSW (WebSocket/HTTP interception)
- **実際の React hooks (useChat)**
- **実際の transport 実装**
- **実際のメッセージフロー**

**クリーンアップ重要事項**:
```typescript
// ❌ BAD: Manual cleanup in test
it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  // ...
  transport._close(); // テスト失敗時に呼ばれない！
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
  currentTransport = transport; // 登録
  // ...
  // Transport cleanup handled by afterEach
});
```

---

### 4. components/tests/unit/ - React コンポーネント単体テスト

**責任**:
- React コンポーネントの props/state/callback 検証
- UI レンダリングのテスト
- props → UI の関係を検証

**テスト対象例**:
- Chat: initialMessages, onMessagesChange
- Message: 各種 part types の表示
- ToolInvocation: approval UI とコールバック
- AudioPlayer, ImageDisplay, ImageUpload

**モック戦略**:
- WebSocket (MockWebSocket - 共通モック)
- 最小限の外部依存

**命名規則**:
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

---

### 5. app/tests/integration/ - UI統合テスト

**責任**:
- UI コンポーネント (Chat, Message, ToolInvocation) と lib の統合
- buildUseChatOptions との統合検証
- UI レンダリングとコールバックの検証

**テスト対象例**:
- Chat + buildUseChatOptions の統合
- sendAutomaticallyWhen のUI統合
- Message parts の表示
- ToolInvocation の approval フロー

**モック戦略**:
- WebSocket (MockWebSocket - 共通モック)
- AudioContext (createMockAudioContext - 共通モック)
- fetch (vi.fn)

**命名規則**:
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

---

## 🛠️ モック戦略

### 共通モックの使用

**場所**: `lib/tests/shared-mocks/`

**ルール**:
1. **常に共通モックを使用する** - 重複定義禁止
2. **import パスを統一する** - `@/lib/tests/shared-mocks` から import

**利用可能な共通モック**:

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

#### createMockAudioContext
```typescript
import { createMockAudioContext } from '@/lib/tests/shared-mocks';

vi.mock('@/lib/audio-context', () => ({
  useAudio: () => createMockAudioContext(),
}));
```

---

### モック戦略マトリクス

| 層 | WebSocket | AudioContext | fetch | MSW |
|---|---|---|---|---|
| **lib/tests/unit/** | 共通モック | 共通モック | - | ❌ |
| **lib/tests/integration/** | 実インスタンス | - | - | ❌ |
| **lib/tests/e2e/** | - | - | - | ✅ |
| **components/tests/unit/** | 共通モック | - | - | ❌ |
| **app/tests/integration/** | 共通モック | 共通モック | vi.fn | ❌ |

---

## 📋 ベストプラクティス

### 1. テスト構造 (Given-When-Then)

```typescript
it('should do something', () => {
  // Given: セットアップ
  const input = createTestData();

  // When: 実行
  const result = doSomething(input);

  // Then: 検証
  expect(result).toBe(expected);
});
```

### 2. クリーンアップの徹底

```typescript
// ✅ GOOD: afterEach で確実にクリーンアップ
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

### 3. エラーハンドリング

```typescript
// ✅ GOOD: WebSocket エラーハンドリング追加
client.addEventListener('error', (error) => {
  console.error('WebSocket error in test:', error);
});

client.addEventListener('close', (event) => {
  console.log('WebSocket closed:', event);
});
```

### 4. 非同期処理の待機

```typescript
// ✅ GOOD: waitFor で条件を待つ
await waitFor(
  () => {
    const lastMessage = result.current.messages[result.current.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
  },
  { timeout: 3000 }
);
```

### 5. act() の使用

```typescript
// ✅ GOOD: React state 更新を act() でラップ
await act(async () => {
  result.current.sendMessage({ text: 'Hello' });
});
```

---

## 🚫 アンチパターン

### 1. モックの重複定義

```typescript
// ❌ BAD: テストファイル内でモック定義
class MockWebSocket {
  // ...
}

// ✅ GOOD: 共通モックを使用
import { MockWebSocket } from '@/lib/tests/shared-mocks';
```

### 2. テスト内での try-catch

```typescript
// ❌ BAD: try-catch でエラーを隠す
it('should throw error', () => {
  try {
    doSomething();
    expect(true).toBe(false); // 到達しない
  } catch (error) {
    expect(error).toBeDefined();
  }
});

// ✅ GOOD: expect().toThrow() を使用
it('should throw error', () => {
  expect(() => doSomething()).toThrow();
});
```

### 3. 手動クリーンアップのみ

```typescript
// ❌ BAD: 手動クリーンアップのみ (失敗時に呼ばれない)
it('should work', async () => {
  const { transport } = buildUseChatOptions(...);
  // ...
  transport._close();
});

// ✅ GOOD: afterEach でクリーンアップ
afterEach(() => {
  currentTransport?._close();
});
```

---

## 📈 テストカバレッジ目標

### 現状 (2024-12-24)

| 層 | ファイル数 | テスト数 | 通過率 |
|---|---|---|---|
| app/tests/integration | 3 | 34 | 100% |
| components/tests/unit | 7 | 73 | 100% |
| lib/tests/unit | 15 | ~200 | 100% |
| lib/tests/integration | 9 | ~100 | 100% |
| lib/tests/e2e | 12 | ~158 | 100% |
| **合計** | **46** | **565** | **100%** |

### 目標

- **ユニットテスト**: 80%以上のコードカバレッジ
- **統合テスト**: クリティカルパスの100%カバー
- **E2Eテスト**: 主要ユーザーフローの100%カバー
- **フレーキーテスト**: 0件維持

---

## 🔄 テスト追加のワークフロー

### 新機能追加時

1. **ユニットテストを書く** (lib/tests/unit/)
   - ビジネスロジックを先にテスト
   - TDD: Red → Green → Refactor

2. **統合テストを書く** (lib/tests/integration/)
   - 複数モジュール間の連携をテスト

3. **E2Eテストを書く** (lib/tests/e2e/)
   - ユーザーフロー全体をテスト

4. **UIテストを書く** (components/tests/unit/, app/tests/integration/)
   - React コンポーネントのレンダリングをテスト

### バグ修正時

1. **再現テストを書く** (該当する層)
   - バグを再現する failing test を書く

2. **修正する**
   - テストがパスするように修正

3. **リグレッションテストとして保持**
   - 同じバグが再発しないことを保証

---

## 📚 参考資料

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [AI SDK v6 Testing Guide](https://sdk.vercel.ai/docs)

---

## 🔄 このドキュメントの更新

このドキュメントは、テスト戦略の変更に応じて更新してください。

**更新タイミング**:
- 新しいテスト層を追加したとき
- モック戦略を変更したとき
- ベストプラクティスを発見したとき
- アンチパターンを発見したとき

**更新方法**:
1. このファイルを編集
2. 変更履歴をコミットメッセージに記載
3. チームにレビュー依頼

---

**最終更新**: 2024-12-24
**次回レビュー予定**: 2025-01-24
