import type { UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { WebSocketChatTransport } from "@/lib/websocket-chat-transport";

export type BackendMode = "gemini" | "adk-sse" | "adk-bidi";

/**
 * AudioContext interface (from lib/audio-context.tsx)
 */
interface AudioContextValue {
  voiceChannel: {
    isPlaying: boolean;
    chunkCount: number;
    sendChunk: (chunk: {
      content: string;
      sampleRate: number;
      channels: number;
      bitDepth: number;
    }) => void;
    reset: () => void;
  };
  isReady: boolean;
  error: string | null;
  wsLatency: number | null;
  updateLatency: (latency: number) => void;
}

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
 * KNOWN ISSUE: AI SDK v6 useChat hook does not respect `api` prop
 * - Investigation: experiments/2025-12-11_e2e_test_timeout_investigation.md:440-513
 * - Symptom: All HTTP requests go to the first endpoint regardless of `api` value
 * - Tested workarounds (all failed):
 *   - Dynamic `api` reconfiguration
 *   - Component re-mounting with key prop
 *   - Three separate useChat instances with different `api` values
 * - Root cause hypothesis: Global/module-level endpoint cache in AI SDK v6 beta
 * - Solution: Custom fetch function to bypass broken `api` routing
 */
export function buildUseChatOptions({
  mode,
  initialMessages,
  adkBackendUrl = typeof process !== "undefined" &&
  process.env?.NEXT_PUBLIC_ADK_BACKEND_URL
    ? process.env.NEXT_PUBLIC_ADK_BACKEND_URL
    : "http://localhost:8000",
  forceNewInstance = false,
  audioContext,
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
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
    default:
      apiEndpoint = "/api/chat";
      break;
  }

  // Generate unique chatId that includes endpoint hash
  // This ensures a new Chat instance is created when the endpoint changes
  const endpointHash = apiEndpoint.replace(/[^a-zA-Z0-9]/g, "-");
  const chatId = forceNewInstance
    ? `chat-${mode}-${endpointHash}-${Date.now()}`
    : `chat-${mode}-${endpointHash}`;

  // Create WebSocket transport for BIDI mode
  let websocketTransport: WebSocketChatTransport | undefined;
  if (mode === "adk-bidi") {
    const wsUrl = `${adkBackendUrl.replace(/^http/, "ws")}/live`;
    debugLog("Creating WebSocket transport:", wsUrl);
    websocketTransport = new WebSocketChatTransport({
      url: wsUrl,
      toolCallCallback: async (toolCall) => {
        debugLog("Tool call:", toolCall);
        // Tools are handled on backend for now
        return { handled: "backend" };
      },
      audioContext, // Pass AudioContext for PCM streaming
      latencyCallback: audioContext?.updateLatency, // Pass latency callback for WebSocket monitoring
    });
  }

  // WORKAROUND: Use prepareSendMessagesRequest to override endpoint
  // This is the proper extension point in AI SDK v6 for dynamic endpoint routing
  const prepareSendMessagesRequest = async (options: any) => {
    // IMPORTANT: Don't return `body` field - let AI SDK construct it
    // If we return body: {}, AI SDK will use that empty object instead of building the proper request
    const { body, ...restOptions } = options;
    return {
      ...restOptions,
      api: apiEndpoint, // Override with correct endpoint for this mode
    };
  };

  const baseOptions = {
    messages: initialMessages,
    id: chatId,
  };

  debugLog(
    "Building options for mode:",
    mode,
    "chatId:",
    chatId,
    "endpoint:",
    apiEndpoint,
  );

  // Use switch to completely separate each mode's configuration
  // This prevents accidental mixing of options between modes
  switch (mode) {
    case "gemini": {
      debugLog("Configuring useChat for Gemini Direct mode");
      // Create transport manually to pass prepareSendMessagesRequest
      const geminiTransport = new DefaultChatTransport({
        api: apiEndpoint,
        prepareSendMessagesRequest,
      });
      const geminiOptions = {
        ...baseOptions,
        transport: geminiTransport,
      };
      debugLog(
        "Gemini options:",
        JSON.stringify({
          id: geminiOptions.id,
          messagesCount: geminiOptions.messages.length,
        }),
      );
      return geminiOptions;
    }

    case "adk-sse": {
      debugLog("Configuring useChat for ADK SSE mode");
      // Create transport manually to pass prepareSendMessagesRequest
      const adkSseTransport = new DefaultChatTransport({
        api: apiEndpoint,
        prepareSendMessagesRequest,
      });
      const adkSseOptions = {
        ...baseOptions,
        transport: adkSseTransport,
      };
      debugLog(
        "ADK SSE options:",
        JSON.stringify({
          id: adkSseOptions.id,
          messagesCount: adkSseOptions.messages.length,
        }),
      );
      return adkSseOptions;
    }

    case "adk-bidi": {
      if (!websocketTransport) {
        throw new Error("WebSocket transport is required for ADK BIDI mode");
      }
      debugLog(
        "Configuring useChat for ADK BIDI mode with WebSocket transport",
      );
      const adkBidiOptions = {
        ...baseOptions,
        transport: websocketTransport,
      };
      debugLog("ADK BIDI options:", adkBidiOptions);
      return adkBidiOptions;
    }

    default: {
      // TypeScript will catch this at compile time if we add a new mode
      const exhaustiveCheck: never = mode;
      throw new Error(`Unhandled backend mode: ${exhaustiveCheck}`);
    }
  }
}
