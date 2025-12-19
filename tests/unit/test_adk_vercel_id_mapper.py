"""
Unit tests for ADKVercelIDMapper class.

Tests the ID mapping layer between ADK (invocation_id) and Vercel AI SDK v6 (function_call.id):
- register(): Register tool_name → function_call.id mapping
- get_function_call_id(): Resolve function_call.id from tool_name
- get_function_call_id() with original_context: Resolve for intercepted tools
- resolve_tool_result(): Reverse lookup function_call.id → tool_name
- clear(): Clear all mappings

This mapper provides a decoupled abstraction layer for ID conversion between
ADK's event system and Vercel AI SDK's UI stream protocol.
"""

from __future__ import annotations

import pytest

from adk_vercel_id_mapper import ADKVercelIDMapper


# ============================================================
# ADKVercelIDMapper Tests
# ============================================================


def test_register_and_get_function_call_id() -> None:
    """register() should store mapping and get_function_call_id() should retrieve it."""
    # given
    mapper = ADKVercelIDMapper()

    # when
    mapper.register("change_bgm", "function-call-123")

    # then
    assert mapper.get_function_call_id("change_bgm") == "function-call-123"


def test_get_function_call_id_returns_none_for_unknown_tool() -> None:
    """get_function_call_id() should return None for unknown tool_name."""
    # given
    mapper = ADKVercelIDMapper()

    # when
    result = mapper.get_function_call_id("unknown_tool")

    # then
    assert result is None


def test_get_function_call_id_with_original_context() -> None:
    """get_function_call_id() should use original_context['name'] for intercepted tools."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("process_payment", "function-call-456")

    # when - Interceptor calls with adk_request_confirmation but provides original context
    original_context = {
        "name": "process_payment",
        "id": "function-call-456",
        "args": {"amount": 100},
    }
    result = mapper.get_function_call_id("adk_request_confirmation", original_context)

    # then - Should resolve using original_context["name"]
    assert result == "function-call-456"


def test_get_function_call_id_without_original_context() -> None:
    """get_function_call_id() should fall back to tool_name when no original_context."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("get_location", "function-call-789")

    # when - No original_context provided
    result = mapper.get_function_call_id("get_location", None)

    # then - Should use tool_name directly
    assert result == "function-call-789"


def test_resolve_tool_result_reverse_lookup() -> None:
    """resolve_tool_result() should find tool_name from function_call.id."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("change_bgm", "function-call-123")
    mapper.register("get_weather", "function-call-456")

    # when
    tool_name = mapper.resolve_tool_result("function-call-456")

    # then
    assert tool_name == "get_weather"


def test_resolve_tool_result_returns_none_for_unknown_id() -> None:
    """resolve_tool_result() should return None for unknown function_call.id."""
    # given
    mapper = ADKVercelIDMapper()

    # when
    tool_name = mapper.resolve_tool_result("unknown-id")

    # then
    assert tool_name is None


def test_clear_removes_all_mappings() -> None:
    """clear() should remove all registered mappings."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("change_bgm", "function-call-123")
    mapper.register("get_location", "function-call-456")

    # when
    mapper.clear()

    # then
    assert mapper.get_function_call_id("change_bgm") is None
    assert mapper.get_function_call_id("get_location") is None
    assert mapper.resolve_tool_result("function-call-123") is None


def test_multiple_registrations_same_tool_overwrites() -> None:
    """Registering same tool_name multiple times should overwrite previous mapping."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("change_bgm", "function-call-old")

    # when
    mapper.register("change_bgm", "function-call-new")

    # then
    assert mapper.get_function_call_id("change_bgm") == "function-call-new"
    assert mapper.resolve_tool_result("function-call-old") is None
    assert mapper.resolve_tool_result("function-call-new") == "change_bgm"


def test_original_context_without_name_falls_back_to_tool_name() -> None:
    """get_function_call_id() should fall back to tool_name if original_context lacks 'name'."""
    # given
    mapper = ADKVercelIDMapper()
    mapper.register("change_bgm", "function-call-123")

    # when - original_context present but no 'name' key
    original_context = {"id": "some-id", "args": {}}
    result = mapper.get_function_call_id("change_bgm", original_context)

    # then - Should fall back to tool_name
    assert result == "function-call-123"
