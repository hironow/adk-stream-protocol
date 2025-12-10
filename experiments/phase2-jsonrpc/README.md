# Phase 2: JSONRPC Integration (Experimental)

**Status**: Experimental / Not Production Ready
**Date**: 2025-12-10
**Reason for Archival**: JSONRPC endpoint provides non-streaming responses, which doesn't align with the streaming-focused architecture.

## Why Phase 2 Was Not Adopted

### Problems with JSONRPC Approach

1. **No Streaming Support**
   - JSONRPC returns complete responses, not streaming
   - Not compatible with AI SDK v6 streaming expectations
   - Poor user experience for long responses

2. **Limited Use Case**
   - Only useful for simple request-response patterns
   - No real benefit over direct Gemini API calls
   - Doesn't leverage ADK's streaming capabilities

### Adopted Solution: Phase 3 (ADK SSE Streaming)

Phase 3 provides proper streaming with ADK integration:

✅ AI SDK v6 complete compatibility
✅ Real-time streaming responses
✅ ADK integration (run_async())
✅ SSE protocol (proven and reliable)

## JSONRPC Server Endpoint (server.py)

Location: server.py `/jsonrpc` endpoint

```python
@app.post("/jsonrpc", response_model=JSONRPCResponse)
async def jsonrpc(request: JSONRPCRequest):
    """
    JSONRPC 2.0 endpoint (Phase 2 - EXPERIMENTAL)
    Handles chat requests via JSONRPC protocol
    """
    logger.info(f"Received JSONRPC request: method={request.method}, id={request.id}")

    try:
        if request.method == "chat":
            messages_data = request.params["messages"]
            messages = [ChatMessage(**msg) for msg in messages_data]

            last_message = messages[-1].content if messages else ""
            response_text = await run_agent_chat(last_message)

            return JSONRPCResponse(
                jsonrpc="2.0",
                result={"message": response_text, "role": "assistant"},
                id=request.id,
            )
        else:
            return JSONRPCResponse(
                jsonrpc="2.0",
                error=JSONRPCError(code=-32601, message="Method not found"),
                id=request.id,
            )

    except Exception as e:
        logger.error(f"JSONRPC error: {e}")
        return JSONRPCResponse(
            jsonrpc="2.0",
            error=JSONRPCError(code=-32603, message="Internal error", data=str(e)),
            id=request.id,
        )
```

## Frontend Integration (app/api/chat/route.ts)

```typescript
if (BACKEND_MODE === "adk-jsonrpc") {
  try {
    const response = await fetch(`${ADK_BACKEND_URL}/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "chat",
        params: { messages },
        id: Date.now(),
      }),
    });

    const data = await response.json();

    if (data.error) {
      return new Response(
        JSON.stringify({ error: data.error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const assistantMessage = {
      id: `msg-${Date.now()}`,
      role: "assistant" as const,
      content: data.result.message,
    };

    return new Response(
      JSON.stringify({
        messages: [...messages, assistantMessage],
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("JSONRPC request failed:", error);
    return new Response(
      JSON.stringify({ error: "Failed to connect to ADK backend" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
```

## Key Learnings

### What Worked
- ✅ Simple request-response pattern
- ✅ ADK integration working
- ✅ Standard JSONRPC 2.0 protocol

### What Didn't Work
- ❌ No streaming capability
- ❌ Not aligned with streaming architecture
- ❌ Poor UX for long responses

## If Non-Streaming Becomes Required

If non-streaming requests become necessary:

1. **Use Direct API Calls**
   - Phase 1 (Gemini Direct) already provides this
   - Simpler than maintaining JSONRPC layer

2. **Add Simple REST Endpoint**
   - `/api/chat` with complete response
   - No need for JSONRPC complexity

3. **Keep ADK for Streaming Only**
   - ADK's value is in streaming
   - Use direct APIs for non-streaming

## References

- [JSONRPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [ADK Documentation](https://google.github.io/adk-docs/)
