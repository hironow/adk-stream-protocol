/**
 * WebSocket Chat Transport for AI SDK v6
 *
 * Implements custom ChatTransport to enable bidirectional streaming
 * between AI SDK useChat hook and ADK BIDI mode via WebSocket.
 *
 * Architecture: "SSE format over WebSocket"
 * ==========================================
 * Backend sends AI SDK v6 Data Stream Protocol in SSE format via WebSocket:
 *   - ADK events → SSE format (stream_protocol.py)
 *   - SSE format → WebSocket messages (server.py /live endpoint)
 *   - WebSocket messages → SSE parsing (this class)
 *   - SSE format → UIMessageChunk (handleWebSocketMessage)
 *   - UIMessageChunk → useChat hook (React state)
 *
 * Key Insight: Protocol stays the same (AI SDK v6 Data Stream Protocol),
 *             only transport layer changes (HTTP SSE → WebSocket)
 *
 * Benefits:
 *   - Reuses 100% of SSE mode conversion logic
 *   - Consistent protocol across all modes
 *   - Simple implementation (just parse SSE format)
 *
 * Based on community implementation by alexmarmon:
 * https://github.com/vercel/ai/discussions/5607
 */

import type {
  ChatRequestOptions,
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";

import { EventReceiver } from "./bidi/event_receiver";
import { EventSender } from "./bidi/event_sender";

/**
 * AudioContext interface for PCM streaming
 * (imported from lib/audio-context.tsx in buildUseChatOptions)
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
    onComplete?: (metadata: {
      chunks: number;
      bytes: number;
      sampleRate: number;
      duration: number;
    }) => void;
  };
  isReady: boolean;
  error: string | null;
}

/**
 * Client-to-Server Event Protocol (P2-T2)
 * =======================================
 * Structured event protocol for bidirectional communication.
 *
 * All client events follow this format:
 *   - type: Event identifier (message, interrupt, audio_control, etc.)
 *   - version: Protocol version for backward compatibility
 *   - timestamp: Optional client timestamp (milliseconds since epoch)
 *   - data: Event-specific payload
 */

/**
 * WebSocket transport configuration
 */
export interface WebSocketChatTransportConfig {
  /** WebSocket URL (e.g., ws://localhost:8000/live) */
  url: string;

  /** WebSocket connection timeout (ms) */
  timeout?: number;

  /** Optional AudioContext for PCM streaming (BIDI mode only) */
  audioContext?: AudioContextValue;

  /** Optional callback for latency updates (ms) */
  latencyCallback?: (latency: number) => void;
}

/**
 * WebSocket Chat Transport
 *
 * Enables bidirectional streaming with ADK backend via WebSocket.
 * Compatible with AI SDK v6 useChat hook.
 */
export class WebSocketChatTransport implements ChatTransport<UIMessage> {
  private config: WebSocketChatTransportConfig;
  private ws: WebSocket | null = null;

  // BIDI event handling (refactored into separate modules)
  private eventReceiver: EventReceiver;
  private eventSender: EventSender;

  private pingInterval: NodeJS.Timeout | null = null; // Ping interval timer
  private lastPingTime: number | null = null; // Timestamp of last ping

  // Controller lifecycle management (P4-T10)
  // Tracks current ReadableStream controller to prevent orphaning on handler override
  private currentController: ReadableStreamDefaultController<UIMessageChunk> | null =
    null;

  // PCM audio parameters (used for bridging EventReceiver → external AudioContext)
  private pcmSampleRate = 24000; // Default sample rate (updated from first chunk)
  private pcmChannels = 1; // Default channels (updated from first chunk)
  private pcmBitDepth = 16; // Default bit depth (updated from first chunk)

  constructor(config: WebSocketChatTransportConfig) {
    this.config = {
      timeout: 30000, // 30 seconds default
      ...config,
    };

    // Initialize BIDI event handling modules
    this.eventReceiver = new EventReceiver({
      audioContext: config.audioContext
        ? {
            voiceChannel: {
              reset: () => config.audioContext?.voiceChannel.reset(),
              playPCM: (pcmData: Int16Array) => {
                // Convert Int16Array to base64 for playPCM
                const bytes = new Uint8Array(pcmData.buffer);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);

                config.audioContext?.voiceChannel.sendChunk({
                  content: base64,
                  sampleRate: this.pcmSampleRate,
                  channels: this.pcmChannels,
                  bitDepth: this.pcmBitDepth,
                });
              },
            },
          }
        : undefined,
      onPong: (timestamp: number) => this.handlePong(timestamp),
    });

    this.eventSender = new EventSender(this.ws);
  }

  //
  // NOTE: Event sending methods have been refactored to lib/bidi/event_sender.ts
  // All sending is now delegated to eventSender instance
  //

  /**
   * PUBLIC API: Interrupt ongoing AI response
   * Use cases:
   *   - ESC key pressed during response
   *   - User clicks cancel button
   *   - Timeout or error conditions
   */
  public interrupt(reason?: "user_abort" | "timeout" | "error"): void {
    this.eventSender.interrupt(reason);
  }

  /**
   * PUBLIC API: Send tool execution result (BIDI delegate pattern)
   * Use case: Frontend executed a client-side tool and sends result back to backend
   * to resolve the delegate Future
   */
  public sendToolResult(
    toolCallId: string,
    result: Record<string, unknown>,
  ): void {
    this.eventSender.sendToolResult(toolCallId, result);
  }

  /**
   * PUBLIC API: Send function_response to resume paused agent (LongRunningFunctionTool pattern)
   * Use case: User approved a long-running tool → send function_response to resume ADK agent
   *
   * Based on AI SDK v6 message format discovered from ai_sdk_v6_compat.py:385-390:
   * ```python
   * function_response = types.FunctionResponse(
   *     id=tool_call_id,
   *     name="approval_test_tool",
   *     response={"approved": true}
   * )
   * ```
   */
  public sendFunctionResponse(
    toolCallId: string,
    toolName: string,
    response: Record<string, unknown>,
  ): void {
    this.eventSender.sendFunctionResponse(toolCallId, toolName, response);
  }

  /**
   * PUBLIC API: Start audio input (BIDI mode)
   * Use case: CMD key pressed, start recording microphone
   */
  public startAudio(): void {
    this.eventSender.startAudio();
  }

  /**
   * PUBLIC API: Stop audio input (BIDI mode)
   * Use case: CMD key released, stop recording microphone
   */
  public stopAudio(): void {
    this.eventSender.stopAudio();
  }

  /**
   * PUBLIC API: Send audio chunk to backend (BIDI mode)
   * Used for streaming microphone input
   */
  public sendAudioChunk(chunk: {
    content: string;
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }): void {
    this.eventSender.sendAudioChunk(chunk);
  }

  // sendToolResult() removed - use AI SDK v6's standard addToolApprovalResponse flow
  // Tool approval flow: addToolApprovalResponse() → sendAutomaticallyWhen → transport.sendMessages()
  // See experiments/2025-12-13_lib_test_coverage_investigation.md:1640-1679 for details

  /**
   * Start ping/pong for latency monitoring
   */
  private startPing() {
    this.stopPing(); // Clear any existing interval

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.eventSender.ping(this.lastPingTime);
      }
    }, 2000); // Ping every 2 seconds
  }

  /**
   * Stop ping/pong monitoring
   */
  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.lastPingTime = null;
  }

  /**
   * Handle pong response and calculate RTT
   */
  private handlePong(timestamp: number) {
    if (this.lastPingTime && timestamp === this.lastPingTime) {
      const rtt = Date.now() - this.lastPingTime;
      this.config.latencyCallback?.(rtt);
    }
  }

  /**
   * Send messages and return stream of UI message chunks.
   * Required by ChatTransport interface.
   */
  async sendMessages(
    options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    console.log("[WS Transport] sendMessages() called:", {
      trigger: options.trigger,
      messageCount: options.messages.length,
      lastMessage: options.messages[options.messages.length - 1],
    });

    // DEBUG: Log last 3 messages to see tool output structure
    console.log(
      "[DEBUG] Last 3 messages:",
      JSON.stringify(options.messages.slice(-3), null, 2),
    );

    const { url, timeout } = this.config;

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          // Check if we can reuse existing connection
          const needsNewConnection =
            !this.ws ||
            this.ws.readyState === WebSocket.CLOSED ||
            this.ws.readyState === WebSocket.CLOSING;

          if (needsNewConnection) {
            // Create WebSocket connection
            this.ws = new WebSocket(url);

            // Connection timeout
            const timeoutId = setTimeout(() => {
              controller.error(new Error("WebSocket connection timeout"));
              this.ws?.close();
            }, timeout);

            // Wait for connection to open
            await new Promise<void>((resolve, reject) => {
              if (!this.ws) {
                reject(new Error("WebSocket not initialized"));
                return;
              }

              this.ws.onopen = () => {
                clearTimeout(timeoutId);
                this.startPing(); // Start latency monitoring

                // Update EventSender with new WebSocket instance
                this.eventSender.setWebSocket(this.ws);

                // DEBUG: Expose WebSocket for e2e testing (Phase 4 timeout test)
                if (typeof window !== "undefined") {
                  (window as any).__websocket = this.ws;
                  console.log(
                    "[WS Transport] WebSocket instance exposed for testing",
                  );
                }

                resolve();
              };

              this.ws.onerror = (error) => {
                clearTimeout(timeoutId);
                console.error("[WS Transport] Connection error:", error);
                reject(new Error("WebSocket connection failed"));
              };
            });

            // Set up message handler
            if (this.ws) {
              // Save controller reference (P4-T10)
              this.currentController = controller;

              // Reset EventReceiver state for new stream (Session 7)
              this.eventReceiver.reset();

              this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event.data, controller);
              };

              this.ws.onerror = (error) => {
                console.error("[WS Transport] Error:", error);
                this.stopPing(); // Stop ping on error
                controller.error(new Error("WebSocket error"));
              };

              this.ws.onclose = () => {
                this.stopPing(); // Stop ping on close
                controller.close();
              };
            }
          } else {
            // Reuse existing connection

            // Close previous controller to prevent orphaning (P4-T10)
            if (this.currentController) {
              console.warn(
                "[WS Transport] Closing previous stream before reusing connection",
              );
              try {
                this.currentController.close();
              } catch (_err) {
                // Controller already closed - ignore error
                console.debug(
                  "[WS Transport] Previous controller already closed",
                );
              }
            }

            // Save new controller reference (P4-T10)
            this.currentController = controller;

            // Reset EventReceiver state for new stream (Session 7)
            this.eventReceiver.reset();

            // Update message handler for new stream
            if (this.ws) {
              this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event.data, controller);
              };

              this.ws.onerror = (error) => {
                console.error("[WS Transport] Error:", error);
                this.stopPing(); // Stop ping on error
                controller.error(new Error("WebSocket error"));
              };

              this.ws.onclose = () => {
                this.stopPing(); // Stop ping on close
                controller.close();
              };
            }
          }

          // Send messages to backend using structured event format (P2-T2)
          // Note: We send ALL messages without truncation to preserve context for ADK BIDI
          // Size warnings are still logged but messages are not truncated
          this.eventSender.sendMessages(options.messages);
        } catch (error) {
          console.error("[WS Transport] Error in start:", error);
          controller.error(error);
        }
      },

      cancel: () => {
        this.ws?.close();
        this.ws = null;
      },
    });
  }

  /**
   * Handle incoming WebSocket messages.
   * Delegates to EventReceiver for SSE parsing and UIMessageChunk conversion.
   *
   * IMPORTANT: Protocol conversion happens in EventReceiver!
   * Backend sends AI SDK v6 Data Stream Protocol in SSE format over WebSocket:
   *   - Format: 'data: {"type":"text-delta","text":"..."}\n\n'
   *   - Same format as HTTP SSE, but delivered via WebSocket
   *
   * Architecture: SSE format over WebSocket
   *   - Backend: ADK events → SSE format (stream_protocol.py)
   *   - Transport: SSE format over WebSocket (this layer)
   *   - EventReceiver: SSE format → UIMessageChunk (lib/bidi/event_receiver.ts)
   */
  private handleWebSocketMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    // Delegate to EventReceiver
    this.eventReceiver.handleMessage(data, controller);
  }

  //
  // NOTE: Message handling methods (convertPcmToWav, handleCustomEventWithSkip, handleCustomEventWithoutSkip)
  // have been refactored to lib/bidi/event_receiver.ts for better modularity and testability.
  //

  /**
   * Reconnect to stream (not supported for WebSocket)
   * WebSocket connections are stateful, reconnection requires new connection.
   */
  async reconnectToStream(
    _options: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // WebSocket connections cannot be reconnected to specific streams
    // Client needs to establish new connection
    return null;
  }

  /**
   * Close WebSocket connection
   */
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
