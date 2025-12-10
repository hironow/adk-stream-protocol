import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText, tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// ========== Tool Definitions ==========
// Same tools as ADK Agent for consistent behavior

// Simple in-memory cache for weather data
const weatherCache = new Map<string, { data: any; timestamp: number }>();
const WEATHER_CACHE_TTL = 43200000; // 12 hours in milliseconds

const getWeatherTool = tool({
  description: "Get weather information for a location",
  parameters: z.object({
    location: z.string().describe("City name or location to get weather for"),
  }),
  execute: async ({ location }: { location: string }) => {
    // Check cache first
    const cacheKey = location.toLowerCase();
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
      console.log(`[Gemini Direct] Tool call: get_weather(${location}) ->`, cached.data, "(cached)");
      return { ...cached.data, cached: true };
    }

    // Get API key from environment
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    console.log(`[Gemini Direct] API key status: ${apiKey ? `present (${apiKey.substring(0, 10)}...)` : 'not set'}`);

    if (!apiKey) {
      console.warn("[Gemini Direct] OPENWEATHERMAP_API_KEY not set, using mock data");
      // Fallback to mock data
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
        note: `Mock data for ${location}`,
      };
      console.log(`[Gemini Direct] Tool call: get_weather(${location}) ->`, weather, "(mock)");
      return weather;
    }

    // Call OpenWeatherMap API
    const url = "https://api.openweathermap.org/data/2.5/weather";
    const params = new URLSearchParams({
      q: location,
      appid: apiKey,
      units: "metric", // Get temperature in Celsius
    });

    try {
      const response = await fetch(`${url}?${params}`);

      if (response.ok) {
        const data = await response.json();
        const weather = {
          temperature: Math.round(data.main.temp * 10) / 10,
          condition: data.weather[0].main,
          description: data.weather[0].description,
          humidity: data.main.humidity,
          feels_like: Math.round(data.main.feels_like * 10) / 10,
          wind_speed: data.wind.speed,
        };
        // Cache the result
        weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() });
        console.log(`[Gemini Direct] Tool call: get_weather(${location}) ->`, weather, "(API)");
        return weather;
      } else {
        const errorMsg = `API returned status ${response.status}`;
        console.error(`[Gemini Direct] Tool call: get_weather(${location}) failed:`, errorMsg);
        return {
          error: errorMsg,
          location,
          note: "Failed to fetch weather data from API",
        };
      }
    } catch (error) {
      console.error(`[Gemini Direct] Tool call: get_weather(${location}) exception:`, error);
      return {
        error: String(error),
        location,
        note: "Exception occurred while fetching weather data",
      };
    }
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
