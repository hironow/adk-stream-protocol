# Tool Approval: AI SDK v6 Native Handling Investigation

**Date:** 2025-12-13
**Objective:** Investigate whether `onToolApprovalRequest` callback is necessary, or if AI SDK v6 handles tool approval natively via `addToolApprovalResponse`
**Status:** ✅ Complete

**Results:**
- Hypothesis: ✅ **CONFIRMED** - AI SDK v6 handles tool approval natively
- Action: ✅ **IMPLEMENTED** - Removed custom `onToolApprovalRequest` callback mechanism

---

## Background

During implementation of tool approval functionality, we added a custom `onToolApprovalRequest` callback to `WebSocketChatTransport`:

```typescript
interface WebSocketChatTransportConfig {
  url: string;
  onToolApprovalRequest?: (approval: {
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    args?: any;
  }) => void;
  // ...
}
```

This callback was invoked when `tool-approval-request` events were received from the backend:

```typescript
// Phase 4: Tool approval request events
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    this.config.onToolApprovalRequest({
      approvalId: chunk.approvalId,
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      args: chunk.args,
    });
  }
  return true; // Skip standard enqueue (not a useChat message)
}
```

**Key Issue**: We were filtering out `tool-approval-request` events with `return true`, preventing them from flowing through the `UIMessageChunk` stream to AI SDK v6.

---

## Hypothesis

**Original Assumption**:
- Custom callback needed to notify UI about tool approval requests
- `tool-approval-request` events are "custom" and shouldn't go to useChat

**New Hypothesis**:
- AI SDK v6 has native `addToolApprovalResponse` method
- Framework expects `tool-approval-request` events in `UIMessageChunk` stream
- Custom callback is unnecessary duplication

**Evidence**:
1. AI SDK v6 documentation shows `addToolApprovalResponse` method: https://v6.ai-sdk.dev/docs/announcing-ai-sdk-6-beta
2. Type definitions show `tool-approval-request` is a valid `UIMessageChunk` type
3. `UseChatHelpers` includes `addToolApprovalResponse` in its interface

---

## Investigation

### Phase 1: AI SDK v6 API Research

**Source**: `/Users/nino/workspace/r/oss/adk-ai-data-protocol/node_modules/ai/dist/index.d.ts`

**ChatTransport Interface**:
```typescript
interface ChatTransport<UI_MESSAGE extends UIMessage> {
  sendMessages: (options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk>>;

  reconnectToStream: (options: {
    chatId: string;
  } & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk> | null>;
}
```

**UIMessageChunk Type**:
```typescript
| {
    type: 'tool-approval-request';
    approvalId: string;
    toolCall: TypedToolCall<TOOLS>;
  }
```

**Key Finding**: `tool-approval-request` is a **standard** `UIMessageChunk` type, not a custom event!

**ChatAddToolApproveResponseFunction**:
```typescript
type ChatAddToolApproveResponseFunction = ({
  id,
  approved,
  reason
}: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;
```

**UseChatHelpers Interface** (from `@ai-sdk/react`):
```typescript
& Pick<AbstractChat<UI_MESSAGE>,
  'sendMessage' | 'regenerate' | 'stop' | 'resumeStream' |
  'addToolResult' | 'addToolOutput' | 'addToolApprovalResponse' |
  'status' | 'messages' | 'clearError'>
```

**Conclusion**: AI SDK v6 expects `tool-approval-request` events to flow through the stream and provides `addToolApprovalResponse()` for users to respond.

---

### Phase 2: Architecture Analysis

**Current (Incorrect) Flow**:
```
Backend → WebSocket → WebSocketChatTransport
                              ↓
                   tool-approval-request event
                              ↓
                    [FILTERED OUT - return true]
                              ↓
                   onToolApprovalRequest() callback
                              ↓
                           UI component
                              ↓
                   (Custom approval handling)
```

**Expected (Correct) Flow**:
```
Backend → WebSocket → WebSocketChatTransport
                              ↓
                   tool-approval-request event
                              ↓
                   [PASSED THROUGH to UIMessageChunk stream]
                              ↓
                         AI SDK v6 useChat
                              ↓
                   addToolApprovalResponse() available
                              ↓
                           UI component
                              ↓
              result.current.addToolApprovalResponse(id, approved)
```

**Key Difference**:
- ❌ Custom callback creates parallel path outside AI SDK v6
- ✅ Native handling integrates with useChat state and lifecycle

---

## Implementation Fix

### Changes Made

**1. Removed Custom Callback** (`lib/websocket-chat-transport.ts`):

**Before**:
```typescript
export interface WebSocketChatTransportConfig {
  url: string;
  onToolApprovalRequest?: (approval: {
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    args?: any;
  }) => void;
  timeout?: number;
  audioContext?: AudioContextValue;
  latencyCallback?: (latency: number) => void;
}
```

**After**:
```typescript
export interface WebSocketChatTransportConfig {
  url: string;
  timeout?: number;
  audioContext?: AudioContextValue;
  latencyCallback?: (latency: number) => void;
}
```

**2. Stopped Filtering Events** (`lib/websocket-chat-transport.ts:727-730`):

**Before**:
```typescript
// Phase 4: Tool approval request events
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    console.log("[Tool Approval] Received approval request:", chunk);
    this.config.onToolApprovalRequest({
      approvalId: chunk.approvalId,
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      args: chunk.args,
    });
  }
  return true; // Skip standard enqueue (not a useChat message) ← BUG!
}
```

