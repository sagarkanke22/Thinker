"""LangChain/LangGraph ReAct agent for /plan discovery chat.

Uses langgraph.prebuilt.create_react_agent (LangChain 1.x API) with
Anthropic Claude's native tool-calling. Replaces the two-specialist
(@backend / @frontend) pattern with a single verified-plan agent.
"""
from __future__ import annotations

import json
import os
import re
from typing import AsyncIterator

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from logiclive.agents import WIDGET_REGISTRY, _AGENT_DISCIPLINE
from logiclive.ai import get_db_schema_text
from logiclive.db import engine as _db_engine
from sqlalchemy import text


# ── DB helpers ────────────────────────────────────────────────────────

def _exec_sql(sql: str, fetch: int = 10):
    """Execute SQL via SQLAlchemy engine; return (column_names, rows_as_dicts)."""
    with _db_engine.connect() as conn:
        result = conn.execute(text(sql))
        cols = list(result.keys())
        rows = [dict(zip(cols, row)) for row in result.fetchmany(fetch)]
    return cols, rows


_FORBIDDEN = (
    "INSERT", "UPDATE", "DELETE", "DROP",
    "ALTER", "CREATE", "REPLACE", "TRUNCATE",
)


def _guard_read_only(sql: str):
    """Return error string if SQL is not a plain SELECT, else None."""
    upper = sql.strip().upper()
    if not upper.startswith("SELECT"):
        return "Only SELECT statements are allowed."
    for kw in _FORBIDDEN:
        if re.search(rf"\b{kw}\b", upper):
            return f"{kw} statements are not allowed. Only SELECT is permitted."
    return None


# ── Tools ─────────────────────────────────────────────────────────────

@tool
def get_db_schema() -> str:
    """Return all table names and column definitions from the database.

    Call this FIRST when the user asks about data availability.

    CORRECT:  get_db_schema()                    — no arguments
    WRONG:    get_db_schema(table="orders")       — takes no input
    """
    return get_db_schema_text()


@tool
def count_table_rows(table_name: str) -> str:
    """Count rows in a table. Use to confirm data exists before planning.

    CORRECT:  count_table_rows("orders")
    WRONG:    count_table_rows("SELECT COUNT(*) FROM orders")
              — pass the table NAME only, not SQL
    WRONG:    count_table_rows("orders; DROP TABLE orders")
              — only alphanumeric identifiers accepted
    """
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
        return f"Error: invalid table name '{table_name}'. Use letters/digits/underscores only."
    try:
        _, rows = _exec_sql(f"SELECT COUNT(*) AS n FROM {table_name}", fetch=1)
        return str(rows[0]["n"] if rows else 0)
    except Exception as exc:
        return f"Error: {exc}"


@tool
def run_safe_sql(sql: str) -> str:
    """Run a read-only SELECT and return up to 10 rows as a JSON string.

    CORRECT:  run_safe_sql("SELECT product, SUM(amount) AS revenue FROM orders GROUP BY product LIMIT 5")
    WRONG:    run_safe_sql("INSERT INTO orders VALUES (...)")  — only SELECT allowed
    WRONG:    run_safe_sql("DROP TABLE orders")               — destructive statements blocked
    """
    err = _guard_read_only(sql)
    if err:
        return f"Error: {err}"
    try:
        _, rows = _exec_sql(sql)
        return json.dumps(rows, default=str)
    except Exception as exc:
        return f"Error: {exc}"


@tool
def get_widget_caps(widget_name: str) -> str:
    """Return CAN / CANNOT / WIRING capabilities for a widget type.

    CORRECT:  get_widget_caps("chart")
    CORRECT:  get_widget_caps("table")
    WRONG:    get_widget_caps("bar chart widget")  — one word type name only
    WRONG:    get_widget_caps("")                  — name must not be empty

    Available types: text, input, button, chart, table, select, metric
    """
    name = widget_name.strip().lower()
    if not name:
        return "Error: widget_name must not be empty."
    match = re.search(rf"widget:\s*{re.escape(name)}\b", WIDGET_REGISTRY, re.IGNORECASE)
    if not match:
        return (
            f"Widget '{widget_name}' not found. "
            "Available types: text, input, button, chart, table, select, metric"
        )
    start = match.start()
    nxt = re.search(r"\nwidget:", WIDGET_REGISTRY[start + 1:])
    end = start + 1 + nxt.start() if nxt else len(WIDGET_REGISTRY)
    return WIDGET_REGISTRY[start:end].strip()


