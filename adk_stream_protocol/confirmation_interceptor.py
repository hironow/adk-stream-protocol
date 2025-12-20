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

from typing import Any, assert_never

from google.genai import types
from loguru import logger

from .frontend_tool_service import FrontendToolDelegate
from .result import Error, Ok, Result


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
        self._delegate = delegate
        self._confirmation_tools = set(confirmation_tools)
        logger.info(f"[ToolConfirmationInterceptor] Initialized with tools: {confirmation_tools}")

    def _should_intercept(self, function_call: types.FunctionCall) -> bool:
        """
        Check if this tool call should be intercepted for confirmation.

        Args:
            function_call: ADK FunctionCall object

        Returns:
            True if tool requires confirmation and should be intercepted
        """
        requires = function_call.name in self._confirmation_tools
        if requires:
            logger.info(
                f"[ToolConfirmationInterceptor] Tool {function_call.name} requires confirmation"
            )
        return requires

    async def execute_confirmation(
        self,
        tool_call_id: str,
        original_function_call: dict[str, Any],
    ) -> Result[dict[str, Any], str]:
        """
        Execute confirmation flow on frontend (blocks until user decision).

        This delegates to frontend where user sees approval UI and clicks
        Approve/Deny. The function blocks until user makes a decision.

        Args:
            tool_call_id: Unique ID for this tool call
            original_function_call: Original tool's FunctionCall data
                                  {id, name, args}

        Returns:
            Ok(confirmation_result) if execution succeeds, Error(str) if execution fails
            Confirmation result: {"confirmed": true/false}

        Note:
            This uses the same FrontendToolDelegate pattern as get_location,
            ensuring consistency across frontend-executed operations.
        """
        logger.info(
            f"[ToolConfirmationInterceptor] Executing confirmation for "
            f"tool_call_id={tool_call_id}, tool={original_function_call.get('name')}"
        )

        result_or_error = await self._delegate.execute_on_frontend(
            tool_name="adk_request_confirmation",
            args={
                "originalFunctionCall": original_function_call,
                "toolConfirmation": {"confirmed": False},
            },
            original_context=original_function_call,
        )
        match result_or_error:
            case Ok(result):
                confirmed = result.get("confirmed", False)
                logger.info(
                    f"[ToolConfirmationInterceptor] Confirmation result: confirmed={confirmed}"
                )
                return Ok(result)
            case Error(error_msg):
                logger.error(f"[ToolConfirmationInterceptor] Confirmation failed: {error_msg}")
                return Error(error_msg)
            case _:
                assert_never(result_or_error)
