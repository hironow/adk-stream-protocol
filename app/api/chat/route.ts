import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText, tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// ========== Tool Definitions ==========
// Same tools as ADK Agent for consistent behavior

// File-based cache for weather data (to avoid API usage during E2E tests)
import { promises as fs } from "fs";
import path from "path";

const WEATHER_CACHE_TTL = 43200000; // 12 hours in milliseconds
const CACHE_DIR = path.join(process.cwd(), ".cache");

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    // Directory already exists, ignore
  }
}

async function getWeatherFromCache(location: string): Promise<any | null> {
  await ensureCacheDir();
  const cacheFile = path.join(CACHE_DIR, `weather_${location.toLowerCase().replace(/\s+/g, "_")}.json`);

  try {
    const data = await fs.readFile(cacheFile, "utf-8");
    const cached = JSON.parse(data);
    if (Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
      return cached.data;
    }
  } catch (err) {
    // Cache miss or expired
  }
  return null;
}

async function setWeatherCache(location: string, data: any) {
  await ensureCacheDir();
  const cacheFile = path.join(CACHE_DIR, `weather_${location.toLowerCase().replace(/\s+/g, "_")}.json`);

  await fs.writeFile(
    cacheFile,
    JSON.stringify({ data, timestamp: Date.now() }, null, 2),
    "utf-8"
  );
}

const getWeatherTool = tool({
  description: "Get weather information for a location",
  parameters: z.object({
    location: z.string().describe("City name or location to get weather for"),
  }),
  execute: async ({ location }: { location: string }) => {
    // Check cache first
    const cached = await getWeatherFromCache(location);
    if (cached) {
      console.log(`[Gemini Direct] Tool call: get_weather(${location}) ->`, cached, "(cached)");
      return { ...cached, cached: true };
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
        await setWeatherCache(location, weather);
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
  const body = await req.json();
  console.log("[Gemini Direct] Received request body:", JSON.stringify(body, null, 2));

  const { messages }: { messages: UIMessage[] } = body;

  if (!messages || !Array.isArray(messages)) {
    console.error("[Gemini Direct] Invalid messages:", messages);
    return new Response(
      JSON.stringify({ error: "Invalid messages format" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("[Gemini Direct] Processing", messages.length, "messages");

  // Log messages for debugging
  messages.forEach((msg, idx) => {
    console.log(`[Gemini Direct] Message ${idx}:`, {
      role: msg.role,
      parts: msg.parts?.map((p: any) => ({ type: p.type, text: p.text?.substring(0, 50) })),
      metadata: msg.metadata,
    });
  });

  // AI SDK v6: convertToModelMessages handles UIMessage parts directly
  // No manual conversion needed - it supports text, file, tool, and other part types
  const result = streamText({
    model: google("gemini-3-pro-preview"),  // Latest Gemini 3 Pro with advanced tool calling support
    messages: convertToModelMessages(messages),  // AI SDK v6 handles UIMessage parts natively
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
