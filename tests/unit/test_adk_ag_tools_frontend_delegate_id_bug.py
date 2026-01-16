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

from unittest.mock import AsyncMock, Mock

import pytest

from adk_stream_protocol import (
    Ok,
    change_bgm,
    get_location,
    register_delegate,
)
from adk_stream_protocol.ags._internal import _REGISTRY
from tests.utils.mocks import create_mock_session, create_mock_tool_context


@pytest.mark.asyncio
async def test_change_bgm_uses_wrong_id_when_calling_execute_on_frontend() -> None:
    """
    TDD GREEN: change_bgm() no longer passes tool_call_id, lets execute_on_frontend resolve it.

    Given: ToolContext with different invocation_id and function_call.id
    When: change_bgm() is called
    Then: execute_on_frontend() is called WITHOUT tool_call_id parameter (FIXED!)
    """
    # given - mock ToolContext with specific IDs
    mock_session = create_mock_session()
    mock_session.state = {}

    # Create mock delegate that will track what ID it receives
    mock_delegate = Mock()
    mock_delegate.execute_on_frontend = AsyncMock(return_value=Ok({"success": True, "track": 1}))

    # Store delegate in session state (this is how BIDI mode works)
    mock_session.state["frontend_delegate"] = mock_delegate
    mock_session.state["confirmation_delegate"] = Mock()  # Required to trigger BIDI mode

    # Create ToolContext with DIFFERENT invocation_id and function_call.id
    invocation_id = "e-3166e920-26d8-4452-9a7e-eb2851d2447f"  # ADK event ID

    mock_tool_context = create_mock_tool_context(
        invocation_id=invocation_id,
        session=mock_session,
    )

    # Register delegate in FrontendToolRegistry
    register_delegate(mock_session.id, mock_delegate)

    # when - call change_bgm()
    await change_bgm(track=1, tool_context=mock_tool_context)

    # then - verify execute_on_frontend was called
    assert mock_delegate.execute_on_frontend.called, "execute_on_frontend should be called"

    # Extract the actual call arguments
    call_args = mock_delegate.execute_on_frontend.call_args

    # ASSERTION (GREEN - bug is fixed!)
    # change_bgm() should NOT pass tool_call_id parameter
    assert "tool_call_id" not in call_args.kwargs, (
        f"FIXED: change_bgm() no longer passes tool_call_id parameter!\n"
        f"  execute_on_frontend will use id_mapper to resolve correct ID\n"
        f"  Call args: {call_args.kwargs}"
    )

    # Verify it passes the correct tool_name
    assert call_args.kwargs["tool_name"] == "change_bgm"
    assert call_args.kwargs["args"] == {"track": 1}

    # Cleanup
    _REGISTRY.pop(mock_session.id, None)


@pytest.mark.asyncio
async def test_get_location_uses_wrong_id_when_calling_execute_on_frontend() -> None:
    """
    TDD GREEN: get_location() also no longer passes tool_call_id parameter.

    This test verifies that ALL frontend delegate tools use the same fixed pattern.
    """
    # given
    mock_session = create_mock_session()
    mock_session.state = {}

    mock_delegate = Mock()
    mock_delegate.execute_on_frontend = AsyncMock(
        return_value=Ok({"latitude": 35.6762, "longitude": 139.6503, "location": "Tokyo"})
    )
    mock_session.state["frontend_delegate"] = mock_delegate
    mock_session.state["confirmation_delegate"] = Mock()  # Required to trigger BIDI mode

    invocation_id = "e-abc123-def456"

    mock_tool_context = create_mock_tool_context(
        invocation_id=invocation_id,
        session=mock_session,
    )

    # Register delegate in FrontendToolRegistry
    register_delegate(mock_session.id, mock_delegate)

    # when
    await get_location(tool_context=mock_tool_context)

    # then
    assert mock_delegate.execute_on_frontend.called

    call_args = mock_delegate.execute_on_frontend.call_args

    # ASSERTION (GREEN - bug is fixed!)
    assert "tool_call_id" not in call_args.kwargs, (
        f"FIXED: get_location() no longer passes tool_call_id parameter!\n"
        f"  execute_on_frontend will use id_mapper to resolve correct ID\n"
        f"  Call args: {call_args.kwargs}"
    )

    # Verify it passes the correct tool_name
    assert call_args.kwargs["tool_name"] == "get_location"
    assert call_args.kwargs["args"] == {}

    # Cleanup
    _REGISTRY.pop(mock_session.id, None)


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
    mock_session = create_mock_session()
    mock_session.state = {}

    function_call_id = "function-call-931550426395150784"

    # Create mock delegate with ID mapper that knows the correct function_call.id
    mock_delegate = Mock()
    mock_id_mapper = Mock()
    mock_id_mapper.get_function_call_id = Mock(return_value=function_call_id)
    mock_delegate.id_mapper = mock_id_mapper
    mock_delegate.execute_on_frontend = AsyncMock(return_value=Ok({"success": True, "track": 1}))

    mock_session.state["frontend_delegate"] = mock_delegate
    mock_session.state["confirmation_delegate"] = Mock()  # Required to trigger BIDI mode

    invocation_id = "e-3166e920-26d8-4452-9a7e-eb2851d2447f"

    mock_tool_context = create_mock_tool_context(
        invocation_id=invocation_id,
        session=mock_session,
    )

    # Register delegate in FrontendToolRegistry
    register_delegate(mock_session.id, mock_delegate)

    # when
    await change_bgm(track=1, tool_context=mock_tool_context)

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

    # Cleanup
    _REGISTRY.pop(mock_session.id, None)
