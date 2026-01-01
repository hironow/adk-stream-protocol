# Tool Architecture Refactoring for AI SDK v6 Standard Patterns

**Date**: 2025-12-17
**Objective**: Refactor tool architecture to align with AI SDK v6 standard patterns and improve AI stability
**Status**: 🟡 In Progress

## Background

Previous tool set included 5 tools, causing AI instability. Need to reduce to 4 tools representing different execution patterns:

1. Server-side, no approval (information retrieval)
2. Server-side with approval (sensitive operations)
3. Client-side auto-execution (UI controls)
4. Frontend delegate with approval (browser APIs)

AI SDK v6 supports:

- ✅ Server-side tool approval (standard pattern)
- ❌ Client-side tool approval (unexpected pattern)

## Hypothesis

1. Reducing tool count from 5 to 4 will improve AI stability
2. Aligning with AI SDK v6 standard patterns will improve reliability
3. Clear agent instructions with examples will ensure AI calls tools correctly

## Experiment Design

### Phase 1: Tool Refactoring ✅

- Remove: `calculate`, `get_current_time`
- Add: `process_payment` (server-side approval, mock wallet with $1000 balance)
- Keep: `get_weather`, `change_bgm`, `get_location`
- Update: Agent descriptions and instructions

### Phase 2: Agent Instruction Improvement 🟡

- Initial instruction: "Use the available tools when needed"
- Problem discovered: AI responds with text only, no tool calls
- Improved instruction: "You MUST use these tools" + concrete examples

### Phase 3: Testing ⏳

- [ ] Test `get_weather` (server-side, no approval)
- [ ] Test `change_bgm` (client-side auto-execution)
- [ ] Test `process_payment` (server-side with approval)
- [ ] Test `get_location` (frontend delegate with approval)

## Results

### Phase 1 Results ✅

**Tool List Update**: Successfully updated from 5 to 4 tools

- Removed: `calculate`, `get_current_time`
- Added: `process_payment` with validation (positive amount, sufficient funds)
- Backend reloaded successfully with correct tool list
- Log verification: `tools: ['get_weather', 'process_payment', 'change_bgm', 'get_location']`

**Code Changes**:

- `adk_ag_runner.py:146-215`: Added `process_payment` function
- `adk_ag_runner.py:291`: Updated `TOOLS_REQUIRING_APPROVAL` set
- `adk_ag_runner.py:303-321`: Updated agent description and instruction
- `adk_ag_runner.py:336,348`: Updated both SSE and BIDI agent tool lists

### Phase 2 Results 🟡

**Problem Discovered**: AI not calling tools

- Sent request: "100ドルをAliceに送金してください"
- AI response: "Aliceに100ドルを送金します。承認をお願いします。" (text only)
- Expected: Tool call `process_payment(amount=100, recipient='Alice', currency='USD')`
- Log evidence: No `function_call` part in response (logs/server_20251216_155834.log:11-27)

**Root Cause Analysis**:

- Initial instruction: "Use the available tools when needed" → Too weak
- AI interprets request as conversation, not tool invocation
- Comparison: `change_bgm` worked correctly with function_call

**Instruction Improvement** (`adk_ag_runner.py:306-321`):

```python
AGENT_INSTRUCTION = (
    "You are a helpful AI assistant with access to the following tools:\n"
    "- get_weather: Check weather for any city\n"
    "- process_payment: Process payment transactions (requires user approval)\n"
    "- change_bgm: Change background music track (auto-executes on client)\n"
    "- get_location: Get user's location (requires user approval)\n\n"
    "IMPORTANT: You MUST use these tools to perform the requested actions. "
    "When a user asks you to check weather, send money, change BGM, or get location, "
    "you must call the corresponding tool function - do not just describe what you would do.\n\n"
    "For example:\n"
    "- User: '東京の天気は?' → Call get_weather(location='Tokyo')\n"
    "- User: '100ドルをAliceに送金して' → Call process_payment(amount=100, recipient='Alice', currency='USD')\n"
    "- User: 'トラック1に変更して' → Call change_bgm(track=1)\n"
    "- User: '私の位置を教えて' → Call get_location()\n\n"
    "Note: process_payment and get_location require user approval before execution."
)
```

