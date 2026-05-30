"""Tests for logiclive/db.py.

Verifies:
  - [C014] widgets schema uses canonical SDUI field names
  - init_db is idempotent and creates the expected table
  - Composite PK is (screen_id, widget_id)
  - Insert + fetch round-trip works
"""
from __future__ import annotations

import os
import tempfile

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

from logiclive.db import Base, Widget, init_db, make_engine


@pytest.fixture
def tmp_engine():
    """A fresh SQLite engine on a temp file, cleaned up after the test."""
    fd, path = tempfile.mkstemp(suffix=".logiclive.db")
    os.close(fd)
    engine = make_engine(f"sqlite:///{path}")
    yield engine
    engine.dispose()
    if os.path.exists(path):
        os.remove(path)


def test_init_creates_widgets_table(tmp_engine):
    init_db(tmp_engine)
    tables = inspect(tmp_engine).get_table_names()
    assert "widgets" in tables, f"expected 'widgets' table, got: {tables}"


def test_init_is_idempotent(tmp_engine):
    init_db(tmp_engine)
    init_db(tmp_engine)  # should not raise
    assert "widgets" in inspect(tmp_engine).get_table_names()


def test_widgets_schema_matches_C014(tmp_engine):
    """[C014] canonical SDUI column names must all be present."""
    init_db(tmp_engine)
    cols = {c["name"] for c in inspect(tmp_engine).get_columns("widgets")}
    required = {"screen_id", "widget_id", "base_config", "logic_code", "updated_at"}
    assert required <= cols, f"missing columns: {required - cols}"


def test_widgets_primary_key_is_screen_id_and_widget_id(tmp_engine):
    init_db(tmp_engine)
    pk = inspect(tmp_engine).get_pk_constraint("widgets")
    assert set(pk["constrained_columns"]) == {"screen_id", "widget_id"}


def test_insert_and_fetch_widget(tmp_engine):
    init_db(tmp_engine)
    Session = sessionmaker(bind=tmp_engine, autoflush=False)
    with Session() as s:
        s.add(
            Widget(
                screen_id="test_screen",
                widget_id="test_widget",
                base_config={"type": "text"},
                logic_code="def render(params): return {'type': 'text', 'children': 'hi'}",
            )
        )
        s.commit()
    with Session() as s:
        fetched = s.get(Widget, ("test_screen", "test_widget"))
        assert fetched is not None
        assert fetched.base_config == {"type": "text"}
        assert fetched.updated_at is not None
