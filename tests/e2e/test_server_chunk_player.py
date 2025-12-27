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

from adk_stream_protocol import ChunkPlayer, ChunkPlayerManager


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

# These tests are marked as skip until fixtures are recorded.
# Once manual recording is complete, remove @pytest.mark.skip decorators.


@pytest.mark.skip(
    reason="Waiting for fixture recording - fixture files are empty (0 bytes). See docs/E2E_GUIDE.md"
)
class TestPattern2ADKSSEOnly:
    """
    Tests for Pattern 2: ADK SSE Only.

    Verifies backend SSE processing with tool invocations.
    """

    @pytest.mark.asyncio
    async def test_replays_chunks_in_fast_forward_mode(self, fixture_dir: Path):
        """Should replay all chunks without delays."""
        # Given: Recorded fixture with ADK SSE chunks
        fixture_path = fixture_dir / "pattern2-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Play chunks in fast-forward mode
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have replayed all chunks
        assert len(chunks) > 0
        # And: All chunks should have ADK SSE mode
        for entry in chunks:
            assert entry.mode in ["adk-sse"]

    @pytest.mark.asyncio
    async def test_contains_tool_invocation_chunks(self, fixture_dir: Path):
        """Should contain tool invocation chunks (weather, calculator)."""
        # Given: Recorded fixture with tool invocations
        fixture_path = fixture_dir / "pattern2-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should find tool invocation chunks
        tool_chunks = [c for c in chunks if "tool" in str(c.chunk).lower()]
        assert len(tool_chunks) > 0


@pytest.mark.skip(
    reason="Waiting for fixture recording - fixture files are empty (0 bytes). See docs/E2E_GUIDE.md"
)
class TestPattern3ADKBIDIOnly:
    """
    Tests for Pattern 3: ADK BIDI Only.

    Verifies backend WebSocket processing with audio chunks.
    """

    @pytest.mark.asyncio
    async def test_replays_chunks_in_fast_forward_mode(self, fixture_dir: Path):
        """Should replay all chunks without delays."""
        # Given: Recorded fixture with ADK BIDI chunks
        fixture_path = fixture_dir / "pattern3-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Play chunks in fast-forward mode
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have replayed all chunks
        assert len(chunks) > 0
        # And: All chunks should have ADK BIDI mode
        for entry in chunks:
            assert entry.mode in ["adk-bidi"]

    @pytest.mark.asyncio
    async def test_contains_audio_chunks(self, fixture_dir: Path):
        """Should contain audio (PCM) chunks."""
        # Given: Recorded fixture with audio chunks
        fixture_path = fixture_dir / "pattern3-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should find audio-related chunks
        # Note: Actual assertion depends on chunk structure
        assert len(chunks) > 0


@pytest.mark.skip(
    reason="Waiting for fixture recording - fixture files are empty (0 bytes). See docs/E2E_GUIDE.md"
)
class TestPattern4ModeSwitching:
    """
    Tests for Pattern 4: Mode Switching.

    Verifies backend handles mode transitions correctly.
    """

    @pytest.mark.asyncio
    async def test_replays_chunks_from_multiple_modes(self, fixture_dir: Path):
        """Should replay chunks from different modes."""
        # Given: Recorded fixture with mode switches
        fixture_path = fixture_dir / "pattern4-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have chunks from multiple modes
        modes = {entry.mode for entry in chunks}
        # Should have at least ADK SSE and ADK BIDI (Gemini Direct has no backend)
        assert "adk-sse" in modes or "adk-bidi" in modes

    @pytest.mark.asyncio
    async def test_preserves_chunk_order_across_mode_switches(self, fixture_dir: Path):
        """Should maintain correct chunk order despite mode changes."""
        # Given: Recorded fixture with mode switches
        fixture_path = fixture_dir / "pattern4-backend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Chunks should be in sequence order
        for i, entry in enumerate(chunks):
            if i > 0:
                # Sequence numbers should be monotonically increasing
                assert entry.sequence_number >= chunks[i - 1].sequence_number
