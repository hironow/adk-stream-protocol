# Per-Connection State Management Investigation

**Date:** 2025-12-13
**Objective:** Investigate ADK recommended patterns for per-user/per-connection state management in Agent definitions
**Status:** 🟡 In Progress

---

## Background

### Current Problem

We discovered that `FrontendToolDelegate` is a global singleton shared across all WebSocket connections:

```python
# server.py:88 - Global instance (shared by all users)
frontend_delegate = FrontendToolDelegate()

# server.py:407-409 - All connections use the same tools
tools=[get_weather, calculate, get_current_time, change_bgm, get_location],
```

**Issues:**
1. `_pending_calls` dict is shared across all users
2. Tools (change_bgm, get_location) reference the global delegate
3. Memory leak risk when users disconnect without completing tool calls
4. Poor isolation between users

### What We Need

**Per-Connection State:**
- Each WebSocket connection needs its own `FrontendToolDelegate` instance
- Tools need to use the connection-specific delegate

**Question:**
How does ADK recommend handling per-user or per-connection state in Agent definitions?

---

## Investigation Plan

1. ✅ Review ADK documentation for state management patterns
2. ⏭️ Search for session/user context in ADK Agent API
3. ⏭️ Investigate Tool definition patterns with dynamic state
4. ⏭️ Check if ADK has dependency injection or context passing mechanisms
5. ⏭️ Review ADK examples for multi-user scenarios

---

## Investigation Results

### 1. ADK Documentation Review

**Sources:**
- https://google.github.io/adk-docs/sessions/state/
- https://google.github.io/adk-docs/tools-custom/

**Key Findings:**

#### Sessions & State

ADK provides **Session** as the primary abstraction for per-user conversations:
- `session.state`: Key-value scratchpad for conversation-specific data
- State scopes via prefixes:
  - No prefix: Session-specific
  - `user:*`: Shared across all sessions for a user
  - `app:*`: Shared globally across the application
  - `temp:*`: Invocation-only, discarded after completion

#### ToolContext Pattern

Tools access session-specific resources through **implicit context passing**:

```python
def update_user_preference(preference: str, value: str, tool_context: ToolContext):
    """Tools receive ToolContext automatically."""
    # Access session state
    tool_context.state['user:preference'] = value

    # Control agent flow
    tool_context.actions.transfer_to_agent = "other_agent"

    # Access artifacts and memory
    tool_context.load_artifact(name)
    tool_context.search_memory(query)
```

**ToolContext Features:**
- `.state`: Session/user/app state access
- `.actions`: Control agent behavior (transfer, etc.)
- `.load_artifact()`, `.save_artifact()`: File management
- `.search_memory()`: Long-term memory queries

#### Per-Connection Resources: No Standard Pattern

**Critical Finding:** ADK documentation does **NOT** provide explicit patterns for connection-specific resources (e.g., WebSocket delegate objects).

**Suggested Approaches (from docs):**
1. Store in session state with connection identifiers
2. Use a service layer injected via Runner configuration
3. Manage lifecycle separately from tool invocation

**Quote from docs:**
> "Tools are stateless functions... ToolContext provides session and user-level state management but not connection-specific resource handling."

---

## Analysis: Applying ADK Patterns to Our Problem

### Our Specific Case

**Problem:**
```python
# Current: Global delegate (shared across all connections)
frontend_delegate = FrontendToolDelegate()

async def change_bgm(track: int, tool_context: ToolContext):
    # Uses global frontend_delegate ❌
    result = await frontend_delegate.execute_on_frontend(...)
```

**Requirements:**
- Each WebSocket connection needs its own `FrontendToolDelegate` instance
- Tools need access to the connection-specific delegate
- Delegate contains `asyncio.Future` objects (not serializable)

### Evaluated Approaches

#### Option 1: ToolContext.state with temp: prefix ⚠️

```python
# In WebSocket handler
session.state['temp:frontend_delegate'] = FrontendToolDelegate()

# In tool
async def change_bgm(track: int, tool_context: ToolContext):
    delegate = tool_context.state.get('temp:frontend_delegate')
    result = await delegate.execute_on_frontend(...)
```

