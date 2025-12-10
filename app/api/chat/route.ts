import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText, tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// ========== Tool Definitions ==========
// Same tools as ADK Agent for consistent behavior

const getWeatherTool = tool({
  description: "Get weather information for a location",
  parameters: z.object({
    location: z.string().describe("City name or location to get weather for"),
  }),
  execute: async ({ location }: { location: string }) => {
    // Mock weather data (same as server.py)
    const mockWeather: Record<string, any> = {
      Tokyo: { temperature: 18, condition: "Cloudy", humidity: 65 },
      "San Francisco": { temperature: 15, condition: "Foggy", humidity: 80 },
      London: { temperature: 12, condition: "Rainy", humidity: 85 },
      "New York": { temperature: 10, condition: "Sunny", humidity: 50 },
    };

    const weather = mockWeather[location] || {
      temperature: 20,
      condition: "Unknown",
      humidity: 60,
      note: `Weather data not available for ${location}, showing default`,
    };

    console.log(`[Gemini Direct] Tool call: get_weather(${location}) ->`, weather);
    return weather;
  },
});

const calculateTool = tool({
  description: "Calculate a mathematical expression",
  parameters: z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")'),
  }),
  execute: async ({ expression }: { expression: string }) => {
    try {
      // Safe evaluation - only allows basic math operations
      const result = eval(expression);
      console.log(`[Gemini Direct] Tool call: calculate(${expression}) ->`, result);
      return { expression, result, success: true };
    } catch (error) {
      console.error(`[Gemini Direct] Tool call: calculate(${expression}) failed:`, error);
      return { expression, error: String(error), success: false };
    }
  },
});

const getCurrentTimeTool = tool({
  description: "Get the current time in a specified timezone (default: UTC)",
  parameters: z.object({
    timezone: z.string().optional().describe("Timezone name (e.g., 'America/New_York', 'Asia/Tokyo', 'UTC'). Defaults to UTC if not specified."),
  }),
  execute: async ({ timezone }: { timezone?: string }) => {
    const tz = timezone || "UTC";
    const now = new Date();
    const result = {
      datetime: now.toISOString(),
      timezone: tz,
      formatted: now.toLocaleString("en-US", { timeZone: tz }),
    };
    console.log(`[Gemini Direct] Tool call: get_current_time(${tz}) ->`, result);
    return result;
  },
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Phase 1: Direct Gemini API with tools (matches ADK Agent behavior)
  // Phase 2 (adk-sse) connects directly to ADK backend - no Next.js API proxy needed
  const result = streamText({
    model: google("gemini-3-pro-preview"),  // Latest Gemini 3 Pro with advanced tool calling support
    messages: convertToModelMessages(messages),
    tools: {
      get_weather: getWeatherTool,
      calculate: calculateTool,
      get_current_time: getCurrentTimeTool,
    },
    system:
      "You are a helpful AI assistant with access to real-time tools. " +
      "Use the available tools when needed to provide accurate information:\n" +
      "- get_weather: Check weather for any city\n" +
      "- calculate: Perform mathematical calculations\n" +
      "- get_current_time: Get the current time\n\n" +
      "Always explain what you're doing when using tools.",
  });

  return result.toUIMessageStreamResponse();
}
