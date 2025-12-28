/**
 * Type Compatibility Tests
 *
 * Ensures that both BIDI and SSE transports satisfy the same ChatTransportFromAISDKv6 interface.
 * These tests run at compile time and will fail if type compatibility is broken.
 *
 * Run with: pnpm exec tsc --noEmit
 */

import type { ChatTransportFromAISDKv6 as BidiChatTransport } from "../../bidi";
import type { ChatTransportFromAISDKv6 as SseChatTransport } from "../../sse";
import type {
  ChatTransportFromAISDKv6,
  UIMessageFromAISDKv6,
} from "../../utils";

/**
 * Type test: BIDI ChatTransportFromAISDKv6 satisfies ChatTransportFromAISDKv6<UIMessageFromAISDKv6>
 */
type BidiTransportIsCompatible =
  BidiChatTransport extends ChatTransportFromAISDKv6<UIMessageFromAISDKv6>
    ? true
    : false;

const bidiCheck: BidiTransportIsCompatible = true;

/**
 * Type test: SSE ChatTransportFromAISDKv6 satisfies ChatTransportFromAISDKv6<UIMessageFromAISDKv6>
 * Note: SseChatTransport is a generic class, so we check its instance type
 */
type SseTransportInstance = InstanceType<
  typeof SseChatTransport<UIMessageFromAISDKv6>
>;
type SseTransportIsCompatible =
  SseTransportInstance extends ChatTransportFromAISDKv6<UIMessageFromAISDKv6>
    ? true
    : false;

const sseCheck: SseTransportIsCompatible = true;

/**
 * Type test: Both transports can be assigned to ChatTransportFromAISDKv6<UIMessageFromAISDKv6>
 */
function acceptsChatTransport(
  transport: ChatTransportFromAISDKv6<UIMessageFromAISDKv6>,
) {
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
  transport: ChatTransportFromAISDKv6<UIMessageFromAISDKv6>;
  messages: UIMessageFromAISDKv6[];
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
