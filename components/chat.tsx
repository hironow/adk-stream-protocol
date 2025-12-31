"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageComponent } from "@/components/message";
import { RateLimitError } from "@/components/rate-limit-error";
import { useAudio } from "@/lib/audio-context";
import {
  type BackendMode,
  buildUseChatOptions,
} from "@/lib/build-use-chat-options";
import { isRateLimitError } from "@/lib/core/error-utils";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

interface ChatProps {
  mode: BackendMode;
  // Message history preservation
  initialMessages?: UIMessageFromAISDKv6[];
  onMessagesChange?: (messages: UIMessageFromAISDKv6[]) => void;
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

  const { messages, sendMessage, status, error, addToolApprovalResponse } =
    useChat({
      ...useChatOptions,
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
      {/* Skip to main content link - visually hidden but focusable via screen reader */}
      <a
        href="#main-content"
        tabIndex={-1}
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
          role="dialog"
          aria-labelledby="audio-permission-title"
          aria-modal="true"
          style={{
            position: "fixed",
            top: "2rem",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "400px",
            width: "calc(100% - 2rem)",
            background: "#ffffff",
            borderRadius: "12px",
            padding: "1.5rem",
            boxShadow:
              "0 10px 25px rgba(0, 0, 0, 0.15), 0 4px 6px rgba(0, 0, 0, 0.1)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "2rem",
                lineHeight: 1,
              }}
              aria-hidden="true"
            >
              🔊
            </div>
            <div>
              <h2
                id="audio-permission-title"
                style={{
                  margin: 0,
                  fontSize: "1.125rem",
                  fontWeight: 600,
                  color: "#1a1a1a",
                  marginBottom: "0.5rem",
                }}
              >
                Enable Audio Features
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.875rem",
                  color: "#666",
                  lineHeight: 1.5,
                }}
              >
                Voice chat and background music require your permission to play
                audio
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await audioContext.activate();
              }}
              aria-label="Enable audio features for voice and background music"
              style={{
                width: "100%",
                padding: "0.875rem 1.5rem",
                background: "#0070f3",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#0051cc";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#0070f3";
              }}
            >
              Enable Audio
            </button>
          </div>
        </div>
      )}

      {/* BGM Switch Button (upper left) - removed from tab order to prioritize chat input */}
      <button
        type="button"
        onClick={() =>
          console.log(
            "[Chat] BGM button clicked, should be handled by tool calls",
          )
        }
        tabIndex={-1}
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
          <div
            style={{ padding: "1rem", color: "#999" }}
            data-testid="thinking-indicator"
          >
            <span>Thinking</span>
            <span
              style={{
                display: "inline-block",
                animation: "wave 1.4s infinite",
                animationDelay: "0s",
              }}
            >
              .
            </span>
            <span
              style={{
                display: "inline-block",
                animation: "wave 1.4s infinite",
                animationDelay: "0.2s",
              }}
            >
              .
            </span>
            <span
              style={{
                display: "inline-block",
                animation: "wave 1.4s infinite",
                animationDelay: "0.4s",
              }}
            >
              .
            </span>
            <style>{`
              @keyframes wave {
                0%, 60%, 100% {
                  transform: translateY(0);
                }
                30% {
                  transform: translateY(-0.3rem);
                }
              }
            `}</style>
          </div>
        )}
        {error &&
          (isRateLimitError(error) ? (
            <RateLimitError error={error} />
          ) : (
            <div
              data-testid="generic-error"
              style={{ padding: "1rem", color: "#ef4444" }}
            >
              Error: {error.message}
            </div>
          ))}
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
              tabIndex={0}
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
