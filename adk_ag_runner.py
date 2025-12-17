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
from adk_ag_tools import change_bgm, get_location, get_weather, process_payment

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

# SSE Agent: Uses stable model for generateContent API (SSE streaming)
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-2.5-flash",  # Stable Gemini 2.5 Flash for generateContent API (SSE mode)
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
bidi_model = os.getenv("ADK_BIDI_MODEL", "gemini-2.5-flash-native-audio-preview-09-2025")
bidi_agent = Agent(
    name="adk_assistant_agent_bidi",
    model=bidi_model,  # Configurable model for BIDI mode
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=[
        get_weather,
        process_payment,  # NOTE: require_confirmation not supported in BIDI mode
        change_bgm,
        get_location,
    ],
    # Note: ADK Agent doesn't support seed and temperature parameters
)

# Initialize InMemoryRunners for each agent
sse_agent_runner = InMemoryRunner(agent=sse_agent, app_name="agents")
bidi_agent_runner = InMemoryRunner(agent=bidi_agent, app_name="agents")

logger.info("ADK agents and runners initialized successfully")
