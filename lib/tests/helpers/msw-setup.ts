/**
 * MSW Server Test Setup Helper
 *
 * Provides standardized MSW server lifecycle management for tests.
 *
 * Usage:
 * ```typescript
 * import { setupMswServer } from '@/lib/tests/helpers';
 *
 * const server = setupMswServer();
 * ```
 */

import { afterAll, afterEach, beforeAll } from "vitest";
import { createMswServer } from "../mocks/msw-server";

/**
 * Setup MSW server with standard lifecycle hooks.
 *
 * Automatically registers:
 * - beforeAll: Start server with error on unhandled requests
 * - afterEach: Reset handlers to prevent test pollution
 * - afterAll: Close server for cleanup
 *
 * @param options - Optional configuration
 * @param options.onUnhandledRequest - MSW unhandled request behavior (default: 'error')
 *   Can be a string ("error" | "warn" | "bypass") or a custom handler function
 * @returns MSW server instance for handler customization
 *
 * @example Basic usage
 * ```typescript
 * const server = setupMswServer();
 * ```
 *
 * @example Custom unhandled request handler
 * ```typescript
 * const server = setupMswServer({
 *   onUnhandledRequest(request) {
 *     if (request.url.includes('/websocket')) return; // Ignore WebSocket
 *     console.error('Unhandled:', request.method, request.url);
 *   }
 * });
 * ```
 *
 * @example Customize handlers for specific tests
 * ```typescript
 * const server = setupMswServer();
 * server.use(
 *   http.post('/api/custom', () => {
 *     return HttpResponse.json({ data: 'test' });
 *   })
 * );
 * ```
 */
export function setupMswServer(options?: {
  onUnhandledRequest?:
    | "error"
    | "warn"
    | "bypass"
    | ((request: Request) => void);
}) {
  const server = createMswServer();

  beforeAll(() =>
    server.listen({
      onUnhandledRequest: options?.onUnhandledRequest ?? "error",
    }),
  );

  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  return server;
}
