/**
 * Type Compatibility Tests
 *
 * Ensures that both BIDI and SSE transports satisfy the same ChatTransport interface.
 * These tests run at compile time and will fail if type compatibility is broken.
 *
 * Run with: pnpm exec tsc --noEmit
 */

import type { ChatTransport, UIMessage } from "ai";
import type { ChatTransport as BidiChatTransport } from "../../bidi";
import type { ChatTransport as SseChatTransport } from "../../sse";

/**
 * Type test: BIDI ChatTransport satisfies ChatTransport<UIMessage>
 */
type BidiTransportIsCompatible =
  BidiChatTransport extends ChatTransport<UIMessage> ? true : false;

const bidiCheck: BidiTransportIsCompatible = true;

/**
 * Type test: SSE ChatTransport satisfies ChatTransport<UIMessage>
 * Note: SseChatTransport is a generic class, so we check its instance type
 */
type SseTransportInstance = InstanceType<typeof SseChatTransport<UIMessage>>;
type SseTransportIsCompatible =
  SseTransportInstance extends ChatTransport<UIMessage> ? true : false;

const sseCheck: SseTransportIsCompatible = true;

/**
 * Type test: Both transports can be assigned to ChatTransport<UIMessage>
 */
function acceptsChatTransport(transport: ChatTransport<UIMessage>) {
  return transport;
}

// This should compile without errors
declare const bidiTransport: BidiChatTransport;
declare const sseTransport: SseTransportInstance;

acceptsChatTransport(bidiTransport); // ✅ Should compile
acceptsChatTransport(sseTransport); // ✅ Should compile

/**
 * Type test: useChat hook accepts both transports
 */
interface TestUseChatOptions {
  transport: ChatTransport<UIMessage>;
  messages: UIMessage[];
  id: string;
}

const bidiUseChatOptions: TestUseChatOptions = {
  transport: bidiTransport,
  messages: [],
  id: "test",
};

const sseUseChatOptions: TestUseChatOptions = {
  transport: sseTransport,
  messages: [],
  id: "test",
};

// Export to satisfy TypeScript module requirements
export { bidiCheck, sseCheck, bidiUseChatOptions, sseUseChatOptions };
