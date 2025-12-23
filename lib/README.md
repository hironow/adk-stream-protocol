# lib/ Directory Structure

Frontend library for ADK AI Data Protocol integration with AI SDK v6.

## Directory Organization

```
lib/
├── bidi/                        # ADK BIDI Mode (WebSocket)
├── sse/                         # SSE Modes (Gemini + ADK SSE)
├── chunk_logs/                  # Chunk Logging & Replay (AI SDK v6)
├── audio-context.tsx            # ADK Audio Streaming
├── audio-recorder.ts            # ADK PCM Recording
├── use-audio-recorder.ts        # ADK Audio Hook
├── adk_compat.ts                # ADK Tool Utilities
├── build-use-chat-options.ts    # Mode Dispatcher
└── tests/                       # Tests
```

## Module Dependency Map

### 🔴 ADK-Dependent Modules

#### lib/bidi/ - ADK BIDI Protocol
**Dependencies**: ADK BIDI WebSocket Protocol, AI SDK v6
**Purpose**: Bidirectional streaming with ADK backend via WebSocket

- `event_sender.ts` - BIDI message/event sending, confirmation handling
- `event_receiver.ts` - BIDI response processing, audio chunk handling
- `transport.ts` - WebSocketChatTransport implementation
- `send-automatically-when.ts` - `adk_request_confirmation` auto-send detection
- `use-chat-options.ts` - useChat options builder for BIDI mode
- `index.ts` - Public API (unified with lib/sse/)

**Public API**:
```typescript
import {
  buildUseChatOptions,     // Main entry point
  ChatTransport,           // WebSocketChatTransport
  sendAutomaticallyWhen,   // Confirmation detection
} from '@/lib/bidi';
```

#### Audio Modules - ADK BIDI Audio Streaming
**Dependencies**: ADK BIDI Protocol, Web Audio API
**Purpose**: Real-time PCM audio streaming (16kHz, 16-bit)

- `audio-context.tsx` - AudioContext provider for PCM streaming
- `audio-recorder.ts` - AudioWorklet-based microphone recording
- `use-audio-recorder.ts` - React hook for audio recorder lifecycle

**Usage**: Only with `adk-bidi` mode

#### lib/adk_compat.ts - ADK Tool Utilities
**Dependencies**: ADK Tool Protocol (`adk_request_confirmation`)
**Purpose**: Backward compatibility utilities for ADK tool handling

**Note**: Used by both BIDI and SSE modes for confirmation flow

### 🟡 Partially ADK-Dependent Modules

#### lib/sse/ - SSE Modes
**Dependencies**: AI SDK v6 DefaultChatTransport, (Optional) ADK SSE
**Purpose**: HTTP streaming for Gemini and ADK SSE modes

- `event_sender.ts` - SSE confirmation output formatting
- `event_receiver.ts` - Placeholder (uses DefaultChatTransport)
- `transport.ts` - SSE transport factory
- `send-automatically-when.ts` - `adk_request_confirmation` detection (ADK SSE only)
- `use-chat-options.ts` - useChat options builder for SSE modes
- `index.ts` - Public API (unified with lib/bidi/)

**Modes**:
- `gemini` - Pure AI SDK v6, no ADK dependency
- `adk-sse` - Uses ADK tool confirmation (`adk_request_confirmation`)

**Public API** (identical to lib/bidi/):
```typescript
import {
  buildUseChatOptions,     // Main entry point
  ChatTransport,           // DefaultChatTransport (SSE)
  sendAutomaticallyWhen,   // Confirmation detection (ADK SSE)
} from '@/lib/sse';
```

### ⚪ ADK-Independent Modules

#### lib/chunk_logs/ - Chunk Logging & Replay
**Dependencies**: AI SDK v6 only
**Purpose**: Chunk logging, replay, and testing utilities

