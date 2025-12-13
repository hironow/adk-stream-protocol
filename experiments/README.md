# Experiments

This directory contains research, preliminary experiments, and exploratory implementations for the ADK AI Data Protocol project.

## Experiment Index

### 🟡 In Progress

| Date | Experiment | Status | Objective | Current Progress |
|------|-----------|--------|-----------|------------------|
| 2025-12-13 | [lib/ Test Coverage Investigation](./2025-12-13_lib_test_coverage_investigation.md) | 🟡 In Progress | Systematic gap analysis for lib/ test coverage to identify missing edge cases | Phase 1-3 Complete + Bug 1 Fixed (163 tests passing) |
| 2025-12-12 | [ADK Field Mapping Completeness](./2025-12-12_adk_field_mapping_completeness.md) | 🟡 In Progress | Systematic review of all ADK Event/Part fields and their mapping to AI SDK v6 protocol | 4/5 Priority fields complete, Part.fileData remaining |

### ⚪ Planned

_No planned experiments_

### 🟢 Complete

| Date | Experiment | Status | Objective | Result |
|------|-----------|--------|-----------|--------|
| 2025-12-14 | [ADK Field Parametrized Test Coverage](./2025-12-14_adk_field_parametrized_test_coverage.md) | 🟢 Complete | Implement comprehensive parametrized test coverage for all IMPLEMENTED fields in field_coverage_config.yaml | ✅ **SUCCESS** - 100% field coverage achieved (12/12 Event fields, 7/7 Part fields), added 12 new parametrized tests (8 Python + 4 TypeScript), all critical gaps resolved |
| 2025-12-14 | [Analysis Target Verification](./2025-12-14_analysis_target_verification.md) | 🟢 Complete | Verify code-based analysis targets for ADK field coverage tracking | ✅ **SUCCESS** - Confirmed stream_protocol.py + server.py as correct targets, excluded ai_sdk_v6_compat.py (reverse conversion), improved regex patterns |
| 2025-12-12 | [Audio Stream Completion Notification + Frontend Recording](./2025-12-12_audio_stream_completion_notification.md) | 🟢 Complete | Implement frontend notification when audio streaming completes + add audio recording for message replay ([ST-1]) | ✅ **SUCCESS** - Audio completion callback working, PCM buffering implemented, WAV conversion complete, HTML5 audio playback integrated |
| 2025-12-12 | [AudioWorklet Investigation](./2025-12-12_audio_worklet_investigation.md) | 🟢 Complete | Fix audio playback restart bug and implement low-latency PCM streaming | ✅ **SUCCESS** - AudioWorklet-based player with ring buffer, dual-path routing (audio + UI), WebSocket latency monitoring |
| 2025-12-13 | [Per-Connection State Management Investigation](./2025-12-13_per_connection_state_management_investigation.md) | 🟢 Complete | Investigate ADK recommended patterns for per-user/per-connection state management | ✅ **SUCCESS** - Connection-specific FrontendToolDelegate with session.state isolation, 8/8 tests passing |
| 2025-12-12 | [ADK BIDI Message History & Function Calling](./2025-12-12_adk_bidi_message_history_and_function_calling.md) | 🟢 Complete | Investigate message history preservation and function calling response issues in BIDI mode | ✅ Message history working correctly, output_transcription support implemented, native-audio model behavior documented |
| 2025-12-11 | [E2E Test Timeout Investigation](./2025-12-11_e2e_test_timeout_investigation.md) | 🟢 Complete | Fix AI SDK v6 endpoint switching bug causing E2E test failures | ✅ **RESOLVED** - Manual DefaultChatTransport creation with prepareSendMessagesRequest hook |
| 2025-12-11 | [ADK BIDI Multimodal Support](./2025-12-11_adk_bidi_multimodal_support.md) | 🟢 Complete | Investigate and implement ADK BIDI mode's multimodal capabilities (images, audio, video) | ✅ **SUCCESS** - Image support complete, AudioWorklet PCM streaming working, dual-path routing implemented |
| 2025-12-11 | [ADK BIDI + AI SDK v6 Integration](./2025-12-11_adk_bidi_ai_sdk_v6_integration.md) | 🟢 Complete | Investigate compatibility between AI SDK v6 useChat and ADK BIDI mode for bidirectional streaming | ✅ **SUCCESS** - Full BIDI integration working with WebSocket transport, tool calling functional |
| 2025-12-13 | [Bidirectional Protocol Investigation](./2025-12-13_bidirectional_protocol_investigation.md) | 🟢 Complete | Phase 4 Tool Approval - Client-side tool execution with user approval | ✅ **SUCCESS** - Awaitable delegation pattern implemented, AI SDK v6 standard API integration |
| 2025-12-13 | [Tool Approval AI SDK Native Handling](./2025-12-13_tool_approval_ai_sdk_native_handling.md) | 🟢 Complete | Investigate whether onToolApprovalRequest callback is necessary or AI SDK v6 handles it natively | ✅ **CONFIRMED** - Removed custom callback, AI SDK v6 addToolApprovalResponse is native |

