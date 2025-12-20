"""
Unit Test (RED): Frontend delegate tools use wrong ID when calling execute_on_frontend.

Problem discovered in E2E scenario-6 (BIDI mode, change_bgm tool):
- Tool function calls execute_on_frontend(tool_call_id=tool_context.invocation_id)
- tool_context.invocation_id = "e-3166e920-26d8-4452-9a7e-eb2851d2447f" (event ID)
- But function_call.id = "function-call-931550426395150784" (tool call ID)
- Frontend sends result with function_call.id
- Backend awaits result with invocation_id
- ID mismatch → timeout

This test verifies that change_bgm() calls execute_on_frontend() with the WRONG ID
(invocation_id instead of function_call.id).

Expected to FAIL until fixed.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from google.adk.sessions import Session
from google.adk.tools import ToolContext

from adk_ag_tools import change_bgm


@pytest.mark.asyncio
async def test_change_bgm_uses_wrong_id_when_calling_execute_on_frontend() -> None:
    """
    TDD RED: change_bgm() calls execute_on_frontend with invocation_id instead of function_call.id.

    Given: ToolContext with different invocation_id and function_call.id
    When: change_bgm() is called
    Then: execute_on_frontend() is called with invocation_id (WRONG!)
    """
    # given - mock ToolContext with specific IDs
    mock_session = Mock(spec=Session)
    mock_session.state = {}

    # Create mock delegate that will track what ID it receives
    mock_delegate = Mock()
    mock_delegate.execute_on_frontend = AsyncMock(return_value={"success": True, "track": 1})

    # Store delegate in session state (this is how BIDI mode works)
    mock_session.state["frontend_delegate"] = mock_delegate

    # Create ToolContext with DIFFERENT invocation_id and function_call.id
    invocation_id = "e-3166e920-26d8-4452-9a7e-eb2851d2447f"  # ADK event ID
    function_call_id = "function-call-931550426395150784"  # Tool call ID that frontend knows

    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.invocation_id = invocation_id
    mock_tool_context.session = mock_session

    # when - call change_bgm()
    result = await change_bgm(track=1, tool_context=mock_tool_context)

    # then - verify execute_on_frontend was called
    assert mock_delegate.execute_on_frontend.called, "execute_on_frontend should be called"

    # Extract the actual call arguments
    call_args = mock_delegate.execute_on_frontend.call_args
    actual_tool_call_id = call_args.kwargs["tool_call_id"]

    # ASSERTION (RED - expected to fail because of the bug)
    assert actual_tool_call_id != invocation_id, (
        f"BUG: change_bgm() called execute_on_frontend with WRONG ID!\n"
        f"  Used: {actual_tool_call_id} (invocation_id)\n"
        f"  Should use: {function_call_id} (function_call.id)\n"
        f"\n"
        f"This causes ID mismatch:\n"
        f"  1. Backend awaits result with invocation_id: {invocation_id}\n"
        f"  2. Frontend sends result with function_call.id: {function_call_id}\n"
        f"  3. IDs don't match → timeout after 5 seconds\n"
        f"\n"
        f"Fix: change_bgm() should use function_call.id from id_mapper or session state"
    )

    # Additional assertion: It should use function_call.id
    # (This will also fail in RED phase since we don't have function_call.id available yet)
    assert actual_tool_call_id == function_call_id, (
        f"change_bgm() should call execute_on_frontend with function_call.id\n"
        f"  Expected: {function_call_id}\n"
        f"  Actual: {actual_tool_call_id}"
    )


@pytest.mark.asyncio
async def test_get_location_uses_wrong_id_when_calling_execute_on_frontend() -> None:
    """
    TDD RED: get_location() also has the same ID mismatch bug.

    This test documents that ALL frontend delegate tools have this bug, not just change_bgm.
    """
    from adk_ag_tools import get_location

    # given
    mock_session = Mock(spec=Session)
    mock_session.state = {}

    mock_delegate = Mock()
    mock_delegate.execute_on_frontend = AsyncMock(
        return_value={"latitude": 35.6762, "longitude": 139.6503, "location": "Tokyo"}
    )
    mock_session.state["frontend_delegate"] = mock_delegate

    invocation_id = "e-abc123-def456"
    function_call_id = "function-call-789012"

    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.invocation_id = invocation_id
    mock_tool_context.session = mock_session

    # when
    result = await get_location(tool_context=mock_tool_context)

    # then
    assert mock_delegate.execute_on_frontend.called

    call_args = mock_delegate.execute_on_frontend.call_args
    actual_tool_call_id = call_args.kwargs["tool_call_id"]

    # ASSERTION (RED - expected to fail)
    assert actual_tool_call_id != invocation_id, (
        f"BUG: get_location() also uses invocation_id instead of function_call.id!\n"
        f"  Used: {actual_tool_call_id}\n"
        f"  Should use: {function_call_id}\n"
        f"This is the same bug as change_bgm()"
    )


@pytest.mark.asyncio
async def test_frontend_delegate_tools_should_use_id_mapper() -> None:
    """
    TDD RED: Frontend delegate tools should use ID mapper to get function_call.id.

    The correct fix is to:
    1. Remove tool_call_id parameter from execute_on_frontend call
    2. Let execute_on_frontend use its id_mapper to resolve the correct ID
    3. ID mapper was already set up by StreamProtocolConverter when processing function_call

    This test documents the expected behavior after fix.
    """
    # given
    mock_session = Mock(spec=Session)
    mock_session.state = {}

    function_call_id = "function-call-931550426395150784"

    # Create mock delegate with ID mapper that knows the correct function_call.id
    mock_delegate = Mock()
    mock_id_mapper = Mock()
    mock_id_mapper.get_function_call_id = Mock(return_value=function_call_id)
    mock_delegate.id_mapper = mock_id_mapper
    mock_delegate.execute_on_frontend = AsyncMock(return_value={"success": True, "track": 1})

    mock_session.state["frontend_delegate"] = mock_delegate

    invocation_id = "e-3166e920-26d8-4452-9a7e-eb2851d2447f"

    mock_tool_context = Mock(spec=ToolContext)
    mock_tool_context.invocation_id = invocation_id
    mock_tool_context.session = mock_session

    # when
    result = await change_bgm(track=1, tool_context=mock_tool_context)

    # then - verify execute_on_frontend was called
    assert mock_delegate.execute_on_frontend.called

    call_args = mock_delegate.execute_on_frontend.call_args

    # ASSERTION (RED - will fail because current implementation passes tool_call_id explicitly)
    # After fix, change_bgm() should NOT pass tool_call_id parameter
    # Instead, execute_on_frontend should use id_mapper to resolve it
    assert "tool_call_id" not in call_args.kwargs or call_args.kwargs["tool_call_id"] is None, (
        f"BUG: change_bgm() should NOT pass tool_call_id parameter!\n"
        f"  Current: calls execute_on_frontend(tool_call_id={call_args.kwargs.get('tool_call_id')})\n"
        f"  Expected: calls execute_on_frontend(tool_name='change_bgm', args={{...}})\n"
        f"\n"
        f"Let execute_on_frontend() resolve the ID using its id_mapper:\n"
        f"  1. change_bgm() calls execute_on_frontend(tool_name='change_bgm', args={{...}})\n"
        f"  2. execute_on_frontend() uses id_mapper.get_function_call_id('change_bgm')\n"
        f"  3. ID mapper returns: {function_call_id}\n"
        f"  4. execute_on_frontend() registers Future with correct ID\n"
        f"  5. Frontend sends result with same ID\n"
        f"  6. ✅ IDs match → no timeout"
    )
