"""
Unit tests for confirmation_interceptor.py (BIDI mode confirmation).

Tests ToolConfirmationInterceptor's responsibilities:
- Identifying confirmation-required tools (should_intercept)
- Executing confirmation flow via FrontendToolDelegate
- Blocking until user approves/denies
- Proper integration with FrontendToolDelegate

Design Context:
- SSE Mode: ADK natively generates adk_request_confirmation (not tested here)
- BIDI Mode: Manual interception required (tested here)
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, Mock

import pytest
from google.genai import types

from adk_vercel_id_mapper import ADKVercelIDMapper
from confirmation_interceptor import ToolConfirmationInterceptor
from services.frontend_tool_service import FrontendToolDelegate

# ============================================================
# Initialization Tests
# ============================================================


def test_interceptor_initialization() -> None:
    """ToolConfirmationInterceptor should store delegate and confirmation tools."""
    # given
    delegate = FrontendToolDelegate()
    confirmation_tools = ["process_payment", "delete_account"]

    # when
    interceptor = ToolConfirmationInterceptor(delegate, confirmation_tools)

    # then
    assert interceptor.delegate is delegate
    assert interceptor.confirmation_tools == {"process_payment", "delete_account"}


def test_interceptor_stores_tools_as_set() -> None:
    """confirmation_tools should be converted to set for O(1) lookup."""
    # given
    delegate = FrontendToolDelegate()
    confirmation_tools = ["tool_a", "tool_b", "tool_a"]  # Duplicate

    # when
    interceptor = ToolConfirmationInterceptor(delegate, confirmation_tools)

    # then
    assert isinstance(interceptor.confirmation_tools, set)
    assert len(interceptor.confirmation_tools) == 2  # Duplicates removed


def test_interceptor_empty_confirmation_tools() -> None:
    """Interceptor should handle empty confirmation_tools list."""
    # given
    delegate = FrontendToolDelegate()

    # when
    interceptor = ToolConfirmationInterceptor(delegate, [])

    # then
    assert interceptor.confirmation_tools == set()


# ============================================================
# should_intercept Tests
# ============================================================


def test_should_intercept_returns_true_for_confirmation_tool() -> None:
    """should_intercept() should return True for tools in confirmation_tools."""
    # given
    delegate = FrontendToolDelegate()
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    function_call = types.FunctionCall(
        id="call_123",
        name="process_payment",
        args={"amount": 100},
    )

    # when
    result = interceptor.should_intercept(function_call)

    # then
    assert result is True


def test_should_intercept_returns_false_for_non_confirmation_tool() -> None:
    """should_intercept() should return False for tools NOT in confirmation_tools."""
    # given
    delegate = FrontendToolDelegate()
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    function_call = types.FunctionCall(
        id="call_456",
        name="get_weather",
        args={"location": "Tokyo"},
    )

    # when
    result = interceptor.should_intercept(function_call)

    # then
    assert result is False


def test_should_intercept_case_sensitive() -> None:
    """should_intercept() should be case-sensitive."""
    # given
    delegate = FrontendToolDelegate()
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    function_call = types.FunctionCall(
        id="call_789",
        name="Process_Payment",  # Different case
        args={},
    )

    # when
    result = interceptor.should_intercept(function_call)

    # then
    assert result is False


def test_should_intercept_multiple_confirmation_tools() -> None:
    """should_intercept() should work with multiple confirmation tools."""
    # given
    delegate = FrontendToolDelegate()
    interceptor = ToolConfirmationInterceptor(
        delegate,
        ["process_payment", "delete_account", "transfer_funds"],
    )

    # when/then
    payment_call = types.FunctionCall(id="1", name="process_payment", args={})
    assert interceptor.should_intercept(payment_call) is True

    delete_call = types.FunctionCall(id="2", name="delete_account", args={})
    assert interceptor.should_intercept(delete_call) is True

    transfer_call = types.FunctionCall(id="3", name="transfer_funds", args={})
    assert interceptor.should_intercept(transfer_call) is True

    weather_call = types.FunctionCall(id="4", name="get_weather", args={})
    assert interceptor.should_intercept(weather_call) is False


# ============================================================
# execute_confirmation Tests (Approval Flow)
# ============================================================


@pytest.mark.asyncio
async def test_execute_confirmation_approved() -> None:
    """execute_confirmation() should delegate to frontend and return approval result."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "function-call-123")
    # Register adk_request_confirmation with its own ID for the confirmation flow
    id_mapper.register("adk_request_confirmation", "function-call-123")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    original_fc = {"id": "function-call-123", "name": "process_payment", "args": {"amount": 100}}

    # when
    async def simulate_user_approval() -> None:
        await asyncio.sleep(0.01)
        # Simulate frontend sending approval result
        # The frontend would resolve with the original ID
        delegate.resolve_tool_result("function-call-123", {"confirmed": True})

    approval_task = asyncio.create_task(simulate_user_approval())
    result = await interceptor.execute_confirmation("function-call-123", original_fc)
    await approval_task

    # then
    assert result == {"confirmed": True}


