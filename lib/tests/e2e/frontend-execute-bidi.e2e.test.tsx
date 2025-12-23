/**
 * E2E Test: BIDI Mode with Frontend Execute Pattern
 *
 * Tests the complete flow where frontend executes tools (browser APIs) and sends results:
 * 1. Backend requests tool confirmation
 * 2. User approves with addToolApprovalResponse()
 * 3. Frontend executes browser API
 * 4. Frontend sends result with addToolOutput()
 * 5. Backend receives result and continues
 *
 * This differs from Server Execute pattern where backend executes tools.
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { isTextUIPart } from "ai";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
  TOOL_NAME_ADK_REQUEST_CONFIRMATION,
  TOOL_STATE_APPROVAL_REQUESTED,
  TOOL_STATE_APPROVAL_RESPONDED,
} from "../../constants";
import { buildUseChatOptions } from "../../bidi";
import {
  createBidiWebSocketLink,
  createCustomHandler,
} from "../helpers/bidi-ws-handlers";
import { createMswServer } from "../mocks/msw-server";

/**
 * Helper function to extract text content from UIMessage parts
 */
function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => isTextUIPart(part))
    .map((part) => part.text)
    .join("");
}

// Create MSW server for WebSocket interception
const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("BIDI Mode - Frontend Execute Pattern", () => {
  describe("Single Tool Frontend Execution", () => {
    it("should execute tool on frontend and send result with addToolOutput", async () => {
      // Given: Backend sends confirmation, frontend executes, sends result
      const chat = createBidiWebSocketLink();
      let toolResultReceived = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if this is approval response (assistant message with approval-responded)
            const hasApprovalResponse = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                    part.state === TOOL_STATE_APPROVAL_RESPONDED,
                ),
            );

            // Check if frontend sent tool output (addToolOutput updates assistant message)
            const hasToolOutput = data.messages?.some(
              (msg: any) =>
                msg.role === "assistant" &&
                msg.parts?.some(
                  (part: any) =>
                    part.toolCallId === "orig-location" &&
                    part.state === "output-available",
                ),
            );

            if (hasToolOutput) {
              // Frontend sent tool-result
              toolResultReceived = true;

              // Backend continues with AI response
              const textId = `text-${Date.now()}`;
              client.send(`data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`);
              client.send(
                `data: ${JSON.stringify({
                  type: "text-delta",
                  delta: "Your location is Tokyo, Japan (35.6762°N, 139.6503°E).",
                  id: textId,
                })}\n\n`,
              );
              client.send(`data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`);
              client.send("data: [DONE]\n\n");
            } else if (hasApprovalResponse) {
              // User approved, wait for tool-result (don't send anything yet)
              return;
            } else {
              // First message: Send original tool + confirmation request
              // Send original tool chunks first
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "orig-location",
                  toolName: "get_location",
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "orig-location",
                  toolName: "get_location",
                  input: {},
                })}\n\n`,
              );

              // Then send confirmation tool chunks
              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-start",
                  toolCallId: "call-location",
                  toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-input-available",
                  toolCallId: "call-location",
                  toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                  input: {
                    originalFunctionCall: {
                      id: "orig-location",
                      name: "get_location",
                      args: {},
                    },
                  },
                })}\n\n`,
              );

              client.send(
                `data: ${JSON.stringify({
                  type: "tool-approval-request",
                  approvalId: "call-location",
                  toolCallId: "call-location",
                })}\n\n`,
              );

              client.send("data: [DONE]\n\n");
            }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      // When: User sends message
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "What's my location?" });
      });

      // Wait for confirmation to arrive
      await waitFor(
        () => {
          const lastMessage = result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            lastMessage.parts.some(
              (part: any) =>
                part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                part.state === TOOL_STATE_APPROVAL_REQUESTED,
            )
          );
        },
        { timeout: 3000 },
      );

      // User approves confirmation
      const confirmationMessage = result.current.messages[result.current.messages.length - 1];
      const confirmationPart = confirmationMessage.parts.find(
        (part: any) => part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationPart.toolCallId,
          approved: true,
        });
      });

      // Wait for approval state to update
      await waitFor(
        () => {
          const msg = result.current.messages[result.current.messages.length - 1];
          const part = msg.parts.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          ) as any;
          expect(part?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
        },
        { timeout: 3000 },
      );

      // Frontend executes browser API (mocked)
      const locationResult = {
        lat: 35.6762,
        lng: 139.6503,
        accuracy: 10,
      };

      // Frontend sends result with addToolOutput
      await act(async () => {
        result.current.addToolOutput({
          tool: "get_location",
          toolCallId: "orig-location",
          output: JSON.stringify(locationResult),
        });
      });

      // Wait for AI response
      await waitFor(
        () => {
          const lastMessage = result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          return text.includes("Tokyo, Japan");
        },
        { timeout: 5000 },
      );

      // Then: Verify flow
      expect(toolResultReceived).toBe(true);

      const finalMessage = result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);
      expect(finalText).toContain("Tokyo, Japan");
      expect(finalText).toContain("35.6762");

      transport._close();
    });

    it("should handle frontend execution failure", async () => {
      // Given: Frontend execution fails
      const chat = createBidiWebSocketLink();
      let toolResultReceived = false;

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            // Check if this is approval response
            const hasApprovalResponse = data.messages?.some(
                (msg: any) =>
                  msg.role === "assistant" &&
                  msg.parts?.some(
                    (part: any) =>
                      part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                      part.state === TOOL_STATE_APPROVAL_RESPONDED,
                  ),
              );

              const hasToolOutput = data.messages?.some(
                (msg: any) =>
                  msg.role === "assistant" &&
                  msg.parts?.some(
                    (part: any) =>
                      part.toolCallId === "orig-camera" &&
                      part.state === "output-available",
                  ),
              );

              if (hasToolOutput) {
                // Frontend sent tool-result
                toolResultReceived = true;

                // Error response
                const textId = `text-${Date.now()}`;
                client.send(`data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`);
                client.send(
                  `data: ${JSON.stringify({
                    type: "text-delta",
                    delta: "Unable to access camera. Permission denied.",
                    id: textId,
                  })}\n\n`,
                );
                client.send(`data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`);
                client.send("data: [DONE]\n\n");
              } else if (hasApprovalResponse) {
                // Wait for tool-result
                return;
              } else {
                // Send original tool chunks first
                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-start",
                    toolCallId: "orig-camera",
                    toolName: "take_photo",
                  })}\n\n`,
                );

                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-available",
                    toolCallId: "orig-camera",
                    toolName: "take_photo",
                    input: {},
                  })}\n\n`,
                );

                // Then send confirmation
                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-start",
                    toolCallId: "call-camera",
                    toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                  })}\n\n`,
                );

                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-available",
                    toolCallId: "call-camera",
                    toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                    input: {
                      originalFunctionCall: {
                        id: "orig-camera",
                        name: "take_photo",
                        args: {},
                      },
                    },
                  })}\n\n`,
                );

                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-approval-request",
                    approvalId: "call-camera",
                    toolCallId: "call-camera",
                  })}\n\n`,
                );

                client.send("data: [DONE]\n\n");
              }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Take a photo" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg = result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some(
            (p: any) =>
              p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
              p.state === TOOL_STATE_APPROVAL_REQUESTED,
          );
        },
        { timeout: 3000 },
      );

      // Approve
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find(
        (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.toolCallId,
          approved: true,
        });
      });

      // Wait for approval state to update
      await waitFor(
        () => {
          const msg = result.current.messages[result.current.messages.length - 1];
          const confirmationPart = msg.parts.find(
            (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
          ) as any;
          expect(confirmationPart?.state).toBe(TOOL_STATE_APPROVAL_RESPONDED);
        },
        { timeout: 3000 },
      );

      // Frontend execution fails
      await act(async () => {
        result.current.addToolOutput({
          tool: "take_photo",
          toolCallId: "orig-camera",
          output: JSON.stringify({
            error: "NotAllowedError",
            message: "Permission denied",
          }),
        });
      });

      // Wait for error response
      await waitFor(
        () => {
          const lastMsg = result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMsg);
          return text.includes("Permission denied");
        },
        { timeout: 5000 },
      );

      // Verify error handling
      const finalText = getMessageText(
        result.current.messages[result.current.messages.length - 1],
      );
      expect(finalText).toContain("Permission denied");
      expect(toolResultReceived).toBe(true);

      transport._close();
    });
  });

  describe("Approval Denial", () => {
    it("should handle user denying frontend tool execution", async () => {
      // Given: User denies permission
      const chat = createBidiWebSocketLink();

      server.use(
        createCustomHandler(chat, ({ server: _server, client }) => {
          client.addEventListener("message", (event) => {
            // Early return for non-JSON messages (e.g., WebSocket handshake)
            if (typeof event.data !== "string" || !event.data.startsWith("{")) {
              return;
            }

            const data = JSON.parse(event.data as string);

            const hasDenial = data.messages?.some(
                (msg: any) =>
                  msg.role === "assistant" &&
                  msg.parts?.some(
                    (part: any) =>
                      part.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
                      part.state === TOOL_STATE_APPROVAL_RESPONDED &&
                      part.approval?.approved === false,
                  ),
              );

              if (!hasDenial) {
                // Send confirmation
                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-start",
                    toolCallId: "call-mic",
                    toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                  })}\n\n`,
                );

                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-input-available",
                    toolCallId: "call-mic",
                    toolName: TOOL_NAME_ADK_REQUEST_CONFIRMATION,
                    input: {
                      originalFunctionCall: {
                        id: "orig-mic",
                        name: "record_audio",
                        args: { duration: 5 },
                      },
                    },
                  })}\n\n`,
                );

                client.send(
                  `data: ${JSON.stringify({
                    type: "tool-approval-request",
                    approvalId: "call-mic",
                    toolCallId: "call-mic",
                  })}\n\n`,
                );

                client.send("data: [DONE]\n\n");
              } else {
                // User denied
                const textId = `text-${Date.now()}`;
                client.send(`data: ${JSON.stringify({ type: "text-start", id: textId })}\n\n`);
                client.send(
                  `data: ${JSON.stringify({
                    type: "text-delta",
                    delta: "Understood. I won't access your microphone.",
                    id: textId,
                  })}\n\n`,
                );
                client.send(`data: ${JSON.stringify({ type: "text-end", id: textId })}\n\n`);
                client.send("data: [DONE]\n\n");
              }
          });
        }),
      );

      const { useChatOptions, transport } = buildUseChatOptions({
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
        forceNewInstance: true,
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Record audio" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg = result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some(
            (p: any) =>
              p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION &&
              p.state === TOOL_STATE_APPROVAL_REQUESTED,
          );
        },
        { timeout: 3000 },
      );

      // Deny
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find(
        (p: any) => p.type === TOOL_TYPE_ADK_REQUEST_CONFIRMATION,
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.toolCallId,
          approved: false,
        });
      });

      // Wait for denial response (NO addToolOutput call)
      await waitFor(
        () => {
          const lastMsg = result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMsg);
          return text.includes("won't access");
        },
        { timeout: 5000 },
      );

      expect(
        getMessageText(result.current.messages[result.current.messages.length - 1]),
      ).toContain("won't access your microphone");

      transport._close();
    });
  });
});
