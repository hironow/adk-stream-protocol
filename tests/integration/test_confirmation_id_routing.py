"""
Integration Test: Confirmation ID Routing Bug Detection

This test reproduces the E2E bug where:
1. Backend sends both get_location and adk_request_confirmation tool-input-available
2. Frontend auto-executes get_location (WRONG!)
3. Frontend sends get_location result with confirmation ID (WRONG!)
4. Backend confirmation Future receives location data instead of {confirmed: true/false}

Expected: RED (FAIL) until bug is fixed
Purpose: Detect ID routing issues BEFORE E2E tests
"""


import asyncio

import pytest

from adk_vercel_id_mapper import ADKVercelIDMapper
from confirmation_interceptor import ToolConfirmationInterceptor
from services.frontend_tool_service import FrontendToolDelegate
from tests.utils.result_assertions import assert_ok


class TestConfirmationIDRouting:
    """Test that confirmation tool results don't get mixed with original tool results."""

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
        """Create ToolConfirmationInterceptor with get_location as approval-required."""
        return ToolConfirmationInterceptor(
            delegate=frontend_delegate,
            confirmation_tools=["get_location"],
        )

    @pytest.mark.asyncio
    async def test_confirmation_future_should_not_receive_original_tool_result(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        Verify confirmation Future receives correct confirmation data.

        Scenario (after bug fix):
        1. Backend registers get_location with ID "function-call-123"
        2. Backend registers confirmation with ID "confirmation-function-call-123"
        3. Backend starts confirmation flow
        4. Frontend sends confirmation data to confirmation ID (CORRECT!)
        5. Backend confirmation Future receives {confirmed: ...} (CORRECT!)

        Expected Result: PASS (GREEN) - After fix, confirmation Future uses separate ID
        Success Criteria: Confirmation Future receives {confirmed: true/false}, not tool data
        """
        # given: Backend registers approval-required tool
        tool_name = "get_location"
        function_call_id = "function-call-18130723512511572936"
        confirmation_id = f"confirmation-{function_call_id}"

        id_mapper.register(tool_name, function_call_id)
        # In real flow, inject_confirmation_for_bidi() registers confirmation ID
        id_mapper.register("adk_request_confirmation", confirmation_id)

        # Simulate CORRECT frontend behavior (after fix)
        async def simulate_correct_frontend() -> None:
            """
            After the fix, frontend should:
            1. Send confirmation data to confirmation ID (CORRECT!)
            2. Send location data to original ID (if approved)
            """
            await asyncio.sleep(0.044)  # 44ms delay observed in E2E logs

            # CORRECT: Frontend sends confirmation result with CONFIRMATION ID
            confirmation_data = {"confirmed": True}

            # This is what SHOULD happen after the fix
            frontend_delegate.resolve_tool_result(confirmation_id, confirmation_data)

        frontend_task = asyncio.create_task(simulate_correct_frontend())

        # when: Backend executes confirmation flow
        original_context = {"name": tool_name, "id": function_call_id}

        confirmation_result_or_error = await confirmation_interceptor.execute_confirmation(
            tool_call_id=function_call_id,
            original_function_call=original_context,
        )

        # then: Confirmation result should be {confirmed: true/false}
        #       NOT location data!
        #
        # After the fix, confirmation_result should contain correct confirmation data
        confirmation_result = assert_ok(confirmation_result_or_error)
        assert "confirmed" in confirmation_result, (
            f"Expected confirmation result to have 'confirmed' field, "
            f"but got: {confirmation_result}. "
            f"This indicates the confirmation Future was resolved with "
            f"the wrong data (likely original tool result)."
        )

        assert isinstance(confirmation_result["confirmed"], bool), (
            f"Expected 'confirmed' to be bool, got: {type(confirmation_result['confirmed'])}"
        )

        # Confirmation properly received {confirmed: ...}
        # Bug is fixed!
        await frontend_task

    @pytest.mark.asyncio
    async def test_confirmation_id_prefix_should_route_to_separate_future(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        Test ID mapper correctly handles confirmation- prefix.

        Verifies:
        1. Original tool: function-call-123
        2. Confirmation: confirmation-function-call-123
        3. Results sent to confirmation ID should resolve confirmation Future
        4. Results sent to original ID should resolve original Future

        Expected: FAIL (RED) with current buggy implementation
        After fix: PASS (GREEN) when ID mapper works correctly
        """
        # given: Two separate Futures for original tool and confirmation
        original_id = "function-call-123"
        confirmation_id = f"confirmation-{original_id}"

        # Register both IDs
        id_mapper.register("get_location", original_id)
        id_mapper.register("adk_request_confirmation", confirmation_id)

        # Simulate frontend responses in background
        async def simulate_frontend_responses() -> None:
            await asyncio.sleep(0.05)

            # Send confirmation result to confirmation ID
            frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

            # Send location result to original ID
            frontend_delegate.resolve_tool_result(
                original_id, {"latitude": 35.6762, "longitude": 139.6503}
            )

        response_task = asyncio.create_task(simulate_frontend_responses())

        # when: Create two separate futures using ID mapper
        # BUG: original_context causes ID mapper to return WRONG ID
        async def wait_for_original() -> dict:
            result_or_error = await frontend_delegate.execute_on_frontend(
                tool_name="get_location",
                args={},
            )
            return assert_ok(result_or_error)

        async def wait_for_confirmation() -> dict:
            result_or_error = await frontend_delegate.execute_on_frontend(
                tool_name="adk_request_confirmation",
                args={"originalFunctionCall": {"id": original_id, "name": "get_location"}},
                original_context={"id": original_id, "name": "get_location"},
            )
            return assert_ok(result_or_error)

        # Create tasks concurrently
        original_task = asyncio.create_task(wait_for_original())
        confirmation_task = asyncio.create_task(wait_for_confirmation())

        # then: Each Future should receive CORRECT data
        # BUG: Both tasks wait on same ID (original_id) due to ID mapper bug
        # The second Future overwrites the first one, causing original_task to hang
        try:
            confirmation_result = await asyncio.wait_for(confirmation_task, timeout=0.2)
            assert "confirmed" in confirmation_result, (
                f"Expected confirmation result with 'confirmed' field, "
                f"but got: {confirmation_result}. "
                f"This indicates ID mapper returned wrong ID for confirmation tool."
            )

            original_result = await asyncio.wait_for(original_task, timeout=0.2)
            assert "latitude" in original_result
            assert original_result["latitude"] == 35.6762

            await response_task
        except TimeoutError:
            pytest.fail(
                "Test timed out waiting for results. This indicates both Futures "
                "are using the same ID (original_id) due to ID mapper bug. "
                "The second Future overwrites the first, causing original_task to hang."
            )

    @pytest.mark.asyncio
    async def test_wrong_id_should_not_resolve_future(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
    ) -> None:
        """
        Test that sending result with wrong ID doesn't resolve Future.

        This tests the error case:
        - Future waiting on ID "function-call-123"
        - Result sent with ID "confirmation-function-call-456"
        - Future should NOT resolve (timeout expected)

        Expected: PASS (GREEN) - Wrong ID should be rejected
        """
        # given: Future waiting on specific ID
        tool_id = "function-call-original"
        wrong_id = "confirmation-function-call-wrong"

        id_mapper.register("get_location", tool_id)

        async def wait_with_timeout() -> dict | None:
            try:
                result_or_error = await asyncio.wait_for(
                    frontend_delegate.execute_on_frontend(
                        tool_name="get_location",
                        args={},
                    ),
                    timeout=0.1,
                )
                return assert_ok(result_or_error)
            except TimeoutError:
                return None

        future_task = asyncio.create_task(wait_with_timeout())

        # when: Send result with WRONG ID
        await asyncio.sleep(0.05)
        frontend_delegate.resolve_tool_result(wrong_id, {"data": "wrong"})

        # then: Future should timeout (NOT resolve with wrong data)
        result = await future_task
        assert result is None, "Future should timeout, not resolve with wrong data"

    @pytest.mark.asyncio
    async def test_confirmation_interceptor_should_register_confirmation_id(
        self,
        id_mapper: ADKVercelIDMapper,
        frontend_delegate: FrontendToolDelegate,
        confirmation_interceptor: ToolConfirmationInterceptor,
    ) -> None:
        """
        ToolConfirmationInterceptor should register confirmation ID in ID mapper.

        Current behavior (BUG):
        - Confirmation ID is generated but never registered in ID mapper
        - execute_on_frontend() uses original_context to get ID
        - ID mapper returns original tool's ID instead of confirmation ID
        - Future is registered with wrong ID

        Expected: FAIL (RED) - confirmation ID is not registered
        After fix: PASS (GREEN) - confirmation ID is registered before execute_on_frontend
        """
        # given: Tool is registered with original ID
        original_id = "function-call-18130723512511572936"
        confirmation_id = f"confirmation-{original_id}"
        id_mapper.register("get_location", original_id)
        # In real flow, inject_confirmation_for_bidi() registers confirmation ID
        id_mapper.register("adk_request_confirmation", confirmation_id)

        # Simulate frontend approval response
        async def simulate_approval() -> None:
            await asyncio.sleep(0.05)
            # Frontend sends approval with confirmation ID
            frontend_delegate.resolve_tool_result(confirmation_id, {"confirmed": True})

        approval_task = asyncio.create_task(simulate_approval())

        # when: Execute confirmation flow
        # This SHOULD register confirmation ID in mapper
        original_context = {"name": "get_location", "id": original_id}

        try:
            result_or_error = await asyncio.wait_for(
                confirmation_interceptor.execute_confirmation(
                    tool_call_id=original_id,
                    original_function_call=original_context,
                ),
                timeout=0.2,
            )
            result = assert_ok(result_or_error)

            # then: Confirmation ID should be registered in mapper
            registered_id = id_mapper.get_function_call_id("adk_request_confirmation")
            assert registered_id == confirmation_id, (
                f"Expected confirmation ID '{confirmation_id}' to be registered in mapper, "
                f"but got: {registered_id}. "
                f"ToolConfirmationInterceptor should register confirmation ID "
                f"before calling execute_on_frontend()."
            )

            # And confirmation result should be correct
            assert "confirmed" in result
            assert result["confirmed"] is True

            await approval_task
        except TimeoutError:
            pytest.fail(
                "Confirmation flow timed out. This likely means confirmation ID "
                "was not registered, causing Future to wait on wrong ID."
            )
