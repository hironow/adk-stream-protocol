"""
Backend E2E Tests with Chunk Player

Tests backend behavior by replaying pre-recorded chunks from fixture files.
This enables deterministic testing without real LLM API calls.

Fixture Files:
- fixtures/backend/*-from-frontend.jsonl (converted from frontend baseline fixtures)

Per CLAUDE.md guidelines:
- No mocks allowed in E2E tests
- Uses real ChunkPlayer for chunk replay
- Given-When-Then structure
- Tests critical backend integration points
"""

import os
from pathlib import Path

import pytest

from adk_stream_protocol.chunk_player import ChunkPlayer, ChunkPlayerManager


class TestChunkPlayerManager:
    """Tests for ChunkPlayerManager E2E mode detection."""

    def test_manager_detects_disabled_mode(self):
        """Manager should return None when E2E mode is disabled."""
        # Given: E2E mode is disabled
        os.environ.pop("E2E_CHUNK_PLAYER_MODE", None)

        # When: Create player
        player = ChunkPlayerManager.create_player()

        # Then: Should return None
        assert player is None

    def test_manager_detects_enabled_mode_without_fixture_raises_error(self):
        """Manager should raise error when E2E mode enabled but fixture not set."""
        # Given: E2E mode enabled but fixture not set
        os.environ["E2E_CHUNK_PLAYER_MODE"] = "true"
        os.environ.pop("E2E_CHUNK_PLAYER_FIXTURE", None)

        try:
            # When: Create player
            # Then: Should raise ValueError
            with pytest.raises(ValueError, match="E2E_CHUNK_PLAYER_FIXTURE"):
                ChunkPlayerManager.create_player()
        finally:
            # Cleanup
            os.environ.pop("E2E_CHUNK_PLAYER_MODE", None)

    def test_manager_creates_player_when_enabled(self, fixture_dir: Path):
        """Manager should create player when E2E mode enabled with fixture."""
        # Given: E2E mode enabled with fixture path
        fixture_path = fixture_dir / "get_weather-sse-from-frontend.jsonl"
        os.environ["E2E_CHUNK_PLAYER_MODE"] = "true"
        os.environ["E2E_CHUNK_PLAYER_FIXTURE"] = str(fixture_path)

        try:
            # When: Create player
            player = ChunkPlayerManager.create_player()

            # Then: Should return ChunkPlayer instance
            assert player is not None
            assert isinstance(player, ChunkPlayer)
        finally:
            # Cleanup
            os.environ.pop("E2E_CHUNK_PLAYER_MODE", None)
            os.environ.pop("E2E_CHUNK_PLAYER_FIXTURE", None)


# ============================================================================
# Future Tests (After Fixtures Are Recorded)
# ============================================================================

# Pattern 2, 3, 4 tests have been removed as fixture files do not exist
# and there is no plan to record them. If needed in the future, they can
# be recreated from git history.
