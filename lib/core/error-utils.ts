/**
 * Error utility functions for handling API errors
 */

/**
 * Error types that can occur in the application
 */
export enum ErrorType {
  RATE_LIMIT = "RATE_LIMIT",
  NETWORK = "NETWORK",
  VALIDATION = "VALIDATION",
  AUTHENTICATION = "AUTHENTICATION",
  UNKNOWN = "UNKNOWN",
}

/**
 * Checks if an error is a rate limit error
 * Rate limit errors can be identified by:
 * - HTTP status code 429
 * - Error message containing "RESOURCE_EXHAUSTED"
 * - Error message containing "quota exceeded" or "rate limit"
 */
export function isRateLimitError(error: Error | unknown): boolean {
  if (!error) return false;

  const errorMessage =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  // Check for common rate limit indicators
  const rateLimitIndicators = [
    "resource_exhausted",
    "resource exhausted",
    "quota exceeded",
    "rate limit",
    "429",
    "too many requests",
  ];

  return rateLimitIndicators.some((indicator) =>
    errorMessage.includes(indicator),
  );
}

/**
 * Classify error type
 */
export function classifyError(error: Error | unknown): ErrorType {
  if (!error) return ErrorType.UNKNOWN;

  if (isRateLimitError(error)) {
    return ErrorType.RATE_LIMIT;
  }

  const errorMessage =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (
    errorMessage.includes("network") ||
    errorMessage.includes("fetch") ||
    errorMessage.includes("connection")
  ) {
    return ErrorType.NETWORK;
  }

  if (
    errorMessage.includes("validation") ||
    errorMessage.includes("invalid") ||
    errorMessage.includes("422")
  ) {
    return ErrorType.VALIDATION;
  }

  if (
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("401") ||
    errorMessage.includes("403")
  ) {
    return ErrorType.AUTHENTICATION;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Extract retry-after time from error (if available)
 * Returns time in seconds, or null if not available
 */
export function getRetryAfter(error: Error | unknown): number | null {
  if (!error) return null;

  const errorMessage = error instanceof Error ? error.message : String(error);

  // Try to extract retry-after from error message
  const retryMatch = errorMessage.match(
    /retry.*?(\d+)\s*(second|minute|hour)/i,
  );
  if (retryMatch) {
    const value = parseInt(retryMatch[1], 10);
    const unit = retryMatch[2].toLowerCase();

    switch (unit) {
      case "second":
        return value;
      case "minute":
        return value * 60;
      case "hour":
        return value * 3600;
    }
  }

  return null;
}
