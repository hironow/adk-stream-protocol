#!/usr/bin/env python3
"""
Unified script for extracting type definitions and checking field/event coverage.

This script combines all functionality:
1. Extract ADK type definitions (Event, Part fields)
2. Extract AI SDK v6 event types (TextStreamPart, UIMessageChunk)
3. Check ADK field coverage in stream_protocol.py
4. Check AI SDK event coverage in stream_protocol.py and websocket-chat-transport.ts

Usage:
    # Coverage check (default)
    uv run python scripts/check-coverage.py
    uv run python scripts/check-coverage.py --verbose

    # Extract type definitions only
    uv run python scripts/check-coverage.py --extract-only adk
    uv run python scripts/check-coverage.py --extract-only ai-sdk
    uv run python scripts/check-coverage.py --extract-only all

    # Output formats
    uv run python scripts/check-coverage.py --extract-only adk --format json
    uv run python scripts/check-coverage.py --extract-only adk --format markdown
"""

from __future__ import annotations

import argparse
import inspect
import json
import re
from pathlib import Path
from typing import Any, get_args, get_origin

from google.adk.events import Event
from google.adk.events.event_actions import EventActions
from google.genai import types


# =============================================================================
# Utilities
# =============================================================================


def get_type_name(annotation: Any) -> str:
    """Convert type annotation to readable string."""
    if annotation is type(None):
        return "None"

    origin = get_origin(annotation)
    if origin is type(None):
        return "None"

    if origin is not None:
        args = get_args(annotation)
        if origin is type(None):
            return "None"
        if hasattr(origin, "__name__") and origin.__name__ == "UnionType":
            arg_names = [get_type_name(arg) for arg in args]
            return " | ".join(arg_names)
        origin_name = getattr(origin, "__name__", str(origin))
        if args:
            arg_names = [get_type_name(arg) for arg in args]
            return f"{origin_name}[{', '.join(arg_names)}]"
        return origin_name

    if hasattr(annotation, "__name__"):
        return annotation.__name__
    return str(annotation)


