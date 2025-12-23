/**
 * useChat Options Builder - Mode Dispatcher
 *
 * 🟡 Multi-Mode Support - Routes to appropriate mode-specific builder
 *
 * Routes useChat hook configuration to mode-specific builders:
 * - BIDI mode: lib/bidi/use-chat-options.ts (🔴 ADK BIDI)
 * - SSE modes: lib/sse/use-chat-options.ts
 *   - adk-sse: 🟡 ADK tool confirmation
 *   - gemini: ⚪ No ADK dependency
 *
 * Dependencies:
 * - AI SDK v6 (ChatTransport, UIMessage)
 * - lib/bidi (ADK BIDI protocol)
 * - lib/sse (SSE modes)
 * - lib/chunk-player-transport (E2E testing)
 *
 * This file handles:
 * - E2E test mode (ChunkPlayerTransport)
 * - Mode routing
 * - Type definitions
 *
 * KNOWN ISSUE: AI SDK v6 useChat hook does not respect `api` prop
 * - Investigation: experiments/2025-12-11_e2e_test_timeout_investigation.md:440-513
 * - Symptom: All HTTP requests go to the first endpoint regardless of `api` value
 * - Solution: Mode-specific builders use prepareSendMessagesRequest to override endpoint
 */

import type { UIMessage } from "@ai-sdk/react";
import {
  type ChatTransport as BidiChatTransport,
  buildUseChatOptions as buildBidiUseChatOptions,
} from "@/lib/bidi";
import {
  type ChunkLoggingTransport,
  ChunkPlayerTransport,
} from "@/lib/chunk_logs";
import { buildUseChatOptions as buildSseUseChatOptions } from "@/lib/sse";
import type { AudioContextValue, Mode } from "@/lib/types";

// Re-export Mode for convenience
export type { Mode };

/**
 * Return type for buildUseChatOptions
 * Includes useChat options and optional transport reference for imperative control
 */
export interface UseChatOptionsWithTransport {
  useChatOptions: {
    transport: BidiChatTransport | ChunkLoggingTransport | ChunkPlayerTransport;
    messages: UIMessage[];
    id: string;
    sendAutomaticallyWhen?: (options: {
      messages: UIMessage[];
    }) => boolean | PromiseLike<boolean>;
  };
  transport?: BidiChatTransport;
}

/**
 * Build useChat options based on backend mode
 *
 * Routes to mode-specific builders:
 * - adk-bidi: BIDI WebSocket transport (lib/bidi/use-chat-options.ts)
 * - adk-sse: ADK SSE transport (lib/sse/use-chat-options.ts)
 * - gemini: Gemini SSE transport (lib/sse/use-chat-options.ts)
 *
 * Special modes:
 * - E2E test mode: ChunkPlayerTransport (deterministic testing)
 *
 * @param mode - Backend mode
 * @param initialMessages - Initial chat messages
 * @param adkBackendUrl - ADK backend URL (default: http://localhost:8000)
 * @param forceNewInstance - Force new chat instance (for testing)
 * @param audioContext - Optional AudioContext for BIDI PCM streaming
 * @returns useChat options with optional transport reference
 */
export function buildUseChatOptions({
  mode,
  initialMessages,
  adkBackendUrl = typeof process !== "undefined" &&
  process.env?.NEXT_PUBLIC_ADK_BACKEND_URL
    ? process.env.NEXT_PUBLIC_ADK_BACKEND_URL
    : "http://localhost:8000",
  forceNewInstance = false,
  audioContext,
}: {
  mode: Mode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
}): UseChatOptionsWithTransport {
  // E2E Test Mode: Use ChunkPlayerTransport for deterministic testing
  if (typeof window !== "undefined") {
    const isChunkPlayerMode =
      window.localStorage.getItem("E2E_CHUNK_PLAYER_MODE") === "true";

    if (isChunkPlayerMode) {
      const fixturePath = window.localStorage.getItem(
        "E2E_CHUNK_PLAYER_FIXTURE",
      );

      if (fixturePath) {
        // Create chunk player transport (lazy loading - fixture loaded on first sendMessages)
        const transport = ChunkPlayerTransport.fromFixture(fixturePath);
        const chatId = `chunk-player-${mode}`;
        return {
          useChatOptions: {
            messages: initialMessages,
            id: chatId,
            transport,
          },
          transport: undefined,
        };
      }
    }
  }

  // Route to mode-specific builders
  switch (mode) {
    case "adk-bidi":
      return buildBidiUseChatOptions({
        initialMessages,
        adkBackendUrl,
        forceNewInstance,
        audioContext,
      });

    case "adk-sse":
      return buildSseUseChatOptions({
        mode: "adk-sse",
        initialMessages,
        adkBackendUrl,
        forceNewInstance,
      });

    case "gemini":
      return buildSseUseChatOptions({
        mode: "gemini",
        initialMessages,
        forceNewInstance,
      });

    default: {
      // TypeScript will catch this at compile time if we add a new mode
      const exhaustiveCheck: never = mode;
      throw new Error(`Unhandled backend mode: ${exhaustiveCheck}`);
    }
  }
}
