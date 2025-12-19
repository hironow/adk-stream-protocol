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

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

from adk_vercel_id_mapper import ADKVercelIDMapper


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
        self.id_mapper = id_mapper or ADKVercelIDMapper()

    def set_function_call_id(self, tool_name: str, function_call_id: str) -> None:
        """
        Set the function_call.id for a tool_name.

        This is called by StreamProtocolConverter when processing function_call events.

        Args:
            tool_name: Name of the tool
            function_call_id: The ADK function_call.id
        """
        self.id_mapper.register(tool_name, function_call_id)

    async def execute_on_frontend(
        self,
        tool_name: str,
        args: dict[str, Any],
        tool_call_id: str | None = None,  # Deprecated: use ID mapper instead
        original_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Delegate tool execution to frontend and await result.

        Args:
            tool_name: Name of the tool to execute (may be intercepted tool name)
            args: Tool arguments
            tool_call_id: (Deprecated) Tool call ID - now handled by ID mapper
            original_context: Original function_call context (for intercepted tools)

        Returns:
            Result dict from frontend execution

        Raises:
            RuntimeError: If function_call.id not found for tool
        """
        # Resolve function_call.id using multiple strategies:
        # 1. Use tool_call_id if explicitly provided (backward compatibility)
        # 2. Use ID mapper with original_context (for intercepted tools)
        # 3. Use ID mapper without context (for normal tools)
        function_call_id: str
        if tool_call_id:
            # Legacy path: tool_call_id explicitly provided
            function_call_id = tool_call_id
        else:
            # New path: use ID mapper
            resolved_id = self.id_mapper.get_function_call_id(tool_name, original_context)
            if not resolved_id:
                raise RuntimeError(
                    f"No function_call.id found for tool={tool_name}. "
                    f"Original context: {original_context}"
                )
            function_call_id = resolved_id

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
        try:
            result = await asyncio.wait_for(future, timeout=5.0)
        except TimeoutError:
            logger.error(
                "[FrontendDelegate] ========== TIMEOUT DETECTED =========="
            )
            logger.error(
                f"[FrontendDelegate] Tool: {tool_name}, function_call.id={function_call_id}"
            )
            logger.error(
                "[FrontendDelegate] Frontend never sent result after 5 seconds."
            )
            logger.error(
                "[FrontendDelegate] Possible causes:"
            )
            logger.error(
                "[FrontendDelegate]   1. tool-input-available never yielded to frontend"
            )
            logger.error(
                "[FrontendDelegate]   2. WebSocket handler not calling resolve_tool_result()"
            )
            logger.error(
                "[FrontendDelegate]   3. Deadlock: tool awaits delegate while in delegate flow"
            )
            logger.error(
                f"[FrontendDelegate] Pending calls: {list(self._pending_calls.keys())}"
            )

            # Clean up the pending future
            if function_call_id in self._pending_calls:
                del self._pending_calls[function_call_id]

            # Raise clear error
            raise TimeoutError(
                f"Frontend tool execution timeout for {tool_name} ({function_call_id}). "
                f"Frontend never responded after 5 seconds. "
                f"Check if tool-input-available was yielded to frontend."
            ) from None

        logger.info(
            f"[FrontendDelegate] Received result for tool={tool_name} "
            f"(function_call.id={function_call_id}): {result}"
        )

        return result

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
                tool_name = self.id_mapper.resolve_tool_result(tool_call_id)
                logger.info(
                    f"[FrontendDelegate] Resolved confirmation ID: {tool_call_id} → {original_id}, "
                    f"tool={tool_name}, result={result}"
                )
                self._pending_calls[original_id].set_result(result)
                del self._pending_calls[original_id]
                return

        # No match found
        logger.warning(
            f"[FrontendDelegate] No pending call found for function_call.id={tool_call_id}. "
            f"Pending: {list(self._pending_calls.keys())}"
        )

    def reject_tool_call(self, tool_call_id: str, error_message: str) -> None:
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
