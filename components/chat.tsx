"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageComponent } from "@/components/message";
import { useAudio } from "@/lib/audio-context";
import {
  type BackendMode,
  buildUseChatOptions,
} from "@/lib/build-use-chat-options";
import { useAudioRecorder } from "@/lib/use-audio-recorder";

interface ChatProps {
  mode: BackendMode;
}

export function Chat({ mode }: ChatProps) {
  const audioContext = useAudio();

  const { useChatOptions, transport } = buildUseChatOptions({
    mode,
    initialMessages: [],
    audioContext,
  });

  const { messages, sendMessage, status, error } = useChat(useChatOptions);

  // Keep transport reference for imperative control (P2-T2 Phase 2)
  const transportRef = useRef(transport);

  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);

  // Phase 3: Audio recording with custom hook (BIDI mode only)
  const { isRecording, startRecording, stopRecording } = useAudioRecorder({
    mode,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Phase 3: Audio recording handlers
  // Using useAudioRecorder hook for proper lifecycle management
  const handleStartRecording = useCallback(async () => {
    console.log("[Chat] Starting audio recording...");

    // Start recording with chunk callback
    await startRecording((chunk) => {
      // Convert Int16Array to base64
      const uint8Array = new Uint8Array(chunk.data.buffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));

      // Send PCM chunk to backend
      transportRef.current?.sendAudioChunk({
        content: base64,
        sampleRate: chunk.sampleRate, // 16kHz from AudioRecorder
        channels: chunk.channels, // 1 (mono)
        bitDepth: chunk.bitDepth, // 16-bit
      });
    });

    // Notify transport that audio streaming has started
    transportRef.current?.startAudio();
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    console.log("[Chat] Stopping audio recording...");

    // Stop recording (cleanup handled by hook)
    await stopRecording();

    // Notify transport that audio streaming has stopped
    transportRef.current?.stopAudio();
  }, [stopRecording]);

  // Phase 3: CMD key push-to-talk (BIDI mode only)
  useEffect(() => {
    if (mode !== "adk-bidi") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD key (Meta) pressed - start recording
      if (e.metaKey && !isRecording) {
        e.preventDefault();
        console.log("[Chat] CMD key pressed - starting recording");
        handleStartRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // CMD key released - stop recording and auto-send
      if (e.key === "Meta" && isRecording) {
        e.preventDefault();
        console.log("[Chat] CMD key released - stopping recording");
        handleStopRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, isRecording, handleStartRecording, handleStopRecording]);

  // Phase 2: ESC key interruption support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLoading) {
        console.log("[Chat] ESC pressed - interrupting AI response");
        transportRef.current?.interrupt("user_abort");
        setInterrupted(true);
        // Reset interrupted state after 2 seconds
        setTimeout(() => setInterrupted(false), 2000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() && !selectedFile) return;

    if (selectedFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        sendMessage({
          text: input.trim() || " ",
          files: [
            {
              type: "file",
              filename: selectedFile.name,
              mediaType: selectedFile.type,
              url: dataUrl,
            },
          ],
        });
        setInput("");
        setSelectedFile(null);
        setPreviewUrl(null);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      sendMessage({ text: input });
      setInput("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* BGM Switch Button (upper left) */}
      <button
        onClick={() => audioContext.bgmChannel.switchTrack()}
        style={{
          position: "fixed",
          top: "1rem",
          left: "1rem",
          padding: "0.5rem 1rem",
          background: "#1a1a1a",
          border: "1px solid #333",
          borderRadius: "6px",
          fontSize: "0.875rem",
          fontWeight: 600,
          color: "#fff",
          cursor: "pointer",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span>🎵</span>
        <span>BGM {audioContext.bgmChannel.currentTrack + 1}</span>
      </button>

      {/* Recording Indicator (Phase 3, BIDI mode only) */}
      {mode === "adk-bidi" && isRecording && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            padding: "0.75rem 1rem",
            background: "#dc2626",
            border: "1px solid #991b1b",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#fff",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#fff",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
          <span>🎤 Recording...</span>
          <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
            (Release CMD to send)
          </span>
        </div>
      )}

      {/* Interrupt Indicator (Phase 2) */}
      {interrupted && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            padding: "0.75rem 1rem",
            background: "#dc2626",
            border: "1px solid #991b1b",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#fff",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            animation: "fadeIn 0.2s ease-in",
          }}
        >
          <span>⏹️</span>
          <span>Interrupted</span>
        </div>
      )}

      {/* WebSocket Latency Indicator (BIDI mode only) */}
      {mode === "adk-bidi" && audioContext.wsLatency !== null && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "0.5rem 1rem",
            background: audioContext.wsLatency >= 100 ? "#dc2626" : "#0a0a0a",
            border: `1px solid ${audioContext.wsLatency >= 100 ? "#991b1b" : "#10b981"}`,
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: audioContext.wsLatency >= 100 ? "#fca5a5" : "#10b981",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: audioContext.wsLatency >= 100 ? "#ef4444" : "#10b981",
            }}
          />
          <span>
            WS:{" "}
            {audioContext.wsLatency < 1000
              ? `${audioContext.wsLatency}ms`
              : `${(audioContext.wsLatency / 1000).toFixed(2)}s`}
          </span>
        </div>
      )}

      {/* Audio Completion Indicator (BIDI mode only) */}
      {mode === "adk-bidi" && audioContext.voiceChannel.lastCompletion && (
        <div
          style={{
            position: "fixed",
            bottom: "1rem",
            right: "1rem",
            padding: "0.5rem 1rem",
            background: "#0a0a0a",
            border: "1px solid #10b981",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#10b981",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span>✓</span>
          <span>
            Audio:{" "}
            {audioContext.voiceChannel.lastCompletion.duration.toFixed(2)}s (
            {audioContext.voiceChannel.lastCompletion.chunks} chunks)
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
        {messages.length === 0 && (
          <div
            style={{ textAlign: "center", color: "#666", marginTop: "2rem" }}
          >
            Start a conversation...
          </div>
        )}
        {messages.map((m) => (
          <MessageComponent key={m.id} message={m} />
        ))}
        {isLoading && (
          <div style={{ padding: "1rem", color: "#666" }}>Thinking...</div>
        )}
        {error && (
          <div style={{ padding: "1rem", color: "#ef4444" }}>
            Error: {error.message}
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          flexShrink: 0,
          padding: "1rem",
          borderTop: "1px solid #333",
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {previewUrl && (
          <div style={{ position: "relative", maxWidth: "200px" }}>
            <img
              src={previewUrl}
              alt="Preview"
              style={{ width: "100%", borderRadius: "8px" }}
            />
            <button
              onClick={() => {
                setSelectedFile(null);
                setPreviewUrl(null);
              }}
              style={{
                position: "absolute",
                top: "4px",
                right: "4px",
                background: "rgba(0,0,0,0.7)",
                color: "white",
                border: "none",
                borderRadius: "50%",
                width: "24px",
                height: "24px",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <label
            style={{
              padding: "0.5rem 1rem",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            📎 Attach Image
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "0.5rem",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "8px",
              color: "white",
              fontSize: "1rem",
            }}
          />
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              background: isLoading ? "#333" : "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontSize: "1rem",
            }}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
