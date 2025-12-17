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
import { chunkLogger } from "./chunk-logger";

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
 * Base event structure for all client-to-server events
 */
interface ClientEvent {
  type: string;
  version: "1.0";
  timestamp?: number;
}

/**
 * Message event: Send chat messages to backend
 * Used by existing sendMessages() flow
 */
interface MessageEvent extends ClientEvent {
  type: "message";
  data: {
    messages: UIMessage[];
  };
}

/**
 * Interrupt event: User cancels ongoing AI response
 * Use cases:
 *   - ESC key pressed during response generation
 *   - User clicks cancel button
 *   - Timeout or error conditions
 */
interface InterruptEvent extends ClientEvent {
  type: "interrupt";
  reason?: "user_abort" | "timeout" | "error";
}

/**
 * Audio control event: Start/stop audio input (BIDI mode)
 * Use cases:
 *   - CMD key pressed: start audio input
 *   - CMD key released: stop audio input
 *   - Push-to-talk UI controls
 */
interface AudioControlEvent extends ClientEvent {
  type: "audio_control";
  action: "start" | "stop";
}

/**
 * Audio chunk event: Send PCM audio data to backend
 * Used for streaming microphone input in BIDI mode
 */
interface AudioChunkEvent extends ClientEvent {
  type: "audio_chunk";
  data: {
    chunk: string; // Base64-encoded PCM data
    sampleRate: number;
    channels: number;
    bitDepth: number;
  };
}

// ToolResultEvent removed - use AI SDK v6's standard addToolApprovalResponse flow
// See experiments/2025-12-13_lib_test_coverage_investigation.md:1640-1679 for details

/**
 * Ping event: Keep-alive and latency measurement
 * Backend responds with pong event
 */
interface PingEvent extends ClientEvent {
  type: "ping";
}

/**
 * Tool result event (BIDI delegate pattern)
 * Frontend sends tool execution results back to backend to resolve delegate Futures
 */
interface ToolResultEvent extends ClientEvent {
  type: "tool_result";
  data: {
    toolCallId: string;
    result: Record<string, unknown>;
  };
}

/**
 * Union type for all client-to-server events
 */
