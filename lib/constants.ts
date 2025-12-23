/**
 * Shared Constants for ADK AI Data Protocol
 *
 * This file consolidates constant values used across multiple modules
 * to ensure consistency and provide a single source of truth.
 *
 * Constants include:
 * - Tool names (ADK protocol)
 * - Backend mode values
 * - Protocol-specific identifiers
 */

/**
 * ADK Request Confirmation Tool Name
 *
 * Tool name used in ADK protocol for user confirmation requests.
 * This tool is invoked by the backend when an action requires explicit user approval.
 *
 * Format in message parts:
 * - Type: `tool-${TOOL_NAME_ADK_REQUEST_CONFIRMATION}`
 * - Example: "tool-adk_request_confirmation"
 */
export const TOOL_NAME_ADK_REQUEST_CONFIRMATION = "adk_request_confirmation";

/**
 * ADK Request Confirmation Tool Type
 *
 * Full type identifier used in UI message parts.
 * Combines "tool-" prefix with tool name.
 */
export const TOOL_TYPE_ADK_REQUEST_CONFIRMATION =
  `tool-${TOOL_NAME_ADK_REQUEST_CONFIRMATION}` as const;

/**
 * Backend Mode Values
 *
 * Available backend communication modes.
 * These values are used for mode selection and routing.
 */
export const MODE_GEMINI = "gemini" as const;
export const MODE_ADK_SSE = "adk-sse" as const;
export const MODE_ADK_BIDI = "adk-bidi" as const;

/**
 * All supported modes as a const array
 */
export const ALL_MODES = [MODE_GEMINI, MODE_ADK_SSE, MODE_ADK_BIDI] as const;

/**
 * SSE-specific modes
 */
export const SSE_MODES = [MODE_GEMINI, MODE_ADK_SSE] as const;
