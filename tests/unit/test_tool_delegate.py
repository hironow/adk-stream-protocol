"""
Unit tests for tool_delegate module.

Tests the FrontendToolDelegate class for AP2-style awaitable delegation.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from tool_delegate import FrontendToolDelegate


@pytest.fixture
def delegate():
    """Create a fresh FrontendToolDelegate instance for each test."""
    return FrontendToolDelegate()


@pytest.mark.asyncio
async def test_execute_on_frontend_creates_future(delegate):
    """
    Should create a Future when execute_on_frontend is called.

    The Future should be stored in _pending_calls with the tool_call_id as key.
    """
    # given
    tool_call_id = "test_call_123"
    tool_name = "test_tool"
    args = {"arg1": "value1"}

    # when: Start execution (but don't await yet)
    task = asyncio.create_task(
        delegate.execute_on_frontend(tool_call_id, tool_name, args)
    )

    # Give the task a chance to start
    await asyncio.sleep(0.01)

    # then: Future should be created and stored
    assert tool_call_id in delegate._pending_calls
    assert isinstance(delegate._pending_calls[tool_call_id], asyncio.Future)

    # Clean up: Resolve the future to prevent warnings
    delegate.resolve_tool_result(tool_call_id, {"success": True})
    await task


@pytest.mark.asyncio
async def test_resolve_tool_result_completes_future(delegate):
    """
    Should complete the pending Future when resolve_tool_result is called.

    The awaiting execute_on_frontend call should receive the result.
    """
    # given
    tool_call_id = "test_call_456"
    tool_name = "change_bgm"
    args = {"track": 1}
    expected_result = {"success": True, "message": "BGM changed"}

    # when: Start execution (but don't await yet)
    task = asyncio.create_task(
        delegate.execute_on_frontend(tool_call_id, tool_name, args)
    )

    # Give the task a chance to create the future
    await asyncio.sleep(0.01)

    # Resolve the future with a result
    delegate.resolve_tool_result(tool_call_id, expected_result)

    # then: Task should complete with the expected result
    result = await task
    assert result == expected_result

    # Future should be removed from pending_calls
    assert tool_call_id not in delegate._pending_calls


@pytest.mark.asyncio
async def test_reject_tool_call_returns_rejection(delegate):
    """
    Should return rejection result when reject_tool_call is called.

    The awaiting execute_on_frontend call should receive the rejection.
    """
    # given
    tool_call_id = "test_call_789"
    tool_name = "get_location"
    args = {}
    rejection_reason = "User denied location permission"

    # when: Start execution
    task = asyncio.create_task(
        delegate.execute_on_frontend(tool_call_id, tool_name, args)
    )

    # Give the task a chance to create the future
    await asyncio.sleep(0.01)

    # Reject the tool call
    delegate.reject_tool_call(tool_call_id, rejection_reason)

    # then: Task should complete with rejection result
    result = await task
    assert result == {
        "success": False,
        "error": rejection_reason,
        "denied": True,
    }

    # Future should be removed from pending_calls
    assert tool_call_id not in delegate._pending_calls


@pytest.mark.asyncio
async def test_multiple_concurrent_tool_calls(delegate):
    """
    Should handle multiple concurrent tool calls correctly.

    Each tool call should receive its own result without interference.
    """
    # given
    call_1_id = "call_1"
    call_2_id = "call_2"
    call_3_id = "call_3"

    # when: Start three concurrent tool calls
    task_1 = asyncio.create_task(
        delegate.execute_on_frontend(call_1_id, "tool_1", {"param": 1})
    )
    task_2 = asyncio.create_task(
        delegate.execute_on_frontend(call_2_id, "tool_2", {"param": 2})
    )
    task_3 = asyncio.create_task(
        delegate.execute_on_frontend(call_3_id, "tool_3", {"param": 3})
    )

    # Give tasks a chance to create futures
    await asyncio.sleep(0.01)

    # All three futures should be pending
    assert call_1_id in delegate._pending_calls
    assert call_2_id in delegate._pending_calls
    assert call_3_id in delegate._pending_calls

    # Resolve them in different order
    delegate.resolve_tool_result(call_2_id, {"result": 2})
    delegate.reject_tool_call(call_1_id, "Rejected")
    delegate.resolve_tool_result(call_3_id, {"result": 3})

    # then: Each task should get its correct result
    result_1 = await task_1
    assert result_1 == {"success": False, "error": "Rejected", "denied": True}

    result_2 = await task_2
    assert result_2 == {"result": 2}

    result_3 = await task_3
    assert result_3 == {"result": 3}

    # All futures should be cleaned up
    assert len(delegate._pending_calls) == 0


def test_resolve_unknown_tool_call_id_is_safe(delegate):
    """
    Should handle resolving unknown tool_call_id gracefully.

    Should not raise an error, just log a warning.
    """
    # given
    unknown_id = "unknown_123"

    # when/then: Should not raise an error
    delegate.resolve_tool_result(unknown_id, {"result": "test"})

    # Nothing should be in pending_calls
    assert len(delegate._pending_calls) == 0


def test_reject_unknown_tool_call_id_is_safe(delegate):
    """
    Should handle rejecting unknown tool_call_id gracefully.

    Should not raise an error, just log a warning.
    """
    # given
    unknown_id = "unknown_456"

    # when/then: Should not raise an error
    delegate.reject_tool_call(unknown_id, "Test rejection")

    # Nothing should be in pending_calls
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_execute_on_frontend_blocks_until_resolved(delegate):
    """
    execute_on_frontend should block (await) until result is provided.

    This tests the core awaitable pattern of the delegate.
    """
    # given
    tool_call_id = "blocking_test"
    result_received = False
    expected_result = {"data": "test_data"}

    async def delayed_resolve():
        """Resolve the future after a delay."""
        await asyncio.sleep(0.05)  # 50ms delay
        delegate.resolve_tool_result(tool_call_id, expected_result)

    # when: Start both the tool call and the delayed resolution
    resolve_task = asyncio.create_task(delayed_resolve())

    # This should block until resolved
    result = await delegate.execute_on_frontend(
        tool_call_id, "test_tool", {}
    )
    result_received = True

    # then: Result should match what was resolved
    assert result == expected_result
    assert result_received is True

    # Clean up
    await resolve_task


@pytest.mark.asyncio
async def test_concurrent_delegates_are_isolated():
    """
    Multiple FrontendToolDelegate instances should be isolated.

    This is important for BIDI mode where each connection gets its own delegate.
    """
    # given
    delegate_1 = FrontendToolDelegate()
    delegate_2 = FrontendToolDelegate()

    tool_call_id = "shared_id"  # Same ID for both

    # when: Both delegates handle the same tool_call_id
    task_1 = asyncio.create_task(
        delegate_1.execute_on_frontend(tool_call_id, "tool", {})
    )
    task_2 = asyncio.create_task(
        delegate_2.execute_on_frontend(tool_call_id, "tool", {})
    )

    await asyncio.sleep(0.01)

    # Resolve with different results
    delegate_1.resolve_tool_result(tool_call_id, {"source": "delegate_1"})
    delegate_2.resolve_tool_result(tool_call_id, {"source": "delegate_2"})

    # then: Each should get its own result
    result_1 = await task_1
    result_2 = await task_2

    assert result_1 == {"source": "delegate_1"}
    assert result_2 == {"source": "delegate_2"}

    # Both should have cleaned up
    assert len(delegate_1._pending_calls) == 0
    assert len(delegate_2._pending_calls) == 0


@pytest.mark.asyncio
async def test_timeout_behavior_with_unresolved_future(delegate):
    """
    Test what happens if a future is never resolved.

    This test demonstrates that unresolved futures will wait indefinitely
    unless a timeout is implemented (which is not currently in the code).
    """
    # given
    tool_call_id = "timeout_test"

    # when: Start execution without resolving
    task = asyncio.create_task(
        delegate.execute_on_frontend(tool_call_id, "test_tool", {})
    )

    # Wait a bit to ensure future is created
    await asyncio.sleep(0.01)

    # then: Future should still be pending
    assert tool_call_id in delegate._pending_calls
    assert not task.done()

    # Clean up: Cancel the task to prevent warnings
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    # Clean up pending call after cancellation
    if tool_call_id in delegate._pending_calls:
        del delegate._pending_calls[tool_call_id]