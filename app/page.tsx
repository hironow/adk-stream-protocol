"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";

export default function ChatPage() {
  // AI SDK v6: useChat no longer manages input state
  const { messages, sendMessage, status, error } = useChat({
    api: "/api/chat",
  });

  // Manage input state ourselves
  const [input, setInput] = useState("");

  const [config, setConfig] = useState<{
    backendMode: string;
    adkBackendUrl: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    sendMessage({ text: input });
    setInput("");
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
          <div
            key={message.id}
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              borderRadius: "4px",
              background: message.role === "user" ? "#1a2332" : "#1a2e1a",
            }}
          >
            <div
              style={{
                fontWeight: "bold",
                marginBottom: "0.5rem",
                color: message.role === "user" ? "#60a5fa" : "#4ade80",
              }}
            >
              {message.role === "user" ? "You" : "Assistant"}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {message.parts.map((part, index) =>
                part.type === "text" ? (
                  <span key={index}>{part.text}</span>
                ) : null
              )}
            </div>
          </div>
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

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
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
      </form>

      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          background: "#1a1a1a",
          borderRadius: "4px",
          fontSize: "0.875rem",
          color: "#888",
        }}
      >
        {config && (
          <>
            <strong>Backend Mode:</strong> {config.backendMode}
            <br />
            {config.backendMode !== "gemini" && config.backendMode !== "openai" && (
              <>
                <strong>ADK URL:</strong> {config.adkBackendUrl}
                <br />
              </>
            )}
            <strong>Phase:</strong>{" "}
            {config.backendMode === "gemini"
              ? "1 (Gemini Direct)"
              : config.backendMode === "openai"
                ? "1 (OpenAI Direct)"
                : config.backendMode === "adk-jsonrpc"
                  ? "2 (JSONRPC)"
                  : config.backendMode === "adk-sse"
                    ? "3 (SSE Streaming)"
                    : "Unknown"}
          </>
        )}
      </div>
    </div>
  );
}
