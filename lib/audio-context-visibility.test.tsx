/**
 * Tests for BGM tab visibility handling
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAudio } from "./audio-context";

describe("AudioContext - Tab Visibility Handling", () => {
  let mockAudioContext: any;
  let mockGainNode: any;
  let mockBufferSource: any;

  beforeEach(() => {
    // Mock Web Audio API
    mockGainNode = {
      gain: {
        value: 0.3,
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockBufferSource = {
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockAudioContext = {
      state: "running",
      currentTime: 0,
      sampleRate: 48000,
      createGain: vi.fn(() => mockGainNode),
      createBufferSource: vi.fn(() => mockBufferSource),
      audioWorklet: {
        addModule: vi.fn().mockResolvedValue(undefined),
      },
      createBuffer: vi.fn((channels, length, sampleRate) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: vi.fn(() => new Float32Array(length)),
      })),
      decodeAudioData: vi.fn().mockResolvedValue({
        numberOfChannels: 2,
        length: 48000,
        sampleRate: 48000,
        getChannelData: vi.fn(() => new Float32Array(48000)),
      }),
      close: vi.fn(),
      destination: {},
    };

    // Mock AudioWorkletNode
    global.AudioWorkletNode = vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      port: {
        postMessage: vi.fn(),
        onmessage: null,
      },
    }));

    global.AudioContext = vi.fn().mockImplementation(() => mockAudioContext);

    // Mock fetch for BGM files
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
    });

    // Mock document.hidden
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should fade out BGM when tab becomes hidden", async () => {
    const { result } = renderHook(() => useAudio());

    // Wait for initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
    });

    // Trigger visibility change event
    const event = new Event("visibilitychange");
    document.dispatchEvent(event);

    // Check that BGM gain was faded out
    expect(mockGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      0, // Target value (fade to 0)
      expect.any(Number), // Current time
      0.1, // Fade out quickly
    );
  });

  it("should restore BGM when tab becomes visible", async () => {
    const { result } = renderHook(() => useAudio());

    // Wait for initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // First hide the tab
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Reset mock
    mockGainNode.gain.setTargetAtTime.mockClear();

    // Then show the tab again
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Check that BGM gain was restored
    expect(mockGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      0.3, // Target value (restore to 30%)
      expect.any(Number), // Current time
      0.3, // Fade in time
    );
  });

  it("should restore to ducked volume if audio is playing", async () => {
    const { result } = renderHook(() => useAudio());

    // Wait for initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Simulate audio playback (ducking active)
    const audioWorkletNode = global.AudioWorkletNode.mock.results[0].value;
    if (audioWorkletNode.port.onmessage) {
      audioWorkletNode.port.onmessage({ data: { type: "playback-started" } });
    }

    // Hide then show tab
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    mockGainNode.gain.setTargetAtTime.mockClear();

    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should restore to ducked volume (0.1) not normal (0.3)
    expect(mockGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      0.1, // Ducked volume
      expect.any(Number),
      0.3,
    );
  });

  it("should handle visibility changes for both BGM tracks", async () => {
    const { result } = renderHook(() => useAudio());

    // Wait for initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Switch to track 2
    act(() => {
      result.current.bgmChannel.switchTrack();
    });

    // Hide tab
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Both gain nodes should be faded out
    const calls = mockGainNode.gain.setTargetAtTime.mock.calls;
    const fadeOutCalls = calls.filter((call) => call[0] === 0);

    // Should have fade out calls for active track
    expect(fadeOutCalls.length).toBeGreaterThan(0);
  });

  it("should clean up visibility listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useAudio());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});