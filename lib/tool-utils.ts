/**
 * Tool Utilities - Shared tool name extraction and Frontend Execute detection
 *
 * Centralizes tool-related logic per ADR 0005 (Frontend Execute pattern).
 * This module provides:
 * - Tool name extraction from AI SDK v6 parts
 * - Frontend Execute tool detection with extensible registry
 *
 * @module tool-utils
 */

// ============================================================================
// Tool Name Extraction
// ============================================================================

/**
 * Extract tool name from AI SDK v6 tool part.
 * Handles both `toolName` field and `tool-{name}` type format.
 *
 * @param part - Tool part with optional type and toolName fields
 * @param fallback - Value to return if tool name cannot be extracted (default: "")
 * @returns Extracted tool name or fallback value
 *
 * @example
 * extractToolName({ type: "tool-get_location" }) // "get_location"
 * extractToolName({ toolName: "process_payment" }) // "process_payment"
 * extractToolName({}, "unknown") // "unknown"
 */
export function extractToolName(
  part: { type?: string; toolName?: string },
  fallback = "",
): string {
  if (part.toolName) {
    return part.toolName;
  }
  if (part.type?.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return fallback;
}

/**
 * Extract tool name from type string only.
 *
 * @param type - Type string (e.g., "tool-get_location")
 * @returns Extracted tool name or original type if not a tool type
 *
 * @example
 * extractToolNameFromType("tool-get_location") // "get_location"
 * extractToolNameFromType("text") // "text"
 */
export function extractToolNameFromType(type: string): string {
  if (type.startsWith("tool-")) {
    return type.slice(5);
  }
  return type;
}

/**
 * Type guard: Check if type starts with "tool-" prefix.
 *
 * @param type - Type string to check
 * @returns true if type starts with "tool-"
 */
export function isToolType(type: string): type is `tool-${string}` {
  return type.startsWith("tool-");
}

// ============================================================================
// Frontend Execute Detection (ADR 0005) - Extensible Design
// ============================================================================

/**
 * Browser API category for Frontend Execute tools.
 */
export type FrontendExecuteCategory =
  | "geolocation"
  | "camera"
  | "microphone"
  | "notification"
  | "clipboard"
  | "other";

/**
 * Frontend Execute Tool Definition.
 * Extensible structure for tools that require browser APIs.
 */
export interface FrontendExecuteToolDefinition {
  /** Tool name (e.g., "get_location") */
  name: string;
  /** Browser API category for documentation/grouping */
  category: FrontendExecuteCategory;
  /** Human-readable description */
  description?: string;
}

/**
 * Default Frontend Execute tools (built-in).
 * These tools require browser APIs and need addToolOutput() from frontend.
 */
const DEFAULT_FRONTEND_EXECUTE_TOOLS: FrontendExecuteToolDefinition[] = [
  {
    name: "get_location",
    category: "geolocation",
    description: "Uses navigator.geolocation",
  },
  {
    name: "take_photo",
    category: "camera",
    description: "Uses camera API",
  },
  {
    name: "get_camera",
    category: "camera",
    description: "Uses camera API",
  },
];

/**
 * Internal registry for Frontend Execute tools.
 * Mutable to allow runtime extension via registerFrontendExecuteTool().
 */
const frontendExecuteToolRegistry = new Map<
  string,
  FrontendExecuteToolDefinition
>();

// Initialize with defaults
for (const tool of DEFAULT_FRONTEND_EXECUTE_TOOLS) {
  frontendExecuteToolRegistry.set(tool.name, tool);
}

/**
 * Register a custom Frontend Execute tool.
 * Use this when adding new browser-API tools at runtime or in app initialization.
 *
 * @param tool - Tool definition to register
 *
 * @example
 * registerFrontendExecuteTool({
 *   name: "get_clipboard",
 *   category: "clipboard",
 *   description: "Uses navigator.clipboard API"
 * });
 */
export function registerFrontendExecuteTool(
  tool: FrontendExecuteToolDefinition,
): void {
  frontendExecuteToolRegistry.set(tool.name, tool);
}

/**
 * Check if tool requires Frontend Execute pattern.
 * Checks against both built-in and custom registered tools.
 *
 * Frontend Execute tools:
 * - Use browser APIs (geolocation, camera, etc.)
 * - Need addToolOutput() called by frontend after approval
 * - Differ from Server Execute tools which are handled by backend
 *
 * @param toolName - Name of the tool to check
 * @returns true if tool requires Frontend Execute pattern
 */
export function isFrontendExecuteTool(toolName: string): boolean {
  return frontendExecuteToolRegistry.has(toolName);
}

/**
 * Get all registered Frontend Execute tools.
 * Useful for UI display or debugging.
 *
 * @returns Array of all registered tool definitions
 */
export function getFrontendExecuteTools(): readonly FrontendExecuteToolDefinition[] {
  return Array.from(frontendExecuteToolRegistry.values());
}

/**
 * Get Frontend Execute tools by category.
 *
 * @param category - Browser API category to filter by
 * @returns Array of tool definitions in the specified category
 *
 * @example
 * getFrontendExecuteToolsByCategory("camera") // [{ name: "take_photo", ... }, { name: "get_camera", ... }]
 */
export function getFrontendExecuteToolsByCategory(
  category: FrontendExecuteCategory,
): readonly FrontendExecuteToolDefinition[] {
  return Array.from(frontendExecuteToolRegistry.values()).filter(
    (tool) => tool.category === category,
  );
}

/**
 * Clear all registered Frontend Execute tools and reset to defaults.
 * Primarily for testing purposes.
 */
export function resetFrontendExecuteTools(): void {
  frontendExecuteToolRegistry.clear();
  for (const tool of DEFAULT_FRONTEND_EXECUTE_TOOLS) {
    frontendExecuteToolRegistry.set(tool.name, tool);
  }
}
