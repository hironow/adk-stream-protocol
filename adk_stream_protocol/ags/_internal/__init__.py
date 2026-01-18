"""
Internal module for ags package.

This module provides base utilities that work in both:
- Package mode: from adk_stream_protocol.ags._internal import ...
- Standalone mode: from _internal import ... (when ags/ is sys.path root via adk web)

Contents:
- result: Rust-style Ok/Error types for explicit error handling
- registry: Global registry for FrontendToolDelegate instances
"""

# ========== Result Types ==========
try:
    from .result import Error, Ok, Result
except ImportError:
    from result import Error, Ok, Result  # type: ignore[import-not-found, no-redef]

# ========== Frontend Tool Registry ==========
try:
    from .registry import _REGISTRY, get_delegate, register_delegate
except ImportError:
    from registry import (  # type: ignore[import-not-found, no-redef]
        _REGISTRY,
        get_delegate,
        register_delegate,
    )

__all__ = [
    "_REGISTRY",
    "Error",
    # Result types
    "Ok",
    "Result",
    # Registry functions
    "get_delegate",
    "register_delegate",
]
