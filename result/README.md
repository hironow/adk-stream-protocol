# Result Module

Purpose: Provide a simple `Result` type: `Ok(value)` or `Error(value)`.

Key rules

- Services must return `Result`, not raise HTTP exceptions.
- Pattern match on results where possible for clarity.

Wrong (NG)

```python
from fastapi import HTTPException

async def do_something():
    if bad:
        raise HTTPException(400, "bad")  # ❌
    return {"ok": True}
```

Recommended

```python
async def do_something() -> Result[dict, str]:
    if bad:
        return Error("bad")
    return Ok({"ok": True})  # ✅

match await do_something():
    case Ok(value):
        ...
    case Error(msg):
        ...
```

Testing tips

- Assert `Ok`/`Error` branches explicitly. Keep messages precise.
