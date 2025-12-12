/**
 * Audio Recorder Hook for React
 *
 * Custom hook for managing AudioWorklet-based PCM recording with proper
 * lifecycle management and cleanup.
 *
 * Architecture:
 * - useRef for AudioRecorder instance (prevents recreation on re-render)
 * - useEffect for component unmount cleanup
 * - useCallback for stable function references
 * - Automatic cleanup of AudioContext, MediaStream, and AudioWorklet
 *
 * Best Practices Applied:
 * - MDN: Single AudioContext reuse (within recording sessions)
 * - React: Proper cleanup in useEffect return function
 * - Web Audio API: Disconnect nodes before closing context
 * - AudioWorklet: Stop media tracks to release microphone
 *
 * Based on investigation of:
 * - github.com/jayblack388/use-audio-hooks
 * - github.com/lanesky/audio-recorder-js
 * - MDN Web Audio API Best Practices
 * - React Flow Web Audio Tutorial
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioChunk } from "@/lib/audio-recorder";
import type { BackendMode } from "@/lib/build-use-chat-options";

interface UseAudioRecorderOptions {
  mode: BackendMode;
  onChunk?: (chunk: AudioChunk) => void;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  startRecording: (onChunk: (chunk: AudioChunk) => void) => Promise<void>;
  stopRecording: () => Promise<void>;
  error: string | null;
}

/**
 * Hook for managing audio recording with AudioWorklet
 *
 * @param options - Configuration options
 * @returns Recording state and control methods
 *
 * @example
 * ```typescript
 * const { isRecording, startRecording, stopRecording } = useAudioRecorder({
 *   mode: "adk-bidi",
 * });
 *
 * // Start recording
 * await startRecording((chunk) => {
 *   transport.sendAudioChunk(chunk);
 * });
 *
 * // Stop recording
 * await stopRecording();
 * ```
 */
export function useAudioRecorder({
  mode,
}: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to hold AudioRecorder instance (survives re-renders)
  const recorderRef = useRef<
    import("@/lib/audio-recorder").AudioRecorder | null
  >(null);

  /**
   * Start recording from microphone
   *
   * Creates AudioRecorder instance, initializes AudioWorklet,
   * and starts capturing audio chunks.
   */
  const startRecording = useCallback(
    async (onChunk: (chunk: AudioChunk) => void) => {
      // Only available in BIDI mode
      if (mode !== "adk-bidi") {
        console.warn(
          "[useAudioRecorder] Recording only available in BIDI mode",
        );
        return;
      }

      // Prevent starting if already recording
      if (isRecording) {
        console.warn("[useAudioRecorder] Already recording");
        return;
      }

      try {
        console.log("[useAudioRecorder] Starting recording...");

        // Lazy load AudioRecorder (client-side only)
        const { AudioRecorder } = await import("@/lib/audio-recorder");

        // Create and initialize recorder
        const recorder = new AudioRecorder();
        await recorder.initialize();
        recorderRef.current = recorder;

        // Start recording with chunk callback
        await recorder.start(onChunk);

        setIsRecording(true);
        setError(null);
        console.log(
          `[useAudioRecorder] Recording started (${recorder.sampleRate}Hz)`,
        );
      } catch (err) {
        console.error("[useAudioRecorder] Failed to start recording:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError(`Failed to start recording: ${errorMessage}`);

        // Cleanup on error
        if (recorderRef.current) {
          await recorderRef.current.close();
          recorderRef.current = null;
        }
      }
    },
    [mode, isRecording],
  );

  /**
   * Stop recording and cleanup resources
   *
   * Properly closes AudioContext, stops MediaStream tracks,
   * and disconnects AudioWorklet node.
   */
  const stopRecording = useCallback(async () => {
    if (!recorderRef.current || !isRecording) {
      console.warn("[useAudioRecorder] Not recording");
      return;
    }

    try {
      console.log("[useAudioRecorder] Stopping recording...");

      // Close recorder (calls stop() internally + closes AudioContext)
      await recorderRef.current.close();
      recorderRef.current = null;

      setIsRecording(false);
      console.log("[useAudioRecorder] Recording stopped");
    } catch (err) {
      console.error("[useAudioRecorder] Failed to stop recording:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to stop recording: ${errorMessage}`);
    }
  }, [isRecording]);

  /**
   * Cleanup on component unmount
   *
   * Best Practice: Always cleanup audio resources when component unmounts
   * to prevent memory leaks and release microphone access.
   */
  useEffect(() => {
    return () => {
      // Component unmounting - cleanup if still recording
      if (recorderRef.current) {
        console.log(
          "[useAudioRecorder] Component unmounting - cleaning up recorder",
        );
        recorderRef.current.close();
        recorderRef.current = null;
      }
    };
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
  };
}
