"""
Chunk Logger for ADK AI Data Protocol

Records chunks at various points in the data flow for debugging and testing.
Outputs JSONL format (1 line = 1 chunk) for easy parsing and replay.

Usage:
    from lib.chunk_logger import chunk_logger

    # Log a chunk
    chunk_logger.log_chunk(
        location="backend-adk-event",
        direction="in",
        chunk=event_data,
        mode="adk-bidi"
    )

Environment Variables:
    CHUNK_LOGGER_ENABLED: Enable/disable logging (default: false)
    CHUNK_LOGGER_OUTPUT_DIR: Output directory (default: ./chunk_logs)
    CHUNK_LOGGER_SESSION_ID: Session identifier (default: auto-generated)

Output Structure:
    chunk_logs/
      └─ {session_id}/
          ├─ backend-adk-event.jsonl
          ├─ backend-sse-event.jsonl
          └─ ...
"""

import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal


# Type definitions
LogLocation = Literal[
    "backend-adk-event",  # ADK raw event (input)
    "backend-sse-event",  # SSE formatted event (output)
    "frontend-api-response",  # Next.js API response (Gemini Direct)
    "frontend-sse-chunk",  # SSE chunk (ADK SSE)
    "frontend-ws-chunk",  # WebSocket chunk (ADK BIDI)
    "frontend-useChat-chunk",  # useChat chunk (all modes)
]

Direction = Literal["in", "out"]

Mode = Literal["gemini", "adk-sse", "adk-bidi"]


@dataclass
class ChunkLogEntry:
    """Single chunk log entry."""

    # Metadata
    timestamp: int  # Unix timestamp (ms)
    session_id: str  # Session identifier
    mode: Mode  # Backend mode
    location: LogLocation  # Recording point
    direction: Direction  # Input/output
    sequence_number: int  # Chunk order

    # Chunk data
    chunk: Any  # Actual chunk data (type depends on location)

    # Optional metadata
    metadata: dict[str, Any] | None = None


class ChunkLogger:
    """
    Chunk logger for recording data flow.

    Writes chunks to JSONL files organized by session and location.
    """

    def __init__(
        self,
        enabled: bool | None = None,
        output_dir: str | None = None,
        session_id: str | None = None,
    ):
        """
        Initialize chunk logger.

        Args:
            enabled: Enable/disable logging (default: from env CHUNK_LOGGER_ENABLED)
            output_dir: Output directory (default: from env CHUNK_LOGGER_OUTPUT_DIR or ./chunk_logs)
            session_id: Session ID (default: from env CHUNK_LOGGER_SESSION_ID or auto-generated)
        """
        # Read from environment if not provided
        self._enabled = (
            enabled
            if enabled is not None
            else os.getenv("CHUNK_LOGGER_ENABLED", "false").lower() == "true"
        )

        output_dir_str = (
            output_dir
            if output_dir is not None
            else os.getenv("CHUNK_LOGGER_OUTPUT_DIR", "./chunk_logs")
        )
        self._output_dir = Path(output_dir_str)

        self._session_id = (
            session_id or os.getenv("CHUNK_LOGGER_SESSION_ID") or self._generate_session_id()
        )

        # Sequence counter per location
        self._sequence_counters: dict[LogLocation, int] = {}

        # File handles cache (location -> file handle)
        self._file_handles: dict[LogLocation, Any] = {}

        # Create session directory if enabled
        if self._enabled:
            self._ensure_session_dir()

    def _generate_session_id(self) -> str:
        """Generate session ID with timestamp."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d-%H%M%S")
        return f"session-{timestamp}"

    def _ensure_session_dir(self) -> None:
        """Ensure session directory exists."""
        session_dir = self._output_dir / self._session_id
        session_dir.mkdir(parents=True, exist_ok=True)

    def _get_file_handle(self, location: LogLocation) -> Any:
        """Get or create file handle for location."""
        if location not in self._file_handles:
            session_dir = self._output_dir / self._session_id
            file_path = session_dir / f"{location}.jsonl"
            # Open in append mode with UTF-8 encoding
            self._file_handles[location] = file_path.open(
                "a", encoding="utf-8", buffering=1
            )  # Line buffering
        return self._file_handles[location]

    def is_enabled(self) -> bool:
        """Check if logger is enabled."""
        return self._enabled

    def log_chunk(
        self,
        location: LogLocation,
        direction: Direction,
        chunk: Any,
        mode: Mode = "adk-sse",  # Default mode
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Log a chunk.

        Args:
            location: Recording point
            direction: Input or output
            chunk: Chunk data to log
            mode: Backend mode (gemini/adk-sse/adk-bidi)
            metadata: Optional metadata
        """
        if not self._enabled:
            return

        # Increment sequence counter
        if location not in self._sequence_counters:
            self._sequence_counters[location] = 0
        self._sequence_counters[location] += 1

        # Create log entry
        entry = ChunkLogEntry(
            timestamp=int(time.time() * 1000),  # ms
            session_id=self._session_id,
            mode=mode,
            location=location,
            direction=direction,
            sequence_number=self._sequence_counters[location],
            chunk=chunk,
            metadata=metadata,
        )

        # Write to JSONL file
        file_handle = self._get_file_handle(location)
        json_line = json.dumps(asdict(entry), ensure_ascii=False)
        file_handle.write(json_line + "\n")

    def get_output_path(self) -> Path:
        """Get the full output path for the current session."""
        return self._output_dir / self._session_id

    def get_info(self) -> dict[str, Any]:
        """Get logger configuration information."""
        return {
            "enabled": self._enabled,
            "output_dir": str(self._output_dir),
            "session_id": self._session_id,
            "output_path": str(self.get_output_path()),
        }

    def close(self) -> None:
        """Close all file handles."""
        for handle in self._file_handles.values():
            handle.close()
        self._file_handles.clear()

    def __enter__(self) -> "ChunkLogger":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Context manager exit."""
        self.close()


# Global singleton instance
chunk_logger = ChunkLogger()
