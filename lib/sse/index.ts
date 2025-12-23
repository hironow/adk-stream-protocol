/**
 * SSE Mode Public API
 *
 * 🟡 Dual Mode Support - ADK SSE (with tool confirmation) or Gemini (pure AI SDK v6)
 *
 * This module provides the public interface for SSE-based modes (Gemini, ADK SSE).
 * Internal implementation details (EventSender, EventReceiver, confirmation helpers)
 * are not exposed to maintain encapsulation.
 *
 * Dependencies:
 * - AI SDK v6 (DefaultChatTransport, SSE streaming)
 * - ADK Tool Protocol (optional, adk-sse mode only)
 *   - adk_request_confirmation tool
 *   - sendAutomaticallyWhen detection
 *
 * Modes:
 * - adk-sse: 🟡 ADK tool confirmation over HTTP SSE
 * - gemini: ⚪ Pure AI SDK v6, no ADK dependency
 *
 * Unified API Design:
 * All function and type names are identical to lib/bidi/index.ts.
 * Modules are distinguished by import path only.
 *
 * @example
 * ```typescript
 * import { buildUseChatOptions, type UseChatConfig } from '@/lib/sse';
 *
 * // ADK SSE mode
 * const { useChatOptions } = buildUseChatOptions({
 *   mode: 'adk-sse',
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 * });
 *
 * // Gemini mode (no ADK)
 * const { useChatOptions } = buildUseChatOptions({
 *   mode: 'gemini',
 *   initialMessages: [],
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
  createSseTransport as createTransport,
  SseChatTransport as ChatTransport,
  type SseTransportConfig as TransportConfig,
} from "./transport";

// Configuration types (unified names)
export type {
  SseMode as Mode,
  SseUseChatConfig as UseChatConfig,
  SseUseChatOptions as UseChatOptions,
} from "./use-chat-options";

// Main entry point (unified name)
export { buildSseUseChatOptions as buildUseChatOptions } from "./use-chat-options";

/**
 * Internal modules (not exported):
 * - EventSender (lib/sse/event_sender.ts)
 * - EventReceiver (lib/sse/event_receiver.ts)
 * - createAdkConfirmationOutput (internal helper)
 * - sendConfirmation (internal helper)
 * - SseConfirmationToolInvocation (internal type)
 *
 * These are internal implementation details and should not be directly
 * imported by external code. Use the public API provided by this module.
 */
