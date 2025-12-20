"""
Unit tests for FrontendToolDelegate class (BIDI delegate pattern).

Tests the asyncio.Future-based delegation pattern for client-side tool execution:
- execute_on_frontend(): Creates Future and awaits frontend result
- resolve_tool_result(): Resolves Future when frontend sends result
- reject_tool_call(): Rejects Future on error

Based on implementation in server.py (FrontendToolDelegate class)
"""


import asyncio
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest
from google.adk.tools.tool_context import ToolContext

from adk_ag_tools import change_bgm, get_location
from result.result import Ok
from server import FrontendToolDelegate
from tests.utils.result_assertions import assert_error, assert_ok


# ============================================================
# FrontendToolDelegate Tests
# ============================================================


@pytest.mark.asyncio
async def test_frontend_delegate_execute_and_resolve() -> None:
    """execute_on_frontend() should await result and resolve_tool_result() should resolve Future."""
    delegate = FrontendToolDelegate()

    # Register ID mapping (simulates StreamProtocolConverter registration)
    delegate.id_mapper.register("change_bgm", "call_123")

    # Start execute_on_frontend in background
    async def execute_tool() -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name="change_bgm",
            args={"track": 1},
        )
        return assert_ok(result_or_error)

    # Create task but don't await yet
    task = asyncio.create_task(execute_tool())

    # Give task time to start and create Future
    await asyncio.sleep(0.01)

    # Verify Future is pending
    assert "call_123" in delegate._pending_calls
    future = delegate._pending_calls["call_123"]
    assert not future.done()

    # Resolve the Future
    tool_result = {"success": True, "track": 1}
    delegate.resolve_tool_result("call_123", tool_result)

    # Verify Future is resolved
    assert future.done()
    assert not future.cancelled()

    # Verify execute_on_frontend returns the result
    result = await task
    assert result == tool_result

    # Verify Future is removed from pending calls
    assert "call_123" not in delegate._pending_calls


@pytest.mark.asyncio
async def test_frontend_delegate_reject_tool_call() -> None:
    """reject_tool_call() should reject Future with exception (caught and returned as Error)."""
    delegate = FrontendToolDelegate()

    # Register ID mapping
    delegate.id_mapper.register("change_bgm", "call_456")

    # Start execute_on_frontend in background
    async def execute_tool():
        return await delegate.execute_on_frontend(
            tool_name="change_bgm",
            args={"track": 0},
        )

    task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # Verify Future is pending
    assert "call_456" in delegate._pending_calls

    # Reject the Future
    delegate.reject_tool_call("call_456", "Tool execution failed")

    # Verify Future is rejected - execute_on_frontend catches exception and returns Error
    result_or_error = await task
    error_msg: str = assert_error(result_or_error)
    assert "Tool execution failed" in error_msg
    assert "RuntimeError" in error_msg

    # Verify Future is removed from pending calls
    assert "call_456" not in delegate._pending_calls


@pytest.mark.asyncio
async def test_frontend_delegate_resolve_unknown_call_id() -> None:
    """resolve_tool_result() with unknown call_id should log warning but not crash."""
    delegate = FrontendToolDelegate()

    # Should not raise exception
    delegate.resolve_tool_result("unknown_id", {"result": "test"})

    # Verify no pending calls
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_frontend_delegate_reject_unknown_call_id() -> None:
    """reject_tool_call() with unknown call_id should log warning but not crash."""
    delegate = FrontendToolDelegate()

    # Should not raise exception
    delegate.reject_tool_call("unknown_id", "Error message")

    # Verify no pending calls
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_frontend_delegate_multiple_pending_calls() -> None:
    """FrontendToolDelegate should handle multiple pending calls independently."""
    delegate = FrontendToolDelegate()

    # Register ID mappings
    delegate.id_mapper.register("tool_a", "call_1")
    delegate.id_mapper.register("tool_b", "call_2")

    # Start two execute_on_frontend calls
    async def execute_tool_1() -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name="tool_a",
            args={},
        )
        return assert_ok(result_or_error)

    async def execute_tool_2() -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name="tool_b",
            args={},
        )
        return assert_ok(result_or_error)

    task_1 = asyncio.create_task(execute_tool_1())
    task_2 = asyncio.create_task(execute_tool_2())
    await asyncio.sleep(0.01)

    # Verify both Futures are pending
    assert "call_1" in delegate._pending_calls
    assert "call_2" in delegate._pending_calls
    assert len(delegate._pending_calls) == 2

    # Resolve call_2 first
    delegate.resolve_tool_result("call_2", {"result": "second"})
    result_2 = await task_2
    assert result_2 == {"result": "second"}

    # call_1 should still be pending
    assert "call_1" in delegate._pending_calls
    assert "call_2" not in delegate._pending_calls

    # Resolve call_1
    delegate.resolve_tool_result("call_1", {"result": "first"})
    result_1 = await task_1
    assert result_1 == {"result": "first"}

    # Verify all Futures are resolved
    assert len(delegate._pending_calls) == 0


