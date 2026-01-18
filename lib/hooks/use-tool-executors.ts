/**
 * useToolExecutors - Frontend Execute ツールの実行ロジック
 *
 * コンポーネントから実行ロジックを分離し、拡張可能な形式で提供。
 * ADR 0005 (Frontend Execute pattern) 参照。
 *
 * @module hooks/use-tool-executors
 */

"use client";

import { useCallback, useMemo } from "react";
import { useAudio } from "@/lib/audio-context";

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutorResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface ToolExecutorDependencies {
  bgmChannel?: {
    currentTrack: number;
    switchTrack: () => void;
  };
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  deps: ToolExecutorDependencies
) => Promise<ToolExecutorResult>;

// ============================================================================
// Executors (純粋ロジック - React非依存)
// ============================================================================

/**
 * get_location executor
 * navigator.geolocation を使用して現在地を取得
 */
export async function executeGetLocation(): Promise<ToolExecutorResult> {
  try {
    const position = await new Promise<GeolocationPosition>(
      (resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        });
      }
    );

    return {
      success: true,
      output: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Geolocation failed",
    };
  }
}

/**
 * change_bgm executor
 * bgmChannel を使用してBGMトラックを切り替え
 */
export async function executeChangeBgm(
  input: Record<string, unknown>,
  deps: ToolExecutorDependencies
): Promise<ToolExecutorResult> {
  const { bgmChannel } = deps;

  if (!bgmChannel) {
    return { success: false, error: "BGM channel not available" };
  }

  const requestedTrack = (input.track as number) || 1;
  const targetAudioTrack = requestedTrack - 1;

  if (bgmChannel.currentTrack !== targetAudioTrack) {
    bgmChannel.switchTrack();
    console.info(
      `[executeChangeBgm] BGM switched: ${bgmChannel.currentTrack} → ${targetAudioTrack}`
    );
  } else {
    console.info(
      `[executeChangeBgm] BGM already on track ${targetAudioTrack}`
    );
  }

  return {
    success: true,
    output: {
      track: requestedTrack,
      message: `BGM changed to track ${requestedTrack}`,
    },
  };
}

// ============================================================================
// Executor Registry
// ============================================================================

const executorRegistry = new Map<string, ToolExecutor>([
  ["get_location", executeGetLocation],
  ["change_bgm", executeChangeBgm],
]);

/**
 * Register a custom tool executor.
 * Use this when adding new browser-API tools at runtime or in app initialization.
 *
 * @example
 * registerToolExecutor("scan_qr_code", async (input, deps) => {
 *   // QR code scanning logic
 *   return { success: true, output: { code: "..." } };
 * });
 */
export function registerToolExecutor(
  toolName: string,
  executor: ToolExecutor
): void {
  executorRegistry.set(toolName, executor);
}

/**
 * Get executor for a tool.
 */
export function getToolExecutor(toolName: string): ToolExecutor | undefined {
  return executorRegistry.get(toolName);
}

/**
 * Check if an executor is available for the tool.
 */
export function hasToolExecutor(toolName: string): boolean {
  return executorRegistry.has(toolName);
}

/**
 * Clear all registered executors and reset to defaults.
 * Primarily for testing purposes.
 */
export function resetToolExecutors(): void {
  executorRegistry.clear();
  executorRegistry.set("get_location", executeGetLocation);
  executorRegistry.set("change_bgm", executeChangeBgm);
}

// ============================================================================
// React Hook
// ============================================================================

/**
 * useToolExecutors - Frontend Execute ツール実行用 Hook
 *
 * 依存性を解決し、ツール名からexecutorを実行する関数を提供。
 *
 * @example
 * const { execute, isExecutorAvailable } = useToolExecutors();
 *
 * if (isExecutorAvailable(toolName)) {
 *   const result = await execute(toolName, input);
 *   addToolOutput({ tool: toolName, toolCallId, output: result.output });
 * }
 */
export function useToolExecutors() {
  const { bgmChannel } = useAudio();

  const deps: ToolExecutorDependencies = useMemo(
    () => ({
      bgmChannel,
    }),
    [bgmChannel]
  );

  const execute = useCallback(
    async (
      toolName: string,
      input: Record<string, unknown>
    ): Promise<ToolExecutorResult> => {
      const executor = getToolExecutor(toolName);

      if (!executor) {
        return { success: false, error: `No executor for tool: ${toolName}` };
      }

      console.info(`[useToolExecutors] Executing ${toolName} on client`);
      return executor(input, deps);
    },
    [deps]
  );

  const isExecutorAvailable = useCallback((toolName: string): boolean => {
    return hasToolExecutor(toolName);
  }, []);

  return { execute, isExecutorAvailable };
}
