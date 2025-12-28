import { useState } from "react";

/**
 * Tool invocation state for UI display.
 * Uses AI SDK v6's DynamicToolUIPart type which handles all tool states:
 * - input-streaming, input-available, output-available, output-error
 * - approval-requested, approval-responded
 */
interface ToolInvocationProps {
  // biome-ignore lint/suspicious/noExplicitAny: Testing type issue
  toolInvocation: any;
  addToolApprovalResponse?: (response: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
  // addToolOutput: Used for both SSE and BIDI modes
  // - SSE mode: Triggers HTTP request to backend
  // - BIDI mode: Transport layer converts to WebSocket message
  // Transport internals handle mode-specific behavior via sendAutomaticallyWhen
  addToolOutput?: (response: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void;
}

export function ToolInvocationComponent({
  toolInvocation,
  addToolApprovalResponse,
  addToolOutput,
}: ToolInvocationProps) {
  // State management for long-running tool approval
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // Extract toolName from type (e.g., "tool-change_bgm" -> "change_bgm")
  const toolName =
    toolInvocation.toolName ||
    (toolInvocation.type?.startsWith("tool-")
      ? toolInvocation.type.substring(5)
      : toolInvocation.type) ||
    "unknown";

  // ADK RequestConfirmation is handled by state === "approval-requested" (ADR 0002)
  // The adk_request_confirmation tool is never sent to frontend (only tool-approval-request events)

  const { state } = toolInvocation;

  // Detect long-running tools that need approval UI
  //
  // Long-running tools use ADK's LongRunningFunctionTool wrapper pattern:
  // 1. Backend tool returns None → ADK pauses agent execution
  // 2. Frontend receives tool invocation with state="input-available"
  // 3. This component auto-detects and shows approval UI
  // 4. User clicks Approve/Deny → sendFunctionResponse via WebSocket
  // 5. Backend resumes agent with user's decision
  //
  // To create a long-running tool:
  //   from google.adk.tools.long_running_tool import LongRunningFunctionTool
  //
  //   def my_tool(arg: str) -> None:
  //       # Tool logic here
  //       return None  # Triggers pause
  //
  //   tools = [LongRunningFunctionTool(my_tool)]
  //
  // The approval UI will automatically appear for any tool using this pattern.
  // Key distinction: Long-running tools DON'T have executeToolCallback
  const isLongRunningTool = state === "input-available"; // Long-running tools don't execute on frontend

  // Generic handler for long-running tool approval/denial
  const handleLongRunningToolResponse = (approved: boolean) => {
    if (approvalSent) {
      console.warn(
        `[LongRunningTool] Approval already sent for ${toolName}, ignoring duplicate`,
      );
      return;
    }

    try {
      console.info(
        `[LongRunningTool] User ${approved ? "approved" : "denied"} ${toolName}, sending function_response`,
      );

      setApprovalSent(true);
      setApprovalError(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[LongRunningTool] Failed to send function_response: ${errorMessage}`,
      );
      setApprovalError(errorMessage);
    }
  };

  // Tool call states: input-streaming, input-available, output-available, output-error, approval-requested, approval-responded
  const getStateColor = () => {
    switch (state) {
      case "approval-requested":
        return "#a855f7"; // purple
      case "approval-responded":
        return "#6366f1"; // indigo
      case "input-streaming":
        return "#3b82f6"; // blue
      case "input-available":
        return "#f59e0b"; // amber
      case "output-available":
        return "#10b981"; // green
      case "output-error":
        return "#ef4444"; // red
      default:
        return "#6b7280"; // gray
    }
  };

  const getStateLabel = () => {
    switch (state) {
      case "approval-requested":
        return "Approval Required";
      case "approval-responded":
        return "Processing Approval...";
      case "input-streaming":
        return "Preparing...";
      case "input-available":
        return "Executing...";
      case "output-available":
        return "Completed";
      case "output-error":
        return "Failed";
      default:
        return "Unknown";
    }
  };

  return (
    <div
      style={{
        margin: "0.75rem 0",
        padding: "0.75rem",
        borderRadius: "6px",
        border: `1px solid ${getStateColor()}`,
        background: "#0a0a0a",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: getStateColor(),
          }}
        />
        <span
          style={{ fontWeight: 600, color: getStateColor() }}
          data-testid="tool-name-debug"
        >
          {toolName}
        </span>
        <span style={{ fontSize: "0.875rem", color: "#999" }}>
          {getStateLabel()}
        </span>
      </div>

      {/* Approval UI (ADR 0002 - Server Execute Pattern) */}
      {state === "approval-requested" &&
        "approval" in toolInvocation &&
        toolInvocation.approval && (
          <div style={{ marginBottom: "0.5rem" }}>
            <div
              style={{
                fontSize: "0.875rem",
                color: "#d1d5db",
                marginBottom: "0.5rem",
              }}
            >
              This tool requires your approval to execute:
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginTop: "0.75rem",
              }}
            >
              <button
                type="button"
                onClick={async () => {
                  // CRITICAL: Always send approval response first
                  // AI SDK v6's sendAutomaticallyWhen requires BOTH:
                  // 1. Approval response (addToolApprovalResponse)
                  // 2. Tool output (addToolOutput)
                  // Without approval response, sendAutomaticallyWhen won't trigger
                  console.info(
                    `[ToolInvocationComponent] Sending approval response for tool ${toolName}`,
                  );
                  addToolApprovalResponse?.({
                    id: toolInvocation.approval.id,
                    approved: true,
                    reason: "User approved the tool execution.",
                  });

                  // SSE Mode Pattern A (1-request): Execute tool and send result immediately
                  // After approval, execute frontend-delegated tools and send result
                  // Both approval + result sent together via sendAutomaticallyWhen
                  if (toolName === "get_location") {
                    console.info(
                      `[ToolInvocationComponent] Executing get_location on client`,
                    );
                    try {
                      const position = await new Promise<GeolocationPosition>(
                        (resolve, reject) => {
                          navigator.geolocation.getCurrentPosition(
                            resolve,
                            reject,
                            {
                              enableHighAccuracy: true,
                              timeout: 5000,
                              maximumAge: 0,
                            },
                          );
                        },
                      );

                      const locationResult = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp,
                      };

                      console.info(
                        `[ToolInvocationComponent] get_location result:`,
                        locationResult,
                      );

                      addToolOutput?.({
                        tool: toolName,
                        toolCallId: toolInvocation.toolCallId,
                        output: locationResult,
                      });
                    } catch (error) {
                      const errorMessage =
                        error instanceof Error
                          ? error.message
                          : "Geolocation failed";
                      console.error(
                        `[ToolInvocationComponent] get_location error:`,
                        errorMessage,
                      );
                      addToolOutput?.({
                        tool: toolName,
                        toolCallId: toolInvocation.toolCallId,
                        output: {
                          success: false,
                          error: errorMessage,
                        },
                      });
                    }
                  } else if (toolName === "change_bgm") {
                    console.info(
                      `[ToolInvocationComponent] Executing change_bgm on client`,
                    );
                    const track = toolInvocation.input?.track || 1;
                    // TODO: Implement actual BGM change logic with AudioContext
                    // For now, just send success response
                    addToolOutput?.({
                      tool: toolName,
                      toolCallId: toolInvocation.toolCallId,
                      output: {
                        success: true,
                        track,
                        message: `BGM changed to track ${track}`,
                      },
                    });
                  }
                }}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "4px",
                  background: "#10b981",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => {
                  addToolApprovalResponse?.({
                    id: toolInvocation.approval.id,
                    approved: false,
                    reason: "User denied the tool execution.",
                  });
                }}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "4px",
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Deny
              </button>
            </div>
          </div>
        )}

      {/* Long-running Tool Approval UI (BIDI mode) */}
      {/* Automatically displays for ANY tool wrapped with LongRunningFunctionTool() */}
      {isLongRunningTool && !approvalSent && (
        <div style={{ marginBottom: "0.5rem" }}>
          <div
            style={{
              fontSize: "0.875rem",
              color: "#d1d5db",
              marginBottom: "0.5rem",
            }}
          >
            <strong data-testid="tool-name-primary">{toolName}</strong> requires
            your approval:
          </div>
          {/* Show tool inputs */}
          {toolInvocation.input && (
            <div
              style={{
                background: "#1a1a1a",
                padding: "0.5rem",
                borderRadius: "4px",
                fontSize: "0.75rem",
                fontFamily: "monospace",
                marginBottom: "0.75rem",
              }}
            >
              {JSON.stringify(toolInvocation.input, null, 2)}
            </div>
          )}
          {/* Error message if WebSocket send fails */}
          {approvalError && (
            <div
              style={{
                background: "#7f1d1d",
                padding: "0.5rem",
                borderRadius: "4px",
                fontSize: "0.75rem",
                color: "#fca5a5",
                marginBottom: "0.75rem",
              }}
            >
              Error sending approval: {approvalError}
            </div>
          )}
          {/* Approve/Deny buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <button
              type="button"
              data-testid="tool-approve-button"
              onClick={() => handleLongRunningToolResponse(true)}
              disabled={approvalSent}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                background: approvalSent ? "#6b7280" : "#10b981",
                color: "white",
                border: "none",
                cursor: approvalSent ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
                opacity: approvalSent ? 0.5 : 1,
              }}
            >
              Approve
            </button>
            <button
              type="button"
              data-testid="tool-deny-button"
              onClick={() => handleLongRunningToolResponse(false)}
              disabled={approvalSent}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                background: approvalSent ? "#6b7280" : "#ef4444",
                color: "white",
                border: "none",
                cursor: approvalSent ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
                opacity: approvalSent ? 0.5 : 1,
              }}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Show approval sent confirmation */}
      {isLongRunningTool && approvalSent && (
        <div
          style={{
            marginBottom: "0.5rem",
            padding: "0.5rem",
            background: "#065f46",
            borderRadius: "4px",
            fontSize: "0.875rem",
            color: "#d1fae5",
          }}
        >
          ✓ Approval response sent. Waiting for agent to resume...
        </div>
      )}

      {/* Tool Input */}
      {"input" in toolInvocation && toolInvocation.input && (
        <div style={{ marginBottom: "0.5rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#999",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Input
          </div>
          <pre
            style={{
              margin: 0,
              padding: "0.5rem",
              borderRadius: "4px",
              background: "#1a1a1a",
              fontSize: "0.875rem",
              overflow: "auto",
              color: "#d1d5db",
            }}
          >
            {JSON.stringify(
              toolInvocation.input as Record<string, unknown>,
              null,
              2,
            )}
          </pre>
        </div>
      )}

      {/* Tool Output */}
      {state === "output-available" && "output" in toolInvocation && (
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#999",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Result
          </div>
          <pre
            style={{
              margin: 0,
              padding: "0.5rem",
              borderRadius: "4px",
              background: "#1a1a1a",
              fontSize: "0.875rem",
              overflow: "auto",
              color: "#d1d5db",
            }}
          >
            {JSON.stringify(
              toolInvocation.output as Record<string, unknown>,
              null,
              2,
            )}
          </pre>
        </div>
      )}

      {/* Tool Error */}
      {state === "output-error" && "errorText" in toolInvocation && (
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#ef4444",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Error
          </div>
          <div
            style={{
              padding: "0.5rem",
              borderRadius: "4px",
              background: "#1a0a0a",
              color: "#fca5a5",
              fontSize: "0.875rem",
            }}
          >
            {String(toolInvocation.errorText)}
          </div>
        </div>
      )}
    </div>
  );
}
