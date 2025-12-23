/**
 * BIDI Mode Public API
 *
 * 🔴 ADK BIDI Protocol - Requires ADK backend with WebSocket support
 *
 * This module provides the public interface for ADK BIDI mode (WebSocket).
 * Internal implementation details (EventSender, EventReceiver, event types)
 * are not exposed to maintain encapsulation.
 *
 * Dependencies:
 * - ADK BIDI Protocol (WebSocket bidirectional streaming)
 * - AI SDK v6 (ChatTransport interface)
 * - adk_request_confirmation tool support
 *
 * Unified API Design:
 * All function and type names are identical to lib/sse/index.ts.
 * Modules are distinguished by import path only.
 *
 * @example
 * ```typescript
 * import { buildUseChatOptions, type UseChatConfig } from '@/lib/bidi';
 *
 * const { useChatOptions, transport } = buildUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 *   audioContext,
 * });
 * ```
 */

// sendAutomaticallyWhen function
export {
  type SendAutomaticallyWhenOptions,
  sendAutomaticallyWhen,
} from "./send-automatically-when";

// Transport (unified names)
export {
  WebSocketChatTransport as ChatTransport,
  type WebSocketChatTransportConfig as TransportConfig,
} from "./transport";

// Configuration types (unified names)
export type {
  BidiUseChatConfig as UseChatConfig,
  BidiUseChatOptions as UseChatOptions,
} from "./use-chat-options";

// Main entry point (unified name)
export { buildBidiUseChatOptions as buildUseChatOptions } from "./use-chat-options";

/**
 * Internal modules (not exported):
 * - EventSender (lib/bidi/event_sender.ts)
 * - EventReceiver (lib/bidi/event_receiver.ts)
 * - Event types (MessageEvent, ToolResultEvent, etc.)
 *
 * These are internal implementation details of ChatTransport
 * and should not be directly imported by external code.
 */
