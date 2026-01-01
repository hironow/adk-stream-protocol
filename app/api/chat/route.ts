import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText, tool } from "ai";
import { z } from "zod";
import type { UIMessageFromAISDKv6 } from "@/lib/utils";

export async function POST(req: Request) {
  const body = await req.json();
  console.log(
    "[Gemini Direct] Received request body:",
    JSON.stringify(body, null, 2),
  );

  const { messages }: { messages: UIMessageFromAISDKv6[] } = body;

  if (!messages || !Array.isArray(messages)) {
    console.error("[Gemini Direct] Invalid messages:", messages);
    return new Response(JSON.stringify({ error: "Invalid messages format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[Gemini Direct] Processing", messages.length, "messages");

  // Log messages for debugging
  messages.forEach((msg, idx) => {
    console.log(`[Gemini Direct] Message ${idx}:`, {
      role: msg.role,
      parts: msg.parts?.map((p) => ({
        type: p.type,
        text: "text" in p ? p.text?.substring(0, 50) : undefined,
      })),
      metadata: msg.metadata,
    });
  });

  const getCurrentTimeTool = tool({
    description: "Get the current time in a specified timezone (default: UTC)",
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe(
          "Timezone name (e.g., 'America/New_York', 'Asia/Tokyo', 'UTC'). Defaults to UTC if not specified.",
        ),
    }),
    execute: async ({ timezone }) => {
      const tz = timezone || "UTC";
      const now = new Date();
      const result = {
        datetime: now.toISOString(),
        timezone: tz,
        formatted: now.toLocaleString("en-US", { timeZone: tz }),
      };
      console.log(
        `[Gemini Direct] Tool call: get_current_time(${tz}) ->`,
        result,
      );
      return result;
    },
  });

  // AI SDK v6: convertToModelMessages handles UIMessageFromAISDKv6 parts directly
  // No manual conversion needed - it supports text, file, tool(debug only), and other part types
  // IMPORTANT: convertToModelMessages is async in AI SDK v6 - must await
  const result = streamText({
    model: google("gemini-3-flash-preview"), // Gemini 3 Flash Preview for generateContent API
    messages: await convertToModelMessages(messages), // AI SDK v6 handles UIMessageFromAISDKv6 parts natively
    tools: {
      get_current_time: getCurrentTimeTool,
    },
    system:
      "You are a helpful AI assistant. you can use the get_current_time tool to provide the current time in various timezones.",
  });

  return result.toUIMessageStreamResponse();
}