**After**:
```typescript
// Phase 4: Tool approval request events
// AI SDK v6 handles tool-approval-request natively via UIMessageChunk stream
// The framework will call addToolApprovalResponse() when user approves/denies
// No special handling needed - just let it flow through to useChat
```

**3. Removed Parameter** (`lib/build-use-chat-options.ts`):

**Before**:
```typescript
export function buildUseChatOptions({
  mode,
  initialMessages,
  adkBackendUrl,
  forceNewInstance = false,
  audioContext,
  onToolApprovalRequest,  // ← Removed
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
  onToolApprovalRequest?: (approval: {  // ← Removed
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    args?: any;
  }) => void;
}): UseChatOptionsWithTransport
```

**After**:
```typescript
export function buildUseChatOptions({
  mode,
  initialMessages,
  adkBackendUrl,
  forceNewInstance = false,
  audioContext,
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
}): UseChatOptionsWithTransport
```

**4. Updated Tests**:
- Removed callback-related tests from `websocket-chat-transport.test.ts`
- Removed callback-related tests from `use-chat-integration.test.tsx`
- Removed callback-related tests from `transport-integration.test.ts`
- Removed callback-related tests from `build-use-chat-options.test.ts`

---

## Verification

### Test Results

All tests pass after removal of custom callback mechanism:

```
✓ lib/build-use-chat-options.test.ts (19 tests)
✓ lib/websocket-chat-transport.test.ts (2 tests)
✓ lib/transport-integration.test.ts (16 tests)
✓ lib/use-chat-integration.test.tsx (7 tests)

Test Files  4 passed (4)
     Tests  44 passed (44)
```

### Expected Usage Pattern

**UI Component** (example):
```typescript
import { useChat } from '@ai-sdk/react';
import { buildUseChatOptions } from './build-use-chat-options';

function ChatComponent() {
  const options = buildUseChatOptions({
    mode: 'adk-bidi',
    initialMessages: [],
    adkBackendUrl: 'http://localhost:8000',
  });

  const { messages, addToolApprovalResponse } = useChat(options.useChatOptions);

  // AI SDK v6 automatically handles tool-approval-request events
  // When user approves, call:
  const handleApprove = (approvalId: string) => {
    addToolApprovalResponse(approvalId, true);
  };

  const handleDeny = (approvalId: string, reason?: string) => {
    addToolApprovalResponse(approvalId, false, reason);
  };

  // ...
}
```

**Key Points**:
- No custom callback needed
- `addToolApprovalResponse` is provided by AI SDK v6
- Events flow naturally through useChat state
- Consistent with AI SDK v6 patterns

---

## Analysis

### Why Custom Callback Was Wrong

1. **Violates Single Responsibility**: Transport layer shouldn't handle UI concerns
2. **Duplicates Framework Features**: AI SDK v6 already provides `addToolApprovalResponse`
3. **Breaks Event Flow**: Filtering out events prevents framework from seeing them
4. **Inconsistent with Patterns**: Other event types (text-delta, tool-output-available) flow through normally

### Architectural Principles

**Transport Layer Responsibility**:
- Convert backend protocol to AI SDK v6 `UIMessageChunk` format
- Stream events to framework
- Handle bidirectional communication (WebSocket)

**NOT Transport Layer Responsibility**:
- Parse event semantics (tool approval, etc.)
- Invoke UI callbacks
- Manage application state

**AI SDK v6 Framework Responsibility**:
- Process `UIMessageChunk` events
- Update useChat state
- Provide imperative methods (`addToolApprovalResponse`, etc.)
- Manage UI lifecycle

---

## Conclusion

### Summary

The custom `onToolApprovalRequest` callback mechanism was **unnecessary and incorrect**:

1. ✅ AI SDK v6 handles tool approval natively via `addToolApprovalResponse`
2. ✅ `tool-approval-request` is a standard `UIMessageChunk` type
3. ✅ Events should flow through to framework, not be filtered out
4. ✅ Transport layer should not handle application-level logic

### Architecture After Fix

**Clean Separation of Concerns**:
- Backend: Sends `tool-approval-request` events via WebSocket
- Transport: Converts to `UIMessageChunk` and streams to framework
- AI SDK v6: Processes events, updates state, provides `addToolApprovalResponse`
- UI: Calls `addToolApprovalResponse()` when user approves/denies

**Benefits**:
- ✅ Consistent with AI SDK v6 patterns
- ✅ Simpler codebase (less custom logic)
- ✅ Better separation of concerns
- ✅ More maintainable (follows framework conventions)

### Lessons Learned

1. **Check framework capabilities first** before implementing custom solutions
2. **Don't filter events** unless you're certain they're not part of the protocol
3. **Follow framework patterns** - if AI SDK v6 provides a method, use it
4. **Transport layer is dumb pipe** - convert formats, don't interpret semantics

---

## Related Files

- `lib/websocket-chat-transport.ts` (Lines 169-181, 727-730)
- `lib/build-use-chat-options.ts` (Lines 65-89, 91-103)
- `node_modules/ai/dist/index.d.ts` (ChatTransport, UIMessageChunk definitions)
- `node_modules/@ai-sdk/react/dist/index.d.ts` (UseChatHelpers, addToolApprovalResponse)

---

## References

- AI SDK v6 Announcement: https://v6.ai-sdk.dev/docs/announcing-ai-sdk-6-beta
- AI SDK v6 Documentation: https://v6.ai-sdk.dev/
- Tool Approval API: `addToolApprovalResponse(id, approved, reason?)`
