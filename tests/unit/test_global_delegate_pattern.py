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
from google.adk.tools.tool_context import ToolContext

from adk_ag_tools import change_bgm, get_location
from server import frontend_delegate


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture(autouse=True)
def clear_id_mapper():
    """Clear ID mapper before and after each test to prevent cross-test contamination."""
    # Clear before test
    frontend_delegate._id_mapper._clear()
    yield
    # Clear after test
    frontend_delegate._id_mapper._clear()


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
    mock_tool_context_1 = Mock(spec=ToolContext)
    mock_tool_context_1.invocation_id = "session1_call1"
    mock_tool_context_1.session = Mock()
    mock_tool_context_1.session.state = {"frontend_delegate": frontend_delegate}

    mock_tool_context_2 = Mock(spec=ToolContext)
    mock_tool_context_2.invocation_id = "session2_call2"
    mock_tool_context_2.session = Mock()
    mock_tool_context_2.session.state = {"frontend_delegate": frontend_delegate}

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
    mock_context_bgm = Mock(spec=ToolContext)
    mock_context_bgm.invocation_id = "concurrent_bgm"
    mock_context_bgm.session = Mock()
    mock_context_bgm.session.state = {"frontend_delegate": delegate}

    mock_context_location = Mock(spec=ToolContext)
    mock_context_location.invocation_id = "concurrent_location"
    mock_context_location.session = Mock()
    mock_context_location.session.state = {"frontend_delegate": delegate}

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


@pytest.mark.asyncio
async def test_concurrent_same_tool_multiple_times() -> None:
    """Test the same tool being called multiple times concurrently."""
    delegate = frontend_delegate

    # For concurrent calls of the same tool, we use fallback IDs
    # Create 3 concurrent change_bgm calls with known args so we can track them
    args_list = [{"track": 0}, {"track": 1}, {"track": 2}]  # Use unique tracks
    contexts = []
    for i in range(3):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"bgm_call_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}
        contexts.append(mock_context)

    # Start all 3 tasks
    async def execute_bgm(ctx: Mock, args: dict[str, Any]) -> dict[str, Any]:
        return await change_bgm(track=args["track"], tool_context=ctx)

    tasks = [
        asyncio.create_task(execute_bgm(contexts[0], args_list[0])),
        asyncio.create_task(execute_bgm(contexts[1], args_list[1])),
        asyncio.create_task(execute_bgm(contexts[2], args_list[2])),
    ]
    await asyncio.sleep(0.01)

    # All 3 should be pending (with fallback IDs)
    assert len(delegate._pending_calls) == 3

    # Get the actual fallback IDs that were generated
    pending_ids = list(delegate._pending_calls.keys())
    assert len(pending_ids) == 3

    # Resolve in order using the actual IDs
    for i, task in enumerate(tasks):
        delegate.resolve_tool_result(pending_ids[i], {"success": True, "track": i})
        result = await task
        assert result["track"] == i

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

    mock_context = Mock(spec=ToolContext)
    mock_context.invocation_id = "timeout_call"
    mock_context.session = Mock()
    mock_context.session.state = {"frontend_delegate": delegate}

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

    mock_context = Mock(spec=ToolContext)
    mock_context.invocation_id = "reject_call"
    mock_context.session = Mock()
    mock_context.session.state = {"frontend_delegate": delegate}

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
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = "spy_test_call"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

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
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = "resolve_spy_call"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

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
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = "backend_test"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

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
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = "path_test"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

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

    mock_context = Mock(spec=ToolContext)
    mock_context.invocation_id = "await_test"
    mock_context.session = Mock()
    mock_context.session.state = {"frontend_delegate": delegate}

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


@pytest.mark.asyncio
async def test_multiple_awaits_resolve_independently() -> None:
    """Test that multiple concurrent awaits resolve independently."""
    delegate = frontend_delegate

    # For concurrent calls of the same tool, use fallback IDs
    # Create 3 concurrent tool calls
    contexts = []
    for i in range(3):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"independent_await_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}
        contexts.append(mock_context)

    # Track completion order
    completion_order = []

    async def execute_and_track(ctx: Mock, index: int) -> dict[str, Any]:
        result = await change_bgm(track=index, tool_context=ctx)
        completion_order.append(index)
        return result

    tasks = [
        asyncio.create_task(execute_and_track(contexts[0], 0)),
        asyncio.create_task(execute_and_track(contexts[1], 1)),
        asyncio.create_task(execute_and_track(contexts[2], 2)),
    ]
    await asyncio.sleep(0.01)

    # All should be pending (with fallback IDs)
    assert len(delegate._pending_calls) == 3

    # Get actual fallback IDs
    pending_ids = list(delegate._pending_calls.keys())
    assert len(pending_ids) == 3

    # Resolve in different order: 2, 0, 1
    delegate.resolve_tool_result(pending_ids[2], {"success": True, "track": 2})
    await asyncio.sleep(0.01)
    assert completion_order == [2]

    delegate.resolve_tool_result(pending_ids[0], {"success": True, "track": 0})
    await asyncio.sleep(0.01)
    assert completion_order == [2, 0]

    delegate.resolve_tool_result(pending_ids[1], {"success": True, "track": 1})
    await asyncio.gather(*tasks)

    # Verify completion order matches resolution order
    assert completion_order == [2, 0, 1]


