/**
 * Chunk Player Transport
 *
 * ⚪ ADK-Independent - Works with all modes (adk-bidi, adk-sse, gemini)
 *
 * Mock transport that replays recorded chunks from JSONL files.
 * Used for E2E testing to verify UI behavior with deterministic data.
 *
 * Dependencies:
 * - AI SDK v6 (ChatTransport interface)
 * - chunk-player.ts (JSONL replay)
 *
 * Supported Modes:
 * - All modes: Replays any recorded chunk sequence
 *
 * Usage:
 *     const transport = await ChunkPlayerTransport.fromFixture('/fixtures/test.jsonl');
 *     const options = { transport, messages: [], id: 'test' };
 *     const { append } = useChat(options);
 */

import type {
  ChatRequestOptions,
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import { ChunkPlayer } from "./chunk-player";

/**
 * Transport that replays chunks from recorded JSONL files.
 */
export class ChunkPlayerTransport implements ChatTransport<UIMessage> {
  private player: ChunkPlayer | null = null;
  private playerPromise: Promise<ChunkPlayer> | null = null;
  private fixturePath: string | null = null;
  private file: File | null = null;

  /**
   * Private constructor - use static factory methods
   */
  private constructor(
    options:
      | { type: "fixture"; path: string }
      | { type: "file"; file: File }
      | { type: "player"; player: ChunkPlayer },
  ) {
    if (options.type === "fixture") {
      this.fixturePath = options.path;
    } else if (options.type === "file") {
      this.file = options.file;
    } else {
      this.player = options.player;
    }
  }

  /**
   * Create transport from fixture file path (lazy loading).
   */
  static fromFixture(fixturePath: string): ChunkPlayerTransport {
    return new ChunkPlayerTransport({ type: "fixture", path: fixturePath });
  }

  /**
   * Create transport from File object (lazy loading).
   */
  static fromFile(file: File): ChunkPlayerTransport {
    return new ChunkPlayerTransport({ type: "file", file });
  }

  /**
   * Create transport from pre-loaded ChunkPlayer.
   */
  static fromPlayer(player: ChunkPlayer): ChunkPlayerTransport {
    return new ChunkPlayerTransport({ type: "player", player });
  }

  /**
   * Get or load the chunk player.
   */
  private async getPlayer(): Promise<ChunkPlayer> {
    if (this.player) {
      return this.player;
    }

    if (this.playerPromise) {
      return this.playerPromise;
    }

    if (this.fixturePath) {
      this.playerPromise = ChunkPlayer.fromUrl(this.fixturePath);
      this.player = await this.playerPromise;
      return this.player;
    }

    if (this.file) {
      this.playerPromise = ChunkPlayer.fromFile(this.file);
      this.player = await this.playerPromise;
      return this.player;
    }

    throw new Error("ChunkPlayerTransport not properly initialized");
  }

  /**
   * Send messages (mock implementation - replays recorded chunks).
   *
   * This ignores the actual messages and replays pre-recorded chunks.
   * Useful for E2E testing with deterministic behavior.
   */
  async sendMessages(
    _options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    // Load player if needed
    const player = await this.getPlayer();

    // Create stream that replays chunks
    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        try {
          // Replay chunks in fast-forward mode (no delays)
          for await (const entry of player.play({ mode: "fast-forward" })) {
            // Each entry.chunk should be a UIMessageChunk
            controller.enqueue(entry.chunk as UIMessageChunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  /**
   * Reconnect to stream (not supported in replay mode).
   */
  async reconnectToStream(
    _options: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // Chunk player doesn't support reconnection
    return null;
  }
}
