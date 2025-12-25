"""
Backend E2E Tests: Converted Fixture Consistency Validation

Tests that converted backend fixtures match frontend baseline fixtures exactly.
This validates the conversion script correctness WITHOUT running the server.

Test Strategy:
1. Load frontend baseline fixture (rawEvents)
2. Load converted backend fixture (ChunkPlayer JSONL)
3. Normalize IDs in both
4. Compare chunk-by-chunk

This provides COMPLETE validation of the conversion process:
- Frontend rawEvents (source of truth)
- Backend converted fixture (must match exactly)
- No server required, pure data validation

Per CLAUDE.md guidelines:
- No mocks (this is data validation, not behavior testing)
- Given-When-Then structure
- Tests critical data consistency
"""

import json
from pathlib import Path
from typing import Any

import pytest

from adk_stream_protocol import ChunkPlayer


def load_frontend_fixture(filename: str) -> dict[str, Any]:
    """Load frontend baseline fixture."""
    fixture_path = Path(__file__).parent.parent.parent / "fixtures" / "frontend" / filename
    return json.loads(fixture_path.read_text())


def normalize_ids_in_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize random IDs in chunk for comparison.

    Replaces:
    - messageId: Random UUID → "NORMALIZED_MESSAGE_ID"
    - toolCallId: Random UUID starting with "adk-" → "NORMALIZED_TOOL_CALL_ID"
    """
    if not isinstance(chunk, dict):
        return chunk

    normalized = {}
    for key, value in chunk.items():
        if key == "messageId" and isinstance(value, str):
            normalized[key] = "NORMALIZED_MESSAGE_ID"
        elif key == "toolCallId" and isinstance(value, str):
            # Keep prefix (adk-, confirmation-) but normalize UUID part
            if value.startswith("adk-"):
                normalized[key] = "NORMALIZED_TOOL_CALL_ID"
            elif value.startswith("confirmation-"):
                normalized[key] = "NORMALIZED_CONFIRMATION_ID"
            else:
                normalized[key] = value
        elif isinstance(value, dict):
            normalized[key] = normalize_ids_in_chunk(value)
        elif isinstance(value, list):
            normalized[key] = [normalize_ids_in_chunk(v) if isinstance(v, dict) else v for v in value]
        else:
            normalized[key] = value
    return normalized


def parse_raw_event_to_chunk(raw_event: str) -> dict[str, Any] | str:
    """
    Parse raw SSE event string to chunk object.

    Input:  'data: {"type": "start", ...}\\n\\n'
    Output: {"type": "start", ...}

    Input:  'data: [DONE]\\n\\n'
    Output: "[DONE]"
    """
    if not raw_event.startswith("data: "):
        raise ValueError(f"Invalid SSE format: {raw_event[:50]}")

    data = raw_event[6:].rstrip("\n")  # Remove 'data: ' prefix and newlines

    if data == "[DONE]":
        return "[DONE]"

    return json.loads(data)


class TestConvertedFixtureConsistency:
    """
    Tests verifying converted backend fixtures match frontend rawEvents exactly.
    """

    @pytest.mark.asyncio
    async def test_get_weather_sse_conversion_is_accurate(self, fixture_dir: Path):
        """Converted get_weather-sse fixture should match frontend rawEvents exactly."""
        # Given: Frontend baseline fixture
        frontend_fixture = load_frontend_fixture("get_weather-sse-baseline.json")

        # And: Parse rawEvents to chunks
        expected_chunks = [
            parse_raw_event_to_chunk(event)
            for event in frontend_fixture["output"]["rawEvents"]
        ]

        # And: Load converted backend fixture
        backend_fixture_path = fixture_dir / "get_weather-sse-from-frontend.jsonl"
        player = ChunkPlayer.from_file(backend_fixture_path)

        # When: Play chunks from backend fixture
        actual_chunks_raw = []
        async for entry in player.play(mode="fast-forward"):
            actual_chunks_raw.append(entry.chunk)

        # Then: Chunk count should match
        assert len(actual_chunks_raw) == len(expected_chunks), (
            f"Chunk count mismatch: got {len(actual_chunks_raw)}, expected {len(expected_chunks)}"
        )

        # And: Each chunk should match exactly (after ID normalization)
        for i, (actual, expected) in enumerate(zip(actual_chunks_raw, expected_chunks)):
            # Normalize IDs for comparison
            actual_normalized = normalize_ids_in_chunk(actual) if isinstance(actual, dict) else actual
            expected_normalized = normalize_ids_in_chunk(expected) if isinstance(expected, dict) else expected

            assert actual_normalized == expected_normalized, (
                f"Chunk {i} mismatch:\n"
                f"Actual:   {actual_normalized}\n"
                f"Expected: {expected_normalized}"
            )

    @pytest.mark.asyncio
    async def test_change_bgm_bidi_conversion_is_accurate(self, fixture_dir: Path):
        """Converted change_bgm-bidi fixture should match frontend rawEvents exactly."""
        # Given: Frontend baseline fixture
        frontend_fixture = load_frontend_fixture("change_bgm-bidi-baseline.json")

        # And: Parse rawEvents
        expected_chunks = [
            parse_raw_event_to_chunk(event)
            for event in frontend_fixture["output"]["rawEvents"]
        ]

        # And: Load converted backend fixture
        backend_fixture_path = fixture_dir / "change_bgm-bidi-from-frontend.jsonl"
        player = ChunkPlayer.from_file(backend_fixture_path)

        # When: Play chunks
        actual_chunks_raw = []
        async for entry in player.play(mode="fast-forward"):
            actual_chunks_raw.append(entry.chunk)

        # Then: Should match exactly
        assert len(actual_chunks_raw) == len(expected_chunks)
        for i, (actual, expected) in enumerate(zip(actual_chunks_raw, expected_chunks)):
            actual_normalized = normalize_ids_in_chunk(actual) if isinstance(actual, dict) else actual
            expected_normalized = normalize_ids_in_chunk(expected) if isinstance(expected, dict) else expected
            assert actual_normalized == expected_normalized, f"Chunk {i} mismatch"

    @pytest.mark.asyncio
    async def test_process_payment_denied_sse_conversion_is_accurate(self, fixture_dir: Path):
        """Converted process_payment-denied-sse fixture should match exactly."""
        # Given: Frontend baseline fixture with denial flow
        frontend_fixture = load_frontend_fixture("process_payment-denied-sse-baseline.json")

        # And: Parse rawEvents
        expected_chunks = [
            parse_raw_event_to_chunk(event)
            for event in frontend_fixture["output"]["rawEvents"]
        ]

        # And: Load converted backend fixture
        backend_fixture_path = fixture_dir / "process_payment-denied-sse-from-frontend.jsonl"
        player = ChunkPlayer.from_file(backend_fixture_path)

        # When: Play chunks
        actual_chunks_raw = []
        async for entry in player.play(mode="fast-forward"):
            actual_chunks_raw.append(entry.chunk)

        # Then: Should match exactly (14 chunks for approval flow)
        assert len(actual_chunks_raw) == 14
        assert len(actual_chunks_raw) == len(expected_chunks)
        for i, (actual, expected) in enumerate(zip(actual_chunks_raw, expected_chunks)):
            actual_normalized = normalize_ids_in_chunk(actual) if isinstance(actual, dict) else actual
            expected_normalized = normalize_ids_in_chunk(expected) if isinstance(expected, dict) else expected
            assert actual_normalized == expected_normalized


class TestAllConvertedFixtures:
    """Test all 12 converted fixtures for consistency."""

    @pytest.mark.asyncio
    async def test_all_converted_fixtures_match_frontend_baselines(self, fixture_dir: Path):
        """All 12 converted fixtures should match their frontend baselines."""
        # Given: List of all converted fixtures
        fixtures = [
            "get_weather-sse",
            "get_weather-bidi",
            "get_location-approved-sse",
            "get_location-approved-bidi",
            "get_location-denied-sse",
            "get_location-denied-bidi",
            "process_payment-approved-sse",
            "process_payment-approved-bidi",
            "process_payment-denied-sse",
            "process_payment-denied-bidi",
            "change_bgm-sse",
            "change_bgm-bidi",
        ]

        errors = []

        for fixture_name in fixtures:
            # Load frontend baseline
            frontend_fixture = load_frontend_fixture(f"{fixture_name}-baseline.json")
            expected_chunks = [
                parse_raw_event_to_chunk(event)
                for event in frontend_fixture["output"]["rawEvents"]
            ]

            # Load converted backend fixture
            backend_fixture_path = fixture_dir / f"{fixture_name}-from-frontend.jsonl"
            player = ChunkPlayer.from_file(backend_fixture_path)

            # Play chunks
            actual_chunks_raw = []
            async for entry in player.play(mode="fast-forward"):
                actual_chunks_raw.append(entry.chunk)

            # Validate
            if len(actual_chunks_raw) != len(expected_chunks):
                errors.append(
                    f"{fixture_name}: count mismatch "
                    f"(got {len(actual_chunks_raw)}, expected {len(expected_chunks)})"
                )
                continue

            # Compare chunks
            for i, (actual, expected) in enumerate(zip(actual_chunks_raw, expected_chunks)):
                actual_norm = normalize_ids_in_chunk(actual) if isinstance(actual, dict) else actual
                expected_norm = normalize_ids_in_chunk(expected) if isinstance(expected, dict) else expected

                if actual_norm != expected_norm:
                    errors.append(f"{fixture_name}: chunk {i} mismatch")
                    break

        # Then: No errors
        assert not errors, f"Fixture consistency errors:\n" + "\n".join(errors)
