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
  isApprovalRequestPart,
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

          // Request 2: Approval response (approval-responded state)
          if (requestCount === 2) {
            // This request contains the approval-responded state
            // Just acknowledge and wait for tool output in next request
            return new HttpResponse(null, { status: 204 });
          }

          // Request 3: Should contain tool output from frontend
          if (requestCount === 3) {
            // Verify frontend sent tool output via addToolOutput()
            const messages = payload.messages as UIMessageFromAISDKv6[];
            const lastMessage = messages[messages.length - 1];

            // Check for tool part with output-available state (from addToolOutput)
            const hasToolOutput = lastMessage?.parts?.some(
              (part: any) =>
                part.toolCallId === "orig-location" &&
                part.state === "output-available" &&
                part.output !== undefined,
            );

            if (hasToolOutput) {
              toolResultReceived = true;
            }

            // Backend continues with AI response
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
      const confirmationMessage =
        result.current.messages[result.current.messages.length - 1];
      const confirmationPart = confirmationMessage.parts.find((part: any) =>
        isApprovalRequestPart(part),
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
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const part = msg.parts.find((p: any) =>
            isApprovalRequestPart(p),
          ) as any;
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

      // Wait for AI response
      await waitFor(
        () => {
          const lastMessage =
            result.current.messages[result.current.messages.length - 1];
          const text = getMessageText(lastMessage);
          return text.includes("Tokyo, Japan");
        },
        { timeout: 5000 },
      );

      // Then: Verify flow
      // 3 requests: 1) initial, 2) after approval, 3) after tool output
      expect(requestCount).toBe(3);
      expect(toolResultReceived).toBe(true);

      const finalMessage =
        result.current.messages[result.current.messages.length - 1];
      const finalText = getMessageText(finalMessage);
      expect(finalText).toContain("Tokyo, Japan");
      expect(finalText).toContain("35.6762");
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

      // Approve
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) => isApprovalRequestPart(p)) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.toolCallId,
          approved: true,
        });
      });

      // Wait for approval state to update
      await waitFor(
        () => {
          const msg =
            result.current.messages[result.current.messages.length - 1];
          const confirmationPart = msg.parts.find((p: any) =>
            isApprovalRequestPart(p),
          ) as any;
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

      // Deny
      const msg = result.current.messages[result.current.messages.length - 1];
      const part = msg.parts.find((p: any) => isApprovalRequestPart(p)) as any;

      await act(async () => {
        result.current.addToolApprovalResponse({
          id: part.toolCallId,
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
