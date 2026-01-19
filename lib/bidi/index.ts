/**
 * BIDI Mode Public API - WebSocket Bidirectional Communication
 *
 * ADK BIDI Protocol - Requires ADK backend with WebSocket support
 *
 * This module provides the public interface for ADK BIDI mode, which uses WebSocket
 * for bidirectional real-time communication between frontend and backend. BIDI mode
 * enables advanced features not available in SSE modes:
 *
 * Key Features:
 * - Full-duplex bidirectional communication (send/receive simultaneously)
 * - Real-time PCM audio streaming for voice interactions (via AudioContext)
 * - Tool confirmation workflow with user approval (adk_request_confirmation)
 * - Lower latency compared to SSE due to persistent connection
 *
 * Dependencies:
 * - ADK BIDI Protocol (WebSocket bidirectional streaming)
 * - AI SDK v6 (ChatTransport interface, UIMessage types)
 * - Web Audio API (AudioContext, AudioWorklet for PCM playback)
 * - adk_request_confirmation tool support
 *
 * Unified API Design:
 * All function and type names are identical to lib/sse/index.ts for consistency.
 * The only difference is the import path, allowing mode switching by changing
 * a single import statement:
 *   - import { ... } from '@/lib/bidi';  // WebSocket BIDI mode
 *   - import { ... } from '@/lib/sse';   // SSE mode
 *
 * @example Basic Usage
 * ```typescript
 * import { buildUseChatOptions, type UseChatConfig } from '@/lib/bidi';
 *
 * const { useChatOptions, transport } = buildUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 * });
 * ```
 *
 * @example With Audio Context (Voice Mode)
 * ```typescript
 * import { buildUseChatOptions } from '@/lib/bidi';
 *
 * const { useChatOptions, transport } = buildUseChatOptions({
 *   initialMessages: [],
 *   adkBackendUrl: 'http://localhost:8000',
 *   audioContext, // AudioContextValue for PCM streaming
 * });
 * ```
 */

// Automatic send trigger function for tool confirmation workflow
export {
  type SendAutomaticallyWhenOptions,
  sendAutomaticallyWhen,
} from "./send-automatically-when";

// WebSocket transport layer (aliased for unified API)
export {
  WebSocketChatTransport as ChatTransport,
  type WebSocketChatTransportConfig as TransportConfig,
} from "./transport";

// Configuration types (aliased for unified API)
export type {
  BidiUseChatConfig as UseChatConfig,
  BidiUseChatOptions as UseChatOptions,
} from "./use-chat-options";
// Main configuration builder (aliased for unified API)
// Test cleanup utility
export {
  buildBidiUseChatOptions as buildUseChatOptions,
  closeAllBidiTransports,
} from "./use-chat-options";

/**
 * Internal Implementation Modules (Not Exported)
 *
 * The following modules are implementation details of the BIDI transport layer
 * and are intentionally not exported to maintain encapsulation:
 *
 * - EventSender (lib/bidi/event_sender.ts): Handles sending events to backend
 * - EventReceiver (lib/bidi/event_receiver.ts): Handles incoming events from backend
 * - Event types: MessageEvent, ToolResultEvent, ToolApprovalEvent, etc.
 *
 * External code should only interact with the public API (ChatTransport) and
 * should not depend on these internal implementation details.
 */
