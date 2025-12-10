import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText } from "ai";
import type { UIMessage } from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const BACKEND_MODE = process.env.BACKEND_MODE || "gemini";
const ADK_BACKEND_URL = process.env.ADK_BACKEND_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Phase 1: Direct Gemini API
  if (BACKEND_MODE === "gemini") {
    const result = streamText({
      model: google("gemini-2.0-flash-exp"),
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
  }

  // Phase 2: ADK Backend via JSONRPC
  if (BACKEND_MODE === "adk-jsonrpc") {
    try {
      const response = await fetch(`${ADK_BACKEND_URL}/jsonrpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "chat",
          params: { messages },
          id: Date.now(),
        }),
      });

      const data = await response.json();

      if (data.error) {
        return new Response(
          JSON.stringify({ error: data.error.message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Convert JSONRPC response to AI SDK format
      const assistantMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant" as const,
        content: data.result.message,
      };

      return new Response(
        JSON.stringify({
          messages: [...messages, assistantMessage],
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("JSONRPC request failed:", error);
      return new Response(
        JSON.stringify({ error: "Failed to connect to ADK backend" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Phase 3: ADK Backend via SSE Streaming
  if (BACKEND_MODE === "adk-sse") {
    try {
      // Forward request to ADK backend /stream endpoint
      const response = await fetch(`${ADK_BACKEND_URL}/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.parts?.map(p => p.type === "text" ? p.text : "").join("") || "",
          })),
        }),
      });

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: "ADK backend SSE stream failed" }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Return the SSE stream directly
      // ADK backend already sends AI SDK v6 compatible SSE format
      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } catch (error) {
      console.error("ADK SSE streaming failed:", error);
      return new Response(
        JSON.stringify({ error: "Failed to connect to ADK backend for streaming" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Unsupported mode
  return new Response(
    JSON.stringify({ error: `Unsupported backend mode: ${BACKEND_MODE}` }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }
  );
}
