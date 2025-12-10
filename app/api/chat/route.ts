import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText } from "ai";
import type { UIMessage } from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Phase 1: Direct Gemini API
  // Phase 2 (adk-sse) connects directly to ADK backend - no Next.js API proxy needed
  const result = streamText({
    model: google("gemini-2.0-flash-exp"),
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
