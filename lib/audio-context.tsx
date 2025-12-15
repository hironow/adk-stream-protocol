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

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface PCMChunk {
  content: string; // base64-encoded PCM data
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

interface AudioMetadata {
  chunks: number;
  bytes: number;
  sampleRate: number;
  duration: number;
}

export interface AudioContextValue {
  // Voice channel (PCM streaming)
  voiceChannel: {
    isPlaying: boolean;
    chunkCount: number;
    sendChunk: (chunk: PCMChunk) => void;
    reset: () => void;
    onComplete: (metadata: AudioMetadata) => void;
    lastCompletion: AudioMetadata | null;
  };

  // BGM channel
  bgmChannel: {
    currentTrack: number; // 0: bgm.wav, 1: bgm2.wav
    switchTrack: () => void;
  };

  // Future: SFX channel
  // sfxChannel: { ... }

  // Global audio context state
  isReady: boolean;
  error: string | null;

  // WebSocket latency monitoring (BIDI mode only)
  wsLatency: number | null; // Round-trip time in milliseconds
  updateLatency: (latency: number) => void;
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
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [currentBgmTrack, setCurrentBgmTrack] = useState(0);
  const [lastCompletion, setLastCompletion] = useState<AudioMetadata | null>(
    null,
  );

  // Web Audio API instances
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Dual BGM system for crossfade switching
  const bgmSource1Ref = useRef<AudioBufferSourceNode | null>(null);
  const bgmGain1Ref = useRef<GainNode | null>(null);
  const bgmSource2Ref = useRef<AudioBufferSourceNode | null>(null);
  const bgmGain2Ref = useRef<GainNode | null>(null);
  const bgmBuffer1Ref = useRef<AudioBuffer | null>(null);
  const bgmBuffer2Ref = useRef<AudioBuffer | null>(null);
  const currentBgmTrackRef = useRef(0); // Track current BGM for visibility handler
  const isPlayingRef = useRef(false); // Track playing state for visibility handler

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
          "pcm-player-processor",
        );

        // Listen for playback state messages from AudioWorklet
        audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === "playback-started") {
            console.log("[AudioContext] Playback started - ducking BGM");
            if (mounted) {
              setIsPlaying(true);
              isPlayingRef.current = true;

              // Duck BGM: Fade volume down smoothly (current → 0.1 over 0.5s)
              // Duck whichever track is currently playing
              const now = audioContext.currentTime;
              if (bgmGain1Ref.current && bgmGain1Ref.current.gain.value > 0) {
                const currentGain = bgmGain1Ref.current.gain.value;
                bgmGain1Ref.current.gain.setTargetAtTime(
                  Math.min(currentGain, 0.1),
                  now,
                  0.15,
                );
              }
              if (bgmGain2Ref.current && bgmGain2Ref.current.gain.value > 0) {
                const currentGain = bgmGain2Ref.current.gain.value;
                bgmGain2Ref.current.gain.setTargetAtTime(
                  Math.min(currentGain, 0.1),
                  now,
                  0.15,
                );
              }
            }
          } else if (event.data.type === "playback-finished") {
            console.log("[AudioContext] Playback finished - restoring BGM");
            if (mounted) {
              setIsPlaying(false);
              isPlayingRef.current = false;

              // Restore BGM: Fade volume back up smoothly
              // Restore to 0.3 or maintain current crossfade state
              const now = audioContext.currentTime;
              if (bgmGain1Ref.current) {
                const currentGain = bgmGain1Ref.current.gain.value;
                // Only restore if this track was ducked (gain < 0.3)
                if (currentGain > 0 && currentGain < 0.3) {
                  bgmGain1Ref.current.gain.setTargetAtTime(0.3, now, 0.3);
                }
              }
              if (bgmGain2Ref.current) {
                const currentGain = bgmGain2Ref.current.gain.value;
                if (currentGain > 0 && currentGain < 0.3) {
                  bgmGain2Ref.current.gain.setTargetAtTime(0.3, now, 0.3);
                }
              }
            }
          }
        };

        // Connect to audio destination (speakers)
        audioWorkletNode.connect(audioContext.destination);

        // Load both BGM tracks
        console.log("[AudioContext] Loading BGM tracks...");
        const [response1, response2] = await Promise.all([
          fetch("/bgm.wav"),
          fetch("/bgm2.wav"),
        ]);
        const [arrayBuffer1, arrayBuffer2] = await Promise.all([
          response1.arrayBuffer(),
          response2.arrayBuffer(),
        ]);
        const [audioBuffer1, audioBuffer2] = await Promise.all([
          audioContext.decodeAudioData(arrayBuffer1),
          audioContext.decodeAudioData(arrayBuffer2),
        ]);

        // Store buffers for track switching
        bgmBuffer1Ref.current = audioBuffer1;
        bgmBuffer2Ref.current = audioBuffer2;

        // Create BGM Track 1 (initially playing)
        const bgmSource1 = audioContext.createBufferSource();
        bgmSource1.buffer = audioBuffer1;
        bgmSource1.loop = true;

        const bgmGain1 = audioContext.createGain();
        bgmGain1.gain.value = 0.3; // 30% volume for BGM

        // Connect: BGM1 -> Gain1 -> Destination
        bgmSource1.connect(bgmGain1);
        bgmGain1.connect(audioContext.destination);

        // Start BGM Track 1
        bgmSource1.start(0);

        // Create BGM Track 2 (silent, ready for crossfade)
        const bgmSource2 = audioContext.createBufferSource();
        bgmSource2.buffer = audioBuffer2;
        bgmSource2.loop = true;

        const bgmGain2 = audioContext.createGain();
        bgmGain2.gain.value = 0; // Start silent

        // Connect: BGM2 -> Gain2 -> Destination
        bgmSource2.connect(bgmGain2);
        bgmGain2.connect(audioContext.destination);

        // Start BGM Track 2 (playing but silent)
        bgmSource2.start(0);

        if (mounted) {
          audioWorkletNodeRef.current = audioWorkletNode;
          bgmSource1Ref.current = bgmSource1;
          bgmGain1Ref.current = bgmGain1;
          bgmSource2Ref.current = bgmSource2;
          bgmGain2Ref.current = bgmGain2;
          setIsReady(true);
          console.log(
            "[AudioContext] AudioWorklet and BGM tracks initialized successfully",
          );
        }
      } catch (err) {
        console.error("[AudioContext] Failed to initialize AudioWorklet:", err);
        if (mounted) {
          setError(
            `Failed to initialize audio: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    initAudioWorklet();

    // Add visibility change handler for BGM
    const handleVisibilityChange = () => {
      const bgmGain1 = bgmGain1Ref.current;
      const bgmGain2 = bgmGain2Ref.current;
      const audioContext = audioContextRef.current;

      if (!audioContext) return;

      if (document.hidden) {
        // Tab is inactive - fade out BGM
        console.log("[AudioContext] Tab inactive - pausing BGM");
        const now = audioContext.currentTime;

        if (bgmGain1 && bgmGain1.gain.value > 0) {
          bgmGain1.gain.setTargetAtTime(0, now, 0.1); // Fade out quickly
        }
        if (bgmGain2 && bgmGain2.gain.value > 0) {
          bgmGain2.gain.setTargetAtTime(0, now, 0.1); // Fade out quickly
        }
      } else {
        // Tab is active - restore BGM (unless ducked)
        console.log("[AudioContext] Tab active - resuming BGM");
        const now = audioContext.currentTime;

        // Check if BGM is currently ducked (audio is playing)
        const isDucked = isPlayingRef.current;
        const targetVolume = isDucked ? 0.1 : 0.3; // 10% if ducked, 30% normal

        // Restore the currently active track (use ref to get current value)
        const currentTrack = currentBgmTrackRef.current || 0;
        if (currentTrack === 0 && bgmGain1) {
          bgmGain1.gain.setTargetAtTime(targetVolume, now, 0.3);
        } else if (currentTrack === 1 && bgmGain2) {
          bgmGain2.gain.setTargetAtTime(targetVolume, now, 0.3);
        }
      }
    };

    // Add event listener
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup on unmount
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (bgmSource1Ref.current) {
        bgmSource1Ref.current.stop();
        bgmSource1Ref.current.disconnect();
        bgmSource1Ref.current = null;
      }
      if (bgmGain1Ref.current) {
        bgmGain1Ref.current.disconnect();
        bgmGain1Ref.current = null;
      }
      if (bgmSource2Ref.current) {
        bgmSource2Ref.current.stop();
        bgmSource2Ref.current.disconnect();
        bgmSource2Ref.current = null;
      }
      if (bgmGain2Ref.current) {
        bgmGain2Ref.current.disconnect();
        bgmGain2Ref.current = null;
      }
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

      // Update chunk count (isPlaying is managed by AudioWorklet notifications)
      setChunkCount((prev) => prev + 1);
    } catch (err) {
      console.error("[AudioContext] Error sending chunk:", err);
      setError(
        `Error processing audio: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const reset = () => {
    console.log("[AudioContext] Resetting voice channel");

    // Reset state first
    setIsPlaying(false);
    isPlayingRef.current = false;
    setChunkCount(0);

    // Then reset AudioWorklet buffer
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ command: "reset" });
    }
  };

  const updateLatency = (latency: number) => {
    setWsLatency(latency);
  };

  const handleAudioComplete = (metadata: AudioMetadata) => {
    setLastCompletion(metadata);
    setIsPlaying(false);
    isPlayingRef.current = false;
  };

  // BGM channel methods
  const switchTrack = () => {
    const audioContext = audioContextRef.current;
    if (!audioContext || !bgmGain1Ref.current || !bgmGain2Ref.current) {
      console.warn("[AudioContext] Cannot switch BGM - audio not ready");
      return;
    }

    const now = audioContext.currentTime;
    const fadeDuration = 0.6; // Time constant for exponential fade (~2 seconds total)

    if (currentBgmTrack === 0) {
      // Switch from Track 1 to Track 2
      console.log(
        "[AudioContext] Switching BGM: Track 1 → Track 2 (crossfade)",
      );

      // Fade out Track 1
      bgmGain1Ref.current.gain.setTargetAtTime(0, now, fadeDuration);

      // Fade in Track 2
      bgmGain2Ref.current.gain.setTargetAtTime(
        isPlaying ? 0.1 : 0.3, // Respect ducking state
        now,
        fadeDuration,
      );

      setCurrentBgmTrack(1);
      currentBgmTrackRef.current = 1;
    } else {
      // Switch from Track 2 to Track 1
      console.log(
        "[AudioContext] Switching BGM: Track 2 → Track 1 (crossfade)",
      );

      // Fade out Track 2
      bgmGain2Ref.current.gain.setTargetAtTime(0, now, fadeDuration);

      // Fade in Track 1
      bgmGain1Ref.current.gain.setTargetAtTime(
        isPlaying ? 0.1 : 0.3, // Respect ducking state
        now,
        fadeDuration,
      );

      setCurrentBgmTrack(0);
      currentBgmTrackRef.current = 0;
    }
  };

  const value: AudioContextValue = {
    voiceChannel: {
      isPlaying,
      chunkCount,
      sendChunk,
      reset,
      onComplete: handleAudioComplete,
      lastCompletion,
    },
    bgmChannel: {
      currentTrack: currentBgmTrack,
      switchTrack,
    },
    isReady,
    error,
    wsLatency,
    updateLatency,
  };

  return (
    <AudioContext.Provider value={value}>{children}</AudioContext.Provider>
  );
}
