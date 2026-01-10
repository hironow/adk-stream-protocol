"""
Session Persistence Tests (Phase 2)

TDD tests for SQLite session persistence configuration.
SSE mode uses SqliteSessionService for persistence.
BIDI mode continues using InMemorySessionService (ADK run_live() constraint).

Reference:
- ADR-0001: Per-Connection State Management
- ADK docs: run_live() doesn't support DatabaseSessionService/VertexAiSessionService
"""

import os


class TestSseSessionServiceConfiguration:
    """Tests for SSE runner session service configuration."""

    def test_sse_runner_uses_sqlite_session_service(self) -> None:
        """SSE runner should use SqliteSessionService for persistence."""
        # given
        from google.adk.sessions.sqlite_session_service import SqliteSessionService

        # when
        from adk_stream_protocol import sse_agent_runner

        # then
        assert isinstance(sse_agent_runner.session_service, SqliteSessionService), (
            f"Expected SqliteSessionService, got {type(sse_agent_runner.session_service).__name__}"
        )

    def test_sse_session_db_path_has_default(self) -> None:
        """SSE session database path should have a sensible default."""
        # given
        from adk_stream_protocol.adk_ag_runner import SSE_SESSION_DB_PATH

        # when
        default_path = SSE_SESSION_DB_PATH

        # then
        # Default should be "./sessions.db" when env var is not set
        assert default_path == os.getenv("ADK_SESSION_DB_PATH", "./sessions.db")


class TestBidiSessionServiceConfiguration:
    """Tests for BIDI runner session service configuration (unchanged)."""

    def test_bidi_runner_uses_in_memory_session_service(self) -> None:
        """BIDI runner should continue using InMemorySessionService (ADK constraint)."""
        # given
        from google.adk.sessions import InMemorySessionService

        # when
        from adk_stream_protocol import bidi_agent_runner

        # then
        assert isinstance(bidi_agent_runner.session_service, InMemorySessionService), (
            f"Expected InMemorySessionService, got {type(bidi_agent_runner.session_service).__name__}"
        )


class TestSessionServiceIsolation:
    """Tests for session service isolation between modes."""

    def test_sse_and_bidi_use_different_session_services(self) -> None:
        """SSE and BIDI runners should use different session service instances."""
        # given
        from adk_stream_protocol import bidi_agent_runner, sse_agent_runner

        # when
        sse_session_service = sse_agent_runner.session_service
        bidi_session_service = bidi_agent_runner.session_service

        # then
        assert sse_session_service is not bidi_session_service
        assert type(sse_session_service).__name__ != type(bidi_session_service).__name__