# ============================================================
# change_bgm with Delegate Tests
# ============================================================


@pytest.mark.asyncio
async def test_change_bgm_uses_delegate_in_bidi_mode() -> None:
    """change_bgm should use delegate when tool_context with delegate is provided."""
    # Create mock delegate
    mock_delegate = Mock(spec=FrontendToolDelegate)
    mock_delegate.execute_on_frontend = AsyncMock(return_value=Ok({"success": True, "track": 1}))

    # Create mock ToolContext with delegate
    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.invocation_id = "call_789"
    mock_tool_context.session = Mock()
    mock_tool_context.session.state = {"frontend_delegate": mock_delegate}

    # Call change_bgm with tool_context
    result = await change_bgm(track=1, tool_context=mock_tool_context)

    # Verify delegate.execute_on_frontend was called exactly once
    mock_delegate.execute_on_frontend.assert_called_once()
    call_args = mock_delegate.execute_on_frontend.call_args
    assert call_args.kwargs["tool_name"] == "change_bgm"
    assert call_args.kwargs["args"] == {"track": 1}

    # Verify result from delegate
    assert result == {"success": True, "track": 1}


@pytest.mark.asyncio
async def test_change_bgm_without_delegate_returns_sse_response() -> None:
    """change_bgm without tool_context should return SSE mode response."""
    # Call change_bgm without tool_context (SSE mode)
    result = await change_bgm(track=0)

    # Verify SSE mode response
    assert result["success"] is True
    assert result["track"] == 0
    assert "frontend handles execution" in result["message"]


@pytest.mark.asyncio
async def test_change_bgm_with_tool_context_but_no_delegate() -> None:
    """change_bgm with tool_context but no delegate should return SSE mode response."""
    # Create mock ToolContext without delegate
    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.session = Mock()
    mock_tool_context.session.state = {}  # No delegate

    # Call change_bgm
    result = await change_bgm(track=1, tool_context=mock_tool_context)

    # Verify SSE mode response
    assert result["success"] is True
    assert result["track"] == 1
    assert "frontend handles execution" in result["message"]


@pytest.mark.asyncio
async def test_change_bgm_delegate_call_count_spy() -> None:
    """Spy test: Verify delegate.execute_on_frontend is called exactly once (no duplicates)."""
    # Create real delegate (not mock) to spy on
    delegate = FrontendToolDelegate()

    # Register ID mapping (simulates StreamProtocolConverter registration)
    delegate.id_mapper.register("change_bgm", "call_spy_test")

    # Spy on execute_on_frontend method
    with patch.object(
        delegate,
        "execute_on_frontend",
        wraps=delegate.execute_on_frontend,
    ) as spy:
        # Set up Future resolution
        async def resolve_after_delay() -> None:
            await asyncio.sleep(0.01)
            delegate.resolve_tool_result(
                "call_spy_test",
                {"success": True, "track": 0},
            )

        # Create mock ToolContext
        mock_tool_context = Mock(spec=ToolContext)
        mock_tool_context.invocation_id = "call_spy_test"
        mock_tool_context.session = Mock()
        mock_tool_context.session.state = {"frontend_delegate": delegate}

        # Start resolution task
        resolve_task = asyncio.create_task(resolve_after_delay())

        # Call change_bgm
        result = await change_bgm(track=0, tool_context=mock_tool_context)

        # Wait for resolution task
        await resolve_task

        # Verify execute_on_frontend was called EXACTLY ONCE
        assert spy.call_count == 1
        spy.assert_called_once_with(
            tool_name="change_bgm",
            args={"track": 0},
        )

        # Verify result
        assert result == {"success": True, "track": 0}


@pytest.mark.asyncio
async def test_change_bgm_no_delegate_call_when_sse_mode() -> None:
    """Spy test: Verify delegate is NOT called in SSE mode."""
    # Create delegate but don't pass it to change_bgm
    delegate = FrontendToolDelegate()

    with patch.object(delegate, "execute_on_frontend") as mock_execute:
        # Call change_bgm without tool_context (SSE mode)
        result = await change_bgm(track=1)

        # Verify delegate was NOT called
        mock_execute.assert_not_called()

        # Verify SSE mode result
        assert result["success"] is True
        assert result["track"] == 1


# ============================================================
# get_location with Delegate Tests
# ============================================================


@pytest.mark.asyncio
async def test_get_location_uses_delegate_in_bidi_mode() -> None:
    """get_location should use delegate when tool_context with delegate is provided."""
    # Create mock delegate
    mock_delegate = Mock(spec=FrontendToolDelegate)
    mock_delegate.execute_on_frontend = AsyncMock(
        return_value=Ok(
            {
                "success": True,
                "latitude": 35.6762,
                "longitude": 139.6503,
                "accuracy": 10,
            }
        )
    )

    # Create mock ToolContext with delegate
    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.invocation_id = "call_location_001"
    mock_tool_context.session = Mock()
    mock_tool_context.session.state = {"frontend_delegate": mock_delegate}

    # Call get_location with tool_context
    result = await get_location(tool_context=mock_tool_context)

    # Verify delegate.execute_on_frontend was called exactly once
    mock_delegate.execute_on_frontend.assert_called_once()
    call_args = mock_delegate.execute_on_frontend.call_args
    assert call_args.kwargs["tool_name"] == "get_location"
    assert call_args.kwargs["args"] == {}

    # Verify result from delegate
    assert result["success"] is True
    assert result["latitude"] == 35.6762
    assert result["longitude"] == 139.6503


