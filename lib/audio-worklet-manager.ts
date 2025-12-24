/**
 * AudioWorklet Manager
 *
 * Manages AudioContext and AudioWorklet for PCM audio streaming.
 * Handles initialization, chunk processing, and cleanup.
 */

export interface PCMChunk {
  content: string; // base64-encoded PCM data
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export interface AudioWorkletManagerOptions {
  sampleRate: number;
  processorUrl: string;
  processorName: string;
}

export class AudioWorkletManager {
  private audioContext: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private isInitialized = false;

  constructor(private options: AudioWorkletManagerOptions) {}

  /**
   * Initialize AudioContext and AudioWorklet
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create AudioContext with specified sample rate
      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate,
      });

      // Load AudioWorklet processor module
      await this.audioContext.audioWorklet.addModule(this.options.processorUrl);

      // Create AudioWorklet node
      this.audioWorkletNode = new AudioWorkletNode(
        this.audioContext,
        this.options.processorName,
      );

      // Connect to audio destination (speakers)
      this.audioWorkletNode.connect(this.audioContext.destination);

      this.isInitialized = true;
    } catch (err) {
      throw new Error(
        `Failed to initialize AudioWorklet: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Process PCM chunks and send to AudioWorklet
   */
  async processChunks(chunks: PCMChunk[]): Promise<void> {
    if (!this.audioWorkletNode || !this.audioContext) {
      throw new Error("AudioWorklet not initialized");
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    for (const chunk of chunks) {
      const pcmData = this.decodePCMChunk(chunk);
      // Transfer buffer ownership to AudioWorklet (zero-copy)
      this.audioWorkletNode.port.postMessage(pcmData.buffer, [pcmData.buffer]);
    }
  }

  /**
   * Send reset command to AudioWorklet
   */
  reset(): void {
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ command: "reset" });
    }
  }

  /**
   * Get AudioContext state
   */
  getState(): AudioContextState | null {
    return this.audioContext?.state ?? null;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isInitialized = false;
  }

  /**
   * Decode base64 PCM chunk to Int16Array
   */
  private decodePCMChunk(chunk: PCMChunk): Int16Array {
    // Decode base64 to binary string
    const binaryString = atob(chunk.content);

    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert to Int16Array (16-bit PCM)
    return new Int16Array(bytes.buffer);
  }
}
