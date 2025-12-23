/**
 * BIDI Mode useChat Options Builder
 *
 * Constructs useChat hook options for ADK BIDI mode (WebSocket).
 * Handles WebSocket transport creation, audio context integration,
 * and confirmation flow configuration.
 */

import type { UIMessage } from "@ai-sdk/react";
import { ChunkLoggingTransport } from "@/lib/chunk_logs";
import type { AudioContextValue } from "@/lib/types";
import { sendAutomaticallyWhen } from "./send-automatically-when";
import { WebSocketChatTransport } from "./transport";

/**
 * BIDI mode configuration
 */
export interface BidiUseChatConfig {
  /** Initial messages for the chat */
  initialMessages: UIMessage[];

  /** ADK backend URL (e.g., http://localhost:8000) */
  adkBackendUrl?: string;

  /** Force new chat instance (for testing) */
  forceNewInstance?: boolean;

  /** Optional AudioContext for PCM streaming */
  audioContext?: AudioContextValue;
}

/**
 * BIDI mode useChat options with transport reference
 */
export interface BidiUseChatOptions {
  useChatOptions: {
    transport: ChunkLoggingTransport;
    messages: UIMessage[];
    id: string;
    sendAutomaticallyWhen: (options: {
      messages: UIMessage[];
    }) => boolean | PromiseLike<boolean>;
  };
  /** WebSocket transport reference for imperative control */
  transport: WebSocketChatTransport;
}

/**
 * Build useChat options for ADK BIDI mode
 *
 * Creates WebSocket transport with audio support and confirmation flow.
 *
 * @param config - BIDI mode configuration
 * @returns useChat options with transport reference
 *
 * @example
 * ```typescript
 * const { useChatOptions, transport } = buildBidiUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 *   audioContext,
 * });
 *
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 */
export function buildBidiUseChatOptions({
  initialMessages,
  adkBackendUrl = "http://localhost:8000",
  forceNewInstance = false,
  audioContext,
}: BidiUseChatConfig): BidiUseChatOptions {
  // Compute WebSocket URL
  const wsUrl = `${adkBackendUrl.replace(/^http/, "ws")}/live`;

  // Generate unique chatId that includes endpoint hash
  // This ensures a new Chat instance is created when the endpoint changes
  const endpointHash = wsUrl.replace(/[^a-zA-Z0-9]/g, "-");
  const chatId = forceNewInstance
    ? `chat-adk-bidi-${endpointHash}-${Date.now()}`
    : `chat-adk-bidi-${endpointHash}`;

  // Create WebSocket transport
  const websocketTransport = new WebSocketChatTransport({
    url: wsUrl,
    audioContext, // Pass AudioContext for PCM streaming
  });

  // Expose transport to window for E2E testing (only in development/test)
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as any).webSocketTransport = websocketTransport;
  }

  // Wrap with chunk logging transport (for debugging)
  const transport = new ChunkLoggingTransport(websocketTransport, "adk-bidi");

  return {
    useChatOptions: {
      messages: initialMessages,
      id: chatId,
      transport,
      sendAutomaticallyWhen,
    },
    transport: websocketTransport,
  };
}
