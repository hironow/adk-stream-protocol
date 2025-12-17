# BUG: ADK BIDI Mode Critical Issues

**Date:** 2025-12-17
**Status:** 🔴 Critical Bugs - Multiple BIDI Mode Failures
**Severity:** High - Core features completely broken in BIDI mode

## Summary

ADK's `run_live()` method (BIDI mode) has **TWO critical issues** that make it unusable for production:

### Issue 1: Tool Confirmation Flow Not Working (Confirmed ADK Limitation)
ADK's `run_live()` does NOT generate the `adk_request_confirmation` FunctionCall event when a tool has `require_confirmation=True`, causing the approval UI to never appear on the frontend.

**Root Cause (DeepWiki):** `FunctionTool._call_live()` has a TODO comment stating "tool confirmation is not yet supported for live mode". This is a **known ADK limitation**, not a bug in our code.

### Issue 2: Missing Text Response After Tool Execution (New Discovery)
After successfully executing a tool (e.g., `get_weather`), ADK does NOT generate any text response to explain the result to the user. The turn completes with `content=None`, leaving the UI showing only the raw tool output without any AI-generated explanation.

## Evidence

### Tool Configuration (Identical for Both Modes)
Both SSE and BIDI agents use identical tool configuration in `adk_ag_runner.py`:

**SSE Agent (line 68-73):**
```python
tools=[
    get_weather,
    FunctionTool(process_payment, require_confirmation=True),  # ✅ Works
    change_bgm,
    get_location,
],
```

**BIDI Agent (line 85-90):**
```python
tools=[
    get_weather,
    FunctionTool(process_payment, require_confirmation=True),  # ❌ Broken
    change_bgm,
    get_location,
],
```

### ADK Event Comparison

**SSE Mode (Working) - chunk_logs/real-1/backend-adk-event.jsonl seq 1-6:**
```
Seq 1: Initial greeting (text response)
Seq 2: process_payment function_call (from model)
       → author='adk_assistant_agent_sse'
       → invocation_id='e-e56ea51d-6a51-440b-848d-be39e5540d8e'

Seq 3: adk_request_confirmation function_call ← ✅ ADK INJECTED THIS
       → author='adk_assistant_agent_sse'
       → invocation_id='e-e56ea51d-6a51-440b-848d-be39e5540d8e' (same as seq 2)
       → Contains: originalFunctionCall + toolConfirmation(confirmed=False)

Seq 4: process_payment function_response (error)
       → error: "This tool call requires confirmation, please approve or reject."
       → actions.requested_tool_confirmations contains confirmation metadata

Seq 5: process_payment function_response (success, after user approval)
Seq 6: Final text response
```

**BIDI Mode (Broken) - chunk_logs/real-1/backend-adk-event.jsonl seq 10-13:**
```
Seq 10: process_payment function_call (from model)
        → author='adk_assistant_agent_bidi'
        → invocation_id='e-af93d07a-0da4-44f0-a230-6a94c01a17e3'

❌ NO adk_request_confirmation function_call event!

Seq 11: process_payment function_response (error)
        → error: "This tool call requires confirmation, please approve or reject."
        → actions.requested_tool_confirmations contains confirmation metadata

Seq 12: Usage metadata event
Seq 13: turn_complete=True event
```

### SSE Event Stream Comparison

**SSE Mode (chunk_logs/real-1/backend-sse-event.jsonl seq 8-11):**
```
Seq 8:  tool-input-start (process_payment)
Seq 9:  tool-input-available (process_payment)
Seq 10: tool-input-start (adk_request_confirmation) ← ✅ APPROVAL UI TRIGGER
Seq 11: tool-input-available (adk_request_confirmation) ← ✅ APPROVAL UI TRIGGER
...User clicks Approve...
Seq 15: tool-output-available (process_payment success)
Seq 17: text-delta (confirmation message)
```

