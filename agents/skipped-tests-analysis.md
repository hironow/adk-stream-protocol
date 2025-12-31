# Skipped Tests Analysis

**Date:** 2025-12-31 (Original Analysis)
**Updated:** 2026-01-01 (Verification)
**Total Skipped:** 13 tests (2 Vitest + 0 Python E2E + 11 Playwright)

## Summary

| Category | Count | Status | Recommendation |
|----------|-------|--------|----------------|
| Vitest lib | 2 | ✅ Documented | Keep skipped (E2E coverage exists) |
| Python E2E | 0 | ✅ Cleaned | Pattern 2/3/4 tests deleted (2026-01-01) |
| Playwright E2E | 11 | ✅ Documented | Keep (Gemini Direct limitations + skip reasons added) |

**Update (2026-01-01):**
- ✅ Python E2E tests (7 tests) with missing fixtures have been deleted
- ✅ Playwright audio/visual tests now have skip reason comments

---

## 1. Vitest lib (2 tests) - ✅ KEEP SKIPPED

**File:** `lib/tests/integration/transport-done-baseline.test.ts`

### 1.1 BIDI get_location baseline test (line 553)
```typescript
it.skip("[BIDI] should match baseline behavior for get_location with [DONE]", async () => {
```

**Reason:** Phase 12 BLOCKING approval flow requires multi-stream handling that cannot be simulated in integration test mocks

**Coverage:** Playwright E2E tests (`scenarios/tools/`)

**Recommendation:** ✅ **Keep skipped** - Properly documented, E2E coverage exists

### 1.2 BIDI process_payment baseline test (line 625)
```typescript
it.skip("[BIDI] should match baseline behavior for process_payment with [DONE]", async () => {
```

**Reason:** Same as above - Phase 12 BLOCKING approval flow limitation

**Coverage:** Playwright E2E tests (`scenarios/tools/`)

**Recommendation:** ✅ **Keep skipped** - Properly documented, E2E coverage exists

---

## 2. Python E2E (7 tests) - ✅ DELETED (2026-01-01)

**Files:**
- `tests/e2e/test_server_chunk_player.py`
- `tests/e2e/test_server_structure_validation.py`

### 2.1 Pattern 2: ADK SSE Only (2 tests)

**Class:** `TestPattern2ADKSSEOnly`

**Skip Reason:** `"Waiting for fixture recording - fixture files are empty (0 bytes). See docs/E2E_GUIDE.md"`

**Tests:**
1. `test_replays_chunks_in_fast_forward_mode`
2. `test_contains_tool_invocation_chunks`

**Expected Fixture:** `fixtures/backend/pattern2-backend.jsonl` (NOT FOUND)

### 2.2 Pattern 3: ADK BIDI Only (2 tests)

**Class:** `TestPattern3ADKBIDIOnly`

**Skip Reason:** Same as Pattern 2

**Tests:**
1. `test_replays_chunks_in_fast_forward_mode`
2. `test_contains_audio_chunks`

**Expected Fixture:** `fixtures/backend/pattern3-backend.jsonl` (NOT FOUND)

### 2.3 Pattern 4: Mode Switching (2 tests)

**Class:** `TestPattern4ModeSwitching`

**Skip Reason:** Same as Pattern 2

**Tests:**
1. `test_replays_chunks_from_multiple_modes`
2. `test_preserves_chunk_order_across_mode_switches`

**Expected Fixture:** `fixtures/backend/pattern4-backend.jsonl` (NOT FOUND)

### 2.4 Structure Validation (1 test)

**Test:** `test_get_location_approved_sse_structure_matches_baseline`

**Skip Reason:** `"Multi-turn approval flow requires complete message history - tested in complete match tests"`

**Recommendation for Python E2E:**

⚠️ **DELETE if no fixture recording plan exists**

Rationale:
- Fixture files don't exist and were never created
- Comment says "Waiting for fixture recording" but no timeline
- Tests without fixtures are dead code
- If recording is planned, create an issue and track it

**Action Items:**
1. Check if fixture recording is planned
2. If YES: Create GitHub issue, link in skip comment
3. If NO: Delete the 3 test classes (6 tests) and 1 structure validation test

