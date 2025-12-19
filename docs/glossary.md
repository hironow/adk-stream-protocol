# Glossary

This document defines key terms used throughout the project to ensure consistent understanding across the codebase and documentation.

## Core Concepts

### Turn (ターン)

A complete interaction cycle between user and AI, consisting of:
- User input (message submission or tool approval/denial)
- AI response (streaming events until `[DONE]` marker)

**Key characteristics:**
- Bounded by a single `[DONE]` marker
- Represents one logical exchange in the conversation
- Can be delivered over different transports (SSE or BIDI)

**Examples:**
- User sends "東京の天気を教えて" → AI responds with weather data → `[DONE]`
- User approves payment → AI executes tool → `[DONE]`

### Tool (ツール)

A complete tool execution from initiation to completion.

**Categories:**

**Single-turn tool:** Completes in 1 turn
- Example: `change_bgm`, `get_weather`
- Pattern: User request → Tool execution → `[DONE]`

**Multi-turn tool:** Requires 2 turns (with approval mechanism)
- Example: `get_location`, `process_payment`
- Pattern:
  - Turn 1: User request → Confirmation request → `[DONE]`
  - Turn 2: User approval/denial → Tool execution/rejection → `[DONE]`

**Important:** A "tool" in this context refers to the complete execution cycle, not the individual function. Multi-turn tools span multiple turns but represent a single logical tool operation.

## Transport Layer

### SSE (Server-Sent Events) Mode

HTTP-based unidirectional streaming from server to client.

**Characteristics:**
- 1 turn = 1 HTTP request/response pair
- Connection closes after `[DONE]`
- Multi-turn tools require multiple HTTP requests

**Example:**
```
Turn 1: POST /chat → SSE stream → [DONE] → connection close
Turn 2: POST /chat → SSE stream → [DONE] → connection close
```

### BIDI (Bidirectional WebSocket) Mode

WebSocket-based bidirectional persistent connection.

**Characteristics:**
- 1 turn = 1 message exchange over persistent WebSocket
- Connection stays open across multiple turns
- Multi-turn tools use the same WebSocket connection

**Example:**
```
WebSocket connection established
Turn 1: WS message → SSE-format events → [DONE]
Turn 2: WS message → SSE-format events → [DONE]
Connection remains open
```

### Stream

SSE-format event sequence representing a single turn.

**Types:**
- **HTTP response stream** (SSE mode): Physical HTTP response body
- **Logical stream** (BIDI mode): Sequence of SSE-format events within a WebSocket message

**Key principle:** Both SSE and BIDI modes use identical SSE-format events. The difference is only in the transport mechanism.

## Testing Terminology

### Turn-level Test

Tests focusing on single turn handling:
- Verifies `[DONE]` marker processing
- Checks chunk delivery correctness
- Validates stream completion

**Scope:** One turn in isolation

### Tool-level Test

Tests focusing on complete tool execution:
- Verifies single-turn tools (1 turn)
- Verifies multi-turn tools (2 turns: confirmation + execution)
- Tests tool approval/denial mechanisms

**Scope:** Complete tool lifecycle

### Baseline Fixture

JSON file capturing real E2E test output for regression testing.

**Structure:**
```json
{
  "description": "Human-readable test description",
  "mode": "sse" | "bidi",
  "source": "Where this fixture was captured from",
  "input": {
    "messages": [...],
    "trigger": "submit-message" | "regenerate-message"
  },
  "output": {
    "rawEvents": ["SSE-format event strings"],
    "expectedChunks": [UIMessageChunk objects],
    "expectedDoneCount": 1 or 2,
    "expectedStreamCompletion": true
  }
}
```

**Naming convention:** `{tool名}-{scenario}-{transport}-baseline.json`
- Examples: `change_bgm-sse-baseline.json`, `process_payment-approved-bidi-baseline.json`

### expectedDoneCount

The number of `[DONE]` markers expected in a fixture:
- `expectedDoneCount: 1` → Single-turn tool
- `expectedDoneCount: 2` → Multi-turn tool (confirmation + execution)

## Common Patterns

### Multi-turn Tool Pattern (Approval)

**Turn 1 (Confirmation Request):**
```
User message → Tool input → adk_request_confirmation → [DONE]
```

**Turn 2 (Approved Execution):**
```
User approval → Tool output → AI response → [DONE]
```

### Multi-turn Tool Pattern (Denial)

**Turn 1 (Confirmation Request):**
```
User message → Tool input → adk_request_confirmation → [DONE]
```

**Turn 2 (Denied Execution):**
```
User denial → Tool output error → AI response → [DONE]
```

## Protocol Concepts

### [DONE] Marker

Special SSE event marking the end of a turn.

**Format:** `data: [DONE]\n\n`

**Design principle:**
- Exactly one `[DONE]` per turn
- Multiple `[DONE]` markers = protocol violation
- Transport must close stream after `[DONE]`

### Message ID

Unique identifier for each turn in the conversation.

**Properties:**
- Different for each turn
- Used to correlate request/response pairs
- Included in `start` event: `{"type": "start", "messageId": "..."}`

---

**Note:** This glossary is a living document. Update it when introducing new concepts or refining existing definitions.
