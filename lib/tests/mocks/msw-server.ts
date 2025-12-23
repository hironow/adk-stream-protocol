/**
 * MSW Server Setup for Integration Tests
 *
 * Provides a configured MSW server instance for HTTP and WebSocket request mocking.
 * Use this in integration tests to intercept HTTP/SSE and WebSocket requests.
 */

import { ws } from "msw";
import { setupServer } from "msw/node";

/**
 * Create MSW server for integration tests
 *
 * @returns Configured MSW server instance
 *
 * @example
 * ```typescript
 * import { createMswServer } from '@/lib/tests/mocks/msw-server';
 *
 * const server = createMswServer();
 *
 * beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 */
export function createMswServer() {
  return setupServer();
}
