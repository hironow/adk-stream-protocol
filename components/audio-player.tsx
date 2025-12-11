/**
 * Audio Player Component with Web Audio API
 *
 * Handles PCM audio chunks streamed from backend using Web Audio API
 * - Decodes raw PCM data directly (no WAV conversion needed)
 * - Concatenates multiple chunks into seamless playback
 * - Auto-plays as chunks arrive during streaming
 */

"use client";

import { useEffect, useRef, useState } from "react";

interface PCMChunk {
  content: string; // Base64-encoded PCM data
  sampleRate: number; // e.g., 24000
  channels: number; // 1 = mono, 2 = stereo
  bitDepth: number; // 16 = 16-bit PCM
}

interface AudioPlayerProps {
  chunks: PCMChunk[]; // Array of PCM chunks to play
}

export function AudioPlayer({ chunks }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!chunks || chunks.length === 0) return;

    let currentUrl: string | null = null;

    const concatenatePCMToWAV = () => {
      try {
        if (chunks.length === 0) return;

        const firstChunk = chunks[0];
        const sampleRate = firstChunk.sampleRate;
        const channels = firstChunk.channels;
        const bitDepth = firstChunk.bitDepth;

        // Decode all PCM chunks from base64
        const pcmBuffers = chunks.map((chunk) => {
          const binaryString = atob(chunk.content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes;
        });

        // Calculate total PCM size
        const totalPCMSize = pcmBuffers.reduce((sum, buf) => sum + buf.length, 0);

        // Concatenate all PCM data
        const combinedPCM = new Uint8Array(totalPCMSize);
        let offset = 0;
        for (const buf of pcmBuffers) {
          combinedPCM.set(buf, offset);
          offset += buf.length;
        }

        // Create WAV header (44 bytes)
        const wavHeader = new Uint8Array(44);

        // Helper to write ASCII string
        const writeString = (offset: number, str: string) => {
          for (let i = 0; i < str.length; i++) {
            wavHeader[offset + i] = str.charCodeAt(i);
          }
        };

        // Helper to write 32-bit little-endian integer
        const writeUint32 = (offset: number, value: number) => {
          wavHeader[offset] = value & 0xff;
          wavHeader[offset + 1] = (value >> 8) & 0xff;
          wavHeader[offset + 2] = (value >> 16) & 0xff;
          wavHeader[offset + 3] = (value >> 24) & 0xff;
        };

        // Helper to write 16-bit little-endian integer
        const writeUint16 = (offset: number, value: number) => {
          wavHeader[offset] = value & 0xff;
          wavHeader[offset + 1] = (value >> 8) & 0xff;
        };

        // RIFF chunk descriptor
        writeString(0, "RIFF");
        writeUint32(4, 36 + totalPCMSize); // File size - 8
        writeString(8, "WAVE");

        // fmt sub-chunk
        writeString(12, "fmt ");
        writeUint32(16, 16); // Subchunk1Size (16 for PCM)
        writeUint16(20, 1); // AudioFormat (1 = PCM)
        writeUint16(22, channels); // NumChannels
        writeUint32(24, sampleRate); // SampleRate
        writeUint32(28, (sampleRate * channels * bitDepth) / 8); // ByteRate
        writeUint16(32, (channels * bitDepth) / 8); // BlockAlign
        writeUint16(34, bitDepth); // BitsPerSample

        // data sub-chunk
        writeString(36, "data");
        writeUint32(40, totalPCMSize); // Subchunk2Size

        // Combine header and PCM data
        const wavFile = new Uint8Array(44 + totalPCMSize);
        wavFile.set(wavHeader, 0);
        wavFile.set(combinedPCM, 44);

        // Create Blob and URL
        const blob = new Blob([wavFile], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        currentUrl = url;

        setAudioUrl(url);

        const duration = totalPCMSize / sampleRate / (bitDepth / 8) / channels;
        console.log(
          `[AudioPlayer] Created WAV from ${chunks.length} PCM chunks: ` +
            `${totalPCMSize} bytes PCM, ${duration.toFixed(2)}s @ ${sampleRate}Hz`
        );
      } catch (error) {
        console.error("[AudioPlayer] Failed to create WAV from PCM chunks:", error);
      }
    };

    concatenatePCMToWAV();

    // Cleanup
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [chunks.length]); // Re-run when chunk count changes

  useEffect(() => {
    // Auto-play when audio URL is ready
    if (audioRef.current && audioUrl && !isPlaying) {
      audioRef.current.load();
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          console.log("[AudioPlayer] Started playing audio");
        })
        .catch((error) => {
          console.error("[AudioPlayer] Auto-play failed:", error);
        });
    }
  }, [audioUrl]);

  const handleEnded = () => {
    setIsPlaying(false);
    console.log("[AudioPlayer] Finished playing audio");
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  if (!chunks || chunks.length === 0) return null;

  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: "8px",
        background: "#0a0a0a",
        border: "1px solid #374151",
        marginTop: "0.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
          fontSize: "0.875rem",
          color: "#9ca3af",
        }}
      >
        <span>🔊</span>
        <span>
          Audio Response (PCM {chunks[0].sampleRate}Hz)
          {chunks.length > 1 && ` - ${chunks.length} chunks`}
        </span>
      </div>
      {audioUrl && (
        <audio
          ref={audioRef}
          controls
          onEnded={handleEnded}
          onPause={handlePause}
          onPlay={handlePlay}
          style={{
            width: "100%",
            height: "40px",
          }}
        >
          <source src={audioUrl} type="audio/wav" />
          Your browser does not support the audio element.
        </audio>
      )}
    </div>
  );
}
