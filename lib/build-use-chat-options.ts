/**
 * useChat Options Builder - Mode Dispatcher
 *
 * Central entry point for building AI SDK v6 useChat options across different backend modes.
 * This module routes configuration requests to mode-specific builders based on the selected
 * communication protocol.
 *
 * Supported Modes:
 * - adk-bidi: Bidirectional WebSocket transport with ADK protocol (lib/bidi/use-chat-options.ts)
 * - adk-sse: Server-Sent Events with ADK tool confirmation (lib/sse/use-chat-options.ts)
 * - gemini: Direct Gemini API via SSE, no ADK dependency (lib/sse/use-chat-options.ts)
 *
 * Dependencies:
 * - AI SDK v6: ChatTransport interface, UIMessage types
 * - lib/bidi: WebSocket-based bidirectional transport
 * - lib/sse: SSE-based transports (both ADK and Gemini)
 * - lib/chunk_logs: ChunkPlayerTransport for deterministic E2E testing
 *
 * Key Responsibilities:
 * - Route configuration to appropriate mode-specific builder
 * - Handle E2E test mode with ChunkPlayerTransport
 * - Provide unified type definitions for all modes
 *
 * Note: AI SDK v6 useChat hook does not respect the `api` prop for endpoint configuration.
 * Mode-specific builders work around this by using prepareSendMessagesRequest to override
 * the endpoint. See experiments/2025-12-11_e2e_test_timeout_investigation.md:440-513.
 */

import type { AudioContextValue } from "@/lib/audio-context";
import {
  type ChatTransport as BidiChatTransport,
  buildUseChatOptions as buildBidiUseChatOptions,
} from "@/lib/bidi";
import {
  type ChunkLoggingTransport,
  ChunkPlayerTransport,
} from "@/lib/chunk_logs";
import { buildUseChatOptions as buildSseUseChatOptions } from "@/lib/sse";
import type { Mode, UIMessageFromAISDKv6 } from "@/lib/utils";

// Re-export Mode for convenience
export type { Mode };

// Type alias for backward compatibility
export type BackendMode = Mode;

/**
 * Return type for buildUseChatOptions
 *
 * Contains both the useChat options object and an optional transport reference
 * for imperative control (e.g., closing connections, accessing internal state).
 *
 * @property useChatOptions - Configuration object to pass to AI SDK's useChat hook
 * @property transport - Optional reference to the underlying transport (BIDI mode only)
 *                       - Present for adk-bidi mode to allow connection management
 *                       - Undefined for SSE modes and test mode (no imperative control needed)
 */
export interface UseChatOptionsWithTransport {
  useChatOptions: {
    transport: BidiChatTransport | ChunkLoggingTransport | ChunkPlayerTransport;
    messages: UIMessageFromAISDKv6[];
    id: string;
    sendAutomaticallyWhen?: (options: {
      messages: UIMessageFromAISDKv6[];
    }) => boolean | PromiseLike<boolean>;
  };
  transport?: BidiChatTransport;
}

/**
 * Build AI SDK v6 useChat options based on backend communication mode
 *
 * Central dispatcher that routes configuration to the appropriate mode-specific builder.
 * Supports E2E test mode detection via localStorage for deterministic testing.
 *
 * Mode Routing:
 * - adk-bidi → lib/bidi/use-chat-options.ts (WebSocket bidirectional transport)
 * - adk-sse → lib/sse/use-chat-options.ts (SSE with ADK tool confirmation)
 * - gemini → lib/sse/use-chat-options.ts (Direct Gemini API, no ADK)
 *
 * E2E Test Mode:
 * When localStorage.E2E_CHUNK_PLAYER_MODE === "true", uses ChunkPlayerTransport
 * with fixture from localStorage.E2E_CHUNK_PLAYER_FIXTURE for deterministic replay.
 *
 * @param config - Configuration object
 * @param config.mode - Backend communication mode (adk-bidi | adk-sse | gemini)
 * @param config.initialMessages - Initial conversation history to display
 * @param config.adkBackendUrl - ADK backend URL (default: process.env.NEXT_PUBLIC_ADK_BACKEND_URL || http://localhost:8000)
 * @param config.forceNewInstance - Force new chat instance instead of reusing (for testing isolation)
 * @param config.audioContext - Optional AudioContext for PCM audio streaming (adk-bidi mode only)
 * @returns useChat configuration object with optional transport reference for imperative control
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
  apiEndpoint,
}: {
  mode: Mode;
  initialMessages: UIMessageFromAISDKv6[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
  apiEndpoint?: string;
}): UseChatOptionsWithTransport {
  // E2E Test Mode Detection: Check localStorage for ChunkPlayerTransport mode
  // This allows E2E tests to replay pre-recorded responses deterministically
  if (typeof window !== "undefined") {
    const isChunkPlayerMode =
      window.localStorage.getItem("E2E_CHUNK_PLAYER_MODE") === "true";

    if (isChunkPlayerMode) {
      const fixturePath = window.localStorage.getItem(
        "E2E_CHUNK_PLAYER_FIXTURE",
      );

      if (fixturePath) {
        // Create ChunkPlayerTransport with lazy fixture loading
        // Fixture is loaded on first sendMessages() call for better performance
        const transport = ChunkPlayerTransport.fromFixture(fixturePath);
        const chatId = `chunk-player-${mode}`;

        // Get mode-specific sendAutomaticallyWhen for testing
        // Even though we're using ChunkPlayerTransport, we still want to test
        // that sendAutomaticallyWhen would be called correctly
        // biome-ignore lint/suspicious/noExplicitAny: Type varies by mode, unified typing not worth complexity
        let sendAutomaticallyWhen: any;
        if (mode === "adk-bidi") {
          const bidiOptions = buildBidiUseChatOptions({
            initialMessages,
            adkBackendUrl,
            forceNewInstance,
            audioContext,
          });
          sendAutomaticallyWhen =
            bidiOptions.useChatOptions.sendAutomaticallyWhen;
        } else if (mode === "adk-sse" || mode === "gemini") {
          const sseOptions = buildSseUseChatOptions({
            mode,
            initialMessages,
            adkBackendUrl,
            forceNewInstance,
          });
          sendAutomaticallyWhen =
            sseOptions.useChatOptions.sendAutomaticallyWhen;
        }

        return {
          useChatOptions: {
            messages: initialMessages,
            id: chatId,
            transport,
            sendAutomaticallyWhen,
          },
          transport: undefined, // No imperative control needed for test mode
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
        apiEndpoint,
      });

    case "gemini":
      return buildSseUseChatOptions({
        mode: "gemini",
        initialMessages,
        forceNewInstance,
        apiEndpoint,
      });

    default: {
      // Exhaustiveness check: TypeScript ensures all Mode variants are handled
      // This line will cause a compile error if a new mode is added but not handled
      const exhaustiveCheck: never = mode;
      throw new Error(`Unhandled backend mode: ${exhaustiveCheck}`);
    }
  }
}
