/**
 * SSE Mode useChat Options Builder
 *
 * Constructs useChat hook options for SSE-based modes (Gemini, ADK SSE).
 * Handles HTTP streaming transport creation and endpoint configuration.
 */

import type { UIMessage } from "@ai-sdk/react";
import { ChunkLoggingTransport } from "@/lib/chunk_logs";
import { sendAutomaticallyWhen } from "./send-automatically-when";
import { createSseTransport } from "./transport";

/**
 * SSE mode type
 */
export type SseMode = "gemini" | "adk-sse";

/**
 * SSE mode configuration
 */
export interface SseUseChatConfig {
  /** SSE mode (gemini or adk-sse) */
  mode: SseMode;

  /** Initial messages for the chat */
  initialMessages: UIMessage[];

  /** API endpoint override (optional) */
  apiEndpoint?: string;

  /** ADK backend URL (for adk-sse mode, defaults to http://localhost:8000) */
  adkBackendUrl?: string;

  /** Force new chat instance (for testing) */
  forceNewInstance?: boolean;
}

/**
 * SSE mode useChat options
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
  /** No transport reference for SSE mode (uses DefaultChatTransport internally) */
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
