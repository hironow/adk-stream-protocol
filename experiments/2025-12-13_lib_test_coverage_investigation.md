# lib/ Test Coverage Investigation

**Date:** 2025-12-13
**Objective:** Systematic gap analysis for lib/ directory test coverage to identify missing edge cases and ensure production readiness
**Status:** 🟡 In Progress

---

## Background

After removing the custom `onToolApprovalRequest` callback and discovering how AI SDK v6 native handling works, we realized the importance of comprehensive testing to prevent similar architectural mistakes.

**Key Concern:**
- Critical functionality (`sendMessages()`, message event flow) has ZERO tests
- Current test count: Only 2 tests for 829-line implementation
- Risk: Production bugs in core WebSocket transport layer

**Investigation Goal:**
- Identify ALL missing test scenarios (edge cases, error paths, state transitions)
- Prioritize gaps by severity (Critical/High/Medium/Low)
- Create actionable test implementation plan
- Ensure no repeat of "missing functionality" discoveries

---

## Executive Summary

**Critical Findings:**

1. **websocket-chat-transport.ts**: 🔴 **SEVERE TEST GAP**
   - 829 LOC implementation, only 199 LOC tests (24% ratio)
   - **Only 2 tests** covering `sendToolResult()`
   - **ZERO tests** for core methods: `sendMessages()`, `reconnectToStream()`, message event flow
   - **ZERO tests** for connection lifecycle, error handling, audio streaming

2. **Other lib/ files**: 🟡 Need detailed analysis
   - build-use-chat-options.ts: 19 tests (appears OK but needs verification)
   - audio-context.tsx, audio-recorder.ts, use-audio-recorder.ts: Status unknown

3. **Integration tests**: 🟡 Good coverage but missing error scenarios
   - transport-integration.test.ts: 16 tests
   - use-chat-integration.test.tsx: 7 tests

**Recommended Action:**
- **Phase 1 (Week 1 Priority)**: Add 15-22 tests for `websocket-chat-transport.ts` critical path
- **Phase 2**: Add 14-20 tests for high-priority features
- **Phase 3**: Complete remaining gaps

---

## Detailed Analysis

| File | LOC (Impl) | LOC (Test) | Test Ratio | Current Tests | Status |
|------|------------|------------|------------|---------------|---------|
| websocket-chat-transport.ts | 829 | 199 | 24% | 2 tests | 🔴 Critical gaps |
| build-use-chat-options.ts | ? | ? | ? | 19 tests | 🟡 Needs review |
| audio-context.tsx | ? | ? | ? | ? tests | 🟡 Needs review |
| audio-recorder.ts | ? | ? | ? | ? tests | 🟡 Needs review |
| use-audio-recorder.ts | ? | ? | ? | ? tests | 🟡 Needs review |

**Integration Tests:**
- transport-integration.test.ts: 16 tests
- use-chat-integration.test.tsx: 7 tests

---

## 1. websocket-chat-transport.ts

### Public API (17 methods/operations)

**Constructor & Configuration:**
- ✅ constructor(config)
  - ❌ Missing: Invalid URL format
  - ❌ Missing: Missing required config fields
  - ❌ Missing: Invalid timeout values

**ChatTransport Interface (AI SDK v6):**
- ❌ sendMessages() - **CRITICAL - NOT TESTED**
  - Missing: Normal message send
  - Missing: Connection timeout
  - Missing: WebSocket connection failure
  - Missing: Message serialization error
  - Missing: Abort signal handling
  - Missing: Regenerate trigger vs submit-message trigger
- ❌ reconnectToStream() - **CRITICAL - NOT TESTED**
  - Missing: Successful reconnection
  - Missing: Failed reconnection
  - Missing: Multiple reconnection attempts

**Audio Control (BIDI Mode):**
- ❌ startAudio() - **NOT TESTED**
  - Missing: Start without active connection
  - Missing: Start when already started
  - Missing: AudioContext integration
- ❌ stopAudio() - **NOT TESTED**
  - Missing: Stop without active connection
  - Missing: Stop when not started
- ❌ sendAudioChunk() - **NOT TESTED**
  - Missing: Send valid PCM chunk
  - Missing: Send without active connection
  - Missing: Invalid chunk format
  - Missing: Latency callback integration

**Tool Execution:**
- ✅ sendToolResult() - PARTIALLY TESTED (2 tests)
  - ✅ Success case with result object
  - ✅ Error case with error status
  - ❌ Missing: Send without WebSocket connection
  - ❌ Missing: Invalid toolCallId format
  - ❌ Missing: Result serialization edge cases

**Connection Management:**
- ❌ interrupt() - **NOT TESTED**
  - Missing: User abort
  - Missing: Timeout abort
  - Missing: Error abort
  - Missing: Double interrupt
- ❌ close() - **NOT TESTED**
  - Missing: Clean closure
  - Missing: Close during active stream
  - Missing: Close after already closed

**Latency Monitoring (WebSocket Ping/Pong):**
- ❌ startPing() - **NOT TESTED** (private but important)
- ❌ stopPing() - **NOT TESTED** (private but important)
- ❌ handlePong() - **NOT TESTED** (private but important)
  - Missing: Latency calculation correctness
  - Missing: Callback invocation

