/**
 * SSE Mode Public API - Server-Sent Events Communication
 *
 * Dual Mode Support - ADK SSE (with tool confirmation) or Gemini (pure AI SDK v6)
 *
 * This module provides the public interface for SSE-based communication modes,
 * supporting both ADK protocol with tool confirmation (adk-sse) and direct
 * Gemini API integration (gemini). SSE offers simpler unidirectional streaming
 * compared to WebSocket, with native browser support and HTTP compatibility.
 *
 * Supported Modes:
 *
 * 1. adk-sse (ADK Tool Confirmation over HTTP SSE):
 *    - Requires ADK backend with SSE support
 *    - Tool confirmation workflow with user approval (adk_request_confirmation)
 *    - Automatic message sending after approval (sendAutomaticallyWhen)
 *    - Standard HTTP/HTTPS transport
 *
 * 2. gemini (Direct Gemini API via SSE):
 *    - No ADK backend required (Next.js API route to Gemini)
 *    - Pure AI SDK v6 streaming (no tool confirmation)
 *    - Simpler setup, faster development iteration
 *    - Standard HTTP/HTTPS transport
 *
 * Key Characteristics of SSE:
 * - Unidirectional streaming (server → client only)
 * - HTTP-based (works through firewalls, proxies)
 * - Native browser EventSource API support
 * - Automatic reconnection on connection loss
 * - No audio streaming support (use BIDI for voice mode)
 *
 * Dependencies:
 * - AI SDK v6 (DefaultChatTransport, SSE streaming)
 * - ADK Tool Protocol (optional, adk-sse mode only)
 *   - adk_request_confirmation tool
 *   - sendAutomaticallyWhen detection
 *
 * Unified API Design:
 * All function and type names are identical to lib/bidi/index.ts for consistency.
 * The only difference is the import path, allowing mode switching by changing
 * a single import statement:
 *   - import { ... } from '@/lib/sse';   // SSE modes (adk-sse, gemini)
 *   - import { ... } from '@/lib/bidi';  // WebSocket BIDI mode
 *
 * @example ADK SSE Mode with Tool Confirmation
 * ```typescript
 * import { buildUseChatOptions, type UseChatConfig } from '@/lib/sse';
 *
 * const { useChatOptions } = buildUseChatOptions({
 *   mode: 'adk-sse',
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 * });
 *
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 *
 * @example Gemini Mode (No ADK Backend)
 * ```typescript
 * import { buildUseChatOptions } from '@/lib/sse';
 *
 * const { useChatOptions } = buildUseChatOptions({
 *   mode: 'gemini',
 *   initialMessages: [],
 * });
 *
 * // Uses Next.js API route at /api/chat (Vercel AI SDK v6 default)
 * const { messages, sendMessage } = useChat(useChatOptions);
 * ```
 */

// Automatic send trigger function for tool confirmation workflow (ADK SSE mode)
export {
  type SendAutomaticallyWhenOptions,
  sendAutomaticallyWhen,
} from "./send-automatically-when";

// SSE transport layer (aliased for unified API)
export {
  createSseTransport as createTransport,
  SseChatTransport as ChatTransport,
  type SseTransportConfig as TransportConfig,
} from "./transport";

// Configuration types (aliased for unified API)
export type {
  SseMode as Mode,
  SseUseChatConfig as UseChatConfig,
  SseUseChatOptions as UseChatOptions,
} from "./use-chat-options";

// Main configuration builder (aliased for unified API)
export { buildSseUseChatOptions as buildUseChatOptions } from "./use-chat-options";

/**
 * Internal Implementation Modules (Not Exported)
 *
 * The following modules are implementation details of the SSE transport layer
 * and are intentionally not exported to maintain encapsulation:
 *
 * - EventReceiver (lib/sse/event_receiver.ts): Handles incoming SSE events
 * - createAdkConfirmationOutput: Helper for creating ADK confirmation output format
 * - sendConfirmation: Helper for sending tool approval to backend
 * - SseConfirmationToolInvocation: Internal type for confirmation tool state
 *
 * External code should only interact with the public API (ChatTransport, buildUseChatOptions)
 * and should not depend on these internal implementation details.
 */
