# ADK-AI Data Protocol - Specification

**Version:** 1.0 (Draft)
**Last Updated:** 2025-12-13

---

## Project Overview

This project demonstrates the integration between:
- **Frontend**: Next.js 16 with AI SDK v6 beta
- **Backend**: Google ADK with FastAPI

Focus: WebSocket bidirectional (BIDI) streaming with tool approval functionality.

---

## Multi-Device / Multi-Connection Requirements

### Scope Definition

This specification addresses scenarios where:
- A single user operates multiple devices (PC, iPhone, Android)
- A single user opens multiple browser tabs
- WebSocket connections are established from each device/tab

### Example Scenarios

The following scenarios illustrate requirements and their feasibility under different architectural approaches.

---

#### Scenario 1: Tab Switching - Conversation Continuity

**Use Case:**
```
User Alice is on PC
1. Opens Tab 1 → Starts conversation about travel plans
2. Opens Tab 2 → Wants to continue the same conversation
```

**Expected Behavior:**
- Tab 2 should see Tab 1's conversation history
- Both tabs share the same conversation context

**Feasibility:**
- ❌ **NOT SUPPORTED** with ADK's standard design (Option 1)
  - Each tab = Independent session
  - Tab 2 starts fresh conversation
- ✅ **SUPPORTED** with Custom Session Management (Option 2)
  - Both tabs share session
  - Requires custom synchronization implementation

---

#### Scenario 2: Device Switching - Conversation Handoff

**Use Case:**
```
User Alice
1. Starts conversation on PC about restaurant recommendations
2. Leaves home, switches to iPhone
3. Wants to continue same conversation on iPhone
```

**Expected Behavior:**
- iPhone sees PC's conversation history
- Seamless conversation handoff across devices

**Feasibility:**
- ❌ **NOT SUPPORTED** with ADK's standard design (Option 1)
  - PC = session_1, iPhone = session_2 (independent)
  - User must start new conversation on iPhone
- ✅ **SUPPORTED** with Custom Session Management (Option 2)
  - Both devices share session
  - Requires custom synchronization implementation

---

#### Scenario 3: Tool Approval - Source Device Routing

**Use Case:**
```
User Alice has 3 active connections:
├─ PC (Tab 1) → Sends message "What's my location?"
├─ PC (Tab 2) → Idle
└─ iPhone → Idle

Agent generates tool call: get_location()
```

**Expected Behavior:**
- Tool approval request should go to **PC Tab 1** (source device)
- Other devices should NOT receive approval dialog

**Rationale:**
- User is actively using PC Tab 1
- Context is on the device where conversation is happening
- Random approval dialogs on idle devices = poor UX

**Feasibility:**
- ✅ **SUPPORTED** with Connection Tracking
  - Record `source_connection_id` when tool call is generated
  - Route approval request to same connection
  - Required for both Option 1 and Option 2

---

#### Scenario 4: Remote Device Tool Execution (Future Extension)

**Use Case:**
```
User Alice
1. PC → Asks "What's the weather at my current location?"
2. Agent realizes location requires mobile GPS
3. System routes get_location() approval to iPhone
4. iPhone user approves → GPS result sent back
5. PC receives weather based on iPhone's location
```

**Expected Behavior:**
- Tool approval request routed to **different device** than source
- System intelligently selects appropriate device for tool execution
- Results returned to original conversation

**Feasibility:**
- ⚠️ **COMPLEX** - Requires advanced implementation
  - Need connection registry: `user_connections[user_id]`
  - Need device capability tracking (GPS, camera, etc.)
  - Need routing policy (which device for which tool)
  - Need shared session for context (Option 2 prerequisite)

---

#### Scenario 5: Multi-Tab - Concurrent Tool Approvals

**Use Case:**
```
User Alice has 2 tabs open:
├─ Tab 1 → Asks "Change BGM to track 1"
└─ Tab 2 → Asks "What's my location?"

Both generate tool calls requiring approval
```

