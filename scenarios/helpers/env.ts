/**
 * Environment variable helpers for Playwright E2E tests
 *
 * @module scenarios/helpers/env
 */

/**
 * Get chunk logger session ID from environment variables
 * Checks both NEXT_PUBLIC_ prefixed (client-side) and non-prefixed (server-side) variants
 *
 * @param defaultValue - Default value if no env var is set
 * @returns Session ID from environment or default value
 */
export function getChunkLoggerSessionId(defaultValue = "e2e-test"): string {
  return (
    process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
    process.env.CHUNK_LOGGER_SESSION_ID ||
    defaultValue
  );
}

/**
 * Check if chunk logger is enabled
 *
 * @returns true if NEXT_PUBLIC_CHUNK_LOGGER_ENABLED is set to "true"
 */
export function isChunkLoggerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHUNK_LOGGER_ENABLED === "true";
}

/**
 * Get server URL for E2E tests
 *
 * @param defaultUrl - Default server URL
 * @returns Server URL from environment or default
 */
export function getServerUrl(defaultUrl = "http://localhost:8000"): string {
  return process.env.SERVER_URL || defaultUrl;
}

/**
 * Get all chunk logger configuration from environment
 *
 * @param defaults - Default configuration values
 * @returns Chunk logger configuration object
 */
export interface ChunkLoggerConfig {
  enabled?: boolean | string;
  sessionId?: string;
}

export function getChunkLoggerConfig(
  defaults: ChunkLoggerConfig = {},
): ChunkLoggerConfig {
  return {
    enabled: process.env.NEXT_PUBLIC_CHUNK_LOGGER_ENABLED ?? defaults.enabled,
    sessionId:
      process.env.NEXT_PUBLIC_CHUNK_LOGGER_SESSION_ID ||
      process.env.CHUNK_LOGGER_SESSION_ID ||
      defaults.sessionId,
  };
}
