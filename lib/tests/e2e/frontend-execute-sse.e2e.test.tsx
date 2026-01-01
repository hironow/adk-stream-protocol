/**
 * E2E Test: SSE Mode with Frontend Execute Pattern
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
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions } from "../../sse";
import type { UIMessageFromAISDKv6 } from "../../utils";
import {
  isApprovalRequestedTool,
  isApprovalRespondedTool,
  isTextUIPartFromAISDKv6,
} from "../../utils";
import {
  createAdkConfirmationRequest,
  createTextResponse,
  setupMswServer,
} from "../helpers";

/**
 * Helper function to extract text content from UIMessageFromAISDKv6 parts
 */
function getMessageText(message: UIMessageFromAISDKv6 | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      isTextUIPartFromAISDKv6(part),
    )
    .map((part) => part.text)
    .join("");
}

// Create MSW server for HTTP interception with standard lifecycle
const server = setupMswServer();

describe("SSE Mode - Frontend Execute Pattern", () => {
  describe("Single Tool Frontend Execution", () => {
    it("should execute tool on frontend and send result with addToolOutput", async () => {
      // Given: Backend sends confirmation, frontend executes, sends result
      let requestCount = 0;
      let toolResultReceived = false;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const payload = (await request.json()) as any;

          // Request 1: Initial message → Return confirmation
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              toolCallId: "call-location",
              originalFunctionCall: {
                id: "orig-location",
                name: "get_location",
                args: {},
              },
            });
          }

          // Request 2: AI SDK v6 - After approval (two-phase tracking)
          // In AI SDK v6, after user approves, the next request includes approval
          // Tool output is added separately via addToolOutput, which doesn't auto-send
          // So Request 2 contains the approved tool in approval-requested state
          if (requestCount === 2) {
            const messages = payload.messages as UIMessageFromAISDKv6[];
            const lastMessage = messages[messages.length - 1];

            // Check if this request has the approved tool or tool output
            const hasToolOutput = lastMessage?.parts?.some(
              (part: any) =>
                part.toolCallId === "orig-location" &&
                part.state === "output-available" &&
                part.output !== undefined,
            );

            if (hasToolOutput) {
              toolResultReceived = true;
              // Backend responds with AI response using the tool output
              return createTextResponse(
                "Your location is Tokyo, Japan (35.6762°N, 139.6503°E).",
              );
            }

            // If no tool output yet, just acknowledge and wait
            return new HttpResponse(null, { status: 204 });
          }

          // Request 3: Fallback (may not be reached in AI SDK v6)
          if (requestCount === 3) {
            const messages = payload.messages as UIMessageFromAISDKv6[];
            const lastMessage = messages[messages.length - 1];

            const hasToolOutput = lastMessage?.parts?.some(
              (part: any) =>
                part.toolCallId === "orig-location" &&
                part.state === "output-available" &&
                part.output !== undefined,
            );

            if (hasToolOutput) {
              toolResultReceived = true;
            }

            return createTextResponse(
              "Your location is Tokyo, Japan (35.6762°N, 139.6503°E).",
            );
          }

          return HttpResponse.text("Unexpected request", {
            status: 500,
          }) as any;
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: User sends message
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "What's my location?" });
      });

      // Wait for confirmation to arrive
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          return (
            lastMessage?.role === "assistant" &&
            lastMessage.parts.some((part: any) => isApprovalRequestedTool(part))
          );
        },
        { timeout: 3000 },
      );

      // User approves confirmation
      // AI SDK v6: Find original tool part with approval-requested state
      const confirmationMessage =
        result.current.messages[result.current.messages.length - 1];
      const confirmationPart = confirmationMessage.parts.find((part: any) =>
        isApprovalRequestedTool(part),
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: confirmationPart.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for state to change to approval-responded (AI SDK v6 standard behavior)
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const part = msg.parts.find((p: any) =>
            isApprovalRespondedTool(p),
          ) as any;
          expect(part).toBeDefined();
          expect(part?.state).toBe("approval-responded");
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

      // AI SDK v6: addToolOutput auto-sends (Frontend Execute pattern)
      // Wait for AI response with location information
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          return text.includes("Tokyo, Japan");
        },
        { timeout: 3000 },
      );

      // Then: Verify flow
      // AI SDK v6: 3 requests with Frontend Execute pattern
      // 1) initial → confirmation request
      // 2) after approval (two-phase) → approval sent
      // 3) after addToolOutput → auto-send tool result (Frontend Execute)
      // Note: addToolOutput auto-sends when output is added (Frontend Execute pattern)
      expect(requestCount).toBe(3);
      expect(toolResultReceived).toBe(true); // addToolOutput auto-sends

      // Verify tool output was sent to backend and AI responded
      const finalMessage =
        result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);
      expect(finalText).toContain("Tokyo, Japan");
    });

    it("should handle frontend execution failure", async () => {
      // Given: Frontend execution fails
      let requestCount = 0;

      server.use(
        http.post(
          "http://localhost:8000/stream",
          async ({ request: _request }) => {
            requestCount++;

            if (requestCount === 1) {
              return createAdkConfirmationRequest({
                toolCallId: "call-camera",
                originalFunctionCall: {
                  id: "orig-camera",
                  name: "take_photo",
                  args: {},
                },
              });
            }

            if (requestCount === 2) {
              // Backend receives error from frontend
              return createTextResponse(
                "Unable to access camera. Permission denied.",
              );
            }

            return HttpResponse.text("Unexpected", { status: 500 }) as any;
          },
        ),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Take a photo" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some((p: any) => isApprovalRequestedTool(p));
        },
        { timeout: 3000 },
      );

      // Approve - AI SDK v6: Find original tool part
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) =>
        isApprovalRequestedTool(p),
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for state to change to approval-responded (AI SDK v6 standard behavior)
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const confirmationPart = msg.parts.find((p: any) =>
            isApprovalRespondedTool(p),
          ) as any;
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-responded");
        },
        { timeout: 3000 },
      );

      // Frontend execution fails (e.g., permission denied)
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
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
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
    });
  });

  describe("Approval Denial", () => {
    it("should handle user denying frontend tool execution", async () => {
      // Given: User denies permission
      let requestCount = 0;

      server.use(
        http.post(
          "http://localhost:8000/stream",
          async ({ request: _request }) => {
            requestCount++;

            if (requestCount === 1) {
              return createAdkConfirmationRequest({
                toolCallId: "call-mic",
                originalFunctionCall: {
                  id: "orig-mic",
                  name: "record_audio",
                  args: { duration: 5 },
                },
              });
            }

            if (requestCount === 2) {
              // User denied, no tool execution
              return createTextResponse(
                "Understood. I won't access your microphone.",
              );
            }

            return HttpResponse.text("Unexpected", { status: 500 }) as any;
          },
        ),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Record audio" });
      });

      // Wait for confirmation
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          return msg?.parts?.some((p: any) => isApprovalRequestedTool(p));
        },
        { timeout: 3000 },
      );

      // Deny - AI SDK v6: Find original tool part
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) =>
        isApprovalRequestedTool(p),
      ) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: false,
        });
      });

      // Wait for denial response (NO addToolOutput call)
      await waitFor(
        () => {
          const lastMsg =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMsg);
          return text.includes("won't access");
        },
        { timeout: 5000 },
      );

      // Verify denial handling
      const finalText = getMessageText(
        result.current.messages[result.current.messages.length - 1],
      );
      expect(finalText).toContain("won't access your microphone");
    });
  });
});