type ClientToServerEvent =
  | MessageEvent
  | InterruptEvent
  | AudioControlEvent
  | AudioChunkEvent
  | PingEvent
  | ToolResultEvent;

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
  // Message size thresholds for logging only (no truncation)
  // Adjusted to be less aggressive - only warn for truly large messages
  private static readonly WARN_SIZE_KB = 500; // Warn if message > 500KB (was 100KB)
  private static readonly ERROR_SIZE_MB = 10; // Error log if message > 10MB (was 5MB)

  private config: WebSocketChatTransportConfig;
  private ws: WebSocket | null = null;
  private audioChunkIndex = 0; // Track audio chunks for logging
  private pingInterval: NodeJS.Timeout | null = null; // Ping interval timer
  private lastPingTime: number | null = null; // Timestamp of last ping

  // Controller lifecycle management (P4-T10)
  // Tracks current ReadableStream controller to prevent orphaning on handler override
  private currentController: ReadableStreamDefaultController<UIMessageChunk> | null =
    null;

  // PCM recording buffer for message replay (Pipeline 2)
  private pcmBuffer: Int16Array[] = []; // Buffer PCM chunks for WAV conversion
  private pcmSampleRate = 24000; // Default sample rate (updated from first chunk)
  private pcmChannels = 1; // Default channels (updated from first chunk)
  private pcmBitDepth = 16; // Default bit depth (updated from first chunk)

  constructor(config: WebSocketChatTransportConfig) {
    this.config = {
      timeout: 30000, // 30 seconds default
      ...config,
    };
  }

  /**
   * Send structured event to backend (P2-T2)
   * All client events use this method for type-safe sending
   */
  private sendEvent(event: ClientToServerEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WS Transport] Cannot send event, WebSocket not open");
      return;
    }

    // Add timestamp if not present
    const eventWithTimestamp = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };

    const message = JSON.stringify(eventWithTimestamp);

    // Check message size and warn if large
    const sizeBytes = new Blob([message]).size;
    const sizeKB = sizeBytes / 1024;
    const sizeMB = sizeKB / 1024;

    if (sizeKB > WebSocketChatTransport.WARN_SIZE_KB) {
      if (sizeMB > WebSocketChatTransport.ERROR_SIZE_MB) {
        // Message exceeds warning threshold but we still send it
        console.warn(
          `[WS Transport] ⚠️ Very large message: ${sizeMB.toFixed(2)}MB (threshold: ${WebSocketChatTransport.ERROR_SIZE_MB}MB)`,
          {
            type: eventWithTimestamp.type,
            sizeBytes,
            sizeKB: sizeKB.toFixed(2),
            sizeMB: sizeMB.toFixed(2),
            thresholdMB: WebSocketChatTransport.ERROR_SIZE_MB,
          },
        );
        // Message is sent anyway to preserve ADK BIDI functionality
      } else if (sizeMB > 1) {
        console.warn(`[WS Transport] ⚠️ Large message: ${sizeMB.toFixed(2)}MB`, {
          type: eventWithTimestamp.type,
          sizeBytes,
          sizeKB: sizeKB.toFixed(2),
          sizeMB: sizeMB.toFixed(2),
        });

        // Log details for message events
        if (eventWithTimestamp.type === "message") {
          const messageEvent = event as MessageEvent;
          const firstMsg = messageEvent.data.messages[0];
          const lastMsg =
            messageEvent.data.messages[messageEvent.data.messages.length - 1];
          console.warn(`[WS Transport] Message details:`, {
            messageCount: messageEvent.data.messages.length,
            firstMessage: firstMsg
              ? `${firstMsg.role}: ${JSON.stringify(firstMsg).substring(0, 100)}...`
              : undefined,
            lastMessage: lastMsg
              ? `${lastMsg.role}: ${JSON.stringify(lastMsg).substring(0, 100)}...`
              : undefined,
          });
        }
      } else {
        console.debug(`[WS Transport] Message size: ${sizeKB.toFixed(2)}KB`, {
          type: eventWithTimestamp.type,
        });
      }
    }

    this.ws.send(message);

    // Chunk Logger: Record WebSocket chunk (output)
    chunkLogger.logChunk({
      location: "frontend-ws-chunk",
      direction: "out",
      chunk: message,
      mode: "adk-bidi",
    });
  }

  /**
   * PUBLIC API: Interrupt ongoing AI response
   * Use cases:
   *   - ESC key pressed during response
   *   - User clicks cancel button
   *   - Timeout or error conditions
   */
  public interrupt(reason?: "user_abort" | "timeout" | "error"): void {
    const event: InterruptEvent = {
      type: "interrupt",
      version: "1.0",
      reason,
    };
    this.sendEvent(event);
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
    const event: ToolResultEvent = {
      type: "tool_result",
      version: "1.0",
      data: {
        toolCallId,
        result,
      },
    };
    this.sendEvent(event);
  }

  /**
   * PUBLIC API: Start audio input (BIDI mode)
   * Use case: CMD key pressed, start recording microphone
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
   * PUBLIC API: Stop audio input (BIDI mode)
   * Use case: CMD key released, stop recording microphone
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
   * PUBLIC API: Send audio chunk to backend (BIDI mode)
   * Used for streaming microphone input
   */
  public sendAudioChunk(chunk: {
    content: string;
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
        const event: PingEvent = {
          type: "ping",
          version: "1.0",
          timestamp: this.lastPingTime,
        };
        this.sendEvent(event);
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
          const event: MessageEvent = {
            type: "message",
            version: "1.0",
            data: {
              messages: options.messages,
            },
          };
          this.sendEvent(event);
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
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    try {
      // Chunk Logger: Record WebSocket chunk (input)
      chunkLogger.logChunk({
        location: "frontend-ws-chunk",
        direction: "in",
        chunk: data,
        mode: "adk-bidi",
      });

      // Handle ping/pong for latency monitoring (not SSE format)
      if (!data.startsWith("data: ")) {
        try {
          const message = JSON.parse(data);
          if (message.type === "pong" && message.timestamp) {
            this.handlePong(message.timestamp);
            return;
          }
        } catch {
          // Not JSON, ignore
        }
      }

      // Backend sends SSE-formatted events (data: {...}\n\n)
      // Parse and convert to UIMessageChunk
      if (data.startsWith("data: ")) {
        const jsonStr = data.substring(6).trim(); // Remove "data: " prefix and trim whitespace

        if (jsonStr === "[DONE]") {
          // Reset AudioContext for next turn (BIDI mode)
          if (this.config.audioContext) {
            this.config.audioContext.voiceChannel.reset();
          }

          controller.close();

          // Clear controller reference (P4-T10)
          this.currentController = null;

          // Reset audio state for next turn
          this.audioChunkIndex = 0;
          this.pcmBuffer = []; // Clear PCM recording buffer

          // IMPORTANT: Don't close WebSocket in BIDI mode!
          // WebSocket stays open for next turn
          // this.ws?.close(); // <- Removed: Keep WebSocket alive
          return;
        }

        // Parse JSON and convert to UIMessageChunk
        // This is already in AI SDK v6 Data Stream Protocol format
        // Examples: {"type":"text-delta","text":"..."}
        //          {"type":"tool-input-available","toolCallId":"...","toolName":"..."}
        const chunk = JSON.parse(jsonStr);

        // Debug: Log chunk before processing
        // console.debug("[WS→useChat]", chunk);

        // Special logging for tool-approval-request events
        if (chunk.type === "tool-approval-request") {
          console.log(
            `[WS Transport] Received tool-approval-request: approvalId=${chunk.approvalId}, toolCallId=${chunk.toolCallId}`,
          );
        }

        // Custom event handling (skip standard enqueue)
        // Returns true if standard enqueue should be skipped
        if (this.handleCustomEventWithSkip(chunk, controller)) {
          return;
        }

        // Special handling for finish event with audio: inject recorded audio BEFORE finish
        if (
          chunk.type === "finish" &&
          chunk.messageMetadata?.audio &&
          this.pcmBuffer.length > 0
        ) {
          try {
            console.log("[Audio Recording] Converting PCM to WAV...");
            const wavDataUri = this.convertPcmToWav();
            const wavSizeKB = ((wavDataUri.length * 0.75) / 1024).toFixed(2);
            console.log(`[Audio Recording] WAV created: ${wavSizeKB} KB`);

            // Enqueue audio file chunk BEFORE finish event
            const audioChunk: UIMessageChunk = {
              type: "file",
              mediaType: "audio/wav",
              url: wavDataUri,
            };
            controller.enqueue(audioChunk);
          } catch (err) {
            console.error(
              "[Audio Recording] Failed to convert PCM to WAV:",
              err,
            );
          }
        }

        // Standard enqueue: Forward to AI SDK useChat hook
        // All standard AI SDK v6 events are handled here:
        //   - text-start, text-delta, text-end
        //     * [P3-T1] Includes Live API Transcriptions (input/output audio → text)
        //     * Input: User speaks → ADK input_transcription → text events
        //     * Output: AI speaks → Native-audio model output_transcription → text events
        //   - tool-input-start, tool-input-available, tool-output-available, tool-output-error
        //   - finish (with messageMetadata: usage, audio, grounding, citations, cache, modelVersion)
        //   - file (images, documents)
        //   - message-metadata (standalone metadata updates)
        //   - error, abort, start
        controller.enqueue(chunk as UIMessageChunk);

        // Custom event handling (after standard enqueue)
        // These events are enqueued to useChat AND have additional side effects
        this.handleCustomEventWithoutSkip(chunk);
      } else {
        console.warn("[WS Transport] Unexpected message format:", data);
      }
    } catch (error) {
      console.error("[WS Transport] Error handling message:", error);
      controller.error(error);
      // Clear controller reference on error (P4-T10)
      this.currentController = null;
    }
  }

  /**
   * Convert buffered PCM data to WAV format
   * Returns base64-encoded data URI for HTML5 audio element
   */
  private convertPcmToWav(): string {
    if (this.pcmBuffer.length === 0) {
      throw new Error("No PCM data to convert");
    }

    // Calculate total samples
    const totalSamples = this.pcmBuffer.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );

    // Merge all PCM chunks into single array
    const pcmData = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of this.pcmBuffer) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }

    // WAV file format specification:
    // http://soundfile.sapp.org/doc/WaveFormat/
    const numChannels = this.pcmChannels;
    const sampleRate = this.pcmSampleRate;
    const bytesPerSample = this.pcmBitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length * bytesPerSample;
    const fileSize = 36 + dataSize;

    // Create WAV file buffer
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);

    // Write WAV header
    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, fileSize, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // fmt chunk size (16 for PCM)
    view.setUint16(20, 1, true); // Audio format (1 = PCM)
    view.setUint16(22, numChannels, true); // Number of channels
    view.setUint32(24, sampleRate, true); // Sample rate
    view.setUint32(28, byteRate, true); // Byte rate
    view.setUint16(32, blockAlign, true); // Block align
    view.setUint16(34, this.pcmBitDepth, true); // Bits per sample

    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true); // Data size

    // Write PCM data (little-endian)
    const dataView = new Int16Array(wavBuffer, 44);
    dataView.set(pcmData);

    // Convert to base64 data URI
    const bytes = new Uint8Array(wavBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUri = `data:audio/wav;base64,${base64}`;

    return dataUri;
  }

  /**
   * Handle custom events that SKIP standard enqueue.
   *
   * These events require special processing and should NOT be forwarded to useChat:
   *   - data-pcm: PCM audio chunks sent directly to AudioWorklet for low-latency playback
   *   - Future custom events that bypass useChat
   *
   * @returns true if standard enqueue should be skipped, false otherwise
   */
  private handleCustomEventWithSkip(
    chunk: unknown,
    _controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): boolean {
    // Type guard for custom event chunks
    if (
      typeof chunk !== "object" ||
      chunk === null ||
      !("type" in chunk) ||
      typeof chunk.type !== "string"
    ) {
      return false;
    }

    // SPECIAL HANDLING: PCM audio chunks (ADK BIDI mode)
    // Following official ADK implementation pattern:
    // https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/static/js/app.js
    //
    // Dual-path audio architecture:
    // - Pipeline 1: Real-time playback via AudioWorklet (low-latency)
    // - Pipeline 2: Recording for message replay (this buffer)
    if (
      chunk.type === "data-pcm" &&
      this.config.audioContext &&
      "data" in chunk &&
      typeof chunk.data === "object" &&
      chunk.data !== null
    ) {
      // biome-ignore lint/suspicious/noExplicitAny: PCM data structure is dynamic from backend
      const pcmData = chunk.data as any;

      // Log audio stream start on first chunk
      if (this.audioChunkIndex === 0) {
        // Commented out to reduce log noise during recording
        // console.log("[Audio Stream] Audio streaming started (BIDI mode)");
        // console.log(
        //   `[Audio Stream] Sample rate: ${pcmData.sampleRate}Hz, Channels: ${pcmData.channels}, Bit depth: ${pcmData.bitDepth}`,
        // );

        // Store audio format for WAV conversion
        this.pcmSampleRate = pcmData.sampleRate;
        this.pcmChannels = pcmData.channels;
        this.pcmBitDepth = pcmData.bitDepth;
      }

      // Low-latency audio path: directly to AudioWorklet (Pipeline 1)
      try {
        this.config.audioContext.voiceChannel.sendChunk({
          content: pcmData.content,
          sampleRate: pcmData.sampleRate,
          channels: pcmData.channels,
          bitDepth: pcmData.bitDepth,
        });

        // Recording path: buffer PCM for WAV conversion (Pipeline 2)
        // Decode base64 PCM data
        const binaryString = atob(pcmData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Convert to Int16Array and buffer
        const int16Array = new Int16Array(bytes.buffer);
        this.pcmBuffer.push(int16Array);

        this.audioChunkIndex++;

        // Periodic logging for long streams
        if (this.audioChunkIndex % 50 === 0) {
          console.log(
            `[Audio Stream] Streaming... (${this.audioChunkIndex} chunks received)`,
          );
        }
      } catch (err) {
        console.error("[Audio Stream] Error processing PCM chunk:", err);
      }

      return true; // Skip standard enqueue for PCM chunks
    }

    return false; // No skip, proceed with standard enqueue
  }

  /**
   * Handle custom events that DO NOT skip standard enqueue.
   *
   * These events are forwarded to useChat AND have additional side effects:
   *   - tool-input-available: Log tool call details, execute callback if provided
   *   - tool-output-available: Log tool output details
   *   - finish: Log audio stream completion, usage statistics
   *   - Future custom events that need logging, telemetry, or side effects
   *
   * Standard enqueue happens BEFORE this method is called.
   */
  private handleCustomEventWithoutSkip(chunk: unknown): void {
    // Type guard for custom event chunks
    if (
      typeof chunk !== "object" ||
      chunk === null ||
      !("type" in chunk) ||
      typeof chunk.type !== "string"
    ) {
      return;
    }

    // Finish event: Log completion metrics (usage, audio, grounding, citations, cache, model version)
    if (
      chunk.type === "finish" &&
      "messageMetadata" in chunk &&
      typeof chunk.messageMetadata === "object" &&
      chunk.messageMetadata !== null
    ) {
      // biome-ignore lint/suspicious/noExplicitAny: Message metadata structure is dynamic from backend
      const metadata = chunk.messageMetadata as any;

      // Log audio stream completion with statistics
      if (metadata.audio) {
        // Commented out to reduce log noise during recording
        // console.log("[Audio Stream] Audio streaming completed");
        // console.log(`[Audio Stream] Total chunks: ${metadata.audio.chunks}`);
        // console.log(`[Audio Stream] Total bytes: ${metadata.audio.bytes}`);
        // console.log(
        //   `[Audio Stream] Sample rate: ${metadata.audio.sampleRate}Hz`,
        // );
        // console.log(
        //   `[Audio Stream] Duration: ${metadata.audio.duration.toFixed(2)}s`,
        // );

        // Notify AudioContext of audio completion
        if (this.config.audioContext?.voiceChannel?.onComplete) {
          this.config.audioContext.voiceChannel.onComplete(metadata.audio);
        }
      }

      // Log usage statistics
      if (metadata.usage) {
        console.log("[Usage] Token usage:", metadata.usage);
      }

      // Log grounding sources (RAG, web search)
      if (metadata.grounding?.sources) {
        console.log(
          `[Grounding] ${metadata.grounding.sources.length} sources:`,
          metadata.grounding.sources,
        );
      }

      // Log citations
      if (metadata.citations) {
        console.log(
          `[Citations] ${metadata.citations.length} citations:`,
          metadata.citations,
        );
      }

      // Log cache statistics
      if (metadata.cache) {
        console.log("[Cache] Cache statistics:", metadata.cache);
      }

      // Log model version
      if (metadata.modelVersion) {
        console.log("[Model] Model version:", metadata.modelVersion);
      }
    }
  }

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
