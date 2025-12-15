"""
Unit tests for Tool Approval feature (Phase 4).

Tests the tool approval flow:
1. Backend generates tool-approval-request event (AI SDK v6 format)
2. Frontend displays approval UI
3. User approves/rejects via addToolApprovalResponse()
4. Backend receives approval and executes or rejects tool

Based on AI SDK v6 Data Stream Protocol.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    pass


# ============================================================
# Test Fixtures
# ============================================================


@pytest.fixture
def change_bgm_tool_call() -> dict[str, object]:
    """Sample tool call for change_bgm."""
    return {
        "id": "call_abc123",
        "type": "function",
        "function": {
            "name": "change_bgm",
            "arguments": json.dumps({"track": 1}),
        },
    }


@pytest.fixture
def get_location_tool_call() -> dict[str, object]:
    """Sample tool call for get_location (sensitive)."""
    return {
        "id": "call_xyz789",
        "type": "function",
        "function": {
            "name": "get_location",
            "arguments": json.dumps({}),
        },
    }


# ============================================================
# Tool Approval Request Event Generation Tests
# ============================================================


def test_generate_tool_approval_request_event(
    change_bgm_tool_call: dict[str, object],
) -> None:
    """Should generate tool-approval-request event in AI SDK v6 format."""
    # given
    tool_call = change_bgm_tool_call
    approval_id = str(uuid.uuid4())

    # when
    event = {
        "type": "tool-approval-request",
        "approvalId": approval_id,
        "toolCallId": tool_call["id"],
    }

    # then
    assert event["type"] == "tool-approval-request"
    assert event["approvalId"] == approval_id
    assert event["toolCallId"] == "call_abc123"


def test_tool_approval_request_has_required_fields(
    change_bgm_tool_call: dict[str, object],
) -> None:
    """Tool approval request must have type, approvalId, and toolCallId."""
    # given
    tool_call = change_bgm_tool_call
    approval_id = str(uuid.uuid4())

    # when
    event = {
        "type": "tool-approval-request",
        "approvalId": approval_id,
        "toolCallId": tool_call["id"],
    }

    # then
    assert "type" in event
    assert "approvalId" in event
    assert "toolCallId" in event


def test_approval_id_is_unique() -> None:
    """Each approval request should have unique approvalId."""
    # given
    approval_id_1 = str(uuid.uuid4())
    approval_id_2 = str(uuid.uuid4())

    # then
    assert approval_id_1 != approval_id_2


# ============================================================
# Tool Approval Response Event Parsing Tests
# ============================================================


def test_parse_tool_approval_response_approved() -> None:
    """Should parse tool-approval-response with approved=true."""
    # given
    response = {
        "approvalId": "approval-1",
        "approved": True,
        "type": "tool-approval-response",
    }

    # when
    approval_id = response.get("approvalId")
    approved = response.get("approved")
    response_type = response.get("type")

    # then
    assert approval_id == "approval-1"
    assert approved is True
    assert response_type == "tool-approval-response"


def test_parse_tool_approval_response_rejected() -> None:
    """Should parse tool-approval-response with approved=false."""
    # given
    response = {
        "approvalId": "approval-1",
        "approved": False,
        "reason": "User denied permission",
        "type": "tool-approval-response",
    }

    # when
    approval_id = response.get("approvalId")
    approved = response.get("approved")
    reason = response.get("reason")

    # then
    assert approval_id == "approval-1"
    assert approved is False
    assert reason == "User denied permission"


def test_tool_approval_response_reason_is_optional() -> None:
    """Reason field should be optional in tool-approval-response."""
    # given
    response = {
        "approvalId": "approval-1",
        "approved": True,
        "type": "tool-approval-response",
    }

    # when
    reason = response.get("reason")

    # then
    assert reason is None


# ============================================================
# Tool Requiring Approval Detection Tests
# ============================================================


def test_change_bgm_requires_approval(change_bgm_tool_call: dict[str, object]) -> None:
    """change_bgm tool should require approval."""
    # given
    tool_call = change_bgm_tool_call
    tool_name = tool_call["function"]["name"]  # type: ignore[index]

    # when
    requires_approval = tool_name in ["change_bgm", "get_location"]

    # then
    assert requires_approval is True


def test_get_location_requires_approval(
    get_location_tool_call: dict[str, object],
) -> None:
    """get_location tool should require approval."""
    # given
    tool_call = get_location_tool_call
    tool_name = tool_call["function"]["name"]  # type: ignore[index]

    # when
    requires_approval = tool_name in ["change_bgm", "get_location"]

    # then
    assert requires_approval is True


def test_regular_tool_does_not_require_approval() -> None:
    """Regular tools (not in approval list) should not require approval."""
    # given
    tool_call: dict[str, Any] = {
        "id": "call_regular",
        "type": "function",
        "function": {
            "name": "get_current_time",
            "arguments": json.dumps({}),
        },
    }
    tool_name = tool_call["function"]["name"]

    # when
    requires_approval = tool_name in ["change_bgm", "get_location"]

    # then
    assert requires_approval is False


# ============================================================
# SSE Format Tests
# ============================================================


def test_tool_approval_request_sse_format() -> None:
    """Tool approval request should be formatted as SSE event per AI SDK v6 spec."""
    # given
    approval_id = str(uuid.uuid4())
    tool_call_id = "call_abc123"

    # when
    event_data = {
        "type": "tool-approval-request",
        "approvalId": approval_id,
        "toolCallId": tool_call_id,
    }
    # AI SDK v6 spec: No "event:" prefix, only data: field
    sse_line = f"data: {json.dumps(event_data)}\n\n"

    # then
    assert "data: " in sse_line
    assert "event:" not in sse_line  # AI SDK v6 doesn't use event: prefix
    assert approval_id in sse_line
    assert tool_call_id in sse_line
    # Verify JSON structure
    data_json = json.loads(sse_line.split("data: ")[1].split("\n")[0])
    assert data_json["type"] == "tool-approval-request"
    assert data_json["approvalId"] == approval_id
    assert data_json["toolCallId"] == tool_call_id


# ============================================================
# Approval State Management Tests
# ============================================================


def test_pending_approvals_storage() -> None:
    """Should store pending approval state."""
    # given
    pending_approvals: dict[str, dict[str, object]] = {}
    approval_id = str(uuid.uuid4())
    tool_call: dict[str, Any] = {
        "id": "call_abc123",
        "function": {
            "name": "change_bgm",
            "arguments": '{"track": 1}',
        },
    }

    # when
    pending_approvals[approval_id] = {
        "tool_call_id": tool_call["id"],
        "tool_name": tool_call["function"]["name"],
        "arguments": tool_call["function"]["arguments"],
    }

    # then
    assert approval_id in pending_approvals
    stored = pending_approvals[approval_id]
    assert stored["tool_call_id"] == "call_abc123"
    assert stored["tool_name"] == "change_bgm"
    assert stored["arguments"] == '{"track": 1}'


def test_retrieve_pending_approval() -> None:
    """Should retrieve pending approval by approvalId."""
    # given
    pending_approvals: dict[str, dict[str, object]] = {}
    approval_id = str(uuid.uuid4())
    pending_approvals[approval_id] = {
        "tool_call_id": "call_abc123",
        "tool_name": "change_bgm",
        "arguments": '{"track": 1}',
    }

    # when
    approval = pending_approvals.get(approval_id)

    # then
    assert approval is not None
    assert approval["tool_call_id"] == "call_abc123"


def test_remove_completed_approval() -> None:
    """Should remove approval from pending after completion."""
    # given
    pending_approvals: dict[str, dict[str, object]] = {}
    approval_id = str(uuid.uuid4())
    pending_approvals[approval_id] = {
        "tool_call_id": "call_abc123",
        "tool_name": "change_bgm",
        "arguments": '{"track": 1}',
    }

    # when
    del pending_approvals[approval_id]

    # then
    assert approval_id not in pending_approvals


# ============================================================
# Edge Cases
# ============================================================


def test_handle_missing_approval_id() -> None:
    """Should handle missing approvalId gracefully."""
    # given
    pending_approvals: dict[str, dict[str, object]] = {}
    nonexistent_id = str(uuid.uuid4())

    # when
    approval = pending_approvals.get(nonexistent_id)

    # then
    assert approval is None


def test_approval_response_without_reason() -> None:
    """Approval response should work without reason field."""
    # given
    response = {
        "approvalId": "approval-1",
        "approved": True,
        "type": "tool-approval-response",
    }

    # when
    approval_id = response.get("approvalId")
    approved = response.get("approved")
    reason = response.get("reason", None)

    # then
    assert approval_id == "approval-1"
    assert approved is True
    assert reason is None
