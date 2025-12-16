"""
Integration tests for SSE mode tool approval flow.

Tests the critical bug fix: SSE endpoint must process tool outputs from
incoming messages before running the agent, otherwise delegate futures
hang forever waiting for results that never arrive.

Related: experiments/2025-12-16_frontend_delegate_fix.md

Test Strategy:
- Mock agent execution (sse_agent_runner.run_async) to prevent real LLM calls
- Keep process_tool_use_parts and frontend_delegate REAL (no mocking)
- Verify tool output processing happens correctly
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client() -> TestClient:
    """Create FastAPI test client."""
    return TestClient(app)


async def mock_empty_agent_stream() -> AsyncIterator[Any]:
    """Mock agent that yields no events (for tool output processing tests)."""
    # Yield nothing - we're just testing tool output processing
    if False:  # Make this an async generator
        yield


def test_sse_processes_tool_outputs_from_messages(client: TestClient) -> None:
    """
    Should process tool outputs from messages before running agent.

    This is the core fix: when frontend sends tool output via addToolOutput()
    and includes it in the next request's messages array, the /stream endpoint
    must call process_tool_use_parts() to resolve the delegate's Future.

    Without this, the delegate hangs forever waiting for resolve_tool_result().
    """
    # given: Frontend executed tool and sends result
    tool_output_request = {
        "messages": [
            {"role": "user", "content": "Please change the BGM to track 1"},
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-change_bgm",  # No toolName field
                        "toolCallId": "test-tool-id",
                        "state": "output-available",
                        "output": {
                            "success": True,
                            "current_track": 1,
                            "message": "BGM changed",
                        },
                    }
                ],
            },
            {"role": "user", "content": ""},  # Empty continuation message
        ]
    }

    # when: Send request with tool output
    # Mock the agent to prevent real LLM calls
    with patch("server.sse_agent_runner.run_async", return_value=mock_empty_agent_stream()):
        with patch(
            "server.process_tool_use_parts", wraps=__import__("server").process_tool_use_parts
        ) as mock_process:
            response = client.post("/stream", json=tool_output_request)

            # then: Should process tool outputs
            assert response.status_code == 200

            # Verify process_tool_use_parts was called
            assert mock_process.called, "process_tool_use_parts should be called"

            # Verify it was called with assistant message containing tool output
            calls = mock_process.call_args_list
            assert len(calls) > 0, "Should have at least one call"

            # Find the call that processed our tool output
            tool_output_processed = False
            for call in calls:
                msg, delegate = call[0]
                if msg.role == "assistant" and msg.parts:
                    for part in msg.parts:
                        if hasattr(part, "tool_call_id") and part.tool_call_id == "test-tool-id":
                            tool_output_processed = True
                            break

            assert tool_output_processed, "Tool output should be processed from messages"


def test_sse_resolves_delegate_future_from_messages(client: TestClient) -> None:
    """
    Should call frontend_delegate.resolve_tool_result() when processing messages.

    This verifies the Future resolution path: process_tool_use_parts() extracts
    tool output and calls delegate.resolve_tool_result(), which resolves the
    Future that the backend tool is awaiting.
    """
    # given: Message with tool output
    request_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-change_bgm",
                        "toolCallId": "future-test-id",
                        "state": "output-available",
                        "output": {"success": True, "track": 1},
                    }
                ],
            },
            {"role": "user", "content": "continue"},
        ]
    }

    # when: Send request
    # Mock agent and patch frontend_delegate to verify resolve_tool_result is called
    from tool_delegate import frontend_delegate

    with patch("server.sse_agent_runner.run_async", return_value=mock_empty_agent_stream()):
        with patch.object(frontend_delegate, "resolve_tool_result") as mock_resolve:
            response = client.post("/stream", json=request_data)

            # then: Should call resolve_tool_result
            assert response.status_code == 200
            assert mock_resolve.called, "frontend_delegate.resolve_tool_result should be called"

            # Verify it was called with correct arguments
            mock_resolve.assert_called_once_with("future-test-id", {"success": True, "track": 1})


def test_sse_handles_tool_name_derivation(client: TestClient) -> None:
    """
    Should correctly validate tool parts without explicit toolName field.

    This tests the Pydantic fix: ToolUsePart should auto-derive tool_name
    from type field when toolName is missing (frontend doesn't send it).
    """
    # given: Tool output without toolName field (only type)
    request_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-get_location",  # No toolName
                        "toolCallId": "location-123",
                        "state": "output-available",
                        "output": {"lat": 35.6762, "lng": 139.6503},
                    }
                ],
            },
            {"role": "user", "content": ""},
        ]
    }

    # when: Send request (should not raise validation error)
    with patch("server.sse_agent_runner.run_async", return_value=mock_empty_agent_stream()):
        try:
            response = client.post("/stream", json=request_data)
            validation_success = True
        except Exception:
            validation_success = False

        # then: Should validate successfully
        assert validation_success, "Should validate tool part without toolName field"
        assert response.status_code == 200


def test_sse_continues_conversation_after_tool(client: TestClient) -> None:
    """
    Should continue conversation after processing tool output.

    This is the user-facing verification: after tool execution, the
    conversation should continue normally without hanging or errors.
    """
    # given: Complete flow with tool approval and output
    request_with_output = {
        "messages": [
            {"role": "user", "content": "Change BGM"},
            {
                "role": "assistant",
                "parts": [
                    {"type": "text", "text": "Changing BGM..."},
                    {
                        "type": "tool-change_bgm",
                        "toolCallId": "bgm-456",
                        "state": "output-available",
                        "output": {
                            "success": True,
                            "current_track": 2,
                            "message": "BGM changed to track 2",
                        },
                    },
                ],
            },
            {"role": "user", "content": ""},  # Continuation
        ]
    }

    # when: Send request with mocked agent
    with patch("server.sse_agent_runner.run_async", return_value=mock_empty_agent_stream()):
        response = client.post("/stream", json=request_with_output)

        # then: Should return 200 and streaming response
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

        # Should not hang (response completes)
        content = response.text
        assert content is not None, "Response should complete (not hang)"


def test_sse_processes_multiple_tool_outputs(client: TestClient) -> None:
    """
    Should process multiple tool outputs in a single message.

    Verifies that all tool parts are processed, not just the first one.
    """
    # given: Message with multiple tool outputs
    request_data = {
        "messages": [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool-calculate",
                        "toolCallId": "calc-1",
                        "state": "output-available",
                        "output": {"result": 42},
                    },
                    {"type": "text", "text": "Processed calculation..."},
                    {
                        "type": "tool-get_weather",
                        "toolCallId": "weather-1",
                        "state": "output-available",
                        "output": {"temp": 20, "condition": "sunny"},
                    },
                ],
            },
            {"role": "user", "content": "continue"},
        ]
    }

    # when: Send request with mocked agent
    from tool_delegate import frontend_delegate

    with patch("server.sse_agent_runner.run_async", return_value=mock_empty_agent_stream()):
        with patch.object(frontend_delegate, "resolve_tool_result") as mock_resolve:
            response = client.post("/stream", json=request_data)

            # then: Should process both tool outputs
            assert response.status_code == 200
            assert mock_resolve.call_count == 2, "Should resolve both tool results"

            # Verify both tools were resolved
            calls = [call[0] for call in mock_resolve.call_args_list]
            tool_ids = {call[0] for call in calls}
            assert "calc-1" in tool_ids
            assert "weather-1" in tool_ids