---

## 3. Playwright E2E (11 tests) - ✅ MOSTLY KEEP

### 3.1 Gemini Direct Backend Tests (6 tests) - ✅ KEEP

**File:** `scenarios/features/chat-backend-equivalence.spec.ts`

**Skip Logic:**
```typescript
test.beforeEach(async ({ page }) => {
  test.skip(
    backend === "gemini",
    "Gemini Direct mode: limited to schema validation only. Full functional testing uses ADK SSE/BIDI modes.",
  );
});
```

**Affected Tests:**
1. should handle text-only conversation
2. should handle image upload with text
3. should handle follow-up message after image
4. should handle tool invocation (weather)
5. should handle multiple text messages in sequence
6. Gemini Direct and ADK SSE should produce equivalent responses (line 181)

**Reason:** Gemini Direct mode is intentionally limited to AI SDK v6 schema compatibility checks, not full functional testing

**Coverage:** Same tests run with `backend === "adk-sse"` and `backend === "adk-bidi"`

**Recommendation:** ✅ **Keep skipped** - Design decision, properly documented

### 3.2 Audio Multimodal Test (1 test) - ❓ NEEDS CLARIFICATION

**File:** `scenarios/app-advanced/audio-multimodal.spec.ts:152`

**Test:**
```typescript
test.skip("should support push-to-talk voice input", async ({ page }) => {
```

**Reason:** No comment provided

**Recommendation:** ❓ **Add skip reason comment or delete**

Options:
- If feature is planned: Add comment with timeline/issue link
- If feature is not planned: Delete test
- If feature exists but test is broken: Fix test or document issue

### 3.3 Visual Regression Test (1 test) - ❓ NEEDS CLARIFICATION

**File:** `scenarios/app-advanced/visual-regression.spec.ts:176`

**Test:**
```typescript
test.skip("should maintain consistent streaming animation", async ({
```

**Reason:** No comment provided

**Recommendation:** ❓ **Add skip reason comment or delete**

Same options as 3.2 above

### 3.4 Other Playwright Skips (3 tests) - 📋 INVESTIGATE

**Files with skip/fixme:**
- `scenarios/features/mode-testing.spec.ts`
- `scenarios/features/tool-confirmation.spec.ts`
- `scenarios/app-smoke/setup-verification.spec.ts`
- `scenarios/app-smoke/chat-basic.spec.ts`
- `scenarios/app-core/tool-execution-ui.spec.ts`
- `scenarios/app-core/tool-approval-sse.spec.ts`
- `scenarios/app-core/tool-approval-bidi.spec.ts`

**Note:** These files contain `test.skip()` but specific occurrences need individual review

---

## Action Plan

### Completed Actions (2026-01-01)

1. ✅ **Vitest lib:** Keep as-is (well-documented, E2E coverage)
2. ✅ **Playwright Gemini Direct:** Keep as-is (design decision)
3. ✅ **Python E2E (7 tests):** Pattern 2/3/4 tests deleted from `test_server_chunk_player.py`
4. ✅ **Playwright Audio/Visual (2 tests):** Skip reason comments already present
   - `audio-multimodal.spec.ts:152`: "Skipped until voice input testing is implemented"
   - `visual-regression.spec.ts:176`: "This test is challenging due to animation timing"

### Remaining Actions

5. 📋 **Other Playwright skips (optional):**
   - [ ] Individual review of remaining files (if needed)
   - [ ] Ensure all skips have clear comments (most already have them)

---

## Skip Comment Template

When keeping a skipped test, use this format:

```typescript
test.skip("test name", async () => {
  // SKIP REASON: [Brief explanation]
  // COVERAGE: [How this functionality is tested elsewhere, or "None"]
  // TRACKING: [GitHub issue link, or "N/A"]
  // PLANNED: [Expected unskip date/milestone, or "No current plan"]
});
```

Example:
```typescript
test.skip("should support push-to-talk voice input", async ({ page }) => {
  // SKIP REASON: Feature not yet implemented
  // COVERAGE: None (new feature)
  // TRACKING: https://github.com/org/repo/issues/123
  // PLANNED: Q2 2025
});
```