Key improvements:

1. **Explicit mandate**: "You MUST use these tools"
2. **Anti-pattern warning**: "do not just describe what you would do"
3. **Concrete examples**: Japanese input examples with expected tool calls
4. **Clear mapping**: User intent → Tool call

### Phase 3 Results 🔴

**Test Execution**: Tested improved instruction with `process_payment` (2025-12-17 01:16:44)

- Request: "50ドルをBobに送金してください" (Please send 50 dollars to Bob)
- ✅ **AI called the tool correctly**: `process_payment(amount=50, recipient='Bob', currency='USD')`
- ❌ **Approval flow BROKEN**: Tool executed immediately without user approval

**Log Evidence** (`logs/server_20251216_160822.log:83-85`):

```
01:16:46.465 | INFO | [Tool Approval] Tool 'process_payment' requires approval (approval_id=bcae944e-ca02-4b3b-b10d-f3014e132486, tool_call_id=adk-49d49dbc-16be-404b-85ab-d4820db177c5)
01:16:46.465 | INFO | [process_payment] Processing payment: 50 USD to Bob
01:16:46.465 | INFO | [process_payment] Payment successful: txn_397872cce975
```

**Critical Discovery**: The backend correctly identifies that approval is required and generates an `approval_id`, but the tool executes IMMEDIATELY (same millisecond) without waiting for user approval.

**Root Cause Identified**:

1. Tools are registered directly with ADK agent (`adk_ag_runner.py:342,354`):

   ```python
   tools=[get_weather, process_payment, change_bgm, get_location]
   ```

2. **ADK agents execute tools immediately when the AI decides to call them**
3. By the time `stream_protocol.py` generates the `tool-approval-request` event, the tool has already executed
4. The approval UI never appears because execution is complete before the event is sent

**Sequence**:

1. User sends payment request
2. ADK agent processes request and AI generates `function_call` for `process_payment`
3. **ADK agent IMMEDIATELY executes the tool** (ADK behavior)
4. ADK agent returns both `function_call` AND `function_response` events
5. Backend converts events to SSE format and generates approval request event
6. Frontend receives tool execution result (no approval UI ever shown)

**Architectural Limitation**:
ADK does not support deferred tool execution. Tools registered with ADK agents execute immediately upon AI invocation. **Server-side tool approval pattern from AI SDK v6 cannot be implemented with current ADK architecture** without fundamental changes.

## Conclusion

**Mixed Results**:

- ✅ Tool architecture successfully refactored (5 → 4 tools)
- ✅ Agent instruction improvement SUCCESSFUL (AI now calls tools correctly)
- ❌ Server-side approval pattern FUNDAMENTALLY INCOMPATIBLE with ADK
- 🔴 **Critical blocker discovered**: ADK agents cannot defer tool execution for approval

**Key Insights**:

1. **Agent instruction quality is critical**: Weak instructions lead to text-only responses
2. **Concrete examples matter**: Japanese examples help AI understand Japanese requests
3. **Explicit instructions work better**: "MUST use" > "when needed"
4. **Tool calling is not automatic**: AI needs clear guidance on when/how to use tools
5. ⚠️ **ADK architectural limitation**: Tools registered with agents execute immediately - no approval mechanism exists

**Status**: 🔴 Blocker - Original goal of implementing server-side tool approval cannot be achieved with current ADK architecture

## Phase 4: ADK Tool Confirmation Flow Discovery 🟢

**User Discovery** (2025-12-17 01:20+): User pointed out that ADK has a native "Tool Confirmation Flow" feature

**Investigation**:

- Found official documentation: <https://google.github.io/adk-docs/tools-custom/confirmation/>
- Found local documentation: `assets/adk/action-confirmation.txt`
- Found official sample code: `human_tool_confirmation` example

