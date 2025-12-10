# Experiments

This directory contains research, preliminary experiments, and exploratory implementations for the ADK AI Data Protocol project.

## Experiment Index

### 🟡 In Progress

| Date | Experiment | Status | Objective | Current Phase |
|------|-----------|--------|-----------|---------------|
| 2025-12-11 | [ADK BIDI Multimodal Support](./2025-12-11_adk_bidi_multimodal_support.md) | 🟡 In Progress | Investigate and implement ADK BIDI mode's multimodal capabilities (images, audio, video) within AI SDK v6 Data Stream Protocol | Phase 1: Image Support - Ready to Implement |

### ⚪ Planned

_No planned experiments_

### 🟢 Complete

| Date | Experiment | Status | Objective | Result |
|------|-----------|--------|-----------|--------|
| 2025-12-11 | [ADK BIDI + AI SDK v6 Integration](./2025-12-11_adk_bidi_ai_sdk_v6_integration.md) | 🟢 Complete | Investigate compatibility between AI SDK v6 useChat and ADK BIDI mode for bidirectional streaming | ✅ **SUCCESS** - Full BIDI integration working with WebSocket transport, tool calling functional |

## Directory Structure

- `experiments/README.md` - This file
- `experiments/YYYY-MM-DD_{experiment_name}.md` - Experiment plan and results documents
- `experiments/run_{experiment_name}_*.sh` - Benchmark and test scripts
- `experiments/test_{experiment_name}*.py` - Test scripts for experiments

## Output Structure

Generated artifacts and results are stored in:
- `output/{experiment_note_name}/` - Generated outputs with parameter information
- `preprocessed/{experiment_note_name}/{resolution}/` - Preprocessed data (if applicable)
