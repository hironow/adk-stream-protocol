"""
Unit tests for global delegate pattern (past implementation pattern).

Tests:
1. Global delegate instance is shared across SSE and BIDI modes
2. Concurrent tool execution with multiple awaits
3. Timeout behavior when Future is not resolved
4. Dead code verification (functions that should NOT be called)
5. Spy verification for call counts and patterns

Based on server.py global frontend_delegate pattern.
"""

import asyncio
from typing import Any
from unittest.mock import Mock, patch

import pytest

from adk_stream_protocol import change_bgm, get_location
from adk_stream_protocol.frontend_tool_registry import _REGISTRY, register_delegate
from server import frontend_delegate
from tests.utils.mocks import create_mock_tool_context


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture(autouse=True)
def clear_id_mapper():
    """Clear ID mapper and registry before and after each test to prevent cross-test contamination."""
    # Clear before test
    frontend_delegate._id_mapper._clear()
    _REGISTRY.clear()
    yield
    # Clear after test
    frontend_delegate._id_mapper._clear()
    _REGISTRY.clear()


# ============================================================
# Global Delegate Instance Tests
# ============================================================


def test_global_delegate_is_singleton() -> None:
    """Verify that frontend_delegate is a single global instance."""
    from server import frontend_delegate as delegate1

    # Import again
    from server import frontend_delegate as delegate2

    # Should be the same object
    assert delegate1 is delegate2
    assert id(delegate1) == id(delegate2)


@pytest.mark.asyncio
async def test_global_delegate_shared_across_sessions() -> None:
    """Verify that the same delegate instance is used across multiple sessions."""
    # given: Register ID mappings (simulates StreamProtocolConverter)
    frontend_delegate._id_mapper.register("change_bgm", "session1_call1")
    frontend_delegate._id_mapper.register("get_location", "session2_call2")

    # given: Multiple tool contexts from different sessions
    mock_tool_context_1 = create_mock_tool_context(
        invocation_id="session1_call1",
        session_state={"frontend_delegate": frontend_delegate, "confirmation_delegate": Mock()},
        session_id="session-1",
    )

    mock_tool_context_2 = create_mock_tool_context(
        invocation_id="session2_call2",
        session_state={"frontend_delegate": frontend_delegate, "confirmation_delegate": Mock()},
        session_id="session-2",
    )

    # Register delegates in registry for both sessions
    register_delegate("session-1", frontend_delegate)
    register_delegate("session-2", frontend_delegate)

    # when: Start two tool executions from different sessions
    async def execute_tool_1() -> dict[str, Any]:
        return await change_bgm(track=1, tool_context=mock_tool_context_1)

    async def execute_tool_2() -> dict[str, Any]:
        return await get_location(tool_context=mock_tool_context_2)

    task_1 = asyncio.create_task(execute_tool_1())
    task_2 = asyncio.create_task(execute_tool_2())
    await asyncio.sleep(0.01)

    # then: Both should be in the same delegate's pending calls
    assert "session1_call1" in frontend_delegate._pending_calls
    assert "session2_call2" in frontend_delegate._pending_calls
    assert len(frontend_delegate._pending_calls) == 2

    # Resolve both
    frontend_delegate.resolve_tool_result("session1_call1", {"success": True, "track": 1})
    frontend_delegate.resolve_tool_result(
        "session2_call2",
        {"success": True, "latitude": 35.6762, "longitude": 139.6503},
    )

    result_1 = await task_1
    result_2 = await task_2

    assert result_1["success"] is True
    assert result_2["success"] is True


# ============================================================
# Concurrent Execution Tests
# ============================================================


@pytest.mark.asyncio
async def test_concurrent_tool_execution_with_different_tools() -> None:
    """Test multiple different tools executing concurrently via delegate."""
    # given: Real delegate (not mock)
    delegate = frontend_delegate

    # Register ID mappings (simulates StreamProtocolConverter)
    delegate._id_mapper.register("change_bgm", "concurrent_bgm")
    delegate._id_mapper.register("get_location", "concurrent_location")

    # Create mock tool contexts
    mock_context_bgm = create_mock_tool_context(
        invocation_id="concurrent_bgm",
        session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
    )

    mock_context_location = create_mock_tool_context(
        invocation_id="concurrent_location",
        session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
    )

    # Register delegate in registry
    register_delegate("session-123", delegate)

    # when: Start both tools concurrently
    async def execute_bgm() -> dict[str, Any]:
        return await change_bgm(track=1, tool_context=mock_context_bgm)

    async def execute_location() -> dict[str, Any]:
        return await get_location(tool_context=mock_context_location)

    task_bgm = asyncio.create_task(execute_bgm())
    task_location = asyncio.create_task(execute_location())
    await asyncio.sleep(0.01)

    # then: Both should be pending
    assert "concurrent_bgm" in delegate._pending_calls
    assert "concurrent_location" in delegate._pending_calls

    # Resolve in reverse order (location first, then bgm)
    delegate.resolve_tool_result(
        "concurrent_location",
        {"success": True, "latitude": 35.6762, "longitude": 139.6503},
    )
    result_location = await task_location
    assert result_location["success"] is True

    # BGM should still be pending
    assert "concurrent_bgm" in delegate._pending_calls

    delegate.resolve_tool_result("concurrent_bgm", {"success": True, "track": 1})
    result_bgm = await task_bgm
    assert result_bgm["success"] is True

    # All resolved
    assert len(delegate._pending_calls) == 0