**Pros:**
- Uses ADK's state mechanism
- `temp:` prefix means not persisted (OK for Python objects)

**Cons:**
- ToolContext.state references Session.state
- Multiple WebSocket connections might share the same Session
- Race condition: Connection A and B with same user_id would overwrite each other's delegate

#### Option 2: Connection-scoped tools with closure (✅ RECOMMENDED)

```python
# In WebSocket handler
def build_connection_tools(delegate: FrontendToolDelegate) -> list[Tool]:
    """Build tools that capture connection-specific delegate."""

    async def change_bgm(track: int, tool_context: ToolContext):
        # Uses the delegate from closure ✅
        result = await delegate.execute_on_frontend(
            tool_call_id=tool_context.function_call_id,
            tool_name="change_bgm",
            args={"track": track}
        )
        return result

    async def get_location(tool_context: ToolContext):
        # Uses the delegate from closure ✅
        result = await delegate.execute_on_frontend(...)
        return result

    return [
        Tool(change_bgm, ...),
        Tool(get_location, ...),
    ]

# Per-connection initialization
connection_delegate = FrontendToolDelegate()
connection_tools = build_connection_tools(connection_delegate)
# Use these tools for this connection's agent runner
```

**Pros:**
- ✅ Each connection has isolated delegate
- ✅ Tools are stateless (ADK principle)
- ✅ Delegate is captured via closure (clean Python pattern)
- ✅ No global state
- ✅ Automatic cleanup when connection ends

**Cons:**
- Need to rebuild tools per-connection (minor overhead)
- Agent definition needs to accept tools dynamically

#### Option 3: Global dict with connection_id mapping

```python
# Global mapping
_connection_delegates: dict[str, FrontendToolDelegate] = {}

# In WebSocket handler
connection_id = str(uuid.uuid4())
_connection_delegates[connection_id] = FrontendToolDelegate()
session.state['temp:connection_id'] = connection_id

# In tool
async def change_bgm(track: int, tool_context: ToolContext):
    connection_id = tool_context.state.get('temp:connection_id')
    delegate = _connection_delegates[connection_id]
    result = await delegate.execute_on_frontend(...)
```

**Pros:**
- Works with global tool definitions

**Cons:**
- ❌ Manual cleanup required (memory leak risk)
- ❌ More complex error handling
- ❌ Global mutable state

---

## Re-evaluation: ToolContext.state Approach

**User's important observation:**
> ADK documentation shows `tool_context.state` with `temp:` prefix for temporary data.
> Could we store delegate in `tool_context.state['temp:frontend_delegate']` instead?

This warrants re-evaluation of our approach.

### Approach Comparison: Closure vs ToolContext.state

#### Approach A: Closure Pattern (Currently Implemented)

```python
# In WebSocket handler
def build_connection_tools(delegate: FrontendToolDelegate) -> list:
    async def change_bgm(track: int, tool_context: ToolContext):
        # Uses delegate from closure ✅
        result = await delegate.execute_on_frontend(...)
    return [change_bgm, get_location]

connection_delegate = FrontendToolDelegate()
connection_tools = build_connection_tools(connection_delegate)
all_tools = [get_weather, calculate, get_current_time] + connection_tools

# Create per-connection agent
connection_agent = Agent(tools=all_tools)
connection_runner = InMemoryRunner(agent=connection_agent)
```

**Pros:**
- ✅ Each connection has isolated delegate (closure captures it)
- ✅ No shared state between connections
- ✅ Type-safe (delegate is Python object, not in dict)
- ✅ Automatic cleanup when connection ends
- ✅ Clear ownership: delegate belongs to this connection

**Cons:**
- ❌ Must create new Agent per-connection (overhead)
- ❌ Must create new Runner per-connection (overhead)
- ❌ Cannot reuse global Agent definition
- ❌ More complex initialization

#### Approach B: ToolContext.state Pattern (ADK Native)

