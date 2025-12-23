/**
 * BIDI Event Sender
 *
 * Handles outgoing WebSocket messages to backend (Frontend → Backend).
 *
 * Responsibilities:
 * - Send tool_result events (frontend delegate tools)
 * - Send message events with tool-result content (confirmation tools)
 * - Send message events with user messages
 * - Send audio control and chunk events
 * - Provide type-safe event construction
 */

import type { UIMessage } from "ai";

/**
 * WebSocket event types for BIDI protocol
 */
export type MessageEvent = {
  type: "message";
  version: "1.0";
  timestamp?: number;                        // Optional client timestamp (milliseconds since epoch)
  data: {
    id: string;                              // chatId (same as SSE)
    messages: UIMessage[];                   // messages array (same as SSE)
    trigger: "submit-message" | "regenerate-message"; // trigger (same as SSE)
    messageId: string | undefined;           // messageId (same as SSE)
  };
};

export type ToolResultEvent = {
  type: "tool_result";
  version: "1.0";
  timestamp?: number;                        // Optional client timestamp (milliseconds since epoch)
  data: {
    toolCallId: string;
    result: Record<string, unknown>;
  };
};

export type AudioControlEvent = {
  type: "audio_control";
  version: "1.0";
  timestamp?: number;                        // Optional client timestamp (milliseconds since epoch)
  action: "start" | "stop";
};

export type AudioChunkEvent = {
  type: "audio_chunk";
  version: "1.0";
  timestamp?: number;                        // Optional client timestamp (milliseconds since epoch)
  data: {
    chunk: string; // base64-encoded PCM data
    sampleRate?: number;
    channels?: number;
    bitDepth?: number;
  };
};

export type InterruptEvent = {
  type: "interrupt";
  version: "1.0";
  timestamp?: number;                        // Optional client timestamp (milliseconds since epoch)
  reason?: string;
};

export type PingEvent = {
  type: "ping";
  version: "1.0";
  timestamp: number;
};

export type BidiEvent =
  | MessageEvent
  | ToolResultEvent
  | AudioControlEvent
  | AudioChunkEvent
  | InterruptEvent
  | PingEvent;

/**
 * EventSender handles outgoing WebSocket messages.
 *
 * Usage:
 * ```typescript
 * const sender = new EventSender(websocket);
 *
 * // Send tool result (frontend delegate tools)
 * sender.sendToolResult("function-call-123", { success: true });
 *
 * // Send function response (confirmation tools)
 * sender.sendFunctionResponse("function-call-456", "process_payment", { approved: true });
 *
 * // Send user messages
 * sender.sendMessages([...messages]);
 * ```
 */
export class EventSender {
  constructor(private ws: WebSocket | null) {}

  /**
   * Update WebSocket instance
   */
  public setWebSocket(ws: WebSocket | null): void {
    this.ws = ws;
  }

  /**
   * Send raw event to WebSocket
   */
  public sendEvent(event: BidiEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(
        "[Event Sender] WebSocket not connected, event not sent:",
        event,
      );
      return;
    }

    const eventStr = JSON.stringify(event);
    this.ws.send(eventStr);
  }

  /**
   * Send tool_result event (for frontend delegate tools like change_bgm, get_location)
   *
   * This is used for tools that execute on the frontend and send results back.
   * Backend's FrontendToolDelegate.execute_on_frontend() awaits these results.
   *
   * @param toolCallId - The function_call.id from ADK
   * @param result - Tool execution result
   */
  public sendToolResult(
    toolCallId: string,
    result: Record<string, unknown>,
  ): void {
    const event: ToolResultEvent = {
      type: "tool_result",
      version: "1.0",
      timestamp: Date.now(),
      data: {
        toolCallId,
        result,
      },
    };

    console.log(
      `[Event Sender] Sending tool_result for toolCallId=${toolCallId}`,
      result,
    );

    this.sendEvent(event);
  }

  /**
   * Send message event with user messages
   *
   * This is the standard way to send user text/images/tool-results to the backend.
   * Used by AI SDK v6's useChat hook via transport.sendMessages().
   *
   * Matches AI SDK v6 HttpChatTransport behavior:
   * - Sends same payload format as SSE mode
   * - Includes chatId, messages, trigger, messageId
   * - Confirmation approvals remain in assistant message parts
   * - Backend receives identical format to SSE mode
   *
   * @param options - Message sending options (same as SSE)
   */
  public sendMessages(options: {
    chatId: string;
    messages: UIMessage[];
    trigger: "submit-message" | "regenerate-message";
    messageId: string | undefined;
  }): void {
    // Standard message event (matches AI SDK v6 HttpChatTransport format exactly)
    // TODO: RPCみたいにtype, version, dataでラップするのは正しいのか？
    const event: MessageEvent = {
      type: "message",
      version: "1.0",
      timestamp: Date.now(),
      data: {
        id: options.chatId,
        messages: options.messages,
        trigger: options.trigger,
        messageId: options.messageId,
      },
    };

    console.log(
      `[Event Sender] Sending ${options.messages.length} message(s) (chatId=${options.chatId}, trigger=${options.trigger})`,
      options.messages[options.messages.length - 1],
    );

    this.sendEvent(event);
  }

  /**
   * Start audio input (CMD key pressed, start recording microphone)
   */
  public startAudio(): void {
    const event: AudioControlEvent = {
      type: "audio_control",
      version: "1.0",
      timestamp: Date.now(),
      action: "start",
    };

    this.sendEvent(event);
  }

  /**
   * Stop audio input (CMD key released, stop recording microphone)
   */
  public stopAudio(): void {
    const event: AudioControlEvent = {
      type: "audio_control",
      version: "1.0",
      timestamp: Date.now(),
      action: "stop",
    };

    this.sendEvent(event);
  }

  /**
   * Send audio chunk to backend (streaming microphone input)
   *
   * @param chunk - Audio chunk data
   */
  public sendAudioChunk(chunk: {
    content: string; // base64-encoded PCM data
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }): void {
    const event: AudioChunkEvent = {
      type: "audio_chunk",
      version: "1.0",
      timestamp: Date.now(),
      data: {
        chunk: chunk.content,
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
        bitDepth: chunk.bitDepth,
      },
    };

    this.sendEvent(event);
  }

  /**
   * Send interrupt signal (user cancellation)
   *
   * @param reason - Optional reason for interruption
   */
  public interrupt(reason?: string): void {
    const event: InterruptEvent = {
      type: "interrupt",
      version: "1.0",
      timestamp: Date.now(),
      reason,
    };

    console.log(
      `[Event Sender] Sending interrupt (reason: ${reason || "user_abort"})`,
    );

    this.sendEvent(event);
  }

  /**
   * Send ping for latency monitoring
   *
   * @param timestamp - Timestamp in milliseconds
   */
  public ping(timestamp: number): void {
    const event: PingEvent = {
      type: "ping",
      version: "1.0",
      timestamp,
    };

    this.sendEvent(event);
  }
}
