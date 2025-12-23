/**
 * Unit Tests: ChunkLoggingTransport Stream Lifecycle
 *
 * Tests that ChunkLoggingTransport correctly wraps DefaultChatTransport
 * and properly handles stream lifecycle including [DONE].
 *
 * Design Principle:
 * - ChunkLoggingTransport is a wrapper - delegates stream processing
 * - Should forward all chunks from delegate including stream completion
 * - Should handle controller close/error gracefully (no double-close)
 *
 * Test Strategy:
 * - Verify chunks are forwarded correctly
 * - Verify stream completes when delegate completes
 * - Verify error handling doesn't cause double-close issues
 */

import type { DefaultChatTransport, UIMessage, UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkLoggingTransport } from "../../chunk_logs/chunk-logging-transport";

describe("ChunkLoggingTransport Stream Lifecycle Tests", () => {
  let mockDelegate: DefaultChatTransport<UIMessage>;

  beforeEach(() => {
    // Mock DefaultChatTransport
    mockDelegate = {
      sendMessages: vi.fn(),
      reconnectToStream: vi.fn(),
    } as unknown as DefaultChatTransport<UIMessage>;
  });

  it("[PASS] should forward chunks from delegate and complete stream", async () => {
    /**
     * TDD GREEN: ChunkLoggingTransport forwards delegate stream correctly.
     *
     * Flow:
     * 1. Delegate sends text-delta chunks
     * 2. Wrapper logs and forwards chunks
     * 3. Delegate stream completes
     * 4. Wrapper closes controller
     *
     * Expected: All chunks forwarded, stream closes cleanly
     */

    // given: Mock delegate stream with chunks
    const mockChunks: UIMessageChunk[] = [
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: " World" },
    ];

    const mockStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of mockChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    (mockDelegate.sendMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockStream,
    );

    // when: ChunkLoggingTransport wraps delegate
    const transport = new ChunkLoggingTransport(mockDelegate, "sse");
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messageId: "test-msg",
      messages: [{ id: "1", role: "user", content: "test" }],
      abortSignal: undefined,
    });

    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];

    // Read all chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(value);
    }

    // then: All chunks should be forwarded
    expect(receivedChunks).toEqual(mockChunks);
  });

  it("[PASS] should handle delegate stream error gracefully", async () => {
    /**
     * TDD GREEN: ChunkLoggingTransport handles delegate errors correctly.
     *
     * Flow:
     * 1. Delegate stream errors
     * 2. Wrapper catches error and errors controller
     *
     * Expected: Error propagated correctly without double-error
     *
     * Note: When controller.error() is called, it immediately errors the stream.
     * Any enqueued chunks may not be readable after error is triggered.
     */

    // given: Mock delegate stream that errors
    const mockError = new Error("Delegate stream error");
    const mockStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.error(mockError);
      },
    });

    (mockDelegate.sendMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockStream,
    );

    // when: ChunkLoggingTransport wraps delegate
    const transport = new ChunkLoggingTransport(mockDelegate, "sse");
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messageId: "test-msg",
      messages: [{ id: "1", role: "user", content: "test" }],
      abortSignal: undefined,
    });

    const reader = stream.getReader();
    let streamError: Error | null = null;

    // Read until error or done
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (error) {
      streamError = error as Error;
    }

    // then: Error should be propagated
    expect(streamError).toBeTruthy();
    expect(streamError?.message).toBe("Delegate stream error");
  });

  it("[PASS] should handle multiple controller close attempts gracefully", async () => {
    /**
     * TDD GREEN: ChunkLoggingTransport protects against double-close.
     *
     * Implementation (lines 62-69 in chunk-logging-transport.ts):
     *     try {
     *       controller.close();
     *     } catch (closeErr) {
     *       console.debug("Stream already closed or errored:", closeErr);
     *     }
     *
     * This test verifies the error handling works correctly.
     *
     * Expected: No uncaught errors from double-close attempts
     */

    // given: Mock delegate stream
    const mockStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-delta", text: "Test" });
        controller.close();
      },
    });

    (mockDelegate.sendMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockStream,
    );

    // when: ChunkLoggingTransport wraps delegate
    const transport = new ChunkLoggingTransport(mockDelegate, "sse");
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messageId: "test-msg",
      messages: [{ id: "1", role: "user", content: "test" }],
      abortSignal: undefined,
    });

    const reader = stream.getReader();
    const chunks: UIMessageChunk[] = [];

    // Read all chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // then: Should complete without errors
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ type: "text-delta", text: "Test" });

    // and: Stream should be closed cleanly
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it("[PASS] should complete when delegate completes (simulating [DONE])", async () => {
    /**
     * TDD GREEN: ChunkLoggingTransport forwards stream completion.
     *
     * This simulates what happens when backend sends [DONE]:
     * 1. Delegate DefaultChatTransport receives SSE with [DONE]
     * 2. Delegate closes its stream
     * 3. ChunkLoggingTransport detects delegate stream done
     * 4. ChunkLoggingTransport closes wrapper stream
     *
     * Expected: Wrapper stream completes when delegate completes
     */

    // given: Mock delegate stream that completes after chunks
    const mockChunks: UIMessageChunk[] = [
      { type: "text-delta", text: "Response" },
      { type: "text-delta", text: " complete" },
    ];

    const mockStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of mockChunks) {
          controller.enqueue(chunk);
        }
        // Simulate delegate receiving [DONE] and closing stream
        controller.close();
      },
    });

    (mockDelegate.sendMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockStream,
    );

    // when: ChunkLoggingTransport wraps delegate
    const transport = new ChunkLoggingTransport(mockDelegate, "sse");
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messageId: "test-msg",
      messages: [{ id: "1", role: "user", content: "test" }],
      abortSignal: undefined,
    });

    const reader = stream.getReader();
    const receivedChunks: UIMessageChunk[] = [];
    let streamCompleted = false;

    // Read all chunks until done
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamCompleted = true;
        break;
      }
      receivedChunks.push(value);
    }

    // then: All chunks should be forwarded
    expect(receivedChunks).toEqual(mockChunks);

    // and: Stream should complete (simulating [DONE] received)
    expect(streamCompleted).toBe(true);

    // and: Stream closed cleanly
    await expect(reader.closed).resolves.toBeUndefined();
  });
});
