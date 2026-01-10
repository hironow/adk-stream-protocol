# Project Status

**Updated:** 2026-01-10
**Status:** All Tests Passing (Fail 0)

## Test Counts

| Suite | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| Vitest | 690 | 0 | 34 |
| Playwright | 147 | 0 | 19 |
| Python pytest | 334 | 0 | 0 |
| **Total** | **1,171** | **0** | **53** |

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

## References

- Skipped tests: `agents/skipped-tests-analysis.md`
- Architecture: `docs/spec_ARCHITECTURE.md`
- Server API: `docs/external/server-api.md`