@pytest.mark.asyncio
async def test_execute_confirmation_denied() -> None:
    """execute_confirmation() should return denial result when user denies."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "function-call-456")
    id_mapper.register("adk_request_confirmation", "function-call-456")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    original_fc = {"id": "function-call-456", "name": "process_payment", "args": {"amount": 200}}

    # when
    async def simulate_user_denial() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("function-call-456", {"confirmed": False})

    denial_task = asyncio.create_task(simulate_user_denial())
    result = await interceptor.execute_confirmation("function-call-456", original_fc)
    await denial_task

    # then
    assert result == {"confirmed": False}


@pytest.mark.asyncio
async def test_execute_confirmation_calls_delegate_with_correct_args() -> None:
    """execute_confirmation() should call delegate.execute_on_frontend with correct arguments."""
    # given
    mock_delegate = Mock(spec=FrontendToolDelegate)
    mock_delegate.execute_on_frontend = AsyncMock(return_value={"confirmed": True})

    interceptor = ToolConfirmationInterceptor(mock_delegate, ["process_payment"])

    original_fc = {"id": "call_789", "name": "process_payment", "args": {"amount": 300}}

    # when
    result = await interceptor.execute_confirmation("call_789", original_fc)

    # then
    mock_delegate.execute_on_frontend.assert_called_once()
    call_kwargs = mock_delegate.execute_on_frontend.call_args.kwargs

    assert call_kwargs["tool_name"] == "adk_request_confirmation"
    assert call_kwargs["args"]["originalFunctionCall"] == original_fc
    assert call_kwargs["args"]["toolConfirmation"] == {"confirmed": False}
    assert call_kwargs["original_context"] == original_fc
    assert result == {"confirmed": True}


@pytest.mark.asyncio
async def test_execute_confirmation_with_different_tool_names() -> None:
    """execute_confirmation() should work with different confirmation tools."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("delete_account", "delete-call-999")
    id_mapper.register("adk_request_confirmation", "delete-call-999")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(
        delegate,
        ["process_payment", "delete_account"],
    )

    original_fc = {"id": "delete-call-999", "name": "delete_account", "args": {"user_id": 42}}

    # when
    async def simulate_approval() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("delete-call-999", {"confirmed": True})

    approval_task = asyncio.create_task(simulate_approval())
    result = await interceptor.execute_confirmation("delete-call-999", original_fc)
    await approval_task

    # then
    assert result == {"confirmed": True}


# ============================================================
# execute_confirmation Tests (Error Handling)
# ============================================================


@pytest.mark.asyncio
async def test_execute_confirmation_timeout_propagation() -> None:
    """execute_confirmation() should propagate timeout from FrontendToolDelegate."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("adk_request_confirmation", "timeout-call")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    original_fc = {"id": "timeout-call", "name": "process_payment", "args": {}}

    # when/then - Should timeout after 5 seconds (no resolution)
    with pytest.raises(
        TimeoutError,
        match="Frontend tool execution timeout for adk_request_confirmation",
    ):
        await interceptor.execute_confirmation("timeout-call", original_fc)


@pytest.mark.asyncio
async def test_execute_confirmation_handles_missing_confirmed_field() -> None:
    """execute_confirmation() should default to False if 'confirmed' field missing."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "malformed-call")
    id_mapper.register("adk_request_confirmation", "malformed-call")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    original_fc = {"id": "malformed-call", "name": "process_payment", "args": {}}

    # when
    async def simulate_malformed_response() -> None:
        await asyncio.sleep(0.01)
        # Frontend sends result without 'confirmed' field
        delegate.resolve_tool_result("malformed-call", {"error": "something went wrong"})

    response_task = asyncio.create_task(simulate_malformed_response())
    result = await interceptor.execute_confirmation("malformed-call", original_fc)
    await response_task

    # then - Should default to False
    assert result.get("confirmed", False) is False


