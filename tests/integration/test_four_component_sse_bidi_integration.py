"""
Integration Tests: 4-Component Integration (SSE + BIDI modes)

Tests the integration of 4 core components across SSE and BIDI modes:
1. ADKVercelIDMapper - ID conversion layer
2. FrontendToolDelegate - Frontend tool execution management
3. ToolConfirmationInterceptor - Approval-required tool interception
4. StreamProtocolConverter - Event stream processing

Test Strategy:
- SSE Mode: Native confirmation mechanism (already working)
- BIDI Mode (approval不要): Direct tool execution (already working)
- BIDI Mode (approval必要): inject_confirmation_for_bidi() - RED pattern (未完成)

Purpose: Verify 4 components work together correctly before E2E tests.
Expected Results: Some tests PASS (GREEN), some FAIL (RED) until implementation complete.
"""

from __future__ import annotations

import asyncio
from unittest.mock import Mock

import pytest

from adk_vercel_id_mapper import ADKVercelIDMapper
from confirmation_interceptor import ToolConfirmationInterceptor
from services.frontend_tool_service import FrontendToolDelegate


class TestFourComponentSSEBIDIIntegration:
    """Integration tests for 4-component collaboration in SSE and BIDI modes."""

    @pytest.fixture
    def id_mapper(self) -> ADKVercelIDMapper:
        """Create fresh ID mapper instance."""
        return ADKVercelIDMapper()

    @pytest.fixture
    def frontend_delegate(self, id_mapper: ADKVercelIDMapper) -> FrontendToolDelegate:
        """Create FrontendToolDelegate with ID mapper."""
        return FrontendToolDelegate(id_mapper=id_mapper)

    @pytest.fixture
    def confirmation_interceptor(
        self,
        frontend_delegate: FrontendToolDelegate,
    ) -> ToolConfirmationInterceptor:
        """Create ToolConfirmationInterceptor with process_payment as approval-required."""
        return ToolConfirmationInterceptor(
            delegate=frontend_delegate,
            confirmation_tools=["process_payment"],
        )

    # ========== SSE Mode Tests (Expected: GREEN - already working) ==========

    @pytest.mark.asyncio
    async def test_sse_mode_approval_not_required_tool_succeeds(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        SSE Mode: approval不要ツール (change_bgm) の成功フロー.

        Flow:
        1. StreamProtocolConverter registers change_bgm with function_call.id
        2. Tool executes on frontend via FrontendToolDelegate
        3. Frontend sends result back
        4. Result is resolved

        Expected: PASS (GREEN) - This flow is already working
        """
        # given: StreamProtocolConverter registers tool
        tool_name = "change_bgm"
        function_call_id = "function-call-sse-1"
        id_mapper.register(tool_name, function_call_id)

        # Simulate frontend response in background
        async def simulate_frontend_response() -> None:
            await asyncio.sleep(0.05)
            frontend_delegate.resolve_tool_result(function_call_id, {"success": True, "track": 1})

        response_task = asyncio.create_task(simulate_frontend_response())

        # when: Tool executes on frontend
        result = await frontend_delegate.execute_on_frontend(
            tool_name=tool_name,
            args={"track": 1},
            tool_call_id=function_call_id,
        )

        # then: Result is successfully received
        assert result == {"success": True, "track": 1}

        await response_task

    @pytest.mark.asyncio
    async def test_sse_mode_approval_required_tool_uses_native_confirmation(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        SSE Mode: approval必要ツール (process_payment) はnative confirmationを使用.

        Flow:
        1. StreamProtocolConverter registers process_payment
        2. ToolConfirmationInterceptor detects it requires approval
        3. In SSE mode: Uses ADK's native confirmation (not inject_confirmation_for_bidi)
        4. Tool executes after approval

        Expected: PASS (GREEN) - SSE mode uses native confirmation which works
        """
        # given: StreamProtocolConverter registers approval-required tool
        tool_name = "process_payment"
        function_call_id = "function-call-sse-2"
        id_mapper.register(tool_name, function_call_id)

        # Mock function_call for interception check
        function_call = Mock()
        function_call.name = tool_name
        function_call.id = function_call_id

        # when: Check if tool requires approval
        requires_approval = confirmation_interceptor.should_intercept(function_call)

        # then: Tool is correctly identified as requiring approval
        assert requires_approval is True

        # Note: In SSE mode, ADK's native confirmation is used (not tested here)
        # This test just verifies the interceptor correctly identifies the tool

    # ========== BIDI Mode Tests (approval不要) - Expected: GREEN ==========

    @pytest.mark.asyncio
    async def test_bidi_mode_approval_not_required_tool_succeeds(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        BIDI Mode: approval不要ツール (change_bgm) の成功フロー.

        Flow:
        1. StreamProtocolConverter registers change_bgm with function_call.id
        2. Tool executes directly on frontend (no confirmation needed)
        3. Frontend sends result back
        4. Result is resolved

        Expected: PASS (GREEN) - BIDI mode works for non-approval tools
        """
        # given: StreamProtocolConverter registers tool
        tool_name = "change_bgm"
        function_call_id = "function-call-bidi-1"
        id_mapper.register(tool_name, function_call_id)

        # Simulate frontend response in background
        async def simulate_frontend_response() -> None:
            await asyncio.sleep(0.05)
            frontend_delegate.resolve_tool_result(function_call_id, {"success": True, "track": 2})

        response_task = asyncio.create_task(simulate_frontend_response())

        # when: Tool executes on frontend in BIDI mode
        result = await frontend_delegate.execute_on_frontend(
            tool_name=tool_name,
            args={"track": 2},
            tool_call_id=function_call_id,
        )

        # then: Result is successfully received
        assert result == {"success": True, "track": 2}

        await response_task

    # ========== BIDI Mode Tests (approval必要) - Expected: Partial Success ==========

    @pytest.mark.asyncio
    async def test_bidi_mode_approval_required_confirmation_succeeds(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        BIDI Mode: approval必要ツール (process_payment) - confirmation取得まで.

        Flow:
        1. StreamProtocolConverter registers process_payment with function_call.id
        2. ToolConfirmationInterceptor detects approval required
        3. Confirmation request is sent to frontend
        4. Frontend sends approval
        5. Confirmation result is received ✅

        Expected: PASS (GREEN) - This part of the flow works

        Note: This test verifies confirmation collection works.
        The next test (test_bidi_mode_original_tool_execution_after_approval)
        will verify the MISSING part: original tool execution after approval.
        """
        # given: StreamProtocolConverter registers approval-required tool
        tool_name = "process_payment"
        function_call_id = "function-call-bidi-2"
        confirmation_id = f"confirmation-{function_call_id}"

        id_mapper.register(tool_name, function_call_id)
        # In real flow, inject_confirmation_for_bidi() registers confirmation ID
        id_mapper.register("adk_request_confirmation", confirmation_id)

        # Simulate user approval in background
        async def simulate_approval() -> None:
            await asyncio.sleep(0.05)
            # Frontend sends approval for confirmation tool
            frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

        approval_task = asyncio.create_task(simulate_approval())

        # when: Execute confirmation flow (via ToolConfirmationInterceptor)
        original_context = {"name": tool_name, "id": function_call_id}

        result = await confirmation_interceptor.execute_confirmation(
            tool_call_id=function_call_id,
            original_function_call=original_context,
        )

        # then: Confirmation result is received successfully
        assert result["confirmed"] is True

        await approval_task

    @pytest.mark.asyncio
    async def test_bidi_mode_original_tool_execution_after_approval_is_missing(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        BIDI Mode: approval後のoriginal tool実行 - RED pattern documentation.

        This test documents the MISSING implementation in inject_confirmation_for_bidi().

        Current State (adk_compat.py:385-406):
        - inject_confirmation_for_bidi() yields confirmation events ✅
        - Waits for frontend approval ✅
        - Gets confirmation result ✅
        - Returns from generator ❌ (should continue to execute original tool)

        Expected Flow (not yet implemented):
        1. Confirmation events generated → frontend displays approval UI
        2. User approves → frontend sends confirmation result
        3. Original tool (process_payment) executes ← MISSING
        4. Original tool result events generated ← MISSING
        5. Frontend displays original tool result ← MISSING

        This test is a placeholder to document the missing functionality.
        When inject_confirmation_for_bidi() is completed, this test can be
        converted to verify the complete flow.

        Expected: This test currently just documents the issue (not a real test)
        """
        # This is a documentation test, not an executable test
        # The actual RED pattern is visible in E2E tests:
        # - e2e/tools/process-payment-bidi.spec.ts shows "Executing..." forever
        # - Frontend never receives tool-output-available for process_payment

        # To fix this, adk_compat.py:inject_confirmation_for_bidi() needs to:
        # 1. After getting confirmation result (line 385-386)
        # 2. If confirmed is True:
        #    - Execute original tool with original args
        #    - Yield tool-result event for confirmation tool
        #    - Yield tool-output events for original tool
        # 3. If confirmed is False:
        #    - Yield tool-result event for confirmation tool
        #    - Yield text content explaining denial
        #    - Do NOT execute original tool

        # Placeholder assertion (always passes)
        assert True, "Documentation test: Original tool execution is not implemented"

    @pytest.mark.asyncio
    async def test_bidi_mode_confirmation_id_mapping_works(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        BIDI Mode: confirmation- prefix ID mapping 動作確認.

        Verifies that confirmation-prefixed IDs are correctly resolved
        by ADKVercelIDMapper and FrontendToolDelegate.

        Expected: PASS (GREEN) - ID mapping works correctly
        """
        # given: Tool registered
        tool_name = "process_payment"
        original_id = "function-call-bidi-3"
        id_mapper.register(tool_name, original_id)

        # when: Frontend sends result with confirmation- prefix
        confirmation_id = f"confirmation-{original_id}"

        # ADKVercelIDMapper should resolve confirmation-prefixed ID
        resolved_tool = id_mapper.resolve_tool_result(confirmation_id)

        # then: Tool name is correctly resolved
        assert resolved_tool == tool_name

        # and: FrontendToolDelegate should also handle prefixed IDs
        # Simulate execution
        async def simulate_confirmation_response() -> None:
            await asyncio.sleep(0.05)
            frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

        response_task = asyncio.create_task(simulate_confirmation_response())

        # Execute with original_id
        result = await frontend_delegate.execute_on_frontend(
            tool_name="adk_request_confirmation",
            args={},
            tool_call_id=original_id,
        )

        # then: Result is resolved despite prefixed ID
        assert result == {"confirmed": True}

        await response_task

    # ========== Component Integration Verification ==========

    def test_four_components_wired_correctly(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        Verify all 4 components are correctly wired together.

        Components:
        1. ADKVercelIDMapper - ID conversion
        2. FrontendToolDelegate - Tool execution
        3. ToolConfirmationInterceptor - Approval detection
        4. (StreamProtocolConverter simulated via manual registration)

        Expected: PASS (GREEN) - Wiring is correct
        """
        # 1. ADKVercelIDMapper is used by FrontendToolDelegate
        assert frontend_delegate.id_mapper is id_mapper

        # 2. ToolConfirmationInterceptor uses FrontendToolDelegate
        assert confirmation_interceptor.delegate is frontend_delegate

        # 3. ToolConfirmationInterceptor has correct confirmation_tools
        assert "process_payment" in confirmation_interceptor.confirmation_tools

        # 4. ID mapper is shared between components
        tool_name = "test_tool"
        function_call_id = "test-id-123"
        id_mapper.register(tool_name, function_call_id)

        # Both FrontendToolDelegate and ADKVercelIDMapper should see the mapping
        assert id_mapper.get_function_call_id(tool_name) == function_call_id
        assert frontend_delegate.id_mapper.get_function_call_id(tool_name) == function_call_id

    # ========== [DONE] Stream Lifecycle Principle Integration Tests (TDD RED) ==========

    @pytest.mark.asyncio
    async def test_inject_confirmation_integrated_with_components_should_not_send_done(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        Integration Test (TDD RED): inject_confirmation_for_bidi with real components should NOT send [DONE].

        Design Principle (Session 7):
            [DONE] should ONLY be sent from finalize().

        Integration Scope:
            This test verifies the principle in a more realistic environment where:
            - ADKVercelIDMapper tracks IDs
            - FrontendToolDelegate executes frontend tools
            - ToolConfirmationInterceptor manages approval flow
            - inject_confirmation_for_bidi orchestrates the flow

        Test Strategy:
            - Given: Real 4-component integration with process_payment tool
            - When: inject_confirmation_for_bidi processes confirmation-required event
            - Then: Generated events should NOT contain [DONE] marker

        Expected Result:
            This test will FAIL (RED) until adk_compat.py:372 is removed.
        """
        from adk_compat import inject_confirmation_for_bidi

        # given: process_payment FunctionCall event
        function_call_id = "call-integration-test"
        tool_name = "process_payment"

        # Register tool in ID mapper (simulating StreamProtocolConverter behavior)
        id_mapper.register(tool_name, function_call_id)

        function_call_event = {
            "type": "function_call",
            "function_call": {
                "id": function_call_id,
                "name": tool_name,
                "args": {"amount": 200, "recipient": "IntegrationTest"},
            },
            "actions": {
                "requested_tool_confirmations": [
                    {
                        "id": function_call_id,
                        "name": tool_name,
                    }
                ]
            },
        }

        # Simulate user approval and tool execution in background
        async def simulate_approval_and_execution() -> None:
            await asyncio.sleep(0.05)
            # User approves
            confirmation_id = f"confirmation-{function_call_id}"
            frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

            # Wait a bit for confirmation to process
            await asyncio.sleep(0.05)

            # Original tool executes
            frontend_delegate.resolve_tool_result(function_call_id, {"success": True, "amount": 200})

        response_task = asyncio.create_task(simulate_approval_and_execution())

        # when: Process event through inject_confirmation_for_bidi
        results = []
        async for event in inject_confirmation_for_bidi(
            function_call_event,
            is_bidi=True,
            interceptor=confirmation_interceptor,
            confirmation_tools=["process_payment"],
        ):
            results.append(event)

        # then: Results should NOT contain [DONE] marker
        done_violations = []
        for i, event in enumerate(results):
            if isinstance(event, str) and "[DONE]" in event:
                done_violations.append((i, event))

        assert len(done_violations) == 0, (
            f"Integration Test FAILED: inject_confirmation_for_bidi violated design principle "
            f"at {len(done_violations)} location(s) when integrated with real components:\n"
            f"[DONE] should ONLY be sent from finalize(), not from inject_confirmation_for_bidi.\n"
            f"\nViolations found:\n"
            + "\n".join([f"  Position {i}: {event!r}" for i, event in done_violations])
            + "\n\nComponents involved:"
            "\n  - ADKVercelIDMapper: ID tracking"
            "\n  - FrontendToolDelegate: Tool execution"
            "\n  - ToolConfirmationInterceptor: Approval management"
            "\n  - inject_confirmation_for_bidi: Flow orchestration"
            "\n\nCurrent implementation: adk_compat.py:372 sends 'data: [DONE]\\n\\n'"
            "\nExpected: Remove line 372 and rely on finalize() for [DONE] transmission."
        )

        await response_task
