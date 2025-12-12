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

import type { UIMessage } from "@ai-sdk/react";
import { useAudio } from "@/lib/audio-context";
import { ImageDisplay } from "./image-display";
import { ToolInvocationComponent } from "./tool-invocation";

interface MessageComponentProps {
  message: UIMessage;
}

export function MessageComponent({ message }: MessageComponentProps) {
  const isUser = message.role === "user";
  const audioContext = useAudio();

  // Check if this assistant message has audio (ADK BIDI mode)
  // Audio is detected by AudioContext chunk count, not message.parts
  // (PCM chunks go directly to AudioWorklet, bypassing message stream)
  const hasAudio =
    message.role === "assistant" && audioContext.voiceChannel.chunkCount > 0;

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
        {(message as any).status === "in_progress" && (
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
      <div
        data-testid="message-content"
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      >
        {/* Handle experimental_attachments (legacy v5 format - kept for backward compatibility) */}
        {/* Note: AI SDK v6 converts files to parts array, so this is rarely used */}
        {(message as any).experimental_attachments?.map(
          (attachment: any, index: number) => {
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
          },
        )}

        {/* Audio status indicator (ADK BIDI mode) */}
        {hasAudio && (
          <div
            style={{
              margin: "0.75rem 0",
              padding: "0.75rem",
              borderRadius: "6px",
              background: "#0a0a0a",
              border: "1px solid #6366f1",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "#818cf8",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: audioContext.voiceChannel.isPlaying
                    ? "#10b981"
                    : "#6b7280",
                }}
              />
              <span style={{ fontWeight: 600 }}>
                {audioContext.voiceChannel.isPlaying
                  ? "🔊 Playing Audio"
                  : "🔇 Audio Ready"}
              </span>
              <span style={{ fontSize: "0.875rem", color: "#888" }}>
                ({audioContext.voiceChannel.chunkCount} chunks)
              </span>
            </div>

            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              AudioWorklet streaming (24kHz, 16-bit PCM)
            </div>
          </div>
        )}

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

          // File content - Image (AI SDK v6 file part)
          if (part.type === "file" && part.mediaType?.startsWith("image/")) {
            return (
              <img
                key={index}
                src={part.url}
                alt={part.filename || "Image"}
                style={{
                  maxWidth: "300px",
                  width: "100%",
                  borderRadius: "8px",
                  marginTop: "0.5rem",
                }}
              />
            );
          }

          // File content - Audio (AI SDK v6 file part)
          if (part.type === "file" && part.mediaType?.startsWith("audio/")) {
            return (
              <div
                key={index}
                style={{
                  margin: "0.75rem 0",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  background: "#0a0a0a",
                  border: "1px solid #10b981",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                    color: "#10b981",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                  }}
                >
                  <span>🎵</span>
                  <span>Recorded Audio</span>
                </div>
                <audio
                  controls
                  src={part.url}
                  style={{
                    width: "100%",
                    maxWidth: "400px",
                  }}
                >
                  Your browser does not support the audio element.
                </audio>
                <div
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.75rem",
                    color: "#6b7280",
                  }}
                >
                  Format: {part.mediaType}
                </div>
              </div>
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

          // PCM audio content (data-pcm custom event) - Should not appear here
          // (bypassed to AudioWorklet in BIDI mode)
          if (part.type === "data-pcm" && part.data) {
            console.warn(
              "[MessageComponent] data-pcm in message.parts (should be bypassed to AudioWorklet)",
            );
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
              input: part.input, // Use 'input' instead of 'args'
              output: part.output, // Use 'output' instead of 'result'
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
      {(message as any).metadata?.usage && (
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
              {(message as any).metadata.usage.promptTokens} in
            </span>
            {" + "}
            <span style={{ color: "#9ca3af" }}>
              {(message as any).metadata.usage.completionTokens} out
            </span>
            {" = "}
            <span style={{ fontWeight: 600, color: "#d1d5db" }}>
              {(message as any).metadata.usage.totalTokens} total
            </span>
          </span>
        </div>
      )}

      {/* Grounding Sources (RAG, Web Search) */}
      {(message as any).metadata?.grounding?.sources && (
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #374151",
            fontSize: "0.75rem",
            color: "#6b7280",
          }}
        >
          <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>
            🔍 Sources ({(message as any).metadata.grounding.sources.length}):
          </div>
          {(message as any).metadata.grounding.sources.map(
            (source: any, idx: number) => (
              <div
                key={idx}
                style={{
                  marginLeft: "1rem",
                  marginBottom: "0.25rem",
                  color: "#9ca3af",
                }}
              >
                <a
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#60a5fa",
                    textDecoration: "none",
                    wordBreak: "break-all",
                  }}
                >
                  {source.title || source.uri}
                </a>
              </div>
            ),
          )}
        </div>
      )}

      {/* Citations */}
      {(message as any).metadata?.citations && (
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #374151",
            fontSize: "0.75rem",
            color: "#6b7280",
          }}
        >
          <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>
            📝 Citations ({(message as any).metadata.citations.length}):
          </div>
          {(message as any).metadata.citations.map(
            (citation: any, idx: number) => (
              <div
                key={idx}
                style={{
                  marginLeft: "1rem",
                  marginBottom: "0.25rem",
                  color: "#9ca3af",
                }}
              >
                <a
                  href={citation.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#60a5fa",
                    textDecoration: "none",
                    wordBreak: "break-all",
                  }}
                >
                  [{citation.startIndex}-{citation.endIndex}] {citation.uri}
                </a>
                {citation.license && (
                  <span style={{ marginLeft: "0.5rem", color: "#6b7280" }}>
                    ({citation.license})
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {/* Cache Metadata */}
      {(message as any).metadata?.cache && (
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
            💾 Cache:{" "}
            <span style={{ color: "#10b981" }}>
              {(message as any).metadata.cache.hits} hits
            </span>
            {" / "}
            <span style={{ color: "#ef4444" }}>
              {(message as any).metadata.cache.misses} misses
            </span>
          </span>
        </div>
      )}

      {/* Model Version */}
      {(message as any).metadata?.modelVersion && (
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #374151",
            fontSize: "0.75rem",
            color: "#6b7280",
          }}
        >
          <span>
            🤖 Model:{" "}
            <span style={{ color: "#9ca3af" }}>
              {(message as any).metadata.modelVersion}
            </span>
          </span>
        </div>
      )}

      {/* Tool Invocations Summary (if available) */}
      {(message as any).toolInvocations &&
        (message as any).toolInvocations.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            {(message as any).toolInvocations.map(
              (toolInvocation: any, index: number) => (
                <ToolInvocationComponent
                  key={index}
                  toolInvocation={toolInvocation}
                />
              ),
            )}
          </div>
        )}
    </div>
  );
}
