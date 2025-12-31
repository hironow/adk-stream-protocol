# Last Test Results

**Date:** 2025-12-31
**Execution Mode:** Serial (worker=1) for all test suites

## Overall Summary

| Suite | Passed | Failed | Skipped | Errors | Warnings | Time |
|-------|--------|--------|---------|--------|----------|------|
| **Vitest lib** | 627 | 0 | 2 | 0 | 0 | 52.36s |
| **Vitest app** | 33 | 0 | 0 | 0 | 0 | 1.92s |
| **Vitest components** | 73 | 0 | 0 | 0 | 0 | 4.46s |
| **Python integration** | 6 | 23 | 0 | 2 | 29 | 31.11s |
| **Python E2E** | 42 | 0 | 7 | 0 | 45 | 155.99s (2:35) |
| **Playwright E2E** | 48 | 13 | 11 | 0 | 0 | 600s (10:0m) |
| **TOTAL** | **829** | **36** | **20** | **2** | **74** | **~12m** |

## Detailed Results

### 1. Vitest lib Tests
-  **627 passed**
- í **2 skipped**
- ñ 52.36 seconds
- **Status:** All passing

### 2. Vitest app Tests
-  **33 passed**
- ñ 1.92 seconds
- **Status:** All passing

### 3. Vitest components Tests
-  **73 passed**
- ñ 4.46 seconds
- **Status:** All passing

### 4. Python Integration Tests
-  **6 passed**
- L **23 failed**
-   **2 errors**
-   **29 warnings** (deprecation warnings from ADK)
- ñ 31.11 seconds
- **Status:** Multiple failures in BIDI event handling integration tests

#### Failed Tests:
1. `test_bidi_confirmation_should_send_tool_input_events_for_original_tool`
2. `test_bidi_confirmation_event_sequence`
3. `test_level2_message_event_with_real_frontend_delegate`
4. `test_level2_confirmation_flow_with_real_delegate`
5. `test_level3_interrupt_event_with_real_queue`
6. `test_level3_audio_chunk_with_real_blob_creation`
7. `test_level4_complete_message_flow`
8. `test_level4_sequential_events`
9. `test_level2_missing_tool_result_with_real_delegate`
10. `test_level3_malformed_audio_chunk`
11. `test_level2_real_frontend_delegate_id_mapping`
12. `test_level2_real_frontend_delegate_multiple_tools`
13. `test_level3_websocket_disconnect_during_send`
14. `test_level4_complete_event_stream_with_confirmation_tools`
15. `test_level4_mixed_event_types`
16. `test_level2_skips_id_mapping_with_none_frontend_delegate`
17. `test_bidi_frontend_delegate_tool_should_use_consistent_id`
18. `test_bidi_frontend_delegate_multiple_tools_id_consistency`
19. `test_bidi_vs_sse_frontend_delegate_tool_id_behavior`
20. `test_live_request_queue_during_blocking`
21. `test_long_running_tool_send_content_integration`
22. `test_send_content_minimal_example`
23. `test_sse_confirmation_event_sequence`

#### Errors:
- `test_approval_tool` - fixture 'message' not found
- `test_approval_tool_blocking` - fixture 'message' not found

### 5. Python E2E Tests
-  **42 passed**
- í **7 skipped**
-   **45 warnings** (deprecation warnings from ADK)
- ñ 155.99 seconds (2:35)
- **Status:** All passing (skipped tests are intentional for specific patterns)

#### Skipped Tests:
- `TestPattern2ADKSSEOnly::test_replays_chunks_in_fast_forward_mode`
- `TestPattern2ADKSSEOnly::test_contains_tool_invocation_chunks`
- `TestPattern3ADKBIDIOnly::test_replays_chunks_in_fast_forward_mode`
- `TestPattern3ADKBIDIOnly::test_contains_audio_chunks`
- `TestPattern4ModeSwitching::test_replays_chunks_from_multiple_modes`
- `TestPattern4ModeSwitching::test_preserves_chunk_order_across_mode_switches`
- `TestServerOutputStructure::test_get_location_approved_sse_structure_matches_baseline`

### 6. Playwright E2E Tests
-  **48 passed**
- L **13 failed**
- í **11 skipped**
-   **212 did not run** (likely due to global timeout)
- ñ 10 minutes 0 seconds
- **Status:** Multiple test failures, weather tool timeout tests still failing despite timeout fix

