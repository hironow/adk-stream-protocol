/**
 * SSE Event Receiver
 *
 * SSE mode uses AI SDK's DefaultChatTransport which handles all incoming
 * server-sent events automatically via the native fetch API.
 *
 * SSE Mode Characteristics:
 * - Uses AI SDK's built-in fetch-based streaming (DefaultChatTransport)
 * - Browser's native EventSource or fetch with text/event-stream
 * - No custom receiver needed - AI SDK handles SSE parsing
 * - Events are automatically converted to UIMessageChunk format
 *
 * This file exists for architectural symmetry with lib/bidi/event_receiver.ts,
 * but SSE mode does not require custom receiver implementation.
 *
 * If future SSE-specific processing is needed (e.g., custom event handling,
 * transformation, or logging), implement it here.
 */

/**
 * Placeholder for future SSE-specific receiver functionality.
 *
 * Currently, SSE mode uses AI SDK's DefaultChatTransport exclusively,
 * which handles all server-sent event parsing and conversion.
 */
export class EventReceiver {}
