"""Tests for logiclive/ai.py — focus on [C018] prompt assembly.

Live Ollama calls are NOT exercised here. The prompt-assembly helpers are
pure functions; the call_ollama / stream_ollama wrappers are mocked in
Step 20's endpoint tests.
"""
from __future__ import annotations

import os
import tempfile

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from logiclive.ai import (
    build_prompt,
    get_db_schema_text,
    get_sample_rows_text,
    get_widget_base_config,
    get_widget_prior_logic,
)
from logiclive.db import Base, Widget, make_engine


@pytest.fixture
def db_session():
    """Temp SQLite DB with a fake `orders` table + 1 widget."""
    fd, path = tempfile.mkstemp(suffix=".test_ai.db")
    os.close(fd)
    engine = make_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)

    # Simulated user table
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, "
            "product TEXT, qty INTEGER, revenue REAL)"
        ))
        conn.execute(text(
            "INSERT INTO orders (product, qty, revenue) VALUES "
            "('Coke 500ml', 100, 5000.0), "
            "('Sprite 500ml', 50, 2500.0)"
        ))
        conn.commit()

    Session = sessionmaker(bind=engine, autoflush=False)
    with Session() as s:
        s.add(Widget(
            screen_id="t",
            widget_id="table.sales",
            base_config={
                "type": "table",
                "props": {"columns": ["product", "qty", "revenue"]},
            },
            logic_code=(
                "def render(params):\n"
                "    return {'data': [], 'props': {'footer': 'placeholder'}}\n"
            ),
        ))
        s.commit()

    s = Session()
    yield s
    s.close()
    engine.dispose()
    if os.path.exists(path):
        os.remove(path)


# ─── helper assertions ──────────────────────────────────────────

def test_get_db_schema_text_includes_widgets_table(db_session):
    schema = get_db_schema_text(db_session.bind)
    assert "widgets" in schema
    assert "screen_id" in schema
    assert "logic_code" in schema


def test_get_db_schema_text_includes_user_tables(db_session):
    schema = get_db_schema_text(db_session.bind)
    assert "orders" in schema
    assert "product" in schema
    assert "revenue" in schema


def test_get_sample_rows_skips_widgets_table(db_session):
    samples = get_sample_rows_text(db_session)
    # `widgets` is filtered out — sample text should not include the
    # marker comment we generate for included tables
    assert "-- widgets (" not in samples


def test_get_sample_rows_includes_user_data(db_session):
    samples = get_sample_rows_text(db_session)
    assert "orders" in samples
    assert "Coke" in samples
    assert "Sprite" in samples


def test_get_widget_base_config_returns_dict(db_session):
    cfg = get_widget_base_config(db_session, "t", "table.sales")
    assert cfg["type"] == "table"
    assert cfg["props"]["columns"] == ["product", "qty", "revenue"]


def test_get_widget_base_config_missing_returns_empty(db_session):
    cfg = get_widget_base_config(db_session, "t", "ghost")
    assert cfg == {}


def test_get_widget_prior_logic_returns_code(db_session):
    code = get_widget_prior_logic(db_session, "t", "table.sales")
    assert "def render" in code


def test_get_widget_prior_logic_missing_returns_none(db_session):
    code = get_widget_prior_logic(db_session, "t", "ghost")
    assert code is None


# ─── [C018] proof — prompt must contain all 5 ingredients ─────

def test_build_prompt_contains_all_C018_ingredients(db_session):
    prompt = build_prompt(
        "fetch sales since 2026-01-01 grouped by product",
        schema_text=get_db_schema_text(db_session.bind),
        sample_rows_text=get_sample_rows_text(db_session),
        base_config=get_widget_base_config(db_session, "t", "table.sales"),
        prior_logic=get_widget_prior_logic(db_session, "t", "table.sales"),
    )
    # 1. DB schema
    assert "=== DB SCHEMA ===" in prompt
    assert "orders" in prompt  # via schema
    # 2. Sample rows
    assert "=== SAMPLE ROWS ===" in prompt
    assert "Coke" in prompt
    # 3. base_config
    assert "=== WIDGET base_config ===" in prompt
    assert '"type": "table"' in prompt
    # 4. Prior logic_code
    assert "=== PRIOR logic_code ===" in prompt
    assert "def render" in prompt
    # 5. /render response schema
    assert "=== /render response schema ===" in prompt
    assert "props" in prompt
    assert "children" in prompt
    # User request threaded in
    assert "fetch sales since 2026-01-01" in prompt


def test_build_prompt_handles_no_prior_logic():
    prompt = build_prompt(
        "create something fresh",
        schema_text="x",
        sample_rows_text="y",
        base_config={"type": "text"},
        prior_logic=None,
    )
    assert "(none" in prompt  # placeholder for missing prior logic


def test_build_prompt_C019_explicit_return_instruction():
    """The system prompt MUST tell the model to end with `return`."""
    prompt = build_prompt(
        "anything",
        schema_text="x",
        sample_rows_text="y",
        base_config={"type": "text"},
        prior_logic=None,
    )
    # Either the literal phrase or the surrounding instructions
    assert "return" in prompt
    assert "render(params)" in prompt


def test_build_prompt_forbids_markdown_fences():
    """The model should NOT wrap output in ```python fences — system prompt
    must make that explicit so /ai/generate doesn't need to strip them."""
    prompt = build_prompt(
        "x", schema_text="x", sample_rows_text="x",
        base_config={}, prior_logic=None,
    )
    assert "markdown" in prompt.lower() or "fence" in prompt.lower()
