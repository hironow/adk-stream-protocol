/**
 * BIDI WebSocket Chat Transport for AI SDK v6
 *
 * Implements custom ChatTransportFromAISDKv6 to enable bidirectional streaming
 * between AI SDK useChat hook and ADK BIDI mode via WebSocket.
 *
 * Architecture: "SSE format over WebSocket"
 * ==========================================
 * Backend sends AI SDK v6 Data Stream Protocol in SSE format via WebSocket:
 *   - ADK events → SSE format (stream_protocol.py)
 *   - SSE format → WebSocket messages (/live endpoint)
 *   - WebSocket messages → SSE parsing (this class)
 *   - SSE format → UIMessageChunkFromAISDKv6 (handleWebSocketMessage)
 *   - UIMessageChunkFromAISDKv6 → useChat hook (React state)
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

import type { AudioContextValue } from "../audio-context";
import type {
  ChatRequestOptionsFromAISDKv6,
  ChatTransportFromAISDKv6,
  UIMessageChunkFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../utils";

import { EventReceiver } from "./event_receiver";
import { EventSender } from "./event_sender";

/**
 * Client-to-Server Event Protocol
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
 * WebSocket Transport Configuration
 *
 * Configuration options for WebSocketChatTransportFromAISDKv6 initialization.
 *
 * @property url - WebSocket URL (e.g., ws://localhost:8000/live or wss://example.com/live)
 *                 HTTP/HTTPS URLs will be automatically converted to WS/WSS
 * @property timeout - WebSocket connection timeout in milliseconds (default: 30000ms)
 *                     Connection attempt will fail if not established within this time
 * @property audioContext - Optional AudioContext for real-time PCM audio streaming
 *                          Only used in voice mode to route audio chunks to Web Audio API
 * @property latencyCallback - Optional callback invoked with latency measurements (ms)
 *                             Useful for monitoring connection quality in real-time
 */
export interface WebSocketChatTransportConfig {
  url: string;
  timeout?: number;
  audioContext?: AudioContextValue;
  latencyCallback?: (latency: number) => void;
}

/**
 * WebSocket Chat Transport - Bidirectional AI SDK v6 Transport
 *
 * Implements AI SDK v6 ChatTransportFromAISDKv6 interface using WebSocket for bidirectional
 * real-time communication with ADK backend. This transport enables:
 *
 * Core Features:
 * - Full-duplex bidirectional streaming (send/receive simultaneously)
 * - Real-time PCM audio streaming for voice interactions
 * - Tool confirmation workflow with user approval
 * - Persistent connection (no HTTP request/response overhead)
 *
 * Architecture:
 * - Uses EventSender for outgoing messages (converts to ADK protocol events)
 * - Uses EventReceiver for incoming messages (converts from SSE format to UIMessageChunkFromAISDKv6)
 * - Maintains single WebSocket connection throughout session
 * - Automatically handles connection lifecycle (open, close, error, reconnect)
 *
 * Protocol:
 * Backend sends AI SDK v6 Data Stream Protocol in SSE format over WebSocket.
 * This allows 100% code reuse from SSE mode while gaining WebSocket benefits.
 *
 * Thread Safety:
 * Not thread-safe. All methods must be called from the same thread (React UI thread).
 *
 * See Also:
 * - lib/sse/transport.ts: HTTP SSE version (simpler, one-way streaming)
 * - EventSender: Outgoing message handling
 * - EventReceiver: Incoming message handling
 *
 * @implements {ChatTransportFromAISDKv6<UIMessageFromAISDKv6>} AI SDK v6 ChatTransportFromAISDKv6 interface
 */
/**
 * Backend response timeout (60 seconds)
 * If backend doesn't send finish-step/[DONE] within this time after approval-request,
 * the stream will error out. This prevents infinite waiting when backend crashes.
 * See ADR 0011 gap analysis for rationale.
 */
const BACKEND_RESPONSE_TIMEOUT_MS = 60000;

export class WebSocketChatTransport implements ChatTransportFromAISDKv6 {
  private config: WebSocketChatTransportConfig;
  private ws: WebSocket | null = null;

