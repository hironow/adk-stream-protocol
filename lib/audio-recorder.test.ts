/**
 * Unit tests for AudioRecorder class
 *
 * Tests AudioWorklet-based PCM recording with proper cleanup.
 * Based on ADK BIDI demo implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioChunk } from "./audio-recorder";
import { AudioRecorder } from "./audio-recorder";

// Mock Web Audio API
class MockAudioContext {
  sampleRate = 16000;
  state: "running" | "closed" = "running";
  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  createMediaStreamSource = vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  close = vi.fn().mockResolvedValue(undefined);
}

class MockAudioWorkletNode {
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

class MockMediaStream {
  private tracks: MediaStreamTrack[] = [];

  constructor() {
    // Create mock audio track
    this.tracks = [
      {
        stop: vi.fn(),
        kind: "audio",
        enabled: true,
        id: "mock-track-1",
      } as any,
    ];
  }

  getTracks = vi.fn(() => this.tracks);
  getAudioTracks = vi.fn(() => this.tracks);
}

// Setup global mocks
beforeEach(() => {
  // Mock AudioContext
  global.AudioContext = vi.fn(function (this: any, _options: any) {
    return new MockAudioContext();
  }) as any;

  // Mock AudioWorkletNode
  global.AudioWorkletNode = vi.fn(function (
    this: any,
    _context: any,
    _name: string,
    _options: any,
  ) {
    return new MockAudioWorkletNode();
  }) as any;

  // Mock navigator.mediaDevices.getUserMedia
  Object.defineProperty(global, "navigator", {
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
      },
    },
  });

  // Mock console methods to reduce noise
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AudioRecorder", () => {
  describe("initialize()", () => {
    it("should create AudioContext with 16kHz sample rate", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      expect(global.AudioContext).toHaveBeenCalledWith({
        sampleRate: 16000,
      });
    });

    it("should load AudioWorklet processor module", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const audioContext = (recorder as any).audioContext;
      expect(audioContext.audioWorklet.addModule).toHaveBeenCalledWith(
        "/pcm-recorder-processor.js",
      );
    });

    it("should set isRecording to false after initialization", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      expect(recorder.isRecording).toBe(false);
    });

    it("should expose correct sample rate", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      expect(recorder.sampleRate).toBe(16000);
    });
  });

  describe("start()", () => {
    it("should throw error if not initialized", async () => {
      const recorder = new AudioRecorder();

      await expect(recorder.start(() => {})).rejects.toThrow(
        "AudioRecorder not initialized. Call initialize() first.",
      );
    });

    it("should request microphone access with correct constraints", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const onChunk = vi.fn();
      await recorder.start(onChunk);

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    });

    it("should create AudioWorkletNode with correct configuration", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const onChunk = vi.fn();
      await recorder.start(onChunk);

      const audioContext = (recorder as any).audioContext;
      expect(AudioWorkletNode).toHaveBeenCalledWith(
        audioContext,
        "pcm-recorder-processor",
        {
          channelCount: 1,
          numberOfInputs: 1,
          numberOfOutputs: 0,
        },
      );
    });

    it("should connect media stream to worklet node", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const onChunk = vi.fn();
      await recorder.start(onChunk);

      const mediaStreamSource = (recorder as any).mediaStreamSource;
      expect(mediaStreamSource.connect).toHaveBeenCalled();
    });

    it("should set isRecording to true", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const onChunk = vi.fn();
      await recorder.start(onChunk);

      expect(recorder.isRecording).toBe(true);
    });

    it("should call onChunk callback when worklet sends audio data", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const onChunk = vi.fn();
      await recorder.start(onChunk);

      // Simulate worklet sending audio samples
      const workletNode = (recorder as any).workletNode;
      const float32Samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);

      // Trigger port.onmessage
      if (workletNode.port.onmessage) {
        workletNode.port.onmessage(
          new MessageEvent("message", { data: float32Samples }),
        );
      }

      expect(onChunk).toHaveBeenCalledTimes(1);

      const chunk: AudioChunk = onChunk.mock.calls[0][0];
      expect(chunk.sampleRate).toBe(16000);
      expect(chunk.channels).toBe(1);
      expect(chunk.bitDepth).toBe(16);
      expect(chunk.data).toBeInstanceOf(Int16Array);
      expect(chunk.data.length).toBe(4);
    });
  });

  describe("stop()", () => {
    it("should disconnect all audio nodes", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      const mediaStreamSource = (recorder as any).mediaStreamSource;
      const workletNode = (recorder as any).workletNode;

      recorder.stop();

      expect(mediaStreamSource.disconnect).toHaveBeenCalled();
      expect(workletNode.disconnect).toHaveBeenCalled();
    });

    it("should stop all media stream tracks", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      const mediaStream = (recorder as any).mediaStream;
      const tracks = mediaStream.getTracks();

      recorder.stop();

      expect(tracks[0].stop).toHaveBeenCalled();
    });

    it("should set isRecording to false", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      recorder.stop();

      expect(recorder.isRecording).toBe(false);
    });

    it("should clear all references", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      recorder.stop();

      expect((recorder as any).mediaStreamSource).toBe(null);
      expect((recorder as any).workletNode).toBe(null);
      expect((recorder as any).mediaStream).toBe(null);
      expect((recorder as any).onChunkCallback).toBe(null);
    });
  });

  describe("close()", () => {
    it("should call stop() before closing", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      const stopSpy = vi.spyOn(recorder, "stop");

      await recorder.close();

      expect(stopSpy).toHaveBeenCalled();
    });

    it("should close AudioContext", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const audioContext = (recorder as any).audioContext;
      await recorder.close();

      expect(audioContext.close).toHaveBeenCalled();
    });

    it("should clear AudioContext reference", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      await recorder.close();

      expect((recorder as any).audioContext).toBe(null);
    });

    it("should handle close() when not initialized", async () => {
      const recorder = new AudioRecorder();

      // Should not throw
      await expect(recorder.close()).resolves.toBeUndefined();
    });

    it("should handle close() when not started", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      // Should not throw
      await expect(recorder.close()).resolves.toBeUndefined();
    });
  });

  describe("convertFloat32ToPCM16()", () => {
    it("should convert Float32 samples to Int16 PCM", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      // Access private method via any
      const convertFloat32ToPCM16 = (
        recorder as any
      ).convertFloat32ToPCM16.bind(recorder);

      const float32Samples = new Float32Array([
        0.0, // 0
        0.5, // 16383
        1.0, // 32767
        -0.5, // -16383
        -1.0, // -32767
      ]);

      const pcm16 = convertFloat32ToPCM16(float32Samples);

      expect(pcm16).toBeInstanceOf(Int16Array);
      expect(pcm16.length).toBe(5);
      expect(pcm16[0]).toBe(0);
      expect(pcm16[1]).toBeCloseTo(16383, -1); // Allow 1 bit tolerance
      expect(pcm16[2]).toBe(32767);
      expect(pcm16[3]).toBeCloseTo(-16383, -1);
      expect(pcm16[4]).toBe(-32767);
    });

    it("should clamp values outside [-1.0, 1.0] range", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const convertFloat32ToPCM16 = (
        recorder as any
      ).convertFloat32ToPCM16.bind(recorder);

      const float32Samples = new Float32Array([
        1.5, // Should clamp to 1.0 → 32767
        -1.5, // Should clamp to -1.0 → -32767
        2.0, // Should clamp to 1.0 → 32767
        -2.0, // Should clamp to -1.0 → -32767
      ]);

      const pcm16 = convertFloat32ToPCM16(float32Samples);

      expect(pcm16[0]).toBe(32767);
      expect(pcm16[1]).toBe(-32767);
      expect(pcm16[2]).toBe(32767);
      expect(pcm16[3]).toBe(-32767);
    });

    it("should handle empty array", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const convertFloat32ToPCM16 = (
        recorder as any
      ).convertFloat32ToPCM16.bind(recorder);

      const float32Samples = new Float32Array([]);
      const pcm16 = convertFloat32ToPCM16(float32Samples);

      expect(pcm16).toBeInstanceOf(Int16Array);
      expect(pcm16.length).toBe(0);
    });
  });

  describe("Lifecycle: initialize → start → stop → close", () => {
    it("should complete full lifecycle without errors", async () => {
      const recorder = new AudioRecorder();

      // Initialize
      await recorder.initialize();
      expect(recorder.isRecording).toBe(false);
      expect(recorder.sampleRate).toBe(16000);

      // Start
      const chunks: AudioChunk[] = [];
      await recorder.start((chunk) => chunks.push(chunk));
      expect(recorder.isRecording).toBe(true);

      // Simulate worklet sending data
      const workletNode = (recorder as any).workletNode;
      const float32Samples = new Float32Array([0.5, -0.5]);
      if (workletNode.port.onmessage) {
        workletNode.port.onmessage(
          new MessageEvent("message", { data: float32Samples }),
        );
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].data.length).toBe(2);

      // Stop
      recorder.stop();
      expect(recorder.isRecording).toBe(false);

      // Close
      await recorder.close();
      expect((recorder as any).audioContext).toBe(null);
    });
  });

  describe("Error handling", () => {
    it("should handle getUserMedia failure", async () => {
      const recorder = new AudioRecorder();
      await recorder.initialize();

      // Mock getUserMedia to reject
      (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      await expect(recorder.start(() => {})).rejects.toThrow(
        "Permission denied",
      );
    });

    it("should handle AudioWorklet module loading failure", async () => {
      // Create a mock context that will fail on addModule
      const failingMockContext = new MockAudioContext();
      failingMockContext.audioWorklet.addModule = vi
        .fn()
        .mockRejectedValueOnce(new Error("Failed to load module"));

      // Override global.AudioContext for this test only
      global.AudioContext = vi.fn(function (this: any, _options: any) {
        return failingMockContext;
      }) as any;

      const recorder = new AudioRecorder();

      await expect(recorder.initialize()).rejects.toThrow(
        "Failed to load module",
      );
    });
  });
});
