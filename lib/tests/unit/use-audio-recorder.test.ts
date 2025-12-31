/**
 * Unit tests for useAudioRecorder hook
 *
 * Tests React hook for managing AudioWorklet-based recording
 * with proper lifecycle management and cleanup.
 *
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioChunk } from "../../audio-recorder";
import { useAudioRecorder } from "../../use-audio-recorder";
import type { Mode } from "../../utils";

// Mock AudioRecorder class
let mockAudioRecorder: {
  initialize: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isRecording: boolean;
  sampleRate: number;
};

// Mock the dynamic import of AudioRecorder
vi.mock("@/lib/audio-recorder", () => ({
  AudioRecorder: vi.fn(function (this: any) {
    return mockAudioRecorder;
  }),
}));

beforeEach(() => {
  // Reset mock before each test
  mockAudioRecorder = {
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    isRecording: false,
    sampleRate: 16000,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAudioRecorder", () => {
  describe("Hook initialization", () => {
    it("should return initial state with isRecording false", () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it("should provide startRecording function", () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      expect(result.current.startRecording).toBeInstanceOf(Function);
    });

    it("should provide stopRecording function", () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      expect(result.current.stopRecording).toBeInstanceOf(Function);
    });
  });

  describe("startRecording() - BIDI mode", () => {
    it("should create and initialize AudioRecorder", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(mockAudioRecorder.initialize).toHaveBeenCalled();
      });
    });

    it("should call recorder.start with onChunk callback", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(mockAudioRecorder.start).toHaveBeenCalledWith(onChunk);
      });
    });

    it("should set isRecording to true", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });
    });

    it("should clear error state on successful start", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.error).toBe(null);
      });
    });
  });

  describe("startRecording() - Non-BIDI mode", () => {
    it.each<Mode>([
      "gemini",
      "adk-sse",
    ])("should not start recording in %s mode", async (mode) => {
      const { result } = renderHook(() => useAudioRecorder({ mode }));

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      // Verify that recording was not started
      expect(mockAudioRecorder.initialize).not.toHaveBeenCalled();
      expect(mockAudioRecorder.start).not.toHaveBeenCalled();
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe("startRecording() - Already recording", () => {
    it("should not start recording again if already recording", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();

      // Start recording first time
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });

      // Reset mock call counts
      vi.clearAllMocks();

      // Try to start again
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      // Verify that initialize/start were not called again
      expect(mockAudioRecorder.initialize).not.toHaveBeenCalled();
      expect(mockAudioRecorder.start).not.toHaveBeenCalled();
    });
  });

  describe("startRecording() - Error handling", () => {
    it("should set error state on initialization failure", async () => {
      mockAudioRecorder.initialize.mockRejectedValueOnce(
        new Error("Initialization failed"),
      );

      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.error).toContain("Initialization failed");
      });
    });

    it("should set error state on start failure", async () => {
      mockAudioRecorder.start.mockRejectedValueOnce(
        new Error("Microphone permission denied"),
      );

      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.error).toContain("Microphone permission denied");
      });
    });

    it("should call close() on error to cleanup", async () => {
      mockAudioRecorder.start.mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(mockAudioRecorder.close).toHaveBeenCalled();
      });
    });

    it("should keep isRecording false on error", async () => {
      mockAudioRecorder.initialize.mockRejectedValueOnce(
        new Error("Init failed"),
      );

      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(false);
      });
    });
  });

  describe("stopRecording()", () => {
    it("should call recorder.close()", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Start recording first
      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });

      // Reset mock
      vi.clearAllMocks();

      // Stop recording
      await act(async () => {
        await result.current.stopRecording();
      });

      await waitFor(() => {
        expect(mockAudioRecorder.close).toHaveBeenCalled();
      });
    });

    it("should set isRecording to false", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Start recording
      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });

      // Stop recording
      await act(async () => {
        await result.current.stopRecording();
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(false);
      });
    });

    it("should do nothing if not recording", async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      await act(async () => {
        await result.current.stopRecording();
      });

      // Verify that close was not called since there's no recorder
      expect(mockAudioRecorder.close).not.toHaveBeenCalled();
      expect(result.current.isRecording).toBe(false);
    });

    it("should handle close() error gracefully", async () => {
      mockAudioRecorder.close.mockRejectedValueOnce(new Error("Close failed"));

      const { result } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Start recording
      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });

      // Stop recording
      await act(async () => {
        await result.current.stopRecording();
      });

      await waitFor(() => {
        expect(result.current.error).toContain("Close failed");
      });
    });
  });

  describe("Cleanup on unmount", () => {
    it("should call recorder.close() when component unmounts", async () => {
      const { result, unmount } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Start recording
      const onChunk = vi.fn();
      await act(async () => {
        await result.current.startRecording(onChunk);
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
      });

      // Reset mock
      vi.clearAllMocks();

      // Unmount component
      unmount();

      expect(mockAudioRecorder.close).toHaveBeenCalled();
    });

    it("should not throw if not recording on unmount", () => {
      const { unmount } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe("Lifecycle: start → stop → cleanup", () => {
    it("should complete full lifecycle without errors", async () => {
      const { result, unmount } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      // Initial state
      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toBe(null);

      // Start recording
      const chunks: AudioChunk[] = [];
      await act(async () => {
        await result.current.startRecording((chunk) => chunks.push(chunk));
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(true);
        expect(mockAudioRecorder.initialize).toHaveBeenCalled();
        expect(mockAudioRecorder.start).toHaveBeenCalled();
      });

      // Stop recording
      await act(async () => {
        await result.current.stopRecording();
      });

      await waitFor(() => {
        expect(result.current.isRecording).toBe(false);
        expect(mockAudioRecorder.close).toHaveBeenCalled();
      });

      // Unmount (cleanup)
      unmount();

      // close() should have been called at least once (from stopRecording)
      expect(mockAudioRecorder.close).toHaveBeenCalled();
    });
  });

  describe("Function stability", () => {
    it("should maintain stable function references", () => {
      const { result, rerender } = renderHook(() =>
        useAudioRecorder({ mode: "adk-bidi" }),
      );

      const initialStart = result.current.startRecording;
      const initialStop = result.current.stopRecording;

      // Re-render
      rerender();

      // Functions should be the same references (due to useCallback)
      expect(result.current.startRecording).toBe(initialStart);
      expect(result.current.stopRecording).toBe(initialStop);
    });

    it("should update functions when dependencies change", () => {
      const { result, rerender } = renderHook(
        ({ mode }) => useAudioRecorder({ mode }),
        {
          initialProps: { mode: "adk-bidi" as Mode },
        },
      );

      const initialStart = result.current.startRecording;

      // Change mode (dependency)
      rerender({ mode: "gemini" as Mode });

      // Function reference should update (dependency changed)
      expect(result.current.startRecording).not.toBe(initialStart);
    });
  });
});