**BIDI Mode (chunk_logs/real-1/backend-sse-event.jsonl seq 39-43):**
```
Seq 39: start (message start)
Seq 40: tool-input-start (process_payment)
Seq 41: tool-input-available (process_payment)

❌ NO adk_request_confirmation events!

Seq 42: finish (no finish reason)
Seq 43: [DONE]
```

**Result:** Frontend stays stuck showing `process_payment` with status "Executing..." because the approval UI never appears.

## Root Cause Analysis

1. **ADK Library Behavioral Difference:**
   - `InMemoryRunner.run()` (SSE mode): ✅ Generates `adk_request_confirmation` FunctionCall
   - `InMemoryRunner.run_live()` (BIDI mode): ❌ Does NOT generate `adk_request_confirmation` FunctionCall

2. **Both modes generate the confirmation error FunctionResponse:**
   - Both have `actions.requested_tool_confirmations` metadata
   - But only SSE mode generates the corresponding FunctionCall event

3. **Conversion layer is not the issue:**
   - Both SSE and BIDI use the same `stream_adk_to_ai_sdk()` converter (server.py:622-625)
   - The bug is in ADK event generation, not protocol conversion

## Impact

### Issue 1: Tool Confirmation
- **BIDI Mode:** Tool approval completely broken - approval UI never appears
- **SSE Mode:** Works correctly ✅
- **User Experience:** Payment tool stuck in "Executing..." state indefinitely in BIDI mode

### Issue 2: Missing Text Response
- **BIDI Mode:** Tool executes successfully but AI generates NO text response to explain the result
- **SSE Mode:** Works correctly - AI provides natural language explanation after tool execution ✅
- **User Experience:** Only raw tool JSON output shown, no human-readable explanation

## Evidence for Issue 2: Missing Text Response After Tool Execution

### Test Case: get_weather Tool in BIDI Mode

**User Request:** "What's the weather in Tokyo? (test real-1)"

**ADK Events (chunk_logs/real-1/backend-adk-event.jsonl seq 20-23):**
```
Seq 20: get_weather function_call ✅
        → FunctionCall(location='Tokyo')

Seq 21: get_weather function_response ✅
        → FunctionResponse(response={temperature: 9.8, condition: "Clear", ...})

Seq 22: Usage metadata ONLY
        → content=None ❌
        → Only token count, no text content

Seq 23: turn_complete=True
        → content=None ❌
        → Turn ends without any AI text response
```

**SSE Events (chunk_logs/real-1/backend-sse-event.jsonl seq 71-76):**
```
Seq 71: start
Seq 72: tool-input-start (get_weather)
Seq 73: tool-input-available (get_weather)
Seq 74: tool-output-available (weather data)

❌ NO text-start/text-delta/text-end events!

Seq 75: finish (no finishReason)
Seq 76: [DONE]
```

**Comparison with SSE Mode:** In SSE mode with the same `get_weather` tool, the event stream includes:
- `text-start` event
- `text-delta` event with content like "Tokyo is currently 9.8°C with clear skies"
- `text-end` event
- `finish` event with proper finishReason

**Result:** Frontend UI shows only the raw tool output JSON without any AI-generated explanation.

## Minimal Reproduction

### Issue 1: Tool Confirmation Failure

1. Start server: `uv run uvicorn server:app --reload`
2. Start frontend: `pnpm dev`
3. Open http://localhost:3000
4. Click "ADK BIDI ⚡" button
5. Send: "Send 50 dollars to Hanako"
6. **Expected:** Approval UI appears for `adk_request_confirmation` tool
7. **Actual:** Only `process_payment` tool shown, stuck in "Executing..." state

### Issue 2: Missing Text Response

1. Start server: `uv run uvicorn server:app --reload`
2. Start frontend: `pnpm dev`
3. Open http://localhost:3000
4. Click "ADK BIDI ⚡" button (ensure clean state with page reload)
5. Send: "What's the weather in Tokyo?"
6. **Expected:** Tool executes AND AI provides text like "Tokyo is currently 9.8°C with clear skies"
7. **Actual:** Tool shows "Completed" with raw JSON output, but NO AI text response appears

## Comprehensive Test Results (All Tools Comparison)

