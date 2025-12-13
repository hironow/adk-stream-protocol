"use client";

import { useState } from "react";
import { Chat } from "@/components/chat";
import { AudioProvider } from "@/lib/audio-context";
import type { BackendMode } from "@/lib/build-use-chat-options";

export default function ChatPage() {
  const [mode, setMode] = useState<BackendMode>("gemini");

  return (
    <AudioProvider>
      <div style={{ height: "100vh", overflow: "hidden" }}>
        {/* Backend Mode Switcher */}
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            zIndex: 1000,
            padding: "0.75rem",
            background: "#1a1a1a",
            borderRadius: "8px",
            border: "1px solid #333",
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
                console.log("[Mode Switch] Gemini Direct");
                setMode("gemini");
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "gemini" ? "2px solid #2563eb" : "1px solid #333",
                background: mode === "gemini" ? "#1e3a8a" : "#111",
                color: mode === "gemini" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: "pointer",
                fontWeight: mode === "gemini" ? 600 : 400,
                textAlign: "left",
              }}
            >
              Gemini Direct
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  opacity: 0.8,
                }}
              >
                Next.js → Gemini (SSE)
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                console.log("[Mode Switch] ADK SSE");
                setMode("adk-sse");
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "adk-sse" ? "2px solid #10b981" : "1px solid #333",
                background: mode === "adk-sse" ? "#064e3b" : "#111",
                color: mode === "adk-sse" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: "pointer",
                fontWeight: mode === "adk-sse" ? 600 : 400,
                textAlign: "left",
              }}
            >
              ADK SSE
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  opacity: 0.8,
                }}
              >
                Frontend → ADK (SSE)
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                console.log("[Mode Switch] ADK BIDI");
                setMode("adk-bidi");
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border:
                  mode === "adk-bidi" ? "2px solid #f59e0b" : "1px solid #333",
                background: mode === "adk-bidi" ? "#78350f" : "#111",
                color: mode === "adk-bidi" ? "#fff" : "#888",
                fontSize: "0.875rem",
                cursor: "pointer",
                fontWeight: mode === "adk-bidi" ? 600 : 400,
                textAlign: "left",
              }}
            >
              ADK BIDI ⚡
              <div
                style={{
                  fontSize: "0.7rem",
                  marginTop: "0.25rem",
                  opacity: 0.8,
                }}
              >
                Frontend ↔ ADK (WS)
              </div>
            </button>
          </div>
        </div>

        {/* Single unified Chat component with mode prop */}
        {/* buildUseChatOptions() creates appropriate transport based on mode */}
        <Chat key={mode} mode={mode} />
      </div>
    </AudioProvider>
  );
}
