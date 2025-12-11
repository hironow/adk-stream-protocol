/**
 * Message Component
 *
 * Displays chat messages with support for:
 * - Text content
 * - Tool invocations (calls and results)
 * - Reasoning (thinking process)
 * - Usage metadata
 *
 * All rendering complexity is contained within this component.
 */

import { Message } from "@ai-sdk/react";
import { ToolInvocationComponent } from "./tool-invocation";
import { ImageDisplay } from "./image-display";
import { AudioPlayer } from "./audio-player";

interface MessageComponentProps {
  message: Message;
}

export function MessageComponent({ message }: MessageComponentProps) {
  const isUser = message.role === "user";

  return (
    <div
      data-testid={`message-${message.role}`}
      data-message-id={message.id}
      style={{
        marginBottom: "1rem",
        padding: "0.75rem",
        borderRadius: "8px",
        background: isUser ? "#1a2332" : "#1a2e1a",
      }}
    >
      {/* Message Header */}
      <div
        data-testid="message-header"
        style={{
          fontWeight: "bold",
          marginBottom: "0.5rem",
          color: isUser ? "#60a5fa" : "#4ade80",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span data-testid="message-sender">{isUser ? "You" : "Assistant"}</span>

        {/* Status indicator for streaming */}
        {message.status === "in_progress" && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "#888",
              fontWeight: "normal",
            }}
          >
            (typing...)
          </span>
        )}
      </div>

      {/* Message Content - handle both parts and experimental_attachments */}
      <div data-testid="message-content" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {/* Handle experimental_attachments (user messages with images) */}
        {(message as any).experimental_attachments?.map((attachment: any, index: number) => {
          // Text attachment
          if (attachment.type === "text") {
            return (
              <div
                key={index}
                data-testid="message-text"
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                }}
              >
                {attachment.text}
              </div>
            );
          }

          // Image attachment
          if (attachment.type === "image") {
            return (
              <ImageDisplay
                key={index}
                content={attachment.data}
                mediaType={attachment.media_type}
                alt="Uploaded image"
              />
            );
          }

          return null;
        })}

        {/* Collect all PCM audio chunks and render as single player */}
        {(() => {
          const pcmChunks = message.parts?.filter(
            (part: any) => part.type === "data-pcm" && part.data
          );
          return pcmChunks && pcmChunks.length > 0 ? (
            <AudioPlayer
              chunks={pcmChunks.map((part: any) => ({
                content: part.data.content,
                sampleRate: part.data.sampleRate,
                channels: part.data.channels,
                bitDepth: part.data.bitDepth,
              }))}
            />
          ) : null;
        })()}

        {/* Handle regular message parts (assistant responses) */}
        {message.parts?.map((part: any, index: number) => {
          // Text content
          if (part.type === "text") {
            return (
              <div
                key={index}
                data-testid="message-text"
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                }}
              >
                {part.text}
              </div>
            );
          }

          // Reasoning/Thinking (Gemini 2.0 feature)
          if (part.type === "reasoning") {
            return (
              <details
                key={index}
                style={{
                  padding: "0.75rem",
                  borderRadius: "6px",
                  background: "#0a0a0a",
                  border: "1px solid #6366f1",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#818cf8",
                    userSelect: "none",
                  }}
                >
                  💭 Reasoning Process
                </summary>
                <div
                  style={{
                    marginTop: "0.5rem",
                    paddingTop: "0.5rem",
                    borderTop: "1px solid #374151",
                    color: "#9ca3af",
                    fontSize: "0.875rem",
                    whiteSpace: "pre-wrap",
                    lineHeight: "1.5",
                  }}
                >
                  {part.text || part.content}
                </div>
              </details>
            );
          }

          // File content (AI SDK v6 file part)
          if (part.type === "file" && part.mediaType?.startsWith("image/")) {
            return (
              <img
                key={index}
                src={part.url}
                alt={part.filename || "Image"}
                style={{
                  maxWidth: "100%",
                  borderRadius: "8px",
                  marginTop: "0.5rem",
                }}
              />
            );
          }

          // Image content (data-image custom event)
          if (part.type === "data-image" && part.data) {
            return (
              <ImageDisplay
                key={index}
                content={part.data.content}
                mediaType={part.data.mediaType}
                alt="Image from assistant"
              />
            );
          }

          // PCM audio content (data-pcm custom event) - Skip here, handled above as single player
          if (part.type === "data-pcm" && part.data) {
            return null;
          }

          // Legacy audio content (data-audio custom event) - Skip if present
          if (part.type === "data-audio" && part.data) {
            return null;
          }

          // Tool Invocation (any tool)
          // AI SDK useChat converts tool events to part.type = "tool-{toolName}"
          if (part.type === "tool-call" && part.toolInvocation) {
            return (
              <ToolInvocationComponent
                key={index}
                toolInvocation={part.toolInvocation}
              />
            );
          }

          // Tool invocation in "tool-*" format (from AI SDK useChat)
          if (typeof part.type === "string" && part.type.startsWith("tool-")) {
            // Extract tool invocation data from part
            const toolInvocation = {
              toolCallId: part.toolCallId,
              toolName: part.type.replace("tool-", ""),
              state: part.state,
              input: part.input,  // Use 'input' instead of 'args'
              output: part.output,  // Use 'output' instead of 'result'
            };
            return (
              <ToolInvocationComponent
                key={index}
                toolInvocation={toolInvocation}
              />
            );
          }

          // Step markers (Gemini 3 Pro feature) - skip or show minimal indicator
          if (part.type === "step-start" || part.type === "step-end") {
            return null; // Don't display step markers
          }

          // Unknown part type - debug view
          return (
            <details
              key={index}
              style={{
                padding: "0.5rem",
                borderRadius: "4px",
                background: "#0a0a0a",
                border: "1px solid #6b7280",
                fontSize: "0.875rem",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: "#9ca3af",
                  userSelect: "none",
                }}
              >
                Unknown part type: {part.type}
              </summary>
              <pre
                style={{
                  marginTop: "0.5rem",
                  padding: "0.5rem",
                  background: "#1a1a1a",
                  borderRadius: "4px",
                  overflow: "auto",
                  color: "#d1d5db",
                }}
              >
                {JSON.stringify(part, null, 2)}
              </pre>
            </details>
          );
        })}

        {/* AI SDK v6: All content is in parts array, no content property */}
      </div>

      {/* Usage Metadata (if available) */}
      {message.usage && (
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #374151",
            fontSize: "0.75rem",
            color: "#6b7280",
            display: "flex",
            gap: "1rem",
          }}
        >
          <span>
            📊 Tokens:{" "}
            <span style={{ color: "#9ca3af" }}>
              {message.usage.promptTokens} in
            </span>
            {" + "}
            <span style={{ color: "#9ca3af" }}>
              {message.usage.completionTokens} out
            </span>
            {" = "}
            <span style={{ fontWeight: 600, color: "#d1d5db" }}>
              {message.usage.totalTokens} total
            </span>
          </span>
        </div>
      )}

      {/* Tool Invocations Summary (if available) */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          {message.toolInvocations.map((toolInvocation, index) => (
            <ToolInvocationComponent
              key={index}
              toolInvocation={toolInvocation}
            />
          ))}
        </div>
      )}
    </div>
  );
}