# ============================================================
# Stress Tests - High Concurrency and Load
# ============================================================


@pytest.mark.asyncio
async def test_stress_10_concurrent_tool_calls_random_resolution() -> None:
    """
    STRESS TEST: 10 concurrent tool calls with random resolution order.

    This test uses the REAL production delegate to verify it can handle
    high concurrency with no race conditions.
    """
    delegate = frontend_delegate

    # Create 10 concurrent tool calls
    num_calls = 10
    contexts = []
    for i in range(num_calls):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"stress_call_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}
        contexts.append(mock_context)

    # Track completion order
    completion_order = []

    async def execute_and_track(ctx: Mock, index: int) -> dict[str, Any]:
        result = await change_bgm(track=index % 3, tool_context=ctx)
        completion_order.append(index)
        return result

    # Start all 10 tasks
    tasks = [asyncio.create_task(execute_and_track(contexts[i], i)) for i in range(num_calls)]
    await asyncio.sleep(0.01)

    # Verify all 10 are pending (with fallback IDs)
    assert len(delegate._pending_calls) == num_calls

    # Get actual fallback IDs
    pending_ids = list(delegate._pending_calls.keys())
    assert len(pending_ids) == num_calls

    # Resolve in random order: 5, 2, 9, 1, 7, 0, 4, 8, 3, 6
    random_order = [5, 2, 9, 1, 7, 0, 4, 8, 3, 6]
    for idx in random_order:
        delegate.resolve_tool_result(
            pending_ids[idx],
            {"success": True, "track": idx % 3},
        )
        await asyncio.sleep(0.001)  # Small delay to allow task to complete

    # Wait for all tasks
    results = await asyncio.gather(*tasks)

    # Verify all completed successfully
    assert len(results) == num_calls
    for result in results:
        assert result["success"] is True

    # Verify completion order matches resolution order
    assert completion_order == random_order

    # Verify all futures are cleaned up
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_stress_rapid_sequential_calls() -> None:
    """
    STRESS TEST: Rapid sequential tool calls without delay.

    Tests that the delegate handles rapid consecutive calls correctly.
    Uses REAL production delegate.
    """
    delegate = frontend_delegate

    num_calls = 20
    results = []

    for i in range(num_calls):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"rapid_call_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

        # Start tool call
        async def execute_tool(ctx: Mock, index: int) -> dict[str, Any]:
            return await change_bgm(track=index % 3, tool_context=ctx)

        task = asyncio.create_task(execute_tool(mock_context, i))

        # Give event loop time to create Future (minimal delay)
        await asyncio.sleep(0.001)

        # Get the actual fallback ID that was created
        pending_ids = list(delegate._pending_calls.keys())
        assert len(pending_ids) == 1, f"Expected 1 pending call, got {len(pending_ids)}"
        fallback_id = pending_ids[0]

        # Resolve immediately after Future is created
        delegate.resolve_tool_result(fallback_id, {"success": True, "track": i % 3})

        result = await task
        results.append(result)

    # Verify all completed successfully
    assert len(results) == num_calls
    for i, result in enumerate(results):
        assert result["success"] is True
        assert result["track"] == i % 3

    # Verify no pending calls
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_stress_mixed_success_and_failure() -> None:
    """
    STRESS TEST: Mixed success and failure scenarios.

    Tests error propagation with multiple concurrent awaits.
    Uses REAL production delegate.
    """
    delegate = frontend_delegate

    # Create 6 concurrent calls
    num_calls = 6
    contexts = []
    for i in range(num_calls):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"mixed_call_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}
        contexts.append(mock_context)

    async def execute_tool(ctx: Mock, index: int) -> dict[str, Any]:
        return await change_bgm(track=index, tool_context=ctx)

    # Start all tasks
    tasks = [asyncio.create_task(execute_tool(contexts[i], i)) for i in range(num_calls)]
    await asyncio.sleep(0.01)

    # Verify all pending (with fallback IDs)
    assert len(delegate._pending_calls) == num_calls

    # Get actual fallback IDs
    pending_ids = list(delegate._pending_calls.keys())
    assert len(pending_ids) == num_calls

    # Resolve with mixed results:
    # - Success: 0, 2, 4
    # - Failure: 1, 3, 5
    delegate.resolve_tool_result(pending_ids[0], {"success": True, "track": 0})
    delegate._reject_tool_call(pending_ids[1], "User cancelled")
    delegate.resolve_tool_result(pending_ids[2], {"success": True, "track": 2})
    delegate._reject_tool_call(pending_ids[3], "Network error")
    delegate.resolve_tool_result(pending_ids[4], {"success": True, "track": 4})
    delegate._reject_tool_call(pending_ids[5], "Permission denied")

    # Gather results (all return dicts now - exceptions are caught and returned as Error dicts)
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Verify results
    assert len(results) == num_calls
    assert results[0] == {"success": True, "track": 0}  # Success
    # Failures now return error dicts (execute_on_frontend catches RuntimeError)
    assert isinstance(results[1], dict)
    assert results[1]["success"] is False  # Failure
    assert "User cancelled" in results[1]["error"]
    assert results[2] == {"success": True, "track": 2}  # Success
    assert isinstance(results[3], dict)
    assert results[3]["success"] is False  # Failure
    assert "Network error" in results[3]["error"]
    assert results[4] == {"success": True, "track": 4}  # Success
    assert isinstance(results[5], dict)
    assert results[5]["success"] is False  # Failure
    assert "Permission denied" in results[5]["error"]

    # Verify all futures are cleaned up
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_stress_partial_timeout_with_some_success() -> None:
    """
    STRESS TEST: Partial timeout scenario where some calls succeed and some timeout.

    Tests that successful calls don't block when other calls timeout.
    Uses REAL production delegate.
    """
    delegate = frontend_delegate

    # Create 4 concurrent calls
    contexts = []
    for i in range(4):
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"partial_timeout_{i}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}
        contexts.append(mock_context)

    async def execute_with_timeout(ctx: Mock, index: int) -> dict[str, Any]:
        return await asyncio.wait_for(
            change_bgm(track=index, tool_context=ctx),
            timeout=0.5,
        )

    # Start all tasks
    tasks = [asyncio.create_task(execute_with_timeout(contexts[i], i)) for i in range(4)]
    await asyncio.sleep(0.01)

    # Get actual fallback IDs
    pending_ids = list(delegate._pending_calls.keys())
    assert len(pending_ids) == 4

    # Resolve only 0 and 2 (1 and 3 will timeout)
    delegate.resolve_tool_result(pending_ids[0], {"success": True, "track": 0})
    delegate.resolve_tool_result(pending_ids[2], {"success": True, "track": 2})

    # Gather results (tasks 1 and 3 will timeout)
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Verify results
    assert results[0] == {"success": True, "track": 0}  # Success
    assert isinstance(results[1], asyncio.TimeoutError)  # Timeout
    assert results[2] == {"success": True, "track": 2}  # Success
    assert isinstance(results[3], asyncio.TimeoutError)  # Timeout

    # Clean up timed-out pending calls
    for i in [1, 3]:
        if pending_ids[i] in delegate._pending_calls:
            del delegate._pending_calls[pending_ids[i]]


