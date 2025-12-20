/**
 * BIDI Event Receiver
 *
 * Handles incoming WebSocket messages from backend (ADK events in SSE format)
 * and converts them to UIMessageChunk for AI SDK v6 useChat hook.
 *
 * Responsibilities:
 * - Parse SSE-formatted WebSocket messages
 * - Convert to UIMessageChunk format
 * - Handle custom events (PCM audio, tool invocations)
 * - Manage stream lifecycle ([DONE] markers)
 * - Integrate with AudioContext for voice playback
 */

import type { UIMessageChunk } from "@ai-sdk/ui-utils";

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
 * EventReceiver handles incoming WebSocket messages and converts them to UIMessageChunk.
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
  private audioChunkIndex = 0;
  private pcmBuffer: Int16Array[] = [];

  constructor(private config: EventReceiverConfig) {}

  /**
   * Handle incoming WebSocket message
   *
   * @param data Raw WebSocket message data (string)
   * @param controller Stream controller for enqueuing chunks
   */
  public handleMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    try {
      // Store controller reference for [DONE] handling
      // this.currentController = controller;

      // Handle ping/pong for latency monitoring (not SSE format)
      if (!data.startsWith("data: ")) {
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
    this.audioChunkIndex = 0;
    this.pcmBuffer = [];
    // this.currentController = null;
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
      if (message.type === "pong" && message.timestamp) {
        this.config.onPong?.(message.timestamp);
      }
    } catch {
      // Not JSON, ignore
    }
  }

  /**
   * Handle SSE-formatted messages
   */
  private handleSSEMessage(
    data: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    const jsonStr = data.substring(6).trim(); // Remove "data: " prefix

    // Handle [DONE] marker
    if (jsonStr === "[DONE]") {
      this.handleDoneMarker(controller);
      return;
    }

    // Parse JSON and convert to UIMessageChunk
    const chunk = JSON.parse(jsonStr);

    // Debug logging for specific event types
    if (chunk.type === "tool-approval-request") {
      console.log(
        `[Event Receiver] Received tool-approval-request: approvalId=${chunk.approvalId}, toolCallId=${chunk.toolCallId}`,
      );
    }

    // Custom event handling (skip standard enqueue if needed)
    if (this.handleCustomEventWithSkip(chunk, controller)) {
      return;
    }

    // Special handling for finish event with audio: inject recorded audio BEFORE finish
    if (
      chunk.type === "finish" &&
      chunk.messageMetadata?.audio &&
      this.pcmBuffer.length > 0
    ) {
      this.injectRecordedAudio(controller);
    }

    // Standard enqueue: Forward to AI SDK useChat hook
    controller.enqueue(chunk as UIMessageChunk);

    // Custom event handling (after standard enqueue)
    this.handleCustomEventWithoutSkip(chunk);
  }

  /**
   * Handle [DONE] marker
   */
  private handleDoneMarker(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
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

    controller.close();
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
    _controller: ReadableStreamDefaultController<UIMessageChunk>,
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
      this.handlePCMAudioChunk(chunk);
      return true; // Skip standard enqueue
    }

    return false;
  }

  /**
   * Handle PCM audio chunks for real-time playback
   */
  private handlePCMAudioChunk(chunk: any): void {
    try {
      // TODO: handle chunk data PCM format changes
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
      const metadata = chunk.messageMetadata as any;

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
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    try {
      console.log("[Audio Recording] Converting PCM to WAV...");
      const wavDataUri = this.convertPcmToWav();
      const wavSizeKB = ((wavDataUri.length * 0.75) / 1024).toFixed(2);
      console.log(`[Audio Recording] WAV created: ${wavSizeKB} KB`);

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

    // WAV file parameters (match ADK BIDI output format)
    const sampleRate = 24000; // 24kHz (ADK BIDI default)
    const numChannels = 1; // Mono
    const bitsPerSample = 16; // 16-bit

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