```python
# In WebSocket handler
session = await get_or_create_session(user_id, bidi_agent_runner, "agents")
session.state['temp:frontend_delegate'] = FrontendToolDelegate()

# In tool (global definition - no rebuild needed)
async def change_bgm(track: int, tool_context: ToolContext):
    delegate = tool_context.state.get('temp:frontend_delegate')
    if not delegate:
        return {"success": False, "error": "Delegate not initialized"}
    result = await delegate.execute_on_frontend(...)
    return result

# Use global agent (no per-connection agent needed)
bidi_agent = Agent(
    tools=[get_weather, calculate, get_current_time, change_bgm, get_location]
)
```

**Pros:**
- ✅ Uses ADK's recommended pattern (ToolContext.state)
- ✅ Can reuse global Agent definition
- ✅ Can reuse global Runner
- ✅ Simpler initialization (no per-connection agent)
- ✅ More ADK-idiomatic
- ✅ `temp:` prefix = not persisted (perfect for Python objects)

**Cons:**
- ⚠️ **CRITICAL ISSUE**: Session may be shared across WebSocket connections!
  - If user opens 2 tabs → 2 WebSocket connections
  - Both use same `user_id` → same Session
  - `session.state['temp:frontend_delegate']` would be overwritten
  - Connection 1's delegate replaced by Connection 2's delegate
- ❌ Potential race condition in multi-connection scenarios
- ⚠️ Less explicit ownership (delegate in state dict)

### Critical Question: Session Scope

**Key Investigation Needed:**

```python
# server.py:652, 757
session = await get_or_create_session(user_id, bidi_agent_runner, "agents")
```

**Question:** Is Session per-user or per-connection?

**Current implementation (server.py:484-499):**
```python
async def get_or_create_session(user_id, agent_runner, app_name):
    session_id = f"session_{user_id}_{app_name}"
    if session_id not in _sessions:
        _sessions[session_id] = await agent_runner.create_session(...)
    return _sessions[session_id]
```

**Analysis:**
- Session ID = `f"session_{user_id}_{app_name}"`
- **NO connection_id component!**
- Same `user_id` → same Session across connections
- ❌ **Multiple WebSocket connections share the same Session**

**Implication:**
- Approach B (ToolContext.state) would fail with multiple connections
- `session.state['temp:frontend_delegate']` would be overwritten
- Connection 1 and Connection 2 interfere with each other

### Possible Solutions for Approach B

#### Solution B1: Add connection_id to Session

```python
import uuid

async def get_or_create_session(user_id, agent_runner, app_name, connection_id=None):
    if connection_id is None:
        connection_id = str(uuid.uuid4())
    session_id = f"session_{user_id}_{app_name}_{connection_id}"
    ...
```

**Problem:** Breaks session continuity. Each connection = new session (loses history).

#### Solution B2: Use connection_id in state key

```python
# In WebSocket handler
connection_id = str(uuid.uuid4())
session.state[f'temp:frontend_delegate_{connection_id}'] = delegate
session.state['temp:current_connection_id'] = connection_id

# In tool
async def change_bgm(track: int, tool_context: ToolContext):
    connection_id = tool_context.state.get('temp:current_connection_id')
    delegate = tool_context.state.get(f'temp:frontend_delegate_{connection_id}')
```

**Problem:** Complex, error-prone. Must manage connection_id lifecycle.

---

## Final Recommendation

### Analysis Summary

| Aspect | Approach A (Closure) | Approach B (ToolContext.state) |
|--------|---------------------|-------------------------------|
| ADK idiomatic | ⚠️ Uses closure (Python idiom) | ✅ Uses recommended ToolContext.state |
| Multi-connection safety | ✅ Isolated per-connection | ❌ Shared session conflicts |
| Complexity | ❌ Per-connection Agent/Runner | ✅ Reuses global Agent/Runner |
| Type safety | ✅ Python object in closure | ⚠️ Object in dict (runtime check) |
| Cleanup | ✅ Automatic (GC) | ⚠️ Manual cleanup needed |

### Recommendation: **Hybrid Approach**

**Use Approach A (Closure) for now, but document why:**

**Rationale:**
1. **Session sharing is a blocker** for Approach B in current architecture
2. Current `get_or_create_session()` creates one session per user, not per connection
3. Multiple connections from same user would conflict
4. Fixing session management is a larger architectural change