### Test Session: 2025-12-17 (real-1)

Complete comparison of all 4 tools across SSE and BIDI modes:

| Tool | Test Input | SSE Mode | BIDI Mode | Issue |
|------|------------|----------|-----------|-------|
| **get_weather** | "What's the weather in Tokyo?" | ✅ Tool Executed<br>✅ AI Text: "Tokyoの天気は晴れで、気温は9.8℃です。体感温度も9.8℃で、湿度は64%、風速は1.11m/sです。" | ✅ Tool Executed<br>❌ **No AI Text**<br>Only raw JSON shown | **Issue 2** |
| **change_bgm** | "Change BGM to track 1" | ✅ Tool Executed<br>✅ AI Text: "BGMをトラック1に変更しました。"<br>UI: 🎵 BGM 2 | ✅ Tool Executed<br>❌ **No AI Text**<br>UI: 🎵 BGM 2 | **Issue 2** |
| **get_location** | "What's my current location?" | ✅ Tool Executed<br>✅ AI Text: "現在地を取得します。これはフロントエンドのブラウザのGeolocation APIを介して実行されます。" | ✅ Tool Executed<br>❌ **No AI Text**<br>Only raw JSON shown | **Issue 2** |
| **process_payment** | "Send 50 dollars to Hanako" | ✅ Tool Executed<br>✅ Approval UI Shown<br>✅ AI Text Generated<br>Complete flow | ❌ **Stuck "Executing..."**<br>❌ **No Approval UI**<br>No `adk_request_confirmation` | **Issue 1** |

### Key Observations

1. **Issue 2 affects ALL tools in BIDI mode** - Not specific to any tool type
2. **Tools execute successfully** - Backend processing works correctly
3. **Missing text generation only** - The problem is post-tool AI response generation
4. **SSE mode works perfectly** - All tools generate proper AI text responses

### Event Flow Pattern Comparison

**SSE Mode (Complete Flow):**
```
User Message → FunctionCall → FunctionResponse → text-start → text-delta → text-end → finish
```

**BIDI Mode (Incomplete Flow):**
```
User Message → FunctionCall → FunctionResponse → [NO TEXT EVENTS] → usage_metadata → turn_complete
```

### Additional Evidence: get_location in BIDI Mode

**ADK Events (seq 28-31):**
```jsonl
Seq 28: get_location function_call ✅
        → invocation_id='e-e67045b8-9f9a-4927-9976-a916dcfe0113'
        → author='adk_assistant_agent_bidi'

Seq 29: get_location function_response ✅
        → response={'success': True, 'message': '...'}

Seq 30: Usage metadata ONLY ❌
        → content=None
        → usage_metadata.prompt_token_count=2112
        → NO text content

Seq 31: turn_complete=True ❌
        → content=None
        → Turn ends without AI text response
```

This pattern is **identical** across all tools (get_weather, change_bgm, get_location), confirming Issue 2 is systemic in BIDI mode.

## Logs

- **ADK Events:** `chunk_logs/real-1/backend-adk-event.jsonl`
- **SSE Events:** `chunk_logs/real-1/backend-sse-event.jsonl`
- Compare SSE mode (seq 1-6) vs BIDI mode (seq 10-13)

## Additional Observations

### JSON Parse Error in BIDI Mode

**Error Log:**
```
2025-12-17 14:44:17.986 | DEBUG | server:send_to_client:645 - [BIDI-SEND] Could not parse event data: Expecting value: line 1 column 2 (char 1)
```

**Location:** server.py:645, within `send_to_client()` function

**Code Context:**
```python
if sse_event.startswith("data:"):
    try:
        event_data = json.loads(sse_event[5:].strip())  # Remove "data:" prefix
        event_type = event_data.get("type", "unknown")
        logger.info(f"[BIDI-SEND] Sending event type: {event_type}")
    except Exception as e:
        logger.debug(f"[BIDI-SEND] Could not parse event data: {e}")  # ← Error here
```

