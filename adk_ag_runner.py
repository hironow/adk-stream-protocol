"""
ADK Agent and Runner Configuration

This module contains:
- Agent configurations (SSE and BIDI modes)
- InMemoryRunner initialization
- Tool imports from adk_ag_tools module
"""

import os

from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.adk.tools.function_tool import FunctionTool
from loguru import logger

# Import tool functions from adk_ag_tools module
from adk_ag_tools import (
    change_bgm,
    get_location,
    get_weather,
    process_payment,
    # Note: adk_request_confirmation is imported in server.py for manual execution
    # It's NOT registered as a tool in the agent to avoid conflict with ADK's auto-generated calls
)

# ========== Monkey Patch for Native Audio Model Support ==========
# ADK SDK hardcodes v1alpha for Google AI Studio, but native-audio models require v1beta
# Reference: experiments/2025-12-18_bidi_function_response_investigation.md
from google.adk.models.google_llm import Gemini
from google.adk.utils.variant_utils import GoogleLLMVariant


def _patched_live_api_version(self: Gemini) -> str:
    """Patched version that uses v1beta for both Vertex AI and Google AI Studio."""
    if self._api_backend == GoogleLLMVariant.VERTEX_AI:
        return "v1beta1"
    else:
        # Changed from v1alpha to v1beta to support native-audio models
        return "v1beta"


# Apply monkey patch before agent initialization
Gemini._live_api_version = property(_patched_live_api_version)  # type: ignore
logger.info("[MONKEY PATCH] Applied _live_api_version override to use v1beta for Google AI Studio")

# ========== Constants for Agent Configuration ==========
# Fixed values for reproducible behavior

# Note: ADK Agent doesn't support seed and temperature parameters
# These would be used for deterministic responses if supported:
# ADK_SEED = 42
# ADK_TEMPERATURE = 0.7

# Common agent description
AGENT_DESCRIPTION = "An intelligent assistant that can check weather, process payments, control BGM, and access location"

# Common agent instruction
AGENT_INSTRUCTION = (
    "You are a helpful AI assistant with access to the following tools:\n"
    "- get_weather: Check weather for any city\n"
    "- process_payment: Process payment transactions (requires user approval via ADK confirmation)\n"
    "- change_bgm: Change background music track to 1 or 2 (auto-executes on frontend)\n"
    "- get_location: Get user's location (auto-executes on frontend via browser Geolocation API)\n\n"
    "IMPORTANT: You MUST use these tools to perform the requested actions. "
    "When a user asks you to check weather, send money, change BGM, or get location, "
    "you must call the corresponding tool function - do not just describe what you would do.\n\n"
    "For example:\n"
    "- User: '東京の天気は?' → Call get_weather(location='Tokyo')\n"
    "- User: '100ドルをAliceに送金して' → Call process_payment(amount=100, recipient='Alice', currency='USD')\n"
    "- User: 'トラック1に変更して' → Call change_bgm(track=1)\n"
    "- User: '私の位置を教えて' → Call get_location()\n\n"
    "Note: process_payment requires user approval before execution (ADK Tool Confirmation Flow)."
)

# ========== ADK Agent Setup ==========
# Based on official ADK quickstart examples
# https://google.github.io/adk-docs/get-started/quickstart/

# Verify API key is set in environment
# ADK reads GOOGLE_API_KEY (not GOOGLE_GENERATIVE_AI_API_KEY like AI SDK)
API_KEY = os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    logger.error("GOOGLE_API_KEY not found in environment! ADK will fail.")
    logger.error("Note: ADK uses GOOGLE_API_KEY, while AI SDK uses GOOGLE_GENERATIVE_AI_API_KEY")
else:
    logger.info(f"ADK API key loaded: {API_KEY[:10]}...")

# ========= Define Agents ==========
# https://ai.google.dev/gemini-api/docs/models

