"""Ollama client + [C018] prompt assembly for widget logic generation.

[C018] AI prompts for logic_code MUST include:
  1. DB schema (reachable tables + columns)
  2. 1-3 sample rows per relevant table
  3. The widget's base_config
  4. The prior version of logic_code (if any)
  5. The /render response schema verbatim

[C019] Generated logic MUST end with an explicit `return` of a dict matching
       the response schema. This is documented in the system prompt and
       re-validated at the /ai/generate endpoint (Step 20).
"""
from __future__ import annotations

import json
import os
from typing import AsyncIterator, Optional

import anthropic
import httpx
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from logiclive.db import Widget, engine as default_engine

load_dotenv()


# Provider selection (pluggable backends; default ollama for back-compat)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()

# Ollama config
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")

# Anthropic config
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# Lazy client — avoids requiring ANTHROPIC_API_KEY at import time
_anthropic_client: anthropic.AsyncAnthropic | None = None


def _get_anthropic_client() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError(
                "ANTHROPIC_API_KEY not set in .env — required when "
                "LLM_PROVIDER=anthropic"
            )
        _anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


# Sandbox rules — what the user code can and cannot do inside exec_logic().
# Per Step 38 (2026-05-31), imports are now ALLOWED. The remaining
# restrictions are mostly about builtins (no eval/exec/compile/globals).
# Pre-injected modules are a convenience — you don't HAVE to import them
# but you can if you prefer the explicit form.
SANDBOX_RULES = """
SANDBOX CONVENIENCES — these names are PRE-INJECTED into globals; you can
use them directly without an `import` statement:

  sqlite3, json, math, datetime, statistics

`import` STATEMENTS ARE ALLOWED. Use them freely if you need other stdlib
modules (re, collections, itertools, decimal, etc.) or if you prefer the
canonical Python form `from datetime import datetime`.

  Example with imports:    from datetime import datetime, timedelta
                           dt = datetime.strptime("2026-05-01", "%Y-%m-%d")

  Example without imports: dt = datetime.datetime.strptime("2026-05-01", "%Y-%m-%d")
                           # uses the pre-injected `datetime` MODULE

Both styles work. Pick whichever reads cleaner for the task.

Still blocked (these will raise NameError):
  - eval, exec, compile  — code-generation at runtime
  - globals, locals, vars — namespace introspection
  - open, getattr, setattr at builtin level (attribute access via `.` still works)

Resource limits enforced by the subprocess:
  - 5-second wall-clock timeout (per /render call)
  - 128 MB memory cap
  - Fresh subprocess per call — no state survives between renders
""".strip()


# /render response schema — kept in sync with widgets_registry.merge_render.
# The model needs to know what it can produce, not just what it can read.
RENDER_RESPONSE_SCHEMA = """
{
  "props"?:    dict,            # widget-type props (columns for table, layout for chart, ...)
  "data"?:     any,             # table rows array, plotly trace array, ...
  "style"?:    dict,            # runtime style overrides
  "children"?: string,          # for text widgets
  "error"?:    { "type": str, "message": str }
}
""".strip()


def get_db_schema_text(engine_to_use: Optional[Engine] = None) -> str:
    """Return a human-readable summary of every table + column in the DB."""
    eng = engine_to_use or default_engine
    insp = inspect(eng)
    parts = []
    for table_name in insp.get_table_names():
        cols = [f"  {c['name']}: {c['type']}" for c in insp.get_columns(table_name)]
        parts.append(f"TABLE {table_name}:\n" + "\n".join(cols))
    return "\n\n".join(parts) if parts else "(no tables)"


def get_sample_rows_text(db: Session, limit: int = 3) -> str:
    """Best-effort sample rows from every user table (excluding `widgets`).

    Gives the model a sense of the data shape without dumping the whole DB.
    Table names come from the inspector, so the f-string interpolation here
    is safe (no user input lands in the SQL).
    """
    insp = inspect(db.bind)
    parts = []
    for table_name in insp.get_table_names():
        if table_name == "widgets":
            continue  # internals, not relevant for codegen
        try:
            stmt = text(f"SELECT * FROM {table_name} LIMIT {limit}")
            rows = db.execute(stmt).fetchall()
        except Exception:
            continue
        if not rows:
            continue
        parts.append(f"-- {table_name} (showing {len(rows)} of N) --")
        for r in rows:
            try:
                parts.append(json.dumps(dict(r._mapping), default=str))
            except Exception:
                parts.append(str(r))
    return "\n".join(parts) if parts else "(no user tables with sample rows)"