**Future Direction:**
Once ADK session architecture is clarified (per-connection vs per-user), we can:
- Option 1: Use ToolContext.state if sessions become per-connection
- Option 2: Implement Solution B2 (connection_id in state keys)
- Option 3: Keep closure approach as the simpler solution

### Implementation Decision

**PENDING - Need deeper investigation of ADK state prefix implementation**

Before making final decision, we need to understand:
1. How ADK implements state prefix scoping (temp:, user:, app:)
2. When/how state is persisted vs discarded
3. Relationship between Session scope and state prefixes
4. Whether temp: state is truly per-invocation or per-session

---

## Deep Dive: ADK State Prefix Implementation

**Investigation Goal:** Understand ADK's state prefix implementation at the code level.

**Questions:**
1. How does ADK distinguish `temp:`, `user:`, `app:` prefixes?
2. What preprocessing/postprocessing happens for each prefix?
3. Is `temp:` state cleared per-invocation or per-session?
4. Can `temp:` state span multiple tool calls within same session?
5. What happens to `temp:` state across WebSocket reconnections?

### Investigation Plan

1. ✅ Search ADK documentation for state prefix behavior
2. ✅ Search ADK GitHub repository for state implementation
3. ✅ Look for state persistence/cleanup logic
4. ⏭️ Examine Session lifecycle and state scoping
5. ⏭️ Test actual behavior with temporary state

### Source Code Analysis (google/adk-python)

**Source:** DeepWiki search on `google/adk-python` repository

#### 1. State Prefix Processing (`_session_util.py`)

**Function:** `extract_state_delta(state_dict)`

```python
# Separates state changes by prefix:
- app: prefixed keys → extracted to "app" delta (persisted to StorageAppState)
- user: prefixed keys → extracted to "user" delta (persisted to StorageUserState)
- temp: prefixed keys → NOT included in any delta (not persisted)
- No prefix → extracted to "session" delta (persisted per-session)
```

**Key Constants:**
```python
State.APP_PREFIX = "app:"
State.USER_PREFIX = "user:"
State.TEMP_PREFIX = "temp:"
```

#### 2. Clearing temp: State (`BaseSessionService`)

**Method:** `_trim_temp_delta_state(state_delta)`

**Behavior:**
- Called **before** persisting events to storage
- Filters out all `temp:` prefixed keys from `state_delta`
- Used in: `DatabaseSessionService`, `SqliteSessionService`

**Code Flow:**
```python
# In append_event():
state_delta = event.actions.state_delta
state_delta = _trim_temp_delta_state(state_delta)  # Remove temp: keys
# Then persist to database (temp: keys not saved)
```

**Important Discovery:** `temp:` state is **NOT cleared per-invocation**. It exists in the Session's runtime state but is simply not persisted to storage.

#### 3. Persistence of user: and app: State

**DatabaseSessionService:**
```python
# create_session():
app_state_delta, user_state_delta, session_state_delta = extract_state_delta(initial_state)
# Update StorageAppState table (app:*)
# Update StorageUserState table (user:*)
# Commit to database

# append_event():
app_state_delta, user_state_delta, _ = extract_state_delta(event.state_delta)
# Update storage_app_state
# Update storage_user_state
# Commit to database
```

**InMemorySessionService:**
```python
# In-memory storage:
self.app_state = {}     # Keyed by app_name
self.user_state = {}    # Keyed by (app_name, user_id)

# _create_session_impl():
app_state_delta, user_state_delta, _ = extract_state_delta(initial_state)
self.app_state[app_name].update(app_state_delta)
self.user_state[(app_name, user_id)].update(user_state_delta)
```

#### 4. State Merging (`_merge_state`)

**Purpose:** Combine app, user, and session state into single `session.state` dict

**Process:**
```python
def _merge_state(app_state, user_state, session_state):
    merged = {}
    # Add app state with app: prefix
    for key, value in app_state.items():
        merged[f"app:{key}"] = value
    # Add user state with user: prefix
    for key, value in user_state.items():
        merged[f"user:{key}"] = value
    # Add session state (no prefix)
    merged.update(session_state)
    return merged

# In get_session():
session.state = _merge_state(app_state, user_state, session_state)
```

