# 0001. Per-Connection State Management (Connection = Session)

**Date:** 2025-12-13
**Status:** Accepted
**Decision Type:** Architecture

## Context

When implementing WebSocket-based bidirectional (BIDI) streaming with Google ADK and AI SDK v6, we needed to decide how to handle multi-device and multi-tab scenarios where:

- A single user operates multiple devices (PC, iPhone, Android)
- A single user opens multiple browser tabs
- WebSocket connections are established from each device/tab

This raised critical questions:
1. Should multiple connections share the same ADK session?
2. How should tool approval requests be routed to the correct device/tab?
3. Can users continue conversations across devices/tabs?

### Multi-Device/Multi-Tab Scenarios

We identified five key scenarios that needed support:

**Scenario 1: Tab Switching - Conversation Continuity**
- User opens Tab 1, starts conversation
- User opens Tab 2, wants to continue same conversation
- Expected: Tab 2 sees Tab 1's history

**Scenario 2: Device Switching - Conversation Handoff**
- User starts conversation on PC
- User switches to iPhone, wants to continue
- Expected: iPhone sees PC's history

**Scenario 3: Tool Approval - Source Device Routing**
- User has 3 active connections (PC Tab 1, PC Tab 2, iPhone)
- PC Tab 1 sends message requiring tool approval
- Expected: Approval request goes to PC Tab 1 only

**Scenario 4: Remote Device Tool Execution** (Future)
- PC asks for location-based weather
- System routes location request to iPhone (has GPS)
- iPhone provides location, PC shows weather

**Scenario 5: Multi-Tab - Concurrent Tool Approvals**
- Tab 1 requests BGM change approval
- Tab 2 requests location access approval
- Expected: Each tab handles its own approval independently

### Technical Constraints

Through investigation (documented in `experiments/2025-12-13_per_connection_state_management_investigation.md`), we identified critical ADK design constraints:

**ADK Constraint 1: No Concurrent `run_live()` with Same Session**

ADK source code analysis (`src/google/adk/runners.py`) revealed that concurrent `run_live()` calls with the same session object cause **race conditions and data corruption**:

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

**ADK Constraint 2: LiveRequestQueue is Connection-Specific**

Each WebSocket connection creates its own `LiveRequestQueue` instance:

```python
class LiveRequestQueue:
    def __init__(self):
        self._queue = asyncio.Queue()
```

Queues cannot be merged or shared across connections without custom implementation.

**ADK Constraint 3: Session Scope Assumption**

ADK's default session management assumes: **1 user = 1 active session = 1 connection**

Multi-device/multi-tab scenarios were not considered in ADK's core design.