  // BIDI event handling (refactored into separate modules)
  private eventReceiver: EventReceiver;
  private eventSender: EventSender;

  private pingInterval: NodeJS.Timeout | null = null; // Ping interval timer
  private lastPingTime: number | null = null; // Timestamp of last ping

  // Backend response timeout for approval flow (ADR 0011 gap fix)
  private approvalTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Controller lifecycle management
  // Tracks current ReadableStream controller to prevent orphaning on handler override
  private currentController: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6> | null =
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
      onPong: (timestamp: number) => this._handlePong(timestamp),
      // ADR 0011 gap fix: Start timeout when approval-request received
      onApprovalRequestReceived: () => this._startApprovalTimeout(),
      // ADR 0011 gap fix: Clear timeout when finish-step/[DONE] received
      onApprovalStreamClosed: () => this._clearApprovalTimeout(),
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
  public __sendToolResult(
    toolCallId: string,
    result: Record<string, unknown>,
  ): void {
    this.eventSender.sendToolResult(toolCallId, result);
  }

  public __startAudio(): void {
    this.eventSender.startAudio();
  }

  public __stopAudio(): void {
    this.eventSender.stopAudio();
  }

  public __sendAudioChunk(chunk: {
    content: string;
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }): void {
    this.eventSender.sendAudioChunk(chunk);
  }

