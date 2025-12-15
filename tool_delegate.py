"""
Frontend Tool Delegation - Makes browser tool execution awaitable.

This module implements the delegation pattern where backend tools can
delegate execution to the frontend (browser) and await results, similar
to how ADK Agent Protocol (AP2) tools delegate to remote agents.

Pattern:
    1. Backend tool calls execute_on_frontend()
    2. Future is created and stored in pending_calls
    3. Tool awaits the Future (blocks)
    4. Frontend executes tool and sends result via WebSocket
    5. WebSocket handler calls resolve_tool_result() or reject_tool_call()
    6. Future is resolved, tool resumes with result or error
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger


class FrontendToolDelegate:
    """
    Makes frontend tool execution awaitable using asyncio.Future.

    This enables AP2-style delegation where tools await results from
    the frontend (browser), similar to how AP2 tools await results
    from remote agents via A2A protocol.

    Pattern:
        1. Tool calls execute_on_frontend() with tool_call_id
        2. Future is created and stored in _pending_calls
        3. Tool awaits the Future (blocks)
        4. Frontend executes tool and sends result via WebSocket
        5. WebSocket handler calls resolve_tool_result()
        6. Future is resolved, tool resumes and returns result
    """

    def __init__(self) -> None:
        """Initialize the delegate with empty pending calls dict."""
        self._pending_calls: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def execute_on_frontend(
        self, tool_call_id: str, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Delegate tool execution to frontend and await result.

        This method makes frontend delegation awaitable, similar to
        AP2's `await send_a2a_message()` pattern.

        Args:
            tool_call_id: ADK's function_call.id (from ToolContext)
            tool_name: Name of the tool to execute
            args: Tool arguments

        Returns:
            Result dict from frontend execution

        Flow:
            1. Create Future for this tool_call_id
            2. stream_protocol will send function_call event
            3. Frontend receives event and executes tool
            4. Frontend sends tool_result via WebSocket
            5. WebSocket handler calls resolve_tool_result()
            6. Future is resolved, this method returns result
        """
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_calls[tool_call_id] = future

        logger.info(
            f"[FrontendDelegate] Awaiting result for tool_call_id={tool_call_id}, "
            f"tool={tool_name}, args={args}"
        )

        # Await frontend result (blocks here until result arrives)
        result = await future

        logger.info(f"[FrontendDelegate] Received result for tool_call_id={tool_call_id}: {result}")

        return result

    def resolve_tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        """
        Resolve a pending tool call with its result.

        Called by WebSocket handler when frontend sends tool_result event.

        Args:
            tool_call_id: The tool call ID to resolve
            result: Result dict from frontend execution
        """
        if tool_call_id in self._pending_calls:
            logger.info(
                f"[FrontendDelegate] Resolving tool_call_id={tool_call_id} with result: {result}"
            )
            self._pending_calls[tool_call_id].set_result(result)
            del self._pending_calls[tool_call_id]
        else:
            logger.warning(
                f"[FrontendDelegate] Received result for unknown tool_call_id={tool_call_id}"
            )

    def reject_tool_call(self, tool_call_id: str, reason: str) -> None:
        """
        Reject a pending tool call (user denied permission).

        Called by WebSocket handler when frontend sends tool_result with approved=false.

        Args:
            tool_call_id: The tool call ID to reject
            reason: Reason for rejection (e.g., "User denied permission")
        """
        if tool_call_id in self._pending_calls:
            logger.info(
                f"[FrontendDelegate] Rejecting tool_call_id={tool_call_id}, reason: {reason}"
            )
            # Resolve with rejection error dict
            rejection_result = {
                "success": False,
                "error": reason,
                "denied": True,
            }
            self._pending_calls[tool_call_id].set_result(rejection_result)
            del self._pending_calls[tool_call_id]
        else:
            logger.warning(
                f"[FrontendDelegate] Received rejection for unknown tool_call_id={tool_call_id}"
            )


# ========== Global Frontend Delegate Instance ==========
# Singleton instance used by tools that delegate to frontend
# This enables AP2-style awaitable delegation for browser-based tool execution
#
# IMPORTANT: This global instance is shared across all SSE mode connections!
# In SSE mode (/chat and /stream endpoints), this delegate is used as a fallback
# when tool_context.state["temp:delegate"] is not set, which means:
#   - Multiple users' tool calls will share the same _pending_calls dictionary
#   - tool_call_id collisions can occur between different users
#   - One user might receive another user's tool results
#
# BIDI mode (/live endpoint) is safe because it creates a new FrontendToolDelegate
# instance per WebSocket connection and stores it in tool_context.state["temp:delegate"].
#
# TODO: Consider creating per-session or per-connection delegate instances for SSE mode
# to avoid cross-user interference.
frontend_delegate = FrontendToolDelegate()
