"""
Unit tests for adk_ag_runner module.

Tests agent configuration, tool setup, and confirmation tool extraction.
"""

from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock, Mock

import pytest
from google.adk.agents import Agent
from google.adk.tools.function_tool import FunctionTool
from google.adk.tools.long_running_tool import LongRunningFunctionTool

import adk_ag_runner
from adk_ag_runner import get_tools_requiring_confirmation

# ============================================================
# Agent Configuration Tests
# ============================================================


def test_sse_agent_exists_and_has_correct_model() -> None:
    """SSE agent should be configured with gemini-3-flash-preview model."""
    # when/then
    assert adk_ag_runner.sse_agent is not None
    assert isinstance(adk_ag_runner.sse_agent, Agent)
    assert adk_ag_runner.sse_agent.model == "gemini-3-flash-preview"


def test_bidi_agent_exists_and_has_model() -> None:
    """BIDI agent should be configured with a valid model."""
    # when/then
    assert adk_ag_runner.bidi_agent is not None
    assert isinstance(adk_ag_runner.bidi_agent, Agent)
    assert adk_ag_runner.bidi_agent.model  # Should have a model


def test_sse_agent_runner_initialized() -> None:
    """SSE agent runner should be initialized with sse_agent."""
    # when/then
    assert adk_ag_runner.sse_agent_runner is not None
    assert adk_ag_runner.sse_agent_runner.agent == adk_ag_runner.sse_agent


def test_bidi_agent_runner_initialized() -> None:
    """BIDI agent runner should be initialized with bidi_agent."""
    # when/then
    assert adk_ag_runner.bidi_agent_runner is not None
    assert adk_ag_runner.bidi_agent_runner.agent == adk_ag_runner.bidi_agent


def test_agents_have_description() -> None:
    """Both agents should have description set."""
    # when/then
    assert adk_ag_runner.sse_agent.description
    assert adk_ag_runner.bidi_agent.description
    assert (
        adk_ag_runner.sse_agent.description == adk_ag_runner.bidi_agent.description
    )  # Same description


def test_agents_have_instruction() -> None:
    """Both agents should have instruction set."""
    # when/then
    assert adk_ag_runner.sse_agent.instruction
    assert adk_ag_runner.bidi_agent.instruction
    assert (
        adk_ag_runner.sse_agent.instruction == adk_ag_runner.bidi_agent.instruction
    )  # Same instruction


# ============================================================
# Tool Configuration Tests
# ============================================================


def test_sse_agent_has_tools() -> None:
    """SSE agent should have tools configured."""
    # when/then
    assert len(adk_ag_runner.sse_agent.tools) > 0


def test_bidi_agent_has_tools() -> None:
    """BIDI agent should have tools configured."""
    # when/then
    assert len(adk_ag_runner.bidi_agent.tools) > 0


def test_both_agents_have_same_tools() -> None:
    """Both agents should use COMMON_TOOLS and have the same number of tools."""
    # when/then
    assert len(adk_ag_runner.sse_agent.tools) == len(adk_ag_runner.bidi_agent.tools)
    assert len(adk_ag_runner.sse_agent.tools) == len(adk_ag_runner.COMMON_TOOLS)


def test_common_tools_includes_expected_tools() -> None:
    """COMMON_TOOLS should include all expected tool functions."""
    # given
    tool_names = []

    # when
    for tool in adk_ag_runner.COMMON_TOOLS:
        if isinstance(tool, FunctionTool):
            if hasattr(tool, "func") and hasattr(tool.func, "__name__"):
                tool_names.append(tool.func.__name__)
        elif isinstance(tool, LongRunningFunctionTool):
            if hasattr(tool, "_func") and hasattr(tool._func, "__name__"):
                tool_names.append(tool._func.__name__)
        elif callable(tool) and hasattr(tool, "__name__"):
            tool_names.append(tool.__name__)

    # then
    assert "get_weather" in tool_names
    assert "process_payment" in tool_names
    assert "change_bgm" in tool_names
    assert "get_location" in tool_names
    assert "approval_test_tool" in tool_names


# ============================================================
# get_tools_requiring_confirmation Tests
# ============================================================


def test_get_tools_requiring_confirmation_with_empty_agent() -> None:
    """Should return empty list when agent has no tools."""
    # given
    mock_agent = Mock(spec=Agent)
    mock_agent.tools = []

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert result == []


def test_get_tools_requiring_confirmation_with_no_confirmation_tools() -> None:
    """Should return empty list when no tools require confirmation."""
    # given
    mock_tool = Mock()
    mock_tool.func = lambda: None
    mock_tool.func.__name__ = "normal_tool"

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = [mock_tool]

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert result == []


def test_get_tools_requiring_confirmation_with_function_tool_requiring_confirmation() -> None:
    """Should extract tool names from FunctionTool with require_confirmation=True."""
    # given
    def my_payment_tool():
        pass

    function_tool = FunctionTool(my_payment_tool, require_confirmation=True)

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = [function_tool]

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert len(result) == 1
    assert "my_payment_tool" in result


