"""
Backend E2E Tests for Converted Frontend Fixtures

Tests that backend ChunkPlayer can load and replay fixtures converted from
frontend baseline fixtures. This verifies that the conversion process produces
valid ChunkPlayer JSONL files.

These tests use fixtures generated from frontend/fixtures/*.json by running:
    uv run python scripts/convert_frontend_to_backend_fixture.py

Fixture Files:
- fixtures/backend/*-from-frontend.jsonl (converted from frontend)

Per CLAUDE.md guidelines:
- No mocks allowed in E2E tests
- Uses real ChunkPlayer for chunk replay
- Given-When-Then structure
- Tests critical backend integration points
"""

from pathlib import Path

import pytest

from adk_stream_protocol import ChunkPlayer


class TestConvertedSSEFixtures:
    """Tests for SSE fixtures converted from frontend baselines."""

    @pytest.mark.asyncio
    async def test_get_weather_sse_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay get_weather SSE fixture."""
        # Given: Converted fixture from frontend baseline
        fixture_path = fixture_dir / "get_weather-sse-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Play chunks in fast-forward mode
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have replayed all chunks
        assert len(chunks) == 9
        # And: All chunks should have ADK SSE mode
        for entry in chunks:
            assert entry.mode == "adk-sse"
        # And: Last chunk should be [DONE]
        assert chunks[-1].chunk == "[DONE]"

    @pytest.mark.asyncio
    async def test_get_location_approved_sse_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay get_location approval flow (SSE)."""
        # Given: Converted fixture with approval flow
        fixture_path = fixture_dir / "get_location-approved-sse-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have 14 chunks (approval flow has more chunks)
        assert len(chunks) == 14
        # And: Should contain tool-related chunks
        chunk_types = {entry.chunk.get("type") for entry in chunks if isinstance(entry.chunk, dict)}
        assert "tool-input-start" in chunk_types
        assert "tool-input-available" in chunk_types
        assert "tool-output-available" in chunk_types

    @pytest.mark.asyncio
    async def test_process_payment_approved_sse_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay process_payment approval flow (SSE)."""
        # Given: Converted fixture with payment approval
        fixture_path = fixture_dir / "process_payment-approved-sse-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have 14 chunks
        assert len(chunks) == 14
        # And: Last chunk should be [DONE]
        assert chunks[-1].chunk == "[DONE]"


class TestConvertedBIDIFixtures:
    """Tests for BIDI fixtures converted from frontend baselines."""

    @pytest.mark.asyncio
    async def test_get_weather_bidi_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay get_weather BIDI fixture."""
        # Given: Converted fixture from frontend baseline
        fixture_path = fixture_dir / "get_weather-bidi-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Play chunks in fast-forward mode
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have replayed all chunks
        assert len(chunks) == 9
        # And: All chunks should have ADK BIDI mode
        for entry in chunks:
            assert entry.mode == "adk-bidi"
        # And: Last chunk should be [DONE]
        assert chunks[-1].chunk == "[DONE]"

    @pytest.mark.asyncio
    async def test_change_bgm_bidi_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay change_bgm BIDI fixture (frontend tool)."""
        # Given: Converted fixture with frontend tool execution
        fixture_path = fixture_dir / "change_bgm-bidi-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have 9 chunks
        assert len(chunks) == 9
        # And: Should contain tool execution for change_bgm
        tool_chunks = [
            entry.chunk
            for entry in chunks
            if isinstance(entry.chunk, dict) and entry.chunk.get("toolName") == "change_bgm"
        ]
        assert len(tool_chunks) > 0

    @pytest.mark.asyncio
    async def test_get_location_denied_bidi_loads_and_replays(self, fixture_dir: Path):
        """Should load and replay get_location denial flow (BIDI)."""
        # Given: Converted fixture with denial flow
        fixture_path = fixture_dir / "get_location-denied-bidi-from-frontend.jsonl"
        player = ChunkPlayer.from_file(fixture_path)

        # When: Collect all chunks
        chunks = []
        async for entry in player.play(mode="fast-forward"):
            chunks.append(entry)

        # Then: Should have 14 chunks
        assert len(chunks) == 14
        # And: All chunks should have ADK BIDI mode
        for entry in chunks:
            assert entry.mode == "adk-bidi"


class TestChunkPlayerStats:
    """Tests for ChunkPlayer stats on converted fixtures."""

    def test_converted_fixture_stats(self, fixture_dir: Path):
        """Should provide accurate stats for converted fixtures."""
        # Given: Multiple converted fixtures
        fixtures = [
            ("get_weather-sse-from-frontend.jsonl", 9),
            ("get_weather-bidi-from-frontend.jsonl", 9),
            ("get_location-approved-sse-from-frontend.jsonl", 14),
            ("process_payment-denied-bidi-from-frontend.jsonl", 14),
        ]

        for filename, expected_count in fixtures:
            # When: Load fixture and get stats
            fixture_path = fixture_dir / filename
            player = ChunkPlayer.from_file(fixture_path)
            stats = player.get_stats()

            # Then: Stats should match expected values
            assert stats["count"] == expected_count, f"Failed for {filename}"
