"""
Logging Configuration Tests

TDD tests for LOG_LEVEL environment variable control.
Allows suppressing log output via environment variable.

Usage:
- LOG_LEVEL=DEBUG: All logs (development)
- LOG_LEVEL=INFO: Normal logs (default)
- LOG_LEVEL=WARNING: Warnings and errors only
- LOG_LEVEL=ERROR: Errors only (quiet mode for production)
"""

import importlib
import os
from unittest.mock import patch


def _reload_and_get_level() -> str:
    """Helper to reload logging_config module and get current level."""
    import adk_stream_protocol.logging_config as lc

    importlib.reload(lc)
    return lc.get_log_level()


class TestLogLevelConfiguration:
    """Tests for LOG_LEVEL environment variable configuration."""

    def test_log_level_default_is_info(self) -> None:
        """Default LOG_LEVEL should be INFO when not set."""
        # given
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LOG_LEVEL", None)

            # when
            level = _reload_and_get_level()

        # then
        assert level == "INFO"

    def test_log_level_can_be_set_to_debug(self) -> None:
        """LOG_LEVEL=DEBUG should be accepted."""
        # given / when
        with patch.dict(os.environ, {"LOG_LEVEL": "DEBUG"}):
            level = _reload_and_get_level()

        # then
        assert level == "DEBUG"

    def test_log_level_can_be_set_to_warning(self) -> None:
        """LOG_LEVEL=WARNING should be accepted."""
        # given / when
        with patch.dict(os.environ, {"LOG_LEVEL": "WARNING"}):
            level = _reload_and_get_level()

        # then
        assert level == "WARNING"

    def test_log_level_can_be_set_to_error(self) -> None:
        """LOG_LEVEL=ERROR should be accepted (quiet mode)."""
        # given / when
        with patch.dict(os.environ, {"LOG_LEVEL": "ERROR"}):
            level = _reload_and_get_level()

        # then
        assert level == "ERROR"

    def test_invalid_log_level_falls_back_to_info(self) -> None:
        """Invalid LOG_LEVEL values should fall back to INFO."""
        # given / when
        with patch.dict(os.environ, {"LOG_LEVEL": "INVALID"}):
            level = _reload_and_get_level()

        # then
        assert level == "INFO"

    def test_log_level_is_case_insensitive(self) -> None:
        """LOG_LEVEL should be case-insensitive."""
        # given / when
        with patch.dict(os.environ, {"LOG_LEVEL": "error"}):
            level = _reload_and_get_level()

        # then
        assert level == "ERROR"


class TestValidLogLevels:
    """Tests for valid log level enumeration."""

    def test_valid_log_levels_contains_debug(self) -> None:
        """VALID_LOG_LEVELS should contain DEBUG."""
        # when
        from adk_stream_protocol.logging_config import VALID_LOG_LEVELS

        # then
        assert "DEBUG" in VALID_LOG_LEVELS

    def test_valid_log_levels_contains_info(self) -> None:
        """VALID_LOG_LEVELS should contain INFO."""
        # when
        from adk_stream_protocol.logging_config import VALID_LOG_LEVELS

        # then
        assert "INFO" in VALID_LOG_LEVELS

    def test_valid_log_levels_contains_warning(self) -> None:
        """VALID_LOG_LEVELS should contain WARNING."""
        # when
        from adk_stream_protocol.logging_config import VALID_LOG_LEVELS

        # then
        assert "WARNING" in VALID_LOG_LEVELS

    def test_valid_log_levels_contains_error(self) -> None:
        """VALID_LOG_LEVELS should contain ERROR."""
        # when
        from adk_stream_protocol.logging_config import VALID_LOG_LEVELS

        # then
        assert "ERROR" in VALID_LOG_LEVELS
