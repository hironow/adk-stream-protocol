/**
 * BIDI Mode useChat Options Builder
 *
 * Constructs AI SDK v6 useChat hook configuration for ADK BIDI mode (WebSocket).
 * This module handles the complete setup of WebSocket bidirectional communication,
 * including transport creation, audio context integration, chunk logging, and
 * automatic send triggers for tool confirmation workflow.
 *
 * Key Responsibilities:
 * - Create WebSocketChatTransport with proper URL conversion (HTTP → WS)
 * - Integrate AudioContext for real-time PCM audio streaming
 * - Wrap transport with ChunkLoggingTransport for debugging/replay
 * - Configure sendAutomaticallyWhen for tool confirmation auto-send
 * - Generate unique chat IDs to ensure proper useChat instance management
 *
 * Dependencies:
 * - AI SDK v6: useChat hook, UIMessage types
 * - WebSocketChatTransport: Core bidirectional communication layer
 * - ChunkLoggingTransport: Transparent logging wrapper
 * - sendAutomaticallyWhen: Tool confirmation trigger logic
 */

import type { AudioContextValue } from "@/lib/audio-context";
import { ChunkLoggingTransport } from "@/lib/chunk_logs";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";
import { sendAutomaticallyWhen } from "./send-automatically-when";
import { WebSocketChatTransport } from "./transport";

/**
 * BIDI Mode Configuration
 *
 * Configuration object for building BIDI mode useChat options.
 *
 * @property initialMessages - Initial conversation history to display in the chat UI
 * @property adkBackendUrl - ADK backend URL (HTTP/HTTPS, will be converted to WS/WSS)
 *                           Default: "http://localhost:8000"
 * @property forceNewInstance - Force creation of new chat instance instead of reusing
 *                              existing one (useful for test isolation)
 * @property audioContext - Optional AudioContext for real-time PCM audio streaming
 *                          Only used in voice mode for playing AI-generated audio
 */
export interface BidiUseChatConfig {
  initialMessages: UIMessageFromAISDKv6[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
}

/**
 * BIDI Mode useChat Options with Transport Reference
 *
 * Return type from buildBidiUseChatOptions containing both useChat configuration
 * and direct transport reference for imperative control.
 *
 * @property useChatOptions - Configuration object to pass to AI SDK's useChat hook
 * @property useChatOptions.transport - ChunkLoggingTransport wrapping WebSocketChatTransport
 * @property useChatOptions.messages - Initial messages for the conversation
 * @property useChatOptions.id - Unique chat instance ID (based on endpoint hash)
 * @property useChatOptions.sendAutomaticallyWhen - Auto-send trigger for tool confirmations
 * @property transport - Direct reference to WebSocketChatTransport for imperative control
 *                       (e.g., manual connection close, state inspection)
 */
export interface BidiUseChatOptions {
  useChatOptions: {
    transport: ChunkLoggingTransport;
    messages: UIMessageFromAISDKv6[];
    id: string;
    sendAutomaticallyWhen: (options: {
      messages: UIMessageFromAISDKv6[];
    }) => boolean | PromiseLike<boolean>;
  };
  transport: WebSocketChatTransport;
}

/**
 * Build useChat Options for ADK BIDI Mode
 *
 * Creates complete AI SDK v6 useChat configuration for WebSocket bidirectional mode,
 * including transport setup, audio context integration, and tool confirmation workflow.
 *
 * Setup Process:
 * 1. Convert HTTP/HTTPS backend URL to WS/WSS WebSocket URL
 * 2. Generate unique chat ID based on endpoint hash (ensures proper instance reuse)
 * 3. Create WebSocketChatTransport with optional AudioContext for voice mode
 * 4. Wrap with ChunkLoggingTransport for transparent request/response logging
 * 5. Configure sendAutomaticallyWhen for tool confirmation auto-send
 *
 * Chat ID Generation:
 * - Normal mode: `chat-adk-bidi-{endpoint-hash}` (reuses existing chat instance)
 * - Force new: `chat-adk-bidi-{endpoint-hash}-{timestamp}` (creates new instance)
 * - Endpoint hash ensures different endpoints use separate chat instances
 *
 * @param config - BIDI mode configuration
 * @param config.initialMessages - Initial conversation history
 * @param config.adkBackendUrl - ADK backend URL (default: http://localhost:8000)
 * @param config.forceNewInstance - Force new chat instance (default: false)
 * @param config.audioContext - Optional AudioContext for PCM streaming
 * @returns useChat options and transport reference for imperative control
 *
 * @example Basic Text Chat
 * ```typescript
 * const { useChatOptions, transport } = buildBidiUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 * });
 *
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 *
 * @example Voice Mode with Audio Context
 * ```typescript
 * const { useChatOptions, transport } = buildBidiUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 *   audioContext, // AudioContextValue for PCM streaming
 * });
 *
 * // Audio chunks will be automatically routed to audioContext.voiceChannel
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 */
export function buildBidiUseChatOptions({
  initialMessages,
  adkBackendUrl = "http://localhost:8000",
  forceNewInstance = false,
  audioContext,
}: BidiUseChatConfig): BidiUseChatOptions {
  // Convert HTTP/HTTPS URL to WebSocket URL and append /live endpoint
  // Example: http://localhost:8000 → ws://localhost:8000/live
  const wsUrl = `${adkBackendUrl.replace(/^http/, "ws")}/live`;

  // Generate unique chat ID based on endpoint hash
  // This ensures AI SDK creates a new Chat instance when the endpoint changes,
  // while reusing the same instance for the same endpoint across re-renders
  const endpointHash = wsUrl.replace(/[^a-zA-Z0-9]/g, "-");
  const chatId = forceNewInstance
    ? `chat-adk-bidi-${endpointHash}-${Date.now()}`
    : `chat-adk-bidi-${endpointHash}`;

  // Create WebSocket transport with optional audio context for voice mode
  const websocketTransport = new WebSocketChatTransport({
    url: wsUrl,
    audioContext, // Audio chunks will be routed to voiceChannel if provided
  });

  // Expose transport to window object for E2E testing and debugging
  // Only available in non-production environments for safety
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // biome-ignore lint/suspicious/noExplicitAny: Intentional for E2E testing hook
    (window as any).webSocketTransport = websocketTransport;
  }

  // Wrap with ChunkLoggingTransport for transparent logging
  // This logs all chunks without affecting the data flow, useful for:
  // - Development debugging
  // - Creating E2E test fixtures
  // - Understanding protocol details
  const transport = new ChunkLoggingTransport(websocketTransport, "adk-bidi");

  return {
    useChatOptions: {
      messages: initialMessages,
      id: chatId,
      transport,
      sendAutomaticallyWhen, // Auto-send after tool confirmation approval
    },
    transport: websocketTransport, // Direct reference for imperative control
  };
}
