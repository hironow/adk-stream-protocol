/**
 * RateLimitError component
 * Displays a user-friendly UI when API rate limit is exceeded
 */

import { getRetryAfter } from "../lib/core/error-utils";

export interface RateLimitErrorProps {
  error: Error;
}

export function RateLimitError({ error }: RateLimitErrorProps) {
  const retryAfter = getRetryAfter(error);

  return (
    <div
      data-testid="rate-limit-error"
      style={{
        margin: "1rem",
        padding: "1.5rem",
        borderRadius: "8px",
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
        color: "#991b1b",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* Icon */}
        <div
          style={{
            flexShrink: 0,
            fontSize: "1.5rem",
          }}
          role="img"
          aria-label="Warning"
        >
          ⚠️
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          <h3
            data-testid="rate-limit-error-title"
            style={{
              margin: 0,
              marginBottom: "0.5rem",
              fontSize: "1.125rem",
              fontWeight: 600,
            }}
          >
            API Rate Limit Exceeded
          </h3>

          <p
            data-testid="rate-limit-error-message"
            style={{
              margin: 0,
              marginBottom: "1rem",
              fontSize: "0.875rem",
              lineHeight: "1.5",
              color: "#7f1d1d",
            }}
          >
            You have exceeded the API rate limit or quota. Please wait a moment
            before sending more messages.
          </p>

          {retryAfter && (
            <p
              data-testid="rate-limit-error-retry-after"
              style={{
                margin: 0,
                marginBottom: "1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              Retry after: {retryAfter} seconds
            </p>
          )}

          {/* Suggestions */}
          <div
            style={{
              padding: "0.75rem",
              backgroundColor: "#fff",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}
          >
            <p
              style={{
                margin: 0,
                marginBottom: "0.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              What you can do:
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.25rem",
                fontSize: "0.875rem",
                lineHeight: "1.5",
              }}
            >
              <li>Wait a few minutes before trying again</li>
              <li>Reduce the frequency of your requests</li>
              <li>Check your API quota settings if this persists</li>
            </ul>
          </div>

          {/* Technical details (collapsed by default) */}
          <details
            style={{
              marginTop: "1rem",
              fontSize: "0.75rem",
              color: "#7f1d1d",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              Technical Details
            </summary>
            <pre
              data-testid="rate-limit-error-details"
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem",
                backgroundColor: "#fff",
                borderRadius: "4px",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
