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
    Protocol Conversion (stream_protocol.py, IDMapper)
        ↓
    ADK Layer

Components:
    - FrontendToolDelegate: Manages frontend tool execution using asyncio.Future pattern
"""

import asyncio
from typing import Any

from loguru import logger

from adk_stream_protocol.ags import Error, Ok, Result
from adk_stream_protocol.protocol.id_mapper import IDMapper


class FrontendToolDelegate:
    """
    Makes frontend tool execution awaitable using asyncio.Future.

    BIDI Mode (WebSocket) Pattern:
        1. Tool calls execute_on_frontend() with tool_call_id
        2. Future is created and stored in _pending_calls
        3. Tool awaits the Future (blocks)
        4. Frontend executes tool and sends result via WebSocket
        5. WebSocket handler calls resolve_tool_result()
        6. Future is resolved, tool resumes and returns result

    SSE Mode Pattern A (1-request):
        1. to_adk_content() processes message with tool-result → calls resolve_tool_result()
        2. No Future exists yet → result stored in _pre_resolved_results cache
        3. ADK calls tool → execute_on_frontend() checks cache
        4. Cache hit → returns result immediately without creating Future
        5. No await, no timeout

    Note: SSE mode only supports Pattern A (approval + result in same request).
    See ADR-0008 for rationale.
    """

    def __init__(self, id_mapper: IDMapper | None = None) -> None:
        """
        Initialize the delegate.

        Args:
            id_mapper: Optional ID mapper (creates new instance if not provided)
        """
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}
        # SSE Mode Pattern A: Cache for results that arrive before Future creation
        # In Pattern A, tool-result arrives during message processing (to_adk_content)
        # but Future is created later when ADK calls the tool (execute_on_frontend)
        self._pre_resolved_results: dict[str, dict[str, Any]] = {}
        self._id_mapper = id_mapper or IDMapper()

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
        else:
            # failed to resolve ID
            return Error(f"Function call ID not found for tool: {tool_name}")

        # SSE Mode Pattern A: Check if result was pre-resolved (arrived before Future creation)
        # In Pattern A, result arrives during message processing (to_adk_content)
        # BEFORE ADK calls this function. Cache hit means we can return immediately.
        if function_call_id in self._pre_resolved_results:
            result = self._pre_resolved_results.pop(function_call_id)
            logger.info(
                f"[FrontendDelegate] Using pre-resolved result for tool={tool_name}, "
                f"function_call.id={function_call_id}: {result}"
            )
            return Ok(result)

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

        try:
            result = await asyncio.wait_for(future, timeout=10.0)
            logger.info(
                f"[FrontendDelegate] Received result for tool={tool_name} "
                f"(function_call.id={function_call_id}): {result}"
            )
            return Ok(result)
        except TimeoutError:
            logger.error(
                f"[FrontendDelegate] Timeout waiting for tool result: "
                f"tool={tool_name}, function_call.id={function_call_id}"
            )
            # Clean up pending call
            self._pending_calls.pop(function_call_id, None)
            return Error(
                f"Timeout waiting for frontend tool result (tool={tool_name}, id={function_call_id})"
            )
        except RuntimeError as e:
            logger.error(
                f"[FrontendDelegate] Tool execution failed: "
                f"tool={tool_name}, function_call.id={function_call_id}, error={e}"
            )
            # Clean up pending call
            self._pending_calls.pop(function_call_id, None)
            return Error(f"RuntimeError: {e}")

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

        # SSE Mode Pattern A: Result arrived before Future was created
        # In Pattern A, message processing (to_adk_content) happens BEFORE ADK calls the tool
        # Store result in cache for later use when execute_on_frontend() is called
        # This prevents timeout waiting for a result that has already arrived
        logger.info(
            f"[FrontendDelegate] Pre-resolving result for SSE mode (id={tool_call_id}). "
            f"Result will be used when tool executes."
        )
        self._pre_resolved_results[tool_call_id] = result

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
