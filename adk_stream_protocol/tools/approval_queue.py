"""
Approval Queue for Deferred Approval Flow in BIDI Mode

This module provides the ApprovalQueue class which acts as a bridge between:
- WebSocket handler (receives approval messages from frontend)
- BLOCKING tools (await approval inside function)

Architecture:
┌─────────────────────┐
│ WebSocket Handler   │ → Receives approval from frontend
│                     │
│ submit_approval()   │
└──────────┬──────────┘
           │ Writes to
           ▼
    ┌──────────────┐
    │approval_queue│
    └──────────────┘
           ▲
           │ Awaits
    ┌──────┴──────┐
    │ BLOCKING    │
    │ Tool        │
    │ (awaits)    │
    └─────────────┘

Usage:
    # Setup (in session initialization)
    approval_queue = ApprovalQueue()
    session.state["approval_queue"] = approval_queue

    # In BLOCKING tool
    approval_queue.request_approval(tool_call_id, "process_payment", {...})
    result = await approval_queue.wait_for_approval(tool_call_id, timeout=30.0)

    # In WebSocket handler
    approval_queue.submit_approval(tool_call_id, approved=True)
"""

import asyncio
import time
from typing import Any

from loguru import logger


class ApprovalQueue:
    """
    Event-based approval mechanism for BIDI mode deferred approval flow.

    This class supports multiple concurrent approval requests and provides
    a non-blocking interface for tools to await approval decisions.

    Uses asyncio.Event for efficient waiting (no polling required).

    Thread-safety: This implementation uses asyncio and is safe for concurrent
    async tasks within a single event loop.
    """

    def __init__(self) -> None:
        """Initialize ApprovalQueue with empty approval tracking."""
        # Approval results (tool_call_id -> approval decision)
        self._approval_results: dict[str, dict[str, Any]] = {}
        # Active approval requests (tool_call_id -> request metadata)
        self._active_approvals: dict[str, dict[str, Any]] = {}
        # Approval events for efficient async waiting (tool_call_id -> Event)
        self._approval_events: dict[str, asyncio.Event] = {}

    def request_approval(self, tool_call_id: str, tool_name: str, args: dict[str, Any]) -> None:
        """
        Register a new approval request (non-blocking).

        This method is called by tools to register that they need approval.
        The tool will then call wait_for_approval() to await the decision.

        Args:
            tool_call_id: Unique identifier for this tool call (from ToolContext)
            tool_name: Name of the tool requesting approval
            args: Tool arguments (for logging/debugging)
        """
        request = {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "args": args,
            "timestamp": time.time(),
        }
        self._active_approvals[tool_call_id] = request
        logger.info(f"[ApprovalQueue] Request registered: {tool_call_id} ({tool_name})")

    async def wait_for_approval(self, tool_call_id: str, timeout: float = 30.0) -> dict[str, Any]:
        """
        Wait for approval decision using asyncio.Event (blocks only this task).

        This method uses asyncio.Event for efficient waiting without polling.
        The event is set by submit_approval() when the decision arrives.

        Args:
            tool_call_id: Unique identifier for this tool call
            timeout: Maximum time to wait in seconds (default: 30.0)

        Returns:
            Approval result dict: {"approved": bool}

        Raises:
            TimeoutError: If approval is not received within timeout period
        """
        logger.info(f"[ApprovalQueue] Waiting for approval: {tool_call_id}")

        # Create event for this approval request
        event = asyncio.Event()
        self._approval_events[tool_call_id] = event

        try:
            # Wait for the event to be set by submit_approval()
            await asyncio.wait_for(event.wait(), timeout=timeout)

            # Event was set, retrieve the result
            result = self._approval_results.pop(tool_call_id)
            self._active_approvals.pop(tool_call_id, None)
            logger.info(
                f"[ApprovalQueue] Approval received: {tool_call_id} "
                f"(approved={result.get('approved')})"
            )
            return result

        except TimeoutError:
            # Timeout occurred
            self._active_approvals.pop(tool_call_id, None)
            error_msg = f"Approval timeout for {tool_call_id} after {timeout}s"
            logger.error(f"[ApprovalQueue] {error_msg}")
            raise TimeoutError(error_msg) from None

        finally:
            # Always clean up the event
            self._approval_events.pop(tool_call_id, None)

    def submit_approval(self, tool_call_id: str, approved: bool) -> None:
        """
        Submit approval decision (called by WebSocket handler).

        This method is called by the external system (WebSocket handler)
        when it receives an approval/denial message from the frontend.

        Args:
            tool_call_id: Unique identifier for this tool call
            approved: True if approved, False if denied
        """
        logger.info("=" * 80)
        if approved:
            logger.info(f"[ApprovalQueue] ✅ APPROVAL submitted for: {tool_call_id}")
        else:
            logger.info(f"[ApprovalQueue] ❌ DENIAL submitted for: {tool_call_id}")
        logger.info("=" * 80)

        # Store the result
        self._approval_results[tool_call_id] = {"approved": approved}

        # Signal the waiting event (if any)
        if tool_call_id in self._approval_events:
            self._approval_events[tool_call_id].set()

    def get_pending_count(self) -> int:
        """
        Get number of pending approval requests (for debugging).

        Returns:
            Number of approval requests awaiting decision
        """
        return len(self._active_approvals)

    def get_pending_requests(self) -> dict[str, dict[str, Any]]:
        """
        Get all pending approval requests (for debugging).

        Returns:
            Dict mapping tool_call_id to request metadata
        """
        return self._active_approvals.copy()
