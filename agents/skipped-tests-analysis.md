# Skipped Tests Summary

**Updated:** 2026-01-18
**Total Skipped:** 53 tests (34 Vitest + 19 Playwright)

## Vitest (34 tests)

### E2E Tests (33 skipped)

| File | Count | Reason |
|------|-------|--------|
| `audio-control.e2e.test.ts` | 16 | Web Audio API not available in jsdom |
| `error-handling.e2e.test.ts` | 10 | BIDI WebSocket state issues, complex mocking required |
| `mode-switching.e2e.test.ts` | 5 | Gemini Direct mode schema, audio API |
| `chat-flow.e2e.test.ts` | 1 | HTTP transport mock setup |
| `tool-execution.e2e.test.ts` | 1 | BIDI initialization timing |

### Integration Tests (2 skipped)

| File | Reason |
|------|--------|
| `transport-done-baseline.test.ts:553` | E2E coverage exists |
| `transport-done-baseline.test.ts:625` | E2E coverage exists |

## Playwright (19 tests)

| Category | Count | Reason |
|----------|-------|--------|
| Chat history sharing | 5 | Backend switch schema validation |
| Tool confirmation | 3 | BIDI Blocking Mode timeout handling |
| Visual regression | 3 | AI response non-deterministic |
| Gemini Direct mode | 2 | Design decision - schema validation only |
| Tool execution UI | 2 | Error handling edge cases |
| Audio multimodal | 1 | Voice input testing not implemented |
| Setup verification | 1 | Test-id attributes check |
| BIDI WebSocket timing | 1 | Flaky init timing |
| Other | 1 | Various documented reasons |

## Notes

- All skips are intentional and documented in test files
- Web Audio API tests require Playwright with real browser
- BIDI WebSocket state issues are MSW mock limitations
- Gemini Direct tests run with ADK SSE/BIDI modes instead
- Tool approval skips are for edge cases (timeout, error handling)
