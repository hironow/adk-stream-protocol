/**
 * SSE Chat Transport for AI SDK v6
 *
 * SSE (Server-Sent Events) mode uses AI SDK's built-in DefaultChatTransportFromAISDKv6
 * which handles HTTP-based streaming via the native fetch API.
 *
 * Architecture: AI SDK v6 Data Stream Protocol over HTTP
 * =======================================================
 * - Frontend sends HTTP POST request with messages
 * - Backend responds with text/event-stream (SSE format)
 * - DefaultChatTransportFromAISDKv6 parses SSE events automatically
 * - UIMessageChunk events are forwarded to useChat hook
 *
 * Key Differences from BIDI Mode:
 * - Two separate HTTP requests (user input → backend, confirmation → backend)
 * - No persistent connection (stateless HTTP)
 * - No real-time bidirectional streaming
 * - ADK's confirmation flow handled via addToolApprovalResponse mechanism
 *
 * Benefits:
 * - Simple implementation (uses AI SDK defaults)
 * - No WebSocket infrastructure required
 * - Standard HTTP/HTTPS compatibility
 * - Works behind restrictive firewalls
 *
 * Responsibilities:
 * - Type definitions for SSE mode configuration
 * - Helper functions for SSE transport setup
 * - Re-export DefaultChatTransportFromAISDKv6 for consistency
 */

import { DefaultChatTransport } from "ai";
import type { DefaultChatTransportFromAISDKv6 } from "../utils";

/**
 * SSE transport configuration
 */
export interface SseTransportConfig {
  /** API endpoint for SSE streaming (e.g., http://localhost:8000/stream) */
  api: string;

  /** Optional request preparation hook */
  prepareSendMessagesRequest?: (options: {
    api: string;
    messages: unknown[];
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal options type
  }) => Promise<any>;
}

/**
 * Create SSE transport for AI SDK v6
 *
 * Creates a DefaultChatTransportFromAISDKv6 configured for ADK SSE mode.
 * This is a thin wrapper for consistency with BIDI transport creation.
 *
 * @param config - SSE transport configuration
 * @returns DefaultChatTransportFromAISDKv6 instance
 *
 * @example
 * ```typescript
 * const transport = createSseTransport({
 *   api: 'http://localhost:8000/stream',
 *   prepareSendMessagesRequest: async (options) => ({
 *     ...options,
 *     headers: { 'X-Custom-Header': 'value' },
 *   }),
 * });
 * ```
 */
export function createSseTransport(
  config: SseTransportConfig,
): DefaultChatTransportFromAISDKv6 {
  return new DefaultChatTransport({
    api: config.api,
    prepareSendMessagesRequest: config.prepareSendMessagesRequest,
  });
}

/**
 * Re-export DefaultChatTransport for consistency
 *
 * This allows importing SSE transport from lib/sse/transport.ts
 * instead of directly from 'ai' package, maintaining architectural symmetry
 * with lib/bidi/transport.ts.
 */
export { DefaultChatTransport as SseChatTransport };