**Key Features**:

### 1. Boolean Confirmation

```python
FunctionTool(process_payment, require_confirmation=True)
```

Simplest approach - yes/no confirmation

### 2. Dynamic Confirmation (Conditional)

```python
async def confirmation_threshold(amount: int, tool_context: ToolContext) -> bool:
    return amount > 1000  # Only confirm if amount > 1000

FunctionTool(process_payment, require_confirmation=confirmation_threshold)
```

### 3. Advanced Confirmation (Structured Data)

```python
def process_payment(amount: int, tool_context: ToolContext):
    if not tool_context.tool_confirmation:
        tool_context.request_confirmation(
            hint="Please approve or reject payment",
            payload={'approved_amount': 0}
        )
        return {'status': 'Awaiting approval'}

    approved = tool_context.tool_confirmation.payload['approved_amount']
    # Execute with approved amount
```

**ADK Confirmation Flow**:

1. AI decides to call tool
2. ADK agent pauses execution (if `require_confirmation=True`)
3. ADK generates `RequestConfirmation` event (special `FunctionCall`)
4. Tool returns intermediate status
5. User/system sends `FunctionResponse` with `name="adk_request_confirmation"`
6. Tool resumes with confirmation data

**REST API Support**: Confirmation responses can be sent via `/run_sse` endpoint:

```json
{
  "new_message": {
    "parts": [{
      "function_response": {
        "id": "adk-xxx",  // Match RequestConfirmation ID
        "name": "adk_request_confirmation",
        "response": {"confirmed": true}
      }
    }],
    "role": "user"
  }
}
```

**Status**: ✅ **Blocker removed** - ADK natively supports tool confirmation with execution pause

## Revised Conclusion

**Updated Status**: 🟢 **Path Forward Identified**

**Results**:

- ✅ Tool architecture successfully refactored (5 → 4 tools)
- ✅ Agent instruction improvement SUCCESSFUL (AI now calls tools correctly)
- ✅ **ADK natively supports tool confirmation** (previous conclusion was incorrect)
- 🟡 Implementation needed: Integrate ADK Tool Confirmation Flow with AI SDK v6 protocol

**Key Insights**:

1. **Agent instruction quality is critical**: Weak instructions lead to text-only responses
2. **Concrete examples matter**: Japanese examples help AI understand Japanese requests
3. **Explicit instructions work better**: "MUST use" > "when needed"
4. **Tool calling is not automatic**: AI needs clear guidance on when/how to use tools
5. ✅ **ADK has native confirmation**: `FunctionTool` with `require_confirmation` parameter
6. ⚠️ **Integration challenge**: Need to convert ADK `RequestConfirmation` to AI SDK v6 `tool-approval-request`

## Implementation Plan

### Phase 5: Implement ADK Tool Confirmation ⏳

**Changes needed**:

1. **Update `process_payment` signature** (`adk_ag_runner.py`):

```python
def process_payment(
    amount: float,
    recipient: str,
    tool_context: ToolContext,  # Add this parameter
    currency: str = "USD",
    description: str = "",
) -> dict[str, Any]:
    # Use boolean confirmation (simplest approach)
    # Or advanced confirmation if structured data needed
```

1. **Wrap with `FunctionTool`** (`adk_ag_runner.py`):

```python
from google.adk.tools.function_tool import FunctionTool

sse_agent = Agent(
    tools=[
        get_weather,
        FunctionTool(process_payment, require_confirmation=True),  # Wrap here
        change_bgm,
        get_location,
    ],
)
```

1. **Handle `RequestConfirmation` in `stream_protocol.py`**:
   - Detect `FunctionCall` with `name="adk_request_confirmation"`
   - Convert to AI SDK v6 `tool-approval-request` event
   - Store pending approval state

2. **Handle confirmation response**:
   - Receive AI SDK v6 approval response from frontend
   - Convert to ADK `FunctionResponse` format
   - Send to ADK runner to resume tool execution

**Estimated Complexity**: Medium

