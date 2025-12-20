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
import os
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, Literal

# Import from chunk_logger for consistent types
from .chunk_logger import ChunkLogEntry, LogLocation


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
    ) -> AsyncGenerator[ChunkLogEntry]:
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

        with self._jsonl_file.open(encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue

                # Reason: JSONL file parsing - converting JSON errors to ValueError with line context
                try:  # nosemgrep: forbid-try-except
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

    @classmethod
    def from_file(cls, file_path: str | Path) -> "ChunkPlayer":
        """
        Create player from a specific JSONL file.

        Useful for E2E tests with fixture files.

        Args:
            file_path: Path to JSONL file

        Returns:
            ChunkPlayer instance configured for the file

        Example:
            player = ChunkPlayer.from_file("tests/fixtures/backend-chunks.jsonl")
            async for entry in player.play():
                process(entry.chunk)
        """
        path = Path(file_path)
        if not path.exists():
            msg = f"Fixture file not found: {file_path}"
            raise FileNotFoundError(msg)

        # Extract location from filename (e.g., "backend-adk-event.jsonl" -> "backend-adk-event")
        location_str = path.stem

        # Create a temporary ChunkPlayer instance
        # Use parent directory as session_dir and filename stem as location
        return cls(session_dir=path.parent, location=location_str)  # type: ignore


class ChunkPlayerManager:
    """
    Manager for E2E test chunk player mode.

    Detects E2E mode from environment variables and provides appropriate player.
    """

    @staticmethod
    def is_enabled() -> bool:
        """
        Check if chunk player mode is enabled.

        Returns:
            True if E2E_CHUNK_PLAYER_MODE=true
        """
        return os.getenv("E2E_CHUNK_PLAYER_MODE", "false").lower() == "true"

    @staticmethod
    def get_fixture_path() -> str | None:
        """
        Get fixture path from environment.

        Returns:
            Fixture path or None if not set
        """
        return os.getenv("E2E_CHUNK_PLAYER_FIXTURE")

    @classmethod
    def create_player(cls) -> ChunkPlayer | None:
        """
        Create chunk player if E2E mode is enabled.

        Returns:
            ChunkPlayer instance if enabled, None otherwise

        Raises:
            ValueError: If E2E mode enabled but fixture path not set

        Example:
            player = ChunkPlayerManager.create_player()
            if player:
                async for entry in player.play(mode="fast-forward"):
                    process(entry.chunk)
        """
        if not cls.is_enabled():
            return None

        fixture_path = cls.get_fixture_path()
        if not fixture_path:
            msg = "E2E_CHUNK_PLAYER_MODE is enabled but E2E_CHUNK_PLAYER_FIXTURE is not set"
            raise ValueError(msg)

        return ChunkPlayer.from_file(fixture_path)
