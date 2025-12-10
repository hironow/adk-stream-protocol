"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState, useRef, useCallback } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function ChatPage() {
  // AI SDK v6: useChat for non-WebSocket modes
  const { messages: chatMessages, sendMessage, status, error } = useChat({
    api: "/api/chat",
  });

  // Manage input state ourselves
  const [input, setInput] = useState("");

  const [config, setConfig] = useState<{
    backendMode: string;
    adkBackendUrl: string;
  } | null>(null);

  // WebSocket state
  const [wsMessages, setWsMessages] = useState<Message[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsLoading, setWsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const currentMessageRef = useRef<string>("");

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  // Determine if we're using WebSocket mode
  const useWebSocket = config?.backendMode === "adk-websocket";

  // WebSocket connection
  useEffect(() => {
    if (!useWebSocket) return;

    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
      setWsConnected(true);
      setWsError(null);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WebSocket message:", data);

      if (data.type === "message-start") {
        // User message echo
        setWsMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: "user",
            content: data.content,
          },
        ]);
        // Start new assistant message
        currentMessageRef.current = "";
      } else if (data.type === "text-start") {
        // Start assistant response
        setWsLoading(true);
      } else if (data.type === "text-delta") {
        // Append text delta
        currentMessageRef.current += data.delta;
        setWsMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            // Update existing message
            return [
              ...prev.slice(0, -1),
              { ...last, content: currentMessageRef.current },
            ];
          } else {
            // Create new assistant message
            return [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: currentMessageRef.current,
              },
            ];
          }
        });
      } else if (data.type === "text-end") {
        // Text complete
        console.log("Text completed");
      } else if (data.type === "finish") {
        // Response complete
        setWsLoading(false);
        currentMessageRef.current = "";
      } else if (data.type === "error") {
        setWsError(data.error);
        setWsLoading(false);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setWsError("WebSocket connection error");
      setWsConnected(false);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [useWebSocket]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;

      if (useWebSocket) {
        // Send via WebSocket
        if (wsRef.current && wsConnected) {
          wsRef.current.send(JSON.stringify({ text: input }));
          setInput("");
          setWsLoading(true);
        } else {
          setWsError("WebSocket not connected");
        }
      } else {
        // Send via AI SDK useChat
        sendMessage({ text: input });
        setInput("");
      }
    },
    [input, useWebSocket, wsConnected, sendMessage]
  );

  // Choose which messages to display
  const messages = useWebSocket ? wsMessages : chatMessages;
  const isLoading = useWebSocket
    ? wsLoading
    : status === "submitted" || status === "streaming";
  const displayError = useWebSocket ? wsError : error?.message;

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

        {messages.map((message, idx) => (
          <div
            key={useWebSocket ? message.id : message.id}
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
              {useWebSocket ? (
                // WebSocket mode: display content directly
                message.content
              ) : (
                // AI SDK mode: display parts
                message.parts?.map((part: any, index: number) =>
                  part.type === "text" ? (
                    <span key={index}>{part.text}</span>
                  ) : null
                )
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

      {displayError && (
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
          Error: {displayError}
        </div>
      )}

      {useWebSocket && (
        <div
          style={{
            padding: "0.5rem",
            marginBottom: "0.5rem",
            borderRadius: "4px",
            fontSize: "0.875rem",
            background: wsConnected ? "#1a2e1a" : "#3a1a1a",
            color: wsConnected ? "#4ade80" : "#faa",
          }}
        >
          WebSocket: {wsConnected ? "Connected" : "Disconnected"}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading || (useWebSocket && !wsConnected)}
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
          disabled={isLoading || (useWebSocket && !wsConnected)}
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
                    : config.backendMode === "adk-websocket"
                      ? "4 (WebSocket Bidirectional)"
                      : "Unknown"}
          </>
        )}
      </div>
    </div>
  );
}
