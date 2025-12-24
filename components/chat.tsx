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

interface ChatProps {
  mode: BackendMode;
  // Message history preservation
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
  } = useChat({
    ...useChatOptions,
    // TODO: mv to lib/build-use-chat-options.ts?
    // AI SDK v6 standard pattern: Auto-execute client-side tools
    async onToolCall({ toolCall }) {
      // Check if it's a dynamic tool first for proper type narrowing
      if (toolCall.dynamic) {
        return;
      }

      // Auto-execute change_bgm tool
      if (toolCall.toolName === "change_bgm") {
        const track = Number(
          (toolCall.input as { track?: number })?.track ?? 1,
        );

        // Execute BGM change using AudioContext
        audioContext.bgmChannel.switchTrack();

        const toolResult = {
          success: true,
          current_track: track,
          message: `BGM changed to track ${track}`,
        };

        // BIDI delegate pattern: addToolOutput() triggers AI SDK v6 auto-send
        // AI SDK v6 will call transport.sendMessages() automatically
        // No await - avoids potential deadlocks (per AI SDK v6 docs)
        addToolOutput({
          tool: "change_bgm",
          toolCallId: toolCall.toolCallId,
          output: toolResult,
        });

        console.log(
          `[Chat] Tool output added for toolCallId=${toolCall.toolCallId}, AI SDK v6 will auto-send`,
        );
      }
    },
  });

  // DEBUG: Log messages array changes to understand sendAutomaticallyWhen behavior
  useEffect(() => {
    // Check if last assistant message has completed tool approvals
    const lastAssistantMsg = messages
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistantMsg && "toolInvocations" in lastAssistantMsg) {
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
      const toolInvocations = lastAssistantMsg.toolInvocations as any[];
      const toolStates = toolInvocations?.map(
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        (t: any) => ({
          type: t.type,
          state: t.state,
          hasApproval: "approval" in t,
          hasApprovalResponse: "approvalResponse" in t,
          hasOutput: "output" in t,
        }),
      );

      console.log(
        "[Chat] Tool invocation states:",
        JSON.stringify(toolStates, null, 2),
      );
      console.log("[Chat] Message count:", messages.length, "Status:", status);

      // Check the condition that sendAutomaticallyWhen uses
      const allApproved = toolInvocations?.every(
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        (t: any) => t.state !== "approval-requested",
      );
      const hasApprovals = toolInvocations?.some(
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 internal structure
        (t: any) => "approval" in t || "approvalResponse" in t,
      );

      console.log("[Chat] sendAutomaticallyWhen conditions:", {
        allApproved,
        hasApprovals,
        shouldTrigger: allApproved && hasApprovals,
      });
    }
  }, [messages, status]);

  // Notify parent of messages change for history preservation
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages);
    }
  }, [messages, onMessagesChange]);

  // Keep transport reference for imperative control
  const transportRef = useRef(transport);

  const isLoading = status === "submitted" || status === "streaming";

  // TODO: separate tool use on client matcher!
  // Tool execution helper - execute frontend-delegated tools
  // This is called after approval is sent to execute the actual tool
  const _executeToolCallback = useCallback(
    async (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ): Promise<{ success: boolean; result?: Record<string, unknown> }> => {
      let result: Record<string, unknown> = {}; // Initialize to empty object
      let handled = true;

      try {
        switch (toolName) {
          case "change_bgm": {
            // Execute AudioContext API
            const track = args?.track ?? 1; // Default to track 1 (1-based indexing)
            console.log(`[Chat] Executing change_bgm: track=${track}`);
            audioContext.bgmChannel.switchTrack();
            result = {
              success: true,
              previous_track: track === 1 ? 2 : 1, // 1-based: if current is 1, previous was 2
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
            // But effectively for this callback, we return { success: false }
            break;
          }
        }

        if (!handled) {
          return { success: false };
        }

        // handled = true, so result is definitely defined
        console.log("[Chat] Tool execution result:", result);

        // Send result via AI SDK v6 standard API (SSE mode)
        addToolOutput({
          tool: toolName,
          toolCallId: toolCallId,
          state: "output-available",
          output: result,
        });

        // Return result for BIDI mode
        return { success: true, result };
      } catch (error) {
        console.error("[Chat] Tool execution error:", error);
        const errorResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };

        addToolOutput({
          tool: toolName,
          toolCallId: toolCallId,
          state: "output-error",
          errorText: error instanceof Error ? error.message : String(error),
        });

        return { success: true, result: errorResult }; // Handled but failed
      }
    },
    [addToolOutput, audioContext],
  );

  // ESC key interruption support
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
      {/* Skip to main content link - visually hidden but focusable */}
      <a
        href="#main-content"
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          zIndex: 9999,
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = "0.5rem";
          e.currentTarget.style.top = "0.5rem";
          e.currentTarget.style.padding = "0.5rem";
          e.currentTarget.style.background = "#0070f3";
          e.currentTarget.style.color = "#fff";
          e.currentTarget.style.borderRadius = "4px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = "-9999px";
          e.currentTarget.style.top = "0";
          e.currentTarget.style.padding = "0";
          e.currentTarget.style.background = "transparent";
        }}
      >
        Skip to main content
      </a>
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
            aria-label="Enable audio features for voice and background music"
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
            <span aria-hidden="true">🔊</span>
            <span>Enable Audio</span>
          </button>
        </div>
      )}

      {/* BGM Switch Button (upper left) */}
      <button
        type="button"
        onClick={() =>
          console.log(
            "[Chat] BGM button clicked, should be handled by tool calls",
          )
        }
        aria-label={`Background music track ${audioContext.bgmChannel.currentTrack + 1}`}
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
        <span aria-hidden="true">🎵</span>
        <span>BGM {audioContext.bgmChannel.currentTrack + 1}</span>
      </button>

      {/* Interrupt Indicator */}
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

      <main
        id="main-content"
        style={{ flex: 1, overflowY: "auto", padding: "1rem" }}
      >
        {messages.length === 0 && (
          <div
            style={{ textAlign: "center", color: "#999", marginTop: "2rem" }}
          >
            Start a conversation...
          </div>
        )}
        {messages.map((m) => (
          <MessageComponent
            key={m.id}
            message={m}
            addToolApprovalResponse={addToolApprovalResponse}
          />
        ))}
        {isLoading && (
          <div style={{ padding: "1rem", color: "#999" }}>Thinking...</div>
        )}
        {error && (
          <div style={{ padding: "1rem", color: "#ef4444" }}>
            Error: {error.message}
          </div>
        )}
      </main>

      <form
        data-testid="chat-form"
        onSubmit={onSubmit}
        aria-label="Chat message input form"
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
              aria-label="Remove attached image"
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
            htmlFor="image-upload"
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
              id="image-upload"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
              aria-label="Upload an image file"
            />
          </label>
          <label htmlFor="chat-input" style={{ flex: 1 }}>
            <span
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: 0,
                margin: "-1px",
                overflow: "hidden",
                clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              Chat message input
            </span>
            <input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              aria-label="Type your chat message"
              style={{
                width: "100%",
                padding: "0.5rem",
                background: "#1a1a1a",
                border: "1px solid #333",
                borderRadius: "8px",
                color: "white",
                fontSize: "1rem",
              }}
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            aria-label={isLoading ? "Sending message..." : "Send message"}
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
