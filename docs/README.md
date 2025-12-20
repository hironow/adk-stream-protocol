# Documentation Index

This directory contains documentation for the current implementation of the ADK AI Data Protocol project.

**Note**: For historical decisions and rationale, see `docs/adr/` (Architecture Decision Records).

## Quick Start

- **[Getting Started Guide](GETTING_STARTED.md)** - Setup and run the project
- **[Glossary](glossary.md)** - Key terms and concepts

## Architecture & Implementation

- **[Architecture](ARCHITECTURE.md)** - System architecture and patterns
  - AudioWorklet PCM Streaming
  - Tool Approval Flow (Frontend Delegation Pattern)
  - Per-Connection State Management
  - Multimodal Support Architecture

- **[Implementation](IMPLEMENTATION.md)** - Implementation details
  - Protocol conversion (ADK ↔ AI SDK v6)
  - Event streaming
  - Tool execution

## Testing

- **[E2E Testing Guide](E2E_GUIDE.md)** - End-to-end test patterns and helpers
- **[Chunk Logger E2E Testing](chunk-logger-e2e-testing.md)** - Debug logging in E2E tests
- **[Test Coverage Audit](TEST_COVERAGE_AUDIT.md)** - Field coverage verification (2025-12-14)

## Optimization

- **[React Memoization](REACT_MEMOIZATION.md)** - Frontend performance optimization

## Architecture Decision Records (ADR)

Immutable history of significant architectural decisions:

- **[ADR-0001](adr/0001-per-connection-state-management.md)** - Per-Connection State Management
- **[ADR-0002](adr/0002-tool-approval-architecture.md)** - Tool Approval Architecture

---

**Documentation Guidelines**: This documentation describes the CURRENT implementation only. For historical context, see ADRs. For experimental work, see `experiments/README.md`.

**Last Documentation Review**: 2025-12-20
