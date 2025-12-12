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

import type { UIMessageChunk, ChatTransport, ChatRequestOptions, UIMessage } from "ai";

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
  };
  isReady: boolean;
  error: string | null;
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
  private audioChunkIndex = 0; // Track audio chunks for logging
  private pingInterval: NodeJS.Timeout | null = null; // Ping interval timer
  private lastPingTime: number | null = null; // Timestamp of last ping

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
   * Start ping/pong for latency monitoring
   */
  private startPing() {
    this.stopPing(); // Clear any existing interval

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.ws.send(
          JSON.stringify({
            type: "ping",
            timestamp: this.lastPingTime,
          })
        );
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
      trigger: 'submit-message' | 'regenerate-message';
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions
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
            this.ws.onmessage = (event) => {
              this.handleWebSocketMessage(event.data, controller);
            };

            this.ws.onerror = (error) => {
              console.error("[WS Transport] Error:", error);
              this.stopPing(); // Stop ping on error
              controller.error(new Error("WebSocket error"));
            };

            this.ws.onclose = () => {
              console.log("[WS Transport] Connection closed");
              this.stopPing(); // Stop ping on close
              controller.close();
            };
          }

          // Send messages to backend
          const messageData = JSON.stringify({ messages: options.messages });
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
          console.log("[WS Transport] Turn complete, closing stream (WebSocket stays open)");

          // Reset AudioContext for next turn (BIDI mode)
          if (this.config.audioContext) {
            this.config.audioContext.voiceChannel.reset();
          }

          controller.close();

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
        console.debug("[WS→useChat]", chunk);

        // Custom event handling (skip standard enqueue)
        // Returns true if standard enqueue should be skipped
        if (this.handleCustomEventWithSkip(chunk, controller)) {
          return;
        }

        // Special handling for finish event with audio: inject recorded audio BEFORE finish
        if (chunk.type === "finish" && chunk.messageMetadata?.audio && this.pcmBuffer.length > 0) {
          try {
            console.log("[Audio Recording] Converting PCM to WAV...");
            const wavDataUri = this.convertPcmToWav();
            const wavSizeKB = (wavDataUri.length * 0.75 / 1024).toFixed(2);
            console.log(`[Audio Recording] WAV created: ${wavSizeKB} KB`);

            // Enqueue audio file chunk BEFORE finish event
            const audioChunk: UIMessageChunk = {
              type: "file",
              mediaType: "audio/wav",
              url: wavDataUri,
            };
            controller.enqueue(audioChunk);
          } catch (err) {
            console.error("[Audio Recording] Failed to convert PCM to WAV:", err);
          }
        }

        // Standard enqueue: Forward to AI SDK useChat hook
        // All standard AI SDK v6 events are handled here:
        //   - text-start, text-delta, text-end
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
    const totalSamples = this.pcmBuffer.reduce((sum, chunk) => sum + chunk.length, 0);

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
    let binary = '';
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
    chunk: any,
    _controller: ReadableStreamDefaultController<UIMessageChunk>
  ): boolean {
    // SPECIAL HANDLING: PCM audio chunks (ADK BIDI mode)
    // Following official ADK implementation pattern:
    // https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/static/js/app.js
    //
    // Dual-path audio architecture:
    // - Pipeline 1: Real-time playback via AudioWorklet (low-latency)
    // - Pipeline 2: Recording for message replay (this buffer)
    if (chunk.type === "data-pcm" && this.config.audioContext) {
      // Log audio stream start on first chunk
      if (this.audioChunkIndex === 0) {
        console.log("[Audio Stream] Audio streaming started (BIDI mode)");
        console.log(`[Audio Stream] Sample rate: ${chunk.data.sampleRate}Hz, Channels: ${chunk.data.channels}, Bit depth: ${chunk.data.bitDepth}`);

        // Store audio format for WAV conversion
        this.pcmSampleRate = chunk.data.sampleRate;
        this.pcmChannels = chunk.data.channels;
        this.pcmBitDepth = chunk.data.bitDepth;
      }

      // Low-latency audio path: directly to AudioWorklet (Pipeline 1)
      try {
        this.config.audioContext.voiceChannel.sendChunk({
          content: chunk.data.content,
          sampleRate: chunk.data.sampleRate,
          channels: chunk.data.channels,
          bitDepth: chunk.data.bitDepth,
        });

        // Recording path: buffer PCM for WAV conversion (Pipeline 2)
        // Decode base64 PCM data
        const binaryString = atob(chunk.data.content);
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
          console.log(`[Audio Stream] Streaming... (${this.audioChunkIndex} chunks received)`);
        }
      } catch (err) {
        console.error("[Audio Stream] Error processing PCM chunk:", err);
      }

      return true; // Skip standard enqueue for PCM chunks
    }

    // Add more custom events here that should skip standard enqueue
    // Example:
    // if (chunk.type === "data-custom-event") {
    //   // Handle custom event
    //   return true; // Skip standard enqueue
    // }

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
  private handleCustomEventWithoutSkip(chunk: any): void {
    // Tool call event: Execute callback
    if (chunk.type === "tool-input-available") {
      if (this.config.toolCallCallback) {
        this.handleToolCall(chunk);
      }
    }

    // Finish event: Log completion metrics (usage, audio, grounding, citations, cache, model version)
    if (chunk.type === "finish" && chunk.messageMetadata) {
      const metadata = chunk.messageMetadata;

      // Log audio stream completion with statistics
      if (metadata.audio) {
        console.log("[Audio Stream] Audio streaming completed");
        console.log(`[Audio Stream] Total chunks: ${metadata.audio.chunks}`);
        console.log(`[Audio Stream] Total bytes: ${metadata.audio.bytes}`);
        console.log(`[Audio Stream] Sample rate: ${metadata.audio.sampleRate}Hz`);
        console.log(`[Audio Stream] Duration: ${metadata.audio.duration.toFixed(2)}s`);

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
        console.log(`[Grounding] ${metadata.grounding.sources.length} sources:`, metadata.grounding.sources);
      }

      // Log citations
      if (metadata.citations) {
        console.log(`[Citations] ${metadata.citations.length} citations:`, metadata.citations);
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
  async reconnectToStream(_options: { chatId: string } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
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