**Result:** `session.state` contains all three scopes in one dict with appropriate prefixes

### Critical Findings

#### Finding 1: temp: State Scope

**Scope:** Per-Session (NOT per-invocation)

**Lifecycle:**
1. Set via `tool_context.state['temp:key'] = value` during tool execution
2. Exists in Session's runtime state dictionary
3. **NOT persisted** when `append_event()` is called (filtered by `_trim_temp_delta_state`)
4. Remains in Session state for subsequent tool calls in same session
5. **Lost** when Session is destroyed or reloaded from storage

**Example:**
```python
# Tool Call 1
tool_context.state['temp:delegate'] = FrontendToolDelegate()

# Tool Call 2 (same session)
delegate = tool_context.state.get('temp:delegate')  # ✅ Still exists!

# After session reload from DB
delegate = tool_context.state.get('temp:delegate')  # ❌ Gone (not persisted)
```

#### Finding 2: State Persistence Timing

**When state is persisted:**
- After each `append_event()` call
- During `create_session()` for initial state
- Not continuously (state exists in memory between events)

**What gets persisted:**
- ✅ `app:*` keys → StorageAppState table
- ✅ `user:*` keys → StorageUserState table
- ✅ No-prefix keys → Session's state field
- ❌ `temp:*` keys → Discarded before persistence

#### Finding 3: Multi-Connection Scenario

**Current Architecture:**
```python
session_id = f"session_{user_id}_{app_name}"  # No connection_id!
```

**Implication for temp: state:**
```
User opens 2 tabs:
- Tab 1 WebSocket → Same Session → state['temp:delegate'] = Delegate_A
- Tab 2 WebSocket → Same Session → state['temp:delegate'] = Delegate_B (overwrites!)

Problem: Both connections share same Session state (including temp:*)
```

**Conclusion:** `temp:` prefix does NOT solve the multi-connection issue because temp: state is still Session-scoped, and multiple WebSocket connections share the same Session.

---

## Final Decision: Approach A (Closure Pattern)

### Investigation Summary

After deep dive into ADK source code implementation, we discovered:

1. **temp: state is Session-scoped**, not invocation-scoped
   - Persists across multiple tool calls in same session
   - Only difference: not persisted to storage (lost on reload)

2. **Current session architecture is per-user**, not per-connection
   - `session_id = f"session_{user_id}_{app_name}"`
   - Multiple WebSocket connections from same user share the same Session

3. **temp: state would be shared across connections**
   - Tab 1 and Tab 2 from same user → same Session → same temp: state
   - Connection-specific delegate in temp: state would be overwritten

### Why Approach B (ToolContext.state) Fails

```python
# Approach B implementation:
session.state['temp:frontend_delegate'] = FrontendToolDelegate()

# Problem scenario:
User opens Tab 1:
  WebSocket 1 → Session(user_id="alice") → state['temp:delegate'] = Delegate_A

User opens Tab 2:
  WebSocket 2 → Session(user_id="alice") → state['temp:delegate'] = Delegate_B  # Overwrites!

Result: Both connections use Delegate_B (wrong!)
```

**Root cause:** Session is per-user, but we need per-connection isolation.

### Why Approach A (Closure) Works

```python
# Approach A implementation:
def build_connection_tools(delegate: FrontendToolDelegate):
    async def change_bgm(track: int, tool_context: ToolContext):
        result = await delegate.execute_on_frontend(...)  # Uses closure delegate
    return [change_bgm, get_location]

# Each connection:
connection_delegate = FrontendToolDelegate()  # Unique per connection
connection_tools = build_connection_tools(connection_delegate)  # Captures delegate
connection_agent = Agent(tools=all_tools)
```

**Isolation mechanism:** Python closure captures connection-specific delegate at function creation time.

### Implementation Decision

**✅ Use Approach A: Connection-scoped tools with closure**

