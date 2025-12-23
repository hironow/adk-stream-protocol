/**
 * SSE Response Builders for Integration Tests
 *
 * Helper functions to create Server-Sent Events responses for MSW handlers.
 * Provides consistent SSE stream formatting for testing.
 */

import { HttpResponse } from "msw";

/**
 * SSE chunk type - text delta
 */
export interface TextDeltaChunk {
  type: "text-delta";
  textDelta: string;
}

/**
 * SSE chunk type - tool invocation
 */
export interface ToolInvocationChunk {
  type: "tool-invocation";
  state: "partial" | "call" | "output-available";
  toolCallId: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

/**
 * Union type for all SSE chunk types
 */
export type SseChunk = TextDeltaChunk | ToolInvocationChunk;

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
export function createSseStreamResponse(chunks: SseChunk[]): HttpResponse {
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
 * @param originalFunctionCall - Original function call details
 * @returns HttpResponse with confirmation request stream
 *
 * @example
 * ```typescript
 * server.use(
 *   http.post('/stream', () => {
 *     return createAdkConfirmationRequest({
 *       id: 'orig-1',
 *       name: 'dangerous_operation',
 *       args: { param: 'value' },
 *     });
 *   })
 * );
 * ```
 */
export function createAdkConfirmationRequest(originalFunctionCall: {
  id: string;
  name: string;
  args: Record<string, unknown>;
}): HttpResponse {
  return createSseStreamResponse([
    {
      type: "tool-invocation",
      state: "partial",
      toolCallId: "call-1",
      toolName: "adk_request_confirmation",
      input: { originalFunctionCall },
    },
    {
      type: "tool-invocation",
      state: "call",
      toolCallId: "call-1",
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
export function createTextResponse(...textParts: string[]): HttpResponse {
  const chunks: TextDeltaChunk[] = textParts.map((text) => ({
    type: "text-delta",
    textDelta: text,
  }));
  return createSseStreamResponse(chunks);
}
