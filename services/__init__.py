"""
Services Layer

This package provides the service layer for the ADK-AI-Data-Protocol backend.
It sits between the Transport Layer (server.py) and Protocol Conversion Layer.

Components:
    - FrontendToolService: Manages frontend tool execution
"""

from services.frontend_tool_service import FrontendToolDelegate

__all__ = ["FrontendToolDelegate"]
