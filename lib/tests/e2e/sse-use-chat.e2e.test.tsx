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
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { buildUseChatOptions, type Mode, type UseChatConfig } from "../../sse";
import {
  isApprovalRequestedTool,
  isApprovalRespondedTool,
  isToolUIPartFromAISDKv6,
  type UIMessageFromAISDKv6,
} from "../../utils";
import {
  createAdkConfirmationRequest,
  createSendAutoSpy,
  createTextResponse,
  findAllConfirmationParts,
  findConfirmationPart,
  getMessageText,
  useMswServer,
} from "../helpers";

describe("SSE Mode with useChat - E2E Tests", () => {
  const { getServer } = useMswServer();
  describe("Test 1: Full SSE Configuration with sendAutomaticallyWhen", () => {
    it("should use all lib/sse options and trigger sendAutomaticallyWhen on confirmation", async () => {
      // Given: Capture all requests sent to backend
      const capturedPayloads: unknown[] = [];
      let requestCount = 0;

      getServer().use(
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

          return HttpResponse.text("Unexpected request", {
            status: 500,
          }) as any;
        }),
      );

      // Configure SSE mode with ALL available options
      const mode: Mode = "adk-sse";
      const initialMessages: UIMessageFromAISDKv6[] = [];
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

      // Wait for confirmation request to be received (state: approval-requested)
      // AI SDK v6: tool-approval-request EVENT updates TOOL part state to "approval-requested"
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
          const confirmationPart = lastMessage?.parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-requested");
        },
        { timeout: 3000 },
      );

      // Simulate user clicking Approve
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find((p: any) =>
          isApprovalRequestedTool(p),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for state to update
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmationPart = lastMessage?.parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          console.log(
            "[Test] After approval, confirmation part:",
            JSON.stringify(confirmationPart, null, 2),
          );
          expect(confirmationPart?.state).not.toBe("input-available");
        },
        { timeout: 1000 },
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
      // AI SDK v6: Tool parts have type "tool-{toolName}", not "tool-approval-request"
      // After user approves, tool part has state "approval-requested" with approval object
      // The approval object exists (user has responded) but backend hasn't processed it yet
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
            // Should include TOOL part with approval object (user has responded)
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-search_web", // AI SDK v6: type is "tool-{toolName}"
                state: "approval-responded", // State changes immediately after addToolApprovalResponse
                toolCallId: "orig-123",
                approval: expect.anything(), // Approval object with {id, approved, reason}
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

    it("should work with basic message flow (no confirmation)", async () => {
      // Given: ADK SSE mode with simple text response (no confirmation)
      const capturedPayload: unknown[] = [];

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          capturedPayload.push(await request.json());
          return createTextResponse("Hello", " World!");
        }),
      );

      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse",
        initialMessages: [],
        adkBackendUrl: "http://localhost:8000",
      });

      // When: Use the hook
      const { result } = renderHook(() => useChat(useChatOptions));

      await act(async () => {
        result.current.sendMessage({ text: "Hello ADK" });
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
                  text: "Hello ADK",
                }),
              ]),
            },
          ],
        });
      });

      // Verify response received
      await waitFor(() => {
        const lastMessage = result.current.messages.at(-1);
        expect(lastMessage?.role).toBe("assistant");
        expect(getMessageText(lastMessage)).toBe("Hello World!");
      });
    });
  });

  describe("Test 2: Response Processing and Confirmation Flow", () => {
    it("should correctly process confirmation response payload", async () => {
      // Given: Setup backend to return confirmation request
      let confirmationReceived = false;
      let finalResponseReceived = false;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          const payload = await request.json();

          // Check if this is the confirmation response
          // AI SDK v6: Check for TOOL parts with approval objects (user has responded)
          const hasConfirmation = (payload as any).messages?.some(
            (msg: any) =>
              msg.role === "assistant" &&
              msg.parts?.some(
                (part: any) =>
                  isToolUIPartFromAISDKv6(part) && part.approval !== undefined,
              ),
          );

          if (!confirmationReceived) {
            confirmationReceived = true;
            // Return confirmation request
            // Note: createAdkConfirmationRequest uses originalFunctionCall.id as toolCallId
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "call-456",
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
      // AI SDK v6: Tool parts have type "tool-{toolName}", state "approval-requested"
      await waitFor(
        () => {
          const messages = result.current.messages;
          const lastMessage = messages.at(-1);

          expect(lastMessage?.role).toBe("assistant");
          const toolPart = lastMessage?.parts?.find(
            (p: any) =>
              isToolUIPartFromAISDKv6(p) && p.toolCallId === "call-456",
          );
          expect(toolPart).toBeDefined();
          expect(toolPart).toMatchObject({
            type: "tool-get_weather", // AI SDK v6: type is "tool-{toolName}"
            toolCallId: "call-456",
            state: "approval-requested",
          });
        },
        { timeout: 3000 },
      );

      // Simulate user approval
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find((p: any) =>
          isApprovalRequestedTool(p),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

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
          expect(getMessageText(lastMessage)).toContain(
            "Weather in Tokyo: Sunny",
          );
        },
        { timeout: 3000 },
      );
    });

    it("should handle multiple confirmations in sequence", async () => {
      // Given: Backend returns multiple confirmations
      let requestCount = 0;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const _payload = await request.json();

          // First request: Initial message
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "call-1",
                name: "step1",
                args: {},
              },
            });
          }

          // Second request: After first confirmation
          if (requestCount === 2) {
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "call-2",
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

      // Wait for first confirmation (call-1)
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
          const confirmationPart = lastMessage?.parts?.find(
            (p: any) => p.toolCallId === "call-1",
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve first confirmation
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find(
          (p: any) => p.toolCallId === "call-1",
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for second confirmation (call-2)
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmationPart = lastMessage?.parts?.find(
            (p: any) => p.toolCallId === "call-2",
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve second confirmation
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find(
          (p: any) => p.toolCallId === "call-2",
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Then: Verify final response with both confirmations processed
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain("All steps completed!");
        },
        { timeout: 3000 },
      );

      // Verify both confirmations were processed
      // AI SDK v6: Check for TOOL parts in approval-responded state (user has approved)
      const allMessages = result.current.messages;
      const confirmationParts = allMessages
        .flatMap((msg: any) => msg.parts || [])
        .filter(
          (p: any) => isToolUIPartFromAISDKv6(p) && isApprovalRespondedTool(p),
        );
      expect(confirmationParts.length).toBeGreaterThanOrEqual(2);
    });

    it("should preserve message history during confirmation flow", async () => {
      // Given: Initial conversation with history
      const initialMessages: UIMessageFromAISDKv6[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Previous message" }],
        } as UIMessageFromAISDKv6,
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Previous response" }],
        } as UIMessageFromAISDKv6,
      ];

      let capturedPayload: any = null;

      getServer().use(
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

      getServer().use(
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
          const confirmationPart = lastMessage?.parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(confirmationPart).toBeDefined();
        },
        { timeout: 3000 },
      );

      // Approve confirmation (which will trigger error response)
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find((p: any) =>
          isApprovalRequestedTool(p),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

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

    it("should handle tool approval denial correctly", async () => {
      // Given: Backend returns confirmation request and handles denial
      let requestCount = 0;

      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const _payload = await request.json();

          // First request: Return confirmation request
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "call-deny",
                name: "dangerous_operation",
                args: { action: "delete_all" },
              },
            });
          }

          // Second request (after denial): Return response acknowledging the denial
          // Note: Payload doesn't contain approval.approved field until backend responds
          // We distinguish by request count
          if (requestCount === 2) {
            return createTextResponse(
              "Operation cancelled as per your request.",
            );
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
        result.current.sendMessage({ text: "Delete all data" });
      });

      // Then: Wait for confirmation to appear
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(lastMessage?.role).toBe("assistant");
          const confirmationPart = lastMessage?.parts?.find((p: any) =>
            isApprovalRequestedTool(p),
          );
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-requested");
        },
        { timeout: 3000 },
      );

      // Simulate user denying the approval
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = lastMessage?.parts?.find((p: any) =>
          isApprovalRequestedTool(p),
        );
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: false, // ← Denial
          reason: "User rejected the dangerous operation",
        });
      });

      // Verify sendAutomaticallyWhen triggers automatic resubmission on denial
      await waitFor(
        () => {
          expect(requestCount).toBe(2); // Initial + denial response
        },
        { timeout: 3000 },
      );

      // Verify final response acknowledging the denial
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain(
            "Operation cancelled as per your request",
          );
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Test 3: Tool Approval Request Verification (Single Approval)", () => {
    it("should call sendAutomaticallyWhen after single tool approval", async () => {
      // Given: Setup spy wrapper around sendAutomaticallyWhen
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse" as Mode,
        initialMessages: [] as UIMessageFromAISDKv6[],
        adkBackendUrl: "http://localhost:8000",
      });

      const sendAutoSpy = createSendAutoSpy(
        useChatOptions.sendAutomaticallyWhen!,
      );
      const optionsWithSpy = {
        ...useChatOptions,
        sendAutomaticallyWhen: sendAutoSpy,
      };

      // Setup MSW to send confirmation request
      let requestCount = 0;
      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const _payload = await request.json();

          // First request: Return confirmation request
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              toolCallId: "spy-call-123",
              originalFunctionCall: {
                id: "spy-orig-123",
                name: "spy_test_operation",
                args: { test: "spy-data" },
              },
            });
          }

          // Second request (after confirmation): Return final response
          if (requestCount === 2) {
            return createTextResponse("Operation", " completed!");
          }

          return HttpResponse.text("Unexpected request", {
            status: 500,
          }) as any;
        }),
      );

      const { result } = renderHook(() => useChat(optionsWithSpy));

      // When: User submits message and receives confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request confirmation" });
      });

      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmationPart = findConfirmationPart(lastMessage);
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-requested");
        },
        { timeout: 3000 },
      );

      // Clear any previous spy calls from initial renders
      sendAutoSpy.mockClear();

      // When: User approves the confirmation
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = findConfirmationPart(lastMessage);
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Then: Verify sendAutomaticallyWhen was called
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Verify it was called with correct parameters
      expect(sendAutoSpy.mock.calls.length).toBeGreaterThan(0);
      const lastCall =
        sendAutoSpy.mock.calls[sendAutoSpy.mock.calls.length - 1];
      expect(lastCall[0]).toHaveProperty("messages");
      expect(Array.isArray(lastCall[0].messages)).toBe(true);
      expect(lastCall[0].messages.length).toBeGreaterThan(0);

      // Verify the messages array includes the approval response
      // AI SDK v6: Check for TOOL parts in approval-responded state (user has approved)
      const messagesParam = lastCall[0].messages;
      const hasApprovalResponse = messagesParam.some((msg: any) =>
        msg.parts?.some(
          (p: any) => isToolUIPartFromAISDKv6(p) && isApprovalRespondedTool(p),
        ),
      );
      expect(hasApprovalResponse).toBe(true);

      // Verify that the automatic send actually happened
      await waitFor(
        () => {
          expect(requestCount).toBe(2);
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Test 4: Tool Approval Request Verification (Multiple Approvals)", () => {
    it("should handle two sequential tool approvals correctly", async () => {
      // Given: Setup spy wrapper around sendAutomaticallyWhen
      const { useChatOptions } = buildUseChatOptions({
        mode: "adk-sse" as Mode,
        initialMessages: [] as UIMessageFromAISDKv6[],
        adkBackendUrl: "http://localhost:8000",
      });

      const sendAutoSpy = createSendAutoSpy(
        useChatOptions.sendAutomaticallyWhen!,
      );
      const optionsWithSpy = {
        ...useChatOptions,
        sendAutomaticallyWhen: sendAutoSpy,
      };

      // Setup MSW to handle multiple confirmations
      let requestCount = 0;
      getServer().use(
        http.post("http://localhost:8000/stream", async ({ request }) => {
          requestCount++;
          const _payload = await request.json();

          // First request: Return first confirmation
          if (requestCount === 1) {
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "first-call",
                name: "first_operation",
                args: { action: "first" },
              },
            });
          }

          // Second request (after first approval): Return second confirmation
          if (requestCount === 2) {
            return createAdkConfirmationRequest({
              originalFunctionCall: {
                id: "second-call",
                name: "second_operation",
                args: { action: "second" },
              },
            });
          }

          // Third request (after second approval): Return final response
          if (requestCount === 3) {
            return createTextResponse("Both operations", " completed!");
          }

          return HttpResponse.text("Unexpected request", {
            status: 500,
          }) as any;
        }),
      );

      const { result } = renderHook(() => useChat(optionsWithSpy));

      // When: User submits message and receives first confirmation
      await act(async () => {
        result.current.sendMessage({ text: "Request two operations" });
      });

      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmationPart = findConfirmationPart(lastMessage);
          expect(confirmationPart).toBeDefined();
          expect(confirmationPart?.state).toBe("approval-requested");
        },
        { timeout: 3000 },
      );

      sendAutoSpy.mockClear();

      // Approve first confirmation
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmationPart = findConfirmationPart(lastMessage);
        result.current.addToolApprovalResponse({
          id: confirmationPart?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Wait for sendAutomaticallyWhen to be called for first approval
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Wait for second confirmation
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          const confirmations = findAllConfirmationParts(lastMessage);
          const secondConf = confirmations.find(
            (c: any) => c.toolCallId === "second-call",
          );
          expect(secondConf).toBeDefined();
        },
        { timeout: 3000 },
      );

      sendAutoSpy.mockClear();

      // Approve second confirmation
      await act(async () => {
        const lastMessage = result.current.messages.at(-1);
        const confirmations = findAllConfirmationParts(lastMessage);
        const secondConfirmation = confirmations.find(
          (c: any) => c.toolCallId === "second-call",
        );
        result.current.addToolApprovalResponse({
          id: secondConfirmation?.approval.id, // ← Use approval.id, NOT toolCallId!
          approved: true,
        });
      });

      // Verify sendAutomaticallyWhen was called for second approval
      await waitFor(
        () => {
          expect(sendAutoSpy).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );

      // Verify that three requests were made (initial + 2 approvals)
      await waitFor(
        () => {
          expect(requestCount).toBe(3);
        },
        { timeout: 3000 },
      );

      // Verify final response
      await waitFor(
        () => {
          const lastMessage = result.current.messages.at(-1);
          expect(getMessageText(lastMessage)).toContain(
            "Both operations completed!",
          );
        },
        { timeout: 3000 },
      );
    });
  });
});
