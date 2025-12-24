/**
 * Type Definitions - Central Export
 *
 * This module serves as the central export point for all type definitions
 * used throughout the AI Data Protocol library. Import types from here
 * to ensure consistent type usage across the codebase.
 *
 * Type Categories:
 * - common.ts: Backend modes, chunk logging, audio context
 * - ui-message-chunk.ts: Extended UI message chunk types for AI SDK v6
 */

// Common type definitions (backend modes, chunk logging, audio context)
export * from "./common";

// UI Message Chunk types (AI SDK v6 compatibility layer)
export * from "./ui-message-chunk";