## Critical Architecture Decisions

### Phase 4: Tool Approval Architecture (2025-12-13)

**CRITICAL UNDERSTANDING - DO NOT FORGET:**

#### Why `onToolCall` is NOT Used

**Frontend uses AI SDK v6 standard API:**

```typescript
const { messages, addToolOutput, addToolApprovalResponse } = useChat(useChatOptions);
```

**NOT:**

```typescript
const { onToolCall } = useChat({ ... }); // ❌ We don't use this
```

**Reason:**

- `onToolCall` is for **client-side local tool execution** (tools defined only in frontend)
- Our tools are defined in **backend (server.py)** for AI awareness
- Backend **delegates execution** to frontend, not frontend executing independently
- Tool call events come **from backend** → Frontend receives and executes → Sends results back

#### Data Flow (Data Stream Protocol)

```
1. Backend (server.py):
   - AI requests tool → ADK generates function_call
   - Tool function: await frontend_delegate.execute_on_frontend(...)
   - Awaits result from frontend (asyncio.Future)

2. Frontend (useChat):
   - Receives tool-call event (Data Stream Protocol)
   - Shows approval dialog
   - User approves → addToolApprovalResponse()
   - Executes browser API (AudioContext, Geolocation)
   - Sends result → addToolOutput()

3. Backend (server.py):
   - Receives tool-result event (Data Stream Protocol via WebSocket)
   - FrontendToolDelegate.resolve_tool_result()
   - Future resolves → Tool function returns result
   - ADK continues with result
```

#### Key Components

**Backend (server.py):**

- `FrontendToolDelegate`: Creates asyncio.Future, awaits frontend execution
- `change_bgm`, `get_location`: async tools with ToolContext
- WebSocket handler: Resolves Future when tool-result received

**Frontend:**

- Uses AI SDK v6 **standard functions**: `addToolOutput`, `addToolApprovalResponse`
- Does NOT use `onToolCall` callback
- Browser APIs execute after approval: `audioContext.switchTrack()`, `navigator.geolocation.getCurrentPosition()`

**Why This Works:**

- `addToolOutput()` sends Data Stream Protocol `tool-result` event
- Both ADK SSE and ADK BIDI use **same protocol format**
- Transport layer (HTTP SSE vs WebSocket) is abstracted
- Backend server.py processes events uniformly

**Reference:** experiments/2025-12-13_bidirectional_protocol_investigation.md

---

### Tool Approval: AI SDK v6 Native Handling (2025-12-13)

**CRITICAL UNDERSTANDING - DO NOT FORGET:**

#### Why Custom `onToolApprovalRequest` Callback Was Wrong

**We Previously Had:**

```typescript
// ❌ WRONG - Custom callback pattern
interface WebSocketChatTransportConfig {
  onToolApprovalRequest?: (approval: {
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    args?: any;
  }) => void;
}

// ❌ WRONG - Filtering out events
if (chunk.type === "tool-approval-request") {
  if (this.config.onToolApprovalRequest) {
    this.config.onToolApprovalRequest({ ... });
  }
  return true; // Skip standard enqueue ← BUG!
}
```

**Correct Pattern (AI SDK v6 Native):**

```typescript
// ✅ CORRECT - No custom callback needed
const { messages, addToolApprovalResponse } = useChat(useChatOptions);

// ✅ CORRECT - Let events flow through
// tool-approval-request is a standard UIMessageChunk type
// AI SDK v6 handles it natively
```

#### Key Insights

1. **`tool-approval-request` is Standard Protocol**
   - Part of AI SDK v6 `UIMessageChunk` type definition
   - NOT a custom event that needs special handling
   - Should flow through `ChatTransport` stream to `useChat`

2. **AI SDK v6 Provides Native Method**
   - `addToolApprovalResponse(approvalId, approved, reason?)` is built-in
   - Framework manages state, lifecycle, and event flow
   - No custom callback mechanism needed

