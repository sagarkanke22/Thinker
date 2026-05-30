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

import httpx
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from logiclive.db import Widget, engine as default_engine

load_dotenv()


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")


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


def build_prompt(
    user_request: str,
    *,
    schema_text: str,
    sample_rows_text: str,
    base_config: dict,
    prior_logic: Optional[str],
) -> str:
    """Assemble the full prompt per [C018]. All 5 ingredients must appear."""
    parts = [
        "You are LogicLive's code-gen helper. Generate a Python function "
        "named `render(params)` for a widget. The function MUST end with an "
        "explicit `return` of a dict matching the /render response schema. "
        "Output ONLY the Python function. No markdown fences, no commentary.",
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
        "=== USER REQUEST ===",
        user_request,
        "",
        "Output the Python function for render(params):",
    ]
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


async def generate_logic(
    user_request: str,
    screen_id: str,
    widget_id: str,
    db: Session,
) -> str:
    """Assemble [C018] context, call Ollama, return generated Python source."""
    prompt = build_prompt(
        user_request,
        schema_text=get_db_schema_text(db.bind),
        sample_rows_text=get_sample_rows_text(db),
        base_config=get_widget_base_config(db, screen_id, widget_id),
        prior_logic=get_widget_prior_logic(db, screen_id, widget_id),
    )
    return await call_ollama(prompt)
