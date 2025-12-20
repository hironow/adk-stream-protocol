"""
Frontend Tool Service Layer

This module provides the service layer for frontend tool execution management.
It decouples tool execution logic from transport layer (WebSocket/SSE handlers).

Layer Position:
    Frontend (Browser)
        ↕ WebSocket/SSE Protocol
    Transport Layer (server.py - routing only)
        ↓ delegates to
    **Services Layer (this module)**
        ↓ uses
    Protocol Conversion (stream_protocol.py, ADKVercelIDMapper)
        ↓
    ADK Layer

Components:
    - FrontendToolDelegate: Manages frontend tool execution using asyncio.Future pattern
"""

import asyncio
from typing import Any

from loguru import logger

from adk_vercel_id_mapper import ADKVercelIDMapper
from result.result import Error, Ok, Result


class FrontendToolDelegate:
    """
    Makes frontend tool execution awaitable using asyncio.Future.

    Pattern:
        1. Tool calls execute_on_frontend() with tool_call_id
        2. Future is created and stored in _pending_calls
        3. Tool awaits the Future (blocks)
        4. Frontend executes tool and sends result via WebSocket
        5. WebSocket handler calls resolve_tool_result()
        6. Future is resolved, tool resumes and returns result
    """

    def __init__(self, id_mapper: ADKVercelIDMapper | None = None) -> None:
        """
        Initialize the delegate.

        Args:
            id_mapper: Optional ID mapper (creates new instance if not provided)
        """
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._id_mapper = id_mapper or ADKVercelIDMapper()

    def set_function_call_id(self, tool_name: str, function_call_id: str) -> Result[None, str]:
        """
        Set the function_call.id for a tool_name.

        Args:
            tool_name: Name of the tool
            function_call_id: The ADK function_call.id

        Returns:
            Ok(None) on success, Error(str) on failure
        """
        self._id_mapper.register(tool_name, function_call_id)
        return Ok(None)

    async def execute_on_frontend(
        self,
        tool_name: str,
        args: dict[str, Any],
        original_context: dict[str, Any] | None = None,
    ) -> Result[dict[str, Any], str]:
        """
        Delegate tool execution to frontend and await result.

        Args:
            tool_name: Name of the tool to execute (may be intercepted tool name)
            args: Tool arguments
            original_context: Original function_call context (for intercepted tools)

        Returns:
            Ok(result dict) if execution succeeds, Error(str) if execution fails
        """
        # Resolve function_call.id using ID mapper
        # If not found, use fallback for testing
        resolved_id = self._id_mapper.get_function_call_id(tool_name, original_context)

        if resolved_id:
            function_call_id = resolved_id

        # failed to resolve ID
        return Error(f"Function call ID not found for tool: {tool_name}")

        # Register Future with function_call.id
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[function_call_id] = future
        logger.info(
            f"[FrontendDelegate] Awaiting result for tool={tool_name}, "
            f"function_call.id={function_call_id}, args={args}"
        )

        # Await frontend result with timeout to detect deadlocks early
        # Timeout set to 5 seconds (much shorter than 30s test timeout)
        # This helps identify issues where:
        # - Frontend never receives tool-input-available (not yielded)
        # - WebSocket handler doesn't call resolve_tool_result()
        # - Circular dependency causes deadlock
        # Reason: Timeout and exception handling - converting to Result type for API contract

        result = await asyncio.wait_for(future, timeout=10.0)
        logger.info(
            f"[FrontendDelegate] Received result for tool={tool_name} "
            f"(function_call.id={function_call_id}): {result}"
        )
        return Ok(result)

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        """
        Resolve a pending tool call with its result.

        Called by WebSocket handler when frontend sends tool_result event.
        Handles both direct IDs and confirmation-prefixed IDs.

        Args:
            tool_call_id: The function_call.id from frontend (may have "confirmation-" prefix)
            result: Result dict from frontend execution
        """
        # Try direct lookup first
        if tool_call_id in self._pending_calls:
            logger.info(
                f"[FrontendDelegate] Resolving function_call.id={tool_call_id} "
                f"with result: {result}"
            )
            self._pending_calls[tool_call_id].set_result(result)
            del self._pending_calls[tool_call_id]
            return

        # If not found and has confirmation- prefix, try stripping it
        # For confirmation tools, frontend sends "confirmation-{original_id}"
        # but _pending_calls uses the original ID as key
        if tool_call_id.startswith("confirmation-"):
            original_id = tool_call_id.removeprefix("confirmation-")
            if original_id in self._pending_calls:
                # Use ID mapper to get tool_name for logging
                tool_name = self._id_mapper.resolve_tool_result(tool_call_id)
                logger.info(
                    f"[FrontendDelegate] Resolved confirmation ID: {tool_call_id} → {original_id}, "
                    f"tool={tool_name}, result={result}"
                )
                self._pending_calls[original_id].set_result(result)
                del self._pending_calls[original_id]
                return

        logger.error("[BIDI] ========== IMPLEMENTATION GAP DETECTED ==========")
        logger.warning(
            f"[FrontendDelegate] No pending call found for function_call.id={tool_call_id}. "
            f"Pending: {list(self._pending_calls.keys())}"
        )

    def _reject_tool_call(self, tool_call_id: str, error_message: str) -> None:
        """
        Reject a pending tool call with an error.

        Args:
            tool_call_id: The tool call ID to reject
            error_message: Error message
        """
        if tool_call_id in self._pending_calls:
            logger.error(
                f"[FrontendDelegate] Rejecting tool_call_id={tool_call_id} "
                f"with error: {error_message}"
            )
            self._pending_calls[tool_call_id].set_exception(RuntimeError(error_message))
            del self._pending_calls[tool_call_id]
        else:
            logger.warning(
                f"[FrontendDelegate] No pending call found for tool_call_id={tool_call_id}"
            )
