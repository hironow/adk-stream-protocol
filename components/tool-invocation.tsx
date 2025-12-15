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
  executeToolCallback?: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>
  ) => Promise<boolean>;
}

export function ToolInvocationComponent({
  toolInvocation,
  addToolApprovalResponse,
  executeToolCallback,
}: ToolInvocationProps) {
  // Extract toolName from type (e.g., "tool-change_bgm" -> "change_bgm")
  const toolName = toolInvocation.toolName ||
    (toolInvocation.type?.startsWith('tool-') ?
      toolInvocation.type.substring(5) :
      toolInvocation.type) ||
    'unknown';
  const { state } = toolInvocation;

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
        <span style={{ fontWeight: 600, color: getStateColor() }}>
          {toolName} ({toolInvocation.type})
        </span>
        <span style={{ fontSize: "0.875rem", color: "#888" }}>
          {getStateLabel()}
        </span>
      </div>

      {JSON.stringify(toolInvocation)}

      {/* Approval UI */}
      {state === "approval-requested" && "approval" in toolInvocation && toolInvocation.approval && (
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
              onClick={async () => {
                let clientHandled = false;

                // Execute the tool on client if callback provided
                if (executeToolCallback) {
                  console.info(`[ToolInvocationComponent] Attempting to execute tool ${toolName} on client`);
                  clientHandled = await executeToolCallback(
                    toolName,
                    toolInvocation.toolCallId,
                    toolInvocation.input || {}
                  );
                }

                // Only send approval response if NOT handled by client
                // If handled by client, executeToolCallback calls addToolOutput which triggers the send
                // Calling addToolApprovalResponse here would cause a double-send and potential deadlock
                if (!clientHandled) {
                  console.info(`[ToolInvocationComponent] Tool ${toolName} not handled by client, sending approval response`);
                  addToolApprovalResponse?.({
                    id: toolInvocation.approval.id,
                    approved: true,
                    reason: "User approved the tool execution.",
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
              onClick={() =>
                addToolApprovalResponse?.({
                  id: toolInvocation.approval.id,
                  approved: false,
                  reason: "User denied the tool execution.",
                })
              }
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

      {/* Tool Input */}
      {"input" in toolInvocation && toolInvocation.input && (
        <div style={{ marginBottom: "0.5rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#888",
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
              color: "#888",
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
