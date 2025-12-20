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

import type { UIMessage } from "@ai-sdk/ui-utils";

/**
 * WebSocket event types for BIDI protocol
 */
export type MessageEvent = {
  type: "message";
  version: "1.0";
  data: {
    messages: UIMessage[];
  };
};

export type ToolResultEvent = {
  type: "tool_result";
  version: "1.0";
  data: {
    toolCallId: string;
    result: Record<string, unknown>;
  };
};

export type AudioControlEvent = {
  type: "audio_control";
  version: "1.0";
  action: "start" | "stop";
};

export type AudioChunkEvent = {
  type: "audio_chunk";
  version: "1.0";
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
   * Send message event with function_response content (for confirmation tools)
   *
   * This is used for adk_request_confirmation flow where the user approves/denies
   * a tool execution. The backend processes this as a FunctionResponse.
   *
   * Protocol: AI SDK v6 message with tool-result content
   *
   * @param toolCallId - The ORIGINAL tool's function_call.id (NOT confirmation tool ID)
   * @param toolName - The ORIGINAL tool's name (e.g., "process_payment")
   * @param response - Confirmation result (e.g., { approved: true })
   */
  public sendFunctionResponse(
    toolCallId: string,
    toolName: string,
    response: Record<string, unknown>,
  ): void {
    const message: MessageEvent = {
      type: "message",
      version: "1.0",
      data: {
        messages: [
          {
            id: `fr-${Date.now()}`,
            role: "user",
            content: [
              {
                type: "tool-result" as const,
                toolCallId,
                toolName,
                result: response,
              },
            ],
          } as any, // Type assertion for internal protocol structure
        ],
      },
    };

    console.log(
      `[Event Sender] Sending function_response for ${toolName} (tool_call_id=${toolCallId})`,
    );

    this.sendEvent(message);
  }

  /**
   * Send message event with user messages
   *
   * This is the standard way to send user text/images/tool-results to the backend.
   * Used by AI SDK v6's useChat hook via transport.sendMessages().
   *
   * @param messages - Array of UIMessage from AI SDK v6
   */
  public sendMessages(messages: UIMessage[]): void {
    const event: MessageEvent = {
      type: "message",
      version: "1.0",
      data: {
        messages,
      },
    };

    console.log(
      `[Event Sender] Sending ${messages.length} message(s)`,
      messages[messages.length - 1],
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