# Removed: test_get_location_without_delegate_returns_sse_response
# New implementation requires tool_context (past implementation pattern)


@pytest.mark.asyncio
async def test_get_location_with_tool_context_but_no_delegate() -> None:
    """get_location with tool_context but no delegate should return error."""
    # Create mock ToolContext without delegate
    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.session = Mock()
    mock_tool_context.session.state = {}  # No delegate
    mock_tool_context.invocation_id = "test-invocation-id"

    # Call get_location
    result = await get_location(tool_context=mock_tool_context)

    # Verify error response (can be either session.state or frontend_delegate missing)
    assert result["success"] is False
    assert "error" in result
    # Error message varies depending on mock behavior
    assert "frontend_delegate" in result["error"] or "session.state" in result["error"]


@pytest.mark.asyncio
async def test_get_location_delegate_call_count_spy() -> None:
    """Spy test: Verify delegate.execute_on_frontend is called exactly once (no duplicates)."""
    # Create real delegate (not mock) to spy on
    delegate = FrontendToolDelegate()

    # Register ID mapping (simulates StreamProtocolConverter registration)
    delegate.id_mapper.register("get_location", "call_location_spy")

    # Spy on execute_on_frontend method
    with patch.object(
        delegate,
        "execute_on_frontend",
        wraps=delegate.execute_on_frontend,
    ) as spy:
        # Set up Future resolution
        async def resolve_after_delay() -> None:
            await asyncio.sleep(0.01)
            delegate.resolve_tool_result(
                "call_location_spy",
                {
                    "success": True,
                    "latitude": 35.6762,
                    "longitude": 139.6503,
                    "accuracy": 10,
                },
            )

        # Create mock ToolContext
        mock_tool_context = Mock(spec=ToolContext)
        mock_tool_context.invocation_id = "call_location_spy"
        mock_tool_context.session = Mock()
        mock_tool_context.session.state = {"frontend_delegate": delegate}

        # Start resolution task
        resolve_task = asyncio.create_task(resolve_after_delay())

        # Call get_location
        result = await get_location(tool_context=mock_tool_context)

        # Wait for resolution task
        await resolve_task

        # Verify execute_on_frontend was called EXACTLY ONCE
        assert spy.call_count == 1
        spy.assert_called_once_with(
            tool_name="get_location",
            args={},
        )

        # Verify result
        assert result["success"] is True
        assert result["latitude"] == 35.6762
        assert result["longitude"] == 139.6503


# Removed: test_get_location_no_delegate_call_when_sse_mode
# New implementation requires tool_context (past implementation pattern)


@pytest.mark.asyncio
async def test_get_location_with_none_session_state() -> None:
    """Edge case: get_location should handle None session.state gracefully and return error."""
    # Create mock ToolContext with None state
    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.session = Mock()
    mock_tool_context.session.state = None  # Edge case
    mock_tool_context.invocation_id = "test-invocation-none"

    # Call get_location - should not crash
    result = await get_location(tool_context=mock_tool_context)

    # Verify error response
    assert result["success"] is False
    assert "error" in result
    assert "session.state" in result["error"]


@pytest.mark.asyncio
async def test_get_location_delegate_not_called_on_error() -> None:
    """Spy test: Verify delegate is NOT called again after error."""
    # Create delegate
    delegate = FrontendToolDelegate()

    # Register ID mapping (simulates StreamProtocolConverter registration)
    delegate.id_mapper.register("get_location", "call_location_error")

    with patch.object(
        delegate,
        "execute_on_frontend",
        wraps=delegate.execute_on_frontend,
    ) as spy:
        # Set up Future rejection
        async def reject_after_delay() -> None:
            await asyncio.sleep(0.01)
            delegate.reject_tool_call("call_location_error", "User denied location access")

        # Create mock ToolContext
        mock_tool_context = Mock(spec=ToolContext)
        mock_tool_context.invocation_id = "call_location_error"
        mock_tool_context.session = Mock()
        mock_tool_context.session.state = {"frontend_delegate": delegate}

        # Start rejection task
        reject_task = asyncio.create_task(reject_after_delay())

        # Call get_location - execute_on_frontend catches RuntimeError and returns Error
        result = await get_location(tool_context=mock_tool_context)

        # Wait for rejection task
        await reject_task

        # Verify error is returned (not raised)
        assert result["success"] is False
        assert "error" in result
        assert "User denied location access" in result["error"]

        # Verify execute_on_frontend was called EXACTLY ONCE (not retried)
        assert spy.call_count == 1
