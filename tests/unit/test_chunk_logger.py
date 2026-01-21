"""
Tests for ChunkLogger environment variable loading.
Verifies that dotenv is loaded before ChunkLogger initialization.
"""

import os
import sys
import unittest
from unittest.mock import Mock, patch

from adk_stream_protocol import ChunkLogger
from adk_stream_protocol.testing.chunk_logger import chunk_logger


class TestChunkLoggerEnvironment(unittest.TestCase):
    """Test ChunkLogger environment variable loading."""

    def setUp(self):
        """Set up test environment."""
        # Save original environment
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment."""
        # Restore original environment
        os.environ.clear()
        os.environ.update(self.original_env)

        # Clean up any imported modules
        modules_to_remove = [
            "chunk_logger",
            "stream_protocol",
            "server",
        ]
        for module in modules_to_remove:
            if module in sys.modules:
                del sys.modules[module]

    def test_chunk_logger_reads_environment_variables(self):
        """Test that ChunkLogger reads CHUNK_LOGGER_ENABLED from environment."""
        # Set environment variable
        os.environ["CHUNK_LOGGER_ENABLED"] = "true"
        os.environ["CHUNK_LOGGER_OUTPUT_DIR"] = "./test_chunks"

        # Import chunk_logger after setting env

        # Create new instance
        logger = ChunkLogger()

        # Verify it read the environment
        assert logger._enabled is True
        assert str(logger._output_dir) == "test_chunks"

    def test_chunk_logger_disabled_by_default(self):
        """Test that ChunkLogger is disabled when env var not set."""
        # Make sure env var is not set
        if "CHUNK_LOGGER_ENABLED" in os.environ:
            del os.environ["CHUNK_LOGGER_ENABLED"]

        # Create new instance
        logger = ChunkLogger()

        # Should be disabled by default
        assert logger._enabled is False

    def test_chunk_logger_session_id_from_environment(self):
        """Test that ChunkLogger reads session ID from environment."""
        test_session_id = "test-session-2025"
        os.environ["CHUNK_LOGGER_ENABLED"] = "true"
        os.environ["CHUNK_LOGGER_SESSION_ID"] = test_session_id

        # Import chunk_logger

        # Create new instance
        logger = ChunkLogger()

        # Should use the session ID from environment
        assert logger._session_id == test_session_id

    def test_chunk_logger_generates_session_id_if_not_set(self):
        """Test that ChunkLogger generates session ID when not in environment."""
        os.environ["CHUNK_LOGGER_ENABLED"] = "true"

        # Make sure session ID is not set
        if "CHUNK_LOGGER_SESSION_ID" in os.environ:
            del os.environ["CHUNK_LOGGER_SESSION_ID"]

        # Import chunk_logger

        # Create new instance
        logger = ChunkLogger()

        # Should have generated a session ID
        assert logger._session_id is not None
        assert logger._session_id.startswith("session-")

    @patch("pathlib.Path.mkdir")
    @patch("pathlib.Path.open")
    def test_chunk_logger_logs_when_enabled(self, mock_path_open, mock_mkdir):
        """Test that ChunkLogger actually logs when enabled."""
        os.environ["CHUNK_LOGGER_ENABLED"] = "true"

        # Mock file handle with write method
        mock_file = Mock()
        mock_path_open.return_value = mock_file

        # Create new ChunkLogger instance with mocked environment
        logger = ChunkLogger()

        # Log a chunk
        test_chunk = {"type": "test", "data": "sample"}
        logger.log_chunk(
            location="backend-sse-event", direction="out", chunk=test_chunk, mode="adk-sse"
        )

        # Verify write was called (this validates that logging actually happened)
        mock_file.write.assert_called_once()

        # Verify the written data contains our test chunk
        written_data = mock_file.write.call_args[0][0]
        assert "backend-sse-event" in written_data
        assert "test" in written_data
        assert "sample" in written_data

    def test_chunk_logger_does_not_log_when_disabled(self):
        """Test that ChunkLogger does not log when disabled."""
        os.environ["CHUNK_LOGGER_ENABLED"] = "false"

        # Mock file operations
        with patch("builtins.open", Mock()) as mock_open:
            with patch("adk_stream_protocol.testing.chunk_logger.json.dump") as mock_json_dump:
                # Try to log a chunk
                chunk_logger.log_chunk(
                    location="backend-adk-event",
                    direction="in",
                    chunk={"test": "data"},
                    mode="adk-bidi",
                )

                # Should NOT have tried to open file or dump JSON
                mock_open.assert_not_called()
                mock_json_dump.assert_not_called()
