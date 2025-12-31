import { expect, test } from "@playwright/test";

/**
 * E2E tests for SSE mode error handling
 *
 * Tests various error scenarios in the SSE HTTP communication:
 * - Invalid JSON in request body
 * - Malformed message structures
 * - Missing required fields
 * - Invalid message formats
 */

const SERVER_URL = process.env.SERVER_URL || "http://localhost:8000";

test.describe("SSE Error Handling", () => {
  test("should handle invalid JSON in request body", async ({ request }) => {
    // when - send invalid JSON to /stream endpoint
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: "{ invalid json without quotes }",
      failOnStatusCode: false,
    });

    // then - should return 422 Unprocessable Entity (FastAPI validation error)
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle empty request body", async ({ request }) => {
    // when - send empty body
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: "",
      failOnStatusCode: false,
    });

    // then - should return 422 Unprocessable Entity
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle request with missing messages field", async ({
    request,
  }) => {
    // when - send valid JSON but missing required 'messages' field
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        invalidField: "value",
      }),
      failOnStatusCode: false,
    });

    // then - should return 422 (FastAPI Pydantic validation error)
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle request with empty messages array", async ({
    request,
  }) => {
    // when - send empty messages array
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [],
      }),
      failOnStatusCode: false,
    });

    // then - should handle gracefully (may return empty stream or error)
    // Accept either 200 (empty stream) or 422 (validation error)
    expect([200, 422]).toContain(response.status());
  });

  test("should handle request with invalid message structure", async ({
    request,
  }) => {
    // when - send messages with invalid structure (missing role or content)
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [{ invalidField: "no role or content" }],
      }),
      failOnStatusCode: false,
    });

    // then - should return 422 (validation error)
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle request with null message content", async ({
    request,
  }) => {
    // when - send message with null content
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [
          {
            role: "user",
            content: null,
          },
        ],
      }),
      failOnStatusCode: false,
    });

    // then - should return 422 (validation error)
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle request with malformed multipart content", async ({
    request,
  }) => {
    // when - send message with invalid multipart content structure
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ invalidType: "not text or image" }],
          },
        ],
      }),
      failOnStatusCode: false,
    });

    // then - should return 422 (validation error)
    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body).toHaveProperty("detail");
  });

  test("should handle valid request after previous error", async ({
    request,
  }) => {
    // given - send an invalid request first
    await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: "{ invalid }",
      failOnStatusCode: false,
    });

    // when - send a valid request after the error
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      }),
    });

    // then - should successfully process the valid request
    expect(response.status()).toBe(200);

    // Verify response is SSE format
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("text/event-stream");
  });

  test("should handle request with very long message content", async ({
    request,
  }) => {
    // when - send message with very long content (100KB)
    const longContent = "a".repeat(100000);
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [
          {
            role: "user",
            content: longContent,
          },
        ],
      }),
      failOnStatusCode: false,
    });

    // then - should either accept (200) or reject with proper error
    expect([200, 413, 422]).toContain(response.status());

    if (response.status() !== 200) {
      const body = await response.json();
      expect(body).toHaveProperty("detail");
    }
  });

  test("should handle request with special characters in content", async ({
    request,
  }) => {
    // when - send message with special characters and Unicode
    const response = await request.post(`${SERVER_URL}/stream`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messages: [
          {
            role: "user",
            content:
              'Test with special chars: 🔥 \n\t\r " \' \\ <script>alert("xss")</script>',
          },
        ],
      }),
    });

    // then - should handle gracefully
    expect(response.status()).toBe(200);

    // Verify response is SSE format
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("text/event-stream");
  });
});
