"""
ADK <-> Vercel AI SDK v6 ID Mapper

This module provides a decoupled abstraction layer for ID conversion between:
- ADK's event system (uses invocation_id for event tracking)
- Vercel AI SDK v6's UI Stream Protocol (uses function_call.id for frontend interaction)

Design:
- Single source of truth for tool_name → function_call.id mappings
- Supports bidirectional lookup (forward and reverse)
- Context-aware resolution for intercepted tools (e.g., adk_request_confirmation)

Usage:
    mapper = IDMapper()

    # Register mapping when function_call arrives
    mapper.register("process_payment", "function-call-123")

    # Normal tool execution
    function_call_id = mapper.get_function_call_id("process_payment")

    # Intercepted tool execution (with original context)
    function_call_id = mapper.get_function_call_id(
        "adk_request_confirmation",
        original_context={"name": "process_payment", "id": "function-call-123"}
    )

    # Reverse lookup when frontend sends tool_result
    tool_name = mapper.resolve_tool_result("function-call-123")
"""

from typing import Any

from loguru import logger


class IDMapper:
    """
    Manages bidirectional ID mapping between ADK and Vercel AI SDK v6.

    Provides a clean separation of concerns between the two systems' ID schemes,
    enabling tools to work without direct knowledge of ID conversion logic.
    """

    def __init__(self) -> None:
        """Initialize empty ID mapping tables."""
        # Forward lookup: tool_name → function_call.id
        self._tool_name_to_id: dict[str, str] = {}

        # Reverse lookup: function_call.id → tool_name
        self._id_to_tool_name: dict[str, str] = {}

    def register(self, tool_name: str, function_call_id: str) -> None:
        """
        Register a mapping between tool_name and function_call.id.

        This should be called when StreamProtocolConverter processes a function_call
        event from ADK, making the mapping available for later tool execution.

        Args:
            tool_name: ADK tool name (e.g., "process_payment")
            function_call_id: Vercel AI SDK function_call.id (e.g., "function-call-123")

        Note:
            If tool_name is already registered, the old mapping will be overwritten
            and the reverse lookup will be updated accordingly.
        """
        # Clean up old mapping if tool_name was previously registered
        if tool_name in self._tool_name_to_id:
            old_id = self._tool_name_to_id[tool_name]
            if old_id in self._id_to_tool_name:
                del self._id_to_tool_name[old_id]

        # Register new mapping (bidirectional)
        self._tool_name_to_id[tool_name] = function_call_id
        self._id_to_tool_name[function_call_id] = tool_name

        logger.debug(f"[IDMapper] Registered: {tool_name} → {function_call_id}")

    def get_function_call_id(
        self,
        tool_name: str,
        original_context: dict[str, Any] | None = None,
    ) -> str | None:
        """
        Get function_call.id for tool execution.

        Supports both direct tool execution and intercepted tool execution.
        For intercepted tools (e.g., adk_request_confirmation), uses the
        original_context to resolve the correct function_call.id.

        Args:
            tool_name: Tool name being executed (may be intercepted tool name)
            original_context: Original function_call context for intercepted tools
                            Expected to contain {"name": str, "id": str, ...}

        Returns:
            function_call.id if mapping exists, None otherwise

        Examples:
            # Normal tool execution
            mapper.get_function_call_id("change_bgm")
            # → Returns registered function_call.id

            # Intercepted tool execution
            mapper.get_function_call_id(
                "adk_request_confirmation",
                original_context={"name": "process_payment", ...}
            )
            # → Returns function_call.id for "process_payment"
        """
        # Special case: adk_request_confirmation must use its own registered ID
        # even when original_context is provided. This ensures confirmation Future
        # uses a separate ID from the original tool Future.
        if tool_name == "adk_request_confirmation":
            logger.debug("[IDMapper] Confirmation tool lookup: using tool_name directly")
            return self._tool_name_to_id.get(tool_name)

        # For other intercepted tools: use original context
        if original_context and "name" in original_context:
            lookup_name = original_context["name"]
            logger.debug(
                f"[IDMapper] Context-aware lookup: {tool_name} → "
                f"original_name={lookup_name}"
            )
        else:
            # For normal tools: use tool_name directly
            lookup_name = tool_name

        return self._tool_name_to_id.get(lookup_name)

    def resolve_tool_result(self, function_call_id: str) -> str | None:
        """
        Reverse lookup: Get tool_name from function_call.id.

        This is used when the frontend sends a tool_result event with a
        function_call.id, and we need to find which tool it corresponds to.

        Supports confirmation-prefixed IDs (e.g., "confirmation-function-call-123").
        If a prefixed ID is provided, strips the prefix and resolves the original ID.

        Args:
            function_call_id: Vercel AI SDK function_call.id
                            (may have "confirmation-" prefix for adk_request_confirmation)

        Returns:
            tool_name if mapping exists, None otherwise
        """
        # Try direct lookup first
        tool_name = self._id_to_tool_name.get(function_call_id)
        if tool_name:
            return tool_name

        # If not found and has "confirmation-" prefix, try stripping it
        if function_call_id.startswith("confirmation-"):
            original_id = function_call_id.removeprefix("confirmation-")
            tool_name = self._id_to_tool_name.get(original_id)
            if tool_name:
                logger.debug(
                    f"[IDMapper] Resolved confirmation ID: "
                    f"{function_call_id} → {original_id} → {tool_name}"
                )
                return tool_name

        return None

    def _clear(self) -> None:
        """
        Clear all registered mappings.

        Useful for cleanup or testing purposes.
        """
        self._tool_name_to_id.clear()
        self._id_to_tool_name.clear()
        logger.debug("[IDMapper] Cleared all mappings")
