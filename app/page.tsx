"use client";

import { useState } from "react";
import { Chat } from "@/components/chat";
import { AudioProvider } from "@/lib/audio-context";
import type { BackendMode } from "@/lib/build-use-chat-options";
import { chunkLogger } from "@/lib/chunk_logs";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

export default function ChatPage() {
  const [mode, setMode] = useState<BackendMode>("gemini");
  // Message history preservation across mode switches
  const [messages, setMessages] = useState<UIMessageFromAISDKv6[]>([]);
  // Version counter to force Chat remount on clear
  const [messagesVersion, setMessagesVersion] = useState(0);
  // Streaming state for mode switch blocking
  const [isStreaming, setIsStreaming] = useState(false);

  return (
    <AudioProvider>
      <div style={{ height: "100vh", overflow: "hidden" }}>
        {/* Header with visually hidden h1 for accessibility */}
        <header
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <h1>AI Chat Application</h1>
        </header>

        {/* Single unified Chat component with mode prop - placed first in DOM for tab order */}
        {/* buildUseChatOptions() creates appropriate transport based on mode */}
        {/* P4-T9: Pass initialMessages and onMessagesChange for history preservation */}
        <Chat
          key={`${mode}-v${messagesVersion}`}
          mode={mode}
          initialMessages={messages}
          onMessagesChange={setMessages}
          onStreamingChange={setIsStreaming}
        />

        {/* Backend Mode Switcher - visually at top-right via position:fixed */}
        <nav
          aria-label="Backend mode selection"
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            zIndex: 1000,
            padding: "0.75rem",
            background: "#1a1a1a",
            borderRadius: "8px",
            border: "1px solid #333",
            minWidth: "220px",
          }}
        >
          <div
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "#d1d5db",
            }}
          >
            Backend Mode
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <button
              type="button"
              onClick={() => {
                setMode("gemini");
              }}
              disabled={isStreaming}
              tabIndex={-1}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "gemini" ? "2px solid #2563eb" : "1px solid #333",
                background: mode === "gemini" ? "#1e3a8a" : "#111",
                color: mode === "gemini" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: isStreaming ? "not-allowed" : "pointer",
                fontWeight: mode === "gemini" ? 600 : 400,
                textAlign: "left",
                opacity: isStreaming ? 0.5 : 1,
              }}
            >
              Gemini Direct
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  color: mode === "gemini" ? "#cbd5e1" : "#999",
                }}
              >
                Next.js → Gemini (SSE)
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("adk-sse");
              }}
              disabled={isStreaming}
              tabIndex={-1}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "adk-sse" ? "2px solid #10b981" : "1px solid #333",
                background: mode === "adk-sse" ? "#064e3b" : "#111",
                color: mode === "adk-sse" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: isStreaming ? "not-allowed" : "pointer",
                fontWeight: mode === "adk-sse" ? 600 : 400,
                textAlign: "left",
                opacity: isStreaming ? 0.5 : 1,
              }}
            >
              ADK SSE
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  color: mode === "adk-sse" ? "#cbd5e1" : "#999",
                }}
              >
                Frontend → ADK (SSE)
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("adk-bidi");
              }}
              disabled={isStreaming}
              tabIndex={-1}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "adk-bidi" ? "2px solid #f59e0b" : "1px solid #333",
                background: mode === "adk-bidi" ? "#78350f" : "#111",
                color: mode === "adk-bidi" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: isStreaming ? "not-allowed" : "pointer",
                fontWeight: mode === "adk-bidi" ? 600 : 400,
                textAlign: "left",
                opacity: isStreaming ? 0.5 : 1,
              }}
            >
              ADK BIDI ⚡
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  color: mode === "adk-bidi" ? "#cbd5e1" : "#999",
                }}
              >
                Frontend ↔ ADK (WS)
              </div>
            </button>
          </div>

          {/* P4-T9: Clear History Button */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setMessagesVersion((v) => v + 1);
              }}
              tabIndex={-1}
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: "1px solid #333",
                background: "#751010ff",
                color: "#fff",
                fontSize: "0.875rem",
                cursor: "pointer",
                width: "100%",
                textAlign: "center",
                fontWeight: 500,
              }}
            >
              Clear History
            </button>
          )}

          {/* Download Chunk Logger Button */}
          {chunkLogger.isEnabled() && (
            <button
              type="button"
              onClick={() => {
                chunkLogger.export();
              }}
              tabIndex={-1}
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: "1px solid #333",
                background: "#1f7a1c",
                color: "#fff",
                fontSize: "0.875rem",
                cursor: "pointer",
                width: "100%",
                textAlign: "center",
                fontWeight: 500,
              }}
            >
              Download Chunks
            </button>
          )}
        </nav>
      </div>
    </AudioProvider>
  );
}
