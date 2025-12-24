/**
 * Common test data for app/ E2E tests
 *
 * Provides reusable test data for consistent testing across all test suites.
 */

/**
 * Test messages for various scenarios
 */
export const TEST_MESSAGES = {
  simple: "What is 2+2?",
  weather: "What is the weather in Tokyo?",
  search: "Search for latest AI news",
  changeBGM: "Change BGM to lofi",
  location: "Get my location",
  multiTool: "Get weather in Tokyo, search AI news, and change BGM",
  longText:
    "Tell me a long story about artificial intelligence and its impact on society.",
  withImage: "What is in this image?",
  error: "Trigger an error",
};

/**
 * Expected responses for testing
 */
export const EXPECTED_RESPONSES = {
  math: "4",
  weather: "temperature",
  search: "search results",
  bgmChanged: "BGM changed",
  location: "latitude",
};

/**
 * Tool names used in tests
 */
export const TOOL_NAMES = {
  getWeather: "get_weather",
  webSearch: "web_search",
  changeBGM: "change_bgm",
  getLocation: "get_location",
  deleteFiles: "delete_files",
  analyzeDataset: "analyze_dataset",
};

/**
 * Mode configurations
 */
export const MODES = {
  gemini: "gemini" as const,
  adkSSE: "adk-sse" as const,
  adkBIDI: "adk-bidi" as const,
};

/**
 * Timeout values for different test scenarios
 */
export const TIMEOUTS = {
  short: 5000, // 5s - for fast operations
  medium: 10000, // 10s - for standard operations
  long: 30000, // 30s - for slow operations (e.g., long-running tools)
};

/**
 * Test data for message parts
 */
export const MESSAGE_PARTS = {
  text: {
    type: "text" as const,
    text: "Hello, world!",
  },
  image: {
    type: "data-image" as const,
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    alt: "Test image",
  },
};

/**
 * Tool approval states
 */
export const TOOL_STATES = {
  approvalRequested: "approval-requested",
  approvalResponded: "approval-responded",
  outputAvailable: "output-available",
} as const;
