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
import type { DynamicToolUIPart } from "ai";
import { useAudio } from "@/lib/audio-context";
import { ImageDisplay } from "./image-display";
import { ToolInvocationComponent } from "./tool-invocation";

// Extended UIMessage with metadata properties
interface ExtendedUIMessage extends UIMessage {
  status?: string;
  metadata?: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    grounding?: {
      sources: Array<{
        title?: string;
        uri?: string;
      }>;
    };
    citations?: Array<{
      text?: string;
      sources?: Array<{ uri?: string }>;
      startIndex?: number;
      endIndex?: number;
      uri?: string;
      license?: string;
    }>;
    cache?: {
      hits: number;
      misses: number;
    };
    modelVersion?: string;
  };
  toolInvocations?: DynamicToolUIPart[];
}

interface MessageComponentProps {
  message: UIMessage;
  addToolApprovalResponse?: (response: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
  addToolOutput?: (response: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void;
  executeToolCallback?: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  // POC Phase 3: WebSocket transport for function_response injection
  websocketTransport?: {
    sendFunctionResponse: (
      toolCallId: string,
      toolName: string,
      response: Record<string, unknown>,
    ) => void;
    sendToolResult: (
      toolCallId: string,
      result: Record<string, unknown>,
    ) => void;
  };
}

export function MessageComponent({
  message,
  addToolApprovalResponse,
  addToolOutput,
  executeToolCallback,
  websocketTransport,
}: MessageComponentProps) {
  const isUser = message.role === "user";
  const audioContext = useAudio();
  const extendedMessage = message as ExtendedUIMessage;

  // Hide empty user messages that are created just for continuation after tool approval
  // These messages have no content and are just used to trigger the next step
  // if (isUser) {
  //   const hasContent = message.content && message.content.length > 0;
  //   const hasAttachments =
  //     message.experimental_attachments &&
  //     message.experimental_attachments.length > 0;
  //   const hasToolInvocations =
  //     message.toolInvocations && message.toolInvocations.length > 0;

  //   if (!hasContent && !hasAttachments && !hasToolInvocations) {
  //     console.debug(
  //       "[MessageComponent] Hiding empty user message used for continuation",
  //     );
  //     return null; // Don't render empty user messages
  //   }
  // }

  // Check if this assistant message has audio (ADK BIDI mode)
  // Audio is detected by AudioContext chunk count, not message.parts
  // (PCM chunks go directly to AudioWorklet, bypassing message stream)
  const hasAudio =
    message.role === "assistant" && audioContext.voiceChannel.chunkCount > 0;

  // Hide empty user messages that are created just for continuation after tool approval
  const isDelegateEmptyUserMessage =
    isUser &&
    message.parts?.length === 1 &&
    message.parts[0].type === "text" &&
    !message.parts[0].text;

  return (
    !isDelegateEmptyUserMessage && (
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
          <span data-testid="message-sender">
            {isUser ? "You" : "Assistant"}
          </span>

          {/* Status indicator for streaming */}
          {extendedMessage.status === "in_progress" && (
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
          {message.parts?.map((part, index) => {
            // Text content
            // [P3-T1] Live API Transcriptions display here as text-delta events
            // - Input transcription: User audio → text (BIDI mode, ADK Live API)
            // - Output transcription: AI audio → text (native-audio models)
            // Backend converts transcription events to text-start/text-delta/text-end
            if (part.type === "text") {
              return (
                <div
                  key={`${message.id}-${index}-${part.type}-text`}
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
                  key={`${message.id}-${index}-${part.type}-reasoning`}
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
                    {part.text}
                  </div>
                </details>
              );
            }

            // File content - Image (AI SDK v6 file part)
            if (part.type === "file" && part.mediaType?.startsWith("image/")) {
              return (
                // biome-ignore lint/performance/noImgElement: File part URLs may be data URLs
                <img
                  key={`${message.id}-${index}-${part.type}-file-image`}
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
                  key={`${message.id}-${index}-${part.type}-file-audio`}
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
                  {/* biome-ignore lint/a11y/useMediaCaption: Audio files don't have transcript */}
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
              const imageData = part.data as {
                content: string;
                mediaType: string;
              };
              return (
                <ImageDisplay
                  key={`${message.id}-${index}-${part.type}-data-image`}
                  content={imageData.content}
                  mediaType={imageData.mediaType}
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
            if (
              part.type === "tool-call" &&
              "toolInvocation" in part &&
              part.toolInvocation
            ) {
              // biome-ignore lint/suspicious/noExplicitAny: Dynamic tool invocation structure
              const toolInvocation = part.toolInvocation as any;
              return (
                <ToolInvocationComponent
                  key={`${message.id}-${index}-${part.type}-tool-call`}
                  toolInvocation={toolInvocation}
                  addToolApprovalResponse={addToolApprovalResponse}
                  addToolOutput={addToolOutput}
                  executeToolCallback={executeToolCallback}
                  websocketTransport={websocketTransport}
                />
              );
            }

            // Tool invocation in "tool-*" format (from AI SDK useChat)
            if (
              typeof part.type === "string" &&
              part.type.startsWith("tool-") &&
              "toolCallId" in part &&
              "state" in part
            ) {
              // Extract tool invocation data from part
              // biome-ignore lint/suspicious/noExplicitAny: Dynamic tool invocation structure
              const toolInvocation: any = {
                // TODO: このtypeってわざわざ必要？
                type: "dynamic-tool",
                toolCallId: part.toolCallId,
                toolName: part.type.replace("tool-", ""),
                state: part.state,
                input: "input" in part ? part.input : undefined,
                output: "output" in part ? part.output : undefined,
                approval: "approval" in part ? part.approval : undefined,
                errorText: "errorText" in part ? part.errorText : undefined,
              };
              return (
                <ToolInvocationComponent
                  key={part.toolCallId}
                  toolInvocation={toolInvocation}
                  addToolApprovalResponse={addToolApprovalResponse}
                  addToolOutput={addToolOutput}
                  executeToolCallback={executeToolCallback}
                  websocketTransport={websocketTransport}
                />
              );
            }

            // Step markers (Gemini 3 Pro feature) - skip or show minimal indicator
            // Note: step-start/step-end are not in current type definitions but may appear in runtime
            if (
              typeof part.type === "string" &&
              // biome-ignore lint/suspicious/noExplicitAny: Dynamic part type
              ((part as any).type === "step-start" ||
                // biome-ignore lint/suspicious/noExplicitAny: Dynamic part type
                (part as any).type === "step-end")
            ) {
              return null; // Don't display step markers
            }

            // Unknown part type - debug view
            return (
              <details
                key={`${message.id}-${index}-unknown`}
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
        {extendedMessage.metadata?.usage && (
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
                {extendedMessage.metadata.usage.promptTokens} in
              </span>
              {" + "}
              <span style={{ color: "#9ca3af" }}>
                {extendedMessage.metadata.usage.completionTokens} out
              </span>
              {" = "}
              <span style={{ fontWeight: 600, color: "#d1d5db" }}>
                {extendedMessage.metadata.usage.totalTokens} total
              </span>
            </span>
          </div>
        )}

        {/* Grounding Sources (RAG, Web Search) */}
        {extendedMessage.metadata?.grounding?.sources && (
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
              🔍 Sources ({extendedMessage.metadata.grounding.sources.length}):
            </div>
            {extendedMessage.metadata.grounding.sources.map((source, idx) => (
              <div
                key={`source-${source.uri}-${idx}`}
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
            ))}
          </div>
        )}

        {/* Citations */}
        {extendedMessage.metadata?.citations && (
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
              📝 Citations ({extendedMessage.metadata.citations.length}):
            </div>
            {extendedMessage.metadata.citations.map((citation, idx) => (
              <div
                key={`metadata-citation-${citation.uri}-${citation.startIndex}-${idx}`}
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
            ))}
          </div>
        )}

        {/* Cache Metadata */}
        {extendedMessage.metadata?.cache && (
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
                {extendedMessage.metadata.cache.hits} hits
              </span>
              {" / "}
              <span style={{ color: "#ef4444" }}>
                {extendedMessage.metadata.cache.misses} misses
              </span>
            </span>
          </div>
        )}

        {/* Model Version */}
        {extendedMessage.metadata?.modelVersion && (
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
                {extendedMessage.metadata.modelVersion}
              </span>
            </span>
          </div>
        )}

        {/* Tool Invocations Summary (if available) */}
        {extendedMessage.toolInvocations &&
          extendedMessage.toolInvocations.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              {extendedMessage.toolInvocations.map((toolInvocation) => (
                <ToolInvocationComponent
                  key={`toolInvocation-${toolInvocation.toolCallId}`}
                  toolInvocation={toolInvocation}
                  addToolApprovalResponse={addToolApprovalResponse}
                  addToolOutput={addToolOutput}
                  executeToolCallback={executeToolCallback}
                  websocketTransport={websocketTransport}
                />
              ))}
            </div>
          )}
      </div>
    )
  );
}