def test_get_tools_requiring_confirmation_with_multiple_confirmation_tools() -> None:
    """Should extract all tools requiring confirmation."""
    # given
    def payment_tool():
        pass

    def location_tool():
        pass

    def normal_tool():
        pass

    tools = [
        FunctionTool(payment_tool, require_confirmation=True),
        normal_tool,  # No confirmation
        FunctionTool(location_tool, require_confirmation=True),
    ]

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = tools

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert len(result) == 2
    assert "payment_tool" in result
    assert "location_tool" in result
    assert "normal_tool" not in result


def test_get_tools_requiring_confirmation_mixed_tool_types() -> None:
    """Should handle mixed tool types (FunctionTool, LongRunningFunctionTool, plain functions)."""
    # given
    def confirmed_tool():
        pass

    def long_running_tool():
        pass

    def plain_tool():
        pass

    tools = [
        FunctionTool(confirmed_tool, require_confirmation=True),
        LongRunningFunctionTool(long_running_tool),  # No confirmation
        plain_tool,  # Plain function, no confirmation
    ]

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = tools

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert len(result) == 1
    assert "confirmed_tool" in result


def test_get_tools_requiring_confirmation_fallback_to_str_if_no_func_name() -> None:
    """Should fallback to str() if tool has no func.__name__ attribute."""
    # given
    mock_tool = MagicMock(spec=FunctionTool)
    mock_tool._require_confirmation = True
    # Mock tool doesn't have func with __name__, should use str()

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = [mock_tool]

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    # Should return something (fallback to str representation)
    assert len(result) == 1


# ============================================================
# Configuration Constants Tests
# ============================================================


def test_sse_confirmation_tools_extracted() -> None:
    """SSE_CONFIRMATION_TOOLS should contain tools requiring confirmation."""
    # when/then
    assert isinstance(adk_ag_runner.SSE_CONFIRMATION_TOOLS, list)
    # Should include process_payment and get_location
    assert "process_payment" in adk_ag_runner.SSE_CONFIRMATION_TOOLS
    assert "get_location" in adk_ag_runner.SSE_CONFIRMATION_TOOLS


def test_bidi_confirmation_tools_extracted() -> None:
    """BIDI_CONFIRMATION_TOOLS should contain tools requiring confirmation."""
    # when/then
    assert isinstance(adk_ag_runner.BIDI_CONFIRMATION_TOOLS, list)
    # Should include process_payment and get_location
    assert "process_payment" in adk_ag_runner.BIDI_CONFIRMATION_TOOLS
    assert "get_location" in adk_ag_runner.BIDI_CONFIRMATION_TOOLS


def test_both_agents_have_same_confirmation_tools() -> None:
    """Both SSE and BIDI agents should have same confirmation tools (use COMMON_TOOLS)."""
    # when/then
    assert set(adk_ag_runner.SSE_CONFIRMATION_TOOLS) == set(
        adk_ag_runner.BIDI_CONFIRMATION_TOOLS
    )


# ============================================================
# Real Agent Configuration Tests
# ============================================================


def test_real_sse_agent_confirmation_tools_match_expected() -> None:
    """Real SSE agent should have exactly the tools we expect to require confirmation."""
    # when
    result = get_tools_requiring_confirmation(adk_ag_runner.sse_agent)

    # then
    assert "process_payment" in result
    assert "get_location" in result
    # Should NOT include tools without confirmation
    assert "get_weather" not in result
    assert "change_bgm" not in result


def test_real_bidi_agent_confirmation_tools_match_expected() -> None:
    """Real BIDI agent should have exactly the tools we expect to require confirmation."""
    # when
    result = get_tools_requiring_confirmation(adk_ag_runner.bidi_agent)

    # then
    assert "process_payment" in result
    assert "get_location" in result
    # Should NOT include tools without confirmation
    assert "get_weather" not in result
    assert "change_bgm" not in result


# ============================================================
# Edge Cases
# ============================================================


@pytest.mark.parametrize(
    "require_confirmation,expected_count",
    [
        (True, 1),
        (False, 0),
        (None, 0),
    ],
)
def test_get_tools_requiring_confirmation_with_various_confirmation_flags(
    require_confirmation, expected_count
) -> None:
    """Should handle various require_confirmation flag values."""
    # given
    def test_tool():
        pass

    tool: FunctionTool | Callable[[], Any]  # Union type for conditional assignment
    if require_confirmation is not None:
        tool = FunctionTool(test_tool, require_confirmation=require_confirmation)
    else:
        tool = test_tool  # Plain function

    mock_agent = Mock(spec=Agent)
    mock_agent.tools = [tool]

    # when
    result = get_tools_requiring_confirmation(mock_agent)

    # then
    assert len(result) == expected_count


def test_get_tools_requiring_confirmation_with_none_agent_tools() -> None:
    """Should handle agent with None tools attribute gracefully."""
    # given
    mock_agent = Mock(spec=Agent)
    mock_agent.tools = None

    # when/then - Should raise an error or handle None
    with pytest.raises(TypeError):
        get_tools_requiring_confirmation(mock_agent)