  private _startPing() {
    this._stopPing(); // Clear any existing interval

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.eventSender.ping(this.lastPingTime);
      }
    }, 2000); // Ping every 2 seconds
  }

  private _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.lastPingTime = null;
  }

  private _handlePong(timestamp: number) {
    if (this.lastPingTime && timestamp === this.lastPingTime) {
      const rtt = Date.now() - this.lastPingTime;
      this.config.latencyCallback?.(rtt);
    }
  }

  /**
   * Start timeout for backend response after approval-request
   * ADR 0011 gap fix: Prevents infinite waiting when backend crashes
   */
  private _startApprovalTimeout() {
    this._clearApprovalTimeout(); // Clear any existing timeout

    this.approvalTimeoutId = setTimeout(() => {
      console.error(
        `[WS Transport] Backend response timeout (${BACKEND_RESPONSE_TIMEOUT_MS / 1000}s) - no finish-step/[DONE] received after approval-request`,
      );

      // Error the current controller if it exists
      if (this.currentController) {
        try {
          this.currentController.error(
            new Error(
              `Backend response timeout: No response within ${BACKEND_RESPONSE_TIMEOUT_MS / 1000} seconds after approval-request`,
            ),
          );
        } catch (err) {
          console.debug(
            "[WS Transport] Cannot error controller (already closed):",
            err,
          );
        }
      }

      this.approvalTimeoutId = null;
    }, BACKEND_RESPONSE_TIMEOUT_MS);

    console.debug(
      `[WS Transport] Started approval timeout (${BACKEND_RESPONSE_TIMEOUT_MS / 1000}s)`,
    );
  }

  /**
   * Clear the backend response timeout
   * Called when finish-step or [DONE] is received
   */
  private _clearApprovalTimeout() {
    if (this.approvalTimeoutId) {
      clearTimeout(this.approvalTimeoutId);
      this.approvalTimeoutId = null;
      console.debug("[WS Transport] Cleared approval timeout");
    }
  }

  /**
   * Send messages and return stream of UI message chunks.
   * Required by ChatTransportFromAISDKv6 interface.
   */
  async sendMessages(
    options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessageFromAISDKv6[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptionsFromAISDKv6,
  ): Promise<ReadableStream<UIMessageChunkFromAISDKv6>> {
    console.log("[WS Transport] sendMessages() called:", {
      trigger: options.trigger,
      messageCount: options.messages.length,
      lastMessage: options.messages[options.messages.length - 1],
    });

    const { url, timeout } = this.config;

    return new ReadableStream<UIMessageChunkFromAISDKv6>({
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
                this._startPing(); // Start latency monitoring

                // Update EventSender with new WebSocket instance
                this.eventSender.setWebSocket(this.ws);

                // DEBUG: Expose WebSocket for e2e testing (Phase 4 timeout test)
                if (typeof window !== "undefined") {
                  // biome-ignore lint/suspicious/noExplicitAny: Intentional for E2E testing hook
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
                this._handleWebSocketMessage(event.data, controller);
              };

              this.ws.onerror = (error) => {
                console.error("[WS Transport] Error:", error);
                this._stopPing(); // Stop ping on error
                try {
                  controller.error(new Error("WebSocket error"));
                } catch (err) {
                  // Controller already closed (e.g., [DONE] was received) - ignore error
                  console.debug(
                    "[WS Transport] Cannot error controller (already closed):",
                    err,
                  );
                }
              };

              this.ws.onclose = () => {
                this._stopPing(); // Stop ping on close
                try {
                  controller.close();
                } catch (_err) {
                  // Controller already closed - ignore error (common in tests)
                  // Suppress logging as this is expected behavior during cleanup
                }
              };
            }
          } else {
            // Reuse existing connection

            // BIDI Blocking Mode: Check if previous stream completed with [DONE]
            // If [DONE] not received, reuse controller (approval/tool-output in same stream)
            // If [DONE] received, close previous controller and create new stream
            const doneReceived = this.eventReceiver.isDoneReceived();

            if (doneReceived) {
              // Previous stream completed - close controller and start new stream
              if (this.currentController) {
                console.debug(
                  "[WS Transport] Closing previous stream (received [DONE])",
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
            } else {
              // BIDI Blocking Mode: Stream still active (no [DONE] yet)
              // Reuse existing controller for approval/tool-output
              console.debug(
                "[WS Transport] Reusing controller (BIDI Blocking Mode - no [DONE] yet)",
              );

              // DO NOT close previous controller
              // DO NOT reset EventReceiver (maintain state)
              // Continue using this.currentController

              // Note: We ignore the new controller and keep using the existing one
              // This ensures approval/tool-output responses are in the same stream
            }

            // Update message handler for stream (use appropriate controller)
            // If reusing controller (BIDI Blocking Mode), keep using existing one
            // If new stream, use new controller
            const activeController = doneReceived
              ? controller
              : (this.currentController ?? controller);

            if (this.ws) {
              this.ws.onmessage = (event) => {
                this._handleWebSocketMessage(event.data, activeController);
              };

              this.ws.onerror = (error) => {
                console.error("[WS Transport] Error:", error);
                this._stopPing(); // Stop ping on error
                try {
                  activeController.error(new Error("WebSocket error"));
                } catch (err) {
                  // Controller already closed (e.g., [DONE] was received) - ignore error
                  console.debug(
                    "[WS Transport] Cannot error controller (already closed):",
                    err,
                  );
                }
              };

              this.ws.onclose = () => {
                this._stopPing(); // Stop ping on close
                try {
                  activeController.close();
                } catch (_err) {
                  // Controller already closed - ignore error (common in tests)
                  // Suppress logging as this is expected behavior during cleanup
                }
              };
            }
          }

          // Send messages to backend using structured event format
          // Format matches AI SDK v6 HttpChatTransportFromAISDKv6 (SSE mode) exactly
          this.eventSender.sendMessages({
            chatId: options.chatId,
            messages: options.messages,
            trigger: options.trigger,
            messageId: options.messageId,
          });
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

  private _handleWebSocketMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): void {
    // Delegate to EventReceiver
    this.eventReceiver.handleMessage(data, controller);
  }

  /**
   * Reconnect to stream (not supported for WebSocket)
   * WebSocket connections are stateful, reconnection requires new connection.
   */
  async reconnectToStream(
    _options: { chatId: string } & ChatRequestOptionsFromAISDKv6,
  ): Promise<ReadableStream<UIMessageChunkFromAISDKv6> | null> {
    // WebSocket connections cannot be reconnected to specific streams
    // Client needs to establish new connection
    return null;
  }

  _close(): void {
    this._clearApprovalTimeout(); // Clear any pending approval timeout
    this._stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
