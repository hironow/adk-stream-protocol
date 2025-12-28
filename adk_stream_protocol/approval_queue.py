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
    Queue-based approval mechanism for BIDI mode deferred approval flow.

    This class supports multiple concurrent approval requests and provides
    a non-blocking interface for tools to await approval decisions.

    Thread-safety: This implementation uses asyncio and is safe for concurrent
    async tasks within a single event loop.
    """

    def __init__(self) -> None:
        """Initialize ApprovalQueue with empty approval tracking."""
        # Approval results (tool_call_id -> approval decision)
        self._approval_results: dict[str, dict[str, Any]] = {}
        # Active approval requests (tool_call_id -> request metadata)
        self._active_approvals: dict[str, dict[str, Any]] = {}

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
        Wait for approval decision (blocks only this task).

        This method uses polling to check for approval results. The polling
        interval is 100ms, which provides responsive approval handling while
        not consuming excessive CPU.

        Args:
            tool_call_id: Unique identifier for this tool call
            timeout: Maximum time to wait in seconds (default: 30.0)

        Returns:
            Approval result dict: {"approved": bool}

        Raises:
            TimeoutError: If approval is not received within timeout period
        """
        logger.info(f"[ApprovalQueue] Waiting for approval: {tool_call_id}")
        start_time = time.time()

        while time.time() - start_time < timeout:
            if tool_call_id in self._approval_results:
                result = self._approval_results.pop(tool_call_id)
                self._active_approvals.pop(tool_call_id, None)
                logger.info(
                    f"[ApprovalQueue] Approval received: {tool_call_id} "
                    f"(approved={result.get('approved')})"
                )
                return result

            # Polling interval: 100ms provides responsive approval handling
            await asyncio.sleep(0.1)

        # Timeout occurred
        self._active_approvals.pop(tool_call_id, None)
        error_msg = f"Approval timeout for {tool_call_id} after {timeout}s"
        logger.error(f"[ApprovalQueue] {error_msg}")
        raise TimeoutError(error_msg)

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

        self._approval_results[tool_call_id] = {"approved": approved}

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