def get_widget_base_config(db: Session, screen_id: str, widget_id: str) -> dict:
    w = db.get(Widget, (screen_id, widget_id))
    return (w.base_config if w else {}) or {}


def get_widget_prior_logic(
    db: Session, screen_id: str, widget_id: str
) -> Optional[str]:
    w = db.get(Widget, (screen_id, widget_id))
    return w.logic_code if w else None


# Mode-specific instructions. Context block stays identical across modes
# so the model has the same grounding; only header + footer swap.
MODE_INSTRUCTIONS = {
    "generate": {
        "header": (
            "You are LogicLive's code-gen helper. Generate a Python function "
            "named `render(params)` for a widget. The function MUST end with "
            "an explicit `return` of a dict matching the /render response "
            "schema. Output ONLY the Python function. No markdown fences, "
            "no commentary. Imports are allowed; sqlite3, json, math, "
            "datetime, statistics are also pre-injected if you prefer the "
            "implicit form (see SANDBOX RULES below)."
        ),
        "footer": "Output the Python function for render(params):",
    },
    "explain": {
        "header": (
            "You are LogicLive's code-explainer. Read the prior logic_code "
            "and explain — in plain English — what the widget does, what "
            "data it pulls, and how the output is shaped. NO code in your "
            "response. NO rewrites. Just prose, 3-6 short paragraphs."
        ),
        "footer": "Explain the widget:",
    },
    "review": {
        "header": (
            "You are LogicLive's code-reviewer. Read the prior logic_code "
            "and list — as concise bullets — bugs, edge cases, security "
            "concerns, or clarity issues. NO code. NO rewrites. Just a "
            "bullet-point review. If the code looks fine, say so.\n"
            "\n"
            "Cross-check suggestions against the SANDBOX RULES below. "
            "Imports are allowed; only `eval`, `exec`, `compile`, "
            "`globals`, `locals`, `vars`, `open` are blocked. If you "
            "spot a runtime error, name the exact rule being violated "
            "(if any) and give the EXACT fix."
        ),
        "footer": "Review the widget:",
    },
    "optimize": {
        "header": (
            "You are LogicLive's optimization advisor. Read the prior "
            "logic_code and list — as concise bullets — concrete "
            "improvements for performance (SQL, Python), clarity, or "
            "correctness. NO code. NO rewrites. Just suggestions.\n"
            "\n"
            "Stick to stdlib + sqlite3 (no external pip dependencies on "
            "the sandbox). Focus on SQL-level optimisation, indexes, "
            "avoiding redundant queries, and efficient Python data "
            "structures."
        ),
        "footer": "Suggest improvements for the widget:",
    },
}


def _format_chat_history(history: list[dict]) -> str:
    """Render prior chat turns from the editor's ChatPanel so the AI sees
    multi-turn context. Long assistant code blocks are truncated to keep
    prompt token count bounded.

    Labels include the message's mode (when present) so a follow-up like
    "apply the fixes from your review above" can be unambiguously tied
    to a prior ASSISTANT (mode=review) turn — not a code or explain turn.
    """
    lines = []
    for m in history:
        role = m.get("role", "user")
        content = (m.get("content") or "").strip()
        if not content:
            continue
        mode = m.get("mode")
        base = "USER" if role == "user" else "ASSISTANT"
        label = f"{base} (mode={mode})" if mode else base
        if len(content) > 1500:
            content = content[:1500] + "\n... (truncated)"
        lines.append(f"{label}: {content}")
    return "\n\n".join(lines) if lines else "(empty)"


