/**
 * MSW Server Pool for Parallel Test Execution
 *
 * Manages a pool of MSW server instances to avoid repeated server creation/destruction.
 * This helps with:
 * - Reducing test overhead (create servers once per worker)
 * - Avoiding cleanup issues (close servers only at teardown)
 * - Enabling parallel test execution without race conditions
 *
 * Usage:
 * ```typescript
 * import { useMswServerFromPool } from '@/lib/tests/helpers';
 *
 * describe('my tests', () => {
 *   const { getServer } = useMswServerFromPool();
 *
 *   it('test', () => {
 *     const server = getServer();
 *     server.use(http.get('/api/...', () => ...));
 *   });
 * });
 * ```
 */

import type { SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { createMswServer } from "../shared-mocks/msw-server";
import { clearBidiWebSocketLinks } from "./bidi-ws-handlers";

// Pool state (per-worker since vitest forks mode runs in separate processes)
let pooledServer: SetupServer | null = null;
let isServerListening = false;

/**
 * Initialize the MSW server pool.
 * Called automatically when tests start.
 */
export function initMswServerPool(): void {
  if (!pooledServer) {
    pooledServer = createMswServer();
  }
}

/**
 * Get the shared MSW server instance.
 * Creates one if not already initialized.
 */
export function getPooledServer(): SetupServer {
  if (!pooledServer) {
    initMswServerPool();
  }
  return pooledServer!;
}

/**
 * Start listening on the pooled server if not already listening.
 */
export function startPooledServer(
  options?: Parameters<SetupServer["listen"]>[0],
): void {
  if (!isServerListening) {
    getPooledServer().listen(options);
    isServerListening = true;
  }
}

/**
 * Reset handlers on the pooled server (for test isolation).
 */
export function resetPooledServer(): void {
  if (pooledServer) {
    pooledServer.resetHandlers();
  }
}

/**
 * Close the MSW server pool.
 * Called at global teardown.
 */
export function closeMswServerPool(): void {
  if (pooledServer && isServerListening) {
    pooledServer.close();
    isServerListening = false;
  }
  pooledServer = null;
}

/**
 * React hook-style helper for using the pooled MSW server in tests.
 *
 * Automatically manages lifecycle:
 * - beforeAll: Starts the server (if not already started)
 * - afterEach: Resets handlers
 * - afterAll: Keeps server running (closed at global teardown)
 *
 * @param options - Configuration options
 * @returns Object with getServer() function
 *
 * @example
 * ```typescript
 * describe('my tests', () => {
 *   const { getServer } = useMswServerFromPool();
 *
 *   it('should mock API', () => {
 *     const server = getServer();
 *     server.use(http.get('/api/data', () => HttpResponse.json({ ok: true })));
 *     // test code
 *   });
 * });
 * ```
 */
/**
 * @deprecated Use `useMswServer` instead for proper WebSocket cleanup.
 * This pooled version causes WebSocket event listener accumulation.
 */
export function useMswServerFromPool(options?: {
  onUnhandledRequest?:
    | "error"
    | "warn"
    | "bypass"
    | ((request: Request) => void);
}): { getServer: () => SetupServer } {
  beforeAll(() => {
    startPooledServer({
      onUnhandledRequest: options?.onUnhandledRequest ?? "warn",
    });
  });

  afterEach(() => {
    resetPooledServer();
  });

  // Note: We don't close the server in afterAll.
  // The server is closed at global teardown instead.
  afterAll(() => {
    // Intentionally empty - server stays alive for other test suites
  });

  return {
    getServer: () => getPooledServer(),
  };
}

/**
 * MSW Server helper with proper cleanup for WebSocket tests.
 *
 * Creates a new MSW server per describe block and closes it in afterAll.
 * This ensures WebSocket event listeners are properly cleaned up,
 * preventing "Worker exited unexpectedly" errors in parallel execution.
 *
 * Key difference from useMswServerFromPool:
 * - Pool: Shares server across all tests → WebSocket listeners accumulate
 * - This: Creates/destroys server per describe → Clean slate each time
 *
 * @param options - Configuration options
 * @returns Object with getServer() function
 *
 * @example
 * ```typescript
 * describe('my tests', () => {
 *   const { getServer } = useMswServer();
 *
 *   it('should mock WebSocket', () => {
 *     const server = getServer();
 *     const chat = createBidiWebSocketLink();
 *     server.use(createCustomHandler(chat, ...));
 *   });
 * });
 * ```
 */
export function useMswServer(options?: {
  onUnhandledRequest?:
    | "error"
    | "warn"
    | "bypass"
    | ((request: Request) => void);
}): { getServer: () => SetupServer } {
  let server: SetupServer | null = null;

  beforeAll(() => {
    server = createMswServer();
    server.listen({
      onUnhandledRequest: options?.onUnhandledRequest ?? "warn",
    });
  });

  afterEach(() => {
    server?.resetHandlers();
  });

  afterAll(async () => {
    // Step 1: Clear tracked WebSocket clients first (server-side)
    // This closes any WebSocket connections tracked by our handlers
    clearBidiWebSocketLinks();

    // Step 2: Dynamically import to avoid circular dependency issues
    const { closeAllBidiTransports } = await import("../../bidi");

    // Step 3: Close all BIDI transports (client-side WebSocket connections)
    closeAllBidiTransports();

    // Step 4: Yield to event loop to allow close events to propagate
    await new Promise((resolve) => setImmediate(resolve));

    // Step 5: Wait for libuv to process close events
    // 200ms is needed because libuv I/O watchers need time to deactivate
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Step 6: Close MSW server (this triggers interceptor cleanup)
    server?.close();
    server = null;

    // Step 7: Final yield to ensure all cleanup completes
    await new Promise((resolve) => setImmediate(resolve));

    // Step 8: Final delay for libuv stream destruction
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  return {
    getServer: () => {
      if (!server) {
        throw new Error("MSW server not initialized. Ensure useMswServer() is called inside a describe block.");
      }
      return server;
    },
  };
}
