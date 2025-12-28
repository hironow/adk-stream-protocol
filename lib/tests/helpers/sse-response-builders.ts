/**
 * SSE Response Builders for Integration Tests
 *
 * Helper functions to create Server-Sent Events responses for MSW handlers.
 * Provides consistent SSE stream formatting for testing.
 */

import { HttpResponse } from "msw";
import type { SseChunk } from "@/lib/types";
import {
  TOOL_CHUNK_TYPE_APPROVAL_REQUEST,
  TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
  TOOL_CHUNK_TYPE_INPUT_START,
} from "../../constants";

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
export function createSseStreamResponse(
  chunks: SseChunk[],
): HttpResponse<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        // AI SDK v6 expects standard SSE format:
        // data: <json>\n\n
        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      // AI SDK v6 expects [DONE] marker to signal stream completion
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
 * Create SSE stream with ADK confirmation request (ADR 0002)
 *
 * Per ADR 0002, adk_request_confirmation is internal to backend.
 * Frontend receives tool-approval-request events on the original tool.
 *
 * Uses AI SDK v6 tool chunk types:
 * 1. tool-input-start: Indicates the start of tool input for ORIGINAL tool
 * 2. tool-input-available: Provides the complete tool input for ORIGINAL tool
 * 3. tool-approval-request: Requests user approval for the ORIGINAL tool
 *
 * @param options - Confirmation request options
 * @param options.approvalId - Optional approval ID (defaults to "approval-1")
 * @param options.originalFunctionCall - Original function call details
 * @returns HttpResponse with confirmation request stream
 *
 * @example
 * ```typescript
 * server.use(
 *   http.post('/stream', () => {
 *     return createAdkConfirmationRequest({
 *       approvalId: 'approval-123',
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
  approvalId?: string;
  originalFunctionCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
}): HttpResponse<ReadableStream<Uint8Array>> {
  const approvalId = options.approvalId ?? "approval-1";

  // ADR 0002: Send original tool chunks only
  // tool-approval-request updates the original tool's state to "approval-requested"
  // No separate adk_request_confirmation tool chunks
  return createSseStreamResponse([
    // Original tool chunks
    {
      type: TOOL_CHUNK_TYPE_INPUT_START,
      toolCallId: options.originalFunctionCall.id,
      toolName: options.originalFunctionCall.name,
    },
    {
      type: TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
      toolCallId: options.originalFunctionCall.id,
      toolName: options.originalFunctionCall.name,
      input: options.originalFunctionCall.args,
    },
    // ADR 0002: tool-approval-request for the ORIGINAL tool
    {
      type: TOOL_CHUNK_TYPE_APPROVAL_REQUEST,
      approvalId,
      toolCallId: options.originalFunctionCall.id,
    },
  ] as SseChunk[]);
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
export function createTextResponse(
  ...textParts: string[]
): HttpResponse<ReadableStream<Uint8Array>> {
  const textId = `text-${Date.now()}`;

  // AI SDK v6 expects: text-start, text-delta(s), text-end sequence
  const chunks: SseChunk[] = [
    // Start the text stream
    { type: "text-start" as const, id: textId },
    // Send each text part as a delta
    ...textParts.map((text) => ({
      type: "text-delta" as const,
      delta: text,
      id: textId,
    })),
    // End the text stream
    { type: "text-end" as const, id: textId },
  ];

  return createSseStreamResponse(chunks);
}