def build_prompt(
    user_request: str,
    *,
    schema_text: str,
    sample_rows_text: str,
    base_config: dict,
    prior_logic: Optional[str],
    mode: str = "generate",
    history: Optional[list[dict]] = None,
) -> str:
    """Assemble the full prompt per [C018]. All 5 ingredients must appear.

    `mode` controls the instruction wrapper:
      - generate (default): emit Python `render(params)` function
      - explain / review / optimize: emit prose, no code
    Context block is identical across modes for consistent grounding.

    `history` is the per-widget conversation from the editor's ChatPanel
    (most recent ~10 turns). When present, included as a CONVERSATION
    SO FAR block so follow-up prompts like "add a LIMIT" know what
    "it" refers to (the prior code, not just the schema).
    """
    instr = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["generate"])
    parts = [
        instr["header"],
        "",
        "=== SANDBOX RULES ===",
        SANDBOX_RULES,
        "",
        "=== DB SCHEMA ===",
        schema_text,
        "",
        "=== SAMPLE ROWS ===",
        sample_rows_text,
        "",
        "=== WIDGET base_config ===",
        json.dumps(base_config, indent=2),
        "",
        "=== PRIOR logic_code ===",
        prior_logic if prior_logic else "(none — generate fresh)",
        "",
        "=== /render response schema ===",
        RENDER_RESPONSE_SCHEMA,
        "",
    ]
    if history:
        parts.extend([
            "=== CONVERSATION SO FAR ===",
            _format_chat_history(history),
            "",
        ])
    parts.extend([
        "=== USER REQUEST ===",
        user_request if user_request else "(no specific question)",
        "",
        instr["footer"],
    ])
    return "\n".join(parts)


async def call_ollama(
    prompt: str,
    *,
    model: Optional[str] = None,
    host: Optional[str] = None,
    timeout: float = 120.0,
) -> str:
    """POST {host}/api/generate with stream=True; accumulate + return full text."""
    mdl = model or OLLAMA_MODEL
    url = (host or OLLAMA_HOST).rstrip("/") + "/api/generate"
    body = {"model": mdl, "prompt": prompt, "stream": True}

    out: list[str] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=body) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                token = chunk.get("response")
                if token:
                    out.append(token)
                if chunk.get("done"):
                    break
    return "".join(out)


async def stream_ollama(
    prompt: str,
    *,
    model: Optional[str] = None,
    host: Optional[str] = None,
    timeout: float = 120.0,
) -> AsyncIterator[str]:
    """Yield tokens one at a time. Used by /ai/generate's SSE in Step 20."""
    mdl = model or OLLAMA_MODEL
    url = (host or OLLAMA_HOST).rstrip("/") + "/api/generate"
    body = {"model": mdl, "prompt": prompt, "stream": True}

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=body) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                token = chunk.get("response")
                if token:
                    yield token
                if chunk.get("done"):
                    break


async def call_anthropic(
    prompt: str,
    *,
    model: Optional[str] = None,
    max_tokens: int = 2048,
) -> str:
    """Non-streaming call to Anthropic; accumulate + return full text."""
    client = _get_anthropic_client()
    mdl = model or ANTHROPIC_MODEL
    msg = await client.messages.create(
        model=mdl,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if hasattr(b, "text"))


async def stream_anthropic(
    prompt: str,
    *,
    model: Optional[str] = None,
    max_tokens: int = 2048,
) -> AsyncIterator[str]:
    """Yield Anthropic response tokens one at a time. Used by /ai/generate SSE."""
    client = _get_anthropic_client()
    mdl = model or ANTHROPIC_MODEL
    async with client.messages.stream(
        model=mdl,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for text_chunk in stream.text_stream:
            yield text_chunk


# ─── Provider dispatcher ───────────────────────────────────────
# Switch on LLM_PROVIDER env var. Default: ollama (back-compat).
# Used by /ai/generate. Tests can monkeypatch stream_llm directly.

async def call_llm(prompt: str, *, model: Optional[str] = None) -> str:
    if LLM_PROVIDER == "anthropic":
        return await call_anthropic(prompt, model=model)
    return await call_ollama(prompt, model=model)


async def stream_llm(
    prompt: str,
    *,
    model: Optional[str] = None,
) -> AsyncIterator[str]:
    if LLM_PROVIDER == "anthropic":
        async for tok in stream_anthropic(prompt, model=model):
            yield tok
    else:
        async for tok in stream_ollama(prompt, model=model):
            yield tok


async def generate_logic(
    user_request: str,
    screen_id: str,
    widget_id: str,
    db: Session,
) -> str:
    """Assemble [C018] context, call the configured LLM, return Python source."""
    prompt = build_prompt(
        user_request,
        schema_text=get_db_schema_text(db.bind),
        sample_rows_text=get_sample_rows_text(db),
        base_config=get_widget_base_config(db, screen_id, widget_id),
        prior_logic=get_widget_prior_logic(db, screen_id, widget_id),
    )
    return await call_llm(prompt)
