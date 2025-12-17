# Chunk Logger E2E Reference Design Plan

**Date**: 2025-12-18
**Status**: 🟡 Planning
**Objective**: Design a robust mechanism for E2E tests to reference and verify chunk logger data

---

## Current Issues

### 1. Log File Lifecycle Management
- ❌ **Frontend logs not cleared**: Fixed in `clearBackendChunkLogs()`, but timing issues remain
- ⚠️ **Multiple test runs accumulate logs**: 16 frontend log files currently exist
- ⚠️ **Log file paths constructed in multiple places**: Duplicated logic across helpers

### 2. Frontend Log Download Mechanism
- ⚠️ **Browser download dependency**: Relies on Playwright download events
- ⚠️ **Timing uncertainty**: Download may not complete before analysis
- ⚠️ **No verification**: No check that downloaded file contains expected session data

### 3. Session ID Management
- ⚠️ **Environment variable coupling**: `NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID` shared across tests
- ⚠️ **Session ID reuse**: Same session ID used for all tests in a suite
- ⚠️ **No isolation**: Cannot run tests in parallel due to session conflicts

### 4. Consistency Checking
- ⚠️ **Complex parsing logic**: Tool call extraction scattered across multiple conditionals
- ⚠️ **No schema validation**: Assumes chunk format without verification
- ⚠️ **Error messages unclear**: Hard to debug when consistency checks fail

---

## Design Goals

1. **Isolation**: Each test should have independent chunk logger state
2. **Reliability**: Eliminate race conditions and timing dependencies
3. **Clarity**: Clear path construction and consistent error messages
4. **Performance**: Minimize file I/O and download overhead
5. **Debuggability**: Easy to inspect chunk logs when tests fail

---

## Proposed Solutions

### Option A: Direct Backend API Access (RECOMMENDED)

**Approach**: Instead of downloading frontend logs via browser, access chunk logs directly through backend API endpoints.

**Pros**:
- ✅ Eliminates browser download timing issues
- ✅ Faster and more reliable
- ✅ Can verify logs in real-time during test execution
- ✅ No file system cleanup needed

**Cons**:
- ⚠️ Requires new backend endpoint(s)
- ⚠️ Deviates from true "E2E" (doesn't test download button)

**Implementation**:
```typescript
// New backend endpoint
GET /api/chunk-logs/{sessionId}/frontend
GET /api/chunk-logs/{sessionId}/backend-adk
GET /api/chunk-logs/{sessionId}/backend-sse

// E2E test usage
const frontendLogs = await fetchChunkLogs(page, SESSION_ID, "frontend");
const backendAdkLogs = await fetchChunkLogs(page, SESSION_ID, "backend-adk");
const analysis = analyzeChunkLogConsistency(backendAdkLogs, backendSseLogs, frontendLogs);
```

### Option B: Unique Session IDs Per Test

**Approach**: Generate unique session IDs for each test to ensure complete isolation.

**Pros**:
- ✅ Perfect test isolation
- ✅ Enables parallel test execution
- ✅ No log cleanup needed between tests

**Cons**:
- ⚠️ More log files accumulate over time
- ⚠️ Still has frontend download timing issues

**Implementation**:
```typescript
test.beforeEach(async ({ page }) => {
  // Generate unique session ID per test
  const sessionId = `e2e-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Configure chunk logger with unique session
  await enableChunkLogger(page, sessionId);

  // Store session ID for cleanup
  test.info().annotations.push({ type: "sessionId", description: sessionId });
});

test.afterEach(async ({ page }, testInfo) => {
  // Clean up this test's logs only
  const sessionId = testInfo.annotations.find(a => a.type === "sessionId")?.description;
  if (sessionId) {
    clearBackendChunkLogs(sessionId);
  }
});
```

### Option C: ChunkLoggerManager Abstraction

**Approach**: Create a centralized `ChunkLoggerManager` class to handle all chunk logger operations.

**Pros**:
- ✅ Single source of truth for path construction
- ✅ Encapsulated lifecycle management
- ✅ Easier to test and maintain
- ✅ Can add caching and optimization

**Cons**:
- ⚠️ Requires refactoring existing tests
- ⚠️ More abstraction overhead

**Implementation**:
```typescript
class ChunkLoggerManager {
  constructor(private sessionId: string) {}

  // Lifecycle
  async initialize(page: Page): Promise<void>
  async cleanup(): Promise<void>

  // Log access
  async getFrontendLogs(): Promise<ChunkLog[]>
  async getBackendAdkLogs(): Promise<ChunkLog[]>
  async getBackendSseLogs(): Promise<ChunkLog[]>

  // Analysis
  async analyzeConsistency(): Promise<ConsistencyAnalysis>

  // Path management
  getFrontendLogPath(testName: string): string
  getBackendLogPath(logType: "adk" | "sse"): string
}

// E2E test usage
test.beforeEach(async ({ page }) => {
  manager = new ChunkLoggerManager(SESSION_ID);
  await manager.initialize(page);
});

test("should maintain consistency", async ({ page }) => {
  // ... test actions ...

  const analysis = await manager.analyzeConsistency();
  expect(analysis.isConsistent).toBe(true);
});

test.afterEach(async () => {
  await manager.cleanup();
});
```

---

## Recommended Approach

**Phase 1: Immediate Fixes** (Current Session)
1. ✅ Fix frontend log cleanup in `clearBackendChunkLogs()` (DONE)
2. ⏳ Verify fix resolves current test failures
3. ⏳ Add retry logic for frontend log download

**Phase 2: Backend API Access** (Next Session)
1. Add backend API endpoints for chunk log retrieval
2. Refactor `analyzeChunkLogConsistency` to accept log data instead of file paths
3. Update tests to use API instead of file download
4. Keep download button test as separate smoke test

**Phase 3: ChunkLoggerManager Abstraction** (Future)
1. Create `ChunkLoggerManager` class
2. Migrate existing tests to use manager
3. Add unit tests for manager
4. Optimize log parsing and caching

**Phase 4: Test Suite Organization** (Future)
1. Implement unique session IDs per test
2. Enable parallel execution
3. Add test fixtures for common scenarios
4. Create chunk logger testing best practices guide

---

## Open Questions

1. **Should we test the download button functionality separately?**
   - If we move to API access, we lose coverage of the download button
   - Recommendation: Keep 1 simple download test, use API for consistency tests

2. **How should we handle log retention?**
   - Currently logs accumulate indefinitely
   - Options: Auto-cleanup after N days, max file count, manual cleanup script
   - Recommendation: Add `just clean-logs` command to clean old chunk logs

3. **Should chunk logger tests be separate from other E2E tests?**
   - Currently mixed with tool approval tests
   - Options: Separate test suite, dedicated CI job
   - Recommendation: Keep integrated but add `--grep` tags for selective execution

---

## Success Metrics

1. **Reliability**: All chunk logger integration tests pass consistently (3+ consecutive runs)
2. **Performance**: Test execution time < 2 minutes for full chunk logger suite
3. **Coverage**: 100% of 4 tools × 2 modes × 2 approval methods matrix covered
4. **Maintainability**: No duplicated path construction logic

---

## Next Steps

1. ⏳ Verify current fix resolves test failures
2. ⏳ Commit fix with detailed commit message
3. ⏳ Create GitHub issue for Phase 2 (Backend API Access)
4. ⏳ Update experiment notes with findings
