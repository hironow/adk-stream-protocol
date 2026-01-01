# Skipped Tests Summary

**Updated:** 2026-01-02
**Total Skipped:** 21 tests (2 Vitest + 19 Playwright)

## Vitest (2 tests)

| File | Reason |
|------|--------|
| `transport-done-baseline.test.ts:553` | Phase 12 BLOCKING - E2E coverage exists |
| `transport-done-baseline.test.ts:625` | Phase 12 BLOCKING - E2E coverage exists |

## Playwright (19 tests)

| Category | Count | Reason |
|----------|-------|--------|
| Gemini Direct mode | 6 | Design decision - schema validation only |
| Audio multimodal | 1 | Voice input testing not implemented |
| Visual regression | 3 | AI response non-deterministic |
| BIDI WebSocket timing | 1 | Flaky init timing |
| Other Playwright | 8 | Various documented reasons |

## Notes

- All skips are intentional and documented in test files
- E2E coverage exists for skipped unit/integration tests
- Gemini Direct tests run with ADK SSE/BIDI modes instead
