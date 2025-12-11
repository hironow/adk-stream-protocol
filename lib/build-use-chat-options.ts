import type { UIMessage } from "@ai-sdk/react";
import { WebSocketChatTransport } from "@/lib/websocket-chat-transport";

export type BackendMode = "gemini" | "adk-sse" | "adk-bidi";

// Debug logging controlled by environment variable
// Set NEXT_PUBLIC_DEBUG_CHAT_OPTIONS=true to enable
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_CHAT_OPTIONS === "true";

function debugLog(message: string, ...args: any[]) {
  if (DEBUG) {
    console.log("[buildUseChatOptions]", message, ...args);
  }
}

/**
 * Build useChat options based on backend mode
 * This function is extracted for testability and encapsulates all backend configuration logic
 *
 * KNOWN ISSUE: AI SDK v6 useChat hook does not respect dynamic `api` prop changes
 * - GitHub Issue: https://github.com/vercel/ai/issues/7070
 * - "useChat hook does not respect dynamic api prop changes in DefaultChatTransport"
 * - Date: 2025-07-05
 * - Symptom: useChat captures the initial api route value at initialization,
 *   and subsequent changes to the state variable passed to the api prop do not
 *   reconfigure the transport, resulting in all requests being sent to the
 *   original endpoint even after the state has updated.
 * - Workaround: Force component re-mount via key prop when mode/endpoint changes
 *
 * Additionally, `prepareSendMessagesRequest` callback does not appear to be
 * invoked in AI SDK v6 beta, making it impossible to intercept and modify
 * requests before they are sent.
 */
export function buildUseChatOptions({
  mode,
  initialMessages,
  adkBackendUrl = typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ADK_BACKEND_URL
    ? process.env.NEXT_PUBLIC_ADK_BACKEND_URL
    : "http://localhost:8000",
  forceNewInstance = false,
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
}) {
  // Compute API endpoint based on mode FIRST
  // (needed for chatId generation)
  let apiEndpoint: string;
  switch (mode) {
    case "adk-sse":
      apiEndpoint = `${adkBackendUrl}/stream`;
      break;
    case "adk-bidi":
      apiEndpoint = `${adkBackendUrl.replace(/^http/, "ws")}/live`;
      break;
    case "gemini":
    default:
      apiEndpoint = "/api/chat";
      break;
  }

  // Generate unique chatId that includes endpoint hash
  // This ensures a new Chat instance is created when the endpoint changes
  // (workaround for AI SDK v6 bug where `api` option changes are ignored)
  const endpointHash = apiEndpoint.replace(/[^a-zA-Z0-9]/g, "-");
  const chatId = forceNewInstance
    ? `chat-${mode}-${endpointHash}-${Date.now()}`
    : `chat-${mode}-${endpointHash}`;

  // Create WebSocket transport for BIDI mode
  let websocketTransport: WebSocketChatTransport | undefined;
  if (mode === "adk-bidi") {
    const wsUrl = adkBackendUrl.replace(/^http/, "ws") + "/live";
    debugLog("Creating WebSocket transport:", wsUrl);
    websocketTransport = new WebSocketChatTransport({
      url: wsUrl,
      toolCallCallback: async (toolCall) => {
        debugLog("Tool call:", toolCall);
        // Tools are handled on backend for now
        return { handled: "backend" };
      },
    });
  }

  const baseOptions = {
    messages: initialMessages,
    id: chatId,
  };

  debugLog("Building options for mode:", mode, "chatId:", chatId, "endpoint:", apiEndpoint);

  // Use switch to completely separate each mode's configuration
  // This prevents accidental mixing of options between modes
  switch (mode) {
    case "gemini":
      debugLog("Configuring useChat for Gemini Direct mode");
      const geminiOptions = {
        ...baseOptions,
        api: apiEndpoint,
      };
      debugLog("Gemini options:", JSON.stringify({ id: geminiOptions.id, api: geminiOptions.api, messagesCount: geminiOptions.messages.length }));
      return geminiOptions;

    case "adk-sse":
      debugLog("Configuring useChat for ADK SSE mode");
      const adkSseOptions = {
        ...baseOptions,
        api: apiEndpoint,
      };
      debugLog("ADK SSE options:", JSON.stringify({ id: adkSseOptions.id, api: adkSseOptions.api, messagesCount: adkSseOptions.messages.length }));
      return adkSseOptions;

    case "adk-bidi":
      if (!websocketTransport) {
        throw new Error("WebSocket transport is required for ADK BIDI mode");
      }
      debugLog("Configuring useChat for ADK BIDI mode with WebSocket transport");
      const adkBidiOptions = {
        ...baseOptions,
        transport: websocketTransport,
      };
      debugLog("ADK BIDI options:", adkBidiOptions);
      return adkBidiOptions;

    default:
      // TypeScript will catch this at compile time if we add a new mode
      const exhaustiveCheck: never = mode;
      throw new Error(`Unhandled backend mode: ${exhaustiveCheck}`);
  }
}
