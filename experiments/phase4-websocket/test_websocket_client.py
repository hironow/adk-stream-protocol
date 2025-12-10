#!/usr/bin/env python3
"""Test WebSocket bidirectional communication with ADK backend"""

import asyncio
import json
import websockets


async def test_websocket():
    """Test WebSocket connection and message exchange"""
    uri = "ws://localhost:8000/ws"

    print(f"Connecting to {uri}...")

    async with websockets.connect(uri) as websocket:
        print("✅ WebSocket connected!")

        # Send test message
        test_message = {"text": "What is 2+2?"}
        print(f"\n📤 Sending: {json.dumps(test_message)}")
        await websocket.send(json.dumps(test_message))

        # Receive and display responses
        print("\n📥 Receiving responses:")
        print("-" * 60)

        full_response = ""

        while True:
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=30.0)
                data = json.loads(response)

                event_type = data.get("type")

                if event_type == "message-start":
                    print(f"[message-start] User: {data.get('content')}")

                elif event_type == "text-start":
                    print(f"[text-start] Assistant response starting...")
                    full_response = ""

                elif event_type == "text-delta":
                    delta = data.get("delta", "")
                    full_response += delta
                    print(delta, end="", flush=True)

                elif event_type == "text-end":
                    print(f"\n[text-end] Text completed")

                elif event_type == "finish":
                    print(f"[finish] Response complete: {data.get('finishReason')}")
                    break

                elif event_type == "error":
                    print(f"❌ [error] {data.get('error')}")
                    break

                else:
                    print(f"[{event_type}] {data}")

            except asyncio.TimeoutError:
                print("\n⏱️  Timeout waiting for response")
                break
            except Exception as e:
                print(f"\n❌ Error: {e}")
                break

        print("-" * 60)
        print(f"\n✅ Test completed!")
        print(f"\nFull response:\n{full_response}")


if __name__ == "__main__":
    asyncio.run(test_websocket())
