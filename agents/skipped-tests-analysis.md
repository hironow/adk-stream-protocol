# Skipped Tests Summary

**Updated:** 2026-01-10
**Total Skipped:** 53 tests (34 Vitest + 19 Playwright)

## Vitest (34 tests)

### E2E Tests (32 skipped)

| File | Count | Reason |
|------|-------|--------|
| `error-handling.e2e.test.ts` | 10 | BIDI WebSocket state issues, complex mocking required |
| `audio-control.e2e.test.ts` | 16 | Web Audio API not available in jsdom |
| `mode-switching.e2e.test.ts` | 5 | Gemini Direct mode schema, audio API |
| `tool-execution.e2e.test.ts` | 1 | BIDI initialization timing |

### Unit/Integration Tests (2 skipped)

| File | Reason |
|------|--------|
| `transport-done-baseline.test.ts:553` | E2E coverage exists |
| `transport-done-baseline.test.ts:625` | E2E coverage exists |

## Playwright (19 tests)

| Category | Count | Reason |
|----------|-------|--------|
| Gemini Direct mode | 6 | Design decision - schema validation only |
| Audio multimodal | 1 | Voice input testing not implemented |
| Visual regression | 3 | AI response non-deterministic |
| BIDI WebSocket timing | 1 | Flaky init timing |
| Other | 8 | Various documented reasons |

## Notes

- All skips are intentional and documented in test files
- Web Audio API tests require Playwright with real browser
- BIDI WebSocket state issues are MSW mock limitations
- Gemini Direct tests run with ADK SSE/BIDI modes instead
