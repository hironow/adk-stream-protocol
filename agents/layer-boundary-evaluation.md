# Layer Boundary Evaluation Report

**Date**: 2025-12-19
**Branch**: hironow/fix-confirm
**Context**: Session 10 - Refactoring evaluation

## Executive Summary

**Overall Status**: ✅ **Layers are mostly well-separated**

- Frontend: ✅ No ADK knowledge leakage
- Services Layer: ✅ Properly separated
- Protocol Conversion: ✅ Correctly handles both systems
- ADK Layer: ✅ Isolated from AI SDK v6
- **server.py**: ⚠️ Room for improvement (non-urgent)

---

## Layer-by-Layer Analysis

### 1. Frontend Layer (Browser) - ✅ **GOOD**

**Knowledge**: AI SDK v6 Data Stream Protocol ONLY

#### What Frontend Knows:
- `toolName` as opaque strings (e.g., "adk_request_confirmation")
- AI SDK v6 Data Stream Protocol events
- WebSocket/SSE as transport mechanisms

#### What Frontend Does NOT Know:
- ❌ ADK Event system
- ❌ ADK invocation_id
- ❌ ADK Session management
- ❌ How backend implements tools

#### Evidence:
```tsx
// components/tool-invocation.tsx:66
const isAdkConfirmation = toolName === "adk_request_confirmation";
```

**Analysis**: ✅ This is protocol-level knowledge, not implementation knowledge.
- `adk_request_confirmation` is just a toolName string from AI SDK v6
- Frontend treats it as any other tool
- Comments mentioning "ADK" are for context, not implementation dependency

**Conclusion**: **No ADK knowledge leakage in Frontend**

---

### 2. Transport Layer (server.py) - ⚠️ **ROOM FOR IMPROVEMENT**

**Current Size**: 849 lines
**Largest Function**: `live_chat()` - 409 lines (48% of file!)

#### Good Separation (Already Done):
✅ `FrontendToolDelegate` → `services/frontend_tool_service.py`
✅ `ToolConfirmationInterceptor` → `confirmation_interceptor.py`
✅ `ADKVercelIDMapper` → `adk_vercel_id_mapper.py`

#### Problem: `live_chat()` Function (409 lines)

**Current responsibilities**:
1. WebSocket connection management
2. Session creation and management
3. FrontendToolDelegate setup
4. ToolConfirmationInterceptor initialization
5. Event stream conversion
6. Tool result routing
7. Error handling
8. Audio handling
9. Chunk logging

**Code smell indicators**:
```python
async def live_chat(websocket: WebSocket):  # noqa: C901, PLR0915
    # C901: Complexity too high
    # PLR0915: Too many statements
```

#### What server.py SHOULD contain:
```python
# Ideal structure
@app.websocket("/live-chat")
async def live_chat(websocket: WebSocket):
    service = BidiChatService(websocket)
    await service.handle_connection()
```

#### What server.py SHOULD NOT contain:
- ❌ Complex business logic
- ❌ Session management details
- ❌ Tool result routing logic
- ❌ Event loop management

#### Proposed Refactoring:

**Create**: `services/bidi_chat_service.py`
```python
class BidiChatService:
    """
    Service layer for BIDI WebSocket chat handling.

    Responsibilities:
    - WebSocket lifecycle management
    - Session setup
    - Event stream processing
    - Tool result routing
    """

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.frontend_delegate = FrontendToolDelegate()
        self.session = None

    async def handle_connection(self):
        await self._setup()
        try:
            await self._event_loop()
        finally:
            await self._cleanup()

    async def _setup(self):
        """Setup session and dependencies"""
        pass

    async def _event_loop(self):
        """Main event processing loop"""
        pass

    async def _cleanup(self):
        """Cleanup resources"""
        pass
```

**server.py becomes**:
```python
from services.bidi_chat_service import BidiChatService

@app.websocket("/live-chat")
async def live_chat(websocket: WebSocket):
    """BIDI mode WebSocket endpoint - delegates to service layer"""
    service = BidiChatService(websocket, bidi_agent_runner, frontend_delegate)
    await service.handle_connection()
```

**Priority**: MEDIUM (after E2E issues resolved)

---

### 3. Services Layer - ✅ **GOOD**

**Current Structure**:
```
services/
├── __init__.py
└── frontend_tool_service.py (FrontendToolDelegate)
```

**Evaluation**: ✅ Clean separation
- No ADK-specific knowledge
- No AI SDK v6-specific knowledge
- Uses ADKVercelIDMapper for ID abstraction

**Future additions** (after `live_chat()` refactoring):
```
services/
├── __init__.py
├── frontend_tool_service.py
└── bidi_chat_service.py (NEW)
```

