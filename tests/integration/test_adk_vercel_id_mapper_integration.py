"""
Integration Tests: ADKVercelIDMapper + FrontendToolDelegate + ToolConfirmationInterceptor

These tests verify the integration of 4 components:
1. ADKVercelIDMapper - ID conversion layer
2. FrontendToolDelegate - Frontend tool execution management
3. ToolConfirmationInterceptor - Approval-required tool interception
4. StreamProtocolConverter (simulated) - Event stream processing

Purpose: Catch component integration issues before E2E tests.
"""

import asyncio
from unittest.mock import Mock

import pytest

from adk_vercel_id_mapper import ADKVercelIDMapper
from confirmation_interceptor import ToolConfirmationInterceptor
from services.frontend_tool_service import FrontendToolDelegate
from tests.utils.result_assertions import assert_ok


class TestADKVercelIDMapperIntegration:
    """Integration tests for ID mapper with related components."""

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
        """Create ToolConfirmationInterceptor with delegate."""
        return ToolConfirmationInterceptor(
            delegate=frontend_delegate,
            confirmation_tools=["process_payment", "delete_account"],
        )

    def test_normal_tool_registration_and_resolution(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        Test normal tool flow: Registration → Execution → Resolution

        Simulates StreamProtocolConverter registering a tool, then
        FrontendToolDelegate using the mapping for execution.
        """
        # given: StreamProtocolConverter receives function_call and registers it
        tool_name = "change_bgm"
        function_call_id = "function-call-12345"
        id_mapper.register(tool_name, function_call_id)

        # when: FrontendToolDelegate executes tool
        retrieved_id = id_mapper.get_function_call_id(tool_name)

        # then: ID is correctly retrieved
        assert retrieved_id == function_call_id

        # when: Frontend sends tool_result with function_call_id
        resolved_tool = id_mapper.resolve_tool_result(function_call_id)

        # then: Tool name is correctly resolved
        assert resolved_tool == tool_name

    def test_intercepted_tool_context_aware_resolution(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        Test intercepted tool flow with original_context for non-confirmation tools.

        Flow:
        1. process_payment is registered
        2. Some intercepted tool (not adk_request_confirmation) uses original_context
        3. ID mapper correctly resolves from original_context

        Note: adk_request_confirmation is a special case that uses its own ID,
              not the original tool's ID (to prevent Future collision bug).
        """
        # given: StreamProtocolConverter registers process_payment
        original_tool = "process_payment"
        function_call_id = "function-call-67890"
        id_mapper.register(original_tool, function_call_id)

        # when: Some intercepted tool (NOT adk_request_confirmation) provides original_context
        original_context = {"name": original_tool, "id": function_call_id}

        # FrontendToolDelegate executes with context-aware lookup
        retrieved_id = id_mapper.get_function_call_id(
            tool_name="some_intercepted_tool",  # Changed from adk_request_confirmation
            original_context=original_context,
        )

        # then: ID is resolved from original_context
        assert retrieved_id == function_call_id

        # when: Frontend sends tool result
        resolved_tool = id_mapper.resolve_tool_result(function_call_id)

        # then: Original tool name is resolved
        assert resolved_tool == original_tool

    def test_confirmation_prefixed_id_resolution(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        Test confirmation-prefixed ID handling.

        AI SDK v6 requires different IDs for separate UI rendering.
        Backend adds "confirmation-" prefix, frontend sends it back,
        ID mapper automatically strips it for resolution.
        """
        # given: Normal tool registered
        tool_name = "process_payment"
        original_id = "function-call-11111"
        id_mapper.register(tool_name, original_id)

        # when: Confirmation flow adds prefix
        confirmation_id = f"confirmation-{original_id}"

        # Frontend sends tool_result with prefixed ID
        resolved_tool = id_mapper.resolve_tool_result(confirmation_id)

        # then: Tool is resolved correctly (prefix stripped automatically)
        assert resolved_tool == tool_name

        # Additional check: Original ID still resolves correctly
        resolved_from_original = id_mapper.resolve_tool_result(original_id)
        assert resolved_from_original == tool_name

    def test_multiple_sequential_tool_calls(
        self,
        id_mapper: ADKVercelIDMapper,
    ) -> None:
        """
        Test multiple sequential tool calls with mapping overwrites.

        Ensures that when a tool is called multiple times with different IDs,
        the mapping is updated correctly and only the latest ID is active.
        """
        # given: First call to change_bgm
        tool_name = "change_bgm"
        first_id = "function-call-1"
        id_mapper.register(tool_name, first_id)

        # when: First call completes
        assert id_mapper.get_function_call_id(tool_name) == first_id

        # given: Second call to same tool (new ID)
        second_id = "function-call-2"
        id_mapper.register(tool_name, second_id)

        # then: Latest ID is returned
        assert id_mapper.get_function_call_id(tool_name) == second_id

        # and: Only latest ID resolves to tool name
        assert id_mapper.resolve_tool_result(second_id) == tool_name
        assert id_mapper.resolve_tool_result(first_id) is None  # Old mapping cleared

    @pytest.mark.asyncio
    async def test_full_approval_flow_integration(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        Test full approval flow integration.

        Simulates complete flow:
        1. StreamProtocolConverter registers tool
        2. ToolConfirmationInterceptor detects approval-required tool
        3. FrontendToolDelegate executes confirmation
        4. Frontend responds with approval
        5. Backend resolves and continues

        This test verifies that all components work together correctly.
        """
        # given: StreamProtocolConverter registers process_payment
        tool_name = "process_payment"
        function_call_id = "function-call-99999"
        confirmation_id = f"confirmation-{function_call_id}"

        id_mapper.register(tool_name, function_call_id)
        # In real flow, inject_confirmation_for_bidi() registers confirmation ID
        id_mapper.register("adk_request_confirmation", confirmation_id)

        # Mock function_call object
        function_call = Mock()
        function_call.name = tool_name
        function_call.id = function_call_id

        # when: ToolConfirmationInterceptor checks if interception is needed
        should_intercept = confirmation_interceptor._should_intercept(function_call)

        # then: Tool is flagged for interception
        assert should_intercept is True

        # when: Confirmation is requested (simulate frontend response)
        original_context = {"name": tool_name, "id": function_call_id}

        # Start confirmation execution in background
        async def simulate_frontend_response() -> None:
            """Simulate frontend sending approval after delay."""
            await asyncio.sleep(0.1)  # Simulate user interaction time

            # Frontend sends approval with confirmation-prefixed ID
            frontend_delegate.resolve_tool_result(
                confirmation_id,
                {"confirmed": True},
            )

        # Create future for confirmation
        confirmation_future = asyncio.create_task(simulate_frontend_response())

        # Start confirmation execution
        confirmation_task = asyncio.create_task(
            confirmation_interceptor.execute_confirmation(
                tool_call_id=function_call_id,
                original_function_call=original_context,
            ),
        )

        # Wait for both tasks
        await confirmation_future
        result_or_error = await confirmation_task
        result = assert_ok(result_or_error)

        # then: Confirmation result is received
        assert result["confirmed"] is True

    @pytest.mark.asyncio
    async def test_concurrent_tool_calls(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        Test concurrent tool calls with different tools.

        Ensures multiple tools can be in flight simultaneously
        without ID conflicts or mapping corruption.
        """
        # given: Multiple tools registered concurrently
        tools = [
            ("change_bgm", "function-call-100"),
            ("get_location", "function-call-101"),
            ("get_weather", "function-call-102"),
        ]

        for tool_name, fc_id in tools:
            id_mapper.register(tool_name, fc_id)

        # when: All tools are resolved concurrently
        async def resolve_tool(tool_name: str, expected_id: str) -> bool:
            """Resolve tool and verify ID."""
            retrieved_id = id_mapper.get_function_call_id(tool_name)
            return retrieved_id == expected_id

        # Execute all lookups concurrently
        results = await asyncio.gather(
            *[resolve_tool(name, fc_id) for name, fc_id in tools],
        )

        # then: All tools resolve correctly
        assert all(results)

        # when: All tools send results concurrently
        async def resolve_result(fc_id: str, expected_tool: str) -> bool:
            """Resolve result and verify tool name."""
            resolved = id_mapper.resolve_tool_result(fc_id)
            return resolved == expected_tool

        # Execute all reverse lookups concurrently
        reverse_results = await asyncio.gather(
            *[resolve_result(fc_id, name) for name, fc_id in tools],
        )

        # then: All results resolve correctly
        assert all(reverse_results)

    def test_edge_case_empty_original_context(
        self,
        id_mapper: ADKVercelIDMapper,
    ) -> None:
        """
        Test edge case: original_context is provided but empty.

        Should fall back to direct tool_name lookup.
        """
        # given: Tool registered
        tool_name = "change_bgm"
        function_call_id = "function-call-edge1"
        id_mapper.register(tool_name, function_call_id)

        # when: Lookup with empty original_context
        retrieved_id = id_mapper.get_function_call_id(
            tool_name=tool_name,
            original_context={},  # Empty context
        )

        # then: Falls back to direct lookup
        assert retrieved_id == function_call_id

    def test_edge_case_invalid_confirmation_prefix(
        self,
        id_mapper: ADKVercelIDMapper,
    ) -> None:
        """
        Test edge case: ID has "confirmation-" prefix but not registered.

        Should return None (no crash).
        """
        # given: No tool registered
        confirmation_id = "confirmation-function-call-nonexistent"

        # when: Attempt to resolve
        resolved = id_mapper.resolve_tool_result(confirmation_id)

        # then: Returns None gracefully
        assert resolved is None

    def test_clear_mappings(
        self,
        id_mapper: ADKVercelIDMapper,
    ) -> None:
        """
        Test clearing all mappings.

        Useful for session cleanup or testing.
        """
        # given: Multiple tools registered
        id_mapper.register("tool1", "id1")
        id_mapper.register("tool2", "id2")
        id_mapper.register("tool3", "id3")

        # when: Clear all mappings
        id_mapper.clear()

        # then: All lookups return None
        assert id_mapper.get_function_call_id("tool1") is None
        assert id_mapper.get_function_call_id("tool2") is None
        assert id_mapper.get_function_call_id("tool3") is None
        assert id_mapper.resolve_tool_result("id1") is None
        assert id_mapper.resolve_tool_result("id2") is None
        assert id_mapper.resolve_tool_result("id3") is None
