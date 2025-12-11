/**
 * Audio Context Provider
 *
 * Manages global AudioWorklet instances for streaming audio playback.
 * Currently supports voice channel (PCM streaming from ADK BIDI mode).
 *
 * Architecture:
 * - AudioWorklet for low-latency PCM streaming
 * - Ring buffer pattern (see /public/pcm-player-processor.js)
 * - Future extensibility: BGM, SFX channels, volume mixing
 *
 * Based on ADK official implementation:
 * https://github.com/google/adk-samples/blob/main/python/agents/bidi-demo/app/static/js/app.js
 */

"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

interface PCMChunk {
  content: string; // base64-encoded PCM data
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

interface AudioContextValue {
  // Voice channel (PCM streaming)
  voiceChannel: {
    isPlaying: boolean;
    chunkCount: number;
    sendChunk: (chunk: PCMChunk) => void;
    reset: () => void;
  };

  // Future: BGM channel
  // bgmChannel: { ... }

  // Future: SFX channel
  // sfxChannel: { ... }

  // Global audio context state
  isReady: boolean;
  error: string | null;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function useAudio() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return context;
}

interface AudioProviderProps {
  children: ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);

  // Web Audio API instances
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Initialize AudioWorklet on mount
  useEffect(() => {
    let mounted = true;

    const initAudioWorklet = async () => {
      try {
        console.log("[AudioContext] Initializing AudioWorklet...");

        // Create AudioContext with 24kHz sample rate (Gemini output format)
        const audioContext = new window.AudioContext({ sampleRate: 24000 });
        audioContextRef.current = audioContext;

        // Load AudioWorklet processor module
        await audioContext.audioWorklet.addModule("/pcm-player-processor.js");

        // Create AudioWorklet node for voice channel
        const audioWorkletNode = new AudioWorkletNode(
          audioContext,
          "pcm-player-processor"
        );

        // Connect to audio destination (speakers)
        audioWorkletNode.connect(audioContext.destination);

        if (mounted) {
          audioWorkletNodeRef.current = audioWorkletNode;
          setIsReady(true);
          console.log("[AudioContext] AudioWorklet initialized successfully");
        }
      } catch (err) {
        console.error("[AudioContext] Failed to initialize AudioWorklet:", err);
        if (mounted) {
          setError(
            `Failed to initialize audio: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    };

    initAudioWorklet();

    // Cleanup on unmount
    return () => {
      mounted = false;
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Voice channel methods
  const sendChunk = (chunk: PCMChunk) => {
    const audioWorkletNode = audioWorkletNodeRef.current;
    const audioContext = audioContextRef.current;

    if (!audioWorkletNode || !audioContext) {
      console.warn("[AudioContext] AudioWorklet not ready, skipping chunk");
      return;
    }

    try {
      // Resume audio context if suspended (browser autoplay policy)
      if (audioContext.state === "suspended") {
        audioContext.resume().then(() => {
          console.log("[AudioContext] AudioContext resumed");
        });
      }

      // Decode base64 PCM data
      const binaryString = atob(chunk.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16Array (16-bit PCM)
      const int16Array = new Int16Array(bytes.buffer);

      // Send to AudioWorklet ring buffer via MessagePort
      audioWorkletNode.port.postMessage(int16Array.buffer, [int16Array.buffer]);

      // Update state
      if (!isPlaying) {
        setIsPlaying(true);
      }
      setChunkCount((prev) => prev + 1);

      console.log(`[AudioContext] Sent chunk to AudioWorklet (total: ${chunkCount + 1})`);
    } catch (err) {
      console.error("[AudioContext] Error sending chunk:", err);
      setError(
        `Error processing audio: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const reset = () => {
    console.log("[AudioContext] Resetting voice channel");

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ command: "reset" });
    }

    setIsPlaying(false);
    setChunkCount(0);
  };

  const value: AudioContextValue = {
    voiceChannel: {
      isPlaying,
      chunkCount,
      sendChunk,
      reset,
    },
    isReady,
    error,
  };

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
