"""Widget type registry — server-side metadata + render envelope merger.

Adding a new widget type:
  1. Add an entry to KNOWN_TYPES below
  2. Add a matching React component in frontend/src/widgets/
  3. Register it in frontend/src/widgets/index.js

[C017] /render response shape (FIXED):
  { "type": str, "props": dict, "data"?: any, "style"?: dict, "error"?: dict }

[C014] field name discipline — do not invent synonyms.
"""
from __future__ import annotations

from typing import Any


# Server is intentionally permissive about which widget types exist — the
# frontend decides what to render. But unknown types coming from base_config
# are flagged at /render time so the dev sees the typo immediately.
KNOWN_TYPES: set[str] = {"text", "input", "button", "table", "chart"}


def merge_render(
    widget_type: str,
    base_config: dict[str, Any],
    sandbox_result: dict[str, Any],
) -> dict[str, Any]:
    """Combine base_config + sandbox output into the /render response envelope.

    [C017] Output: {type, props, data?, style?, error?}.
    [C015] base_config is the authoritative source of `type` and default
           `props`. logic_code (sandbox_result) may add `data`, override
           individual `props` keys, attach `style`, or surface `children`.
           It MAY NOT change the widget's `type`.

    If sandbox_result contains an "error" key (any of the sandbox failure
    modes), it bubbles up unchanged — frontend will render the error widget.
    """
    if "error" in sandbox_result:
        return {"type": widget_type, "error": sandbox_result["error"]}

    out: dict[str, Any] = {
        "type": widget_type,
        "props": dict(base_config.get("props", {})),
    }

    # Props overrides from logic
    sb_props = sandbox_result.get("props")
    if isinstance(sb_props, dict):
        out["props"].update(sb_props)

    # Pass-through fields the renderer expects
    for key in ("data", "style", "children"):
        if key in sandbox_result:
            out[key] = sandbox_result[key]

    return out