- Most infrastructure already exists (tool approval UI, approval state management)
- Main work: Converting between ADK and AI SDK v6 event formats

### Phase 5 Results 🟡

**Implementation Complete** (2025-12-17 01:45 JST)

✅ **Code Changes Completed**:

1. **Added FunctionTool Import** (`adk_ag_runner.py:19`)

   ```python
   from google.adk.tools.function_tool import FunctionTool
   ```

2. **Updated process_payment Signature** (`adk_ag_runner.py:147-169`)
   - Added `tool_context: ToolContext` parameter (line 150)
   - Updated docstring to document the parameter (line 163)

3. **Wrapped process_payment in SSE Agent** (`adk_ag_runner.py:345-350`)

   ```python
   tools=[
       get_weather,
       FunctionTool(process_payment, require_confirmation=True),
       change_bgm,
       get_location,
   ]
   ```

4. **Wrapped process_payment in BIDI Agent** (`adk_ag_runner.py:362-367`)
   - Same FunctionTool wrapper applied to BIDI agent

**Status**: 🟡 Partial Implementation

**What's Complete**:

- ✅ ADK-side tool confirmation setup (FunctionTool wrapper with `require_confirmation=True`)
- ✅ Tool signature updated to accept ToolContext
- ✅ Code compiles and loads successfully

**What Remains**:

- ⏳ Test if ADK generates `RequestConfirmation` event when AI calls `process_payment`
- ⏳ Implement `RequestConfirmation` event handling in `stream_protocol.py`:
    - Detect `FunctionCall` with `name="adk_request_confirmation"`
    - Convert to AI SDK v6 `tool-approval-request` event format
    - Store pending approval state
- ⏳ Implement approval response handling:
    - Receive AI SDK v6 approval from frontend
    - Convert to ADK `FunctionResponse` with `name="adk_request_confirmation"`
    - Send to ADK agent to resume execution
- ⏳ End-to-end testing with actual approval flow

**Next Session Priority**: Test `RequestConfirmation` event generation and implement event conversion in `stream_protocol.py`

### Phase 5 Continued: Frontend & Backend Integration 🔴

**Implementation Progress** (2025-12-17 02:00-03:30 JST)

✅ **Frontend Implementation**:

1. **Extracted `sendAutomaticallyWhen` logic** (`lib/adk_compat.ts`)
   - Created dedicated module for ADK compatibility utilities
   - Fixed careless mistake: using `toolInvocations` instead of `parts` (AI SDK v6 uses `parts`)
   - Added try-catch to prevent infinite request loops on error

2. **Added Unit Tests** (`lib/adk_compat.test.ts`)
   - 28 comprehensive test cases covering all edge cases
   - Specific test for Phase 5 approval flow scenario
   - All tests passing ✅

3. **Added E2E Tests** (`e2e/adk-tool-confirmation.spec.ts`)
   - Test for infinite loop prevention
   - Monitors HTTP request count to detect loops
   - Test for full approval flow

✅ **Backend Implementation**:

1. **Updated `ai_sdk_v6_compat.py`** (lines 388-417)
   - Added Phase 5 handling for `adk_request_confirmation` tool outputs
   - Converts AI SDK v6 confirmation output to ADK FunctionResponse format
   - Fixed attribute error: `part.input` → `part.args` (ToolUsePart uses `args` not `input`)

2. **Added Error Handling** (`server.py` lines 258-281)
   - Try-catch around `msg.to_adk_content()` with early error return
   - Prevents infinite request loops when message conversion fails
   - Returns SSE error stream to gracefully terminate connection

🔴 **Critical Issue Discovered**:

**Problem**: Infinite request loop occurs during approval flow

**Root Cause**: `adk_request_confirmation` tool has **`args=None`**

```python
# From server logs:
ToolUsePart(
    type='tool-adk_request_confirmation',
    tool_call_id='adk-xxx',
    tool_name='adk_request_confirmation',
    args=None,  # ← THIS IS THE PROBLEM
    state=<ToolCallState.OUTPUT_AVAILABLE: 'output-available'>,
    output={'toolConfirmation': {'confirmed': True}}
)
```

