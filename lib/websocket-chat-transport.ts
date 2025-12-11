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

import type { UIMessageChunk } from "ai";

/**
 * Message part types
 */
interface TextPart {
  type: "text";
  text: string;
}

interface ImagePart {
  type: "image";
  data: string; // base64 encoded
  media_type: string; // "image/png", "image/jpeg", "image/webp"
}

type MessagePart = TextPart | ImagePart;

/**
 * Message format sent to backend
 */
interface SendMessagesParams {
  messages: Array<{
    role: string;
    content?: string;
    parts?: Array<MessagePart>;
  }>;
}

/**
 * WebSocket transport configuration
 */
export interface WebSocketChatTransportConfig {
  /** WebSocket URL (e.g., ws://localhost:8000/live) */
  url: string;

  /** Optional callback for handling tool calls on frontend */
  toolCallCallback?: (toolCall: any) => Promise<any>;

  /** WebSocket connection timeout (ms) */
  timeout?: number;
}

/**
 * WebSocket Chat Transport
 *
 * Enables bidirectional streaming with ADK backend via WebSocket.
 * Compatible with AI SDK v6 useChat hook.
 */
export class WebSocketChatTransport {
  private config: WebSocketChatTransportConfig;
  private ws: WebSocket | null = null;

  constructor(config: WebSocketChatTransportConfig) {
    this.config = {
      timeout: 30000, // 30 seconds default
      ...config,
    };
  }

  /**
   * Send messages and return stream of UI message chunks.
   * Required by ChatTransport interface.
   */
  async sendMessages(
    params: SendMessagesParams
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { url, timeout } = this.config;

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
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
              console.log("[WS Transport] Connected to", url);
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
            this.ws.onmessage = (event) => {
              this.handleWebSocketMessage(event.data, controller);
            };

            this.ws.onerror = (error) => {
              console.error("[WS Transport] Error:", error);
              controller.error(new Error("WebSocket error"));
            };

            this.ws.onclose = () => {
              console.log("[WS Transport] Connection closed");
              controller.close();
            };
          }

          // Send messages to backend
          const messageData = JSON.stringify({ messages: params.messages });
          this.ws.send(messageData);
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
   * Converts SSE format to UIMessageChunk and enqueues.
   *
   * IMPORTANT: Protocol conversion happens here!
   * Backend sends AI SDK v6 Data Stream Protocol in SSE format over WebSocket:
   *   - Format: 'data: {"type":"text-delta","text":"..."}\n\n'
   *   - Same format as HTTP SSE, but delivered via WebSocket
   *
   * This method:
   *   1. Parses SSE format (strips "data: " prefix)
   *   2. Extracts JSON payload
   *   3. Converts to UIMessageChunk (AI SDK v6 format)
   *   4. Enqueues to stream for useChat consumption
   *
   * Architecture: SSE format over WebSocket
   *   - Backend: ADK events → SSE format (stream_protocol.py)
   *   - Transport: SSE format over WebSocket (this layer)
   *   - Frontend: SSE format → UIMessageChunk (this method)
   */
  private handleWebSocketMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>
  ): void {
    try {
      // Backend sends SSE-formatted events (data: {...}\n\n)
      // Parse and convert to UIMessageChunk
      if (data.startsWith("data: ")) {
        const jsonStr = data.substring(6); // Remove "data: " prefix

        if (jsonStr === "[DONE]") {
          controller.close();
          this.ws?.close();
          return;
        }

        // Parse JSON and convert to UIMessageChunk
        // This is already in AI SDK v6 Data Stream Protocol format
        // Examples: {"type":"text-delta","text":"..."}
        //          {"type":"tool-input-available","toolCallId":"...","toolName":"..."}
        const chunk = JSON.parse(jsonStr);

        // Debug: Log chunk before enqueuing to useChat
        console.debug("[WS→useChat]", chunk);

        // Enqueue UIMessageChunk to stream
        // useChat hook will consume this and update UI
        controller.enqueue(chunk as UIMessageChunk);

        // Handle tool calls if callback is provided
        if (
          chunk.type === "tool-input-available" &&
          this.config.toolCallCallback
        ) {
          this.handleToolCall(chunk);
        }
      } else {
        console.warn("[WS Transport] Unexpected message format:", data);
      }
    } catch (error) {
      console.error("[WS Transport] Error handling message:", error);
      controller.error(error);
    }
  }

  /**
   * Handle tool call execution (if callback is provided)
   */
  private async handleToolCall(chunk: any): Promise<void> {
    if (!this.config.toolCallCallback) return;

    try {
      const toolCall = {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        args: chunk.args,
      };

      const result = await this.config.toolCallCallback(toolCall);

      // Send tool result back to backend
      const toolResult = {
        type: "tool-result",
        toolCallId: chunk.toolCallId,
        result,
      };

      this.ws?.send(JSON.stringify(toolResult));
    } catch (error) {
      console.error("[WS Transport] Tool call error:", error);
    }
  }

  /**
   * Reconnect to stream (not supported for WebSocket)
   * WebSocket connections are stateful, reconnection requires new connection.
   */
  reconnectToStream(): null {
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
