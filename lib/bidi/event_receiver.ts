/**
 * BIDI Event Receiver
 *
 * Handles incoming WebSocket messages from backend (ADK events in SSE format)
 * and converts them to UIMessageChunkFromAISDKv6 for AI SDK v6 useChat hook.
 *
 * Responsibilities:
 * - Parse SSE-formatted WebSocket messages
 * - Convert to UIMessageChunkFromAISDKv6 format
 * - Handle custom events (PCM audio, tool invocations)
 * - Manage stream lifecycle ([DONE] markers)
 * - Integrate with AudioContext for voice playback
 */

import type { UIMessageChunkFromAISDKv6 } from "../utils";

/**
 * Audio context interface for voice playback and recording
 */
export interface AudioContext {
  voiceChannel: {
    reset(): void;
    playPCM(pcmData: Int16Array): void;
  };
}

/**
 * PCM audio format parameters
 */
interface PCMFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

/**
 * PCM audio chunk structure from ADK BIDI protocol
 */
interface PCMAudioChunk {
  type: "data-pcm";
  data: {
    content: string; // base64-encoded PCM data
    sampleRate?: number; // default: 24000 (ADK BIDI default)
    channels?: number; // default: 1 (mono)
    bitDepth?: number; // default: 16
  };
}

/**
 * Configuration for EventReceiver
 */
export interface EventReceiverConfig {
  /**
   * Optional audio context for voice playback
   */
  audioContext?: AudioContext;

  /**
   * Callback for handling pong messages (latency monitoring)
   */
  onPong?: (timestamp: number) => void;
}

/**
 * EventReceiver handles incoming WebSocket messages and converts them to UIMessageChunkFromAISDKv6.
 *
 * Usage:
 * ```typescript
 * const receiver = new EventReceiver({
 *   audioContext,
 *   onPong: (ts) => handlePong(ts),
 * });
 *
 * // In WebSocket onmessage handler:
 * receiver.handleMessage(event.data, controller);
 * ```
 */
export class EventReceiver {
  private doneReceived = false;
  private waitingForFinishStepAfterApproval = false; // Flag for BIDI BLOCKING pattern (ADR 0011)
  private audioChunkIndex = 0;
  private pcmBuffer: Int16Array[] = [];
  private pcmFormat: PCMFormat | null = null;

  constructor(private config: EventReceiverConfig) {}