**Reference:** [ADK Discussion #2784: Multi-client WebSocket](https://github.com/google/adk-python/discussions/2784)

## Decision

We adopt **Option 1: Follow ADK Pattern (Connection = Session)**

**Implementation:**
```python
# Generate unique session_id per connection
connection_signature = str(uuid.uuid4())
session_id = f"session_{user_id}_{connection_signature}"

# Each tab/device gets independent session
session = await get_or_create_session(
    user_id, runner, app_name, connection_signature=connection_signature
)
```

**Architecture:**
```
User Alice
├─ PC Tab 1 → connection_signature_1 → session_1 → Independent conversation
├─ PC Tab 2 → connection_signature_2 → session_2 → Independent conversation
└─ iPhone → connection_signature_3 → session_3 → Independent conversation
```

**Core Principle:** **Do not force ADK to behave in ways it was not designed for.**

## Consequences

### Positive

1. **Aligns with ADK's Design:** Works within ADK's architectural assumptions
2. **No Race Conditions:** Complete isolation between connections prevents data corruption
3. **Simple and Robust:** Straightforward implementation with minimal complexity
4. **Future-Proof:** Won't break with ADK updates (follows official patterns)
5. **Tool Approval Routing Works:** Closure pattern provides correct per-connection routing
6. **Concurrent Tool Approvals Work:** Complete session isolation prevents interference

### Negative

1. **No Conversation Continuity Across Tabs/Devices:** Each tab/device starts fresh conversation
2. **User Cannot Continue Conversation:** Switching tabs/devices loses context
3. **Poor Multi-Device UX:** User must track which tab/device has which conversation
4. **No Remote Device Execution:** Cannot route tool calls to different device

### Neutral

1. **Each Connection Fully Independent:** Clear isolation boundary
2. **Session History is Connection-Specific:** Not user-specific
3. **Future Enhancement Possible:** Can add manual session sharing via URL parameters or session list UI without violating ADK constraints

## Scenario Support Matrix

| Scenario | Supported? | Implementation |
|----------|-----------|----------------|
| **Scenario 1: Tab Switching** | ❌ No | Each tab = independent session |
| **Scenario 2: Device Switching** | ❌ No | Each device = independent session |
| **Scenario 3: Tool Approval Routing** | ✅ Yes | Closure pattern provides isolation |
| **Scenario 4: Remote Device Execution** | ❌ No | Requires shared session (rejected) |
| **Scenario 5: Concurrent Tool Approvals** | ✅ Yes | Complete session isolation |

## Alternatives Considered

### Option 2: Custom Session Management (Shared Conversation) - REJECTED

**Approach:**
- Multiple connections share same `session_id`
- Custom session locking mechanism to prevent race conditions
- Connection registry to route tool approvals

**Why Rejected:**

1. **Violates ADK Design Constraints:** ADK explicitly warns against concurrent `run_live()` with same session
2. **High Implementation Complexity:** Requires custom synchronization, locking, error recovery
3. **Not Officially Supported:** May break with ADK updates
4. **Technical Debt:** Goes against ADK's architectural assumptions
5. **Risk of Data Corruption:** Custom synchronization may not cover all edge cases

**ADK Official Guidance:** The ADK team confirmed in GitHub discussions that concurrent access to the same session object is not supported and will cause race conditions.

## Implementation Status

**Phase 1: Connection-Specific Session Management** - ✅ **COMPLETED**
- Each WebSocket connection generates unique `connection_signature` (UUID)
- Session ID format: `session_{user_id}_{connection_signature}`
- Implemented in `server.py` (live_chat async function)
- Implementation: `get_or_create_session()` accepts `connection_signature` parameter

**Phase 2: Connection-Specific Tool Delegation** - ✅ **COMPLETED**
- Each connection has isolated `FrontendToolDelegate`
- Delegate stored in `session.state["temp:delegate"]`
- Tool approval requests routed to source connection via session state
- Implemented in `server.py` (live_chat function) and tool functions (`change_bgm`, `get_location`)

**Phase 3: Connection Registry** - ❌ **NOT IMPLEMENTED**
- Global connection registry not yet implemented
- Connection tracking currently limited to session state
- Planned for future enhancement (user-level connection tracking)

## Future Enhancements

The following enhancements can be added **without violating ADK constraints**:

1. **Manual Session Sharing:** User copies session URL parameter to share across tabs
2. **Session List UI:** User selects which session to resume from dropdown
3. **Session Persistence:** Store sessions in database for resumption after browser restart
4. **Session Transfer:** User explicitly transfers session from one device to another

These enhancements maintain the **Connection = Session** principle while improving UX.

## References

- **Investigation Document:** `experiments/2025-12-13_per_connection_state_management_investigation.md`
- **ADK Discussion:** [#2784: Multi-client WebSocket](https://github.com/google/adk-python/discussions/2784)
- **AI SDK v6 Discussion:** [#5607: WebSocket Support](https://github.com/vercel/ai/discussions/5607)
- **Implementation:** `server.py` (live_chat function), `docs/ARCHITECTURE.md`
- **Original Specification:** `SPEC.md` (archived after this ADR)

---

**Last Updated:** 2025-12-14
**Supersedes:** SPEC.md (content migrated to this ADR)