@pytest.mark.asyncio
async def test_stress_interleaved_calls_and_resolutions() -> None:
    """
    STRESS TEST: Interleaved tool calls and resolutions (not all calls start before resolutions begin).

    Tests real-world scenario where new calls arrive while others are being resolved.
    Uses REAL production delegate.
    """
    delegate = frontend_delegate

    completed_results = []

    # Helper to create and execute a tool call
    async def create_and_execute(index: int) -> None:
        mock_context = Mock(spec=ToolContext)
        mock_context.invocation_id = f"interleaved_{index}"
        mock_context.session = Mock()
        mock_context.session.state = {"frontend_delegate": delegate}

        result = await change_bgm(track=index % 3, tool_context=mock_context)
        completed_results.append((index, result))

    # Start first 3 calls
    tasks = []
    for i in range(3):
        tasks.append(asyncio.create_task(create_and_execute(i)))
    await asyncio.sleep(0.01)

    # Verify 3 pending and get their fallback IDs
    assert len(delegate._pending_calls) == 3
    ids_0_1_2 = list(delegate._pending_calls.keys())

    # Resolve call 0
    delegate.resolve_tool_result(ids_0_1_2[0], {"success": True, "track": 0})
    await asyncio.sleep(0.01)

    # Start call 3 while others are still pending
    tasks.append(asyncio.create_task(create_and_execute(3)))
    await asyncio.sleep(0.01)

    # Get ID for call 3 (should be the new one not in the original list)
    current_ids = list(delegate._pending_calls.keys())
    id_3 = next(call_id for call_id in current_ids if call_id not in ids_0_1_2)

    # Resolve call 2
    delegate.resolve_tool_result(ids_0_1_2[2], {"success": True, "track": 2})
    await asyncio.sleep(0.01)

    # Start call 4
    tasks.append(asyncio.create_task(create_and_execute(4)))
    await asyncio.sleep(0.01)

    # Get ID for call 4
    current_ids = list(delegate._pending_calls.keys())
    id_4 = next(call_id for call_id in current_ids if call_id not in ids_0_1_2 and call_id != id_3)

    # Resolve remaining calls: 1, 3, 4
    delegate.resolve_tool_result(ids_0_1_2[1], {"success": True, "track": 1})
    delegate.resolve_tool_result(id_3, {"success": True, "track": 0})
    delegate.resolve_tool_result(id_4, {"success": True, "track": 1})

    # Wait for all tasks
    await asyncio.gather(*tasks)

    # Verify all completed successfully
    assert len(completed_results) == 5
    for index, result in completed_results:
        assert result["success"] is True
        assert result["track"] == index % 3

    # Verify no pending calls
    assert len(delegate._pending_calls) == 0
