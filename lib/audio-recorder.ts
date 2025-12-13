/**
 * Audio Recorder using AudioWorklet for PCM recording
 *
 * Based on ADK BIDI demo implementation:
 * https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/static/js/audio-recorder.js
 *
 * Records microphone input as 16-bit PCM audio at 16kHz sample rate.
 * Uses AudioWorklet for low-latency real-time audio processing.
 */

export interface AudioChunk {
  data: Int16Array; // 16-bit PCM samples
  sampleRate: number; // Sample rate in Hz
  channels: number; // Number of channels (1 for mono)
  bitDepth: number; // Bit depth (16)
}

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;

  // ADK Live API audio format requirements
  private readonly SAMPLE_RATE = 16000; // 16kHz
  private readonly CHANNELS = 1; // Mono
  private readonly BIT_DEPTH = 16; // 16-bit

  /**
   * Initialize AudioContext and load AudioWorklet processor
   */
  async initialize(): Promise<void> {
    console.log("[AudioRecorder] Initializing...");

    // Create AudioContext with 16kHz sample rate (ADK requirement)
    this.audioContext = new AudioContext({
      sampleRate: this.SAMPLE_RATE,
    });

    console.log(
      `[AudioRecorder] AudioContext created: ${this.audioContext.sampleRate}Hz`,
    );

    // Load PCM recorder worklet processor
    const workletURL = "/pcm-recorder-processor.js";
    await this.audioContext.audioWorklet.addModule(workletURL);
    console.log("[AudioRecorder] AudioWorklet processor loaded");
  }

  /**
   * Start recording from microphone
   *
   * @param onChunk - Callback for each audio chunk
   */
  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (!this.audioContext) {
      throw new Error(
        "AudioRecorder not initialized. Call initialize() first.",
      );
    }

    console.log("[AudioRecorder] Starting recording...");
    this.onChunkCallback = onChunk;

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: this.CHANNELS,
        sampleRate: this.SAMPLE_RATE,
        echoCancellation: true, // Enable echo cancellation for better quality
        noiseSuppression: true, // Enable noise suppression
        autoGainControl: true, // Enable automatic gain control
      },
    });

    console.log("[AudioRecorder] Microphone access granted");

    // Create media stream source
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(
      this.mediaStream,
    );

    // Create AudioWorklet node
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-recorder-processor",
      {
        channelCount: this.CHANNELS,
        numberOfInputs: 1,
        numberOfOutputs: 0, // No output needed (recording only)
      },
    );

    // Handle audio chunks from worklet
    this.workletNode.port.onmessage = (event: MessageEvent) => {
      const float32Samples = event.data as Float32Array;
      const pcmChunk = this.convertFloat32ToPCM16(float32Samples);

      if (this.onChunkCallback) {
        this.onChunkCallback({
          data: pcmChunk,
          sampleRate: this.SAMPLE_RATE,
          channels: this.CHANNELS,
          bitDepth: this.BIT_DEPTH,
        });
      }
    };

    // Connect: microphone → worklet → (chunks sent via port.onmessage)
    this.mediaStreamSource.connect(this.workletNode);

    console.log("[AudioRecorder] Recording started");
  }

  /**
   * Stop recording and release resources
   */
  stop(): void {
    console.log("[AudioRecorder] Stopping recording...");

    // Disconnect audio nodes
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.mediaStream = null;
    }

    this.onChunkCallback = null;

    console.log("[AudioRecorder] Recording stopped");
  }

  /**
   * Close AudioContext and release all resources
   */
  async close(): Promise<void> {
    console.log("[AudioRecorder] Closing...");

    this.stop();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    console.log("[AudioRecorder] Closed");
  }

  /**
   * Convert Float32 samples to 16-bit PCM (Int16Array)
   *
   * Float32 range: -1.0 to 1.0
   * Int16 range: -32768 to 32767
   *
   * @param float32Samples - Float32 audio samples from AudioWorklet
   * @returns Int16Array with 16-bit PCM samples
   */
  private convertFloat32ToPCM16(float32Samples: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Samples.length);

    for (let i = 0; i < float32Samples.length; i++) {
      // Clamp to [-1.0, 1.0] range
      const clamped = Math.max(-1, Math.min(1, float32Samples[i]));

      // Scale to 16-bit signed integer range
      // Multiply by 0x7fff (32767) to convert float to 16-bit PCM
      pcm16[i] = Math.round(clamped * 0x7fff);
    }

    return pcm16;
  }

  /**
   * Check if recording is active
   */
  get isRecording(): boolean {
    return this.workletNode !== null && this.mediaStream !== null;
  }

  /**
   * Get current sample rate
   */
  get sampleRate(): number {
    return this.audioContext?.sampleRate ?? this.SAMPLE_RATE;
  }
}