**Expected Behavior:**
- Tab 1 receives approval request for change_bgm
- Tab 2 receives approval request for get_location
- Approvals handled independently

**Feasibility:**
- ✅ **SUPPORTED** with Connection Tracking (Option 1)
  - Each tab = Independent session with own delegate
  - No interference between tabs
- ⚠️ **COMPLEX** with Shared Session (Option 2)
  - Need to track which connection issued which tool call
  - Need to route approvals to correct connection
  - Requires custom state management

---

## Technical Constraints

Based on investigation of ADK and AI SDK v6 (see: `experiments/2025-12-13_per_connection_state_management_investigation.md`)

### ADK (Google Agent Development Kit) Constraints

#### Constraint 1: No Concurrent run_live() with Same Session

**Source:** ADK source code analysis (`src/google/adk/runners.py`)

**Issue:**
```python
# This causes race conditions:
session = get_session(user_id, session_id)

# Tab 1
runner.run_live(session=session, live_request_queue=queue_1)

# Tab 2 (same session!)
runner.run_live(session=session, live_request_queue=queue_2)
```

**Result:**
- Data corruption in session state
- Concurrent modifications without synchronization
- `session.events` corrupted
- `InvocationContext` conflicts

**Implication:**
- ❌ Multiple connections CANNOT share the same session_id safely
- ❌ ADK does NOT support multi-tab/multi-device with shared session

