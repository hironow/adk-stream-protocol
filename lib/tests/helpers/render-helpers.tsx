/**
 * React Testing Helpers
 * Provides reusable rendering utilities for React component tests
 */

import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * Common wrapper options for renderHook
 */
export interface RenderHookOptions<TProps = unknown> {
  initialProps?: TProps;
  wrapper?: React.ComponentType<{ children: ReactNode }>;
}

/**
 * Renders a hook and waits for async updates
 * Useful for hooks that have async initialization
 */
export async function renderHookAndWait<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: RenderHookOptions<TProps>,
) {
  const result = renderHook(hook, options);
  await waitFor(() => {
    // Wait for any pending updates
  });
  return result;
}

/**
 * Creates a mock component for testing
 */
export function createMockComponent(name: string) {
  const MockComponent = ({ children }: { children?: ReactNode }) => {
    return <div data-testid={name}>{children}</div>;
  };
  MockComponent.displayName = name;
  return MockComponent;
}

/**
 * Waits for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout = 1000,
  interval = 50,
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Condition not met within ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Flushes all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