# ============================================================
# Integration Tests (with FrontendToolDelegate)
# ============================================================


@pytest.mark.asyncio
async def test_interceptor_integrates_with_real_delegate() -> None:
    """ToolConfirmationInterceptor should integrate correctly with real FrontendToolDelegate."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "integration-call-123")
    id_mapper.register("adk_request_confirmation", "integration-call-123")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    original_fc = {
        "id": "integration-call-123",
        "name": "process_payment",
        "args": {"amount": 500, "recipient": "alice@example.com"},
    }

    # when
    async def simulate_frontend_flow() -> None:
        # Simulate frontend processing:
        # 1. Receives tool-input-available for adk_request_confirmation
        # 2. Shows approval UI
        # 3. User clicks "Approve"
        # 4. Sends tool_result back
        await asyncio.sleep(0.05)
        delegate.resolve_tool_result(
            "integration-call-123",
            {
                "confirmed": True,
                "user_message": "Approved by user",
                "timestamp": "2025-12-19T23:00:00Z",
            },
        )

    frontend_task = asyncio.create_task(simulate_frontend_flow())
    result = await interceptor.execute_confirmation("integration-call-123", original_fc)
    await frontend_task

    # then
    assert result["confirmed"] is True
    assert result["user_message"] == "Approved by user"


@pytest.mark.asyncio
async def test_multiple_sequential_confirmations() -> None:
    """Interceptor should handle multiple sequential confirmation requests."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("process_payment", "seq-call-1")
    id_mapper.register("adk_request_confirmation", "seq-call-1")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    # when - First confirmation
    original_fc_1 = {"id": "seq-call-1", "name": "process_payment", "args": {"amount": 100}}

    async def approve_first() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("seq-call-1", {"confirmed": True})

    task1 = asyncio.create_task(approve_first())
    result1 = await interceptor.execute_confirmation("seq-call-1", original_fc_1)
    await task1

    # Update ID mapper for second call
    id_mapper.register("process_payment", "seq-call-2")
    id_mapper.register("adk_request_confirmation", "seq-call-2")

    # when - Second confirmation
    original_fc_2 = {"id": "seq-call-2", "name": "process_payment", "args": {"amount": 200}}

    async def deny_second() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("seq-call-2", {"confirmed": False})

    task2 = asyncio.create_task(deny_second())
    result2 = await interceptor.execute_confirmation("seq-call-2", original_fc_2)
    await task2

    # then
    assert result1["confirmed"] is True
    assert result2["confirmed"] is False


# ============================================================
# Edge Cases
# ============================================================


def test_should_intercept_with_empty_function_call_name() -> None:
    """should_intercept() should handle FunctionCall with empty name."""
    # given
    delegate = FrontendToolDelegate()
    interceptor = ToolConfirmationInterceptor(delegate, ["process_payment"])

    function_call = types.FunctionCall(id="empty", name="", args={})

    # when
    result = interceptor.should_intercept(function_call)

    # then
    assert result is False


@pytest.mark.asyncio
async def test_execute_confirmation_with_complex_args() -> None:
    """execute_confirmation() should handle complex nested arguments."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("complex_tool", "complex-call-001")
    id_mapper.register("adk_request_confirmation", "complex-call-001")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)
    interceptor = ToolConfirmationInterceptor(delegate, ["complex_tool"])

    original_fc = {
        "id": "complex-call-001",
        "name": "complex_tool",
        "args": {
            "nested": {"data": [1, 2, 3]},
            "list": ["a", "b", "c"],
            "number": 42,
            "boolean": True,
        },
    }

    # when
    async def approve_complex() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("complex-call-001", {"confirmed": True})

    task = asyncio.create_task(approve_complex())
    result = await interceptor.execute_confirmation("complex-call-001", original_fc)
    await task

    # then
    assert result["confirmed"] is True
