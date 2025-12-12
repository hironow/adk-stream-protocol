/**
 * PCM Recorder Processor (AudioWorklet)
 *
 * Based on ADK BIDI demo implementation:
 * https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/static/js/pcm-recorder-processor.js
 *
 * Processes audio input in real-time and sends Float32 PCM samples to main thread.
 * Main thread converts Float32 to Int16 PCM for ADK Live API.
 */

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  /**
   * Process audio samples from microphone input
   *
   * @param {Float32Array[][]} inputs - Input audio data (first channel used)
   * @param {Float32Array[][]} outputs - Output audio data (unused)
   * @param {Object} parameters - Processor parameters (unused)
   * @returns {boolean} - true to keep processor alive
   */
  process(inputs, outputs, parameters) {
    if (inputs.length > 0 && inputs[0].length > 0) {
      // Use the first channel (mono recording)
      const inputChannel = inputs[0][0];

      // IMPORTANT: Copy the buffer to avoid issues with recycled memory
      // Web Audio API recycles Float32Array buffers, so we must copy data
      // before sending to main thread
      const inputCopy = new Float32Array(inputChannel);

      // Send Float32 samples to main thread for conversion to Int16 PCM
      this.port.postMessage(inputCopy);
    }

    // Return true to keep processor active
    return true;
  }
}

// Register the processor with Web Audio API
registerProcessor("pcm-recorder-processor", PCMRecorderProcessor);