**Required changes:**
1. Create `build_connection_tools(delegate)` function ✅ (Already done)
2. In WebSocket handler:
   - Create per-connection `FrontendToolDelegate` ✅ (Already done)
   - Build connection tools with closure
   - Combine with global tools (get_weather, calculate, get_current_time)
   - Create per-connection Agent with combined tools
   - Create per-connection Runner
   - Use connection-specific runner instead of global

**Trade-offs accepted:**
- ❌ Cannot reuse global Agent (must create per-connection)
- ❌ Cannot reuse global Runner (must create per-connection)
- ✅ Correct isolation between connections
- ✅ Type-safe delegate handling
- ✅ Automatic cleanup on connection close

### Alternative Considered: Make Session Per-Connection

**Option:** Change session architecture to be per-connection

```python
async def get_or_create_session(user_id, agent_runner, app_name, connection_id):
    session_id = f"session_{user_id}_{app_name}_{connection_id}"
    ...
```

**Rejected because:**
- ❌ Breaks conversation history continuity across reconnections
- ❌ User loses context when switching tabs
- ❌ Requires major architectural change to session management
- ❌ Not aligned with ADK's design (sessions are meant to persist)

### Next Steps

1. ⏭️ Implement per-connection Agent creation in WebSocket handler
2. ⏭️ Test with multiple concurrent connections
3. ⏭️ Verify tools use correct delegate per connection
4. ⏭️ Document the pattern for future reference

---

## Re-evaluation: Connection Identifier and Multi-Device Scenarios

**Date:** 2025-12-13 (continued discussion)

### Background: Reconsidering the Problem Space

Before implementing the closure pattern (Approach A), we paused to discuss fundamental concepts and requirements.

### Concept Alignment: User, Connection, Session, Delegate

#### 1. User
- **Definition:** A person using the system
- **Identifier:** `user_id` (e.g., "alice", "bob")
- **Characteristics:**
  - Can have multiple devices (PC, iPhone, Android)
  - Can open multiple browser tabs
  - Has conversation history

#### 2. WebSocket Connection
- **Definition:** Physical communication channel between browser/device and server
- **Identifier:** **Currently missing!** (only WebSocket instance)
- **Characteristics:**
  - 1 tab/device = 1 connection
  - Can disconnect/reconnect
  - Bidirectional communication

#### 3. Session (ADK Session)
- **Definition:** Conversation context managed by ADK
- **Identifier:** `session_id = f"session_{user_id}_{app_name}"`
- **Characteristics:**
  - Holds conversation history
  - Has state (`app:`, `user:`, `temp:`, no-prefix)
  - **Current design:** Per-user (shared across connections)

#### 4. FrontendToolDelegate
- **Definition:** Object that mediates frontend tool execution
- **Role:**
  - Send tool calls to frontend
  - Wait for results (`asyncio.Future`)
  - Manage `_pending_calls` state
- **Scope:** **To be determined**

### Critical Insight: Multi-Device Scenario

**User's important observation:**

> When considering not just tabs but different devices (PC, iPhone, Android), the device that **initiated the interaction** should be the one receiving the tool approval request.

**Example Scenario:**
```
User Alice has 3 active connections:
├─ PC (WebSocket 1) → Sends message → Tool call triggered
├─ iPhone (WebSocket 2) → Idle
└─ Android (WebSocket 3) → Idle

Tool approval request should go to: PC (WebSocket 1)
```

**Rationale:**
- The user is actively using that specific device
- Other devices shouldn't randomly show approval dialogs
- Context is on the device where conversation is happening

### Future Extension: Remote Device Control

**Potential use case:**
- User on PC starts conversation
- Tool requires mobile-specific permission (e.g., location)
- System could route approval request to user's iPhone

**Requirement:** Ability to manage and route between multiple connections for same user.

### The Missing Piece: Connection Identifier

**Current problem:**
```python
@app.websocket("/api/chat/bidi")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # No connection_id!
    # No way to identify which connection tool call came from
```

