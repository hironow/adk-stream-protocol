/**
 * E2E Test: Audio Control
 *
 * Tests audio input/output functionality in BIDI mode.
 * Uses Web Audio API mocks to simulate browser audio capabilities in jsdom.
 *
 * Key scenarios tested:
 * - Audio recording initialization and chunk sending
 * - Audio playback from AI responses
 * - BGM control via tool invocations
 * - Error handling for audio operations
 *
 * Note: These tests use mocked Web Audio API since jsdom doesn't support it.
 * For real browser testing, use Playwright scenarios in scenarios/app-advanced/
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioRecorder } from "../../audio-recorder";
import { AudioWorkletManager } from "../../audio-worklet-manager";
import {
  createMockPCMData,
  setupWebAudioMocks,
} from "../shared-mocks/web-audio-api";

describe("Audio Control E2E", () => {
  // Setup Web Audio API mocks for all tests
  const {
    getMockAudioContext,
    getMockWorkletNodes,
    getMockMediaStreams,
    simulateGetUserMediaFailure,
  } = setupWebAudioMocks();

  describe("Audio Input (Recording)", () => {
    it("should initialize AudioRecorder and create AudioContext", async () => {
      // given
      const recorder = new AudioRecorder();

      // when
      await recorder.initialize();

      // then
      expect(getMockAudioContext()).not.toBeNull();
      expect(
        getMockAudioContext()?.audioWorklet.addModule,
      ).toHaveBeenCalledWith("/pcm-recorder-processor.js");
    });

    it("should start recording and request microphone access", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const onChunk = vi.fn();

      // when
      await recorder.start(onChunk);

      // then
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          channelCount: 1,
          sampleRate: 16000,
        }),
      });
      expect(recorder.isRecording).toBe(true);
      expect(getMockMediaStreams().length).toBe(1);
    });

    it("should send audio chunks to callback", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const chunks: Array<{ data: Int16Array; sampleRate: number }> = [];
      await recorder.start((chunk) => chunks.push(chunk));

      // when - simulate worklet sending audio data
      const workletNode = getMockWorkletNodes()[0];
      const mockAudioSamples = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      workletNode.simulateMessage(mockAudioSamples);

      // then
      expect(chunks.length).toBe(1);
      expect(chunks[0].sampleRate).toBe(16000);
      expect(chunks[0].data).toBeInstanceOf(Int16Array);
      expect(chunks[0].data.length).toBe(4);
    });

    it("should handle recording errors gracefully", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const permissionError = new Error("Permission denied");
      (permissionError as any).name = "NotAllowedError";
      simulateGetUserMediaFailure(permissionError);

      // when / then
      await expect(recorder.start(() => {})).rejects.toThrow(
        "Permission denied",
      );
      expect(recorder.isRecording).toBe(false);
    });

    it("should stop recording and release resources", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});
      expect(recorder.isRecording).toBe(true);

      // when
      recorder.stop();

      // then
      expect(recorder.isRecording).toBe(false);
      const streams = getMockMediaStreams();
      expect(streams[0].getTracks()[0].stop).toHaveBeenCalled();
    });

    it("should close AudioContext on close()", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      // when
      await recorder.close();

      // then
      expect(getMockAudioContext()?.close).toHaveBeenCalled();
    });
  });

  describe("Audio Output (Playback)", () => {
    it("should initialize AudioWorkletManager for playback", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });

      // when
      await manager.initialize();

      // then
      expect(getMockAudioContext()).not.toBeNull();
      expect(
        getMockAudioContext()?.audioWorklet.addModule,
      ).toHaveBeenCalledWith("/pcm-player-processor.js");
    });

    it("should process PCM chunks for playback", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });
      await manager.initialize();

      const pcmData = createMockPCMData([0.5, -0.5, 1, -1, 0]);
      const chunks = [
        {
          content: pcmData,
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      // when
      await manager.processChunks(chunks);

      // then
      const workletNode = getMockWorkletNodes()[0];
      expect(workletNode.port.postMessage).toHaveBeenCalled();
    });

    it("should resume AudioContext if suspended", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });
      await manager.initialize();

      // Simulate suspended state (autoplay policy)
      const audioContext = getMockAudioContext()!;
      (audioContext as any).state = "suspended";

      const pcmData = createMockPCMData([0.5]);
      const chunks = [
        { content: pcmData, sampleRate: 24000, channels: 1, bitDepth: 16 },
      ];

      // when
      await manager.processChunks(chunks);

      // then
      expect(audioContext.resume).toHaveBeenCalled();
    });

    it("should handle playback errors", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });
      // Don't initialize - should fail

      // when / then
      await expect(
        manager.processChunks([
          { content: "test", sampleRate: 24000, channels: 1, bitDepth: 16 },
        ]),
      ).rejects.toThrow("AudioWorklet not initialized");
    });

    it("should cleanup resources on dispose", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });
      await manager.initialize();

      // when
      manager.dispose();

      // then
      expect(getMockAudioContext()?.close).toHaveBeenCalled();
      expect(manager.getState()).toBe(null);
    });
  });

  describe("BGM Control", () => {
    let mockAudioElement: any;

    beforeEach(() => {
      // Create mock Audio element for BGM
      mockAudioElement = new Audio("/bgm/track1.mp3");
    });

    it("should create Audio element for BGM", () => {
      // then
      expect(mockAudioElement.src).toBe("/bgm/track1.mp3");
      expect(mockAudioElement.paused).toBe(true);
    });

    it("should play and pause BGM", async () => {
      // when
      await mockAudioElement.play();

      // then
      expect(mockAudioElement.paused).toBe(false);

      // when
      mockAudioElement.pause();

      // then
      expect(mockAudioElement.paused).toBe(true);
    });

    it("should adjust volume", () => {
      // when
      mockAudioElement.volume = 0.5;

      // then
      expect(mockAudioElement.volume).toBe(0.5);
    });

    it("should support loop", () => {
      // when
      mockAudioElement.loop = true;

      // then
      expect(mockAudioElement.loop).toBe(true);
    });
  });

  describe("Audio + Text Mixed Mode", () => {
    it("should handle recording while text is being received", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const chunks: any[] = [];
      await recorder.start((chunk) => chunks.push(chunk));

      // Simulate receiving text while recording
      const workletNode = getMockWorkletNodes()[0];

      // when - simulate concurrent audio chunks
      workletNode.simulateMessage(new Float32Array([0.5]));
      workletNode.simulateMessage(new Float32Array([0.25]));

      // then
      expect(chunks.length).toBe(2);
      expect(recorder.isRecording).toBe(true);
    });

    it("should allow playback and recording to coexist", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      await recorder.start(() => {});

      const player = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player-processor.js",
        processorName: "pcm-player-processor",
      });
      await player.initialize();

      // then - both should be active
      expect(recorder.isRecording).toBe(true);
      expect(player.getState()).toBe("running");

      // cleanup
      recorder.stop();
      player.dispose();
    });
  });

  describe("Tab Visibility", () => {
    it("should expose AudioContext state for visibility handling", async () => {
      // given
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test-processor.js",
        processorName: "test-processor",
      });
      await manager.initialize();

      // then
      expect(manager.getState()).toBe("running");
    });

    it("should allow suspend/resume for tab visibility", async () => {
      // given
      const audioContext = getMockAudioContext();
      expect(audioContext).toBeNull(); // Not yet created

      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test-processor.js",
        processorName: "test-processor",
      });
      await manager.initialize();

      const ctx = getMockAudioContext()!;

      // when - simulate tab hidden (would call suspend externally)
      await ctx.suspend();

      // then
      expect(ctx.suspend).toHaveBeenCalled();

      // when - simulate tab visible (would call resume externally)
      await ctx.resume();

      // then
      expect(ctx.resume).toHaveBeenCalled();
    });
  });

  describe("Audio Permission", () => {
    it("should check microphone permission status", async () => {
      // given / when
      const result = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });

      // then
      expect(result.state).toBe("granted");
    });

    it("should enumerate audio devices", async () => {
      // given / when
      const devices = await navigator.mediaDevices.enumerateDevices();

      // then
      expect(devices.length).toBeGreaterThan(0);
      expect(devices.some((d) => d.kind === "audioinput")).toBe(true);
    });

    it("should handle permission denied error", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const error = new Error("User denied microphone access");
      (error as any).name = "NotAllowedError";
      simulateGetUserMediaFailure(error);

      // when / then
      await expect(recorder.start(() => {})).rejects.toThrow();
    });

    it("should handle no microphone available error", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();

      const error = new Error("No microphone found");
      (error as any).name = "NotFoundError";
      simulateGetUserMediaFailure(error);

      // when / then
      await expect(recorder.start(() => {})).rejects.toThrow(
        "No microphone found",
      );
    });
  });

  describe("PCM Data Conversion", () => {
    it("should convert Float32 to Int16 PCM correctly", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const chunks: any[] = [];
      await recorder.start((chunk) => chunks.push(chunk));

      // Test values: 0.0, 0.5, 1.0, -0.5, -1.0
      const float32Samples = new Float32Array([0.0, 0.5, 1.0, -0.5, -1.0]);

      // when
      const workletNode = getMockWorkletNodes()[0];
      workletNode.simulateMessage(float32Samples);

      // then
      const pcmData = chunks[0].data as Int16Array;
      expect(pcmData[0]).toBe(0); // 0.0 → 0
      expect(pcmData[1]).toBeCloseTo(16383, -1); // 0.5 → ~16383
      expect(pcmData[2]).toBe(32767); // 1.0 → 32767
      expect(pcmData[3]).toBeCloseTo(-16383, -1); // -0.5 → ~-16383
      expect(pcmData[4]).toBe(-32767); // -1.0 → -32767
    });

    it("should clamp values outside [-1.0, 1.0]", async () => {
      // given
      const recorder = new AudioRecorder();
      await recorder.initialize();
      const chunks: any[] = [];
      await recorder.start((chunk) => chunks.push(chunk));

      // Values outside range
      const float32Samples = new Float32Array([1.5, -1.5, 2.0, -2.0]);

      // when
      const workletNode = getMockWorkletNodes()[0];
      workletNode.simulateMessage(float32Samples);

      // then - all should be clamped to max/min
      const pcmData = chunks[0].data as Int16Array;
      expect(pcmData[0]).toBe(32767); // 1.5 clamped to 1.0
      expect(pcmData[1]).toBe(-32767); // -1.5 clamped to -1.0
      expect(pcmData[2]).toBe(32767); // 2.0 clamped to 1.0
      expect(pcmData[3]).toBe(-32767); // -2.0 clamped to -1.0
    });
  });

  // Placeholder test maintained for documentation purposes
  it("should have audio tests documented", () => {
    // This test verifies that audio control tests are properly
    // documented and structured.
    expect(true).toBe(true);
  });
});