3. **Transport Layer Responsibility**
   - Convert backend protocol → AI SDK v6 `UIMessageChunk` format
   - Stream events to framework (don't interpret semantics)
   - Handle bidirectional communication (WebSocket)
   - **NOT**: Parse application logic, invoke UI callbacks, manage state

4. **Why Filtering Was a Bug**
   - Prevented AI SDK v6 from seeing tool approval requests
   - Created parallel path outside framework lifecycle
   - Violated separation of concerns (transport doing UI work)
   - Inconsistent with other event types (text-delta flows through normally)

#### Architecture Comparison

**Before (Incorrect):**

```
Backend → WebSocket → Transport → [FILTER OUT] → Custom callback → UI
                                       ↓
                                  [Lost Event]
                                       ↓
                              AI SDK v6 never sees it
```

**After (Correct):**

```
Backend → WebSocket → Transport → [PASS THROUGH] → AI SDK v6 useChat
                                                           ↓
                                              addToolApprovalResponse()
                                                           ↓
                                                          UI
```

#### Lessons Learned

1. **Check Framework Capabilities First**
   - Don't implement custom solutions without investigating framework APIs
   - AI SDK v6 documentation shows `addToolApprovalResponse` exists
   - Type definitions reveal `tool-approval-request` is standard

2. **Transport Layer is Dumb Pipe**
   - Convert formats, don't interpret semantics
   - Let framework handle application-level logic
   - Follow protocol specifications exactly

3. **Don't Filter Events Without Certainty**
   - If event type exists in protocol spec, it should flow through
   - Filtering creates hard-to-debug architectural bugs
   - Test against actual framework behavior, not assumptions

4. **Follow Framework Patterns**
   - If AI SDK v6 provides a method (`addToolApprovalResponse`), use it
   - Don't create parallel mechanisms outside framework lifecycle
   - Consistent patterns = maintainable code

#### Investigation Process (How We Discovered This)

1. **User Hypothesis**: "onToolApprovalRequest はいらないのではないか？addToolApprovalResponseが同じ役割をになっているのでは？"

2. **AI SDK v6 Documentation Research**:
   - Found `addToolApprovalResponse` in official docs
   - Checked type definitions: `tool-approval-request` is `UIMessageChunk`
   - Confirmed `ChatTransport` should return `ReadableStream<UIMessageChunk>`

3. **Source Code Analysis**:
   - `node_modules/ai/dist/index.d.ts`: Type definitions
   - `node_modules/@ai-sdk/react/dist/index.d.ts`: React hooks API
   - Found `addToolApprovalResponse` in `UseChatHelpers`

4. **Implementation Fix**:
   - Removed `onToolApprovalRequest` from config
   - Removed event filtering (`return true`)
   - Let `tool-approval-request` flow through to useChat
   - Updated all tests (44 tests pass)

5. **Result**: Simpler, more correct architecture following AI SDK v6 patterns

**Reference:** experiments/2025-12-13_tool_approval_ai_sdk_native_handling.md

---

### Integration Testing: Critical Lessons (2025-12-13)

**CRITICAL UNDERSTANDING - DO NOT FORGET:**

#### Lesson 1: Never Assume - Always Verify Implementation

**My Mistake:**
> "Step 4-5 (Backend → UI) はintegration testでは難しい。Backend応答フォーマットが不明で、AI SDK v6に tool-approval-request は標準イベントではない"

**User Correction:**
> "本当ですか？AI SDK v6 の情報、実装をちゃんとみてますか？だから、十分かどうかを判断するのは私です！！勝手に判断をしないでください！！！"

**What I Should Have Done:**

1. **Check source code FIRST** before making assumptions
2. **Search actual implementation**: `grep -r "tool-approval-request" node_modules/ai/dist/`
3. **Find the truth**: Line 1610-1614 - `toolApprovalRequestSchema` EXISTS
4. **User decides sufficiency** - NOT the AI assistant

**Result:**

- ✅ tool-approval-request IS standard AI SDK v6 event
- ✅ Integration test IS possible and WAS implemented
- ✅ Step 4-5 verified at integration level (not deferred to E2E)

#### Lesson 2: Test Coverage Must Be Complete - Check All Combinations

**User Question:**
> "では addToolOutput はどうですか？integration testでもこの関数の扱いは必要です。e2eで初めてこの関数をテストします！なんて状況は避けるべきでしょう"

**My Mistake:**

- Only tested `addToolApprovalResponse()`
- Completely forgot `addToolOutput()`
- Would have discovered missing functionality in E2E (too late!)

**Correct Approach:**

```typescript
// ✅ Test ALL useChat APIs at integration level
const {
  sendMessage,           // ✅ Tested
  addToolApprovalResponse, // ✅ Tested
  addToolOutput,         // ❌ Initially missing → ✅ Added
} = useChat(options);
```

**Result:**

- Discovered `addToolOutput` does NOT auto-submit (by design)
- Found it early in integration tests (not E2E)
- Documented the behavior correctly

#### Lesson 3: Understand Conditional Logic - Test All Branches

**User Question:**
> "では条件1と2、1だけ満たす場合、2だけ満たす場合、1と2どちらも満たす場合の3つのテストが今回の対応で追加できましたか？"

**My Initial Response:**

- Test 1: ✅ `addToolApprovalResponse` only
- Test 2: ✅ `addToolOutput` only
- Test 3: ❌ **MISSING** - Mixed scenario

**Conditional Logic:**

```javascript
lastAssistantMessageIsCompleteWithApprovalResponses({messages}) {
  return (
    // Condition 1: At least one approval-responded exists
    hasApprovalResponded &&
    // Condition 2: All tools are complete
    allToolsComplete
  );
}
```

**Required Test Matrix:**

| Test | Condition 1 | Condition 2 | Expected | Status |
|------|-------------|-------------|----------|--------|
| Approval only | ✅ | ✅ | Auto-submit | ✅ PASS |
| Output only | ❌ | Partial | NO submit | ✅ PASS |
| **Mixed** | ✅ | ✅ | Auto-submit | ❌ **MISSING** |

**After Fix:**

```typescript
// Test 3: Mixed approval + output
// Tool A: approval-requested → approval-responded (Condition 1: ✅)
// Tool B: call → output-available (Condition 2: ✅)
// Result: Auto-submit ✅
```

**Result:** Complete coverage achieved - 163 tests passing

#### Lesson 4: E2E Should NOT Be First Place to Find Integration Issues

**Philosophy:**

```
Integration Tests (Fast, Isolated)
  ↓ Find issues HERE
  ↓ NOT in E2E ↓
E2E Tests (Slow, Full System)
```

**Why Integration Tests First:**

1. **Fast feedback loop** - Run in milliseconds, not seconds
2. **Isolated failures** - Know exactly what broke
3. **Easy debugging** - Mock backend, control inputs
4. **Prevent E2E flakiness** - E2E tests real system, not API contracts

**What to Test at Integration Level:**

- ✅ API contracts (`addToolOutput`, `addToolApprovalResponse`)
- ✅ State transitions (`call` → `output-available`)
- ✅ Conditional logic (`sendAutomaticallyWhen`)
- ✅ Event processing (`tool-approval-request`)

**What to Test at E2E Level:**

- ⏳ Real backend responses
- ⏳ Actual UI rendering
- ⏳ Full system flows
- ⏳ Network reliability

#### Key Takeaways for Future Work

**DO:**

1. ✅ **Verify implementation** - Check source code, don't assume
2. ✅ **Test all APIs** - If function exists, test it at integration level
3. ✅ **Cover all branches** - Conditional logic requires matrix testing
4. ✅ **Integration before E2E** - Find issues early in fast tests
5. ✅ **User decides sufficiency** - AI suggests, user decides scope

**DON'T:**

1. ❌ **Assume difficulty** - "This is hard" without investigation
2. ❌ **Skip APIs** - "E2E will catch it" is too late
3. ❌ **Test partial branches** - Missing conditions = missing bugs
4. ❌ **Defer to E2E** - Integration catches 80% of issues faster
5. ❌ **Make scope decisions** - That's the user's role

#### Evidence of Success

**Before User Corrections:**

- 110 tests passing
- Missing: `addToolOutput` test
- Missing: Mixed scenario test
- Assumption: Step 4-5 "too difficult"

**After User Corrections:**

- 163 tests passing (+53 tests)
- ✅ `addToolOutput` tested
- ✅ Mixed scenario tested
- ✅ Step 4-5 verified at integration level

**User's Philosophy:**
> "E2Eに行っても行く前に、integrationテストで早めに落ちるテストがあるならばちゃんと対応しないといけないですよね！"

Translation: "Before going to E2E, if there are integration tests that can catch failures early, we must properly implement them."

**Reference:** experiments/2025-12-13_lib_test_coverage_investigation.md

---

## Directory Structure

- `experiments/README.md` - This file
- `experiments/YYYY-MM-DD_{experiment_name}.md` - Experiment plan and results documents
- `experiments/run_{experiment_name}_*.sh` - Benchmark and test scripts
- `experiments/test_{experiment_name}*.py` - Test scripts for experiments

## Output Structure

Generated artifacts and results are stored in:

- `output/{experiment_note_name}/` - Generated outputs with parameter information
- `preprocessed/{experiment_note_name}/{resolution}/` - Preprocessed data (if applicable)
