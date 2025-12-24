/**
 * SSE Mode useChat Options Builder
 *
 * Constructs AI SDK v6 useChat hook configuration for SSE-based communication modes.
 * Supports both Gemini (direct API) and ADK SSE (with tool confirmation) modes.
 * This module handles HTTP streaming transport creation, endpoint configuration,
 * and mode-specific setup.
 *
 * Key Responsibilities:
 * - Create SseChatTransport for HTTP SSE streaming
 * - Configure API endpoint based on mode (Gemini or ADK SSE)
 * - Wrap transport with ChunkLoggingTransport for debugging/replay
 * - Configure sendAutomaticallyWhen for ADK SSE mode (tool confirmation)
 * - Generate unique chat IDs to ensure proper useChat instance management
 *
 * Dependencies:
 * - AI SDK v6: useChat hook, UIMessage types
 * - SseChatTransport: HTTP SSE streaming transport
 * - ChunkLoggingTransport: Transparent logging wrapper
 * - sendAutomaticallyWhen: Tool confirmation trigger (ADK SSE mode only)
 */

import type { UIMessage } from "@ai-sdk/react";
import { ChunkLoggingTransport } from "@/lib/chunk_logs";
import { sendAutomaticallyWhen } from "./send-automatically-when";
import { createSseTransport } from "./transport";

/**
 * SSE Mode Type
 *
 * Defines the two supported SSE communication modes.
 *
 * @property gemini - Direct Gemini API via Next.js API route (no ADK backend)
 * @property adk-sse - ADK protocol over HTTP SSE with tool confirmation support
 */
export type SseMode = "gemini" | "adk-sse";

/**
 * SSE Mode Configuration
 *
 * Configuration object for building SSE mode useChat options.
 *
 * @property mode - SSE communication mode (gemini or adk-sse)
 * @property initialMessages - Initial conversation history to display in the chat UI
 * @property apiEndpoint - Optional API endpoint override for custom backend URLs
 * @property adkBackendUrl - ADK backend URL (adk-sse mode only, default: http://localhost:8000)
 * @property forceNewInstance - Force creation of new chat instance instead of reusing
 *                              existing one (useful for test isolation)
 */
export interface SseUseChatConfig {
  mode: SseMode;
  initialMessages: UIMessage[];
  apiEndpoint?: string;
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
}

/**
 * SSE Mode useChat Options
 *
 * Return type from buildSseUseChatOptions containing useChat configuration.
 *
 * @property useChatOptions - Configuration object to pass to AI SDK's useChat hook
 * @property useChatOptions.transport - ChunkLoggingTransport wrapping SseChatTransport
 * @property useChatOptions.messages - Initial messages for the conversation
 * @property useChatOptions.id - Unique chat instance ID (based on mode and endpoint)
 * @property useChatOptions.sendAutomaticallyWhen - Auto-send trigger (ADK SSE mode only, undefined for gemini)
 * @property transport - Always undefined for SSE modes (no imperative control needed)
 *                       SSE uses standard HTTP requests, no persistent connection to manage
 */
export interface SseUseChatOptions {
  useChatOptions: {
    transport: ChunkLoggingTransport;
    messages: UIMessage[];
    id: string;
    sendAutomaticallyWhen?: (options: {
      messages: UIMessage[];
    }) => boolean | PromiseLike<boolean>;
  };
  transport: undefined;
}

/**
 * Build useChat options for SSE modes (Gemini, ADK SSE)
 *
 * Creates HTTP streaming transport with endpoint configuration.
 *
 * @param config - SSE mode configuration
 * @returns useChat options
 *
 * @example
 * ```typescript
 * // Gemini mode
 * const { useChatOptions } = buildSseUseChatOptions({
 *   mode: 'gemini',
 *   initialMessages: [],
 * });
 *
 * // ADK SSE mode
 * const { useChatOptions } = buildSseUseChatOptions({
 *   mode: 'adk-sse',
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 * });
 * ```
 */
export function buildSseUseChatOptions({
  mode,
  initialMessages,
  apiEndpoint,
  adkBackendUrl = "http://localhost:8000",
  forceNewInstance = false,
}: SseUseChatConfig): SseUseChatOptions {
  // Compute API endpoint based on mode
  const endpoint =
    apiEndpoint ??
    (mode === "adk-sse" ? `${adkBackendUrl}/stream` : "/api/chat");

  // Generate unique chatId that includes endpoint hash
  // This ensures a new Chat instance is created when the endpoint changes
  const endpointHash = endpoint.replace(/[^a-zA-Z0-9]/g, "-");
  const chatId = forceNewInstance
    ? `chat-${mode}-${endpointHash}-${Date.now()}`
    : `chat-${mode}-${endpointHash}`;

  // WORKAROUND: Use prepareSendMessagesRequest to override endpoint
  // This is the proper extension point in AI SDK v6 for dynamic endpoint routing
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 type definition requires body field which breaks functionality
  const prepareSendMessagesRequest = async (options: any) => {
    // IMPORTANT: Don't return `body` field - let AI SDK construct it
    // If we return body: {}, AI SDK will use that empty object instead of building the proper request
    const { body: _body, ...restOptions } = options;
    return {
      ...restOptions,
      api: endpoint, // Override with correct endpoint for this mode
    };
  };

  // Create SSE transport
  const baseTransport = createSseTransport({
    api: endpoint,
    prepareSendMessagesRequest,
  });

  // Wrap with chunk logging transport (for debugging)
  const transport = new ChunkLoggingTransport(baseTransport, mode);

  // Build options (with confirmation flow for adk-sse only)
  const useChatOptions = {
    messages: initialMessages,
    id: chatId,
    transport,
    ...(mode === "adk-sse" && {
      sendAutomaticallyWhen,
    }),
  };

  return {
    useChatOptions,
    transport: undefined,
  };
}
