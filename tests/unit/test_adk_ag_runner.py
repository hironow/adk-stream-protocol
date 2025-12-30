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

from adk_stream_protocol import adk_ag_runner
from tests.utils.mocks import create_mock_agent


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


def test_agent_runners_initialized() -> None:
    """Both agent runners should be initialized with their respective agents."""
    # when/then
    assert adk_ag_runner.sse_agent_runner is not None
    assert adk_ag_runner.sse_agent_runner.agent == adk_ag_runner.sse_agent
    assert adk_ag_runner.bidi_agent_runner is not None
    assert adk_ag_runner.bidi_agent_runner.agent == adk_ag_runner.bidi_agent


def test_agents_have_same_description_and_instruction() -> None:
    """Both agents should have same description and instruction set."""
    # when/then
    assert adk_ag_runner.sse_agent.description
    assert adk_ag_runner.bidi_agent.description
    assert adk_ag_runner.sse_agent.instruction
    assert adk_ag_runner.bidi_agent.instruction
    # Should have same values
    assert adk_ag_runner.sse_agent.description == adk_ag_runner.bidi_agent.description
    assert adk_ag_runner.sse_agent.instruction == adk_ag_runner.bidi_agent.instruction


# ============================================================
# Tool Configuration Tests
# ============================================================


def test_both_agents_have_same_tools() -> None:
    """Both agents should have the same number of tools (4 tools each)."""
    # when/then
    assert len(adk_ag_runner.sse_agent.tools) == len(adk_ag_runner.bidi_agent.tools)
    assert len(adk_ag_runner.sse_agent.tools) == 4  # get_weather, process_payment, change_bgm, get_location


def test_sse_tools_includes_expected_tools() -> None:
    """SSE agent tools should include all expected tool functions."""
    # given
    tool_names = []

    # when - Extract tool names from SSE agent
    for tool in adk_ag_runner.sse_agent.tools:
        if isinstance(tool, FunctionTool):
            if hasattr(tool, "func") and hasattr(tool.func, "__name__"):
                tool_names.append(tool.func.__name__)
        elif isinstance(tool, LongRunningFunctionTool):
            if hasattr(tool, "_func") and hasattr(tool._func, "__name__"):
                tool_names.append(tool._func.__name__)
        elif callable(tool) and hasattr(tool, "__name__"):
            tool_names.append(tool.__name__)

    # then - Verify the 4 production tools (no approval_test_tool)
    assert "get_weather" in tool_names
    assert "process_payment" in tool_names
    assert "change_bgm" in tool_names
    assert "get_location" in tool_names
    assert len(tool_names) == 4  # Exactly 4 tools


def test_both_agents_have_same_confirmation_tools() -> None:
    """Both SSE and BIDI agents should have same confirmation tools (use COMMON_TOOLS)."""
    # when/then
    assert isinstance(adk_ag_runner.SSE_CONFIRMATION_TOOLS, list)
    assert isinstance(adk_ag_runner.BIDI_CONFIRMATION_TOOLS, list)
    assert set(adk_ag_runner.SSE_CONFIRMATION_TOOLS) == set(adk_ag_runner.BIDI_CONFIRMATION_TOOLS)
    # Should include process_payment and get_location
    assert "process_payment" in adk_ag_runner.SSE_CONFIRMATION_TOOLS
    assert "get_location" in adk_ag_runner.SSE_CONFIRMATION_TOOLS
