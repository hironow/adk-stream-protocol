# Project Status

**Updated:** 2026-01-18
**Status:** All Tests Passing (Fail 0)

## Test Counts

| Suite | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| Vitest | 689 | 0 | 34 |
| Playwright | 233 | 0 | 19 |
| Python pytest | 404 | 0 | 0 |
| **Total** | **1,326** | **0** | **53** |

## Code Quality

```
ruff:    0 errors
mypy:    0 errors
semgrep: 0 errors
```

---

## Remaining TODOs

### HIGH Priority (本番環境必須)

| ファイル | 内容 | 詳細 |
|----------|------|------|
| `server.py` | `/live` WebSocket認証 | WebSocketはカスタムヘッダー困難。query param or first message で認証検討 |

### LOW Priority (将来対応)

| ファイル | 内容 |
|----------|------|
| `chat-basic.spec.ts:38` | Gemini Directモードスキーマ修正 |
| `visual-regression.spec.ts:78` | AI応答マスキング |
| `multi-tool-execution.spec.ts:397` | BIDIモード初期化タイミング |

### Deferred (見送り)

| 項目 | 理由 |
|------|------|
| BIDI Session Persistence | ADK `run_live()` が `DatabaseSessionService` 非対応。カスタム実装は複雑すぎるため見送り |

---

## Tool Approval Implementation Status

| Mode | Pattern | Status | ADR |
|------|---------|--------|-----|
| SSE | Legacy Approval Mode (LongRunningFunctionTool) | ✅ Complete | ADR-0008 |
| BIDI | BIDI Blocking Mode (ApprovalQueue) | ✅ Complete | ADR-0009, ADR-0011 |

---

## Recently Completed Features

| Feature | Scope | Status | Details |
|---------|-------|--------|---------|
| ADK Mode History Sharing | ADK SSE ↔ ADK BIDI | ✅ Complete | Chat history preserved across ADK mode transitions. Streaming state blocks mode switch. E2E: 5/5 passing |

---

## References

- Skipped tests: `agents/skipped-tests-analysis.md`
- Architecture: `docs/spec_ARCHITECTURE.md`
- Protocol: `docs/spec_PROTOCOL.md`
