"""Tests for fail-closed state.db NOTADB handling and journal-mode EIO retries.

Covers:

* IOERR on BEGIN IMMEDIATE (callback has not run) may retry once on the
  same connection — no close(), no replay of a started write (#99502);
* IOERR after the callback mutates must NOT rerun the callback;
* genuine on-disk NOTADB / replaced file still fail-closed (#89332);
* transient ``disk i/o error`` retry in ``_on_disk_journal_mode``.
"""

import sqlite3
from unittest.mock import MagicMock

import pytest

from hermes_state import SessionDB, _on_disk_journal_mode


class _BeginIoerrOnce:
    """Fail the first BEGIN IMMEDIATE, then proxy to the real connection."""

    def __init__(self, real_conn):
        self._real = real_conn
        self.begins = 0

    def execute(self, sql, *args, **kwargs):
        if str(sql).strip().upper().startswith("BEGIN") and self.begins == 0:
            self.begins += 1
            raise sqlite3.OperationalError("disk I/O error")
        return self._real.execute(sql, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


class TestWriteIoerrSettlement:
    def test_begin_ioerr_retries_once_without_reopen(self, tmp_path, monkeypatch):
        monkeypatch.setattr(SessionDB, "_WRITE_PATIENCE_S", 2.0)
        monkeypatch.setattr(SessionDB, "_WRITE_RETRY_MIN_S", 0.001)
        monkeypatch.setattr(SessionDB, "_WRITE_RETRY_MAX_S", 0.005)
        db = SessionDB(db_path=tmp_path / "state.db")
        original = db._conn
        connects = {"n": 0}
        import hermes_state as hs

        real_connect = hs._connect_tracked_db

        def counting_connect(*args, **kwargs):
            connects["n"] += 1
            return real_connect(*args, **kwargs)

        monkeypatch.setattr("hermes_state._connect_tracked_db", counting_connect)
        try:
            db._conn = _BeginIoerrOnce(original)  # type: ignore[assignment]
            calls = {"n": 0}

            def write(conn):
                calls["n"] += 1
                conn.execute(
                    "INSERT INTO state_meta (key, value) VALUES ('eio', 'ok') "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
                )
                return "done"

            assert db._execute_write(write) == "done"
            assert calls["n"] == 1
            assert connects["n"] == 0
            assert db.get_meta("eio") == "ok"
        finally:
            db._conn = original
            db.close()

    def test_ioerr_after_mutation_does_not_replay(self, tmp_path):
        db = SessionDB(db_path=tmp_path / "state.db")
        try:
            calls = {"n": 0}

            def boom(conn):
                calls["n"] += 1
                conn.execute(
                    "INSERT INTO state_meta (key, value) VALUES ('once', '1') "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
                )
                raise sqlite3.OperationalError("disk I/O error")

            with pytest.raises(sqlite3.OperationalError, match="disk I/O"):
                db._execute_write(boom)
            assert calls["n"] == 1
            assert db.get_meta("once") is None
        finally:
            db.close()

    def test_notadb_does_not_reopen(self, tmp_path, monkeypatch):
        db = SessionDB(db_path=tmp_path / "state.db")
        real = db._conn
        try:
            db.create_session(session_id="s1", source="cli", model="test")

            class Boom:
                def execute(self, *args, **kwargs):
                    raise sqlite3.DatabaseError("file is not a database")

                def __getattr__(self, name):
                    return getattr(real, name)

            db._conn = Boom()  # type: ignore[assignment]
            reopen = MagicMock()
            monkeypatch.setattr("hermes_state._connect_tracked_db", reopen)
            with pytest.raises(sqlite3.DatabaseError, match="not a database"):
                db._execute_write(lambda conn: conn.execute("SELECT 1"))
            reopen.assert_not_called()
        finally:
            db._conn = real
            db.close()


class TestOnDiskJournalModeEioRetry:
    def _conn_raising_then(self, failures, result_rows):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.return_value = result_rows
        conn.execute.side_effect = list(failures) + [cursor]
        return conn

    def test_transient_eio_clears_on_retry(self):
        conn = self._conn_raising_then(
            [sqlite3.OperationalError("disk i/o error")] * 2, ("wal",)
        )
        assert _on_disk_journal_mode(conn) == "wal"

    def test_persistent_eio_returns_none(self):
        conn = MagicMock()
        conn.execute.side_effect = sqlite3.OperationalError("disk i/o error")
        assert _on_disk_journal_mode(conn) is None
        # Bounded: retried a handful of times, not forever.
        assert conn.execute.call_count == 4

    def test_non_eio_operational_error_fails_fast(self):
        conn = MagicMock()
        conn.execute.side_effect = sqlite3.OperationalError("database is locked")
        assert _on_disk_journal_mode(conn) is None
        assert conn.execute.call_count == 1
