/**
 * Unit tests for AudioContext Provider
 *
 * Tests React Context provider for managing AudioWorklet-based playback,
 * BGM channel mixing, and voice channel PCM streaming.
 *
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioProvider, useAudio } from "../../audio-context";
import { server } from "../mocks/server";

// Mock Web Audio API
class MockAudioContext {
  sampleRate = 24000;
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
  createGain = vi.fn(() => new MockGainNode());
  decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer());
  resume = vi.fn().mockResolvedValue(undefined);
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

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;

  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode {
  gain = {
    value: 0,
    setTargetAtTime: vi.fn(),
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioBuffer {
  sampleRate = 24000;
  length = 48000;
  duration = 2;
  numberOfChannels = 2;
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
  ) {
    return new MockAudioWorkletNode();
  }) as any;

  // Start MSW server for BGM loading
  server.listen({ onUnhandledRequest: "error" });

  // Mock atob for base64 decoding
  global.atob = vi.fn((_str: string) => {
    // Simple mock that returns 4 bytes (2 int16 samples)
    return "\x00\x01\x02\x03";
  });
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => {
  server.close();
});

describe("AudioProvider", () => {
  describe("Initialization", () => {
    it("should initialize AudioContext with 24kHz sample rate", async () => {
      renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(global.AudioContext).toHaveBeenCalledWith({ sampleRate: 24000 });
      });
    });

    it("should load AudioWorklet processor module", async () => {
      renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        const mockContext = (global.AudioContext as any).mock.results[0].value;
        expect(mockContext.audioWorklet.addModule).toHaveBeenCalledWith(
          "/pcm-player-processor.js",
        );
      });
    });

    it("should load both BGM tracks", async () => {
      // MSW will handle the fetch requests for /bgm.wav and /bgm2.wav
      // This test verifies that the AudioProvider successfully loads both tracks
      // by checking that isReady becomes true after initialization
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      // If BGM tracks load successfully, isReady should be true
      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });
    });

    it("should set isReady to true after successful initialization", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });
    });

    it("should handle initialization errors gracefully", async () => {
      // Mock addModule to fail
      const mockContext = new MockAudioContext();
      mockContext.audioWorklet.addModule = vi
        .fn()
        .mockRejectedValue(new Error("Failed to load AudioWorklet module"));

      global.AudioContext = vi.fn(function (this: any, _options: any) {
        return mockContext;
      }) as any;

      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.error).toContain(
          "Failed to load AudioWorklet module",
        );
        expect(result.current.isReady).toBe(false);
      });
    });
  });

  describe("useAudio hook", () => {
    it("should throw error when used outside AudioProvider", () => {
      expect(() => {
        renderHook(() => useAudio());
      }).toThrow("useAudio must be used within AudioProvider");
    });

    it("should return context value when used within AudioProvider", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
        expect(result.current.voiceChannel).toBeDefined();
        expect(result.current.bgmChannel).toBeDefined();
      });
    });
  });

  describe("Voice Channel", () => {
    it("should have initial state with isPlaying false and chunkCount 0", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.voiceChannel.isPlaying).toBe(false);
        expect(result.current.voiceChannel.chunkCount).toBe(0);
      });
    });

    it("should send PCM chunk to AudioWorklet", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Send a chunk
      result.current.voiceChannel.sendChunk({
        content: "AQIDBA==", // base64-encoded PCM
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      });

      await waitFor(() => {
        expect(result.current.voiceChannel.chunkCount).toBe(1);
      });

      // Verify postMessage was called
      const mockWorkletNode = (global.AudioWorkletNode as any).mock.results[0]
        .value;
      expect(mockWorkletNode.port.postMessage).toHaveBeenCalled();
    });

    it("should increment chunkCount for each chunk sent", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const chunk = {
        content: "AQIDBA==",
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      };

      // Send 3 chunks
      result.current.voiceChannel.sendChunk(chunk);
      result.current.voiceChannel.sendChunk(chunk);
      result.current.voiceChannel.sendChunk(chunk);

      await waitFor(() => {
        expect(result.current.voiceChannel.chunkCount).toBe(3);
      });
    });

    it("should reset voice channel state", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Send chunks
      const chunk = {
        content: "AQIDBA==",
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      };
      result.current.voiceChannel.sendChunk(chunk);

      await waitFor(() => {
        expect(result.current.voiceChannel.chunkCount).toBe(1);
      });

      // Reset
      result.current.voiceChannel.reset();

      await waitFor(() => {
        expect(result.current.voiceChannel.isPlaying).toBe(false);
        expect(result.current.voiceChannel.chunkCount).toBe(0);
      });
    });

    it("should send reset command to AudioWorklet on reset", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const mockWorkletNode = (global.AudioWorkletNode as any).mock.results[0]
        .value;
      vi.clearAllMocks();

      // Reset
      result.current.voiceChannel.reset();

      expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
        command: "reset",
      });
    });

    it("should handle AudioWorklet playback-started message", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Simulate playback-started message from AudioWorklet
      const mockWorkletNode = (global.AudioWorkletNode as any).mock.results[0]
        .value;
      mockWorkletNode.port.onmessage?.(
        new MessageEvent("message", {
          data: { type: "playback-started" },
        }),
      );

      await waitFor(() => {
        expect(result.current.voiceChannel.isPlaying).toBe(true);
      });
    });

    it("should handle AudioWorklet playback-finished message", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const mockWorkletNode = (global.AudioWorkletNode as any).mock.results[0]
        .value;

      // Start playback
      mockWorkletNode.port.onmessage?.(
        new MessageEvent("message", {
          data: { type: "playback-started" },
        }),
      );

      await waitFor(() => {
        expect(result.current.voiceChannel.isPlaying).toBe(true);
      });

      // Finish playback
      mockWorkletNode.port.onmessage?.(
        new MessageEvent("message", {
          data: { type: "playback-finished" },
        }),
      );

      await waitFor(() => {
        expect(result.current.voiceChannel.isPlaying).toBe(false);
      });
    });

    it("should handle onComplete callback", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const metadata = {
        chunks: 10,
        bytes: 4096,
        sampleRate: 24000,
        duration: 1.5,
      };

      result.current.voiceChannel.onComplete(metadata);

      await waitFor(() => {
        expect(result.current.voiceChannel.lastCompletion).toEqual(metadata);
        expect(result.current.voiceChannel.isPlaying).toBe(false);
      });
    });
  });

  describe("BGM Channel", () => {
    it("should start with track 0", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.bgmChannel.currentTrack).toBe(0);
      });
    });

    it("should switch from track 0 to track 1", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      result.current.bgmChannel.switchTrack();

      await waitFor(() => {
        expect(result.current.bgmChannel.currentTrack).toBe(1);
      });
    });

    it("should switch from track 1 back to track 0", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Switch to track 1
      result.current.bgmChannel.switchTrack();

      await waitFor(() => {
        expect(result.current.bgmChannel.currentTrack).toBe(1);
      });

      // Switch back to track 0
      result.current.bgmChannel.switchTrack();

      await waitFor(() => {
        expect(result.current.bgmChannel.currentTrack).toBe(0);
      });
    });

    it("should apply crossfade when switching tracks", async () => {
      const { result } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const mockGain1 = (global.AudioContext as any).mock.results[0].value
        .createGain.mock.results[0].value;
      const mockGain2 = (global.AudioContext as any).mock.results[0].value
        .createGain.mock.results[1].value;

      result.current.bgmChannel.switchTrack();

      // Verify setTargetAtTime was called for crossfade
      expect(mockGain1.gain.setTargetAtTime).toHaveBeenCalled();
      expect(mockGain2.gain.setTargetAtTime).toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("should cleanup audio resources on unmount", async () => {
      const { unmount } = renderHook(() => useAudio(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AudioProvider>{children}</AudioProvider>
        ),
      });

      await waitFor(() => {
        const mockContext = (global.AudioContext as any).mock.results[0].value;
        expect(mockContext.audioWorklet.addModule).toHaveBeenCalled();
      });

      const mockContext = (global.AudioContext as any).mock.results[0].value;
      const mockWorkletNode = (global.AudioWorkletNode as any).mock.results[0]
        .value;
      const mockSource1 = mockContext.createBufferSource.mock.results[0].value;
      const mockSource2 = mockContext.createBufferSource.mock.results[1].value;

      unmount();

      // Verify cleanup
      expect(mockSource1.stop).toHaveBeenCalled();
      expect(mockSource1.disconnect).toHaveBeenCalled();
      expect(mockSource2.stop).toHaveBeenCalled();
      expect(mockSource2.disconnect).toHaveBeenCalled();
      expect(mockWorkletNode.disconnect).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
    });
  });
});
