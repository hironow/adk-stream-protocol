# ADK Stream Protocol Project Overview

## Project Purpose
AI SDK v6 and Google ADK integration example demonstrating SSE and WebSocket streaming implementation. The project bridges Vercel's AI SDK v6 with Google's ADK (AI Development Kit) to provide real-time multimodal AI interactions.

## Key Features
- **Three Streaming Modes**: Gemini Direct, ADK SSE, ADK BIDI with seamless mode switching
- **Multimodal Support**: Text, images, audio (PCM streaming), tool calling
- **Tool Confirmation Flow**: User approval system for sensitive tool executions (SSE & BIDI modes)
- **Frontend Tool Execution**: Browser API delegation pattern for client-side tool execution
- **Protocol Unification**: All modes use AI SDK v6 Data Stream Protocol for consistency
- **Production Ready**: 458 frontend tests, 390 backend tests, comprehensive E2E coverage

## Recent Achievements (2025-12-25)
- ✅ **Fixture Consolidation**: Reorganized test fixtures to root-level `fixtures/` directory
- ✅ **SSE Confirmation Flow**: Implemented explicit confirmation handling matching BIDI pattern
- ✅ **MSW Helper**: Created `setupMswServer()` helper reducing test boilerplate by 75%
- ✅ **Code Quality**: All checks passing (format, lint, typecheck, semgrep)
- ✅ **Documentation Cleanup**: Removed 4,500+ lines of obsolete agent documentation

## Current Status
- **Branch**: `hironow/fix-confirm` (15 commits ahead of origin)
- **Backend Tests**: 390 passed, 6 skipped (fixture recording pending)
- **Frontend Tests**: 458 passed, 0 skipped
- **Quality Gates**: All passing (ruff, mypy, biome, semgrep, markdownlint)
- **Documentation**: Comprehensive coverage in `docs/`, `fixtures/README.md`

## Active Tasks
See `agents/tasks.md` for current task tracking:
1. Record E2E fixture files for patterns 2/3/4 (6 skipped tests)

## Technical Highlights
- **Type Safety**: Full TypeScript + Python type annotations
- **Result Pattern**: Rust-inspired error handling (no try-except in production code)
- **Test-First**: TDD approach with RED-GREEN-REFACTOR cycle
- **Chunk Logger**: E2E test fixture recording system for protocol verification