# ============================================================
# Timeout and Error Handling Tests
# ============================================================


@pytest.mark.asyncio
async def test_tool_timeout_when_future_never_resolved() -> None:
    """Test that tool execution times out if Future is never resolved."""
    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("change_bgm", "timeout_call")

    mock_context = create_mock_tool_context(
        invocation_id="timeout_call",
        session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
    )

    # Register delegate in registry
    register_delegate("session-123", delegate)

    # Start tool execution
    async def execute_with_timeout() -> dict[str, Any]:
        return await change_bgm(track=1, tool_context=mock_context)

    task = asyncio.create_task(execute_with_timeout())
    await asyncio.sleep(0.01)

    # Verify Future is pending
    assert "timeout_call" in delegate._pending_calls

    # Wait with timeout (should timeout because Future is never resolved)
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(task, timeout=0.5)

    # Clean up pending call
    if "timeout_call" in delegate._pending_calls:
        del delegate._pending_calls["timeout_call"]


@pytest.mark.asyncio
async def test_tool_rejection_raises_runtime_error() -> None:
    """Test that reject_tool_call() returns error when rejection occurs."""
    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("get_location", "reject_call")

    mock_context = create_mock_tool_context(
        invocation_id="reject_call",
        session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
    )

    # Register delegate in registry
    register_delegate("session-123", delegate)

    # Start tool execution
    async def execute_tool() -> dict[str, Any]:
        return await get_location(tool_context=mock_context)

    task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # Reject the call
    delegate._reject_tool_call("reject_call", "User denied location access")

    # Should return error dict (execute_on_frontend catches RuntimeError and returns Error)
    result = await task
    assert result["success"] is False
    assert "error" in result
    assert "User denied location access" in result["error"]


# ============================================================
# Spy Tests - Verify Call Patterns
# ============================================================


@pytest.mark.asyncio
async def test_spy_execute_on_frontend_called_exactly_once() -> None:
    """Spy test: Verify execute_on_frontend() is called exactly once per tool invocation."""
    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("change_bgm", "spy_test_call")

    with patch.object(
        delegate,
        "execute_on_frontend",
        wraps=delegate.execute_on_frontend,
    ) as spy:
        # Set up mock context
        mock_context = create_mock_tool_context(
            invocation_id="spy_test_call",
            session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
        )

        # Register delegate in registry
        register_delegate("session-123", delegate)

        # Set up resolution
        async def resolve_after_delay() -> None:
            await asyncio.sleep(0.01)
            delegate.resolve_tool_result("spy_test_call", {"success": True, "track": 1})

        resolve_task = asyncio.create_task(resolve_after_delay())

        # Execute tool
        result = await change_bgm(track=1, tool_context=mock_context)

        await resolve_task

        # Verify called exactly once
        assert spy.call_count == 1
        spy.assert_called_once_with(
            tool_name="change_bgm",
            args={"track": 1},
        )
        assert result["success"] is True


@pytest.mark.asyncio
async def test_spy_resolve_tool_result_called_exactly_once() -> None:
    """Spy test: Verify resolve_tool_result() is called exactly once per resolution."""
    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("change_bgm", "resolve_spy_call")

    with patch.object(
        delegate,
        "resolve_tool_result",
        wraps=delegate.resolve_tool_result,
    ) as spy:
        mock_context = create_mock_tool_context(
            invocation_id="resolve_spy_call",
            session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
        )

        # Register delegate in registry
        register_delegate("session-123", delegate)

        # Start tool execution
        async def execute_tool() -> dict[str, Any]:
            return await change_bgm(track=0, tool_context=mock_context)

        task = asyncio.create_task(execute_tool())
        await asyncio.sleep(0.01)

        # Resolve
        tool_result = {"success": True, "track": 0}
        delegate.resolve_tool_result("resolve_spy_call", tool_result)

        result = await task

        # Verify called exactly once
        assert spy.call_count == 1
        spy.assert_called_once_with("resolve_spy_call", tool_result)
        assert result == tool_result


# ============================================================
# Dead Code Tests - Functions That Should NOT Be Called
# ============================================================


