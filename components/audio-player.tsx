/**
 * Audio Player Component (AudioWorklet-based)
 *
 * Plays streaming PCM audio chunks using Web Audio API's AudioWorklet.
 * Uses ring buffer pattern to prevent playback restarts when new chunks arrive.
 *
 * Based on ADK documentation:
 * https://google.github.io/adk-docs/streaming/dev-guide/part5/#handling-audio-events-at-the-client
 *
 * Key features:
 * - Continuous streaming without restarts
 * - Ring buffer handles chunks as they arrive
 * - No concatenation or Blob URL creation
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AudioWorkletManager,
  type PCMChunk,
} from "@/lib/audio-worklet-manager";

interface AudioPlayerProps {
  chunks: PCMChunk[];
}

export function AudioPlayer({ chunks }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for manager and chunk tracking
  const managerRef = useRef<AudioWorkletManager | null>(null);
  const processedChunksCountRef = useRef(0);

  // Initialize AudioWorklet manager on first mount
  useEffect(() => {
    let mounted = true;

    const initManager = async () => {
      try {
        const manager = new AudioWorkletManager({
          sampleRate: 24000, // Gemini output format
          processorUrl: "/pcm-player-processor.js",
          processorName: "pcm-player-processor",
        });

        await manager.initialize();

        if (mounted) {
          managerRef.current = manager;
          console.log("[AudioPlayer] AudioWorklet initialized successfully");
        }
      } catch (err) {
        console.error("[AudioPlayer] Failed to initialize AudioWorklet:", err);
        if (mounted) {
          setError(
            `Failed to initialize audio: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    initManager();

    // Cleanup on unmount
    return () => {
      mounted = false;
      if (managerRef.current) {
        managerRef.current.dispose();
        managerRef.current = null;
      }
    };
  }, []);

  // Process new chunks as they arrive
  useEffect(() => {
    if (!chunks || chunks.length === 0) {
      return;
    }

    const manager = managerRef.current;
    if (!manager) {
      // Manager not ready yet
      return;
    }

    // Process only new chunks (incremental)
    const newChunks = chunks.slice(processedChunksCountRef.current);
    if (newChunks.length === 0) {
      return;
    }

    const processNewChunks = async () => {
      try {
        await manager.processChunks(newChunks);

        // Update state
        if (!isPlaying) {
          setIsPlaying(true);
        }

        // Update processed count
        processedChunksCountRef.current = chunks.length;

        console.log(
          `[AudioPlayer] Sent ${newChunks.length} new chunks to AudioWorklet (total: ${chunks.length})`,
        );
      } catch (err) {
        console.error("[AudioPlayer] Error processing chunks:", err);
        setError(
          `Error processing audio: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    processNewChunks();
  }, [chunks, isPlaying]);

  // Reset when chunks array is emptied (new turn)
  useEffect(() => {
    if (chunks.length === 0 && processedChunksCountRef.current > 0) {
      // New turn detected - reset
      processedChunksCountRef.current = 0;
      setIsPlaying(false);

      // Reset AudioWorklet buffer
      if (managerRef.current) {
        managerRef.current.reset();
      }
    }
  }, [chunks.length]);

  if (!chunks || chunks.length === 0) return null;

  return (
    <div
      style={{
        margin: "0.75rem 0",
        padding: "0.75rem",
        borderRadius: "6px",
        background: "#0a0a0a",
        border: "1px solid #6366f1",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          color: "#818cf8",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: isPlaying ? "#10b981" : "#6b7280",
          }}
        />
        <span style={{ fontWeight: 600 }}>
          {isPlaying ? "🔊 Playing Audio" : "🔇 Audio Ready"}
        </span>
        <span style={{ fontSize: "0.875rem", color: "#999" }}>
          ({chunks.length} chunks)
        </span>
      </div>

      {error && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            borderRadius: "4px",
            background: "#1a0a0a",
            color: "#fca5a5",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "#6b7280",
        }}
      >
        AudioWorklet streaming (24kHz, 16-bit PCM)
      </div>
    </div>
  );
}
