"""
Test utilities for Result type assertions.

Provides helper functions for asserting Ok/Error variants in tests,
following the pattern recommended in result/README.md.
"""

from __future__ import annotations

from typing import TypeVar

import pytest

from result.result import Error, Ok, Result

_T = TypeVar("_T")
_E = TypeVar("_E")


def assert_ok(result: Result[_T, _E]) -> _T:
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


def assert_error(result: Result[_T, _E]) -> _E:
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