# SSE Agent: Uses stable model for generateContent API (SSE streaming)
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-3-flash-preview",  # Gemini 3 Flash Preview for generateContent API (SSE mode)
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=[
        get_weather,
        FunctionTool(process_payment, require_confirmation=True),
        change_bgm,
        get_location,  # Uses global frontend_delegate for approval (past implementation pattern)
    ],
    # Note: ADK Agent doesn't support seed and temperature parameters
)

# BIDI Agent: Uses Live API model for bidirectional streaming
# Model can be configured via ADK_BIDI_MODEL env var, defaults to native-audio model for audio support
# default is newest available model
bidi_model = os.getenv("ADK_BIDI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model=bidi_model,  # Configurable model for BIDI mode
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=[
        get_weather,
        FunctionTool(process_payment, require_confirmation=True),  # Enable confirmation in BIDI mode
        change_bgm,
        get_location,
        # Note: adk_request_confirmation is NOT registered as a tool
        # ADK automatically generates it for tools with require_confirmation=True
        # We intercept the auto-generated FunctionCall and execute the Python function
    ],
    # Note: ADK Agent doesn't support seed and temperature parameters
)

# Initialize InMemoryRunners for each agent
sse_agent_runner = InMemoryRunner(agent=sse_agent, app_name="agents")
bidi_agent_runner = InMemoryRunner(agent=bidi_agent, app_name="agents")

logger.info("ADK agents and runners initialized successfully")


# ========== Tool Confirmation Configuration ==========
# Extract tools requiring confirmation from agent definitions
# This ensures Single Source of Truth: agent tool configuration is authoritative


def get_tools_requiring_confirmation(agent: Agent) -> list[str]:
    """
    Extract tool names that require user confirmation from an Agent.

    Automatically detects FunctionTool with require_confirmation=True.
    This provides configuration-driven confirmation without hardcoding tool names.

    Args:
        agent: ADK Agent object

    Returns:
        List of tool names requiring confirmation (e.g., ["process_payment"])

    Example:
        >>> tools = get_tools_requiring_confirmation(bidi_agent)
        >>> print(tools)
        ['process_payment']
    """
    confirmation_tools = []

    logger.debug(f"[Agent Config] Checking {len(agent.tools)} tools for confirmation requirement")

    for i, tool in enumerate(agent.tools):
        logger.debug(f"[Agent Config] Tool[{i}]: type={type(tool).__name__}, tool={tool}")

        # Check if tool is FunctionTool
        is_function_tool = isinstance(tool, FunctionTool)
        logger.debug(f"[Agent Config] Tool[{i}]: isinstance(FunctionTool)={is_function_tool}")

        if is_function_tool:
            # Check _require_confirmation attribute (ADK uses private attribute)
            has_attr = hasattr(tool, "_require_confirmation")
            attr_value = getattr(tool, "_require_confirmation", None)
            logger.debug(f"[Agent Config] Tool[{i}]: has _require_confirmation={has_attr}, value={attr_value}")

            if attr_value:
                # Extract function name from FunctionTool
                # FunctionTool wraps a callable, get the name from __name__ or func attribute
                if hasattr(tool, "func") and hasattr(tool.func, "__name__"):
                    tool_name = tool.func.__name__
                else:
                    # Fallback: use string representation
                    tool_name = str(tool)

                confirmation_tools.append(tool_name)
                logger.info(f"[Agent Config] ✓ Tool requires confirmation: {tool_name}")

    return confirmation_tools


# Extract confirmation tools for each agent
# These lists are used by ToolConfirmationInterceptor in BIDI mode
SSE_CONFIRMATION_TOOLS = get_tools_requiring_confirmation(sse_agent)
BIDI_CONFIRMATION_TOOLS = get_tools_requiring_confirmation(bidi_agent)

logger.info(f"SSE Agent confirmation tools: {SSE_CONFIRMATION_TOOLS}")
logger.info(f"BIDI Agent confirmation tools: {BIDI_CONFIRMATION_TOOLS}")
