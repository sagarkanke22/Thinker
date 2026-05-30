"""Subprocess sandbox for executing widget logic_code.

[C016] Every /render call = a fresh subprocess. No state carries between
       invocations. Module-level mutable state inside user code cannot
       accumulate across requests by construction.
[C020] Defense in depth: subprocess + timeout + memory cap + restricted
       __builtins__ (no __import__) + no filesystem allowlist needed
       (subprocess gets default fs perms; CWD is the project root which
       the user can read anyway).
[L032] Same root cause as the Coke Prod accumulation bug — addressed
       structurally here rather than by .clear() at handler start.

Calling convention:
  - user's `logic_code` must define `def render(params) -> dict:`
  - the dict is returned verbatim as the JSON body of /render

Failure modes (returned as `{"error": {"type": ..., "message": ...}}`):
  - timeout           : process exceeded the timeout budget
  - runtime           : exception raised inside user code
  - no_render         : code did not define a callable `render`
  - non_dict          : `render` returned a non-dict value
  - non_serializable  : returned dict contained non-JSON values
  - sandbox_exit      : subprocess exited non-zero unexpectedly
  - bad_output        : runner stdout was not valid JSON
  - no_output         : runner produced no stdout
"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from typing import Any


# Embedded runner script — kept as a textwrapped string so sandbox.py ships
# as a single file with no companion. The runner is the FIRST thing executed
# in the subprocess; it sets up the restricted environment, then exec()s the
# user code, then JSON-dumps the result to stdout.
_RUNNER = textwrap.dedent('''
    import contextlib
    import datetime
    import io
    import json
    import math
    import sqlite3
    import statistics
    import sys

    try:
        import resource
        _HAS_RESOURCE = True
    except ImportError:
        _HAS_RESOURCE = False

    # Memory cap (RLIMIT_AS in bytes). Optional — best effort.
    if _HAS_RESOURCE and len(sys.argv) > 1:
        try:
            _mem = int(sys.argv[1])
            if _mem > 0:
                resource.setrlimit(resource.RLIMIT_AS, (_mem, _mem))
        except (ValueError, OSError):
            pass

    # Read the single JSON payload {code, params} from stdin.
    payload = json.loads(sys.stdin.read())
    code = payload["code"]
    params = payload.get("params", {})

    # Restricted builtins — explicitly no __import__, eval, exec, open,
    # compile, getattr, setattr, delattr, globals, locals, vars.
    _BI = __builtins__ if isinstance(__builtins__, dict) else __builtins__.__dict__
    _SAFE = {k: _BI[k] for k in (
        "abs", "all", "any", "bool", "dict", "enumerate", "filter",
        "float", "int", "isinstance", "len", "list", "map", "max",
        "min", "pow", "print", "range", "reversed", "round", "set",
        "sorted", "str", "sum", "tuple", "type", "zip",
        "Exception", "ValueError", "TypeError", "KeyError", "IndexError",
        "ZeroDivisionError", "AttributeError",
    ) if k in _BI}

    # Pre-imported allowlisted modules live in globals.
    globals_dict = {
        "__builtins__": _SAFE,
        "json": json,
        "math": math,
        "datetime": datetime,
        "sqlite3": sqlite3,
        "statistics": statistics,
    }

    # Capture and discard user-code stdout so prints don't pollute our
    # JSON output channel.
    _scratch = io.StringIO()
    result_envelope = None

    with contextlib.redirect_stdout(_scratch):
        try:
            exec(code, globals_dict)
        except Exception as e:
            result_envelope = {"error": {"type": "runtime",
                                          "message": f"{type(e).__name__}: {e}"}}

        if result_envelope is None:
            render = globals_dict.get("render")
            if not callable(render):
                result_envelope = {"error": {"type": "no_render",
                    "message": "logic_code did not define a callable render(params)"}}
            else:
                try:
                    result = render(params)
                except Exception as e:
                    result_envelope = {"error": {"type": "runtime",
                        "message": f"{type(e).__name__}: {e}"}}
                else:
                    if not isinstance(result, dict):
                        result_envelope = {"error": {"type": "non_dict",
                            "message": f"render returned {type(result).__name__}, expected dict"}}
                    else:
                        result_envelope = result

    try:
        out = json.dumps(result_envelope)
    except (TypeError, ValueError) as e:
        out = json.dumps({"error": {"type": "non_serializable",
            "message": f"render result not JSON-serializable: {e}"}})

    # Single, clean JSON line on stdout — the sole IPC channel.
    sys.stdout.write(out)
''').strip()


def exec_logic(
    code: str,
    params: dict[str, Any] | None = None,
    timeout: float = 5.0,
    mem_mb: int = 128,
) -> dict:
    """Execute widget logic_code in a fresh sandboxed subprocess.

    Args:
        code: Python source defining `def render(params) -> dict`.
        params: dict passed to `render(params)`. Defaults to {}.
        timeout: wall-clock seconds before SIGKILL. Defaults to 5.
        mem_mb: address-space cap in megabytes. 0 disables. Defaults to 128.

    Returns:
        The dict returned by `render(params)`, OR a `{"error": ...}` envelope
        describing the failure mode. Never raises.
    """
    params = params or {}
    mem_bytes = max(0, mem_mb) * 1024 * 1024
    payload = json.dumps({"code": code, "params": params})

    try:
        proc = subprocess.run(
            [sys.executable, "-c", _RUNNER, str(mem_bytes)],
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"error": {"type": "timeout",
                          "message": f"exceeded {timeout}s budget"}}

    if proc.returncode != 0:
        return {"error": {"type": "sandbox_exit",
                          "message": f"exit={proc.returncode}; "
                                     f"stderr={proc.stderr.strip()[:500]}"}}

    out = proc.stdout.strip()
    if not out:
        return {"error": {"type": "no_output",
                          "message": "subprocess produced no stdout"}}

    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        return {"error": {"type": "bad_output",
                          "message": f"could not parse runner output: {e}"}}
