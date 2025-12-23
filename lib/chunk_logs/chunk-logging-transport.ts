/**
 * Chunk Logging Transport Wrapper
 *
 * ⚪ ADK-Independent - Works with all modes (adk-bidi, adk-sse, gemini)
 *
 * Wraps any ChatTransport to log all chunks passing through the stream.
 * Used for debugging and testing across all backend modes.
 *
 * Dependencies:
 * - AI SDK v6 (ChatTransport interface)
 * - chunk-logger.ts (JSONL logging)
 *
 * Supported Modes:
 * - adk-bidi: Wraps WebSocketChatTransport
 * - adk-sse: Wraps DefaultChatTransport (SSE)
 * - gemini: Wraps DefaultChatTransport (Gemini Direct)
 */

import type {
  ChatRequestOptions,
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import { chunkLogger, type Mode } from "./chunk-logger";

/**
 * Transport wrapper that logs chunks while delegating to any ChatTransport.
 * Works with both DefaultChatTransport (SSE) and WebSocketChatTransport (BIDI).
 */
export class ChunkLoggingTransport implements ChatTransport<UIMessage> {
  private delegate: ChatTransport<UIMessage>;
  private mode: Mode;

  constructor(delegate: ChatTransport<UIMessage>, mode: Mode) {
    this.delegate = delegate;
    this.mode = mode;
  }

  async sendMessages(
    options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const delegateStream = await this.delegate.sendMessages(options);
    const mode = this.mode; // Capture mode for closure

    // Wrap the stream to log chunks
    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const reader = delegateStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Chunk Logger: Record useChat chunk
            chunkLogger.logChunk({
              location: "frontend-useChat-chunk",
              direction: "in",
              chunk: value,
              mode,
            });

            // Forward chunk to useChat
            controller.enqueue(value);
          }
          // Close controller, but handle case where it's already errored
          try {
            controller.close();
          } catch (closeErr) {
            console.debug(
              "[Chunk Logging Transport] Stream already closed or errored:",
              closeErr,
            );
          }
        } catch (error) {
          // Only try to error the controller if it's not already closed/errored
          try {
            controller.error(error);
          } catch (errorErr) {
            console.debug(
              "[Chunk Logging Transport] Could not error controller:",
              errorErr,
            );
          }
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return this.delegate.reconnectToStream(options);
  }
}
