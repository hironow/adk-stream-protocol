"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useMemo } from "react";
import { MessageComponent } from "@/components/message";
import { ImageUpload } from "@/components/image-upload";
import { WebSocketChatTransport } from "@/lib/websocket-chat-transport";

type BackendMode = "gemini" | "adk-sse" | "adk-bidi";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<{
    data: string;
    media_type: string;
    fileName: string;
  } | null>(null);

  // Backend mode state (controlled by user or env var)
  const [selectedMode, setSelectedMode] = useState<BackendMode>(
    (process.env.NEXT_PUBLIC_BACKEND_MODE as BackendMode) || "gemini"
  );

  const adkBackendUrl = process.env.NEXT_PUBLIC_ADK_BACKEND_URL || "http://localhost:8000";

  // Create WebSocket transport for BIDI mode (memoized to avoid recreating on every render)
  const websocketTransport = useMemo(() => {
    if (selectedMode === "adk-bidi") {
      const wsUrl = adkBackendUrl.replace(/^http/, "ws") + "/live";
      console.log("[Page] Creating WebSocket transport:", wsUrl);
      return new WebSocketChatTransport({
        url: wsUrl,
        toolCallCallback: async (toolCall) => {
          console.log("[Page] Tool call:", toolCall);
          // Tools are handled on backend for now
          // Could add frontend tool execution here
          return { handled: "backend" };
        },
      });
    }
    return undefined;
  }, [selectedMode, adkBackendUrl]);

  const apiEndpoint = selectedMode === "adk-sse"
    ? `${adkBackendUrl}/stream`
    : "/api/chat";

  // Use transport for BIDI mode, api for SSE modes
  const { messages, sendMessage, status, error} = useChat(
    selectedMode === "adk-bidi" && websocketTransport
      ? {
          transport: websocketTransport,
          key: selectedMode,
        }
      : {
          api: apiEndpoint,
          key: selectedMode,
        }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !selectedImage) return;

    // Build message with text and/or image
    if (selectedImage) {
      // Multimodal message with parts
      const parts: Array<{ type: string; text?: string; data?: string; media_type?: string }> = [];

      if (input.trim()) {
        parts.push({ type: "text", text: input });
      }

      parts.push({
        type: "image",
        data: selectedImage.data,
        media_type: selectedImage.media_type,
      });

      sendMessage({
        content: "",
        experimental_attachments: parts as any,
      });
    } else {
      // Text-only message
      sendMessage({ text: input });
    }

    // Clear input and image
    setInput("");
    setSelectedImage(null);
  };

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "2rem" }}>AI SDK v6 + ADK Integration</h1>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem",
          minHeight: "400px",
          maxHeight: "600px",
          overflowY: "auto",
          background: "#111",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#666" }}>Start a conversation...</p>
        )}

        {messages.map((message) => (
          <MessageComponent key={message.id} message={message} />
        ))}

        {isLoading && (
          <div style={{ color: "#666", fontStyle: "italic" }}>
            Thinking...
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            background: "#3a1a1a",
            border: "1px solid #a33",
            borderRadius: "4px",
            color: "#faa",
          }}
        >
          Error: {error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {/* Image Upload */}
        <ImageUpload
          onImageSelect={(imageData) => setSelectedImage(imageData)}
          onImageRemove={() => setSelectedImage(null)}
        />

        {/* Text Input and Send Button */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "0.75rem",
              borderRadius: "4px",
              border: "1px solid #333",
              background: "#111",
              color: "#ededed",
              fontSize: "1rem",
            }}
          />
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "4px",
              border: "none",
              background: isLoading ? "#333" : "#2563eb",
              color: "#fff",
              fontSize: "1rem",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            Send
          </button>
        </div>
      </form>

      {/* Backend Mode Switcher */}
      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          background: "#1a1a1a",
          borderRadius: "4px",
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          <button
            onClick={() => setSelectedMode("gemini")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              border: selectedMode === "gemini" ? "2px solid #2563eb" : "1px solid #333",
              background: selectedMode === "gemini" ? "#1e3a8a" : "#111",
              color: selectedMode === "gemini" ? "#fff" : "#888",
              fontSize: "0.875rem",
              cursor: "pointer",
              fontWeight: selectedMode === "gemini" ? 600 : 400,
            }}
          >
            Gemini Direct
            <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", opacity: 0.8 }}>
              Next.js → Gemini (SSE)
            </div>
          </button>
          <button
            onClick={() => setSelectedMode("adk-sse")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              border: selectedMode === "adk-sse" ? "2px solid #10b981" : "1px solid #333",
              background: selectedMode === "adk-sse" ? "#064e3b" : "#111",
              color: selectedMode === "adk-sse" ? "#fff" : "#888",
              fontSize: "0.875rem",
              cursor: "pointer",
              fontWeight: selectedMode === "adk-sse" ? 600 : 400,
            }}
          >
            ADK SSE
            <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", opacity: 0.8 }}>
              Frontend → ADK (SSE)
            </div>
          </button>
          <button
            onClick={() => setSelectedMode("adk-bidi")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              border: selectedMode === "adk-bidi" ? "2px solid #f59e0b" : "1px solid #333",
              background: selectedMode === "adk-bidi" ? "#78350f" : "#111",
              color: selectedMode === "adk-bidi" ? "#fff" : "#888",
              fontSize: "0.875rem",
              cursor: "pointer",
              fontWeight: selectedMode === "adk-bidi" ? 600 : 400,
            }}
          >
            ADK BIDI ⚡
            <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", opacity: 0.8 }}>
              Frontend ↔ ADK (WS)
            </div>
          </button>
        </div>
      </div>

      {/* Backend Info */}
      <div
        style={{
          marginTop: "0.5rem",
          padding: "0.75rem",
          background: "#1a1a1a",
          borderRadius: "4px",
          fontSize: "0.875rem",
          color: "#888",
        }}
      >
        <strong>Active Endpoint:</strong>{" "}
        <span style={{ color: "#d1d5db", fontFamily: "monospace", fontSize: "0.8125rem" }}>
          {apiEndpoint}
        </span>
        <br />
        <strong>Status:</strong>{" "}
        <span style={{ color: status === "streaming" ? "#10b981" : "#888" }}>
          {status}
        </span>
      </div>
    </div>
  );
}