---

### Event Handling

**Server-to-Client Events (via handleWebSocketMessage):**

**Phase 1: Text Events**
- ❌ text-start event
- ❌ text-delta event
- ❌ text-end event

**Phase 2: PCM Audio Events**
- ❌ data-pcm event
  - Missing: Valid PCM chunk processing
  - Missing: AudioContext integration
  - Missing: Latency tracking

**Phase 3: Tool Events**
- ❌ tool-input-available (tool call from backend)
- ❌ tool-output-available (tool result from backend)

**Phase 4: Tool Approval (NOW REMOVED - flows to AI SDK v6)**
- ✅ tool-approval-request flows through (verified by architecture fix)

**Phase 5: Metadata Events**
- ❌ finish event (turn completion)
  - Missing: Usage metadata extraction
  - Missing: Error metadata
  - Missing: Finish reason handling

**Error Handling:**
- ❌ Invalid SSE format
- ❌ Malformed JSON
- ❌ Unknown event type
- ❌ Event without required fields

---

### Connection Lifecycle

**States to Test:**
- ❌ CONNECTING → OPEN (successful connection)
- ❌ CONNECTING → CLOSED (connection failure)
- ❌ OPEN → MESSAGE FLOW (normal operation)
- ❌ OPEN → ERROR → CLOSED (connection error)
- ❌ OPEN → CLOSE → CLOSED (clean shutdown)
- ❌ Multiple rapid connect/disconnect cycles

**Edge Cases:**
- ❌ WebSocket connection timeout
- ❌ Network interruption during stream
- ❌ Server closes connection unexpectedly
- ❌ Client closes connection during active stream
- ❌ Reconnection during active stream

---

### Priority Assessment: websocket-chat-transport.ts

#### 🔴 Critical (Must Fix Immediately)

1. **sendMessages() - Core Functionality**
   - **Why Critical**: This is the PRIMARY method users call. Zero tests = production bugs guaranteed
   - **Missing Scenarios**:
     - Normal message send flow
     - Connection establishment
     - WebSocket message format
     - Error handling (connection failure, timeout)
     - Abort signal handling

2. **Message Event Flow (text-start, text-delta, text-end)**
   - **Why Critical**: Users see blank UI if text events broken
   - **Missing Scenarios**:
     - Text streaming from backend
     - Stream chunk assembly
     - Message state transitions

3. **Connection Lifecycle**
   - **Why Critical**: Connection failures = silent failures in production
   - **Missing Scenarios**:
     - CONNECTING → OPEN → MESSAGE
     - Error states and recovery
     - Close/cleanup behavior

#### 🟠 High (Should Fix Soon)

4. **reconnectToStream()**
   - **Why High**: Used for resuming streams, affects user experience
   - **Missing**: All reconnection scenarios

5. **Audio Streaming (data-pcm events)**
   - **Why High**: BIDI mode feature, affects multimodal experience
   - **Missing**: PCM chunk processing, AudioContext integration

6. **Tool Events (tool-input-available, tool-output-available)**
   - **Why High**: Function calling is core feature
   - **Missing**: Tool call flow verification

7. **interrupt()**
   - **Why High**: User abort functionality
   - **Missing**: All interrupt scenarios

#### 🟡 Medium (Can Wait)

8. **Audio Control Methods (startAudio, stopAudio, sendAudioChunk)**
   - **Why Medium**: Important for BIDI but has UI-level integration tests
   - **Missing**: Unit-level validation

9. **Latency Monitoring (Ping/Pong)**
   - **Why Medium**: Nice-to-have feature, not critical for functionality
   - **Missing**: Latency calculation tests

10. **close()**
    - **Why Medium**: Basic cleanup, but failures are usually obvious
    - **Missing**: Clean shutdown scenarios

---

## 2. build-use-chat-options.ts

### Current Test Coverage: 19 tests

Need to review test file to assess coverage:
- Configuration generation for each mode (gemini, adk-sse, adk-bidi)
- Transport creation logic
- chatId generation
- Edge cases for invalid configurations

**Status:** 🟡 Review needed - appears well-tested but need to verify edge cases

---

## 3. audio-context.tsx

**Status:** 🟡 Review needed

Need to analyze:
- AudioContext creation and management
- Voice channel operations
- PCM chunk buffering
- Error states

---

## 4. audio-recorder.ts

**Status:** 🟡 Review needed

Need to analyze:
- MediaRecorder integration
- PCM encoding
- State management
- Error handling

---

## 5. use-audio-recorder.ts

**Status:** 🟡 Review needed

Need to analyze:
- React hook lifecycle
- Recording state management
- Integration with audio-recorder.ts

---

## Integration Test Coverage

### transport-integration.test.ts (16 tests)

**Purpose:** Test buildUseChatOptions + Transport integration (2-component)

**Coverage:**
- ✅ WebSocketChatTransport creation for BIDI mode
- ✅ DefaultChatTransport for SSE/Gemini modes
- ✅ AudioContext passing
- ✅ Imperative control (startAudio, stopAudio, sendToolResult)
- ✅ Protocol conversion (http→ws, https→wss)
- ✅ Configuration validation

