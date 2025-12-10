# Phase 4: WebSocket Bidirectional Streaming (Experimental)

**Status**: Experimental / Not Production Ready
**Date**: 2025-12-10
**Reason for Archival**: WebSocket implementation adds complexity without clear benefit over SSE streaming for text-based chat.

## Why Phase 4 Was Not Adopted

### Problems with WebSocket Approach

1. **AI SDK v6 Incompatibility**
   - AI SDK v6 has NO built-in WebSocket support
   - `useChat()` hook only supports SSE
   - Required custom WebSocket client implementation

2. **Increased Complexity**
   - Custom WebSocket state management
   - Manual message queueing
   - Complex connection lifecycle handling
   - Not compatible with AI SDK v6 Data Stream Protocol

3. **Limited Benefits for Current Use Case**
   - Audio/Video: Not currently needed
   - Interruptions: Not currently needed
   - Bidirectional: SSE is sufficient for text chat

### Adopted Solution: Phase 3 (ADK SSE Streaming)

Phase 3 provides all required functionality with better compatibility:

✅ AI SDK v6 complete compatibility
✅ `useChat()` hook support
✅ ADK integration (run_async())
✅ Streaming responses
✅ Simple, proven SSE protocol

## Artifacts

- `test_websocket_client.py`: Python WebSocket test client
- `TEST_RESULTS_PHASE4.md`: Test results documentation
- WebSocket endpoint code (see below)
- Custom WebSocket client code (see below)

## WebSocket Server Endpoint (server.py)

Location: server.py lines 359-463

```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional streaming (Phase 4 - EXPERIMENTAL)
    Uses ADK's run_async() method (same as Phase 3 SSE)

    NOTE: This was an experimental implementation that added complexity
    without providing significant benefits over SSE streaming.
    """
    await websocket.accept()
    logger.info("WebSocket connection established")

    user_id = "default_user"

    try:
        session = await get_or_create_session(user_id)
        logger.info(f"WebSocket session created: {session.id}")

        async def upstream():
            """Receive messages from client"""
            try:
                while True:
                    data = await websocket.receive_text()
                    message_data = json.loads(data)
                    logger.info(f"Received from client: {message_data}")

                    if message_data.get("text"):
                        # Send user message event
                        await websocket.send_json({
                            "type": "message-start",
                            "role": "user",
                            "content": message_data["text"]
                        })

                        # Process with ADK agent using run_async
                        message_content = types.Content(
                            role="user",
                            parts=[types.Part(text=message_data["text"])]
                        )

                        # Stream response
                        text_id = "0"
                        has_started = False

                        async for event in agent_runner.run_async(
                            user_id=user_id,
                            session_id=session.id,
                            new_message=message_content,
                        ):
                            if event.content and event.content.parts:
                                for part in event.content.parts:
                                    if hasattr(part, 'text') and part.text:
                                        if not has_started:
                                            await websocket.send_json({
                                                "type": "text-start",
                                                "id": text_id
                                            })
                                            has_started = True

                                        await websocket.send_json({
                                            "type": "text-delta",
                                            "id": text_id,
                                            "delta": part.text
                                        })

                        if has_started:
                            await websocket.send_json({
                                "type": "text-end",
                                "id": text_id
                            })

                        await websocket.send_json({
                            "type": "finish",
                            "finishReason": "stop"
                        })

            except WebSocketDisconnect:
                logger.info("Client disconnected from upstream")
            except Exception as e:
                logger.error(f"Upstream error: {e}")
                await websocket.send_json({
                    "type": "error",
                    "error": str(e)
                })

        await upstream()

    except WebSocketDisconnect:
        logger.info("WebSocket connection closed")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
```

## Custom WebSocket Client (app/page.tsx)

Location: app/page.tsx lines 26-149

```typescript
// WebSocket state
const [wsMessages, setWsMessages] = useState<Message[]>([]);
const [wsConnected, setWsConnected] = useState(false);
const [wsError, setWsError] = useState<string | null>(null);
const [wsLoading, setWsLoading] = useState(false);
const wsRef = useRef<WebSocket | null>(null);
const currentMessageRef = useRef<string>("");

// Determine if we're using WebSocket mode
const useWebSocket = config?.backendMode === "adk-websocket";

// WebSocket connection
useEffect(() => {
  if (!useWebSocket) return;

  const ws = new WebSocket("ws://localhost:8000/ws");
  wsRef.current = ws;

  ws.onopen = () => {
    console.log("WebSocket connected");
    setWsConnected(true);
    setWsError(null);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("WebSocket message:", data);

    if (data.type === "message-start") {
      // User message echo
      setWsMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: data.content,
        },
      ]);
      currentMessageRef.current = "";
    } else if (data.type === "text-start") {
      setWsLoading(true);
    } else if (data.type === "text-delta") {
      currentMessageRef.current += data.delta;
      setWsMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: currentMessageRef.current },
          ];
        } else {
          return [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: currentMessageRef.current,
            },
          ];
        }
      });
    } else if (data.type === "text-end") {
      console.log("Text completed");
    } else if (data.type === "finish") {
      setWsLoading(false);
      currentMessageRef.current = "";
    } else if (data.type === "error") {
      setWsError(data.error);
      setWsLoading(false);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    setWsError("WebSocket connection error");
    setWsConnected(false);
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    setWsConnected(false);
  };

  return () => {
    ws.close();
  };
}, [useWebSocket]);

const handleSubmit = useCallback(
  (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (useWebSocket) {
      // Send via WebSocket
      if (wsRef.current && wsConnected) {
        wsRef.current.send(JSON.stringify({ text: input }));
        setInput("");
        setWsLoading(true);
      } else {
        setWsError("WebSocket not connected");
      }
    } else {
      // Send via AI SDK useChat
      sendMessage({ text: input });
      setInput("");
    }
  },
  [input, useWebSocket, wsConnected, sendMessage]
);
```

## Key Learnings

### What Worked
- ✅ WebSocket connection establishment
- ✅ Bidirectional communication
- ✅ Streaming text responses
- ✅ Custom event protocol

### What Didn't Work
- ❌ AI SDK v6 integration
- ❌ Maintaining compatibility with useChat()
- ❌ Justifying the added complexity

### If Audio/Video Becomes Required

If audio/video becomes a requirement in the future, consider:

1. **ADK run_live() with BIDI mode**
   - Use `StreamingMode.BIDI` in RunConfig
   - Implement LiveRequestQueue for bidirectional messaging
   - Follow ADK official documentation for bidi-streaming

2. **Keep Backend-Only WebSocket**
   - Implement WebSocket only in backend (server.py)
   - Keep frontend on SSE or HTTP
   - Backend proxies between frontend HTTP and ADK WebSocket

3. **Wait for AI SDK v6 WebSocket Support**
   - Monitor Vercel AI SDK roadmap
   - Adopt official WebSocket support when available

## References

- [ADK Bidi-streaming Developer Guide](https://google.github.io/adk-docs/streaming/dev-guide/part1/)
- [AI SDK v6 Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [Medium Article: ADK Bidi-Streaming Guide](https://medium.com/google-cloud-jp/...)