**Analysis:**
- Occurs when converting SSE events to WebSocket messages
- JSON parse fails with "Expecting value: line 1 column 2 (char 1)"
- This error pattern suggests empty data or malformed JSON like `"{}"` or `"{\n}"`
- Error occurs during tool execution in BIDI mode
- Coincides with seq 30 (usage_metadata event with `content=None`)

**Hypothesis:**
The error may be related to how ADK's `content=None` events are being converted to SSE format. When `stream_adk_to_ai_sdk()` processes events with `content=None`, it might generate malformed SSE data that cannot be parsed as JSON.

**Impact:**
- Currently logged as DEBUG, not blocking execution
- May indicate incomplete event conversion for metadata-only events
- Could be related to Issue 2 (missing text response) if event stream is corrupted

## Potential Causes

### Issue 1: Tool Confirmation

**Confirmed Root Cause (via DeepWiki):** `FunctionTool._call_live()` has a TODO comment stating "tool confirmation is not yet supported for live mode". This is a **known ADK limitation**.

### Issue 2: Missing Text Response

**Theory 1: Agent Instruction Issue**
The agent instruction might need to explicitly tell the AI to provide text responses after tool execution in BIDI mode.

**Theory 2: RunConfig Setting**
BIDI mode's `RunConfig` might need a specific setting to enable post-tool text generation.

**Theory 3: Model Behavior Difference**
The native-audio model (`gemini-2.5-flash-native-audio-preview-09-2025`) might behave differently than standard models for text generation after tools.

**Theory 4: Event Stream Termination**
`run_live()` might be terminating the event stream prematurely after tool execution, before the AI can generate text response.

## Next Steps

### For Issue 1 (Tool Confirmation)

**✅ Root Cause Confirmed:** ADK limitation - `FunctionTool._call_live()` TODO comment confirms this is not yet implemented.

**Recommended Approach:** Option A - Manual workaround implementation
1. Detect `actions.requested_tool_confirmations` in ADK events
2. Manually inject `adk_request_confirmation` FunctionCall in `send_to_client()`
3. Handle approval response conversion (AI SDK → ADK)

### For Issue 2 (Missing Text Response)

**Priority:** Investigate before implementing workarounds

1. **Test with Different Model:**
   - Try `gemini-2.5-flash` (non-audio model) in BIDI mode
   - Check if issue is specific to native-audio models

2. **Check Agent Instructions:**
   - Review if BIDI agent needs different instruction format
   - Test if explicit "always provide text response after tool execution" helps

3. **Review RunConfig:**
   - Check if `response_modalities=["TEXT"]` is correctly set
   - Verify no configuration conflicts with tool execution

4. **ADK Documentation Research:**
   - Search for BIDI mode + tool execution + text response patterns
   - Check ADK examples for expected event flow after tools

5. **ADK Source Code Investigation:**
   - Find where `run_live()` decides to generate text after tool execution
   - Compare with `run()` implementation

6. **Potential Workaround:**
   - If no configuration fix exists, consider forcing AI to generate text by:
     - Adding system message after tool result
     - Using multi-turn conversation pattern
     - Or accept UI limitation (show only tool JSON output)

### Long-term Actions

1. **Report to ADK Team:**
   - Both issues documented with minimal reproduction
   - Provide link to this analysis and chunk logs
   - Request roadmap for `FunctionTool` confirmation support in BIDI mode
   - Ask about expected behavior for text generation after tools in BIDI mode

## Related Files

- `adk_ag_runner.py:70,87` - Tool configuration
- `server.py:611-661` - BIDI send_to_client function
- `stream_protocol.py:474-526` - Tool call processing
- `chunk_logs/real-1/backend-adk-event.jsonl` - ADK event logs
- `chunk_logs/real-1/backend-sse-event.jsonl` - SSE event logs

## References

- ADK Tool Confirmation Flow: `assets/adk/action-confirmation.txt`
- Experiment Notes: `experiments/2025-12-17_tool_architecture_refactoring.md`
- Tasks: `agents/tasks.md` (Phase 5 - ADK Tool Confirmation Implementation)
