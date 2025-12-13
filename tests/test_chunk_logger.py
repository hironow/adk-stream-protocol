"""
Tests for Chunk Logger

Tests the chunk logging functionality for recording and debugging.
"""

import json
import tempfile
from pathlib import Path

import pytest

from chunk_logger import ChunkLogger


def test_chunk_logger_disabled_by_default():
    """Chunk logger should be disabled by default."""
    # given
    logger = ChunkLogger()

    # when/then
    assert logger.is_enabled() is False


def test_chunk_logger_enabled_via_parameter():
    """Chunk logger can be enabled via parameter."""
    # given/when
    logger = ChunkLogger(enabled=True, output_dir=tempfile.mkdtemp())

    # then
    assert logger.is_enabled() is True
    logger.close()


def test_chunk_logger_enabled_via_env(monkeypatch: pytest.MonkeyPatch):
    """Chunk logger can be enabled via environment variable."""
    # given
    monkeypatch.setenv("CHUNK_LOGGER_ENABLED", "true")

    # when
    logger = ChunkLogger(output_dir=tempfile.mkdtemp())

    # then
    assert logger.is_enabled() is True
    logger.close()


def test_chunk_logger_creates_session_directory():
    """Chunk logger creates session directory when enabled."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-001"

        # when
        logger = ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        )

        # then
        session_dir = Path(tmpdir) / session_id
        assert session_dir.exists()
        assert session_dir.is_dir()
        logger.close()


def test_chunk_logger_writes_jsonl():
    """Chunk logger writes chunks in JSONL format."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-002"
        logger = ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        )

        # when
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"type": "test", "data": "hello"},
            mode="adk-sse",
        )
        logger.close()

        # then
        jsonl_file = Path(tmpdir) / session_id / "backend-adk-event.jsonl"
        assert jsonl_file.exists()

        # Verify JSONL format
        with open(jsonl_file, encoding="utf-8") as f:
            lines = f.readlines()
            assert len(lines) == 1
            entry = json.loads(lines[0])
            assert entry["location"] == "backend-adk-event"
            assert entry["direction"] == "in"
            assert entry["mode"] == "adk-sse"
            assert entry["chunk"] == {"type": "test", "data": "hello"}
            assert "timestamp" in entry
            assert "session_id" in entry
            assert "sequence_number" in entry


def test_chunk_logger_increments_sequence_number():
    """Chunk logger increments sequence number for each chunk."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-003"
        logger = ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        )

        # when
        logger.log_chunk(
            location="backend-sse-event",
            direction="out",
            chunk={"event": "1"},
            mode="adk-sse",
        )
        logger.log_chunk(
            location="backend-sse-event",
            direction="out",
            chunk={"event": "2"},
            mode="adk-sse",
        )
        logger.log_chunk(
            location="backend-sse-event",
            direction="out",
            chunk={"event": "3"},
            mode="adk-sse",
        )
        logger.close()

        # then
        jsonl_file = Path(tmpdir) / session_id / "backend-sse-event.jsonl"
        with open(jsonl_file, encoding="utf-8") as f:
            lines = f.readlines()
            assert len(lines) == 3

            entry1 = json.loads(lines[0])
            entry2 = json.loads(lines[1])
            entry3 = json.loads(lines[2])

            assert entry1["sequence_number"] == 1
            assert entry2["sequence_number"] == 2
            assert entry3["sequence_number"] == 3


def test_chunk_logger_separate_files_per_location():
    """Chunk logger creates separate files for each location."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-004"
        logger = ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        )

        # when
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"adk": "event"},
            mode="adk-sse",
        )
        logger.log_chunk(
            location="backend-sse-event",
            direction="out",
            chunk={"sse": "event"},
            mode="adk-sse",
        )
        logger.close()

        # then
        session_dir = Path(tmpdir) / session_id
        assert (session_dir / "backend-adk-event.jsonl").exists()
        assert (session_dir / "backend-sse-event.jsonl").exists()


def test_chunk_logger_no_files_when_disabled():
    """Chunk logger does not create files when disabled."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-005"
        logger = ChunkLogger(
            enabled=False, output_dir=tmpdir, session_id=session_id
        )

        # when
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"test": "data"},
            mode="adk-sse",
        )
        logger.close()

        # then
        session_dir = Path(tmpdir) / session_id
        assert not session_dir.exists()


def test_chunk_logger_context_manager():
    """Chunk logger works as context manager."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-006"

        # when
        with ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        ) as logger:
            logger.log_chunk(
                location="backend-adk-event",
                direction="in",
                chunk={"test": "context"},
                mode="adk-sse",
            )

        # then
        jsonl_file = Path(tmpdir) / session_id / "backend-adk-event.jsonl"
        assert jsonl_file.exists()


def test_chunk_logger_session_id_auto_generation():
    """Chunk logger auto-generates session ID if not provided."""
    # given/when
    logger = ChunkLogger(enabled=True, output_dir=tempfile.mkdtemp())

    # then
    # Session ID should match pattern: session-YYYY-MM-DD-HHMMSS
    assert logger._session_id.startswith("session-")
    assert len(logger._session_id) > len("session-")
    logger.close()


def test_chunk_logger_custom_output_dir_via_env(
    monkeypatch: pytest.MonkeyPatch,
):
    """Chunk logger respects CHUNK_LOGGER_OUTPUT_DIR environment variable."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        monkeypatch.setenv("CHUNK_LOGGER_OUTPUT_DIR", tmpdir)
        monkeypatch.setenv("CHUNK_LOGGER_ENABLED", "true")
        session_id = "test-session-007"

        # when
        logger = ChunkLogger(session_id=session_id)
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"test": "env"},
            mode="adk-sse",
        )
        logger.close()

        # then
        jsonl_file = Path(tmpdir) / session_id / "backend-adk-event.jsonl"
        assert jsonl_file.exists()


def test_chunk_logger_custom_session_id_via_env(
    monkeypatch: pytest.MonkeyPatch,
):
    """Chunk logger respects CHUNK_LOGGER_SESSION_ID environment variable."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        custom_session = "custom-session-from-env"
        monkeypatch.setenv("CHUNK_LOGGER_SESSION_ID", custom_session)
        monkeypatch.setenv("CHUNK_LOGGER_ENABLED", "true")

        # when
        logger = ChunkLogger(output_dir=tmpdir)
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"test": "env-session"},
            mode="adk-sse",
        )
        logger.close()

        # then
        jsonl_file = Path(tmpdir) / custom_session / "backend-adk-event.jsonl"
        assert jsonl_file.exists()


def test_chunk_logger_metadata():
    """Chunk logger can include optional metadata."""
    # given
    with tempfile.TemporaryDirectory() as tmpdir:
        session_id = "test-session-008"
        logger = ChunkLogger(
            enabled=True, output_dir=tmpdir, session_id=session_id
        )

        # when
        logger.log_chunk(
            location="backend-adk-event",
            direction="in",
            chunk={"test": "metadata"},
            mode="adk-sse",
            metadata={"backend_version": "1.0.0", "model": "gemini-2.0"},
        )
        logger.close()

        # then
        jsonl_file = Path(tmpdir) / session_id / "backend-adk-event.jsonl"
        with open(jsonl_file, encoding="utf-8") as f:
            entry = json.loads(f.read())
            assert entry["metadata"] == {
                "backend_version": "1.0.0",
                "model": "gemini-2.0",
            }
