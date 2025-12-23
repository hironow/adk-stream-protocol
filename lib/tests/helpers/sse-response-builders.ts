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
  TOOL_NAME_ADK_REQUEST_CONFIRMATION,
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
 * Create SSE stream with ADK confirmation request
 *
 * Uses AI SDK v6 tool chunk types:
 * 1. tool-input-start: Indicates the start of tool input
 * 2. tool-input-available: Provides the complete tool input
 * 3. tool-approval-request: Requests user approval for the tool
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
  approvalId?: string;
  originalFunctionCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
}): HttpResponse<ReadableStream<Uint8Array>> {
  const toolCallId = options.toolCallId ?? "call-1";
  const approvalId = options.approvalId ?? toolCallId;

  // AI SDK v6 approval flow for Frontend Execute pattern:
  // 1. Send original tool chunks (tool-input-start + tool-input-available)
  //    This creates the original tool part that frontend will update via addToolOutput()
  // 2. Send confirmation tool chunks (tool-input-start + tool-input-available)
  // 3. Send tool-approval-request for confirmation tool
  // 4. Frontend calls addToolApprovalResponse() on confirmation tool
  // 5. Frontend executes original tool and calls addToolOutput()
  // 6. sendAutomaticallyWhen detects output-available and triggers send
  return createSseStreamResponse([
    // Original tool chunks (will be updated by addToolOutput)
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
    // Confirmation tool chunks
    {
      type: TOOL_CHUNK_TYPE_INPUT_START,
      toolCallId,
      toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
    },
    {
      type: TOOL_CHUNK_TYPE_INPUT_AVAILABLE,
      toolCallId,
      toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
      input: { originalFunctionCall: options.originalFunctionCall },
    },
    {
      type: TOOL_CHUNK_TYPE_APPROVAL_REQUEST,
      approvalId,
      toolCallId,
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
