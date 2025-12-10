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

interface MessageComponentProps {
  message: Message;
}

export function MessageComponent({ message }: MessageComponentProps) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        marginBottom: "1rem",
        padding: "0.75rem",
        borderRadius: "8px",
        background: isUser ? "#1a2332" : "#1a2e1a",
      }}
    >
      {/* Message Header */}
      <div
        style={{
          fontWeight: "bold",
          marginBottom: "0.5rem",
          color: isUser ? "#60a5fa" : "#4ade80",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span>{isUser ? "You" : "Assistant"}</span>

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

      {/* Message Parts */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {message.parts?.map((part: any, index: number) => {
          // Text content
          if (part.type === "text") {
            return (
              <div
                key={index}
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

          // Tool Invocation (any tool)
          if (part.type === "tool-call" && part.toolInvocation) {
            return (
              <ToolInvocationComponent
                key={index}
                toolInvocation={part.toolInvocation}
              />
            );
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
