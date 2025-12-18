import type { UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { sendAutomaticallyWhenAdkConfirmation } from "@/lib/adk_compat";
import { ChunkLoggingTransport } from "@/lib/chunk-logging-transport";
import { ChunkPlayerTransport } from "@/lib/chunk-player-transport";
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
  needsUserActivation: boolean;
  activate: () => Promise<void>;
}

// Debug logging controlled by environment variable
// Set NEXT_PUBLIC_DEBUG_CHAT_OPTIONS=true to enable
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_CHAT_OPTIONS === "true";

function debugLog(message: string, ...args: unknown[]) {
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
/**
 * Return type for buildUseChatOptions
 * Includes useChat options and optional transport reference for imperative control
 */
export interface UseChatOptionsWithTransport {
  useChatOptions: {
    transport:
      | DefaultChatTransport<UIMessage>
      | WebSocketChatTransport
      | ChunkLoggingTransport;
    messages: UIMessage[];
    id: string;
    sendAutomaticallyWhen?: (options: {
      messages: UIMessage[];
    }) => boolean | PromiseLike<boolean>;
  };
  transport?: WebSocketChatTransport;
}

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
}): UseChatOptionsWithTransport {
  const result = buildUseChatOptionsInternal({
    mode,
    initialMessages,
    adkBackendUrl,
    forceNewInstance,
    audioContext,
  });
  return result;
}

function buildUseChatOptionsInternal({
  mode,
  initialMessages,
  adkBackendUrl = "http://localhost:8000",
  forceNewInstance = false,
  audioContext,
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  adkBackendUrl?: string;
  forceNewInstance?: boolean;
  audioContext?: AudioContextValue;
}) {
  // E2E Test Mode: Use ChunkPlayerTransport for deterministic testing
  if (typeof window !== "undefined") {
    const isChunkPlayerMode =
      window.localStorage.getItem("E2E_CHUNK_PLAYER_MODE") === "true";
    // debugLog("E2E mode check:", {
    //   isChunkPlayerMode,
    //   localStorage: window.localStorage.getItem("E2E_CHUNK_PLAYER_MODE"),
    // });
    if (isChunkPlayerMode) {
      const fixturePath = window.localStorage.getItem(
        "E2E_CHUNK_PLAYER_FIXTURE",
      );
      // debugLog("E2E Chunk Player Mode enabled, fixture:", fixturePath);
      if (fixturePath) {
        // Create chunk player transport (lazy loading - fixture loaded on first sendMessages)
        const transport = ChunkPlayerTransport.fromFixture(fixturePath);
        const chatId = `chunk-player-${mode}`;
        return {
          useChatOptions: {
            messages: initialMessages,
            id: chatId,
            // ChunkPlayerTransport implements ChatTransport
            transport: transport as unknown as DefaultChatTransport<UIMessage>,
          },
          transport: undefined,
        };
      }
    }
  }

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
      audioContext, // Pass AudioContext for PCM streaming
    });

    // Expose transport to window for E2E testing (only in development/test)
    if (
      typeof window !== "undefined" &&
      process.env.NODE_ENV !== "production"
    ) {
      (window as any).webSocketTransport = websocketTransport;
    }
  }

  // WORKAROUND: Use prepareSendMessagesRequest to override endpoint
  // This is the proper extension point in AI SDK v6 for dynamic endpoint routing
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 type definition requires body field which breaks functionality
  const prepareSendMessagesRequest = async (options: any) => {
    // IMPORTANT: Don't return `body` field - let AI SDK construct it
    // If we return body: {}, AI SDK will use that empty object instead of building the proper request
    const { body: _body, ...restOptions } = options;
    return {
      ...restOptions,
      api: apiEndpoint, // Override with correct endpoint for this mode
    };
  };

  const baseOptions = {
    messages: initialMessages,
    id: chatId,
  };

  // debugLog(
  //   "Building options for mode:",
  //   mode,
  //   "chatId:",
  //   chatId,
  //   "endpoint:",
  //   apiEndpoint,
  // );

  // Use switch to completely separate each mode's configuration
  // This prevents accidental mixing of options between modes
  switch (mode) {
    case "gemini": {
      // Create transport manually to pass prepareSendMessagesRequest
      const baseTransport = new DefaultChatTransport({
        api: apiEndpoint,
        prepareSendMessagesRequest,
      });
      // Wrap with chunk logging transport
      const geminiTransport = new ChunkLoggingTransport(
        baseTransport,
        "gemini",
      );
      const geminiOptions = {
        ...baseOptions,
        transport: geminiTransport,
      };
      // debugLog("Gemini options:", geminiOptions);
      return { useChatOptions: geminiOptions, transport: undefined };
    }

    case "adk-sse": {
      // Create transport manually to pass prepareSendMessagesRequest
      const baseTransport = new DefaultChatTransport({
        api: apiEndpoint,
        prepareSendMessagesRequest,
      });
      // Wrap with chunk logging transport
      const adkSseTransport = new ChunkLoggingTransport(
        baseTransport,
        "adk-sse",
      );
      const adkSseOptions = {
        ...baseOptions,
        transport: adkSseTransport,
        sendAutomaticallyWhen: sendAutomaticallyWhenAdkConfirmation,
      };
      // debugLog("ADK SSE options:", adkSseOptions);
      return { useChatOptions: adkSseOptions, transport: undefined };
    }

    case "adk-bidi": {
      if (!websocketTransport) {
        throw new Error("WebSocket transport is required for ADK BIDI mode");
      }
      const adkBidiOptions = {
        ...baseOptions,
        transport: websocketTransport,
        sendAutomaticallyWhen: sendAutomaticallyWhenAdkConfirmation,
      };
      // debugLog("ADK BIDI options:", adkBidiOptions);
      return { useChatOptions: adkBidiOptions, transport: websocketTransport };
    }

    default: {
      // TypeScript will catch this at compile time if we add a new mode
      const exhaustiveCheck: never = mode;
      throw new Error(`Unhandled backend mode: ${exhaustiveCheck}`);
    }
  }
}
