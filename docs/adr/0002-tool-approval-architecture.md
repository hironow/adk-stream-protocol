# 0002. Tool Approval Architecture with Backend Delegation

**Date:** 2025-12-13
**Status:** Accepted

## Context

When implementing tool approval flow for the ADK AI Data Protocol project, we needed to decide how to integrate AI SDK v6's tool calling features with our backend-delegated tool architecture. Specifically:

1. Tools are defined in the **backend (server.py)** for AI awareness, not in the frontend
2. Tool execution happens in the **frontend (browser APIs)** after user approval
3. We need bidirectional communication between backend and frontend
4. AI SDK v6 provides multiple tool-related APIs: `onToolCall`, `addToolOutput`, `addToolApprovalResponse`

The critical question was: **Which AI SDK v6 APIs should we use, and why?**

## Decision

We use AI SDK v6's **standard event streaming approach** with `addToolOutput` and `addToolApprovalResponse`, explicitly **NOT using `onToolCall` callback**.

### Architecture Pattern

**Backend (server.py):**

- Tools are defined as ADK Agent functions with `ToolContext`
- `FrontendToolDelegate` creates `asyncio.Future` and awaits frontend execution
- Tool functions: `await frontend_delegate.execute_on_frontend(...)`
- WebSocket handler resolves Future when receiving `tool-result` event

**Frontend (useChat):**

- Uses AI SDK v6 standard functions: `addToolOutput`, `addToolApprovalResponse`
- Does NOT use `onToolCall` callback
- Browser APIs execute after user approval: `AudioContext`, `Geolocation`, etc.

**Data Flow (Data Stream Protocol):**

```
1. Backend (server.py):
   - AI requests tool → ADK generates function_call
   - Tool function: await frontend_delegate.execute_on_frontend(...)
   - Awaits result from frontend (asyncio.Future)

2. Frontend (useChat):
   - Receives tool-call event (Data Stream Protocol)
   - Shows approval dialog
   - User approves → addToolApprovalResponse()
   - Executes browser API
   - Sends result → addToolOutput()

3. Backend (server.py):
   - Receives tool-result event (Data Stream Protocol via WebSocket)
   - FrontendToolDelegate.resolve_tool_result()
   - Future resolves → Tool function returns result
   - ADK continues with result
```

### Why NOT `onToolCall`

`onToolCall` is designed for **client-side local tool execution** where:

- Tools are defined only in frontend code
- Frontend executes tools independently
- No backend involvement needed

Our architecture is different:

- Tools are defined in **backend for AI awareness**
- Backend delegates execution to frontend
- Tool call events come **from backend** (not generated locally)

Using `onToolCall` would create architectural confusion between local and delegated execution.

### Why AI SDK v6 Native Handling

We explicitly **removed custom `onToolApprovalRequest` callback** that we initially implemented.

**Initial Wrong Pattern:**

```typescript
// ❌ WRONG - Custom callback pattern
interface WebSocketChatTransportConfig {
  onToolApprovalRequest?: (approval: { ... }) => void;
}

// ❌ WRONG - Filtering out events
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    this.config.onToolApprovalRequest({ ... });
  }
  return true; // Skip standard enqueue ← BUG!
}
```

**Correct Pattern:**

```typescript
// ✅ CORRECT - No custom callback needed
const { messages, addToolApprovalResponse } = useChat(useChatOptions);

// ✅ CORRECT - Let events flow through
// tool-approval-request is a standard UIMessageChunk type
```

**Key Insight:** `tool-approval-request` is a **standard AI SDK v6 event type**, not a custom event. It should flow through the transport layer to `useChat` naturally.

## Consequences

### Positive

1. **Framework Alignment**: Uses AI SDK v6 patterns correctly, not fighting the framework
2. **Separation of Concerns**: Transport layer is "dumb pipe" - converts formats, doesn't interpret semantics
3. **Maintainability**: Follows established patterns, easier for future developers
4. **Protocol Consistency**: Both ADK SSE and ADK BIDI use same Data Stream Protocol format
5. **Testability**: Integration tests can verify backend-frontend communication at protocol level

### Negative

1. **Learning Curve**: Developers must understand backend delegation pattern (different from typical client-side tool execution)
2. **Documentation Burden**: Need to clearly explain why we DON'T use `onToolCall` (counterintuitive for developers familiar with AI SDK v6)
3. **Debugging Complexity**: Tool execution spans backend ↔ frontend, requires understanding full data flow

### Neutral

1. **Transport Abstraction**: Works with both HTTP SSE and WebSocket, but requires careful protocol implementation
2. **Future Integration**: If AI SDK v6 adds native delegation patterns, we may need to migrate

## References

- Implementation: `server.py` (FrontendToolDelegate), `lib/build-use-chat-options.ts`
- Tests: `tests/integration/test_bidi_tool_approval.py`, `tests/integration/test_sse_tool_approval.py`
- Experiments: `experiments/2025-12-13_bidirectional_protocol_investigation.md`, `experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md`
