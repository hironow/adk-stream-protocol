"""
Unit tests for services/frontend_tool_service.py (Service Layer).

Tests FrontendToolDelegate service layer implementation focusing on:
- asyncio.Future-based delegation pattern
- 5-second timeout for deadlock detection
- ADKVercelIDMapper integration for ID resolution
- Confirmation ID prefix handling (confirmation-{id})
- Multiple ID resolution strategies

This file tests the SERVICE LAYER abstraction (services/frontend_tool_service.py),
distinct from the older server.py-based implementation (tested in test_frontend_delegate.py).
"""

import asyncio
from typing import Any

import pytest

from adk_stream_protocol import Error, FrontendToolDelegate, Ok
from adk_stream_protocol.protocol.adk_vercel_id_mapper import ADKVercelIDMapper
from tests.utils.result_assertions import assert_error, assert_ok


# ============================================================
# Basic Delegation Pattern Tests
# ============================================================


@pytest.mark.asyncio
async def test_execute_on_frontend_with_id_mapper_registration() -> None:
    """execute_on_frontend() with ID mapper registration should work."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("test_tool", "call_123")

    # when
    async def execute_and_resolve() -> None:
        # Simulate concurrent resolution
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("call_123", {"success": True, "data": "result"})

    resolve_task = asyncio.create_task(execute_and_resolve())
    result_or_error = await delegate.execute_on_frontend(
        tool_name="test_tool",
        args={"param": "value"},
    )
    await resolve_task

    # then
    result = assert_ok(result_or_error)
    assert result == {"success": True, "data": "result"}
    assert "call_123" not in delegate._pending_calls  # Cleaned up


@pytest.mark.asyncio
async def test_execute_on_frontend_with_id_mapper() -> None:
    """execute_on_frontend() should use ID mapper when tool_call_id not provided."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("test_tool", "function-call-456")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)

    # when
    async def execute_and_resolve() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("function-call-456", {"result": "from_mapper"})

    resolve_task = asyncio.create_task(execute_and_resolve())
    result_or_error = await delegate.execute_on_frontend(
        tool_name="test_tool",
        args={},
        # No tool_call_id - should use ID mapper
    )
    await resolve_task

    # then
    result = assert_ok(result_or_error)
    assert result == {"result": "from_mapper"}


@pytest.mark.asyncio
async def test_execute_on_frontend_with_original_context() -> None:
    """execute_on_frontend() should resolve intercepted tool IDs using original_context."""
    # given
    id_mapper = ADKVercelIDMapper()
    # Register the original tool
    id_mapper.register("original_tool", "original-123")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)

    # when
    async def execute_and_resolve() -> None:
        await asyncio.sleep(0.01)
        # Frontend resolves with original ID
        delegate.resolve_tool_result("original-123", {"confirmed": True})

    resolve_task = asyncio.create_task(execute_and_resolve())
    # Intercepted tool provides original_context to resolve correct ID
    original_fc = {"id": "original-123", "name": "original_tool"}
    result_or_error = await delegate.execute_on_frontend(
        tool_name="intercepted_tool",
        args={},
        original_context=original_fc,  # Provide original context
    )
    await resolve_task

    # then
    result = assert_ok(result_or_error)
    assert result == {"confirmed": True}


@pytest.mark.asyncio
async def test_execute_on_frontend_uses_fallback_when_no_mapping() -> None:
    """execute_on_frontend() should return error when ID not in mapper."""
    # given
    delegate = FrontendToolDelegate()

    # when - No ID mapping registered
    result_or_error = await delegate.execute_on_frontend(
        tool_name="unknown_tool",
        args={},
    )

    # then - Should immediately return error (no fallback)
    error_msg = assert_error(result_or_error)
    assert "not found" in error_msg.lower()


# ============================================================
# Timeout Tests (5-second deadlock detection)
# ============================================================