**Gaps:**
- ❌ Missing: Error scenarios (invalid URLs, connection failures)
- ❌ Missing: Transport lifecycle with actual message sending

### use-chat-integration.test.tsx (7 tests)

**Purpose:** Test buildUseChatOptions + Transport + useChat integration (3-component)

**Coverage:**
- ✅ Configuration acceptance by useChat
- ✅ Transport reference exposure
- ✅ Initial messages preservation
- ✅ chatId uniqueness across modes

**Gaps:**
- ❌ Missing: Actual message flow through useChat
- ❌ Missing: Tool approval flow (removed due to React lifecycle issues)
- ❌ Missing: Error scenarios

---

## Test Implementation Strategy

### Phase 1: Critical Path (websocket-chat-transport.ts)

**Week 1 Priority:**

1. **sendMessages() Core Flow** (5-8 tests)
   ```typescript
   describe("sendMessages()", () => {
     it("should establish WebSocket connection on first call")
     it("should send message event with correct format")
     it("should handle connection timeout")
     it("should handle connection failure")
     it("should handle abort signal")
     it("should stream text events to ReadableStream")
     it("should handle multiple sequential messages")
     it("should reuse connection for subsequent messages")
   })
   ```

2. **Message Event Processing** (6-8 tests)
   ```typescript
   describe("Message Events", () => {
     it("should process text-start event")
     it("should process text-delta event")
     it("should process text-end event")
     it("should assemble multi-chunk text stream")
     it("should handle malformed SSE format")
     it("should handle unknown event types gracefully")
   })
   ```

3. **Connection Lifecycle** (4-6 tests)
   ```typescript
   describe("Connection Lifecycle", () => {
     it("should transition CONNECTING → OPEN")
     it("should handle connection failure")
     it("should clean up on close")
     it("should handle unexpected server close")
   })
   ```

**Total Phase 1: ~15-22 tests**

### Phase 2: High Priority Features

4. **reconnectToStream()** (3-4 tests)
5. **Audio Streaming** (4-6 tests)
6. **Tool Events** (4-6 tests)
7. **interrupt()** (3-4 tests)

**Total Phase 2: ~14-20 tests**

### Phase 3: Medium Priority

8. **Audio Control Methods** (4-6 tests)
9. **Latency Monitoring** (2-3 tests)
10. **close()** (2-3 tests)

**Total Phase 3: ~8-12 tests**

### Phase 4: Other Files

11. Review and gap-fill other lib/ files based on detailed analysis

---

## Methodology

### Unit Test Principles

1. **Test Behavior, Not Implementation**
   - Focus on public API contracts
   - Verify observable outcomes
   - Don't test internal state unless critical

2. **Edge Cases Over Happy Path**
   - Connection failures, timeouts, invalid data
   - State transition edge cases
   - Error recovery paths

3. **Real Data Where Possible**
   - Use real SSE format messages
   - Use real WebSocket event payloads
   - Avoid overly mocked scenarios

4. **Given-When-Then Structure**
   - Clear test organization
   - Self-documenting test intent
   - Easy to maintain

### Integration Test Principles

1. **Test Component Boundaries**
   - 2-component: buildUseChatOptions + Transport
   - 3-component: buildUseChatOptions + Transport + useChat
   - Don't test framework internals (AI SDK v6)

2. **Real Dependencies Where Practical**
   - Use MockWebSocket for WebSocket
   - Use real AI SDK v6 useChat hook
   - Avoid excessive mocking

3. **Focus on Contract Validation**
   - Does output conform to AI SDK v6 protocol?
   - Do events flow correctly between components?
   - Are error states propagated properly?

---

## Next Steps

1. ✅ Complete this analysis document
2. ⏳ Discuss priorities with team
3. ⏳ Get approval for test implementation phases
4. ⏳ Implement Phase 1 tests (Critical Path)
5. ⏳ Review results and adjust strategy
6. ⏳ Continue with Phase 2-4 based on findings

---

## Questions for Discussion

1. **Test Coverage Target**: What's acceptable coverage % for lib/? (Recommendation: 80%+ for critical paths)

2. **Mock vs Real**: For WebSocket, should we:
   - Use MockWebSocket (current approach)
   - Use real WebSocket with test server
   - Mix both (unit = mock, integration = real)

3. **Integration Test Scope**: Should use-chat-integration tests:
   - Test actual message flow (complex React lifecycle)
   - Focus only on configuration/setup (current approach)
   - Mix both with different test suites

4. **Priority Adjustment**: Any changes to proposed phase priorities?

5. **Parallel Work**: Can we split test implementation across:
   - websocket-chat-transport.ts (most critical)
   - Other lib/ files (audio, build-use-chat-options)
   - Integration tests (transport-integration, use-chat-integration)

---

## References

- websocket-chat-transport.ts: 829 LOC, 17 public methods
- Current test: 199 LOC, 2 tests
- Critical gap: sendMessages(), reconnectToStream(), message event flow
- Integration tests: 23 tests total (transport-integration: 16, use-chat-integration: 7)
