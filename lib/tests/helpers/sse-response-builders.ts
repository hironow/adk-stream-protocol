/**
 * SSE Response Builders for Integration Tests
 *
 * Helper functions to create Server-Sent Events responses for MSW handlers.
 * Provides consistent SSE stream formatting for testing.
 */

import { HttpResponse } from "msw";
import {
  TOOL_CHUNK_TYPE_INPUT_START,
  TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
} from "../../constants";

/**
 * SSE chunk type - text delta
 * AI SDK v6 format
 */
export interface TextDeltaChunk {
  type: "text-delta";
  delta: string;
  id: string;
}

/**
 * SSE chunk type - tool input start (AI SDK v6)
 */
export interface ToolInputStartChunk {
  type: typeof TOOL_CHUNK_TYPE_INPUT_START;
  toolCallId: string;
  toolName: string;
}

/**
 * SSE chunk type - tool input available (AI SDK v6)
 */
export interface ToolInputAvailableChunk {
  type: typeof TOOL_CHUNK_TYPE_INPUT_AVAILABLE;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * Union type for all SSE chunk types (AI SDK v6)
 */
export type SseChunk =
  | TextDeltaChunk
  | ToolInputStartChunk
  | ToolInputAvailableChunk;

/**
 * Create SSE stream response for MSW handler
 *
 * @param chunks - Array of chunks to send
 * @returns HttpResponse with SSE stream
 *
 * @example
 * ```typescript
 * import { createSseStreamResponse } from '@/lib/tests/helpers/sse-response-builders';
 *
 * server.use(
 *   http.post('/api/chat', () => {
 *     return createSseStreamResponse([
 *       { type: 'text-delta', textDelta: 'Hello' },
 *       { type: 'text-delta', textDelta: ' World' },
 *     ]);
 *   })
 * );
 * ```
 */
export function createSseStreamResponse(chunks: SseChunk[]): HttpResponse<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const data = `0:${JSON.stringify(chunk)}\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.close();
    },
  });

  return new HttpResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Create SSE stream with ADK confirmation request
 *
 * Uses AI SDK v6 tool chunk types:
 * 1. tool-input-start: Indicates the start of tool input
 * 2. tool-input-available: Provides the complete tool input
 *
 * @param options - Confirmation request options
 * @param options.toolCallId - Optional tool call ID (defaults to "call-1")
 * @param options.originalFunctionCall - Original function call details
 * @returns HttpResponse with confirmation request stream
 *
 * @example
 * ```typescript
 * server.use(
 *   http.post('/stream', () => {
 *     return createAdkConfirmationRequest({
 *       toolCallId: 'call-123',
 *       originalFunctionCall: {
 *         id: 'orig-1',
 *         name: 'dangerous_operation',
 *         args: { param: 'value' },
 *       },
 *     });
 *   })
 * );
 * ```
 */
export function createAdkConfirmationRequest(options: {
  toolCallId?: string;
  originalFunctionCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
}): HttpResponse<ReadableStream<Uint8Array>> {
  const toolCallId = options.toolCallId ?? "call-1";

  return createSseStreamResponse([
    {
      type: TOOL_CHUNK_TYPE_INPUT_START,
      toolCallId,
      toolName: "adk_request_confirmation",
    },
    {
      type: TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
      toolCallId,
      toolName: "adk_request_confirmation",
      input: { originalFunctionCall: options.originalFunctionCall },
    },
  ]);
}

/**
 * Create simple text response SSE stream
 *
 * @param text - Text to send (can include multiple words/phrases)
 * @returns HttpResponse with text delta stream
 *
 * @example
 * ```typescript
 * server.use(
 *   http.post('/api/chat', () => {
 *     return createTextResponse('Hello', ' World', '!');
 *   })
 * );
 * ```
 */
export function createTextResponse(...textParts: string[]): HttpResponse<ReadableStream<Uint8Array>> {
  const textId = `text-${Date.now()}`;
  const chunks: TextDeltaChunk[] = textParts.map((text) => ({
    type: "text-delta",
    delta: text,
    id: textId,
  }));
  return createSseStreamResponse(chunks);
}