**Expected**:

```python
args={
    'originalFunctionCall': {
        'id': 'adk-xxx',
        'name': 'process_payment',
        'args': {'amount': 50, 'recipient': 'Hanako', 'currency': 'USD'}
    }
}
```

**Consequences**:

1. Backend cannot identify which tool call the confirmation is for
2. Condition `if part.args and isinstance(part.args, dict):` fails (line 391 in `ai_sdk_v6_compat.py`)
3. No FunctionResponse is generated
4. `parts=0` in converted ADK message
5. ADK agent returns empty response (no text, no function calls)
6. Frontend interprets empty response as incomplete and retries
7. **Result**: Infinite request loop (600+ requests observed in E2E test)

**Evidence**:

- E2E test log: 600+ HTTP requests to `/stream` endpoint
- Server log: `Message 1: role=assistant, parts=0` (no ADK parts created)
- Server log: "Last message has no text content" warning
- HTTP responses all return `200 OK` but with empty content

**Status**: ✅ **RESOLVED** - `originalFunctionCall` now included in output

**Root Cause Identified** (2025-12-17 03:30 JST):

1. **Flow Analysis**:
   - ADK sends `RequestConfirmation` FunctionCall with `args.originalFunctionCall` ✅
   - Backend converts to `tool-input-available` SSE event with `input.originalFunctionCall` ✅
   - Frontend (AI SDK v6) creates ToolUsePart with `args.originalFunctionCall` ✅
   - User clicks "Approve" button
   - Frontend calls `addToolOutput` with just `toolConfirmation` output ❌
   - **AI SDK v6 creates NEW ToolUsePart with `args=None`** ← **THIS IS THE PROBLEM**
   - Backend tries to extract `originalFunctionCall` from `args` but finds `None` ❌

2. **Why `args=None`**:
   - `addToolOutput` only sets the `output` field
   - AI SDK v6 does NOT preserve `args` from the original tool call
   - This is expected AI SDK v6 behavior - tool outputs don't inherit tool inputs

**Solution Implemented** (2025-12-17 03:35 JST):

1. **Frontend Changes** (`components/tool-invocation.tsx`):

   ```typescript
   addToolOutput?.({
     tool: "adk_request_confirmation",
     toolCallId: toolInvocation.toolCallId,
     output: {
       originalFunctionCall: originalToolCall, // ← ADD THIS
       toolConfirmation: { confirmed: true },
     },
   });
   ```

2. **Backend Changes** (`ai_sdk_v6_compat.py:395-401`):

   ```python
   # Extract from output (primary location)
   original_function_call = part.output.get("originalFunctionCall")
   # Fallback to args for backward compatibility
   if not original_function_call and part.args:
       original_function_call = part.args.get("originalFunctionCall", {})
   ```

3. **Tests Added** (`tests/unit/test_ai_sdk_v6_compat.py`):
   - `test_adk_request_confirmation_with_original_function_call_in_output` ✅
   - Updated existing tests to reflect new behavior
   - **All 33 tests passing** ✅

**Verification**:

- ✅ Python unit tests: 33/33 passing
- ✅ TypeScript unit tests: 28/28 passing
- ⏳ E2E test pending

## Next Steps

1. ✅ Implement `process_payment` with ADK Tool Confirmation → **DONE**
2. ✅ Test `RequestConfirmation` event generation → **TESTED, WORKING**
3. ✅ Add `RequestConfirmation` → `tool-approval-request` conversion → **DONE (frontend)**
4. ✅ Add approval response handling → **PARTIALLY DONE**
5. 🔴 **FIX: `args=None` issue in `adk_request_confirmation`** → **CRITICAL BLOCKER**
6. ⏳ Test end-to-end approval flow after fix
7. ⏳ Add Python unit/integration tests for Phase 5 (as per user request)
8. ⏳ Update documentation
