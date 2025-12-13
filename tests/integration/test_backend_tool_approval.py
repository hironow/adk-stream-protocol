"""
Integration tests for backend tool approval flow.

Tests the integration between:
1. FrontendToolDelegate (awaitable tool execution)
2. StreamProtocolConverter (event generation)
3. WebSocket handler (result resolution)

These tests verify the complete flow from tool call to result,
including both approval and rejection scenarios.

Test Strategy (TDD):
- RED: Write failing test for expected behavior
- GREEN: Implement minimum code to pass
- REFACTOR: Clean up implementation
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from tool_delegate import FrontendToolDelegate


# ============================================================
# Test Fixtures
# ============================================================


@pytest.fixture
def delegate() -> FrontendToolDelegate:
    """Create a fresh FrontendToolDelegate instance for each test."""
    return FrontendToolDelegate()


@pytest.fixture
def tool_call_id() -> str:
    """Sample tool call ID."""
    return "call_abc123"


# ============================================================
# Integration Tests: FrontendToolDelegate Basic Flow
# ============================================================


@pytest.mark.asyncio
async def test_execute_on_frontend_awaits_result(
    delegate: FrontendToolDelegate, tool_call_id: str
) -> None:
    """
    Should await frontend result and return it when resolved.

    Flow:
    1. Tool calls execute_on_frontend()
    2. Delegate creates Future and waits
    3. WebSocket handler calls resolve_tool_result()
    4. Delegate returns result to tool
    """
    # given
    tool_name = "change_bgm"
    args = {"track": 1}
    expected_result = {"success": True, "track": 1}

    # when: Start execution (will block until resolved)
    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, tool_name, args)

    execution_task = asyncio.create_task(execute_tool())

    # Simulate small delay before frontend responds
    await asyncio.sleep(0.01)

    # Simulate WebSocket handler receiving result from frontend
    delegate.resolve_tool_result(tool_call_id, expected_result)

    # then: Task should complete with result
    result = await execution_task
    assert result == expected_result


@pytest.mark.asyncio
async def test_resolve_tool_result_resolves_pending_call(
    delegate: FrontendToolDelegate, tool_call_id: str
) -> None:
    """
    Should resolve pending Future when resolve_tool_result is called.

    This tests the synchronous resolution path (called from WebSocket handler).
    """
    # given: Pending tool call
    tool_name = "get_location"
    args = {}

    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, tool_name, args)

    execution_task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)  # Ensure Future is created

    expected_result = {"latitude": 35.6762, "longitude": 139.6503}

    # when: Resolve with result
    delegate.resolve_tool_result(tool_call_id, expected_result)

    # then: Task completes with result
    result = await execution_task
    assert result == expected_result


@pytest.mark.asyncio
async def test_resolve_unknown_tool_call_id_does_not_crash(
    delegate: FrontendToolDelegate,
) -> None:
    """
    Should log warning but not crash when resolving unknown tool_call_id.

    This can happen if:
    - Frontend sends duplicate result
    - Frontend sends result for wrong tool_call_id
    """
    # given: No pending calls
    unknown_tool_call_id = "call_unknown"
    result = {"success": False, "error": "Something"}

    # when: Try to resolve unknown tool call
    # then: Should not raise exception
    delegate.resolve_tool_result(unknown_tool_call_id, result)
    # Test passes if no exception raised


# ============================================================
# Integration Tests: Rejection Flow (RED - Not Implemented Yet)
# ============================================================


@pytest.mark.asyncio
async def test_reject_tool_call_resolves_with_error_result(
    delegate: FrontendToolDelegate, tool_call_id: str
) -> None:
    """
    Should resolve pending call with rejection error when user denies.

    Expected behavior when approved=false:
    1. Frontend sends tool_result with approved=false
    2. WebSocket handler calls reject_tool_call()
    3. Future resolves with rejection error dict
    4. Tool function returns error to AI

    This test verifies the GREEN implementation of reject_tool_call().
    """
    # given: Pending tool call
    tool_name = "change_bgm"
    args = {"track": 1}

    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, tool_name, args)

    execution_task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # when: User rejects (approved=false)
    reason = "User denied permission"
    delegate.reject_tool_call(tool_call_id, reason)

    # then: Task completes with rejection error
    result = await execution_task
    assert result["success"] is False
    assert result["denied"] is True
    assert "denied permission" in result["error"].lower()


# ============================================================
# Integration Tests: Error Scenarios
# ============================================================


@pytest.mark.asyncio
async def test_multiple_tools_can_be_pending_simultaneously(
    delegate: FrontendToolDelegate,
) -> None:
    """
    Should handle multiple pending tool calls concurrently.

    Scenario: Multiple tools waiting for frontend results at the same time.
    """
    # given: Multiple tools
    tool_call_id_1 = "call_1"
    tool_call_id_2 = "call_2"

    async def execute_tool_1() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id_1, "change_bgm", {"track": 0})

    async def execute_tool_2() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id_2, "get_location", {})

    # when: Start both executions
    task_1 = asyncio.create_task(execute_tool_1())
    task_2 = asyncio.create_task(execute_tool_2())
    await asyncio.sleep(0.01)

    # Resolve in different order (tool_2 first, then tool_1)
    result_2 = {"latitude": 35.6762, "longitude": 139.6503}
    result_1 = {"success": True, "track": 0}

    delegate.resolve_tool_result(tool_call_id_2, result_2)
    delegate.resolve_tool_result(tool_call_id_1, result_1)

    # then: Both tasks complete with correct results
    assert await task_2 == result_2
    assert await task_1 == result_1


@pytest.mark.asyncio
async def test_resolve_same_tool_call_id_twice_only_uses_first(
    delegate: FrontendToolDelegate, tool_call_id: str
) -> None:
    """
    Should only use first resolution if resolve_tool_result called twice.

    Scenario: Frontend accidentally sends duplicate result.
    """
    # given: Pending tool call
    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, "test_tool", {})

    execution_task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    first_result = {"success": True, "value": 1}
    second_result = {"success": True, "value": 2}

    # when: Resolve twice
    delegate.resolve_tool_result(tool_call_id, first_result)
    delegate.resolve_tool_result(tool_call_id, second_result)  # Should log warning

    # then: Only first result is used
    result = await execution_task
    assert result == first_result


# ============================================================
# Note: More tests to add after implementing rejection handling
# ============================================================

# TODO: Test WebSocket handler integration
# - test_websocket_handler_resolves_approved_result()
# - test_websocket_handler_rejects_denied_result()
# - test_websocket_handler_handles_missing_tool_call_id()
# - test_websocket_handler_handles_missing_result()

# TODO: Test StreamProtocolConverter integration
# - test_stream_protocol_generates_approval_request()
# - test_stream_protocol_approval_id_to_tool_call_id_mapping()
