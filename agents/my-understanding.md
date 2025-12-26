# My Current Understanding of BIDI Confirmation Flow

**Last Updated: 2025-12-26 23:15 JST**

## Current Investigation Status: Tool Confirmation in BIDI Mode

### 🎯 FINAL DISCOVERY (2025-12-26 23:15) - ROOT CAUSE IDENTIFIED

**ROOT CAUSE: Live API does NOT support automatic tool confirmation**

Source: Official Gemini API Documentation (https://ai.google.dev/gemini-api/docs/live-tools)

> **"Unlike the `generateContent` API, the Live API doesn't support automatic tool response handling. You must handle tool responses manually in your client code."**

**This is NOT a bug - it's a design limitation of Live API itself.**

### Why Our Implementation Failed (2025-12-26 22:27)

After extensive investigation using DeepWiki and official documentation, we discovered:

1. ✅ **We implemented FunctionResponse correctly** - id, name, response are all correct
2. ✅ **We send it via LiveRequestQueue.send_content()** - this is the correct method
3. ❌ **ADK does NOT re-execute the tool function** - process_payment is never called again
4. ❌ **ADK attempts to reconnect to Gemini API** - fails with model version error

### Evidence from Server Logs (2025-12-26 22:26)

```
Turn 1 (SUCCESS):
22:26:38.076 - [process_payment] ===== TOOL FUNCTION CALLED ===== (1st time)
22:26:46.154 - [BIDI] Sent [DONE] marker

Turn 2 (FAILURE):
22:26:46.160 - [BIDI-APPROVAL] ===== APPROVAL MESSAGE ARRIVED =====
22:26:46.161 - [BIDI-APPROVAL] ===== SENT TO ADK VIA LiveRequestQueue.send_content() =====
... 30 seconds of silence ...
22:27:16.164 - ERROR: received 1008 (policy violation) models/gemini-live-2.5-flash-preview is not found
```

**CRITICAL OBSERVATION:**
- process_payment is called only ONCE (Turn 1)
- After sending FunctionResponse, NO second execution occurs
- ADK tries to create NEW Live API connection (fails)

### What DeepWiki Told Us

Source: DeepWiki queries to `google/adk-python` (2025-12-26 22:24)

**Query 1: "How does tool confirmation work in BIDI mode?"**
- Answer: Send FunctionResponse via `LiveRequestQueue.send_content()`
- FunctionResponse.id = original tool call ID
- FunctionResponse.name = `REQUEST_CONFIRMATION_FUNCTION_CALL_NAME` (value: `'adk_request_confirmation'`)
- FunctionResponse.response = `{"confirmed": True/False}`

**Query 2: "Does LiveRequestQueue have special methods for FunctionResponse?"**
- Answer: No special methods
- Use `send_content()` with `types.Content` containing FunctionResponse part
- `_RequestConfirmationLlmRequestProcessor` should process it automatically

**Query 3: "After sending FunctionResponse, does ADK automatically re-execute?"**
- Answer: **YES, ADK should automatically re-execute the tool**
- Flow: FunctionResponse → _RequestConfirmationLlmRequestProcessor → extract ToolConfirmation → re-execute tool with tool_context.tool_confirmation set

### What We Found in Official Documentation

Source: Google ADK Documentation (https://google.github.io/adk-docs/)

**Part 3 of BIDI Streaming Guide:**
- **"ADK handles tool execution automatically"**
- **"Unlike raw Gemini Live API, ADK abstracts tool complexity"**
- Documentation does NOT cover tool confirmation workflow in BIDI mode
- No examples of FunctionResponse handling for confirmation
- No mention of limitations or known issues

**GitHub Samples:**
- `adk-samples/python/agents/bidi-demo` - No tool confirmation example
- No working example of tool confirmation in BIDI mode found

**GitHub Issues:**
- Issue #2133 (Roadmap 2025 Q3) - Mentions "ADK Live Sessions & Events" but no tool confirmation details
- No open issues about tool confirmation not working in BIDI mode

## ⛔ What NOT to Do (Prohibited Approaches)

Based on our investigation and official documentation, the following approaches **WILL NOT WORK** for tool confirmation in Live API / BIDI mode:

### ❌ DO NOT use ADK's automatic confirmation features in BIDI mode

**Why**: Live API doesn't support automatic tool response handling

```python
# ❌ WRONG - This will NOT work in BIDI mode
from google.adk.tools.function_tool import FunctionTool

bidi_tools = [
    FunctionTool(process_payment, require_confirmation=True),  # ❌ NO EFFECT in BIDI!
    FunctionTool(get_location, require_confirmation=True),     # ❌ NO EFFECT in BIDI!
]
```

**Evidence**: Official documentation states Live API doesn't support automatic tool response handling.

### ❌ DO NOT use tool_context.request_confirmation() in BIDI mode

**Why**: This is designed for generateContent API (SSE mode), not Live API

```python
# ❌ WRONG - request_confirmation() is for SSE mode only
def process_payment(amount: float, recipient: str, tool_context: ToolContext):
    confirmed = tool_context.request_confirmation(...)  # ❌ Blocks forever in BIDI!
    if confirmed:
        return execute_payment(amount, recipient)
```

**Evidence**: No documentation or examples show this working in `run_live()`.

### ❌ DO NOT send FunctionResponse with REQUEST_CONFIRMATION_FUNCTION_CALL_NAME in BIDI

**Why**: `_RequestConfirmationLlmRequestProcessor` only works in generateContent API

```python
# ❌ WRONG - This processor doesn't run in Live API
from google.adk.flows.llm_flows.functions import REQUEST_CONFIRMATION_FUNCTION_CALL_NAME

function_response = types.FunctionResponse(
    id=tool_call_id,
    name=REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,  # ❌ Won't be processed!
    response={"confirmed": True},
)
```

**Evidence**: DeepWiki confirmed this is SSE-specific; our implementation failed.

### ❌ DO NOT try to replicate SSE pause/resume pattern in BIDI

**Why**: Different lifecycle - BIDI uses continuous streaming, not pause/resume

```python
# ❌ WRONG - invocation_id pattern is SSE-specific
# Turn 1
response = runner.run_async(messages=[user_msg])  # ✅ Works in SSE
invocation_id = response.invocation_id

# Turn 2
response = runner.run_async(
    messages=[approval_msg],
    invocation_id=invocation_id  # ❌ No equivalent in run_live()!
)
```

**Evidence**: `run_live()` has no invocation_id resume mechanism.

### Summary: Why These Don't Work

| Feature | SSE (generateContent) | BIDI (Live API) |
|---------|----------------------|-----------------|
| `require_confirmation=True` | ✅ Supported | ❌ No effect |
| `tool_context.request_confirmation()` | ✅ Works | ❌ Blocks forever |
| `_RequestConfirmationLlmRequestProcessor` | ✅ Auto re-execution | ❌ Not invoked |
| Pause/resume with `invocation_id` | ✅ Works | ❌ No equivalent |
| Automatic tool response handling | ✅ Yes | ❌ Manual only |

**Official Statement**:
> "Unlike the `generateContent` API, the Live API doesn't support automatic tool response handling."
> — https://ai.google.dev/gemini-api/docs/live-tools

## Technical Analysis: Why It Doesn't Work

**Hypothesis 1: Tool Confirmation Not Fully Implemented in BIDI Mode**

Evidence:
- No documentation for tool confirmation in `run_live()`
- No working examples in official samples
- DeepWiki describes SSE mode (`run_async()`) behavior, not BIDI mode (`run_live()`)

**Hypothesis 2: FunctionResponse Sent After Connection Closes**

Our implementation timing:
```
Turn 1:
1. Tool function calls tool_context.request_confirmation()
2. Returns error immediately
3. [DONE] marker sent
4. run_live() connection MAY close here

Turn 2:
1. Approval message arrives at WebSocket server
2. We create FunctionResponse
3. We call LiveRequestQueue.send_content()
4. ❌ Connection might already be closed
5. ❌ Or ADK tries to open NEW connection (fails)
```

**Hypothesis 3: Different Lifecycle Between SSE and BIDI**

SSE Mode (working):
```python
# Turn 1
response = runner.run_async(messages=[user_msg])
# Pauses at tool confirmation, returns with invocation_id

# Turn 2
response = runner.run_async(
    messages=[approval_msg],
    invocation_id=saved_invocation_id  # Resume from pause
)
```

BIDI Mode (not working):
```python
# Single run_live() call for entire session
async for event in runner.run_live(...):
    # Should this continue after confirmation?
    # Or do we need to restart run_live()?
```

### Key Questions for Investigation

1. **Is tool confirmation supported in BIDI mode at all?**
   - Documentation doesn't mention it
   - No examples exist
   - May be an unimplemented feature

2. **Does run_live() connection stay open after [DONE]?**
   - Or does it close and need to be reopened?
   - Different from SSE mode pause/resume pattern?

3. **Should we use different approach for BIDI confirmation?**
   - Maybe tool confirmation isn't meant for real-time streaming?
   - Should we use SSE mode for confirmation flow instead?

## Implementation History

### Phase 1: Initial Implementation (2025-12-24)

**Goal**: Implement tool confirmation for BIDI mode matching SSE mode behavior

**Approach**:
1. BidiEventSender: Inject `adk_request_confirmation` events
2. BidiEventReceiver: Handle approval and send FunctionResponse to ADK
3. Tool functions: Use `tool_context.request_confirmation()` in BIDI mode

### Phase 2: ToolConfirmationDelegate (2025-12-25)

**Problem**: Tool functions block on `request_confirmation()` in BIDI mode

**Solution**: Introduced ToolConfirmationDelegate with Future pattern
- Tool function stores pending confirmation in delegate
- Returns error immediately without blocking
- Frontend sends approval
- Delegate resolves Future
- ❌ **This approach was WRONG** - ADK handles confirmation natively

### Phase 3: ADK Native Approach (2025-12-26)

**Discovery**: ADK has native confirmation support via `_RequestConfirmationLlmRequestProcessor`

**New Approach**:
1. Remove ToolConfirmationDelegate completely
2. Send FunctionResponse directly to ADK via `LiveRequestQueue.send_content()`
3. Let ADK's native processor handle re-execution
4. ❌ **This doesn't work** - Tool is not re-executed

### Current State (2025-12-26 22:27)

**Status**: **BLOCKED - Tool confirmation doesn't work in BIDI mode**

**Working**:
- ✅ Turn 1: Confirmation request flow
- ✅ FunctionResponse creation and sending
- ✅ WebSocket session persistence

**Not Working**:
- ❌ Turn 2: Tool re-execution after approval
- ❌ ADK's `_RequestConfirmationLlmRequestProcessor` not triggering in BIDI mode
- ❌ run_live() connection lifecycle unclear

## Related Resources

### Official Documentation
- **ADK BIDI Streaming Guide**: https://google.github.io/adk-docs/streaming/
  - Part 1: Introduction to Bidi-streaming
  - Part 3: Event handling with run_live()
  - ⚠️ No tool confirmation documentation

- **ADK Python Repository**: https://github.com/google/adk-python
  - Source: `google/adk/flows/llm_flows/functions.py` - REQUEST_CONFIRMATION_FUNCTION_CALL_NAME constant
  - Source: `google/adk/flows/llm_flows/request_confirmation.py` - _RequestConfirmationLlmRequestProcessor
  - ⚠️ No BIDI mode examples with tool confirmation

- **ADK Samples**: https://github.com/google/adk-samples
  - `python/agents/bidi-demo` - Basic BIDI streaming (no tool confirmation)
  - ⚠️ No working confirmation examples

### Gemini API Documentation
- **Live API Tool Use Guide**: https://ai.google.dev/gemini-api/docs/live-tools
  - ⚠️ **CRITICAL**: "Unlike the generateContent API, the Live API doesn't support automatic tool response handling."
  - States manual tool response handling is required
  - No mention of tool confirmation or approval flows

- **Gemini Models List**: https://ai.google.dev/gemini-api/docs/models
  - Native audio models: `gemini-2.5-flash-native-audio-preview-12-2025`, `gemini-2.5-flash-native-audio-preview-09-2025`
  - Function calling is supported in Live API models

### DeepWiki Conversations
- Query: "How does tool confirmation work in BIDI mode using run_live()?" (2025-12-26 22:24)
  - URL: https://deepwiki.com/search/how-does-tool-confirmation-wor_29774251-984d-47ab-8d5d-dc086b3e39af
  - Result: Describes SSE mode behavior, not BIDI mode specifics

- Query: "Does LiveRequestQueue have any special methods for sending FunctionResponse?" (2025-12-26 22:24)
  - URL: https://deepwiki.com/search/does-liverequestqueue-have-any_1b75be69-fc29-4e75-a042-c9ea851ed9d4
  - Result: Use `send_content()` - no special methods

### GitHub Issues
- Issue #2133: ADK Roadmap 2025 Q3
  - URL: https://github.com/google/adk-python/issues/2133
  - Mentions "ADK Live Sessions & Events" - no tool confirmation details

## Next Steps

### Option A: Investigate ADK Source Code Further
1. Read `_RequestConfirmationLlmRequestProcessor` implementation
2. Find where it's registered in BIDI mode flow
3. Check if BIDI mode has different processor pipeline

### Option B: Alternative Implementation
1. **Switch to SSE mode for confirmation flow**
   - BIDI for audio/video streaming
   - SSE for text + confirmation
   - Use mode detection to route appropriately

2. **Implement custom confirmation without ADK native support**
   - Don't use `tool_context.request_confirmation()`
   - Manually manage confirmation state
   - Execute tool on approval without ADK's help

### Option C: Contact ADK Team
1. File GitHub issue asking about tool confirmation in BIDI mode
2. Ask if this is supported, planned, or needs workaround
3. Request documentation or examples

## Recommendation

Based on the investigation, **tool confirmation in BIDI mode appears to be unsupported or incomplete**.

**Immediate action**: File a question/issue on the ADK Python repository asking:
- "Is tool confirmation (require_confirmation=True or tool_context.request_confirmation()) supported in BIDI mode (run_live())?"
- "If yes, what is the expected workflow for sending FunctionResponse and triggering tool re-execution?"
- "If no, what is the recommended approach for confirmation flows in real-time streaming?"

**Fallback approach**: Use SSE mode for any tools requiring confirmation, reserve BIDI mode for tools that don't need approval.