@pytest.mark.asyncio
async def test_execute_on_frontend_timeout_detection() -> None:
    """execute_on_frontend() should timeout after 10 seconds if no response."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("test_tool", "test_call_id")

    # when - Never resolve, should timeout after 10 seconds
    result_or_error = await delegate.execute_on_frontend(
        tool_name="test_tool",
        args={},
    )

    # then
    error_msg = assert_error(result_or_error)
    assert "timeout" in error_msg.lower()

    # Verify all Futures were cleaned up after timeout
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_execute_on_frontend_timeout_with_pending_calls_logged() -> None:
    """Timeout should log pending calls for debugging and clean up properly."""
    # given
    delegate = FrontendToolDelegate()

    # Register ID mappings for two pending calls
    delegate._id_mapper.register("pending_tool", "pending_call_1")
    delegate._id_mapper.register("pending_tool_2", "pending_call_2")

    # Create multiple pending calls that will timeout
    async def start_pending_call(tool_name: str) -> bool:
        result_or_error = await delegate.execute_on_frontend(
            tool_name=tool_name,
            args={},
        )
        match result_or_error:
            case Ok(_):
                return False  # Should not reach here - expecting timeout
            case Error(_):
                return True  # Expected timeout error

    task1 = asyncio.create_task(start_pending_call("pending_tool"))
    task2 = asyncio.create_task(start_pending_call("pending_tool_2"))

    # Give tasks time to register
    await asyncio.sleep(0.01)

    # Verify both are pending
    assert len(delegate._pending_calls) == 2

    # when - Wait for both to timeout (this will take ~5 seconds)
    results = await asyncio.gather(task1, task2)

    # then - Both should have timed out
    assert results[0] is True  # task1 caught TimeoutError
    assert results[1] is True  # task2 caught TimeoutError

    # Verify all cleaned up after timeout
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_execute_on_frontend_resolved_before_timeout() -> None:
    """execute_on_frontend() should return immediately if resolved before timeout."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("quick_tool", "quick_id")

    # when
    async def resolve_quickly() -> None:
        await asyncio.sleep(0.1)  # Resolve in 100ms (well before 5s timeout)
        delegate.resolve_tool_result("quick_id", {"fast": True})

    resolve_task = asyncio.create_task(resolve_quickly())

    # Should complete in ~100ms, not wait for 5s timeout
    import time

    start = time.time()
    result_or_error = await delegate.execute_on_frontend(
        tool_name="quick_tool",
        args={},
    )
    elapsed = time.time() - start
    result = assert_ok(result_or_error)

    await resolve_task

    # then
    assert result == {"fast": True}
    assert elapsed < 1.0  # Should be much faster than 5s timeout


# ============================================================
# Resolve Tool Result Tests
# ============================================================


@pytest.mark.asyncio
async def test_resolve_tool_result_direct_id() -> None:
    """resolve_tool_result() should resolve Future with direct ID match."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("test", "direct_id")

    async def execute_tool() -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name="test",
            args={},
        )
        return assert_ok(result_or_error)

    task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # when
    delegate.resolve_tool_result("direct_id", {"resolved": True})

    # then
    result = await task
    assert result == {"resolved": True}
    assert "direct_id" not in delegate._pending_calls


@pytest.mark.asyncio
async def test_resolve_tool_result_confirmation_prefix() -> None:
    """resolve_tool_result() should strip confirmation- prefix and resolve."""
    # given
    id_mapper = ADKVercelIDMapper()
    id_mapper.register("original_tool", "original-id-123")
    delegate = FrontendToolDelegate(id_mapper=id_mapper)

    async def execute_tool() -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name="original_tool",
            args={},
            # Uses ID mapper to get "original-id-123"
        )
        return assert_ok(result_or_error)

    task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # when - Frontend sends with confirmation- prefix
    delegate.resolve_tool_result("confirmation-original-id-123", {"confirmed": True})

    # then - Should still resolve (prefix stripped)
    result = await task
    assert result == {"confirmed": True}


@pytest.mark.asyncio
async def test_resolve_tool_result_unknown_id_no_crash() -> None:
    """resolve_tool_result() with unknown ID should log warning but not crash."""
    # given
    delegate = FrontendToolDelegate()

    # when/then - Should not raise exception
    delegate.resolve_tool_result("unknown_id", {"data": "ignored"})

    # Verify state is clean
    assert len(delegate._pending_calls) == 0


# ============================================================
# Reject Tool Call Tests
# ============================================================


@pytest.mark.asyncio
async def test_reject_tool_call_raises_exception() -> None:
    """reject_tool_call() should result in Error from execute_on_frontend()."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("test", "reject_id")

    # when
    task = asyncio.create_task(
        delegate.execute_on_frontend(
            tool_name="test",
            args={},
        )
    )
    await asyncio.sleep(0.01)

    delegate._reject_tool_call("reject_id", "User denied access")

    # then - execute_on_frontend catches RuntimeError and returns Error
    result_or_error = await task
    error_msg = assert_error(result_or_error)
    assert "User denied access" in error_msg
    assert "RuntimeError" in error_msg

    # Verify cleaned up
    assert "reject_id" not in delegate._pending_calls


@pytest.mark.asyncio
async def test_reject_tool_call_unknown_id_no_crash() -> None:
    """reject_tool_call() with unknown ID should log warning but not crash."""
    # given
    delegate = FrontendToolDelegate()

    # when/then - Should not raise exception
    delegate._reject_tool_call("unknown_id", "Error message")

    # Verify state is clean
    assert len(delegate._pending_calls) == 0