  /**
   * Handle incoming WebSocket message
   *
   * @param data Raw WebSocket message data (string)
   * @param controller Stream controller for enqueuing chunks
   */
  public handleMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): void {
    try {
      // Store controller reference for [DONE] handling
      // this.currentController = controller;

      // Handle ping/pong for latency monitoring (not SSE format)
      if (!data.startsWith("data: ")) {
        console.warn("[Event Receiver] Non-SSE message received");
        this.handleNonSSEMessage(data);
        return;
      }

      // Backend sends SSE-formatted events (data: {...}\n\n)
      this.handleSSEMessage(data, controller);
    } catch (error) {
      console.error("[Event Receiver] Error handling message:", error);
      controller.error(error);
      // this.currentController = null;
    }
  }

  /**
   * Reset state for new conversation turn
   */
  public reset(): void {
    this.doneReceived = false;
    this.waitingForFinishStepAfterApproval = false;
    this.audioChunkIndex = 0;
    this.pcmBuffer = [];
    // this.currentController = null;
  }

  /**
   * Check if [DONE] was received in current stream
   * Used by transport to determine if controller should be reused (Phase 12 BLOCKING)
   */
  public isDoneReceived(): boolean {
    return this.doneReceived;
  }

  /**
   * Get current PCM buffer for testing
   */
  public getPcmBuffer(): Int16Array[] {
    return this.pcmBuffer;
  }

  /**
   * Handle non-SSE formatted messages (ping/pong)
   */
  private handleNonSSEMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      console.log(
        `[Event Receiver] Non-SSE JSON message: type=${message.type}, keys=${Object.keys(message).join(",")}`,
      );
      if (message.type === "pong" && message.timestamp) {
        this.config.onPong?.(message.timestamp);
      }
    } catch {
      // Not JSON, log for debugging
      console.warn(
        "[Event Receiver] Non-SSE, non-JSON message:",
        data.substring(0, 100),
      );
    }
  }

  /**
   * Handle SSE-formatted messages
   */
  private handleSSEMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): void {
    const jsonStr = data.substring(6).trim(); // Remove "data: " prefix

    // Handle [DONE] marker
    if (jsonStr === "[DONE]") {
      console.log("[Event Receiver] ╔═══════════════════════════════╗");
      console.log("[Event Receiver] ║      RECEIVED [DONE]          ║");
      console.log("[Event Receiver] ╚═══════════════════════════════╝");
      this.handleDoneMarker(controller);
      return;
    }

    // Parse JSON and convert to UIMessageChunkFromAISDKv6
    let chunk: unknown;
    try {
      chunk = JSON.parse(jsonStr);
    } catch (_err) {
      // Log malformed JSON but continue processing (don't close stream)
      console.error(
        "[Event Receiver] Malformed JSON in SSE message:",
        jsonStr.substring(0, 100),
      );
      return; // Skip this message but keep stream open
    }

    // Debug logging for ALL events with recipient info
    const eventType = (chunk as any).type;
    const _toolName = (chunk as any).toolName;
    const toolCallId = (chunk as any).toolCallId;
    const input = (chunk as any).input;
    const approvalId = (chunk as any).approvalId;
    const recipient = input?.recipient || "N/A";

    if (eventType?.startsWith("tool-")) {
      console.log(
        `[Event Receiver] ▶ ${eventType} | recipient=${recipient} | toolCallId=${toolCallId?.slice(-8)} | approvalId=${approvalId?.slice(-8)}`,
      );
    } else {
      console.log(`[Event Receiver] ▶ ${eventType}`);
    }

    // Additional debug logging for specific event types
    if ((chunk as any).type === "tool-approval-request") {
      console.log(
        `[Event Receiver]   └─ APPROVAL REQUEST for ${recipient}: approvalId=${(chunk as any).approvalId}, toolCallId=${(chunk as any).toolCallId}`,
      );
    }

    // Custom event handling (skip standard enqueue if needed)
    if (this.handleCustomEventWithSkip(chunk, controller)) {
      return;
    }

    // BIDI BLOCKING Pattern: Wait for finish-step chunk after approval request (ADR 0011)
    // AI SDK v6 only calls sendAutomaticallyWhen when status != "streaming"
    // After receiving approval-request, enqueue it and wait for finish-step chunk to close stream
    if ((chunk as UIMessageChunkFromAISDKv6).type === "tool-approval-request") {
      console.log(
        "[Event Receiver] Enqueuing approval request, waiting for finish-step to close stream",
      );
      controller.enqueue(chunk as UIMessageChunkFromAISDKv6);

      // Flag: Next finish-step chunk should close the stream
      this.waitingForFinishStepAfterApproval = true;

      return; // Skip normal enqueue since we already enqueued
    }

    // Close stream after finish-step chunk following approval-request (ADR 0011)
    if (
      this.waitingForFinishStepAfterApproval &&
      (chunk as UIMessageChunkFromAISDKv6).type === "finish-step"
    ) {
      console.log(
        "[Event Receiver] Received finish-step after approval request, closing stream",
      );

      // Enqueue the finish-step chunk
      controller.enqueue(chunk as UIMessageChunkFromAISDKv6);

      // Close controller to set status != "streaming"
      // Note: This closes the stream but NOT the WebSocket connection
      try {
        controller.close();
      } catch (err) {
        console.warn("[Event Receiver] Controller already closed:", err);
      }

      // CRITICAL: Mark stream as done so transport creates new controller for approval response
      // Without this flag, transport reuses the closed controller and backend responses are lost
      this.doneReceived = true;

      // Reset flag
      this.waitingForFinishStepAfterApproval = false;

      return; // Skip normal enqueue since we already enqueued
    }

    // Special handling for finish event with audio: inject recorded audio BEFORE finish
    if (
      (chunk as any).type === "finish" &&
      (chunk as any).messageMetadata?.audio &&
      this.pcmBuffer.length > 0
    ) {
      this.injectRecordedAudio(controller);
    }

    // Standard enqueue: Forward to AI SDK useChat hook
    try {
      controller.enqueue(chunk as UIMessageChunkFromAISDKv6);
    } catch (err) {
      // Handle controller already closed (can happen in tests or when [DONE] races with other messages)
      if (
        err instanceof Error &&
        "code" in err &&
        err.code === "ERR_INVALID_STATE"
      ) {
        console.warn(
          `[Event Receiver] Controller already closed, skipping chunk: ${(chunk as any).type}`,
        );
        return;
      }
      throw err;
    }

    // Custom event handling (after standard enqueue)
    this.handleCustomEventWithoutSkip(chunk);
  }

  /**
   * Handle [DONE] marker
   */
  private handleDoneMarker(
    controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): void {
    // Protect against multiple [DONE] markers
    if (this.doneReceived) {
      console.warn(
        "[Event Receiver] Protocol violation: Multiple [DONE] markers received. Ignoring subsequent [DONE].",
      );
      return;
    }

    this.doneReceived = true;

    // Reset AudioContext for next turn (BIDI mode)
    if (this.config.audioContext) {
      this.config.audioContext.voiceChannel.reset();
    }

    // Close controller (may already be closed in some edge cases)
    try {
      controller.close();
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        err.code === "ERR_INVALID_STATE"
      ) {
        console.warn(
          "[Event Receiver] Controller already closed in handleDoneMarker",
        );
      } else {
        throw err;
      }
    }
    // this.currentController = null;

    // Reset audio state for next turn
    this.audioChunkIndex = 0;
    this.pcmBuffer = [];
  }

  /**
   * Handle custom events that SKIP standard enqueue
   *
   * @returns true if standard enqueue should be skipped
   */
  private handleCustomEventWithSkip(
    chunk: unknown,
    _controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): boolean {
    // Type guard
    if (
      typeof chunk !== "object" ||
      chunk === null ||
      !("type" in chunk) ||
      typeof chunk.type !== "string"
    ) {
      console.warn("[Event Receiver] Invalid chunk format:", chunk);
      return false;
    }

    // SPECIAL HANDLING: PCM audio chunks (ADK BIDI mode)
    if (chunk.type === "data-pcm") {
      console.info("[Audio Stream] Received PCM audio chunk");
      this.handlePCMAudioChunk(chunk as PCMAudioChunk);
      return true; // Skip standard enqueue
    }

    return false;
  }

  /**
   * Handle PCM audio chunks for real-time playback
   */
  private handlePCMAudioChunk(chunk: PCMAudioChunk): void {
    try {
      // Extract PCM format with defaults for ADK BIDI standard format
      const format: PCMFormat = {
        sampleRate: chunk.data?.sampleRate ?? 24000,
        channels: chunk.data?.channels ?? 1,
        bitDepth: chunk.data?.bitDepth ?? 16,
      };
      // Store format for WAV conversion (uses first chunk's format)
      if (!this.pcmFormat) {
        this.pcmFormat = format;
      }

      if (!chunk.data) {
        console.warn(
          "[Audio Stream] Invalid PCM chunk: missing data field: ",
          chunk,
        );
        return;
      }
      if (!chunk.data.content || typeof chunk.data.content !== "string") {
        console.warn(
          "[Audio Stream] Invalid PCM chunk: missing data.content field: ",
          chunk,
        );
        return;
      }

      const pcmBase64 = chunk.data.content;
      const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
      const pcmData = new Int16Array(
        pcmBytes.buffer,
        pcmBytes.byteOffset,
        pcmBytes.byteLength / 2,
      );

      // Pipeline 1: Real-time playback via AudioWorklet
      if (this.config.audioContext) {
        this.config.audioContext.voiceChannel.playPCM(pcmData);
      }

      // Pipeline 2: Recording for message replay
      this.pcmBuffer.push(pcmData.slice());
      this.audioChunkIndex++;
    } catch (err) {
      console.error("[Audio Stream] Error processing PCM chunk:", err);
    }
  }

  /**
   * Handle custom events that DO NOT skip standard enqueue
   */
  private handleCustomEventWithoutSkip(chunk: unknown): void {
    // Type guard
    if (
      typeof chunk !== "object" ||
      chunk === null ||
      !("type" in chunk) ||
      typeof chunk.type !== "string"
    ) {
      return;
    }

    // Finish event: Log completion metrics
    if (
      chunk.type === "finish" &&
      "messageMetadata" in chunk &&
      typeof chunk.messageMetadata === "object" &&
      chunk.messageMetadata !== null
    ) {
      const metadata = chunk.messageMetadata as Record<string, unknown>;

      // Log audio stream completion
      if (metadata.audio) {
        console.log(
          `[Audio Stream] Stream completed. Total PCM chunks received: ${this.audioChunkIndex}`,
        );
      }

      // Log usage statistics
      if (metadata.usage) {
        console.log("[Usage]", metadata.usage);
      }
    }
  }

  /**
   * Inject recorded audio as file chunk before finish event
   */
  private injectRecordedAudio(
    controller: ReadableStreamDefaultController<UIMessageChunkFromAISDKv6>,
  ): void {
    try {
      console.log("[Audio Recording] Converting PCM to WAV...");
      const wavDataUri = this.convertPcmToWav();
      const wavSizeKB = ((wavDataUri.length * 0.75) / 1024).toFixed(2);
      console.log(`[Audio Recording] WAV created: ${wavSizeKB} KB`);

      const audioChunk: UIMessageChunkFromAISDKv6 = {
        type: "file",
        mediaType: "audio/wav",
        url: wavDataUri,
      };
      controller.enqueue(audioChunk);
    } catch (err) {
      console.error("[Audio Recording] Failed to convert PCM to WAV:", err);
    }
  }

  /**
   * Convert buffered PCM data to WAV format
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

    // WAV file parameters (from received PCM format or ADK BIDI defaults)
    const format = this.pcmFormat ?? { sampleRate: 24000, channels: 1, bitDepth: 16 };
    const sampleRate = format.sampleRate;
    const numChannels = format.channels;
    const bitsPerSample = format.bitDepth;

    // Create WAV file buffer
    const wavBuffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(wavBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF"); // ChunkID
    view.setUint32(4, 36 + pcmData.length * 2, true); // ChunkSize
    writeString(8, "WAVE"); // Format
    writeString(12, "fmt "); // Subchunk1ID
    view.setUint32(16, 16, true); // Subchunk1Size (PCM)
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample
    writeString(36, "data"); // Subchunk2ID
    view.setUint32(40, pcmData.length * 2, true); // Subchunk2Size

    // Write PCM data
    const wavData = new Int16Array(wavBuffer, 44);
    wavData.set(pcmData);

    // Convert to base64 data URI
    const bytes = new Uint8Array(wavBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:audio/wav;base64,${base64}`;
  }
}
