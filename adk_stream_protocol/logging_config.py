"""
Logging Configuration Module

Provides centralized logging configuration via LOG_LEVEL environment variable.

Usage:
    from adk_stream_protocol.logging_config import configure_logging
    configure_logging()  # Call once at startup

Environment Variables:
    LOG_LEVEL: Controls console log verbosity (default: INFO)
        - DEBUG: All logs (development, verbose)
        - INFO: Normal logs (default)
        - WARNING: Warnings and errors only
        - ERROR: Errors only (quiet mode for production)

Note:
    - Console (stderr) respects LOG_LEVEL
    - File logs always use DEBUG level for full diagnostics
"""

import os
import sys

from loguru import logger


# Valid log levels (loguru-compatible)
VALID_LOG_LEVELS: set[str] = {"DEBUG", "INFO", "WARNING", "ERROR"}

# Default log level when not specified
DEFAULT_LOG_LEVEL = "INFO"


def get_log_level() -> str:
    """
    Get the configured log level from environment variable.

    Returns:
        str: Log level (DEBUG, INFO, WARNING, or ERROR).
             Falls back to INFO if invalid or not set.
    """
    level = os.getenv("LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()

    if level not in VALID_LOG_LEVELS:
        # Invalid level - fall back to default
        return DEFAULT_LOG_LEVEL

    return level


def configure_logging() -> None:
    """
    Configure loguru with LOG_LEVEL from environment variable.

    This function should be called once at application startup.
    It configures:
    - Console (stderr) output with LOG_LEVEL control
    - Compact format for console output

    File logging should be configured separately in server
    to maintain full DEBUG level logs for diagnostics.
    """
    level = get_log_level()

    # Remove default stderr handler
    logger.remove()

    # Add new stderr handler with configured level
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - {message}",
        colorize=True,
    )

    logger.debug(f"Logging configured: console level={level}")
