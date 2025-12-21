/**
 * E2E Environment Setup Helpers
 *
 * Utilities for setting up E2E test environment with real or mocked backend.
 */

/**
 * Wait for backend to be ready
 */
export async function waitForBackend(
  url: string = "http://localhost:8000/health",
  timeout: number = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Backend not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend not ready after ${timeout}ms`);
}

/**
 * Wait for frontend to be ready
 */
export async function waitForFrontend(
  url: string = "http://localhost:3000",
  timeout: number = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Frontend not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Frontend not ready after ${timeout}ms`);
}

/**
 * Create test session for E2E tests
 */
export async function createTestSession(): Promise<{
  sessionId: string;
  cleanup: () => Promise<void>;
}> {
  const sessionId = `e2e-test-${Date.now()}`;

  const cleanup = async () => {
    // Cleanup session-specific data
    // This would be implemented based on actual storage mechanism
  };

  return { sessionId, cleanup };
}

/**
 * Reset browser storage for clean test state
 */
export async function resetBrowserStorage(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.clear();
    sessionStorage.clear();
    // Clear IndexedDB if used
    if (window.indexedDB) {
      const databases = await window.indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
  }
}

/**
 * Setup mock backend responses for E2E tests
 * Can be used instead of real backend for faster tests
 */
export function setupMockBackend(): {
  mockWebSocket: (url: string, responses: string[]) => void;
  mockHTTP: (pattern: string | RegExp, response: unknown) => void;
  cleanup: () => void;
} {
  const mocks: Array<() => void> = [];

  return {
    mockWebSocket: (_url: string, _responses: string[]) => {
      // TODO: Implement WebSocket mocking for E2E
      // Could use service worker or proxy
    },
    mockHTTP: (_pattern: string | RegExp, _response: unknown) => {
      // TODO: Implement HTTP mocking for E2E
      // Could use MSW service worker
    },
    cleanup: () => {
      for (const cleanupFn of mocks) {
        cleanupFn();
      }
    },
  };
}