@tool
def validate_sql_and_shape(sql: str) -> str:
    """Run a SELECT and return column names + 2 sample rows + row count.

    Use this to verify SQL output shape matches what a widget expects
    BEFORE writing the final plan.

    CORRECT:  validate_sql_and_shape("SELECT product, SUM(amount) AS amount FROM orders GROUP BY product")
    WRONG:    validate_sql_and_shape("INSERT INTO orders ...")  — only SELECT allowed

    Returns JSON: {"columns": [...], "sample": [...], "total_rows": N, "error": null}
    """
    err = _guard_read_only(sql)
    if err:
        return json.dumps({"columns": [], "sample": [], "total_rows": 0, "error": err})
    try:
        cols, rows = _exec_sql(sql, fetch=100)
        return json.dumps(
            {"columns": cols, "sample": rows[:2], "total_rows": len(rows), "error": None},
            default=str,
        )
    except Exception as exc:
        return json.dumps({"columns": [], "sample": [], "total_rows": 0, "error": str(exc)})


# ── Agent ─────────────────────────────────────────────────────────────

_TOOLS = [
    get_db_schema,
    count_table_rows,
    run_safe_sql,
    get_widget_caps,
    validate_sql_and_shape,
]


def _build_llm() -> ChatAnthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env before using the ReAct agent."
        )
    return ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key,
        temperature=0,
        max_tokens=4096,
    )


def _system_prompt() -> str:
    return f"{_AGENT_DISCIPLINE}\n\n{WIDGET_REGISTRY}"


# ── History formatter ─────────────────────────────────────────────────

def _build_messages(user_prompt: str, history: list) -> list:
    """Build LangChain message list from history + current prompt."""
    msgs: list = [SystemMessage(content=_system_prompt())]
    for turn in history[-10:]:
        role = str(turn.get("role", "user")).lower()
        content = str(turn.get("content", ""))[:1500]
        if role == "assistant":
            msgs.append(AIMessage(content=content))
        else:
            msgs.append(HumanMessage(content=content))
    msgs.append(HumanMessage(content=user_prompt))
    return msgs


# ── Public streaming interface ────────────────────────────────────────

async def stream_react_agent(
    user_prompt: str,
    history: list,
    db,
) -> AsyncIterator[dict]:
    """Async generator — yields typed dicts for each reasoning step.

    Yields:
        {"type": "thought",     "text": str}       reasoning before a tool call
        {"type": "action",      "tool": str,
                                "input": str}       tool being called
        {"type": "observation", "text": str}        tool result
        {"type": "token",       "text": str}        final answer word-by-word
        {"type": "done"}
    """
    llm = _build_llm()
    graph = create_react_agent(llm, tools=_TOOLS)
    messages = _build_messages(user_prompt, history)

    async for chunk in graph.astream(
        {"messages": messages},
        stream_mode="updates",
    ):
        for _node, update in chunk.items():
            for msg in update.get("messages", []):
                if isinstance(msg, AIMessage):
                    # Extract text content (may be str or list of blocks)
                    content = msg.content
                    text_content = ""
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                text_content += block.get("text", "")
                    elif isinstance(content, str):
                        text_content = content

                    if msg.tool_calls:
                        # Intermediate step: text is reasoning, calls are actions
                        if text_content.strip():
                            yield {"type": "thought", "text": text_content.strip()}
                        for tc in msg.tool_calls:
                            yield {
                                "type": "action",
                                "tool": tc["name"],
                                "input": json.dumps(tc.get("args", {}), default=str),
                            }
                    else:
                        # Final answer — stream word by word
                        words = text_content.split(" ")
                        for i, word in enumerate(words):
                            suffix = " " if i < len(words) - 1 else ""
                            yield {"type": "token", "text": word + suffix}
                        yield {"type": "done"}
                        return

                elif isinstance(msg, ToolMessage):
                    yield {"type": "observation", "text": str(msg.content)[:800]}