def snake_to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase."""
    components = snake_str.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


# =============================================================================
# Extractors
# =============================================================================


class ADKExtractor:
    """Extract ADK type definitions from Python SDK."""

    @staticmethod
    def extract_fields(cls: type) -> dict[str, dict[str, Any]]:
        """Extract all fields from a dataclass or similar type."""
        sig = inspect.signature(cls)
        fields = {}
        for param_name, param in sig.parameters.items():
            field_info = {
                "type": get_type_name(param.annotation),
                "has_default": param.default != inspect.Parameter.empty,
            }
            if param.default != inspect.Parameter.empty:
                default_val = param.default
                field_info["default"] = (
                    str(default_val) if default_val is not None else "None"
                )
            fields[param_name] = field_info
        return fields

    @staticmethod
    def extract_finish_reasons() -> list[str]:
        """Extract all FinishReason enum values from ADK."""
        return [
            attr
            for attr in dir(types.FinishReason)
            if attr.isupper() and not attr.startswith("_")
        ]

    def extract_all(self) -> dict[str, Any]:
        """Extract all ADK type definitions."""
        return {
            "Event": self.extract_fields(Event),
            "EventActions": self.extract_fields(EventActions),
            "Content": self.extract_fields(types.Content),
            "Part": self.extract_fields(types.Part),
            "FinishReason": self.extract_finish_reasons(),
        }

    def get_field_names(self) -> dict[str, set[str]]:
        """Get all field names (for coverage checking)."""
        event_sig = inspect.signature(Event)
        part_sig = inspect.signature(types.Part)
        return {
            "event": set(event_sig.parameters.keys()),
            "part": set(part_sig.parameters.keys()),
        }

    def get_finish_reasons(self) -> set[str]:
        """Get all FinishReason enum values (for coverage checking)."""
        return set(self.extract_finish_reasons())


class AISdkExtractor:
    """Extract AI SDK v6 event types from TypeScript definitions."""

    def __init__(self, ai_sdk_path: Path | None = None):
        self.ai_sdk_path = ai_sdk_path or Path("node_modules/ai/dist/index.d.ts")

    def extract_all(self) -> dict[str, list[dict[str, str]]]:
        """Extract AI SDK v6 event types from type definitions."""
        if not self.ai_sdk_path.exists():
            raise FileNotFoundError(f"AI SDK types not found: {self.ai_sdk_path}")

        content = self.ai_sdk_path.read_text()

        # Extract TextStreamPart (backend)
        text_stream_part_match = re.search(
            r"type TextStreamPart<TOOLS extends ToolSet> = \{[\s\S]*?\};", content
        )

        # Extract UIMessageChunk (frontend)
        ui_message_chunk_match = re.search(
            r"type UIMessageChunk<METADATA[^>]*> = \{[\s\S]*?\};", content
        )

        if not text_stream_part_match:
            raise ValueError("TextStreamPart type definition not found")

        if not ui_message_chunk_match:
            raise ValueError("UIMessageChunk type definition not found")

        backend_types = self._extract_types_from_union(
            text_stream_part_match.group(0), "TextStreamPart"
        )
        frontend_types = self._extract_types_from_union(
            ui_message_chunk_match.group(0), "UIMessageChunk"
        )

        return {"backend": backend_types, "frontend": frontend_types}

    @staticmethod
    def _extract_types_from_union(union_def: str, source: str) -> list[dict[str, str]]:
        """Extract event types from TypeScript union type definition."""
        event_type_pattern = r"type:\s*['\"]([^'\"]+)['\"]"
        matches = re.finditer(event_type_pattern, union_def)

        event_types = []
        seen = set()
        for match in matches:
            event_type = match.group(1)
            if event_type not in seen:
                seen.add(event_type)
                event_types.append({"type": event_type, "source": source})

        return sorted(event_types, key=lambda x: x["type"])

    def get_all_event_types(self) -> set[str]:
        """Get all event type names (for coverage checking)."""
        types_data = self.extract_all()
        all_types = set()
        for event in types_data["backend"]:
            all_types.add(event["type"])
        for event in types_data["frontend"]:
            all_types.add(event["type"])
        return all_types

    def extract_finish_reasons(self) -> set[str]:
        """Extract AI SDK v6 FinishReason string literal types."""
        if not self.ai_sdk_path.exists():
            return set()

        content = self.ai_sdk_path.read_text()

        # Search for FinishReason documentation comment
        # Expected format: - `stop`: ...
        #                  - `length`: ...
        #                  - `content-filter`: ...
        finish_reason_pattern = r"-\s+`(stop|length|content-filter|tool-calls|error|other)`:\s+"
        matches = re.finditer(finish_reason_pattern, content)

        finish_reasons = set()
        for match in matches:
            finish_reasons.add(match.group(1))

        # If not found in docs, use known AI SDK v6 values
        if not finish_reasons:
            finish_reasons = {
                "stop",
                "length",
                "content-filter",
                "tool-calls",
                "error",
                "other",
            }

        return finish_reasons


# =============================================================================
# Analyzers
# =============================================================================


class ADKAnalyzer:
    """Analyze ADK field usage in actual implementation code."""

    def __init__(self, stream_protocol_path: Path | None = None):
        self.stream_protocol_path = stream_protocol_path or (
            Path(__file__).parent.parent / "stream_protocol.py"
        )

    def analyze(self) -> dict[str, set[str]]:
        """Analyze stream_protocol.py to find which ADK fields are actually used."""
        content = self.stream_protocol_path.read_text()

        event_fields = set()
        part_fields = set()

        # Pattern 1: hasattr(event, "field_name")
        event_hasattr_pattern = r'hasattr\(\s*event\s*,\s*["\'](\w+)["\']\s*\)'
        for match in re.finditer(event_hasattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
                event_fields.add(field_name)

        # Pattern 2: event.field_name (direct access)
        event_access_pattern = r"\bevent\.(\w+)\b"
        for match in re.finditer(event_access_pattern, content):
            field_name = match.group(1)
            if not field_name.startswith("_") and field_name not in ("content",):
                event_fields.add(field_name)

        # Pattern 3: hasattr(part, "field_name")
        part_hasattr_pattern = r'hasattr\(\s*part\s*,\s*["\'](\w+)["\']\s*\)'
        for match in re.finditer(part_hasattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
                part_fields.add(field_name)

        # Pattern 4: part.field_name (direct access)
        part_access_pattern = r"\bpart\.(\w+)\b"
        for match in re.finditer(part_access_pattern, content):
            field_name = match.group(1)
            if not field_name.startswith("_"):
                part_fields.add(field_name)

        # Add content field explicitly (main entry point)
        event_fields.add("content")

        # Convert snake_case to camelCase to match ADK type definitions
        event_fields_normalized = {snake_to_camel(f) for f in event_fields}
        part_fields_normalized = {snake_to_camel(f) for f in part_fields}

        return {
            "event": event_fields_normalized,
            "part": part_fields_normalized,
        }

    def analyze_finish_reasons(self) -> dict[str, str]:
        """
        Analyze stream_protocol.py to extract reason_map.

        Returns:
            dict mapping ADK FinishReason name to AI SDK v6 finish reason string
        """
        content = self.stream_protocol_path.read_text()

        # Find reason_map definition (Enum-based pattern)
        # Pattern: types.FinishReason.REASON_NAME: AISdkFinishReason.VALUE,
        reason_map = {}
        reason_map_pattern = r"types\.FinishReason\.([A-Z_]+):\s*AISdkFinishReason\.([A-Z_]+)"
        for match in re.finditer(reason_map_pattern, content):
            adk_reason = match.group(1)  # e.g., "STOP", "MAX_TOKENS"
            ai_sdk_enum = match.group(2)  # e.g., "STOP", "LENGTH"

            # Convert AISdkFinishReason enum name to value
            # STOP -> "stop", LENGTH -> "length", CONTENT_FILTER -> "content-filter"
            ai_sdk_value = ai_sdk_enum.lower().replace("_", "-")
            reason_map[adk_reason] = ai_sdk_value

        return reason_map


class AISdkAnalyzer:
    """Analyze AI SDK event usage in actual implementation code."""

    def __init__(
        self,
        stream_protocol_path: Path | None = None,
        websocket_transport_path: Path | None = None,
    ):
        self.stream_protocol_path = stream_protocol_path or (
            Path(__file__).parent.parent / "stream_protocol.py"
        )
        self.websocket_transport_path = websocket_transport_path or (
            Path(__file__).parent.parent / "lib" / "websocket-chat-transport.ts"
        )

    def analyze_backend(self) -> set[str]:
        """Analyze stream_protocol.py to find which AI SDK events are generated."""
        content = self.stream_protocol_path.read_text()

        event_types = set()

        # Pattern 1: _format_sse_event({'type': 'event-type', ...})
        format_sse_pattern = r"\btype[\"']?\s*:\s*[\"']([^\"']+)[\"']"
        for match in re.finditer(format_sse_pattern, content):
            event_types.add(match.group(1))

        # Pattern 2: Explicit event type strings
        explicit_pattern = r"[\"']((?:text|tool|code|data|thought|start|finish|error|message)-[a-z-]+)[\"']"
        for match in re.finditer(explicit_pattern, content):
            event_type = match.group(1)
            if (
                "_" not in event_type  # snake_case variables
                and "/" not in event_type  # paths
                and len(event_type) < 30  # too long to be event type
            ):
                event_types.add(event_type)

        return event_types

    def analyze_frontend(self) -> set[str]:
        """Analyze websocket-chat-transport.ts to find which events are handled."""
        content = self.websocket_transport_path.read_text()

        event_types = set()

        # Pattern 1: chunk.type === "event-type"
        chunk_type_pattern = r'chunk\.type\s*===\s*["\']([^"\']+)["\']'
        for match in re.finditer(chunk_type_pattern, content):
            event_types.add(match.group(1))

        # Pattern 2: case "event-type":
        case_pattern = r'case\s+["\']([^"\']+)["\']:'
        for match in re.finditer(case_pattern, content):
            event_types.add(match.group(1))

        # Pattern 3: type: "event-type" in object literals
        type_field_pattern = r'type:\s*["\']([a-z-]+)["\']'
        for match in re.finditer(type_field_pattern, content):
            event_types.add(match.group(1))

        return event_types


# =============================================================================
# Reporter
# =============================================================================


class Reporter:
    """Format and print reports."""

    @staticmethod
    def format_adk_markdown(data: dict[str, Any]) -> str:
        """Format ADK types as markdown."""
        lines = [
            "# ADK Type Definitions",
            "",
            "**Source**: Google ADK Python SDK",
            "",
        ]

        for type_name, fields in data.items():
            lines.append(f"## {type_name}")
            lines.append("")
            lines.append(f"**Total Fields**: {len(fields)}")
            lines.append("")
            lines.append("| Field Name | Type | Has Default |")
            lines.append("|------------|------|-------------|")

            for field_name, field_info in sorted(fields.items()):
                has_default = "✅" if field_info["has_default"] else "❌"
                lines.append(
                    f"| `{field_name}` | `{field_info['type']}` | {has_default} |"
                )

            lines.append("")

        return "\n".join(lines)

    @staticmethod
    def format_ai_sdk_markdown(data: dict[str, list[dict[str, str]]]) -> str:
        """Format AI SDK types as markdown."""
        lines = [
            "# AI SDK v6 Event Types",
            "",
            "**Source**: Vercel AI SDK (`node_modules/ai/dist/index.d.ts`)",
            "",
        ]

        lines.append("## Backend Events (TextStreamPart)")
        lines.append("")
        lines.append(f"**Total**: {len(data['backend'])} event types")
        lines.append("")
        lines.append("| Event Type |")
        lines.append("|------------|")
        for event in data["backend"]:
            lines.append(f"| `{event['type']}` |")
        lines.append("")

        lines.append("## Frontend Events (UIMessageChunk)")
        lines.append("")
        lines.append(f"**Total**: {len(data['frontend'])} event types")
        lines.append("")
        lines.append("| Event Type |")
        lines.append("|------------|")
        for event in data["frontend"]:
            lines.append(f"| `{event['type']}` |")
        lines.append("")

        return "\n".join(lines)

    @staticmethod
    def print_adk_coverage(
        implemented: dict[str, set[str]],
        all_fields: dict[str, set[str]],
        verbose: bool,
    ) -> None:
        """Print ADK field coverage report."""
        print("# ADK Field Coverage Report")
        print()
        print("**Analyzed**: `stream_protocol.py` (actual implementation)")
        print()

        # Event fields
        event_impl = implemented["event"]
        event_all = all_fields["event"]
        event_coverage = len(event_impl & event_all) / len(event_all) * 100

        print("## Event Field Coverage")
        print()
        print(
            f"**Coverage**: {len(event_impl & event_all)}/{len(event_all)} "
            f"({event_coverage:.1f}%)"
        )
        print()

        if verbose:
            print("### Implemented Event Fields")
            print()
            for field in sorted(event_impl & event_all):
                print(f"- ✅ `{field}`")
            print()

        print("### Missing Event Fields")
        print()
        missing_event = event_all - event_impl
        for field in sorted(missing_event):
            print(f"- ❌ `{field}`")
        print()

        # Part fields
        part_impl = implemented["part"]
        part_all = all_fields["part"]
        part_coverage = len(part_impl & part_all) / len(part_all) * 100

        print("## Part Field Coverage")
        print()
        print(
            f"**Coverage**: {len(part_impl & part_all)}/{len(part_all)} "
            f"({part_coverage:.1f}%)"
        )
        print()

        if verbose:
            print("### Implemented Part Fields")
            print()
            for field in sorted(part_impl & part_all):
                print(f"- ✅ `{field}`")
            print()

        print("### Missing Part Fields")
        print()
        missing_part = part_all - part_impl
        for field in sorted(missing_part):
            print(f"- ❌ `{field}`")
        print()

        # Summary
        total_impl = len(event_impl & event_all) + len(part_impl & part_all)
        total_all = len(event_all) + len(part_all)
        total_coverage = total_impl / total_all * 100

        print("## Summary")
        print()
        print(f"**Total Coverage**: {total_impl}/{total_all} ({total_coverage:.1f}%)")
        print()

    @staticmethod
    def print_ai_sdk_coverage(
        generated: set[str], consumed: set[str], all_types: set[str], verbose: bool
    ) -> None:
        """Print AI SDK event coverage report."""
        print("# AI SDK v6 Event Coverage Report")
        print()
        print("**Analyzed**:")
        print("- Backend: `stream_protocol.py` (event generation)")
        print("- Frontend: `lib/websocket-chat-transport.ts` (event handling)")
        print()

        # Backend coverage
        generated_coverage = len(generated) / len(all_types) * 100
        print("## Backend Event Generation")
        print()
        print(
            f"**Coverage**: {len(generated)}/{len(all_types)} ({generated_coverage:.1f}%)"
        )
        print()

        if verbose:
            print("### Generated Event Types")
            print()
            for event_type in sorted(generated):
                print(f"- ✅ `{event_type}`")
            print()

        not_generated = all_types - generated
        if not_generated:
            print("### Not Generated by Backend")
            print()
            for event_type in sorted(not_generated):
                print(f"- ❌ `{event_type}`")
            print()

        # Frontend coverage
        consumed_coverage = len(consumed) / len(all_types) * 100
        print("## Frontend Event Handling")
        print()
        print(
            f"**Coverage**: {len(consumed)}/{len(all_types)} ({consumed_coverage:.1f}%)"
        )
        print()

        if verbose:
            print("### Handled Event Types")
            print()
            for event_type in sorted(consumed):
                print(f"- ✅ `{event_type}`")
            print()

        not_consumed = all_types - consumed
        if not_consumed:
            print("### Not Handled by Frontend")
            print()
            for event_type in sorted(not_consumed):
                print(f"- ❌ `{event_type}`")
            print()

        # Cross-check
        generated_not_consumed = generated - consumed
        if generated_not_consumed:
            print("## ⚠️ Generated but Not Explicitly Consumed")
            print()
            print("These events are generated by backend but not explicitly handled:")
            print()
            for event_type in sorted(generated_not_consumed):
                print(f"- `{event_type}`")
            print()

        consumed_not_in_spec = consumed - all_types
        if consumed_not_in_spec:
            print("## ⚠️ Consumed but Not in AI SDK Spec")
            print()
            print("These events are handled but not defined in AI SDK types:")
            print()
            for event_type in sorted(consumed_not_in_spec):
                print(f"- `{event_type}` (custom extension)")
            print()

        # Summary
        print("## Summary")
        print()
        print(f"- **Backend generates**: {len(generated)} event types")
        print(f"- **Frontend handles**: {len(consumed)} event types")
        print(f"- **AI SDK defines**: {len(all_types)} event types")
        print()

    @staticmethod
    def print_finish_reason_coverage(
        adk_reasons: set[str],
        reason_map: dict[str, str],
        ai_sdk_reasons: set[str],
        verbose: bool,
    ) -> None:
        """Print FinishReason coverage report."""
        print("# FinishReason Mapping Coverage Report")
        print()
        print("**Analyzed**:")
        print("- ADK: `types.FinishReason` enum (source)")
        print("- Implementation: `stream_protocol.py` reason_map (mapping)")
        print("- AI SDK v6: FinishReason type (target)")
        print()

        # ADK FinishReason coverage
        mapped_adk_reasons = set(reason_map.keys())
        missing_adk_reasons = adk_reasons - mapped_adk_reasons
        adk_coverage = len(mapped_adk_reasons) / len(adk_reasons) * 100

        print("## ADK FinishReason Coverage")
        print()
        print(
            f"**Coverage**: {len(mapped_adk_reasons)}/{len(adk_reasons)} "
            f"({adk_coverage:.1f}%)"
        )
        print()

        if verbose:
            print("### Mapped ADK FinishReasons")
            print()
            for reason in sorted(mapped_adk_reasons):
                ai_sdk_value = reason_map[reason]
                print(f"- ✅ `{reason}` → `{ai_sdk_value}`")
            print()

        if missing_adk_reasons:
            print("### Missing ADK FinishReasons")
            print()
            for reason in sorted(missing_adk_reasons):
                print(f"- ❌ `{reason}` (not in reason_map)")
            print()

        # AI SDK v6 target values validation
        mapped_ai_sdk_values = set(reason_map.values())
        unmapped_ai_sdk_reasons = ai_sdk_reasons - mapped_ai_sdk_values

        if unmapped_ai_sdk_reasons:
            print("## ⚠️ AI SDK FinishReasons Not Produced")
            print()
            print(
                "These AI SDK finish reasons are defined but not produced by mapping:"
            )
            print()
            for reason in sorted(unmapped_ai_sdk_reasons):
                print(f"- `{reason}`")
            print()

        # Unknown values check
        unknown_values = mapped_ai_sdk_values - ai_sdk_reasons
        if unknown_values:
            print("## ⚠️ Unknown Target Values in Mapping")
            print()
            print(
                "These values are in reason_map but not defined in AI SDK FinishReason:"
            )
            print()
            for value in sorted(unknown_values):
                adk_sources = [k for k, v in reason_map.items() if v == value]
                print(f"- `{value}` ← {', '.join(sorted(adk_sources))}")
            print()

        # Summary
        print("## Summary")
        print()
        print(f"- **ADK FinishReason values**: {len(adk_reasons)}")
        print(f"- **Mapped in reason_map**: {len(mapped_adk_reasons)}")
        print(f"- **AI SDK target values**: {len(ai_sdk_reasons)}")
        print(f"- **Unique mapped values**: {len(mapped_ai_sdk_values)}")
        print()


# =============================================================================
# Main Orchestrator
# =============================================================================


class CoverageChecker:
    """Main orchestrator for coverage checking."""

    def __init__(self):
        self.adk_extractor = ADKExtractor()
        self.ai_sdk_extractor = AISdkExtractor()
        self.adk_analyzer = ADKAnalyzer()
        self.ai_sdk_analyzer = AISdkAnalyzer()
        self.reporter = Reporter()

    def run_extraction(self, target: str, output_format: str) -> None:
        """Run extraction mode."""
        if target in ("adk", "all"):
            adk_data = self.adk_extractor.extract_all()
            if output_format == "json":
                print(json.dumps(adk_data, indent=2))
            else:
                print(self.reporter.format_adk_markdown(adk_data))

        if target in ("ai-sdk", "all"):
            if target == "all":
                print("\n---\n")
            ai_sdk_data = self.ai_sdk_extractor.extract_all()
            if output_format == "json":
                print(json.dumps(ai_sdk_data, indent=2))
            else:
                print(self.reporter.format_ai_sdk_markdown(ai_sdk_data))

    def run_coverage_check(self, verbose: bool) -> None:
        """Run coverage check mode."""
        print("=" * 80)

        # ADK coverage
        implemented_adk = self.adk_analyzer.analyze()
        all_adk = self.adk_extractor.get_field_names()
        self.reporter.print_adk_coverage(implemented_adk, all_adk, verbose)

        print("=" * 80)
        print()

        # AI SDK coverage
        generated = self.ai_sdk_analyzer.analyze_backend()
        consumed = self.ai_sdk_analyzer.analyze_frontend()
        all_ai_sdk = self.ai_sdk_extractor.get_all_event_types()
        self.reporter.print_ai_sdk_coverage(generated, consumed, all_ai_sdk, verbose)

        print("=" * 80)
        print()

        # FinishReason coverage
        adk_reasons = self.adk_extractor.get_finish_reasons()
        reason_map = self.adk_analyzer.analyze_finish_reasons()
        ai_sdk_reasons = self.ai_sdk_extractor.extract_finish_reasons()
        self.reporter.print_finish_reason_coverage(
            adk_reasons, reason_map, ai_sdk_reasons, verbose
        )


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Extract type definitions and check coverage"
    )
    parser.add_argument(
        "--extract-only",
        choices=["adk", "ai-sdk", "all"],
        help="Extract type definitions only (no coverage check)",
    )
    parser.add_argument(
        "--format",
        choices=["markdown", "json"],
        default="markdown",
        help="Output format for extraction (default: markdown)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show implemented fields in addition to missing fields",
    )
    args = parser.parse_args()

    checker = CoverageChecker()

    if args.extract_only:
        checker.run_extraction(args.extract_only, args.format)
    else:
        checker.run_coverage_check(args.verbose)


if __name__ == "__main__":
    main()
