import { expect, test } from "@playwright/test";
import WebSocket from "ws";

/**
 * E2E tests for BIDI mode error handling
 *
 * Tests various error scenarios in the BIDI WebSocket communication:
 * - Invalid JSON from client
 * - Malformed event structures
 * - Connection errors
 */

const SERVER_URL = process.env.SERVER_URL || "http://localhost:8000";
const WS_URL = SERVER_URL.replace("http", "ws");

test.describe("BIDI Error Handling", () => {
  test("should handle invalid JSON from client gracefully", async () => {
    // given - establish WebSocket connection
    const ws = new WebSocket(`${WS_URL}/bidi`);

    // Wait for connection to open
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Track connection close
    let closeCode: number | undefined;
    let closeReason: string | undefined;
    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", (code, reason) => {
        closeCode = code;
        closeReason = reason.toString();
        console.debug(
          `WebSocket closed with code: ${code}, reason: ${closeReason}`,
        );
        resolve();
      });
    });

    // when - send invalid JSON (not properly formatted)
    ws.send("{ invalid json without quotes }");

    // then - connection should be closed due to JSON parse error
    await closePromise;

    // Verify connection was closed (error codes vary, but it should close)
    expect(closeCode).toBeDefined();
    expect(closeCode).not.toBe(1000); // 1000 = normal closure

    ws.close();
  });

  test("should handle empty string as invalid JSON", async () => {
    // given
    const ws = new WebSocket(`${WS_URL}/bidi`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    let closeCode: number | undefined;
    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    // when - send empty string (invalid JSON)
    ws.send("");

    // then - connection should be closed
    await closePromise;

    expect(closeCode).toBeDefined();
    expect(closeCode).not.toBe(1000);

    ws.close();
  });

  test("should handle non-JSON text from client", async () => {
    // given
    const ws = new WebSocket(`${WS_URL}/bidi`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    let closeCode: number | undefined;
    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    // when - send plain text (not JSON)
    ws.send("This is not JSON at all");

    // then - connection should be closed
    await closePromise;

    expect(closeCode).toBeDefined();
    expect(closeCode).not.toBe(1000);

    ws.close();
  });

  test("should handle partially valid JSON", async () => {
    // given
    const ws = new WebSocket(`${WS_URL}/bidi`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    let closeCode: number | undefined;
    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    // when - send JSON with missing closing brace
    ws.send('{"type": "message", "data": {');

    // then - connection should be closed
    await closePromise;

    expect(closeCode).toBeDefined();
    expect(closeCode).not.toBe(1000);

    ws.close();
  });

  test("should handle valid JSON but with unexpected structure gracefully", async () => {
    // given
    const ws = new WebSocket(`${WS_URL}/bidi`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Track messages
    const messages: string[] = [];
    ws.on("message", (data) => {
      messages.push(data.toString());
    });

    // when - send valid JSON but without required 'type' field
    // This should be handled gracefully by BidiEventReceiver
    ws.send(JSON.stringify({ invalidField: "value" }));

    // Give server time to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // then - connection should remain open (this is handled by event router)
    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Clean up
    ws.close();
  });

  test("should handle ping-pong with invalid JSON after valid ping", async () => {
    // given
    const ws = new WebSocket(`${WS_URL}/bidi`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    const messages: string[] = [];
    ws.on("message", (data) => {
      messages.push(data.toString());
    });

    let closeCode: number | undefined;
    const closePromise = new Promise<void>((resolve) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    // when - send valid ping first
    ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));

    // Wait for pong response
    await new Promise((resolve) => setTimeout(resolve, 100));

    // then - should receive pong
    expect(messages.length).toBeGreaterThan(0);
    const pongMessage = JSON.parse(messages[0]);
    expect(pongMessage.type).toBe("pong");

    // when - now send invalid JSON
    ws.send("{ broken json }");

    // then - connection should be closed
    await closePromise;

    expect(closeCode).toBeDefined();
    expect(closeCode).not.toBe(1000);

    ws.close();
  });
});
