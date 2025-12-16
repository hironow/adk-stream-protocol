"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageComponent } from "@/components/message";
import { useAudio } from "@/lib/audio-context";
import {
  type BackendMode,
  buildUseChatOptions,
} from "@/lib/build-use-chat-options";
import { useAudioRecorder } from "@/lib/use-audio-recorder";

interface ChatProps {
  mode: BackendMode;
  // P4-T9: Message history preservation
  initialMessages?: UIMessage[];
  onMessagesChange?: (messages: UIMessage[]) => void;
}

export function Chat({
  mode,
  initialMessages = [],
  onMessagesChange,
}: ChatProps) {
  const audioContext = useAudio();

  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [showAudioCompletion, setShowAudioCompletion] = useState(false);
  const audioCompletionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Memoize buildUseChatOptions to prevent recreating WebSocket transport on every render
  // CRITICAL: Without useMemo, WebSocket transport is recreated on every render in ADK BIDI mode
  // This causes: continuous debug logs, memory leaks, multiple WebSocket connections
  // NOTE: audioContext and initialMessages are intentionally excluded from dependencies:
  // - audioContext: AudioProvider's value object is recreated on every render (not memoized)
  // - initialMessages: Changes frequently during streaming but useChat manages state internally
  // - Both are only used during transport creation, not for updates
  // - Including them would defeat the purpose of memoization
  // biome-ignore lint/correctness/useExhaustiveDependencies: audioContext and initialMessages intentionally excluded to prevent WebSocket recreation
  const { useChatOptions, transport } = useMemo(
    () =>
      buildUseChatOptions({
        mode,
        initialMessages, // P4-T9: Pass initialMessages from parent
        audioContext,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode],
  );

  const {
    messages,
    sendMessage,
    status,
    error,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat(useChatOptions);

  // Remove duplicate messages (same ID) - can occur due to AI SDK v6 beta bugs with manual send pattern
  // This prevents React key warnings and ensures each message ID is unique in the rendered list
  // Keep the LATEST message for each ID (in case of streaming updates)
  const uniqueMessages = useMemo(() => {
    const messageMap = new Map<string, UIMessage>();

    // Iterate through messages and keep the latest one for each ID
    for (const msg of messages) {
      if (messageMap.has(msg.id)) {
        console.warn(
          `[Chat] Found duplicate message ID: ${msg.id}, keeping latest`,
        );
      }
      messageMap.set(msg.id, msg); // Overwrite with latest
    }

    return Array.from(messageMap.values());
  }, [messages]);

  // P4-T9: Notify parent of messages change for history preservation
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(uniqueMessages);
    }
  }, [uniqueMessages, onMessagesChange]);

  // Keep transport reference for imperative control (P2-T2 Phase 2)
  const transportRef = useRef(transport);

  // Phase 3: Audio recording with custom hook (BIDI mode only)
  const { isRecording, startRecording, stopRecording } = useAudioRecorder({
    mode,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Tool execution helper - execute frontend-delegated tools
  // This is called after approval is sent to execute the actual tool
  const executeToolCallback = useCallback(
    async (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ): Promise<boolean> => {
      let result: Record<string, unknown> = {}; // Initialize to empty object
      let handled = true;

      try {
        switch (toolName) {
          case "change_bgm": {
            // Execute AudioContext API
            const track = args?.track ?? 0;
            console.log(`[Chat] Executing change_bgm: track=${track}`);
            audioContext.bgmChannel.switchTrack();
            result = {
              success: true,
              previous_track: track === 0 ? 1 : 0,
              current_track: track,
              message: `BGM changed to track ${track}`,
            };
            break;
          }

          case "get_location": {
            // Execute Geolocation API
            console.log("[Chat] Executing get_location");
            result = await new Promise((resolve) => {
              if (!navigator.geolocation) {
                resolve({
                  success: false,
                  error: "Geolocation not supported",
                });
                return;
              }

              navigator.geolocation.getCurrentPosition(
                (position) => {
                  resolve({
                    success: true,
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp,
                  });
                },
                (error) => {
                  resolve({
                    success: false,
                    error: error.message,
                    code: error.code,
                  });
                },
                {
                  enableHighAccuracy: true,
                  timeout: 10000,
                  maximumAge: 0,
                },
              );
            });
            break;
          }

          default: {
            console.warn(`[Chat] Unknown tool: ${toolName}`);
            // Not handled by client
            handled = false;
            // We don't return result here because we want server to handle it if possible
            // But effectively for this callback, we return false
            break;
          }
        }

        if (!handled) {
          return false;
        }

        // handled = true, so result is definitely defined
        console.log("[Chat] Tool execution result:", result);

        // Send result via AI SDK v6 standard API
        addToolOutput({
          tool: toolName,
          toolCallId: toolCallId,
          state: "output-available",
          output: result,
        });

        // Manual send after client-side tool execution (AI SDK v6 beta bug workaround)
        console.info(
          `[Chat] Triggering manual send after client-side tool execution`,
        );
        setTimeout(() => {
          sendMessage({ text: "" });
        }, 100);

        return true;
      } catch (error) {
        console.error("[Chat] Tool execution error:", error);
        addToolOutput({
          tool: toolName,
          toolCallId: toolCallId,
          state: "output-error",
          errorText: error instanceof Error ? error.message : String(error),
        });

        // Manual send after client-side tool error (AI SDK v6 beta bug workaround)
        console.info(
          `[Chat] Triggering manual send after client-side tool error`,
        );
        setTimeout(() => {
          sendMessage({ text: "" });
        }, 100);

        return true; // Handled but failed
      }
    },
    [addToolOutput, audioContext, sendMessage],
  );

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

  // Phase 3: Push-to-Talk button handlers (BIDI mode only)
  // Using mouse and touch events for press-and-hold recording
  const handleRecordingButtonDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (mode === "adk-bidi" && !isRecording) {
        console.log("[Chat] Recording button pressed - starting recording");
        handleStartRecording();
      }
    },
    [mode, isRecording, handleStartRecording],
  );

  const handleRecordingButtonUp = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (mode === "adk-bidi" && isRecording) {
        console.log("[Chat] Recording button released - stopping recording");
        handleStopRecording();
      }
    },
    [mode, isRecording, handleStopRecording],
  );

  // Handle cases where the user moves cursor away while holding the button
  useEffect(() => {
    if (mode !== "adk-bidi" || !isRecording) return;

    const handleGlobalMouseUp = () => {
      if (isRecording) {
        console.log("[Chat] Global mouse up - stopping recording");
        handleStopRecording();
      }
    };

    const handleGlobalTouchEnd = () => {
      if (isRecording) {
        console.log("[Chat] Global touch end - stopping recording");
        handleStopRecording();
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    window.addEventListener("touchend", handleGlobalTouchEnd);

    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("touchend", handleGlobalTouchEnd);
    };
  }, [mode, isRecording, handleStopRecording]);

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

  // Show audio completion notification when audio completes
  useEffect(() => {
    if (mode === "adk-bidi" && audioContext.voiceChannel.lastCompletion) {
      // Clear any existing timer
      if (audioCompletionTimerRef.current) {
        clearTimeout(audioCompletionTimerRef.current);
      }

      // Show the notification
      setShowAudioCompletion(true);

      // Auto-hide after 3 seconds
      audioCompletionTimerRef.current = setTimeout(() => {
        setShowAudioCompletion(false);
        audioCompletionTimerRef.current = null;
      }, 3000);
    }

    // Cleanup on unmount
    return () => {
      if (audioCompletionTimerRef.current) {
        clearTimeout(audioCompletionTimerRef.current);
      }
    };
  }, [mode, audioContext.voiceChannel.lastCompletion]);

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
      {/* Audio Activation Button (center overlay) */}
      {audioContext.needsUserActivation && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.8)",
            zIndex: 2000,
          }}
        >
          <button
            type="button"
            onClick={async () => {
              await audioContext.activate();
            }}
            style={{
              padding: "1rem 2rem",
              background: "#0070f3",
              border: "none",
              borderRadius: "8px",
              fontSize: "1rem",
              fontWeight: 600,
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>🔊</span>
            <span>Enable Audio</span>
          </button>
        </div>
      )}

      {/* BGM Switch Button (upper left) */}
      <button
        type="button"
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

      {/* Phase 4: Tool Approval Dialog */}

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

      {/* Audio Completion Indicator (BIDI mode only) */}
      {mode === "adk-bidi" &&
        showAudioCompletion &&
        audioContext.voiceChannel.lastCompletion && (
          <div
            style={{
              position: "fixed",
              top: "1rem",
              left: "50%",
              transform: "translateX(-50%)",
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
              animation: "fadeIn 0.3s ease-in-out",
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
        {uniqueMessages.length === 0 && (
          <div
            style={{ textAlign: "center", color: "#666", marginTop: "2rem" }}
          >
            Start a conversation...
          </div>
        )}
        {uniqueMessages.map((m) => (
          <MessageComponent
            key={m.id}
            message={m}
            addToolApprovalResponse={addToolApprovalResponse}
            executeToolCallback={executeToolCallback}
            sendMessage={() => sendMessage({ text: "" })} // Manual send after tool approval (v6 beta bug workaround)
          />
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

      {/* Phase 3: Push-to-Talk Recording Button (BIDI mode only) */}
      {mode === "adk-bidi" && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "0.5rem",
            borderTop: "1px solid #333",
            background: "#0a0a0a",
          }}
        >
          <button
            type="button"
            onMouseDown={handleRecordingButtonDown}
            onMouseUp={handleRecordingButtonUp}
            onTouchStart={handleRecordingButtonDown}
            onTouchEnd={handleRecordingButtonUp}
            style={{
              padding: "0.75rem 1.5rem",
              background: isRecording ? "#dc2626" : "#1a1a1a",
              border: isRecording ? "1px solid #991b1b" : "1px solid #333",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              transition: "all 0.2s ease",
              transform: isRecording ? "scale(1.05)" : "scale(1)",
            }}
          >
            <span
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: isRecording ? "#fff" : "#ef4444",
                animation: isRecording
                  ? "pulse 1.5s ease-in-out infinite"
                  : "none",
              }}
            />
            <span>
              {isRecording
                ? "Recording... (Release to send)"
                : "Hold to Record"}
            </span>
          </button>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        style={{
          flexShrink: 0,
          padding: "1rem",
          borderTop: mode === "adk-bidi" ? "none" : "1px solid #333",
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {previewUrl && (
          <div style={{ position: "relative", maxWidth: "200px" }}>
            {/* biome-ignore lint/performance/noImgElement: Data URL preview requires img element */}
            <img
              src={previewUrl}
              alt="Preview"
              style={{ width: "100%", borderRadius: "8px" }}
            />
            <button
              type="button"
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
