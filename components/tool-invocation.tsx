/**
 * Tool Invocation Component
 *
 * Displays tool calls and their results with visual states.
 * Handles all tool visualization complexity internally.
 */

interface ToolInvocationProps {
  toolInvocation: any;
}

export function ToolInvocationComponent({
  toolInvocation,
}: ToolInvocationProps) {
  const { toolName, state } = toolInvocation;

  // Tool call states: input-streaming, input-available, output-available, output-error
  const getStateColor = () => {
    switch (state) {
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
          {toolName}
        </span>
        <span style={{ fontSize: "0.875rem", color: "#888" }}>
          {getStateLabel()}
        </span>
      </div>

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
            {JSON.stringify(toolInvocation.input, null, 2)}
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
            {JSON.stringify(toolInvocation.output, null, 2)}
          </pre>
        </div>
      )}

      {/* Tool Error */}
      {state === "output-error" && "error" in toolInvocation && (
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
            {String(toolInvocation.error)}
          </div>
        </div>
      )}
    </div>
  );
}
