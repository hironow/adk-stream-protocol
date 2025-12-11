"use client";

import { useChat } from "@ai-sdk/react";
import { buildUseChatOptions, type BackendMode } from "@/lib/build-use-chat-options";
import { MessageComponent } from "@/components/message";
import { useState } from "react";

interface ChatProps {
  mode: BackendMode;
}

export function Chat({ mode }: ChatProps) {
  const chatOptions = buildUseChatOptions({
    mode,
    initialMessages: [],
  });

  const { messages, sendMessage, status, error } = useChat(chatOptions);

  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
              type: 'file',
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

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#666", marginTop: "2rem" }}>
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
          padding: "1rem",
          borderTop: "1px solid #333",
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
