/**
 * BIDI WebSocket Handlers for MSW
 *
 * Helper functions to create MSW WebSocket handlers for ADK BIDI protocol testing.
 * Uses MSW's ws module for WebSocket mocking.
 */

import { ws } from "msw";

/**
 * ADK BIDI WebSocket URL
 * Default backend URL for ADK BIDI mode
 */
export const DEFAULT_BIDI_WS_URL = "ws://localhost:8000/live";

/**
 * Track active WebSocket clients for cleanup
 * This is necessary because MSW's server.close() doesn't close WebSocket connections
 */
const activeClients: Set<WebSocket> = new Set();

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
 * Close all active WebSocket clients and clear tracking
 *
 * IMPORTANT: This must be called in afterAll() to prevent
 * "Worker exited unexpectedly" errors caused by unclosed WebSocket connections.
 * MSW's server.close() does NOT close WebSocket connections automatically.
 */
export function clearBidiWebSocketLinks() {
  for (const client of activeClients) {
    try {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
  activeClients.clear();
}

/**
 * Track a WebSocket client for cleanup
 *
 * Call this at the start of every WebSocket connection handler.
 * @param client - The WebSocket client to track
 */
export function trackClient(client: WebSocket): void {
  activeClients.add(client);
  // Auto-remove when closed
  client.addEventListener("close", () => {
    activeClients.delete(client);
  });
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
    console.log(
      "[MSW WebSocket] Connection established, sending text deltas:",
      textParts,
    );

    // Track client for cleanup
    trackClient(client);

    // Establish mock server connection
    server.connect();

    // Listen for client messages
    client.addEventListener("message", (event) => {
      console.log("[MSW WebSocket] Received client message:", event.data);

      // Skip ping messages
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "ping") {
          console.log("[MSW WebSocket] Skipping ping message");
          return;
        }
      } catch {
        // Not JSON, continue processing
      }

      // AI SDK v6 expects: text-start, text-delta(s), text-end sequence
      const textId = `text-${Date.now()}`;

      // Send text-start chunk
      const startChunk = {
        type: "text-start",
        id: textId,
      };
      const startMessage = `data: ${JSON.stringify(startChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending text-start:", startMessage);
      client.send(startMessage); // Use client.send() to send TO client

      // Send text-delta chunks
      for (const text of textParts) {
        const chunk = {
          type: "text-delta",
          delta: text,
          id: textId,
        };
        const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;
        console.log("[MSW WebSocket] Sending text-delta:", sseMessage);
        client.send(sseMessage); // Use client.send() to send TO client
      }

      // Send text-end chunk
      const endChunk = {
        type: "text-end",
        id: textId,
      };
      const endMessage = `data: ${JSON.stringify(endChunk)}\n\n`;
      console.log("[MSW WebSocket] Sending text-end:", endMessage);
      client.send(endMessage); // Use client.send() to send TO client

      // Send [DONE] marker
      const doneMessage = "data: [DONE]\n\n";
      console.log("[MSW WebSocket] Sending DONE");
      client.send(doneMessage); // Use client.send() to send TO client
    });
  });
}

/**
 * Create WebSocket handler that sends confirmation request (ADR 0002)
 *
 * Per ADR 0002, adk_request_confirmation is internal to backend.
 * Frontend receives tool-approval-request events on the original tool.
 *
 * @param chat - MSW WebSocket link
 * @param originalFunctionCall - Original function call to confirm
 * @param approvalId - Optional approval ID (defaults to "approval-1")
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
  approvalId: string = "approval-1",
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Track client for cleanup
    trackClient(client);

    // Establish mock server connection
    server.connect();

    let messageCount = 0;

    // Listen for client messages
    client.addEventListener("message", (event) => {
      console.log(
        "[MSW WebSocket] Received client message for confirmation:",
        event.data,
      );

      // Skip ping/pong messages
      const data = JSON.parse(event.data as string);
      if (data.type === "ping") {
        return;
      }

      messageCount++;

      // First message: Send approval request
      if (messageCount === 1) {
        console.log("[MSW WebSocket] First message - sending approval request");

        // ADR 0002: Send original tool chunks (will have approval requested on them)
        // Send tool-input-start chunk for ORIGINAL tool
        const startChunk = {
          type: "tool-input-start",
          toolCallId: originalFunctionCall.id,
          toolName: originalFunctionCall.name,
        };
        const startMessage = `data: ${JSON.stringify(startChunk)}\n\n`;
        console.log("[MSW WebSocket] Sending tool-input-start:", startMessage);
        client.send(startMessage);

        // Send tool-input-available chunk for ORIGINAL tool
        const availableChunk = {
          type: "tool-input-available",
          toolCallId: originalFunctionCall.id,
          toolName: originalFunctionCall.name,
          input: originalFunctionCall.args,
        };
        const availableMessage = `data: ${JSON.stringify(availableChunk)}\n\n`;
        console.log(
          "[MSW WebSocket] Sending tool-input-available:",
          availableMessage,
        );
        client.send(availableMessage);

        // ADR 0002: Send tool-approval-request for the ORIGINAL tool
        // This updates the original tool's state to "approval-requested"
        const approvalChunk = {
          type: "tool-approval-request",
          approvalId,
          toolCallId: originalFunctionCall.id,
        };
        const approvalMessage = `data: ${JSON.stringify(approvalChunk)}\n\n`;
        console.log(
          "[MSW WebSocket] Sending tool-approval-request:",
          approvalMessage,
        );
        client.send(approvalMessage);

        // Send [DONE] marker
        console.log("[MSW WebSocket] Sending DONE");
        client.send("data: [DONE]\n\n");
        return;
      }

      // Second message (after approval): Send final response
      if (messageCount === 2) {
        console.log("[MSW WebSocket] Second message - sending final response");
        console.log(
          "[MSW WebSocket] Message data:",
          JSON.stringify(data, null, 2),
        );

        // Check if approval was granted or denied
        const approvalPart = data.messages
          // biome-ignore lint/suspicious/noExplicitAny: Test helper - message structure varies
          ?.flatMap((msg: any) => msg.parts || [])
          .find(
            // biome-ignore lint/suspicious/noExplicitAny: Test helper - part structure varies
            (part: any) =>
              part.toolCallId === originalFunctionCall.id && part.approval,
          );

        console.log(
          "[MSW WebSocket] Found approval part:",
          JSON.stringify(approvalPart, null, 2),
        );

        // Check for approval object presence (AI SDK v6 only adds {id} to approval,
        // not the approved/denied decision, until backend responds)
        // If approval object exists, assume approved (sendAutomaticallyWhen triggered)
        if (approvalPart?.approval) {
          // Approved: Send output-available
          const outputChunk = {
            type: "tool-output-available",
            toolCallId: originalFunctionCall.id,
            toolName: originalFunctionCall.name,
            output: { result: "Operation completed successfully" },
          };
          console.log("[MSW WebSocket] Sending tool-output-available");
          client.send(`data: ${JSON.stringify(outputChunk)}\n\n`);
        } else {
          // Denied: Send output-denied
          const deniedChunk = {
            type: "tool-output-denied",
            toolCallId: originalFunctionCall.id,
            toolName: originalFunctionCall.name,
            reason: approvalPart?.approval?.reason || "User denied",
          };
          console.log("[MSW WebSocket] Sending tool-output-denied");
          client.send(`data: ${JSON.stringify(deniedChunk)}\n\n`);
        }

        // Send [DONE]
        console.log("[MSW WebSocket] Sending DONE");
        client.send("data: [DONE]\n\n");
      }
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
    // Track client for cleanup
    trackClient(client);

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
            client.send(`data: ${JSON.stringify(chunk)}\n\n`); // Use client.send() to send TO client
            client.send("data: [DONE]\n\n"); // Use client.send() to send TO client
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
  handler: (connection: { client: WebSocket; server: WebSocket }) => void,
) {
  return chat.addEventListener("connection", ({ server, client }) => {
    // Track client for cleanup
    trackClient(client);

    // Establish mock server connection
    server.connect();

    // Call custom handler
    handler({ server, client });
  });
}