# ============================================================
# ID Mapper Integration Tests
# ============================================================


@pytest.mark.asyncio
async def test_set_function_call_id() -> None:
    """set_function_call_id() should register ID in mapper for later use."""
    # given
    delegate = FrontendToolDelegate()

    # when
    delegate.set_function_call_id("my_tool", "function-call-999")

    # then - Should be able to execute using tool_name only
    async def resolve_after() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("function-call-999", {"mapped": True})

    resolve_task = asyncio.create_task(resolve_after())
    result_or_error = await delegate.execute_on_frontend(
        tool_name="my_tool",
        args={},
        # No tool_call_id - uses mapper
    )
    await resolve_task

    result = assert_ok(result_or_error)
    assert result == {"mapped": True}


@pytest.mark.asyncio
async def test_custom_id_mapper_injection() -> None:
    """FrontendToolDelegate should accept custom ID mapper."""
    # given
    custom_mapper = ADKVercelIDMapper()
    custom_mapper.register("custom_tool", "custom-id-123")
    delegate = FrontendToolDelegate(id_mapper=custom_mapper)

    # when
    async def resolve_after() -> None:
        await asyncio.sleep(0.01)
        delegate.resolve_tool_result("custom-id-123", {"custom": True})

    resolve_task = asyncio.create_task(resolve_after())
    result_or_error = await delegate.execute_on_frontend(
        tool_name="custom_tool",
        args={},
    )
    await resolve_task

    # then
    result = assert_ok(result_or_error)
    assert result == {"custom": True}


@pytest.mark.asyncio
async def test_default_id_mapper_created_if_not_provided() -> None:
    """FrontendToolDelegate should create default ID mapper if none provided."""
    # given/when
    delegate = FrontendToolDelegate()

    # then
    assert delegate._id_mapper is not None
    assert isinstance(delegate._id_mapper, ADKVercelIDMapper)


# ============================================================
# Multiple Pending Calls Tests
# ============================================================


@pytest.mark.asyncio
async def test_multiple_pending_calls_independent_resolution() -> None:
    """Multiple pending calls should be resolved independently."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("tool_call_1", "call_1")
    delegate._id_mapper.register("tool_call_2", "call_2")
    delegate._id_mapper.register("tool_call_3", "call_3")

    async def execute_tool(tool_name: str) -> dict[str, Any]:
        result_or_error = await delegate.execute_on_frontend(
            tool_name=tool_name,
            args={},
        )
        return assert_ok(result_or_error)

    # when - Start 3 calls
    task1 = asyncio.create_task(execute_tool("tool_call_1"))
    task2 = asyncio.create_task(execute_tool("tool_call_2"))
    task3 = asyncio.create_task(execute_tool("tool_call_3"))
    await asyncio.sleep(0.01)

    # Verify all pending
    assert len(delegate._pending_calls) == 3

    # Resolve in different order: 2, 1, 3
    delegate.resolve_tool_result("call_2", {"order": 2})
    result2 = await task2
    assert result2 == {"order": 2}
    assert len(delegate._pending_calls) == 2

    delegate.resolve_tool_result("call_1", {"order": 1})
    result1 = await task1
    assert result1 == {"order": 1}
    assert len(delegate._pending_calls) == 1

    delegate.resolve_tool_result("call_3", {"order": 3})
    result3 = await task3
    assert result3 == {"order": 3}

    # then - All resolved and cleaned up
    assert len(delegate._pending_calls) == 0


@pytest.mark.asyncio
async def test_multiple_pending_calls_one_timeout() -> None:
    """One timeout should not affect other pending calls."""
    # given
    delegate = FrontendToolDelegate()
    delegate._id_mapper.register("tool_success_call", "success_call")
    delegate._id_mapper.register("tool_timeout_call", "timeout_call")

    # when - Start 2 calls, resolve only one
    task1 = asyncio.create_task(
        delegate.execute_on_frontend(
            tool_name="tool_success_call",
            args={},
        )
    )
    task2 = asyncio.create_task(
        delegate.execute_on_frontend(
            tool_name="tool_timeout_call",
            args={},
        )
    )
    await asyncio.sleep(0.01)

    # Resolve task1 quickly
    delegate.resolve_tool_result("success_call", {"status": "ok"})
    result1_or_error = await task1
    result1 = assert_ok(result1_or_error)
    assert result1 == {"status": "ok"}

    # task2 should timeout independently and return Error
    result2_or_error = await task2
    error_msg = assert_error(result2_or_error)
    assert "timeout_call" in error_msg
    assert "timeout" in error_msg.lower()

    # then - Both cleaned up
    assert len(delegate._pending_calls) == 0
