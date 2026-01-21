/**
 * Vitest Global Teardown
 *
 * Forces cleanup of any remaining resources after tests complete.
 * This addresses the msw WebSocket cleanup issue that causes
 * libuv uv__stream_destroy assertion failures.
 */

export default async function globalTeardown() {
  // Force garbage collection if available (--expose-gc flag)
  if (typeof global.gc === "function") {
    global.gc();
  }

  // Small delay to allow pending operations to complete
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Clear any remaining timers
  // biome-ignore lint/suspicious/noExplicitAny: Node.js internal access
  const activeTimers = (globalThis as any)._activeTimers;
  if (activeTimers) {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
  }
}
