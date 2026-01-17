"""
Tool Confirmation Service Layer

This module provides the service layer for tool confirmation flow in BIDI mode.
It uses the same Future pattern as FrontendToolDelegate but for confirmation approval.

Pattern:
    1. Tool calls request_confirmation() with tool_call_id
    2. Future is created and stored in _pending_confirmations
    3. Tool awaits the Future (blocks)
    4. Frontend approves/rejects via WebSocket
    5. WebSocket handler calls resolve_confirmation()
    6. Future is resolved, tool resumes with approval result
"""

import asyncio
from typing import Any

from loguru import logger


class ConfirmationDelegate:
    """
    Makes tool confirmation awaitable using asyncio.Future.

    Used only in BIDI mode where ADK native confirmation is not supported.
    SSE mode uses ADK's require_confirmation=True instead.
    """

    def __init__(self) -> None:
        """Initialize the delegate."""
        self._pending_confirmations: dict[str, asyncio.Future[bool]] = {}

    async def request_confirmation(
        self,
        tool_call_id: str,
        tool_name: str,
        args: dict[str, Any],
    ) -> bool:
        """
        Request confirmation from frontend and await approval.

        Args:
            tool_call_id: The function_call.id from ADK
            tool_name: Name of the tool requiring confirmation
            args: Tool arguments to display to user

        Returns:
            True if approved, False if rejected

        Raises:
            TimeoutError: If frontend doesn't respond within timeout
        """
        # Register Future with tool_call_id
        future: asyncio.Future[bool] = asyncio.Future()
        self._pending_confirmations[tool_call_id] = future
        logger.info(
            f"[ToolConfirmation] Awaiting approval for tool={tool_name}, "
            f"tool_call_id={tool_call_id}, args={args}"
        )

        # Await frontend confirmation with timeout
        # Timeout set to 60 seconds (user needs time to approve)
        try:  # nosemgrep: forbid-try-except - legitimate timeout and error handling for asyncio.wait_for
            approved = await asyncio.wait_for(future, timeout=60.0)
            logger.info(
                f"[ToolConfirmation] Received approval for tool={tool_name} "
                f"(tool_call_id={tool_call_id}): approved={approved}"
            )
            return approved
        except TimeoutError:
            logger.error(
                f"[ToolConfirmation] Timeout waiting for confirmation: "
                f"tool={tool_name}, tool_call_id={tool_call_id}"
            )
            # Clean up pending confirmation
            self._pending_confirmations.pop(tool_call_id, None)
            # Treat timeout as rejection
            return False
        except RuntimeError as e:
            logger.error(
                f"[ToolConfirmation] Confirmation failed: "
                f"tool={tool_name}, tool_call_id={tool_call_id}, error={e}"
            )
            # Clean up pending confirmation
            self._pending_confirmations.pop(tool_call_id, None)
            return False

    def resolve_confirmation(self, tool_call_id: str, approved: bool) -> None:
        """
        Resolve a pending confirmation with approval result.

        Called by WebSocket handler when frontend sends approval/rejection.

        Args:
            tool_call_id: The function_call.id (original tool, not confirmation tool)
            approved: True if approved, False if rejected
        """
        if tool_call_id in self._pending_confirmations:
            logger.info(
                f"[ToolConfirmation] Resolving tool_call_id={tool_call_id} with approved={approved}"
            )
            self._pending_confirmations[tool_call_id].set_result(approved)
            del self._pending_confirmations[tool_call_id]
        else:
            logger.warning(
                f"[ToolConfirmation] No pending confirmation found for tool_call_id={tool_call_id}. "
                f"Pending: {list(self._pending_confirmations.keys())}"
            )
