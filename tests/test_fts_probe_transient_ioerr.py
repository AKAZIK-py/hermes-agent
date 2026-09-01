"""FTS capability probe must not 500 a session list on transient I/O.

GET /api/sessions opens a short-lived read-only SessionDB. Its constructor
probes ``messages_fts`` with ``SELECT * FROM … LIMIT 0``. A concurrent writer
can make that probe raise SQLITE_IOERR. Re-raising used to:

1. 500 the whole list (sidebar empty);
2. ``close()`` the probe connection in the same process as the live writer,
   which cancels POSIX locks and can truncate ``state.db-wal`` to 0 bytes.

Listing sessions does not need FTS. Transient probe errors degrade search
for that open and leave the connection up.
"""

from __future__ import annotations

import sqlite3
from typing import Any

import pytest

from hermes_state import SessionDB


class _RaisingCursor:
    def __init__(self, exc: BaseException):
        self.exc = exc

    def execute(self, _sql: str) -> Any:
        raise self.exc


def _probe_host() -> SessionDB:
    return SessionDB.__new__(SessionDB)


class TestFtsTableProbeTransient:
    def test_disk_io_degrades_instead_of_raising(self):
        host = _probe_host()
        assert (
            host._fts_table_probe(
                _RaisingCursor(sqlite3.OperationalError("disk I/O error")),  # type: ignore[arg-type]
                "messages_fts",
            )
            is None
        )

    def test_locked_degrades_instead_of_raising(self):
        host = _probe_host()
        assert (
            host._fts_table_probe(
                _RaisingCursor(sqlite3.OperationalError("database is locked")),  # type: ignore[arg-type]
                "messages_fts",
            )
            is None
        )

    def test_malformed_vtable_still_raises(self):
        host = _probe_host()
        with pytest.raises(sqlite3.OperationalError, match="malformed"):
            host._fts_table_probe(
                _RaisingCursor(
                    sqlite3.OperationalError(
                        "malformed database schema (messages_fts) - table messages_fts already exists"
                    )
                ),  # type: ignore[arg-type]
                "messages_fts",
            )

    def test_readonly_open_survives_fts_probe_ioerr(self, tmp_path, monkeypatch):
        db_path = tmp_path / "state.db"
        writable = SessionDB(db_path=db_path)
        writable.create_session("probe-ioerr", source="cli")
        writable.append_message("probe-ioerr", role="user", content="keep me")
        writable.close()

        real = SessionDB._fts_table_probe

        def ioerr_probe(self, cursor, table_name):
            return real(
                self,
                _RaisingCursor(sqlite3.OperationalError("disk I/O error")),  # type: ignore[arg-type]
                table_name,
            )

        monkeypatch.setattr(SessionDB, "_fts_table_probe", ioerr_probe)

        read_only = SessionDB(db_path=db_path, read_only=True)
        try:
            assert read_only._conn is not None
            rows = read_only.list_sessions_rich(limit=10, compact_rows=True)
            assert any(row["id"] == "probe-ioerr" for row in rows)
        finally:
            read_only.close()

    def test_stale_fts_recovery_drops_trigram_when_probe_returns_none(self, monkeypatch):
        host = SessionDB.__new__(SessionDB)
        sqls: list[str] = []

        class FakeCursor:
            def executescript(self, sql):
                sqls.append(sql)

        monkeypatch.setattr(SessionDB, "_fts_table_probe", lambda self, cursor, table_name: None)
        host._conn = type("C", (), {"rollback": lambda self: None, "commit": lambda self: None})()
        assert host._recover_stale_fts_locked(FakeCursor(), legacy=False) is True
        assert any("DROP TABLE IF EXISTS messages_fts_trigram" in sql for sql in sqls)
