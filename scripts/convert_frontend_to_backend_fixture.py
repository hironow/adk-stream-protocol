#!/usr/bin/env python3
"""
Convert frontend baseline fixtures to backend ChunkPlayer JSONL format.

This script converts frontend integration test fixtures (JSON with rawEvents)
to backend E2E test fixtures (JSONL in ChunkPlayer format).

Usage:
    uv run python scripts/convert_frontend_to_backend_fixture.py

Input:  fixtures/frontend/*.json (baseline fixtures with rawEvents)
Output: fixtures/backend/*-from-frontend.jsonl (ChunkPlayer format)
"""

import json
from datetime import UTC, datetime
from pathlib import Path


def parse_sse_event(raw_event: str) -> dict | str:
    """
    Parse SSE event string to JSON object.

    Args:
        raw_event: SSE event string like 'data: {"type": "start"}\n\n'

    Returns:
        Parsed JSON object or "[DONE]" marker

    Examples:
        >>> parse_sse_event('data: {"type": "start"}\n\n')
        {'type': 'start'}
        >>> parse_sse_event('data: [DONE]\n\n')
        '[DONE]'
    """
    if not raw_event.startswith("data: "):
        msg = f"Invalid SSE event format: {raw_event[:50]}"
        raise ValueError(msg)

    # Extract data payload: "data: {...}\n\n" -> "{...}"
    data = raw_event[6:].rstrip("\n")

    # Handle [DONE] marker
    if data == "[DONE]":
        return "[DONE]"

    # Parse JSON
    return json.loads(data)


def convert_frontend_to_backend_jsonl(
    frontend_json_path: Path,
    backend_jsonl_path: Path,
) -> int:
    """
    Convert frontend baseline JSON to backend ChunkPlayer JSONL.

    Args:
        frontend_json_path: Path to frontend fixture JSON
        backend_jsonl_path: Path to output backend fixture JSONL

    Returns:
        Number of chunks converted

    ChunkPlayer JSONL format:
        {
            "sequence_number": 1,
            "timestamp": "2025-12-25T00:00:00.000Z",
            "mode": "adk-sse",
            "direction": "response",
            "chunk": {...}
        }
    """
    # Load frontend fixture
    frontend_fixture = json.loads(frontend_json_path.read_text())

    # Skip fixtures without rawEvents (e.g., test specifications, failing cases)
    if "output" not in frontend_fixture or "rawEvents" not in frontend_fixture["output"]:
        return 0

    # Extract metadata
    mode = frontend_fixture["mode"]  # "sse" or "bidi"
    raw_events = frontend_fixture["output"]["rawEvents"]

    # Convert mode to ChunkPlayer format
    chunk_mode = f"adk-{mode}"  # "sse" -> "adk-sse", "bidi" -> "adk-bidi"

    # Generate fixed timestamp in Unix milliseconds (doesn't matter for fast-forward playback)
    timestamp_ms = int(datetime.now(UTC).timestamp() * 1000)

    # Fixed session ID for converted fixtures
    session_id = "converted-from-frontend"

    # Location: frontend-sse-event (SSE formatted events from frontend)
    location = "frontend-sse-event"

    # Direction: "out" for responses from server
    direction = "out"

    # Convert each rawEvent to ChunkPlayer entry
    entries = []
    for seq, raw_event in enumerate(raw_events, start=1):
        # Skip empty events
        if not raw_event.strip():
            continue

        # Parse SSE event
        chunk = parse_sse_event(raw_event)

        # Create ChunkPlayer entry (matches ChunkLogEntry structure)
        entry = {
            "timestamp": timestamp_ms,
            "session_id": session_id,
            "mode": chunk_mode,
            "location": location,
            "direction": direction,
            "sequence_number": seq,
            "chunk": chunk,
        }
        entries.append(entry)

    # Write JSONL (one JSON object per line)
    backend_jsonl_path.write_text(
        "\n".join(json.dumps(entry, ensure_ascii=False) for entry in entries) + "\n"
    )

    return len(entries)


def main() -> None:
    """Convert all frontend fixtures to backend JSONL format."""
    # Define paths
    repo_root = Path(__file__).parent.parent
    frontend_dir = repo_root / "fixtures" / "frontend"
    backend_dir = repo_root / "fixtures" / "backend"

    # Ensure backend directory exists
    backend_dir.mkdir(parents=True, exist_ok=True)

    # Convert all frontend JSON files
    total_chunks = 0
    converted_files = []
    skipped_files = []

    for frontend_json in sorted(frontend_dir.glob("*.json")):
        # Generate backend filename
        # get_weather-sse-baseline.json -> get_weather-sse-from-frontend.jsonl
        base_name = frontend_json.stem.replace("-baseline", "")
        backend_jsonl = backend_dir / f"{base_name}-from-frontend.jsonl"

        # Convert
        chunk_count = convert_frontend_to_backend_jsonl(frontend_json, backend_jsonl)

        if chunk_count == 0:
            skipped_files.append(frontend_json.name)
            print(f"⊘ {frontend_json.name} (skipped - no rawEvents)")
        else:
            total_chunks += chunk_count
            converted_files.append((frontend_json.name, backend_jsonl.name, chunk_count))
            print(f"✓ {frontend_json.name} -> {backend_jsonl.name} ({chunk_count} chunks)")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Converted {len(converted_files)} files ({total_chunks} total chunks)")
    if skipped_files:
        print(f"Skipped {len(skipped_files)} files (no rawEvents)")
    print(f"{'=' * 60}")
    print("\nGenerated files:")
    for _frontend_name, backend_name, chunk_count in converted_files:
        print(f"  {backend_name:50} ({chunk_count:3} chunks)")

    if skipped_files:
        print("\nSkipped files:")
        for filename in skipped_files:
            print(f"  {filename}")


if __name__ == "__main__":
    main()
