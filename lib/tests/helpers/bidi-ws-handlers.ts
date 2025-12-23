/**
 * BIDI WebSocket Handlers for MSW
 *
 * Helper functions to create MSW WebSocket handlers for ADK BIDI protocol testing.
 * Uses MSW's ws module for WebSocket mocking.
 */

import { ws } from "msw";
import { TOOL_NAME_ADK_REQUEST_CONFIRMATION } from "../../constants";

/**
 * ADK BIDI WebSocket URL
 * Default backend URL for ADK BIDI mode
 */
export const DEFAULT_BIDI_WS_URL = "ws://localhost:8000/live";

/**
 * Create WebSocket link for BIDI tests
 *
 * @param url - WebSocket URL to intercept (defaults to DEFAULT_BIDI_WS_URL)
 * @returns MSW WebSocket link
 *
 * @example
 * ```typescript
 * import { createBidiWebSocketLink } from '@/lib/tests/helpers/bidi-ws-handlers';
 *
 * const chat = createBidiWebSocketLink();
 * ```
 */
export function createBidiWebSocketLink(url: string = DEFAULT_BIDI_WS_URL) {
  return ws.link(url);
}

/**
 * Create WebSocket handler that sends text deltas
 *
 * @param chat - MSW WebSocket link
 * @param textParts - Text parts to send as deltas
 * @returns MSW WebSocket handler
 *
 * @example
 * ```typescript
 * const chat = createBidiWebSocketLink();
 *
 * server.use(
 *   createTextResponseHandler(chat, 'Hello', ' World')
 * );
 * ```
 */
export function createTextResponseHandler(
  chat: ReturnType<typeof ws.link>,
  ...textParts: string[]
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    console.log("[MSW WebSocket] Connection established, sending text deltas:", textParts);

    // Establish mock server connection
    server.connect();

    // Listen for client messages
    client.addEventListener("message", (event) => {
      console.log("[MSW WebSocket] Received client message:", event.data);

      // AI SDK v6 expects: text-start, text-delta(s), text-end sequence
      const textId = `text-${Date.now()}`;

      // Send text-start chunk
      const startChunk = {
        type: "text-start",
        id: textId,
      };
      const startMessage = `data: ${JSON.stringify(startChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending text-start:", startMessage);
      client.send(startMessage);  // Use client.send() to send TO client

      // Send text-delta chunks
      for (const text of textParts) {
        const chunk = {
          type: "text-delta",
          delta: text,
          id: textId,
        };
        const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;
        console.log("[MSW WebSocket] Sending text-delta:", sseMessage);
        client.send(sseMessage);  // Use client.send() to send TO client
      }

      // Send text-end chunk
      const endChunk = {
        type: "text-end",
        id: textId,
      };
      const endMessage = `data: ${JSON.stringify(endChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending text-end:", endMessage);
      client.send(endMessage);  // Use client.send() to send TO client

      // Send [DONE] marker
      const doneMessage = "data: [DONE]\n\n";
      console.log("[MSW WebSocket] Sending DONE");
      client.send(doneMessage);  // Use client.send() to send TO client
    });
  });
}

/**
 * Create WebSocket handler that sends confirmation request
 *
 * @param chat - MSW WebSocket link
 * @param originalFunctionCall - Original function call to confirm
 * @returns MSW WebSocket handler
 *
 * @example
 * ```typescript
 * const chat = createBidiWebSocketLink();
 *
 * server.use(
 *   createConfirmationRequestHandler(chat, {
 *     id: 'orig-1',
 *     name: 'dangerous_operation',
 *     args: { action: 'delete_all' },
 *   })
 * );
 * ```
 */
export function createConfirmationRequestHandler(
  chat: ReturnType<typeof ws.link>,
  originalFunctionCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  },
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Establish mock server connection
    server.connect();

    // Listen for client messages
    client.addEventListener("message", (event) => {
      console.log("[MSW WebSocket] Received client message for confirmation:", event.data);

      // Send tool-input-start chunk
      const startChunk = {
        type: "tool-input-start",
        toolCallId: "call-1",
        toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
      };
      const startMessage = `data: ${JSON.stringify(startChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending tool-input-start:", startMessage);
      client.send(startMessage);  // Use client.send() to send TO client

      // Send tool-input-available chunk
      const availableChunk = {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
        input: { originalFunctionCall },
      };
      const availableMessage = `data: ${JSON.stringify(availableChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending tool-input-available:", availableMessage);
      client.send(availableMessage);  // Use client.send() to send TO client

      // Send tool-approval-request chunk
      const approvalChunk = {
        type: "tool-approval-request",
        approvalId: "call-1",
        toolCallId: "call-1",
      };
      const approvalMessage = `data: ${JSON.stringify(approvalChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending tool-approval-request:", approvalMessage);
      client.send(approvalMessage);  // Use client.send() to send TO client

      // Send [DONE] marker
      console.log("[MSW WebSocket] Sending DONE");
      client.send("data: [DONE]\n\n");  // Use client.send() to send TO client
    });
  });
}

/**
 * Create WebSocket handler that echoes client messages
 *
 * @param chat - MSW WebSocket link
 * @param responseText - Optional response text to send back
 * @returns MSW WebSocket handler
 *
 * @example
 * ```typescript
 * const chat = createBidiWebSocketLink();
 *
 * server.use(
 *   createEchoHandler(chat, 'Echo: ')
 * );
 * ```
 */
export function createEchoHandler(
  chat: ReturnType<typeof ws.link>,
  responsePrefix: string = "",
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Establish mock server connection
    server.connect();

    client.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);

        // Echo back the message with optional prefix
        if (data.messages && data.messages.length > 0) {
          const lastMessage = data.messages[data.messages.length - 1];
          if (lastMessage.role === "user") {
            const chunk = {
              type: "text-delta",
              delta: responsePrefix + lastMessage.content,
              id: `text-${Date.now()}`,
            };
            client.send(`data: ${JSON.stringify(chunk)}\n\n`);  // Use client.send() to send TO client
            client.send("data: [DONE]\n\n");  // Use client.send() to send TO client
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    });
  });
}

/**
 * Create WebSocket handler with custom logic
 *
 * @param chat - MSW WebSocket link
 * @param handler - Custom connection handler
 * @returns MSW WebSocket handler
 *
 * @example
 * ```typescript
 * const chat = createBidiWebSocketLink();
 *
 * server.use(
 *   createCustomHandler(chat, ({ client, server }) => {
 *     client.addEventListener('message', (event) => {
 *       // Custom logic
 *     });
 *   })
 * );
 * ```
 */
export function createCustomHandler(
  chat: ReturnType<typeof ws.link>,
  handler: (connection: {
    client: WebSocket;
    server: WebSocket;
  }) => void,
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Establish mock server connection
    server.connect();

    // Call custom handler
    handler({ server, client });
  });
}
