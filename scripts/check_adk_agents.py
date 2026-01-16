#!/usr/bin/env python3
"""
ADK Agent Load Checker

Verifies that ADK agents can be loaded correctly in adk web mode.
This simulates how `adk web adk_stream_protocol/ags` discovers and loads agents.

Usage:
    uv run python scripts/check_adk_agents.py

Exit codes:
    0 - All agents loaded successfully
    1 - One or more agents failed to load
"""

import sys
from pathlib import Path


def setup_sys_path() -> None:
    """Add ags/ to sys.path to simulate adk web behavior."""
    # adk web adds the specified directory to sys.path
    # When running: adk web adk_stream_protocol/ags
    # It does: sys.path.insert(0, "adk_stream_protocol/ags")
    project_root = Path(__file__).parent.parent
    ags_path = project_root / "adk_stream_protocol" / "ags"
    sys.path.insert(0, str(ags_path))


def check_agent(agent_name: str) -> bool:
    """Check if an agent can be loaded and has required attributes."""
    try:
        # Import the agent module (same way AgentLoader does)
        module = __import__(f"{agent_name}.agent", fromlist=["root_agent"])
        root_agent = getattr(module, "root_agent", None)

        if root_agent is None:
            print(f"  [FAIL] {agent_name}: root_agent not found")
            return False

        # Check required attributes
        name = getattr(root_agent, "name", "unknown")
        model = getattr(root_agent, "model", "unknown")
        tools = getattr(root_agent, "tools", [])
        tool_names = [
            t.name if hasattr(t, "name") else t.__name__ for t in tools
        ]

        print(f"  [OK] {agent_name}")
        print(f"       name: {name}")
        print(f"       model: {model}")
        print(f"       tools: {tool_names}")
        return True

    except Exception as e:
        print(f"  [FAIL] {agent_name}: {e}")
        return False


def main() -> int:
    """Main entry point."""
    print("ADK Agent Load Checker")
    print("=" * 50)
    print()

    # Setup sys.path to simulate adk web
    setup_sys_path()
    print(f"sys.path[0]: {sys.path[0]}")
    print()

    # Define agents to check
    agents = ["sse_agent", "bidi_agent"]

    print("Checking agents:")
    print("-" * 50)

    results = []
    for agent_name in agents:
        success = check_agent(agent_name)
        results.append((agent_name, success))
        print()

    # Summary
    print("=" * 50)
    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"Result: {passed}/{total} agents loaded successfully")

    if passed == total:
        print("All agents are ready for adk web!")
        return 0
    else:
        print("Some agents failed to load. Check errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
