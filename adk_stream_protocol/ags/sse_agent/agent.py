"""
SSE Agent for adk web command.

This module exposes the SSE agent for debugging via `adk web`.
Run: adk web adk_stream_protocol/ags --port 3002

When ADK CLI runs `adk web adk_stream_protocol/ags`:
- sys.path.insert(0, "adk_stream_protocol/ags") is executed
- ags/ becomes the root, so imports use `from runner import ...`
"""

# ADK CLI adds ags/ to sys.path when running: adk web adk_stream_protocol/ags
# So we import from runner directly (not ags.runner)
from runner import sse_agent  # type: ignore[import-not-found]


# root_agent is required by adk web
root_agent = sse_agent
