"""
Tool Confirmation Interceptor

This module provides ToolConfirmationInterceptor for BIDI mode tool confirmation.

Design Context:
- SSE Mode: ADK natively generates adk_request_confirmation FunctionCalls
- BIDI Mode: ADK does NOT generate these calls (SDK limitation)
- Solution: Manually intercept confirmation-required tools in BIDI mode

This interceptor is ONLY used in BIDI mode. SSE mode continues using
ADK's native confirmation mechanism for stability and maintainability.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from google.genai import types
from loguru import logger

if TYPE_CHECKING:
    from frontend_tool_delegate import FrontendToolDelegate


class ToolConfirmationInterceptor:
    """
    Intercepts confirmation-required tool calls in BIDI mode and executes
    frontend confirmation flow (blocking until user approves/denies).

    SSE Mode: Not used (ADK native confirmation works)
    BIDI Mode: Required (ADK limitation - no auto-generated confirmation calls)

    Pattern: Similar to get_location (FrontendToolDelegate execution)
    Difference: Confirmation flow + tool execution, not just tool execution
    """

    def __init__(
        self,
        delegate: FrontendToolDelegate,
        confirmation_tools: list[str],
    ):
        """
        Initialize interceptor with delegate and confirmation-required tools.

        Args:
            delegate: Frontend tool delegate for executing confirmations
            confirmation_tools: List of tool names requiring confirmation
                               (e.g., ["process_payment"])
        """
        self.delegate = delegate
        self.confirmation_tools = set(confirmation_tools)
        logger.info(f"[ToolConfirmationInterceptor] Initialized with tools: {confirmation_tools}")

    def should_intercept(self, function_call: types.FunctionCall) -> bool:
        """
        Check if this tool call should be intercepted for confirmation.

        Args:
            function_call: ADK FunctionCall object

        Returns:
            True if tool requires confirmation and should be intercepted
        """
        requires = function_call.name in self.confirmation_tools
        if requires:
            logger.info(
                f"[ToolConfirmationInterceptor] Tool {function_call.name} requires confirmation"
            )
        return requires

    async def execute_confirmation(
        self,
        tool_call_id: str,
        original_function_call: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Execute confirmation flow on frontend (blocks until user decision).

        This delegates to frontend where user sees approval UI and clicks
        Approve/Deny. The function blocks until user makes a decision.

        Args:
            tool_call_id: Unique ID for this tool call
            original_function_call: Original tool's FunctionCall data
                                  {id, name, args}

        Returns:
            Confirmation result: {"confirmed": true/false}

        Note:
            This uses the same FrontendToolDelegate pattern as get_location,
            ensuring consistency across frontend-executed operations.
        """
        logger.info(
            f"[ToolConfirmationInterceptor] Executing confirmation for "
            f"tool_call_id={tool_call_id}, tool={original_function_call.get('name')}"
        )

        result = await self.delegate.execute_on_frontend(
            tool_call_id=tool_call_id,
            tool_name="adk_request_confirmation",
            args={
                "originalFunctionCall": original_function_call,
                "toolConfirmation": {"confirmed": False},
            },
        )

        confirmed = result.get("confirmed", False)
        logger.info(f"[ToolConfirmationInterceptor] Confirmation result: confirmed={confirmed}")

        return result
