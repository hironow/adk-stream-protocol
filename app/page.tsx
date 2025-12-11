"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { useState, useMemo, useEffect } from "react";
import { MessageComponent } from "@/components/message";
import { ImageUpload } from "@/components/image-upload";
import { buildUseChatOptions, type BackendMode } from "@/lib/build-use-chat-options";

// Inner component with 3 separate useChat instances
// EXPERIMENTAL WORKAROUND: Create 3 separate useChat instances instead of 1 dynamic instance
// This is to verify if AI SDK v6 bug (issue #7070) is specific to dynamic reconfiguration
// or if separate instances can work correctly
function ChatInterface({
  mode,
  initialMessages,
  onMessagesUpdate,
}: {
  mode: BackendMode;
  initialMessages: UIMessage[];
  onMessagesUpdate: (messages: UIMessage[]) => void;
}) {
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<{
    data: string;
    media_type: string;
    fileName: string;
  } | null>(null);

  // Create 3 separate useChat instances - one for each backend mode
  // Each instance is configured with its specific endpoint/transport
  // TESTING: Create ADK SSE first to see if first-instance endpoint gets cached
  const adkSseChatOptions = useMemo(() =>
    buildUseChatOptions({
      mode: "adk-sse",
      initialMessages,
    }),
    [initialMessages]
  );

  const geminiChatOptions = useMemo(() =>
    buildUseChatOptions({
      mode: "gemini",
      initialMessages,
    }),
    [initialMessages]
  );

  const adkBidiChatOptions = useMemo(() =>
    buildUseChatOptions({
      mode: "adk-bidi",
      initialMessages,
    }),
    [initialMessages]
  );

  const adkSseChat = useChat(adkSseChatOptions);
  const geminiChat = useChat(geminiChatOptions);
  const adkBidiChat = useChat(adkBidiChatOptions);

  // Select the appropriate chat instance based on current mode
  const activeChat = mode === "gemini"
    ? geminiChat
    : mode === "adk-sse"
    ? adkSseChat
    : adkBidiChat;

  const { messages, sendMessage, status, error } = activeChat;

  // Sync messages back to parent whenever they change
  useEffect(() => {
    onMessagesUpdate(messages);
  }, [messages, onMessagesUpdate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !selectedImage) return;

    // Build message with text and/or image using v6 sendMessage API
    if (selectedImage) {
      // Multimodal message with files
      // Convert base64 to Data URL for file part
      const dataUrl = `data:${selectedImage.media_type};base64,${selectedImage.data}`;

      const files = [{
        type: "file" as const,
        filename: selectedImage.fileName,
        mediaType: selectedImage.media_type,
        url: dataUrl,
      }];

      // v6 API: sendMessage with text and files
      sendMessage({
        text: input.trim() || " ", // sendMessage requires text, use space if empty
        files: files as any,
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

      {/* Backend Status */}
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
        <strong>Status:</strong>{" "}
        <span style={{ color: status === "streaming" ? "#10b981" : "#888" }}>
          {status}
        </span>
      </div>
    </div>
  );
}

// Main page component manages backend mode state
export default function ChatPage() {
  // Backend mode state (controlled by user or env var)
  const [selectedMode, setSelectedMode] = useState<BackendMode>(
    (process.env.NEXT_PUBLIC_BACKEND_MODE as BackendMode) || "gemini"
  );

  // Shared messages state across all backend modes
  // This allows history to persist when switching backends
  const [sharedMessages, setSharedMessages] = useState<UIMessage[]>([]);

  return (
    <>
      {/* Backend Mode Switcher */}
      <div
        style={{
          position: "fixed",
          top: "1rem",
          right: "1rem",
          zIndex: 1000,
          padding: "0.75rem",
          background: "#1a1a1a",
          borderRadius: "4px",
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          <button
            onClick={() => {
              console.log("[ChatPage] Button clicked: switching to gemini mode");
              setSelectedMode("gemini");
            }}
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
            onClick={() => {
              console.log("[ChatPage] Button clicked: switching to adk-sse mode");
              setSelectedMode("adk-sse");
            }}
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
            onClick={() => {
              console.log("[ChatPage] Button clicked: switching to adk-bidi mode");
              setSelectedMode("adk-bidi");
            }}
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

      {/* ChatInterface with 3 separate useChat instances */}
      {/* EXPERIMENTAL WORKAROUND: Component stays mounted, switches between 3 useChat instances */}
      {/* This tests if AI SDK v6 bug (issue #7070) is specific to dynamic reconfiguration */}
      {/* All backend configuration is encapsulated in buildUseChatOptions */}
      <ChatInterface
        mode={selectedMode}
        initialMessages={sharedMessages}
        onMessagesUpdate={setSharedMessages}
      />
    </>
  );
}