---

### 4. Protocol Conversion Layer - ✅ **EXCELLENT**

**Components**:
- `stream_protocol.py` - ADK Event → AI SDK v6 format conversion
- `adk_vercel_id_mapper.py` - ID mapping abstraction

**Knowledge**: ADK + AI SDK v6 (both required - this is correct!)

**Why this is correct**:
- Protocol Conversion **must** know both systems
- This is the **only** place that should know both
- Provides abstraction for upper layers (Services, Transport)

**Evidence of good design**:
```python
# ADKVercelIDMapper provides clean abstraction
class ADKVercelIDMapper:
    def register(self, tool_name: str, function_call_id: str):
        # ADK uses tool_name
        # AI SDK v6 uses function_call_id
        pass

    def get_function_call_id(self, tool_name: str) -> str:
        # Services don't need to know conversion logic
        pass
```

---

### 5. ADK Layer - ✅ **EXCELLENT**

**Components**:
- `adk_compat.py` - ADK session management
- `adk_ag_runner.py` - ADK agent runners
- `adk_ag_tools.py` - ADK tool implementations

**Knowledge**: ADK ONLY (no AI SDK v6 knowledge)

**Evidence**:
- No imports from `stream_protocol.py` ✅
- No references to `function_call_id` (AI SDK v6 concept) ✅
- Only uses ADK types: `Event`, `Session`, `ToolContext` ✅

---

## Dependency Direction Analysis

### Current Dependency Flow (✅ Correct):

```
Frontend (AI SDK v6)
    ↕ WebSocket/SSE Protocol
Transport (server.py)
    ↓ delegates to
Services (frontend_tool_service.py)
    ↓ uses
Protocol Conversion (stream_protocol.py, adk_vercel_id_mapper.py)
    ↓ converts
ADK Layer (adk_compat.py, adk_ag_runner.py)
```

### No Circular Dependencies: ✅

- Frontend → does NOT depend on Backend
- Transport → does NOT depend on ADK Layer directly
- Services → does NOT depend on ADK Layer directly
- Protocol Conversion → is the ONLY bridge

---

## Key Findings

### ✅ What's Working Well:

1. **Frontend Isolation**: Zero ADK knowledge leakage
2. **Service Layer Separation**: FrontendToolDelegate properly extracted
3. **Protocol Abstraction**: ADKVercelIDMapper provides clean interface
4. **ADK Layer Isolation**: No upstream dependencies

### ⚠️ What Needs Improvement:

1. **server.py Complexity**: `live_chat()` function is 409 lines (48% of file)
2. **Responsibility Mixing**: Transport layer contains business logic

### ❌ No Critical Issues Found

---

## Recommendations

### Immediate (Current Session): ❌ DEFER

**Reason**: E2E tests are failing (0/8 passing). Focus on fixing functional issues first.

**Action**: Continue with Integration test creation to reproduce E2E failures.

### Short-term (Next Session):

**Priority**: MEDIUM
**Task**: Refactor `live_chat()` → `BidiChatService`

**Benefits**:
- Easier to test (unit test service layer)
- Easier to debug (smaller functions)
- Easier to maintain (clear responsibilities)

**Risk**: LOW (well-tested with Integration tests)

### Long-term:

**Consider**: Extract SSE endpoint to service layer as well
- `services/sse_chat_service.py`
- Mirror BIDI structure for consistency

---

## Conclusion

**Overall Assessment**: ✅ **Architecture is sound**

**Layer boundaries are clear and properly maintained**:
- Frontend: No knowledge leakage ✅
- Services: Properly separated ✅
- Protocol Conversion: Correct abstraction ✅
- ADK Layer: Properly isolated ✅

**Only improvement area**:
- server.py `live_chat()` complexity (non-urgent)

**Recommendation**:
1. **Now**: Focus on E2E test failures (functional issue)
2. **Later**: Refactor `live_chat()` when tests are green

---

## Appendix: Code Metrics

### File Sizes:
```
server.py                      849 lines
  ├── live_chat()              409 lines (48%)
  ├── stream()                 ~100 lines (12%)
  └── Other                    ~340 lines (40%)

services/frontend_tool_service.py  188 lines
stream_protocol.py                 944 lines
adk_compat.py                      520 lines
adk_vercel_id_mapper.py           207 lines
```

### Complexity Suppressions:
```python
# server.py:441
async def live_chat(websocket: WebSocket):  # noqa: C901, PLR0915
    # C901: McCabe complexity too high
    # PLR0915: Too many statements
```

**Interpretation**: These suppressions indicate the function is too complex and should be refactored.