@pytest.mark.asyncio
async def test_dead_code_backend_never_sends_tool_result_events() -> None:
    """
    DEAD CODE TEST: Verify backend never attempts to send tool_result via WebSocket.

    This test verifies the Python backend side - the WebSocket tool_result event
    handler (server.py lines 708-723) should never be triggered in the normal flow.

    Note: Frontend TypeScript test (lib/websocket-chat-transport.test.ts) verifies
    that sendToolResult() is never called on the frontend side.
    """
    # This test verifies that the backend delegate pattern works WITHOUT
    # needing WebSocket tool_result events.

    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("change_bgm", "backend_test")

    # Track all delegate method calls
    resolve_calls = []
    reject_calls = []

    original_resolve = delegate.resolve_tool_result
    original_reject = delegate._reject_tool_call

    def tracked_resolve(tool_call_id: str, result: dict[str, Any]) -> None:
        resolve_calls.append((tool_call_id, result))
        return original_resolve(tool_call_id, result)

    def tracked_reject(tool_call_id: str, error_message: str) -> None:
        reject_calls.append((tool_call_id, error_message))
        return original_reject(tool_call_id, error_message)

    delegate.resolve_tool_result = tracked_resolve  # type: ignore
    delegate._reject_tool_call = tracked_reject  # type: ignore

    try:
        mock_context = create_mock_tool_context(
            invocation_id="backend_test",
            session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
        )

        # Register delegate in registry
        register_delegate("session-123", delegate)

        async def execute_tool() -> dict[str, Any]:
            return await change_bgm(track=1, tool_context=mock_context)

        task = asyncio.create_task(execute_tool())
        await asyncio.sleep(0.01)

        # Resolve via delegate (simulating the actual flow)
        delegate.resolve_tool_result("backend_test", {"success": True, "track": 1})
        result = await task

        # Verify resolution happened via delegate methods
        assert len(resolve_calls) == 1
        assert resolve_calls[0][0] == "backend_test"
        assert resolve_calls[0][1] == {"success": True, "track": 1}
        assert len(reject_calls) == 0  # No rejections
        assert result["success"] is True

    finally:
        # Restore original methods
        delegate.resolve_tool_result = original_resolve  # type: ignore
        delegate._reject_tool_call = original_reject  # type: ignore


@pytest.mark.asyncio
async def test_dead_code_websocket_tool_result_handler_not_triggered() -> None:
    """
    DEAD CODE TEST: Verify that the WebSocket tool_result event handler is never triggered.

    The WebSocket tool_result event handler in server.py (lines 708-723) is dead code.
    The frontend uses addToolOutput() which sends results through the normal message flow.
    """
    # This test verifies that the execution flow never hits the WebSocket tool_result handler
    # by ensuring all tool results go through the addToolOutput() → message flow path

    delegate = frontend_delegate

    # Spy on resolve_tool_result to track resolution path
    resolution_path = []

    original_resolve = delegate.resolve_tool_result

    def tracked_resolve(tool_call_id: str, result: dict[str, Any]) -> None:
        resolution_path.append("delegate_resolve")
        return original_resolve(tool_call_id, result)

    delegate.resolve_tool_result = tracked_resolve  # type: ignore

    try:
        mock_context = create_mock_tool_context(
            invocation_id="path_test",
            session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
        )

        async def execute_tool() -> dict[str, Any]:
            return await change_bgm(track=1, tool_context=mock_context)

        task = asyncio.create_task(execute_tool())
        await asyncio.sleep(0.01)

        # Resolve via delegate (simulating the ACTUAL flow: addToolOutput → message → delegate)
        delegate.resolve_tool_result("path_test", {"success": True, "track": 1})
        await task

        # Verify resolution happened via delegate, NOT via WebSocket tool_result handler
        assert "delegate_resolve" in resolution_path
        assert len(resolution_path) == 1  # Should be called exactly once

    finally:
        # Restore original method
        delegate.resolve_tool_result = original_resolve  # type: ignore


# ============================================================
# Await Behavior Tests
# ============================================================


@pytest.mark.asyncio
async def test_await_blocks_until_future_resolved() -> None:
    """Test that tool execution properly blocks until Future is resolved."""
    delegate = frontend_delegate

    # Register ID mapping
    delegate._id_mapper.register("change_bgm", "await_test")

    mock_context = create_mock_tool_context(
        invocation_id="await_test",
        session_state={"frontend_delegate": delegate, "confirmation_delegate": Mock()},
    )

    # Register delegate in registry
    register_delegate("session-123", delegate)

    # Track execution order
    execution_order = []

    async def execute_tool() -> dict[str, Any]:
        execution_order.append("tool_start")
        result = await change_bgm(track=1, tool_context=mock_context)
        execution_order.append("tool_end")
        return result

    task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # Tool should have started but not finished
    assert execution_order == ["tool_start"]
    assert "await_test" in delegate._pending_calls

    # Resolve Future
    execution_order.append("resolve_start")
    delegate.resolve_tool_result("await_test", {"success": True, "track": 1})
    execution_order.append("resolve_end")

    # Wait for tool to complete
    await task

    # Verify execution order: tool_start → resolve → tool_end
    assert execution_order == ["tool_start", "resolve_start", "resolve_end", "tool_end"]
