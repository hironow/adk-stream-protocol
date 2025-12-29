# Documentation Index

This directory contains documentation for the current implementation of the ADK AI Data Protocol project.

**Note**: For historical decisions and rationale, see `adr/` (Architecture Decision Records).

---

## 📚 Quick Start

Start here if you're new to the project:

- **[Getting Started Guide](00_GETTING_STARTED.md)** - Setup, installation, running the project
- **[Glossary](00_GLOSSARY.md)** - Key terms, concepts, and patterns

---

## 🏗️ Spec & Architecture

System design, protocols, and architectural patterns:

- **[Architecture Overview](spec_ARCHITECTURE.md)** - Complete system architecture
    - AudioWorklet PCM Streaming
    - Tool Approval Flow (Frontend Delegation Pattern)
    - Per-Connection State Management
    - Multimodal Support Architecture

- **[Protocol Implementation](spec_PROTOCOL.md)** - ADK ↔ AI SDK v6 protocol
    - Event/Part field mapping
    - Implementation status
    - Custom extensions (data-pcm, data-image, etc.)

---

## 🐍 Backend / Python

Python backend with ADK and FastAPI:

- **[Result Type Pattern](backend_RESULT_TYPE.md)** - `Ok(value)` / `Error(value)` error handling

---

## ⚛️ Frontend / TypeScript

TypeScript frontend with AI SDK v6 and React:

- **[Library Structure](frontend_LIB_STRUCTURE.md)** - `lib/` organization and module dependencies
- **[React Optimization](frontend_REACT_OPTIMIZATION.md)** - Memoization and performance patterns
- **[Vitest Tests](frontend_TESTING_VITEST.md)** - `lib/tests/` structure (unit, integration, e2e)

---

## 🧪 Testing

Comprehensive testing strategy across all layers:

- **[Testing Strategy](testing_STRATEGY.md)** - Overall test architecture (pytest, Vitest, Playwright)
- **[E2E Testing Guide](testing_E2E.md)** - Complete E2E testing documentation
    - Backend E2E (pytest golden files)
    - Frontend E2E (Vitest browser tests)
    - Fixtures management
    - Chunk Logger debugging
- **[Coverage Audit](testing_COVERAGE_AUDIT.md)** - Test coverage verification

---

## 📖 Architecture Decision Records (ADR)

Immutable history of significant architectural decisions:

- **[ADR-0001](adr/0001-per-connection-state-management.md)** - Per-Connection State Management
- **[ADR-0002](adr/0002-tool-approval-architecture.md)** - Tool Approval Architecture
- **[ADR-0003](adr/0003-sse-vs-bidi-confirmation-protocol.md)** - SSE vs BIDI Confirmation Protocol
- **[ADR-0004](adr/0004-multi-tool-response-timing.md)** - Multi-Tool Response Timing
- **[ADR-0005](adr/0005-frontend-execute-pattern-and-done-timing.md)** - Frontend Execute Pattern and [DONE] Timing
- **[ADR-0006](adr/0006-send-automatically-when-decision-logic-order.md)** - sendAutomaticallyWhen Decision Logic Order
- **[ADR-0007](adr/0007-approval-value-independence-in-auto-submit.md)** - Approval Value Independence in Auto-Submit Timing
- **[ADR-0008](adr/0008-sse-mode-pattern-a-only-for-frontend-tools.md)** - SSE Mode Pattern A Only for Frontend Tools
- **[ADR-0009](adr/0009-phase12-blocking-mode-for-approval.md)** - Phase 12 Blocking Mode for Approval
- **[ADR-0010](adr/0010-bidi-confirmation-chunk-generation.md)** - BIDI Confirmation Chunk Generation

---

## 📋 Documentation Guidelines

- **Current State Only**: This documentation describes the CURRENT implementation only
- **No Historical Content**: For historical context and decision rationale, see ADRs
- **No Future Plans**: For experimental work and research, see `experiments/README.md`
- **Stay Synchronized**: When code changes, update docs in the same commit

**Last Documentation Review**: 2025-12-29
