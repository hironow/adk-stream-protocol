"""
Tools Layer - Tool execution coordination and approval management.

This subpackage handles:
- Frontend tool execution management (FrontendToolDelegate)
- Approval queue for deferred approval flow (ApprovalQueue)
- Tool confirmation service for BIDI mode (ConfirmationDelegate)

Components:
- FrontendToolDelegate: Makes frontend tool execution awaitable using asyncio.Future
- ApprovalQueue: Queue-based approval mechanism for BIDI mode
- ConfirmationDelegate: Tool confirmation flow using Future pattern (formerly ToolConfirmationDelegate)
"""

from .approval_queue import ApprovalQueue
from .confirmation_service import ConfirmationDelegate, ToolConfirmationDelegate
from .frontend_tool_service import FrontendToolDelegate


__all__ = [
    "ApprovalQueue",
    "ConfirmationDelegate",
    "FrontendToolDelegate",
    "ToolConfirmationDelegate",  # Deprecated alias, use ConfirmationDelegate
]
