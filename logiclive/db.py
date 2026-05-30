"""SQLite schema + connection helper for LogicLive.

[C014] Uses canonical SDUI field names: screen_id, widget_id, base_config,
       logic_code. Do not rename these — frontend, AI prompts, and docs
       all assume them.

[C016] Engine is created via a factory so tests can use isolated DBs.
       Each /render call will use its own subprocess for executing
       logic_code (handled in sandbox.py), so the engine itself is safe
       to share.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import Column, DateTime, JSON, String, Text, Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


def get_database_url() -> str:
    """Build the SQLite URL from the DB_PATH env var (default ./logiclive.db)."""
    return f"sqlite:///{os.getenv('DB_PATH', './logiclive.db')}"


class Base(DeclarativeBase):
    pass


class Widget(Base):
    """One row per (screen_id, widget_id).

    Fields:
      screen_id   : SDUI screen identifier (part of composite PK)
      widget_id   : SDUI widget identifier within a screen (part of composite PK)
      base_config : declarative widget shape (JSON), dev-written, version-controlled
      logic_code  : Python function string, dev-or-AI written
      updated_at  : audit timestamp, auto-maintained on update
    """

    __tablename__ = "widgets"

    screen_id = Column(String, primary_key=True, nullable=False)
    widget_id = Column(String, primary_key=True, nullable=False)
    base_config = Column(JSON, nullable=False)
    logic_code = Column(Text, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


def make_engine(url: Optional[str] = None) -> Engine:
    """Create a SQLAlchemy engine bound to the given URL (or the default)."""
    return create_engine(url or get_database_url(), echo=False, future=True)


# Default engine + session factory for production use. Tests should create
# their own engine via make_engine(...) against a tempfile.
engine: Engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(eng: Optional[Engine] = None) -> None:
    """Create tables if missing. Idempotent. Optionally bind to a specific engine."""
    Base.metadata.create_all(bind=eng or engine)
