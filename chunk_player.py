"""
Chunk Player for ADK AI Data Protocol

Replays recorded chunks from JSONL files for testing and debugging.

Usage:
    from chunk_player import ChunkPlayer

    # Create player
    player = ChunkPlayer(
        session_dir="./chunk_logs/session-2025-12-14-123456",
        location="backend-adk-event"
    )

    # Replay chunks
    async for chunk_entry in player.play(mode="fast-forward"):
        # Process chunk_entry.chunk
        print(chunk_entry)

Playback Modes:
    real-time: Replay with original timing (based on timestamps)
    fast-forward: Replay as fast as possible (no delays)
    step: Manual step-by-step (requires next() call)
"""

import asyncio
import json
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, Literal

# Import from chunk_logger for consistent types
from chunk_logger import ChunkLogEntry, LogLocation

PlaybackMode = Literal["real-time", "fast-forward", "step"]


class ChunkPlayer:
    """
    Chunk player for replaying recorded data flow.

    Reads chunks from JSONL files and yields them with timing control.
    """

    def __init__(
        self,
        session_dir: str | Path,
        location: LogLocation,
    ):
        """
        Initialize chunk player.

        Args:
            session_dir: Session directory containing JSONL files
            location: Location to replay (e.g., "backend-adk-event")
        """
        self._session_dir = Path(session_dir)
        self._location = location
        self._jsonl_file = self._session_dir / f"{location}.jsonl"

        if not self._jsonl_file.exists():
            msg = f"JSONL file not found: {self._jsonl_file}"
            raise FileNotFoundError(msg)

    async def play(
        self,
        mode: PlaybackMode = "fast-forward",
    ) -> AsyncGenerator[ChunkLogEntry, None]:
        """
        Replay chunks from JSONL file.

        Args:
            mode: Playback mode (real-time/fast-forward/step)

        Yields:
            ChunkLogEntry: Chunk entries in sequence
        """
        entries = self._load_entries()

        if mode == "fast-forward":
            # Yield as fast as possible
            for entry in entries:
                yield entry
        elif mode == "real-time":
            # Yield with original timing
            start_time = time.time()
            first_timestamp = entries[0].timestamp if entries else 0

            for entry in entries:
                # Calculate delay based on original timestamp
                elapsed_ms = (time.time() - start_time) * 1000
                target_ms = entry.timestamp - first_timestamp
                delay_ms = target_ms - elapsed_ms

                if delay_ms > 0:
                    await asyncio.sleep(delay_ms / 1000)

                yield entry
        elif mode == "step":
            # Manual step-by-step (for interactive debugging)
            # Note: Requires external control mechanism
            # For now, just yield with small delay
            for entry in entries:
                yield entry
                await asyncio.sleep(0.1)  # Small delay for step mode
        else:
            msg = f"Invalid playback mode: {mode}"
            raise ValueError(msg)

    def _load_entries(self) -> list[ChunkLogEntry]:
        """
        Load all entries from JSONL file.

        Returns:
            List of ChunkLogEntry sorted by sequence_number
        """
        entries: list[ChunkLogEntry] = []

        with open(self._jsonl_file, encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)
                    entry = ChunkLogEntry(
                        timestamp=data["timestamp"],
                        session_id=data["session_id"],
                        mode=data["mode"],
                        location=data["location"],
                        direction=data["direction"],
                        sequence_number=data["sequence_number"],
                        chunk=data["chunk"],
                        metadata=data.get("metadata"),
                    )
                    entries.append(entry)
                except (json.JSONDecodeError, KeyError) as e:
                    msg = f"Invalid JSONL at line {line_no}: {e}"
                    raise ValueError(msg) from e

        # Sort by sequence_number to ensure correct order
        entries.sort(key=lambda e: e.sequence_number)

        return entries

    def get_stats(self) -> dict[str, Any]:
        """
        Get statistics about the recorded session.

        Returns:
            Dictionary with stats (count, duration, etc.)
        """
        entries = self._load_entries()

        if not entries:
            return {
                "count": 0,
                "duration_ms": 0,
                "first_timestamp": None,
                "last_timestamp": None,
            }

        first_timestamp = entries[0].timestamp
        last_timestamp = entries[-1].timestamp
        duration_ms = last_timestamp - first_timestamp

        return {
            "count": len(entries),
            "duration_ms": duration_ms,
            "first_timestamp": first_timestamp,
            "last_timestamp": last_timestamp,
            "location": self._location,
            "session_dir": str(self._session_dir),
        }
