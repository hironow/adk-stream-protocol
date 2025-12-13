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
import sys
from pathlib import Path
from typing import Any, get_args, get_origin

import yaml  # type: ignore[import-untyped]
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
                field_info["default"] = str(default_val) if default_val is not None else "None"
            fields[param_name] = field_info
        return fields

    @staticmethod
    def extract_finish_reasons() -> list[str]:
        """Extract all FinishReason enum values from ADK."""
        return [
            attr for attr in dir(types.FinishReason) if attr.isupper() and not attr.startswith("_")
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
# Config Loader
# =============================================================================


class ConfigLoader:
    """Load and parse field_coverage_config.yaml."""

    def __init__(self, config_path: Path | None = None):
        self.config_path = config_path or (Path(__file__).parent / "field_coverage_config.yaml")

    def load(self) -> dict[str, Any]:
        """Load configuration from YAML file."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        with open(self.config_path) as f:
            return yaml.safe_load(f)

    def get_field_config(self, field_type: str) -> dict[str, dict[str, Any]]:
        """
        Get field configuration for event or part fields.

        Args:
            field_type: "event" or "part"

        Returns:
            dict mapping field name to config (status, priority, location, etc.)
        """
        config = self.load()
        key = f"{field_type}_fields"
        return config.get(key, {})

    def get_expected_implemented(self, field_type: str) -> set[str]:
        """Get set of field names that should be implemented (status=IMPLEMENTED)."""
        fields = self.get_field_config(field_type)
        return {name for name, cfg in fields.items() if cfg.get("status") == "IMPLEMENTED"}

    def get_expected_deferred(self, field_type: str) -> set[str]:
        """Get set of field names that are deferred (status=DEFERRED)."""
        fields = self.get_field_config(field_type)
        return {name for name, cfg in fields.items() if cfg.get("status") == "DEFERRED"}

    def get_expected_documented(self, field_type: str) -> set[str]:
        """Get set of field names that are documented but not implemented."""
        fields = self.get_field_config(field_type)
        return {name for name, cfg in fields.items() if cfg.get("status") == "DOCUMENTED"}

    def get_expected_not_started(self, field_type: str) -> set[str]:
        """Get set of field names that are planned but not yet started."""
        fields = self.get_field_config(field_type)
        return {name for name, cfg in fields.items() if cfg.get("status") == "NOT_STARTED"}


# =============================================================================
# Analyzers
# =============================================================================


class ADKAnalyzer:
    """Analyze ADK field usage in actual implementation code."""

    def __init__(self, file_paths: list[Path] | None = None):
        """
        Initialize analyzer with files to analyze.

        Args:
            file_paths: List of Python files to analyze for ADK field usage.
                       Defaults to [stream_protocol.py, server.py]

        Note:
            ai_sdk_v6_compat.py is excluded because it performs reverse conversion
            (AI SDK v6 → ADK), reading AI SDK Part fields, not ADK fields.
        """
        if file_paths is None:
            base_dir = Path(__file__).parent.parent
            self.file_paths = [
                base_dir / "stream_protocol.py",
                base_dir / "server.py",
            ]
        else:
            self.file_paths = file_paths

    def analyze(self) -> dict[str, set[str]]:
        """Analyze Python files to find which ADK fields are actually used."""
        # Combine content from all files
        content = ""
        for file_path in self.file_paths:
            if file_path.exists():
                content += f"\n# === {file_path.name} ===\n"
                content += file_path.read_text()
            else:
                print(f"Warning: File not found, skipping: {file_path}")

        if not content:
            raise FileNotFoundError(f"No valid files found in: {self.file_paths}")

        event_fields = set()
        part_fields = set()

        # Pattern 1: hasattr(event, "field_name")
        event_hasattr_pattern = r'hasattr\(\s*event\s*,\s*["\'](\w+)["\']\s*\)'
        for match in re.finditer(event_hasattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
                event_fields.add(field_name)

        # Pattern 2: event.field_name (direct access, excluding method calls)
        # Negative lookahead (?!\s*\() excludes method calls like event.get() or event.is_final_response()
        event_access_pattern = r"\bevent\.(\w+)\b(?!\s*\()"
        for match in re.finditer(event_access_pattern, content):
            field_name = match.group(1)
            if not field_name.startswith("_") and field_name not in ("content",):
                event_fields.add(field_name)

        # Pattern 2b: getattr(event, "field_name")
        event_getattr_pattern = r'getattr\(\s*event\s*,\s*["\'](\w+)["\']\s*[,)]'
        for match in re.finditer(event_getattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
                event_fields.add(field_name)

        # Pattern 3: hasattr(part, "field_name")
        part_hasattr_pattern = r'hasattr\(\s*part\s*,\s*["\'](\w+)["\']\s*\)'
        for match in re.finditer(part_hasattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
                part_fields.add(field_name)

        # Pattern 4: part.field_name (direct access, excluding method calls)
        # Negative lookahead (?!\s*\() excludes method calls
        part_access_pattern = r"\bpart\.(\w+)\b(?!\s*\()"
        for match in re.finditer(part_access_pattern, content):
            field_name = match.group(1)
            if not field_name.startswith("_"):
                part_fields.add(field_name)

        # Pattern 4b: getattr(part, "field_name")
        part_getattr_pattern = r'getattr\(\s*part\s*,\s*["\'](\w+)["\']\s*[,)]'
        for match in re.finditer(part_getattr_pattern, content):
            field_name = match.group(1)
            if field_name != "__dict__":
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
        # Find stream_protocol.py in file_paths
        stream_protocol_path = None
        for path in self.file_paths:
            if path.name == "stream_protocol.py":
                stream_protocol_path = path
                break

        if not stream_protocol_path or not stream_protocol_path.exists():
            raise FileNotFoundError("stream_protocol.py not found in analyzed files")

        content = stream_protocol_path.read_text()

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
        explicit_pattern = (
            r"[\"']((?:text|tool|code|data|thought|start|finish|error|message)-[a-z-]+)[\"']"
        )
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
        """
        Analyze websocket-chat-transport.ts to find which events are explicitly handled.

        Note: WebSocketChatTransport is a thin wrapper that delegates most standard
        AI SDK v6 events to useChat. Only custom events and special-case handling
        (like data-pcm, finish metadata logging) are explicitly checked.
        """
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
# Config Validator
# =============================================================================


class ConfigValidator:
    """Validate field_coverage_config.yaml against actual implementation."""

    def __init__(
        self,
        config_loader: ConfigLoader,
        adk_analyzer: ADKAnalyzer,
        adk_extractor: ADKExtractor,
    ):
        self.config = config_loader
        self.analyzer = adk_analyzer
        self.extractor = adk_extractor

    def validate(self) -> dict[str, Any]:
        """
        Validate configuration against actual implementation.

        Returns:
            dict with validation results and warnings
        """
        results = {
            "event_fields": self._validate_field_type("event"),
            "part_fields": self._validate_field_type("part"),
        }
        return results

    def _validate_field_type(self, field_type: str) -> dict[str, Any]:
        """Validate a specific field type (event or part)."""
        # Get expected state from config
        expected_implemented = self.config.get_expected_implemented(field_type)
        expected_deferred = self.config.get_expected_deferred(field_type)
        expected_documented = self.config.get_expected_documented(field_type)
        expected_not_started = self.config.get_expected_not_started(field_type)
        all_configured = (
            expected_implemented | expected_deferred | expected_documented | expected_not_started
        )

        # Get actual state from code
        actual_implemented = self.analyzer.analyze()[field_type]

        # Get all available fields from ADK
        all_adk_fields = self.extractor.get_field_names()[field_type]

        # Validation checks
        warnings = []
        errors = []

        # Check 1: Fields marked IMPLEMENTED should actually be in code
        not_actually_implemented = expected_implemented - actual_implemented
        if not_actually_implemented:
            errors.append(
                {
                    "type": "CLAIMED_BUT_NOT_IMPLEMENTED",
                    "fields": sorted(not_actually_implemented),
                    "message": "Fields marked IMPLEMENTED in config but not found in code",
                }
            )

        # Check 2: Fields in code should be in config
        not_in_config = actual_implemented - all_configured
        if not_in_config:
            warnings.append(
                {
                    "type": "IMPLEMENTED_BUT_NOT_CONFIGURED",
                    "fields": sorted(not_in_config),
                    "message": "Fields found in code but not in config file",
                }
            )

        # Check 3: ADK fields not in config at all
        not_tracked = all_adk_fields - all_configured
        if not_tracked:
            warnings.append(
                {
                    "type": "ADK_FIELD_NOT_TRACKED",
                    "fields": sorted(not_tracked),
                    "message": "ADK fields exist but not tracked in config",
                }
            )

        # Check 4: Config references non-existent ADK fields
        invalid_fields = all_configured - all_adk_fields
        if invalid_fields:
            errors.append(
                {
                    "type": "INVALID_FIELD_IN_CONFIG",
                    "fields": sorted(invalid_fields),
                    "message": "Config references fields that don't exist in ADK SDK",
                }
            )

        return {
            "expected_implemented": sorted(expected_implemented),
            "actual_implemented": sorted(actual_implemented),
            "correctly_implemented": sorted(expected_implemented & actual_implemented),
            "warnings": warnings,
            "errors": errors,
        }


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
                lines.append(f"| `{field_name}` | `{field_info['type']}` | {has_default} |")

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
        analyzed_files: list[str] | None = None,
    ) -> None:
        """Print ADK field coverage report."""
        print("# 🔍 ADK Field Coverage Report (CODE-BASED ANALYSIS)")
        print()
        print("**Data Source**: Direct code analysis")
        if analyzed_files:
            print("**Analysis Targets**:")
            for file in analyzed_files:
                print(f"  - `{file}`")
        else:
            print("**Analysis Target**: `stream_protocol.py` (ADK → AI SDK v6 protocol conversion)")
        print("**Method**: Pattern matching for Event/Part field access")
        print("**Purpose**: Detect which ADK fields are actually used in implementation")
        print()
        print("**Note**: This shows what the code analyzer detected. For field status")
        print("tracking (IMPLEMENTED/DEFERRED/etc.), use `--use-config` mode.")
        print()
        print("**Analysis Patterns**:")
        print("  - `hasattr(event, 'field_name')`")
        print("  - `event.field_name`")
        print("  - `getattr(event, 'field_name')`")
        print()

        # Event fields
        event_impl = implemented["event"]
        event_all = all_fields["event"]
        event_coverage = len(event_impl & event_all) / len(event_all) * 100

        print("## Event Field Coverage")
        print()
        print(
            f"**Coverage**: {len(event_impl & event_all)}/{len(event_all)} ({event_coverage:.1f}%)"
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
        print(f"**Coverage**: {len(part_impl & part_all)}/{len(part_all)} ({part_coverage:.1f}%)")
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
        print("# 🔄 AI SDK v6 Event Coverage Report (CODE-BASED ANALYSIS)")
        print()
        print("**Data Source**: Direct code analysis")
        print("**Backend Target**: `stream_protocol.py` (generates events from ADK)")
        print(
            "**Frontend Target**: `lib/websocket-chat-transport.ts` (receives events via WebSocket)"
        )
        print(
            "**Purpose**: Verify backend generates and frontend consumes AI SDK v6 events correctly"
        )
        print()
        print("**Backend Analysis Patterns**:")
        print("  - `_format_sse_event({'type': 'event-type'})`")
        print("  - Event type strings in code")
        print()
        print("**Frontend Analysis Patterns**:")
        print("  - `chunk.type === 'event-type'`")
        print("  - `case 'event-type':`")
        print()
        print("**Architecture Note**: WebSocketChatTransport is a thin wrapper that delegates")
        print("standard AI SDK v6 events (text-*, tool-*, etc.) to `useChat` for processing.")
        print("Only custom events and special cases are explicitly checked in the transport layer.")
        print()

        # Backend coverage
        generated_coverage = len(generated) / len(all_types) * 100
        print("## Backend Event Generation")
        print()
        print(f"**Coverage**: {len(generated)}/{len(all_types)} ({generated_coverage:.1f}%)")
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
        print("## Frontend Event Handling (Explicit)")
        print()
        print(f"**Explicit Handling**: {len(consumed)}/{len(all_types)} ({consumed_coverage:.1f}%)")
        print()
        print(
            "**Note**: WebSocketChatTransport is a thin wrapper. Most standard AI SDK v6 events "
            "(text-*, tool-*, etc.) are delegated to `useChat` and handled implicitly. "
            "Only custom events and special cases are explicitly checked."
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
            print("## ✅ Generated and Delegated to useChat")
            print()
            print(
                "These events are generated by backend and delegated to `useChat` "
                "(not explicitly checked in WebSocketChatTransport):"
            )
            print()
            for event_type in sorted(generated_not_consumed):
                print(f"- `{event_type}`")
            print()

        consumed_not_in_spec = consumed - all_types
        if consumed_not_in_spec:
            print("## 🔧 Custom Event Extensions")
            print()
            print(
                "These events are custom extensions not defined in AI SDK v6 spec "
                "(explicitly handled for project-specific functionality):"
            )
            print()
            for event_type in sorted(consumed_not_in_spec):
                print(f"- `{event_type}`")
            print()

        # Summary
        print("## Summary")
        print()
        print(f"- **Backend generates**: {len(generated)} event types")
        print(
            f"- **Frontend explicitly handles**: {len(consumed)} event types (custom events + special cases)"
        )
        print(
            f"- **Frontend delegates to useChat**: {len(generated_not_consumed)} event types (standard AI SDK events)"
        )
        print(f"- **AI SDK defines**: {len(all_types)} event types")
        print()

    @staticmethod
    def print_config_validation(results: dict[str, Any]) -> None:
        """Print configuration validation results."""
        print("# ✓ Configuration Validation Report (CONFIG vs CODE)")
        print()
        print("**Purpose**: Verify config file matches actual implementation")
        print("**Config File**: `scripts/field_coverage_config.yaml`")
        print("**Code Analysis**: Pattern matching in `stream_protocol.py`")
        print()
        print("**Validation Checks**:")
        print("  1. Fields marked IMPLEMENTED in config exist in code")
        print("  2. Fields found in code are tracked in config")
        print("  3. No invalid field references in config")
        print()

        has_errors = False
        has_warnings = False

        for field_type, validation in results.items():
            title = "Event Fields" if field_type == "event_fields" else "Part Fields"
            print(f"## {title}")
            print()

            # Show correctly implemented
            correctly_impl = validation["correctly_implemented"]
            expected_impl = validation["expected_implemented"]

            print(
                f"**Status**: {len(correctly_impl)}/{len(expected_impl)} expected fields correctly implemented"
            )
            print()

            # Show errors
            errors = validation.get("errors", [])
            if errors:
                has_errors = True
                print("### ❌ ERRORS")
                print()
                for error in errors:
                    print(f"**{error['type']}**: {error['message']}")
                    for field in error["fields"]:
                        print(f"  - `{field}`")
                    print()

            # Show warnings
            warnings = validation.get("warnings", [])
            if warnings:
                has_warnings = True
                print("### ⚠️ WARNINGS")
                print()
                for warning in warnings:
                    print(f"**{warning['type']}**: {warning['message']}")
                    for field in warning["fields"]:
                        print(f"  - `{field}`")
                    print()

            if not errors and not warnings:
                print("✅ **No issues found**")
                print()

        # Summary
        print("## Summary")
        print()
        if has_errors:
            print("❌ **FAILED**: Configuration has errors that must be fixed")
        elif has_warnings:
            print("⚠️ **WARNING**: Configuration has warnings")
        else:
            print("✅ **PASSED**: Configuration is consistent with implementation")
        print()

    @staticmethod
    def print_config_based_coverage(
        config_loader: ConfigLoader,
        verbose: bool,
    ) -> None:
        """Print coverage report based on config file (with priority grouping)."""
        print("# 📋 ADK Field Coverage Report (CONFIG-BASED TRACKING)")
        print()
        print("**Data Source**: Configuration file (`scripts/field_coverage_config.yaml`)")
        print("**Method**: Manual tracking with status, priority, and location metadata")
        print("**Purpose**: Track field implementation status and planning")
        print()
        print("**Legend**:")
        print("  ✅ IMPLEMENTED - Field is fully implemented and tested")
        print("  📝 DOCUMENTED  - Field is documented but implementation deferred")
        print("  ⏸️  DEFERRED    - Low priority, deferred to future work")
        print("  ❌ NOT_STARTED - Planned but not yet implemented")
        print()

        for field_type in ["event", "part"]:
            title = "Event Fields" if field_type == "event" else "Part Fields"
            print(f"## {title}")
            print()

            fields_config = config_loader.get_field_config(field_type)

            # Group by priority
            priority_groups: dict[str, list[tuple[str, dict[str, Any]]]] = {}
            for field_name, config in fields_config.items():
                priority = config.get("priority", "UNKNOWN")
                if priority not in priority_groups:
                    priority_groups[priority] = []
                priority_groups[priority].append((field_name, config))

            # Print in priority order
            for priority in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]:
                if priority not in priority_groups:
                    continue

                fields = sorted(priority_groups[priority], key=lambda x: x[0])
                print(f"### Priority: {priority}")
                print()

                for field_name, config in fields:
                    status = config.get("status", "UNKNOWN")
                    status_icon = {
                        "IMPLEMENTED": "✅",
                        "DOCUMENTED": "📝",
                        "DEFERRED": "⏸️",
                        "NOT_STARTED": "❌",
                    }.get(status, "❓")

                    location = config.get("location") or "N/A"
                    notes = config.get("notes", "")

                    print(f"**{status_icon} `{field_name}`** ({status})")
                    if verbose:
                        print(f"  - **Location**: `{location}`")
                        if config.get("ai_sdk_mapping"):
                            print(f"  - **AI SDK**: `{config['ai_sdk_mapping']}`")
                        if notes:
                            print(f"  - **Notes**: {notes}")
                    print()

            print()

    @staticmethod
    def print_finish_reason_coverage(
        adk_reasons: set[str],
        reason_map: dict[str, str],
        ai_sdk_reasons: set[str],
        verbose: bool,
    ) -> None:
        """Print FinishReason coverage report."""
        print("# 🎯 FinishReason Mapping Coverage Report (CODE-BASED ANALYSIS)")
        print()
        print("**Data Source**: Direct code analysis")
        print("**Source**: ADK `types.FinishReason` enum (17 values)")
        print("**Implementation**: `stream_protocol.py` reason_map (ADK → AI SDK v6 mapping)")
        print("**Target**: AI SDK v6 FinishReason type (6 values)")
        print("**Purpose**: Verify all ADK finish reasons are mapped to AI SDK v6 correctly")
        print()

        # ADK FinishReason coverage
        mapped_adk_reasons = set(reason_map.keys())
        missing_adk_reasons = adk_reasons - mapped_adk_reasons
        adk_coverage = len(mapped_adk_reasons) / len(adk_reasons) * 100

        print("## ADK FinishReason Coverage")
        print()
        print(f"**Coverage**: {len(mapped_adk_reasons)}/{len(adk_reasons)} ({adk_coverage:.1f}%)")
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
            print("These AI SDK finish reasons are defined but not produced by mapping:")
            print()
            for reason in sorted(unmapped_ai_sdk_reasons):
                print(f"- `{reason}`")
            print()

        # Unknown values check
        unknown_values = mapped_ai_sdk_values - ai_sdk_reasons
        if unknown_values:
            print("## ⚠️ Unknown Target Values in Mapping")
            print()
            print("These values are in reason_map but not defined in AI SDK FinishReason:")
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
        self.config_loader = ConfigLoader()
        self.config_validator = ConfigValidator(
            self.config_loader, self.adk_analyzer, self.adk_extractor
        )
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

    def run_coverage_check(self, verbose: bool, use_config: bool = False) -> None:
        """Run coverage check mode."""
        if use_config:
            print("=" * 80)
            print("📋 CONFIG-BASED MODE")
            print("=" * 80)
        else:
            print("=" * 80)
            print("🔍 CODE-BASED MODE")
            print("=" * 80)
        print()

        if use_config:
            # Config-based coverage (with priority grouping)
            self.reporter.print_config_based_coverage(self.config_loader, verbose)
        else:
            # ADK coverage (original)
            implemented_adk = self.adk_analyzer.analyze()
            all_adk = self.adk_extractor.get_field_names()
            analyzed_files = [p.name for p in self.adk_analyzer.file_paths]
            self.reporter.print_adk_coverage(implemented_adk, all_adk, verbose, analyzed_files)

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
        self.reporter.print_finish_reason_coverage(adk_reasons, reason_map, ai_sdk_reasons, verbose)

    def run_validation(self) -> int:
        """
        Run configuration validation mode.

        Returns:
            0 if validation passed, 1 if warnings, 2 if errors
        """
        print("=" * 80)
        print("✓ VALIDATION MODE (CONFIG vs CODE)")
        print("=" * 80)
        print()

        results = self.config_validator.validate()
        self.reporter.print_config_validation(results)

        # Determine exit code
        has_errors = any(len(v.get("errors", [])) > 0 for v in results.values())
        has_warnings = any(len(v.get("warnings", [])) > 0 for v in results.values())

        if has_errors:
            return 2
        elif has_warnings:
            return 1
        else:
            return 0


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Extract type definitions and check coverage",
        epilog="""
Examples:
  # Validate configuration against implementation
  uv run python scripts/check-coverage.py --validate

  # Coverage check with config-based grouping
  uv run python scripts/check-coverage.py --use-config --verbose

  # Original coverage check
  uv run python scripts/check-coverage.py

  # Extract type definitions
  uv run python scripts/check-coverage.py --extract-only adk
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
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
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate field_coverage_config.yaml against actual implementation",
    )
    parser.add_argument(
        "--use-config",
        action="store_true",
        help="Use config file for coverage report (with priority grouping)",
    )
    args = parser.parse_args()

    checker = CoverageChecker()

    if args.validate:
        exit_code = checker.run_validation()
        sys.exit(exit_code)
    elif args.extract_only:
        checker.run_extraction(args.extract_only, args.format)
    else:
        checker.run_coverage_check(args.verbose, args.use_config)


if __name__ == "__main__":
    main()