- `chunk-logger.ts` - JSONL chunk logging for debugging
- `chunk-logging-transport.ts` - ChatTransport wrapper for logging
- `chunk-player.ts` - Chunk replay from JSONL fixtures
- `chunk-player-transport.ts` - Mock transport for E2E testing
- `index.ts` - Public API (unified exports)

**Public API**:
```typescript
import {
  chunkLogger,           // Singleton logger instance
  ChunkLoggingTransport, // Transport wrapper
  ChunkPlayer,           // Replay engine
  ChunkPlayerTransport,  // Mock transport
} from '@/lib/chunk_logs';
```

**Usage**: Works with all modes (adk-bidi, adk-sse, gemini)

#### lib/build-use-chat-options.ts - Mode Dispatcher
**Dependencies**: All modes (bidi, sse, chunk player)
**Purpose**: Unified entry point for all backend modes

**Usage**:
```typescript
import { buildUseChatOptions } from '@/lib/build-use-chat-options';

// ADK BIDI mode
const { useChatOptions, transport } = buildUseChatOptions({
  mode: 'adk-bidi',
  initialMessages: [],
  adkBackendUrl: 'http://localhost:8000',
  audioContext,
});

// ADK SSE mode
const { useChatOptions } = buildUseChatOptions({
  mode: 'adk-sse',
  initialMessages: [],
  adkBackendUrl: 'http://localhost:8000',
});

// Gemini mode (no ADK)
const { useChatOptions } = buildUseChatOptions({
  mode: 'gemini',
  initialMessages: [],
});
```

## Public API Design

### Unified API Across Modules

Both `lib/bidi` and `lib/sse` export identical function/type names:

```typescript
// Unified names (use these)
buildUseChatOptions    // Main entry point
ChatTransport          // Transport class/type
sendAutomaticallyWhen  // Auto-send detection
UseChatConfig          // Configuration type
UseChatOptions         // Return type
TransportConfig        // Transport config

// Mode-specific names (deprecated, backward compatibility)
buildBidiUseChatOptions
buildSseUseChatOptions
WebSocketChatTransport
SseChatTransport
```

**Switching modes**: Just change the import path, keep the code:

```typescript
// Before (BIDI)
import { buildUseChatOptions } from '@/lib/bidi';

// After (SSE)
import { buildUseChatOptions } from '@/lib/sse';
```

## ADK Tool: adk_request_confirmation

The `adk_request_confirmation` tool is used in both BIDI and SSE modes:

**Purpose**: Request user approval before executing sensitive tools

**Flow**:
1. Backend sends `adk_request_confirmation` tool invocation
2. Frontend shows Approve/Deny buttons
3. User clicks → `addToolOutput({ tool: "adk_request_confirmation", output: { confirmed: true/false } })`
4. `sendAutomaticallyWhen` detects completion → auto-sends to backend
5. Backend receives confirmation and proceeds/cancels original tool

**Implementation**:
- BIDI: `lib/bidi/event_sender.ts` converts to `function_response` event
- SSE: `lib/sse/event_sender.ts` formats output for HTTP request
- Detection: Both use identical logic in `send-automatically-when.ts`

## Type Safety

Type compatibility is verified at compile-time:

```typescript
// lib/tests/types/transport-compatibility.test-d.ts
import type { ChatTransport, UIMessage } from 'ai';
import { ChatTransport as BidiTransport } from '@/lib/bidi';
import { ChatTransport as SseTransport } from '@/lib/sse';

// Both satisfy ChatTransport<UIMessage>
const bidi: ChatTransport<UIMessage> = new BidiTransport({ url: 'ws://...' });
const sse: ChatTransport<UIMessage> = new SseTransport({ api: '/api/chat' });
```

## Testing Strategy

- **Unit tests**: Public API only (lib/bidi/index.ts, lib/sse/index.ts)
- **Integration tests**: Mode switching, transport compatibility
- **E2E tests**: Full flow with ChunkPlayerTransport
- **Type tests**: Compile-time compatibility verification

See `lib/tests/` for details.
