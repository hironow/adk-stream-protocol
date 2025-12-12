/**
 * PCM Player AudioWorklet Processor
 *
 * Implements ring buffer for continuous audio streaming without restarts.
 * Based on ADK documentation:
 * https://google.github.io/adk-docs/streaming/dev-guide/part5/#handling-audio-events-at-the-client
 *
 * Key features:
 * - Ring buffer (circular buffer) for continuous playback
 * - No restarts when new chunks arrive
 * - Handles 16-bit PCM at 24kHz from Gemini model
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffer - 180 seconds at 24kHz
    this.bufferSize = 24000 * 180;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndex = 0;

    // Track if we've received any audio yet
    this.hasAudio = false;

    // Track playback state
    this.isPlaying = false;
    this.silenceFrames = 0;
    this.SILENCE_THRESHOLD = 24000; // 1 second of silence at 24kHz

    // Handle incoming PCM chunks
    this.port.onmessage = (event) => {
      if (event.data.command === "endOfAudio") {
        // Flush buffer - jump read index to write index
        this.readIndex = this.writeIndex;
        return;
      }

      if (event.data.command === "reset") {
        // Reset buffer for new turn
        this.writeIndex = 0;
        this.readIndex = 0;
        this.hasAudio = false;
        this.isPlaying = false;
        this.silenceFrames = 0;
        return;
      }

      // Incoming PCM chunk (Int16Array)
      const int16Samples = new Int16Array(event.data);
      this._enqueue(int16Samples);
    };
  }

  /**
   * Enqueue PCM samples to ring buffer without restarting playback.
   * Converts Int16 samples to Float32 format.
   */
  _enqueue(int16Samples) {
    if (!this.hasAudio) {
      this.hasAudio = true;
    }

    // Reset silence counter when new audio arrives
    this.silenceFrames = 0;

    // Notify that playback has started
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.port.postMessage({ type: "playback-started" });
    }

    for (let i = 0; i < int16Samples.length; i++) {
      // Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      const floatVal = int16Samples[i] / 32768.0;

      // Write to ring buffer
      this.buffer[this.writeIndex] = floatVal;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;

      // If buffer is full, advance read index (drop oldest samples)
      if (this.writeIndex === this.readIndex) {
        this.readIndex = (this.readIndex + 1) % this.bufferSize;
      }
    }
  }

  /**
   * Process audio output continuously.
   * Called by Web Audio API for each audio block (128 frames).
   */
  process(_inputs, outputs, _parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const framesPerBlock = output[0].length;
    let silentFramesInBlock = 0;

    for (let frame = 0; frame < framesPerBlock; frame++) {
      // Check if we have audio available to read
      if (this.readIndex !== this.writeIndex) {
        // Read sample from buffer
        const sample = this.buffer[this.readIndex];

        // Output to all channels (mono or stereo)
        for (let channel = 0; channel < output.length; channel++) {
          output[channel][frame] = sample;
        }

        // Advance read index
        this.readIndex = (this.readIndex + 1) % this.bufferSize;
      } else {
        // No more audio available - output silence
        for (let channel = 0; channel < output.length; channel++) {
          output[channel][frame] = 0;
        }
        silentFramesInBlock++;
      }
    }

    // Track silence duration
    if (silentFramesInBlock === framesPerBlock) {
      this.silenceFrames += framesPerBlock;

      // After 1 second of silence, consider playback finished
      if (this.isPlaying && this.silenceFrames >= this.SILENCE_THRESHOLD) {
        this.isPlaying = false;
        this.port.postMessage({ type: "playback-finished" });
        console.log(
          "[AudioWorklet] Playback finished after",
          this.silenceFrames,
          "silent frames",
        );
      }
    }

    // Keep processor alive
    return true;
  }
}

// Register processor
registerProcessor("pcm-player-processor", PCMPlayerProcessor);
