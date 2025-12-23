/**
 * E2E Test: SSE Mode with useChat
 *
 * Tests the complete flow of lib/sse with React's useChat hook:
 * 1. Full configuration with all lib/sse options
 * 2. sendAutomaticallyWhen triggering on confirmation completion
 * 3. Correct payload sent to backend
 * 4. Response processing and confirmation flow
 *
 * This is an E2E test - we use real React components, real useChat hook,
 * and real HTTP communication (intercepted by MSW).
 *
 * @vitest-environment jsdom
 */

import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type Mode,
  type UseChatConfig,
  buildUseChatOptions,
} from "../../sse";
import {
  createAdkConfirmationRequest,
  createTextResponse,
} from "../helpers/sse-response-builders";
import { createMswServer } from "../mocks/msw-server";

/**
 * Helper function to extract text content from UIMessage parts
 */
function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

// Create MSW server for HTTP interception
const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("SSE Mode with useChat - E2E Tests", () => {
  describe("Test 1: Full SSE Configuration with sendAutomaticallyWhen", () => {
    it("should use all lib/sse options and trigger sendAutomaticallyWhen on confirmation", async () => {
      // Given: Capture all requests sent to backend
      const capturedPayloads: unknown[] = [];
      let requestCount = 0;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const payload = await request.json();
          capturedPayloads.push(payload);

          // First request: Return confirmation request
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              toolCallId: "call-123",
              originalFunctionCall: {
                id: "orig-123",
                name: "search_web",
                args: { query: "AI SDK v6" },
              },
            });
          }

          // Second request (after confirmation): Return final response
          if (requestCount === 2) {
            return createTextResponse("Search", " completed!");
          }

          return HttpResponse.text("Unexpected request", { status: 500 }) as any;
        }),
      );

      // Configure SSE mode with ALL available options
      const mode: Mode = "adk-sse";
      const initialMessages: UIMessage[] = [];
      const adkBackendUrl = "http://localhost:8000";
      const forceNewInstance = false;

      const config: UseChatConfig = {
        mode,
        initialMessages,
        adkBackendUrl,
        forceNewInstance,
      };

      const { useChatOptions, transport } = buildUseChatOptions(config);

      // Verify transport configuration
      expect(transport).toBeUndefined(); // SSE mode doesn't return transport reference

      // When: Render useChat hook with our configuration
      const { result } = renderHook(() => useChat(useChatOptions));

      // Initial state
      expect(result.current.messages).toEqual(initialMessages);

      // User sends a message
      await act(async () => {
        result.current.sendMessage({ text: "Search for AI SDK v6" });
      });

      // Wait for confirmation to be received
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
        },
        { timeout: 3000 },
      );

      // Then: Verify sendAutomaticallyWhen triggered automatic resubmission
      await waitFor(
        () => {
          expect(requestCount).toBe(2);
        },
        { timeout: 3000 },
      );

      // Verify first request payload (initial message)
      // AI SDK v6 uses parts structure
      expect(capturedPayloads[0]).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Search for AI SDK v6",
              }),
            ]),
          }),
        ]),
      });

      // Verify second request payload (confirmation response)
      expect(capturedPayloads[1]).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Search for AI SDK v6",
              }),
            ]),
          }),
          expect.objectContaining({
            role: "assistant",
            // Should include confirmation output
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-adk_request_confirmation",
                output: expect.objectContaining({
                  confirmed: true,
                }),
              }),
            ]),
          }),
        ]),
      });

      // Verify final message includes complete response
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("Search completed!");
        },
        { timeout: 3000 },
      );
    });

    it("should work with Gemini mode (no confirmation flow)", async () => {
      // Given: Gemini mode (no ADK backend)
      const capturedPayload: unknown[] = [];

      server.use(
        http.post("http://localhost/api/chat", async ({ request }) => {
          capturedPayload.push(await request.json());
          return createTextResponse("Hello", " from Gemini!");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "gemini",
        initialMessages: [],
        apiEndpoint: "http://localhost/api/chat",
      });

      // When: Use the hook
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Hello Gemini" });
      });

      // Then: Verify request sent correctly
      await waitFor(() => {
        expect(capturedPayload).toHaveLength(1);
        expect(capturedPayload[0]).toMatchObject({
          messages: [
            {
              role: "user",
              parts: expect.arrayContaining([
                expect.objectContaining({
                  type: "text",
                  text: "Hello Gemini",
                }),
              ]),
            },
          ],
        });
      });

      // Verify response received
      await waitFor(() => {
        const lastMessage = result.current.messages.at(-1);
        expect(getMessageText(lastMessage)).toBe("Hello from Gemini!");
      });
    });
  });

  describe("Test 2: Response Processing and Confirmation Flow", () => {
    it("should correctly process confirmation response payload", async () => {
      // Given: Setup backend to return confirmation request
      let confirmationReceived = false;
      let finalResponseReceived = false;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          const payload = await request.json();

          // Check if this is the confirmation response
          const hasConfirmation = (payload as any).messages?.some(
            (msg: any) =>
              msg.role === "assistant" &&
              msg.content?.some(
                (part: any) => part.type === "tool-adk_request_confirmation",
              ),
          );

          if (!confirmationReceived) {
            confirmationReceived = true;
            // Return confirmation request
            return createAdkConfirmationRequest({
              toolCallId: "call-456",
              originalFunctionCall: {
                id: "orig-456",
                name: "get_weather",
                args: { location: "Tokyo" },
              },
            });
          }

          if (hasConfirmation && !finalResponseReceived) {
            finalResponseReceived = true;
            // Return final response after confirmation
            return createTextResponse("Weather", " in Tokyo: Sunny, 25°C");
          }

          return HttpResponse.text("Unexpected", { status: 500 }) as any;
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
        result.current.sendMessage({ text: "What's the weather in Tokyo?" });
      });

      // Then: Wait for confirmation to appear in messages
      await waitFor(
        () => {
          const messages = result.current.messages;
          const lastMessage = messages.at(-1);

          expect(lastMessage?.role).toBe("assistant");
          expect(lastMessage?.parts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "tool-adk_request_confirmation",
                toolCallId: "call-456",
              }),
            ]),
          );
        },
        { timeout: 3000 },
      );

      // Verify sendAutomaticallyWhen triggers automatic resubmission
      await waitFor(
        () => {
          expect(confirmationReceived).toBe(true);
          expect(finalResponseReceived).toBe(true);
        },
        { timeout: 3000 },
      );

      // Verify final response appears
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("Weather in Tokyo: Sunny");
        },
        { timeout: 3000 },
      );
    });

    it("should handle multiple confirmations in sequence", async () => {
      // Given: Backend returns multiple confirmations
      let requestCount = 0;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const payload = await request.json();

          // First request: Initial message
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              toolCallId: "call-1",
              originalFunctionCall: {
                id: "orig-1",
                name: "step1",
                args: {},
              },
            });
          }

          // Second request: After first confirmation
          if (requestCount === 2) {
            return createAdkConfirmationRequest({
              toolCallId: "call-2",
              originalFunctionCall: {
                id: "orig-2",
                name: "step2",
                args: {},
              },
            });
          }

          // Third request: Final response
          if (requestCount === 3) {
            return createTextResponse("All", " steps completed!");
          }

          return HttpResponse.text("Unexpected", { status: 500 }) as any;
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
        result.current.sendMessage({ text: "Execute multi-step process" });
      });

      // Then: Verify all confirmations processed
      await waitFor(
        () => {
          expect(requestCount).toBeGreaterThanOrEqual(3);
        },
        { timeout: 5000 },
      );

      // Verify final response
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("All steps completed!");
        },
        { timeout: 3000 },
      );
    });

    it("should preserve message history during confirmation flow", async () => {
      // Given: Initial conversation with history
      const initialMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Previous message" }],
        } as UIMessage,
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Previous response" }],
        } as UIMessage,
      ];

      let capturedPayload: any = null;

      server.use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload = await request.json();
          return createTextResponse("New", " response");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages,
        adkBackendUrl: "http://localhost:8000",
      });

      // When: User sends new message
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "New message" });
      });

      // Then: Verify history preserved in request
      await waitFor(() => {
        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.messages).toHaveLength(3); // 2 history + 1 new

        // Verify first history message (user)
        expect(capturedPayload.messages[0]).toMatchObject({
          role: "user",
        });

        // Verify second history message (assistant)
        expect(capturedPayload.messages[1]).toMatchObject({
          role: "assistant",
        });

        // Verify new message (user)
        expect(capturedPayload.messages[2]).toMatchObject({
          role: "user",
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: "New message",
            }),
          ]),
        });
      });
    });

    it("should handle errors during confirmation flow gracefully", async () => {
      // Given: Backend returns error after confirmation
      let requestCount = 0;

      server.use(
        http.post("http://localhost:8000/stream", async () => {
          requestCount++;

          if (requestCount === 1) {
            // First request: Return confirmation
            return createAdkConfirmationRequest({
              toolCallId: "call-error",
              originalFunctionCall: {
                id: "orig-error",
                name: "failing_tool",
                args: {},
              },
            });
          }

          // Second request: Return error
          return HttpResponse.json(
            { error: "Tool execution failed" },
            { status: 500 },
          ) as any;
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
        result.current.sendMessage({ text: "Trigger error" });
      });

      // Then: Verify confirmation received
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
        },
        { timeout: 3000 },
      );

      // Wait for error handling
      await waitFor(
        () => {
          expect(requestCount).toBe(2);
        },
        { timeout: 3000 },
      );

      // Verify error state
      expect(result.current.error).toBeDefined();
    });
  });
});