**What we need:**
```python
# Generate unique identifier for each connection
connection_id = str(uuid.uuid4())

# Track multiple connections per user
user_connections[user_id] = [
    {"connection_id": "conn_1", "device": "PC", "websocket": ws_1},
    {"connection_id": "conn_2", "device": "iPhone", "websocket": ws_2},
    {"connection_id": "conn_3", "device": "Android", "websocket": ws_3},
]

# When tool call occurs:
# 1. Record source_connection_id
# 2. Route approval request to same connection
# 3. (Future) Support routing to different connection
```

### Critical Question: Is This a Solved Problem?

**User's key insight:**

> This problem (connection management, multi-device support) can't be unique to us. ADK and AI SDK v6 must have encountered this. There should be:
> - Official documentation
> - Reference implementations
> - GitHub issues/PRs discussing this
> - Recommended patterns

**Why this matters:**
- We shouldn't reinvent the wheel
- Official patterns are likely more robust
- Community discussion provides valuable context
- Avoids known pitfalls

### Investigation Plan: Official Solutions and Patterns

Before proceeding with implementation, we need to investigate:

#### ADK (Google ADK) Investigation

**Questions:**
1. How does ADK handle multi-device/multi-connection scenarios?
2. Is there official support for connection identifiers?
3. How is Session management designed for WebSocket connections?
4. What patterns exist for routing tool calls to specific connections?

**Resources to check:**
- ADK documentation (especially WebSocket/BIDI sections)
- ADK GitHub repository (`google/adk-python`)
  - Search issues: "multi-device", "multi-connection", "websocket session"
  - Search PRs: "connection", "session management"
  - Search code: Connection handling patterns
- ADK examples and demos (especially bidi-demo)

#### AI SDK v6 (Vercel) Investigation

**Questions:**
1. How does AI SDK v6 handle WebSocket connection management?
2. Is there built-in support for multi-tab/multi-device scenarios?
3. How is tool approval routing handled?
4. What are the recommended patterns for connection tracking?

**Resources to check:**
- AI SDK v6 documentation
  - WebSocket transport documentation
  - Tool approval documentation
- AI SDK v6 GitHub repository (`vercel/ai`)
  - Search issues: "websocket", "multi-tab", "connection"
  - Search PRs: "transport", "session"
  - Search code: WebSocket transport implementation
- Community discussions and examples

#### Search Keywords

- "multi-device session management"
- "websocket connection identifier"
- "tool approval routing"
- "multi-tab websocket"
- "connection tracking"
- "device switching"
- "session continuity"

### Investigation Goals

1. **Find official patterns** for connection management
2. **Understand design decisions** made by ADK and AI SDK v6
3. **Learn from community** experiences and solutions
4. **Identify best practices** for our use case
5. **Avoid known pitfalls** that others have encountered

### Status

- ✅ Conceptual alignment complete
- ✅ Problem space clarified
- ⏭️ Official documentation investigation (ADK)
- ⏭️ Official documentation investigation (AI SDK v6)
- ⏭️ GitHub issues/PRs research (ADK)
- ⏭️ GitHub issues/PRs research (AI SDK v6)
- ⏭️ Community patterns research
- ⏭️ Decision based on findings

---

## Investigation: Official Patterns for Connection Management

**Investigation Start:** 2025-12-13

### ADK Investigation

#### TODO: ADK Documentation Search

- [ ] Search ADK docs for "connection"
- [ ] Search ADK docs for "multi-device"
- [ ] Review BIDI streaming documentation
- [ ] Review Session management documentation

#### TODO: ADK GitHub Repository Search

- [ ] Issues with keyword "multi-device"
- [ ] Issues with keyword "multi-connection"
- [ ] Issues with keyword "websocket session"
- [ ] PRs related to connection management
- [ ] Code search: Connection handling patterns

### AI SDK v6 Investigation

#### TODO: AI SDK v6 Documentation Search

- [ ] WebSocket transport documentation
- [ ] Multi-tab handling documentation
- [ ] Tool approval routing documentation
- [ ] Session management documentation

#### TODO: AI SDK v6 GitHub Repository Search

- [ ] Issues with keyword "websocket"
- [ ] Issues with keyword "multi-tab"
- [ ] Issues with keyword "connection"
- [ ] PRs related to transport layer
- [ ] Code search: WebSocket transport implementation

### Investigation Results

*(To be filled after research)*

