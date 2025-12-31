"""
ADK Agent and Runner Configuration

This module contains:
- Agent configurations (SSE and BIDI modes)
- InMemoryRunner initialization
- Tool imports from adk_ag_tools module
"""

import os

from google.adk.agents import Agent
from google.adk.apps import App, ResumabilityConfig
from google.adk.runners import InMemoryRunner
from google.adk.tools.function_tool import FunctionTool
from google.genai import types
from loguru import logger

from .adk_ag_tools import (
    change_bgm,
    get_location,
    get_weather,
    process_payment,
)


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
    "- get_weather: Check weather for any city (server execution, no approval required)\n"
    "- process_payment: Process payment transactions (server execution, requires user approval)\n"
    "- change_bgm: Change background music track to 1 or 2 (client execution, no approval required)\n"
    "- get_location: Get user's location (client execution via browser Geolocation API, requires user approval)\n"
    "\n"
    "IMPORTANT: You MUST use these tools to perform the requested actions. "
    "When a user asks you to check weather, send money, change BGM, get location, or test approval, "
    "you must call the corresponding tool function - do not just describe what you would do.\n\n"
    "For example:\n"
    "- User: '東京の天気は?' → Call get_weather(location='Tokyo')\n"
    "- User: '100ドルをAliceに送金して' → Call process_payment(amount=100, recipient='Alice', currency='USD')\n"
    "- User: 'トラック1に変更して' → Call change_bgm(track=1)\n"
    "- User: '私の位置を教えて' → Call get_location()\n"
    "\n"
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
    logger.info(f"ADK API key loaded: {API_KEY[:6]}...")

# ========= SSE Tools Definition ==========
# SSE mode uses ADK native confirmation (require_confirmation=True)

SSE_TOOLS = [
    get_weather,  # Weather information retrieval (server, no approval)
    FunctionTool(
        process_payment, require_confirmation=True
    ),  # Payment processing with ADK native confirmation
    change_bgm,  # Background music control (client execution, no approval)
    FunctionTool(
        get_location, require_confirmation=True
    ),  # User location retrieval with ADK native confirmation
]

# ========= BIDI Tools Definition ==========
# BIDI mode uses BLOCKING behavior mode (Phase 12)
# Tools use types.Behavior.BLOCKING to await approval inside function without blocking event loop
#
# IMPORTANT: Cannot use FunctionTool(..., require_confirmation=True) in BIDI mode
# because Live API doesn't support automatic tool response handling.
# Use BLOCKING behavior to await approval_queue inside tool function.


# Simple wrappers for FunctionDeclaration creation (from_callable_with_api_option cannot handle ToolContext)
def process_payment_simple(
    amount: float, recipient: str, currency: str = "USD", description: str = ""
) -> dict:
    """Simple wrapper for process_payment declaration."""
    return {"status": "pending"}


def get_location_simple() -> dict:
    """Simple wrapper for get_location declaration."""
    return {"status": "pending"}


# Create FunctionDeclarations with BLOCKING behavior
process_payment_declaration = types.FunctionDeclaration.from_callable_with_api_option(
    callable=process_payment_simple,
    api_option="GEMINI_API",
    behavior=types.Behavior.BLOCKING,
)

get_location_declaration = types.FunctionDeclaration.from_callable_with_api_option(
    callable=get_location_simple,
    api_option="GEMINI_API",
    behavior=types.Behavior.BLOCKING,
)

# Create FunctionTools from actual implementations with BLOCKING declarations
PROCESS_PAYMENT_BLOCKING = FunctionTool(process_payment)
PROCESS_PAYMENT_BLOCKING._declaration = process_payment_declaration  # type: ignore[attr-defined]

GET_LOCATION_BLOCKING = FunctionTool(get_location)
GET_LOCATION_BLOCKING._declaration = get_location_declaration  # type: ignore[attr-defined]

BIDI_TOOLS = [
    get_weather,  # Weather information retrieval (server, no approval)
    # Phase 12: BLOCKING behavior for approval-required tools
    PROCESS_PAYMENT_BLOCKING,  # Payment processing with BLOCKING await for approval
    change_bgm,  # Background music control (client execution, no approval)
    GET_LOCATION_BLOCKING,  # User location retrieval with BLOCKING await for approval
]

# ========= Define Agents ==========
# https://ai.google.dev/gemini-api/docs/models

# SSE Agent: Uses stable model for generateContent API (SSE streaming)
sse_agent = Agent(
    name="adk_assistant_agent_sse",
    model="gemini-3-flash-preview",  # Gemini 3 Flash Preview for generateContent API (SSE mode)
    description=AGENT_DESCRIPTION,
    instruction=AGENT_INSTRUCTION,
    tools=SSE_TOOLS,  # type: ignore[arg-type]
    generate_content_config=types.GenerateContentConfig(
        http_options=types.HttpOptions(
            timeout=300_000,  # 5 minutes (300 seconds) - maximum allowed by Google API
        ),
    ),
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
    tools=BIDI_TOOLS,  # type: ignore[arg-type]
    generate_content_config=types.GenerateContentConfig(
        http_options=types.HttpOptions(
            timeout=300_000,  # 5 minutes (300 seconds) - maximum allowed by Google API
        ),
    ),
)

# Initialize Apps with ResumabilityConfig for tool confirmation support
# ResumabilityConfig(is_resumable=True) enables invocation_id-based pause/resume
# This is required for SSE multi-turn tool confirmation flow

sse_app = App(
    name="adk_assistant_app_sse",
    root_agent=sse_agent,
    resumability_config=ResumabilityConfig(
        is_resumable=True,
    ),
)

bidi_app = App(
    name="adk_assistant_app_bidi",
    root_agent=bidi_agent,
    resumability_config=ResumabilityConfig(
        is_resumable=True,
    ),
)

# Initialize InMemoryRunners with resumable Apps
sse_agent_runner = InMemoryRunner(app=sse_app)
bidi_agent_runner = InMemoryRunner(app=bidi_app)


# ========== Tool Confirmation Configuration ==========
# Extract tools requiring confirmation from agent definitions
# This ensures Single Source of Truth: agent tool configuration is authoritative
# SSE: Auto-detect from FunctionTool(require_confirmation=True)
SSE_CONFIRMATION_TOOLS = ["process_payment", "get_location"]
# BIDI: Manually specify since tools are plain functions (not FunctionTool wrappers)
BIDI_CONFIRMATION_TOOLS = ["process_payment", "get_location"]

logger.info(f"SSE Agent confirmation tools: {SSE_CONFIRMATION_TOOLS}")
logger.info(f"BIDI Agent confirmation tools: {BIDI_CONFIRMATION_TOOLS}")
logger.info("ADK agents and runners initialized successfully")
