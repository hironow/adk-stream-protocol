"""
Test utilities for Result type assertions.

Provides helper functions for asserting Ok/Error variants in tests,
following the pattern recommended in docs/RESULT_TYPE_PATTERN.md.
"""

import pytest

from adk_stream_protocol import Error, Ok, Result


def assert_ok[T, E](result: Result[T, E]) -> T:
    """
    Assert that Result is Ok and return the value.

    Args:
        result: Result to check

    Returns:
        The Ok value

    Raises:
        AssertionError: If result is Error
    """
    match result:
        case Ok(value):
            return value
        case Error(msg):
            pytest.fail(f"Expected Ok, got Error: {msg}")
            raise AssertionError("unreachable")  # for type checker


def assert_error[T, E](result: Result[T, E]) -> E:
    """
    Assert that Result is Error and return the error message.

    Args:
        result: Result to check

    Returns:
        The Error value

    Raises:
        AssertionError: If result is Ok
    """
    match result:
        case Ok(value):
            pytest.fail(f"Expected Error, got Ok: {value}")
            raise AssertionError("unreachable")  # for type checker
        case Error(msg):
            return msg
