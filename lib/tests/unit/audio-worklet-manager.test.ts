/**
 * AudioWorklet Manager Unit Tests
 *
 * Tests audio worklet initialization, chunk processing, and cleanup.
 * Uses mocks to avoid browser-specific AudioContext dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AudioWorkletManager,
  type PCMChunk,
} from "@/lib/audio-worklet-manager";

// Mock AudioContext and AudioWorkletNode
class MockAudioContext {
  sampleRate: number;
  destination = {};
  state: AudioContextState = "running";

  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  constructor(options?: { sampleRate: number }) {
    this.sampleRate = options?.sampleRate ?? 48000;
  }

  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

class MockAudioWorkletNode {
  connect = vi.fn();
  disconnect = vi.fn();
  port = {
    postMessage: vi.fn(),
  };

  constructor(
    _context: AudioContext,
    _processorName: string
  ) {}
}

describe("AudioWorkletManager", () => {
  let mockAudioContext: MockAudioContext;
  let mockAudioWorkletNode: MockAudioWorkletNode;

  beforeEach(() => {
    // Setup mocks
    mockAudioContext = new MockAudioContext();
    mockAudioWorkletNode = new MockAudioWorkletNode(
      mockAudioContext as unknown as AudioContext,
      "test-processor"
    );

    // Mock global constructors using function syntax for proper 'this' binding
    global.AudioContext = vi.fn(function (this: any, options?: any) {
      return mockAudioContext;
    }) as any;

    global.AudioWorkletNode = vi.fn(function (
      this: any,
      context: any,
      name: string
    ) {
      return mockAudioWorkletNode;
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with correct sample rate", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test-processor.js",
        processorName: "test-processor",
      });

      await manager.initialize();

      expect(global.AudioContext).toHaveBeenCalledWith({ sampleRate: 24000 });
    });

    it("should load AudioWorklet processor module", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/pcm-player.js",
        processorName: "pcm-player",
      });

      await manager.initialize();

      expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledWith(
        "/pcm-player.js"
      );
    });

    it("should create and connect AudioWorkletNode", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test-processor",
      });

      await manager.initialize();

      expect(global.AudioWorkletNode).toHaveBeenCalledWith(
        mockAudioContext,
        "test-processor"
      );
      expect(mockAudioWorkletNode.connect).toHaveBeenCalledWith(
        mockAudioContext.destination
      );
    });

    it("should handle initialization errors", async () => {
      mockAudioContext.audioWorklet.addModule = vi
        .fn()
        .mockRejectedValue(new Error("Failed to load"));

      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await expect(manager.initialize()).rejects.toThrow(
        "Failed to initialize AudioWorklet"
      );
    });

    it("should not re-initialize if already initialized", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();
      await manager.initialize(); // Second call

      // addModule should only be called once
      expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    });
  });

  describe("Chunk Processing", () => {
    it("should decode and send PCM chunks", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();

      const chunks: PCMChunk[] = [
        {
          content: btoa("\x00\x01\x02\x03"), // base64-encoded test data
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      await manager.processChunks(chunks);

      expect(mockAudioWorkletNode.port.postMessage).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        [expect.any(ArrayBuffer)]
      );
    });

    it("should process multiple chunks", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();

      const chunks: PCMChunk[] = [
        {
          content: btoa("\x00\x01"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
        {
          content: btoa("\x02\x03"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      await manager.processChunks(chunks);

      expect(mockAudioWorkletNode.port.postMessage).toHaveBeenCalledTimes(2);
    });

    it("should resume suspended AudioContext", async () => {
      mockAudioContext.state = "suspended";

      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();

      const chunks: PCMChunk[] = [
        {
          content: btoa("\x00\x01"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      await manager.processChunks(chunks);

      expect(mockAudioContext.resume).toHaveBeenCalled();
    });

    it("should throw error if not initialized", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      const chunks: PCMChunk[] = [
        {
          content: btoa("\x00\x01"),
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      await expect(manager.processChunks(chunks)).rejects.toThrow(
        "AudioWorklet not initialized"
      );
    });
  });

  describe("Reset", () => {
    it("should send reset command to AudioWorklet", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();
      manager.reset();

      expect(mockAudioWorkletNode.port.postMessage).toHaveBeenCalledWith({
        command: "reset",
      });
    });

    it("should not throw if called before initialization", () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      expect(() => manager.reset()).not.toThrow();
    });
  });

  describe("State", () => {
    it("should return AudioContext state", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      expect(manager.getState()).toBeNull();

      await manager.initialize();

      expect(manager.getState()).toBe("running");
    });
  });

  describe("Cleanup", () => {
    it("should disconnect AudioWorkletNode on dispose", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();
      manager.dispose();

      expect(mockAudioWorkletNode.disconnect).toHaveBeenCalled();
    });

    it("should close AudioContext on dispose", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();
      manager.dispose();

      expect(mockAudioContext.close).toHaveBeenCalled();
    });

    it("should allow re-initialization after dispose", async () => {
      const manager = new AudioWorkletManager({
        sampleRate: 24000,
        processorUrl: "/test.js",
        processorName: "test",
      });

      await manager.initialize();
      manager.dispose();

      // Should be able to initialize again
      await manager.initialize();

      expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    });
  });
});
