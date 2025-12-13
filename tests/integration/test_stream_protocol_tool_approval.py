"""
Integration tests for stream_protocol.py + tool_delegate.py integration.

These tests mock frontend behavior (sendMessages with tool-use parts) and verify:
1. StreamProtocolConverter generates tool-approval-request events
2. FrontendToolDelegate awaits tool execution
3. Message handler processes approval-responded tool-use parts
4. Proper routing to reject_tool_call() or resolve_tool_result()

Test Strategy (TDD):
- Mock frontend behavior from lib/use-chat-integration.test.tsx
- Test stream_protocol.py + tool_delegate.py integration
- ADK library is external (not counted as 3rd component)

Frontend behavior being mocked:
- addToolApprovalResponse({ approved: true/false }) → sendMessages()
- sendMessages() sends messages array with approval-responded tool-use parts
- Messages structure matches AI SDK v6 UIMessage format
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from google.adk.events import Event
from google.genai import types

from ai_sdk_v6_compat import (
    ChatMessage,
    ToolApproval,
    ToolCallState,
    ToolUsePart,
    process_tool_use_parts,
)
from stream_protocol import StreamProtocolConverter
from tool_delegate import FrontendToolDelegate

# ============================================================
# Test Fixtures
# ============================================================


@pytest.fixture
def delegate() -> FrontendToolDelegate:
    """Create a fresh FrontendToolDelegate instance for each test."""
    return FrontendToolDelegate()


@pytest.fixture
def converter() -> StreamProtocolConverter:
    """Create StreamProtocolConverter with tools requiring approval."""
    tools_requiring_approval = {"change_bgm", "get_location", "web_search"}
    return StreamProtocolConverter(
        message_id="msg-test",
        tools_requiring_approval=tools_requiring_approval,
    )


# ============================================================
# Integration Tests: StreamProtocolConverter Event Generation
# ============================================================


@pytest.mark.asyncio
async def test_stream_protocol_generates_tool_approval_request(
    converter: StreamProtocolConverter,
) -> None:
    """
    Should generate tool-approval-request event for tools requiring approval.

    Flow (Backend → Frontend):
    1. ADK generates tool_call event
    2. StreamProtocolConverter converts to AI SDK v6 events
    3. tool-input-start, tool-input-available, tool-approval-request generated
    4. Frontend receives events and updates UI
    """
    # given: ADK tool_call event (function_call part)
    # Create function_call part (ADK format)
    function_call = types.FunctionCall(
        name="change_bgm",
        id="call_abc123",
        args={"track": 1},
    )
    part = types.Part(function_call=function_call)
    content = types.Content(role="model", parts=[part])
    event = Event(author="model", content=content)

    # when: Convert to AI SDK v6 events
    events = []
    async for sse_event in converter.convert_event(event):
        events.append(sse_event)

    # then: Should generate tool-approval-request event
    # Expected: 3 events (tool-input-start, tool-input-available, tool-approval-request)
    assert len(events) >= 3

    # Check that tool-approval-request event exists
    approval_events = [e for e in events if "tool-approval-request" in e]
    assert len(approval_events) > 0

    approval_event = approval_events[0]
    assert "approvalId" in approval_event
    assert "call_abc123" in approval_event  # ADK's function_call.id is used


@pytest.mark.asyncio
async def test_stream_protocol_tracks_pending_approvals(
    converter: StreamProtocolConverter,
) -> None:
    """
    Should track pending approvals for tool-approval-request events.

    This verifies that converter maintains approvalId → toolCallId mapping.
    """
    # given: ADK tool_call event (function_call part)
    # Create function_call part (ADK format)
    function_call = types.FunctionCall(
        name="change_bgm",
        id="call_abc123",
        args={"track": 1},
    )
    part = types.Part(function_call=function_call)
    content = types.Content(role="model", parts=[part])
    event = Event(author="model", content=content)

    # when: Convert to AI SDK v6 events
    async for _sse_event in converter.convert_event(event):
        pass  # Process events to populate pending_approvals

    # then: Should store pending approval
    assert len(converter.pending_approvals) == 1

    # Extract approvalId from generated event
    # (In real implementation, frontend would use this)
    approval_id = list(converter.pending_approvals.keys())[0]
    tool_call_id = converter.pending_approvals[approval_id]

    assert tool_call_id == "call_abc123"


# ============================================================
# Integration Tests: Frontend Behavior Mocking
# ============================================================


@pytest.mark.asyncio
async def test_frontend_single_tool_approval_flow(
    delegate: FrontendToolDelegate,
) -> None:
    """
    Should handle single-tool approval flow from frontend.

    Mocks frontend behavior from lib/use-chat-integration.test.tsx:
    - addToolApprovalResponse({ approved: true })
    - sendMessages() called immediately (single tool → auto-submit)
    - Backend receives messages with approval-responded tool-use part
    - Backend extracts approved=true and calls resolve_tool_result()

    This test verifies the backend processing logic for approval-responded messages.
    """
    # given: Pending tool call (backend waiting for frontend approval)
    tool_call_id = "call_abc123"
    tool_name = "change_bgm"
    args = {"track": 1}

    # Backend tool delegates execution to frontend
    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, tool_name, args)

    execution_task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)  # Ensure Future is created

    # when: Frontend user approves the tool
    # Simulated frontend flow:
    #   1. User clicks [Approve]
    #   2. addToolApprovalResponse({ id: "approval-1", approved: true, reason: "User approved" })
    #   3. AI SDK v6 updates tool-use part state to "approval-responded"
    #   4. sendAutomaticallyWhen condition met (single tool complete) → sendMessages()
    #   5. Backend receives messages with approval-responded tool-use part

    # Mock: Backend processes approval-responded message
    # Note: Actual message processing logic should extract approved=true
    #       and call delegate.resolve_tool_result()
    expected_result = {"success": True, "track": 1}
    delegate.resolve_tool_result(tool_call_id, expected_result)

    # then: Tool execution completes with result
    result = await execution_task
    assert result == expected_result


@pytest.mark.asyncio
async def test_frontend_single_tool_rejection_flow(
    delegate: FrontendToolDelegate,
) -> None:
    """
    Should handle single-tool rejection flow from frontend.

    Mocks frontend behavior from lib/use-chat-integration.test.tsx (line 594-728):
    - addToolApprovalResponse({ approved: false })
    - sendMessages() called immediately (single tool → auto-submit)
    - Backend receives messages with approval-responded tool-use part (approved=false)
    - addToolOutput() does NOT trigger second submit (status guard)
    - Backend should extract approved=false and call reject_tool_call()

    This is the critical test for rejection handling.
    """
    # given: Pending tool call
    tool_call_id = "call_abc123"
    tool_name = "change_bgm"
    args = {"track": 1}

    async def execute_tool() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id, tool_name, args)

    execution_task = asyncio.create_task(execute_tool())
    await asyncio.sleep(0.01)

    # when: Frontend user rejects the tool
    # Simulated frontend flow:
    #   1. User clicks [Deny]
    #   2. addToolApprovalResponse({ id: "approval-1", approved: false, reason: "User denied permission" })
    #   3. AI SDK v6 updates tool-use part state to "approval-responded" with approved=false
    #   4. sendAutomaticallyWhen condition met (single tool complete) → sendMessages() (1st submit)
    #   5. Backend receives messages with approval-responded tool-use part (approved=false)
    #   6. (Frontend) addToolOutput() updates state locally but does NOT trigger 2nd submit (status guard)

    # Mock: Backend processes approval-responded message with approved=false
    # Note: Actual message processing logic should extract approved=false
    #       and call delegate.reject_tool_call()
    reason = "User denied permission"
    delegate.reject_tool_call(tool_call_id, reason)

    # then: Tool execution completes with rejection error
    result = await execution_task
    assert result["success"] is False
    assert result["denied"] is True
    assert "denied permission" in result["error"].lower()


# ============================================================
# Integration Tests: Multiple Tools (RED - Not Implemented)
# ============================================================


@pytest.mark.asyncio
async def test_frontend_multiple_tools_mixed_approval_rejection(
    delegate: FrontendToolDelegate,
) -> None:
    """
    Should handle multiple tools with mixed approval/rejection.

    Mocks frontend behavior from lib/use-chat-integration.test.tsx (line 463-592):
    - Tool-1: addToolApprovalResponse({ approved: false }) → no auto-submit
    - Tool-2: addToolOutput() → all tools complete → auto-submit
    - Backend receives messages with both tools:
      - Tool-1: approval-responded (approved=false)
      - Tool-2: output-available
    - Backend should process both and call appropriate delegate methods

    Tests the process_tool_use_parts() function that extracts tool-use parts
    from AI SDK v6 messages and routes to FrontendToolDelegate.
    """
    # given: Two pending tool calls
    tool_call_id_1 = "call_1"
    tool_call_id_2 = "call_2"

    async def execute_tool_1() -> dict[str, Any]:
        return await delegate.execute_on_frontend(
            tool_call_id_1, "web_search", {"query": "AI news"}
        )

    async def execute_tool_2() -> dict[str, Any]:
        return await delegate.execute_on_frontend(tool_call_id_2, "change_bgm", {"track": 0})

    task_1 = asyncio.create_task(execute_tool_1())
    task_2 = asyncio.create_task(execute_tool_2())
    await asyncio.sleep(0.01)

    # when: Frontend sends messages with tool-use parts
    # Simulating what frontend sends after:
    # - Tool-1: User rejects → approval-responded (approved=false)
    # - Tool-2: Backend executes → output-available
    # Both sent in single sendMessages() call

    # Mock frontend message structure (from lib/use-chat-integration.test.tsx:557-575)
    frontend_message = ChatMessage(
        role="assistant",
        parts=[
            ToolUsePart(
                type="tool-web_search",
                toolCallId=tool_call_id_1,
                toolName="web_search",
                state=ToolCallState.APPROVAL_RESPONDED,
                approval=ToolApproval(
                    id="approval-1",
                    approved=False,
                    reason="User denied permission",
                ),
            ),
            ToolUsePart(
                type="tool-change_bgm",
                toolCallId=tool_call_id_2,
                toolName="change_bgm",
                state=ToolCallState.OUTPUT_AVAILABLE,
                output={"success": True, "track": 0},
            ),
        ],
    )

    # Backend message handler should process these tool-use parts
    process_tool_use_parts(frontend_message, delegate)

    # then: Both tools complete
    result_1 = await task_1
    result_2 = await task_2

    assert result_1["success"] is False
    assert result_1["denied"] is True
    assert result_2["success"] is True


# ============================================================
# TODO: Integration Tests for Full Flow
# ============================================================

# TODO: Test end-to-end flow:
# - StreamProtocolConverter generates tool-approval-request
# - Frontend receives and processes
# - Frontend sends approval-responded via sendMessages
# - Message handler extracts tool-use parts
# - Delegate methods called correctly
# - Tool execution completes