#### Failed Tests:
1. `SSE Error Handling : should handle request with very long message content`
2. `History Sharing Tests : should preserve history when switching from Gemini Direct to ADK SSE`
3. `Chunk Logger Integration - change_bgm : should maintain log consistency when changing BGM`
4. `Chunk Logger Integration - get_location : should maintain log consistency when approving location request`
5. `Chunk Logger Integration - get_weather : should maintain log consistency when requesting weather`
6. `Chunk Logger Integration Tests : should maintain log consistency when approving small payment`
7. `Chunk Player UI Verification : Pattern 2: ADK SSE only - should show token counts`
8. `Chunk Player UI Verification : Pattern 4: Mode switching - should preserve message history`
9. `Frontend Delegate Fix - Mode Switching : should handle tool approval correctly after switching from SSE to BIDI`
10. `Systematic Mode/Model Testing (P4-T4.4) : Mode switching preserves history`
11. `Systematic Mode/Model Testing (P4-T4.4) : Tool Usage : adk-sse: Weather tool`   **STILL FAILING**
12. `Systematic Mode/Model Testing (P4-T4.4) : Tool Usage : adk-bidi: Weather tool`   **STILL FAILING**
13. `Systematic Mode/Model Testing (P4-T4.4) : Long context (50+ messages)` - ReferenceError: `waitForResponse` is not defined

#### Skipped Tests (Gemini Direct backend):
- Backend Equivalence Tests for Gemini Direct (5 tests)
- Gemini Direct and ADK SSE equivalence test (1 test)
- Additional 5 skipped tests

## Critical Issues

### 1. Weather Tool Timeout (UNRESOLVED)
**Status:**   Still failing despite timeout configuration fix in commit 09556ca

**Tests Affected:**
- `adk-sse: Weather tool`
- `adk-bidi: Weather tool`

**Error:** Test timeout of 60000ms exceeded while waiting for assistant response

**Root Cause Analysis:**
The timeout configuration was added to the agent definition in `adk_ag_runner.py:144-148` and `adk_ag_runner.py:161-165`, but the tests are still timing out. This suggests one of:
1. The timeout configuration is not being applied correctly
2. There's a separate timeout happening before the LLM completes
3. The weather tool execution itself is taking too long

**Evidence:**
```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('main [data-testid="message-sender"]').filter({ hasText: 'Assistant' })
Expected: 2
Received: 1
```

The assistant message never appears, indicating the response never completes.

### 2. waitForResponse Undefined
**Test:** `Long context (50+ messages)`
**Error:** `ReferenceError: waitForResponse is not defined`
**Location:** `scenarios/features/mode-testing.spec.ts:338`

**Fix Required:** Replace `waitForResponse` with `waitForAssistantResponse` (the correct helper function name)

### 3. Python Integration Tests - Frontend Delegate Issues
**Status:**   Many BIDI event handling tests failing

**Common Patterns:**
- Tool ID mapping issues between frontend delegate and BIDI events
- Event sequence validation failures
- WebSocket disconnect handling
- Long-running tool integration failures

## Warnings Analysis

### Python Deprecation Warnings (74 total)
1. **ADK ResumabilityConfig** (2 warnings)
   - Experimental feature warnings from `adk_ag_runner.py:175, 183`
   - Non-critical, expected for experimental features

2. **ADK session.send deprecation** (24 warnings)
   - Location: `google/adk/models/gemini_llm_connection.py:98, 105`
   - Should migrate to: `send_client_content`, `send_realtime_input`, or `send_tool_response`
   - Affects: BIDI event handling and integration tests

3. **session parameter deprecation** (24 warnings)
   - Should use `user_id` and `session_id` instead
   - Affects: Live API integration tests

4. **Other deprecation warnings** (24 warnings)
   - `save_input_blobs_as_artifacts` deprecated in ADK runners
   - `AiohttpClientSession` inheritance discouraged

## Action Items

### High Priority
1.   **Investigate weather tool timeout failure**
   - The timeout configuration fix (09556ca) did not resolve the issue
   - Need to verify if configuration is being applied correctly
   - May need to increase timeout further or fix underlying issue

2.   **Fix waitForResponse reference error**
   - Simple fix: replace with `waitForAssistantResponse` in `mode-testing.spec.ts:338`

3.   **Debug history sharing test failure**
   - Test: "should preserve history when switching from Gemini Direct to ADK SSE"
   - Likely related to message schema compatibility between backends

### Medium Priority
4. =Ý **Address chunk logger integration test failures** (5 tests)
   - All chunk logger tests failing
   - Suggests log format or consistency issues

5. =Ý **Fix chunk player UI verification tests** (2 tests)
   - Pattern 2 and Pattern 4 tests failing
   - May be related to timeout or fixture loading

6. =Ý **Investigate frontend delegate mode switching** (1 test)
   - Tool approval handling after SSE’BIDI switch failing

### Low Priority
7. =' **Address Python integration test failures** (23 tests)
   - Mostly BIDI event handling integration issues
   - May require API changes or test updates

8. =' **Migrate deprecated ADK API usage**
   - Update `session.send` calls to new API
   - Update `session` parameter to `user_id`/`session_id`

## Notes
- The weather tool timeout issue was supposed to be fixed in commit 09556ca by adding timeout configuration
- However, both weather tool tests (adk-sse and adk-bidi) are still failing with the same timeout error
- This suggests the fix was ineffective and needs further investigation
- All Vitest tests (lib, app, components) are passing successfully
- Python E2E tests are healthy with only intentional skips
- Playwright tests show concerning pattern of failures around message history and tool handling
