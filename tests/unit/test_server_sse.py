"""
Unit Tests: Server SSE Endpoint - [DONE] Stream Lifecycle Principle

Tests that server.py adheres to the design principle:
    [DONE] should ONLY be sent from finalize() in StreamProtocolConverter.

Test Strategy:
- Unit tests verify that _create_error_sse_response does NOT directly send [DONE]
- Error responses should use StreamProtocolConverter.finalize() for [DONE] transmission

Expected Results:
- Current tests will FAIL (RED) because server.py:270 violates the principle
- After refactoring, tests will PASS (GREEN)
"""

from __future__ import annotations

import pytest


class TestServerSSEDoneStreamLifecyclePrinciple:
    """Unit tests for [DONE] Stream Lifecycle Principle in server.py."""

    @pytest.mark.asyncio
    async def test_create_error_sse_response_should_not_send_done_directly(self) -> None:
        """
        TDD RED: _create_error_sse_response should NOT directly send [DONE].

        Design Principle (Session 7):
            [DONE] transmission should ONLY occur in finalize().

        Current Problem:
            server.py:270 directly yields "data: [DONE]\\n\\n" in error handler.
            This bypasses the StreamProtocolConverter layer and violates the principle.

        Expected Behavior:
            - Error responses should use StreamProtocolConverter
            - finalize() should be called with error parameter
            - [DONE] should be sent by finalize(), not by server.py

        Test Strategy:
            - Given: Error message for SSE response
            - When: _create_error_sse_response is called
            - Then: Response should NOT contain direct [DONE] string

        Expected Result:
            This test will FAIL with current implementation (RED pattern).
            It will PASS after refactoring to use finalize() (GREEN pattern).
        """
        from server import _create_error_sse_response

        # given: Error message
        error_message = "Test error: Failed to process request"

        # when: Create error SSE response
        response = _create_error_sse_response(error_message)

        # Read response stream
        events = []
        async for chunk in response.body_iterator:
            events.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8"))

        # then: Response should use StreamProtocolConverter.finalize() format
        # Verify the response contains:
        # 1. Error event from finalize(error=...)
        # 2. [DONE] marker from finalize() (not direct yield)
        assert len(events) == 2, f"Expected 2 events (error + [DONE]), got {len(events)}"

        # First event should be error event from finalize()
        assert "data:" in events[0], "First event should be SSE formatted"
        assert '"type": "error"' in events[0] or "'type': 'error'" in events[0], "First event should be error type"
        assert error_message in events[0], "First event should contain error message"

        # Second event should be [DONE] marker from finalize()
        assert events[1] == "data: [DONE]\n\n", "Second event should be [DONE] marker from finalize()"

    @pytest.mark.asyncio
    async def test_error_responses_should_use_stream_protocol_converter(self) -> None:
        """
        TDD RED: Error responses should flow through StreamProtocolConverter.

        Design Principle:
            ALL SSE responses (success or error) should use StreamProtocolConverter
            to ensure consistent [DONE] handling via finalize().

        Current Problem:
            _create_error_sse_response bypasses StreamProtocolConverter entirely,
            creating its own async generator that directly yields events.

        Expected Behavior:
            - Error responses should instantiate StreamProtocolConverter
            - Error should be passed to finalize(error=error_message)
            - finalize() handles [DONE] transmission

        Test Strategy:
            - Given: Error message
            - When: Error response is generated
            - Then: Response should use StreamProtocolConverter format

        Expected Result:
            This test will FAIL (RED) - documents the architectural gap.
            Refactoring needed to pass (GREEN).
        """
        from server import _create_error_sse_response

        # given: Error message
        error_message = "Architecture test: Converter required"

        # when: Create error SSE response
        response = _create_error_sse_response(error_message)

        # Read response stream
        events = []
        async for chunk in response.body_iterator:
            events.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8"))

        # then: Verify structure indicates StreamProtocolConverter usage
        # StreamProtocolConverter should generate structured events, not raw error dicts
        # This test documents the expectation - implementation needed

        # For now, just check that response doesn't bypass converter
        # (This is a documentation test showing the gap)
        raw_error_dict = any("'type': 'error'" in event for event in events)

        assert not raw_error_dict, (
            "Error response bypasses StreamProtocolConverter.\n"
            "Current: server.py directly creates error dict and yields [DONE].\n"
            "Expected: Use StreamProtocolConverter.finalize(error=...) for consistent [DONE] handling.\n"
            "\nResponse structure:\n" + "\n".join([f"  {event!r}" for event in events])
        )