**Reference:**
- [ADK Discussion #2784](https://github.com/google/adk-python/discussions/2784)
- DeepWiki analysis: "Concurrent modifications to the same session object without proper synchronization mechanisms would result in data corruption or inconsistent state."

---

#### Constraint 2: LiveRequestQueue is Connection-Specific

**Source:** ADK source code analysis (`src/google/adk/live_request_queue.py`)

**Design:**
```python
class LiveRequestQueue:
    def __init__(self):
        self._queue = asyncio.Queue()
```

**Characteristics:**
- Each WebSocket connection creates own `LiveRequestQueue` instance
- Queue is NOT shared across connections
- Lifecycle tied to single live agent invocation

**Implication:**
- ✅ Each connection has isolated message queue
- ✅ No queue interference between connections
- ❌ Cannot merge messages from multiple connections into one session

---

#### Constraint 3: Session Scope is Per-User, Not Per-Connection

**Source:** ADK bidi-demo implementation (`src/google/adk/cli/adk_web_server.py`)

**Current Pattern:**
```python
session_id = f"session_{user_id}_{app_name}"
# No connection_id component!
```

**Design Assumption:**
- ADK assumes: 1 user = 1 active session = 1 connection
- Multi-device/multi-tab scenarios NOT considered in core design

**Implication:**
- ❌ ADK's default session management does not track connection IDs
- ⚠️ Using same `session_id` from multiple connections = race conditions

---

### AI SDK v6 (Vercel) Constraints

#### Constraint 4: No Native WebSocket Multi-Connection Support

**Source:** [AI SDK v6 Discussion #5607](https://github.com/vercel/ai/discussions/5607)

**Status:**
- WebSocket native support: **Planned, not yet implemented**
- Custom transports: **Available** (developers implement own WebSocket)

**Known Challenges:**
- Stateful connection management
- **Multi-tab/multi-device coordination** ← Explicitly recognized as unsolved
- Scaling and load balancing

**Implication:**
- ❌ No official pattern for multi-connection management
- ⚠️ Developers must implement custom solutions

---

#### Constraint 5: No Connection Identifier in Transport Layer

**Source:** [AI SDK v6 Transport Documentation](https://ai-sdk.dev/docs/ai-sdk-ui/transport)

**Current API:**
```javascript
const { messages, sendMessage } = useChat({
  transport: new DefaultChatTransport({
    headers: () => ({
      'X-User-ID': getCurrentUserId(),
      'X-Session-ID': getCurrentSessionId(),
      // No 'X-Connection-ID' support
    }),
  }),
});
```

**Implication:**
- ❌ No built-in connection tracking mechanism
- ⚠️ Must implement custom connection ID generation and management

---

## Design Options

### Option 1: Follow ADK Pattern (Connection = Session)

**Design:**
```python
# Generate unique session_id per connection
connection_id = str(uuid.uuid4())
session_id = f"session_{user_id}_{connection_id}"

# Each tab/device gets independent session
session = runner.create_session(user_id=user_id, session_id=session_id)
```

**Architecture:**
```
User Alice
├─ PC Tab 1 → connection_1 → session_1 → Independent conversation
├─ PC Tab 2 → connection_2 → session_2 → Independent conversation
└─ iPhone → connection_3 → session_3 → Independent conversation
```

**Capabilities:**

| Scenario | Supported? | Notes |
|----------|-----------|-------|
| Tab Switching (Scenario 1) | ❌ No | Each tab = new conversation |
| Device Switching (Scenario 2) | ❌ No | Each device = new conversation |
| Tool Approval Routing (Scenario 3) | ✅ Yes | Source connection tracking works |
| Remote Device Execution (Scenario 4) | ❌ No | No shared session across devices |
| Concurrent Tool Approvals (Scenario 5) | ✅ Yes | Complete isolation between tabs |

**Pros:**
- ✅ Aligns with ADK's design assumptions
- ✅ No race conditions (complete isolation)
- ✅ Simple and robust implementation
- ✅ Each connection fully independent
- ✅ Works with ADK's existing infrastructure

**Cons:**
- ❌ User loses conversation history when switching tabs/devices
- ❌ Cannot continue same conversation from different device
- ❌ Poor multi-device user experience
- ❌ User must manually track which tab has which conversation

---

### Option 2: Custom Session Management (Shared Conversation)

**Design:**
```python
# Shared session across connections
user_id = "alice"
session_id = f"session_{user_id}_{app_name}"  # Same for all connections

# Connection tracking
connection_id = str(uuid.uuid4())
connection_registry[user_id].append({
    "connection_id": connection_id,
    "websocket": websocket,
    "device_info": device_info,
})

# Custom synchronization for concurrent run_live()
async with session_lock:
    runner.run_live(session=session, live_request_queue=queue)
```

**Architecture:**
```
User Alice → session_shared
├─ PC Tab 1 → connection_1 → Shares session_shared
├─ PC Tab 2 → connection_2 → Shares session_shared
└─ iPhone → connection_3 → Shares session_shared

All connections see same conversation history
Tool calls routed via connection_registry
```

**Capabilities:**

| Scenario | Supported? | Notes |
|----------|-----------|-------|
| Tab Switching (Scenario 1) | ✅ Yes | Shared conversation history |
| Device Switching (Scenario 2) | ✅ Yes | Seamless device handoff |
| Tool Approval Routing (Scenario 3) | ✅ Yes | Custom routing via connection_registry |
| Remote Device Execution (Scenario 4) | ✅ Yes | Can route to different device |
| Concurrent Tool Approvals (Scenario 5) | ⚠️ Complex | Requires careful state management |

**Pros:**
- ✅ User can continue conversation across tabs/devices
- ✅ Seamless multi-device experience
- ✅ Enables advanced features (remote device execution)
- ✅ Conversation context preserved

**Cons:**
- ❌ High implementation complexity
- ❌ Requires custom session locking/synchronization
- ❌ Must handle race conditions manually
- ❌ Not officially supported by ADK
- ❌ May break with ADK updates
- ❌ Requires deep ADK internals understanding
- ❌ Complex connection lifecycle management
- ❌ Error handling becomes significantly more complex

**Implementation Requirements:**
1. Custom session locking mechanism (asyncio.Lock per session)
2. Connection registry: `user_connections: dict[user_id, list[connection_info]]`
3. Tool call routing: Track source_connection_id for each tool call
4. Connection cleanup: Remove from registry on disconnect
5. State synchronization: Ensure consistent state across connections
6. Error recovery: Handle connection drops during tool execution

---

## Open Questions

### Question 1: Product Requirements

**Which scenarios are must-have vs nice-to-have?**

Critical scenarios (must support):
- [ ] Scenario 3: Tool Approval Routing (source device)
- [ ] Scenario 5: Concurrent Tool Approvals (multi-tab)

Nice-to-have scenarios:
- [ ] Scenario 1: Tab Switching (conversation continuity)
- [ ] Scenario 2: Device Switching (conversation handoff)
- [ ] Scenario 4: Remote Device Execution (future extension)

**Decision needed:** Does the UX value of conversation continuity justify the implementation complexity of Option 2?

---

### Question 2: Session Persistence Strategy

**How should sessions be persisted?**

Current: `InMemorySessionService` (single-instance only)

Options:
- [ ] Keep in-memory (development/demo only)
- [ ] Implement distributed session store (Redis, PostgreSQL)
- [ ] Use ADK's DatabaseSessionService with proper connection pooling

**Decision needed:** Production deployment strategy?

---

### Question 3: Connection Identifier Generation

**Where should connection_id be generated?**

Options:
- [ ] Backend (server.py generates UUID on WebSocket accept)
- [ ] Frontend (client generates UUID and sends in initial handshake)
- [ ] Hybrid (client generates, server validates and tracks)

**Decision needed:** Which approach provides better security and reliability?

---

## Design Decision

### ✅ Adopted: Option 1 (Connection = Session)

**Rationale:**

ADK explicitly warns that concurrent `run_live()` calls with the same session object cause race conditions and data corruption. Attempting to work around this with custom synchronization would:

- ❌ Go against ADK's design assumptions
- ❌ Create technical debt and maintenance burden
- ❌ Risk subtle bugs and data corruption
- ❌ May break with ADK updates
- ❌ Not officially supported by Google

**Principle:** **Do not force ADK to behave in ways it was not designed for.**

**Trade-off Accepted:**
- Users cannot continue same conversation across tabs/devices
- Each tab/device starts independent session
- Simpler, more reliable implementation

### ❌ Rejected: Option 2 (Custom Session Management)

**Reason:** Violates ADK's design constraints (race conditions in concurrent `run_live()`).

---

## Implementation Plan (Option 1)

### Phase 1: Connection-Specific Session Management

**Goal:** Each WebSocket connection gets unique session_id.

**Implementation:**

```python
# server.py - WebSocket endpoint
@app.websocket("/api/chat/bidi")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Generate unique connection identifier
    connection_id = str(uuid.uuid4())
    logger.info(f"[BIDI] New connection: {connection_id}")

    # Create connection-specific session
    user_id = "live_user"  # TODO: Get from auth
    session_id = f"session_{user_id}_{connection_id}"

    # Each connection = independent session
    session = await get_or_create_session(user_id, connection_runner, "agents", session_id)
```

**Changes Required:**
1. Update `get_or_create_session()` to accept optional `session_id` parameter
2. Generate `connection_id` on WebSocket accept
3. Use `connection_id` in session_id generation
4. Log connection lifecycle (connect, disconnect)

---

### Phase 2: Connection-Specific Tool Delegation

**Goal:** Each connection has isolated `FrontendToolDelegate`.

**Implementation:**

```python
# Create per-connection delegate
connection_delegate = FrontendToolDelegate()

# Build connection-specific tools (closure pattern)
connection_tools = build_connection_tools(connection_delegate)

# Create per-connection agent
all_tools = [get_weather, calculate, get_current_time] + connection_tools
connection_agent = Agent(
    name="adk_assistant_agent_bidi",
    model="gemini-2.5-flash-native-audio-preview-09-2025",
    instruction=(...),
    tools=all_tools,
)

# Create per-connection runner
connection_runner = InMemoryRunner(agent=connection_agent, app_name="agents")
```

**Changes Required:**
1. ✅ Already implemented: `build_connection_tools(delegate)` function
2. Create per-connection Agent in WebSocket handler
3. Create per-connection Runner in WebSocket handler
4. Use `connection_runner.run_live()` instead of global runner

---

### Phase 3: Connection Registry for Future Extensions

**Goal:** Track active connections per user (preparation for remote device execution).

**Implementation:**

```python
# Global connection registry
connection_registry: dict[str, list[dict]] = {}

# On connection
connection_info = {
    "connection_id": connection_id,
    "websocket": websocket,
    "session_id": session_id,
    "connected_at": datetime.now(),
    # Future: device_info, capabilities, etc.
}

if user_id not in connection_registry:
    connection_registry[user_id] = []
connection_registry[user_id].append(connection_info)

# On disconnect
try:
    # ... WebSocket handling ...
finally:
    # Cleanup
    connection_registry[user_id].remove(connection_info)
```

**Changes Required:**
1. Add global `connection_registry` dict
2. Register connection on accept
3. Cleanup on disconnect
4. (Future) Use registry for multi-device routing

---

### Phase 4: Tool Approval Routing

**Goal:** Ensure tool approval requests go to source connection.

**Current Implementation Status:**
- ✅ `FrontendToolDelegate` is already connection-specific (via closure)
- ✅ Tool calls automatically routed to correct connection
- ✅ `process_tool_use_parts()` processes approval responses

**No additional changes needed** - closure pattern already provides correct routing.

---

## Next Steps

### Immediate Actions

1. ✅ **Design Decision:** Option 1 adopted (documented in this SPEC)
2. ⏭️ **Revert Premature Implementation:** Remove the per-connection Agent/Runner code that was implemented before discussion
3. ⏭️ **Phase 1:** Implement connection-specific session_id generation
4. ⏭️ **Phase 2:** Complete per-connection Agent/Runner implementation (properly this time)
5. ⏭️ **Phase 3:** Add connection registry
6. ⏭️ **Testing:** Verify multi-tab scenario works correctly
7. ⏭️ **Documentation:** Update README with multi-connection behavior

### Testing Plan

**Test Scenarios:**
1. Single tab → Works as before
2. Multiple tabs from same browser → Independent sessions
3. Tool approval in Tab 1 → Only Tab 1 receives request
4. Tool approval in Tab 2 → Only Tab 2 receives request
5. Close Tab 1 → Tab 2 unaffected
6. Disconnect/Reconnect → New session created

---

## Supported vs Unsupported Scenarios

### ✅ Supported Scenarios

| Scenario | Status | Implementation |
|----------|--------|----------------|
| Tool Approval Routing (Scenario 3) | ✅ Supported | Closure pattern provides isolation |
| Concurrent Tool Approvals (Scenario 5) | ✅ Supported | Complete session isolation |
| Multi-tab independent sessions | ✅ Supported | Each tab = unique session_id |
| Connection-specific tool execution | ✅ Supported | Per-connection delegate |

### ❌ Unsupported Scenarios (By Design)

| Scenario | Status | Reason |
|----------|--------|--------|
| Tab Switching - Conversation Continuity (Scenario 1) | ❌ Not Supported | Each tab = independent session |
| Device Switching - Conversation Handoff (Scenario 2) | ❌ Not Supported | Each device = independent session |
| Remote Device Tool Execution (Scenario 4) | ❌ Not Supported | Requires shared session (Option 2) |

**User Experience:**
- Each tab/device starts fresh conversation
- User cannot continue conversation by switching tabs
- History is session-specific, not user-specific

**Potential Future Enhancement:**
- Manual session sharing (user copies session_id URL parameter)
- Session list UI (user selects which session to resume)
- Session persistence to database (resume after browser restart)

These enhancements can be added without violating ADK constraints.

---

## References

**Investigation Document:**
- `experiments/2025-12-13_per_connection_state_management_investigation.md`

**External Resources:**
- [ADK Discussion #2784: Multi-client WebSocket](https://github.com/google/adk-python/discussions/2784)
- [AI SDK v6 Discussion #5607: WebSocket Support](https://github.com/vercel/ai/discussions/5607)
- [ADK Official Documentation: Bidi-streaming](https://google.github.io/adk-docs/streaming/)
- [AI SDK v6 Documentation: Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
