"""
Tools Layer - Tool execution coordination and approval management.

This subpackage handles:
- Frontend tool execution management (FrontendToolDelegate)
- Approval queue for deferred approval flow (ApprovalQueue)
- Tool confirmation service for BIDI mode (ToolConfirmationDelegate)

Components:
- FrontendToolDelegate: Makes frontend tool execution awaitable using asyncio.Future
- ApprovalQueue: Queue-based approval mechanism for BIDI mode
- ToolConfirmationDelegate: Tool confirmation flow using Future pattern
"""

from .approval_queue import ApprovalQueue
from .frontend_tool_service import FrontendToolDelegate
from .tool_confirmation_service import ToolConfirmationDelegate


__all__ = [
    "ApprovalQueue",
    "FrontendToolDelegate",
    "ToolConfirmationDelegate",
]
