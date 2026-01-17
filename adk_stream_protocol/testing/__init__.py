"""
Testing Utilities - Debug and test support tools.

This subpackage provides utilities for testing and debugging:
- ChunkLogger: Logs SSE chunks to files for debugging and replay
- ChunkPlayer: Replays recorded SSE chunks for testing
- ChunkPlayerManager: Manages multiple ChunkPlayer instances

These utilities are primarily used for:
- Recording live ADK responses for offline testing
- Replaying recorded responses in E2E tests
- Debugging SSE event streams
"""

from .chunk_logger import ChunkLogger, Mode, chunk_logger
from .chunk_player import ChunkPlayer, ChunkPlayerManager

__all__ = [
    # Logging
    "ChunkLogger",
    "Mode",
    "chunk_logger",
    # Playback
    "ChunkPlayer",
    "ChunkPlayerManager",
]
