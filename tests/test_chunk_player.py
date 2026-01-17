"""
Tests for Chunk Player

Tests the chunk playback functionality for replaying recorded sessions.
"""

import json
import tempfile
import time
from pathlib import Path

import pytest

from adk_stream_protocol.testing.chunk_player import ChunkPlayer


@pytest.fixture
def sample_session():
    """Create a sample session with recorded chunks."""
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-player-001"
        session_dir = Path(tmpdir) / session_id
        session_dir.mkdir()

        # Create JSONL file directly
        jsonl_file = session_dir / "backend-adk-event.jsonl"
        base_time = int(time.time() * 1000)

        entries = [
            {
                "timestamp": base_time,
                "session_id": session_id,
                "mode": "adk-sse",
                "location": "backend-adk-event",
                "direction": "in",
                "sequence_number": 1,
                "chunk": {"event": "1"},
                "metadata": None,
            },
            {
                "timestamp": base_time + 100,
                "session_id": session_id,
                "mode": "adk-sse",
                "location": "backend-adk-event",
                "direction": "in",
                "sequence_number": 2,
                "chunk": {"event": "2"},
                "metadata": None,
            },
            {
                "timestamp": base_time + 200,
                "session_id": session_id,
                "mode": "adk-sse",
                "location": "backend-adk-event",
                "direction": "in",
                "sequence_number": 3,
                "chunk": {"event": "3"},
                "metadata": None,
            },
        ]

        with jsonl_file.open("w", encoding="utf-8") as f:
            for entry in entries:
                json_line = json.dumps(entry, ensure_ascii=False)
                f.write(json_line + "\n")

        yield tmpdir, session_id


def test_chunk_player_file_not_found():
    """ChunkPlayer raises error when JSONL file not found."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        # when/then
        with pytest.raises(FileNotFoundError, match="JSONL file not found"):
            ChunkPlayer(
                session_dir=tmpdir,
                location="backend-adk-event",
            )


@pytest.mark.asyncio
async def test_chunk_player_fast_forward_mode(sample_session):
    """ChunkPlayer replays chunks in fast-forward mode."""
    # given
    tmpdir, session_id = sample_session
    player = ChunkPlayer(
        session_dir=Path(tmpdir) / session_id,
        location="backend-adk-event",
    )

    # when
    chunks = []
    async for entry in player.play(mode="fast-forward"):
        chunks.append(entry)

    # then
    assert len(chunks) == 3
    assert chunks[0].chunk == {"event": "1"}
    assert chunks[1].chunk == {"event": "2"}
    assert chunks[2].chunk == {"event": "3"}
    assert chunks[0].sequence_number == 1
    assert chunks[1].sequence_number == 2
    assert chunks[2].sequence_number == 3


@pytest.mark.asyncio
async def test_chunk_player_real_time_mode(sample_session):
    """ChunkPlayer replays chunks with original timing in real-time mode."""
    # given
    tmpdir, session_id = sample_session
    player = ChunkPlayer(
        session_dir=Path(tmpdir) / session_id,
        location="backend-adk-event",
    )

    # when
    start_time = time.time()
    chunks = []
    async for entry in player.play(mode="real-time"):
        chunks.append(entry)
    elapsed_ms = (time.time() - start_time) * 1000

    # then
    assert len(chunks) == 3
    # Should take roughly 200ms (original duration)
    # Allow some tolerance for timing
    assert elapsed_ms >= 180  # At least 180ms
    assert elapsed_ms <= 300  # But not too long


@pytest.mark.asyncio
async def test_chunk_player_step_mode(sample_session):
    """ChunkPlayer replays chunks in step mode."""
    # given
    tmpdir, session_id = sample_session
    player = ChunkPlayer(
        session_dir=Path(tmpdir) / session_id,
        location="backend-adk-event",
    )

    # when
    chunks = []
    async for entry in player.play(mode="step"):
        chunks.append(entry)

    # then
    assert len(chunks) == 3


def test_chunk_player_get_stats(sample_session):
    """ChunkPlayer returns correct statistics."""
    # given
    tmpdir, session_id = sample_session
    player = ChunkPlayer(
        session_dir=Path(tmpdir) / session_id,
        location="backend-adk-event",
    )

    # when
    stats = player.get_stats()

    # then
    assert stats["count"] == 3
    assert stats["duration_ms"] == 200  # 200ms total duration
    assert stats["location"] == "backend-adk-event"
    assert "session_dir" in stats
    assert stats["first_timestamp"] is not None
    assert stats["last_timestamp"] is not None


def test_chunk_player_empty_file():
    """ChunkPlayer handles empty JSONL file."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-empty"
        session_dir = Path(tmpdir) / session_id
        session_dir.mkdir()
        jsonl_file = session_dir / "backend-adk-event.jsonl"
        jsonl_file.touch()  # Create empty file

        # when
        player = ChunkPlayer(
            session_dir=session_dir,
            location="backend-adk-event",
        )
        stats = player.get_stats()

        # then
        assert stats["count"] == 0
        assert stats["duration_ms"] == 0


def test_chunk_player_invalid_json():
    """ChunkPlayer raises error on invalid JSON."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-invalid"
        session_dir = Path(tmpdir) / session_id
        session_dir.mkdir()
        jsonl_file = session_dir / "backend-adk-event.jsonl"

        # Write invalid JSON
        with jsonl_file.open("w", encoding="utf-8") as f:
            f.write("invalid json\n")

        player = ChunkPlayer(
            session_dir=session_dir,
            location="backend-adk-event",
        )

        # when/then
        with pytest.raises(ValueError, match="Invalid JSONL at line 1"):
            player._load_entries()


@pytest.mark.asyncio
async def test_chunk_player_sequence_order(sample_session):
    """ChunkPlayer yields chunks in sequence number order."""
    # given
    tmpdir, session_id = sample_session
    player = ChunkPlayer(
        session_dir=Path(tmpdir) / session_id,
        location="backend-adk-event",
    )

    # when
    chunks = []
    async for entry in player.play(mode="fast-forward"):
        chunks.append(entry)

    # then
    sequence_numbers = [chunk.sequence_number for chunk in chunks]
    assert sequence_numbers == [1, 2, 3]  # Correct order
