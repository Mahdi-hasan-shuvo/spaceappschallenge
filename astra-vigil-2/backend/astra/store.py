"""SQLite store: hash-chained audit log, consent records, outbox.

One file on the device. Nothing here needs a network.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

GENESIS = "0" * 64

SCHEMA = """
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consent (
  crew_id TEXT NOT NULL, role TEXT NOT NULL, granted INTEGER NOT NULL, ts REAL NOT NULL,
  PRIMARY KEY (crew_id, role));
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id TEXT NOT NULL, status TEXT NOT NULL, day INTEGER NOT NULL,
  rule TEXT, queued_at REAL NOT NULL, deliver_at REAL NOT NULL, delay_min REAL NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0);
"""

# Only these fields may ever leave for Earth (allow-list).
OUTBOX_FIELDS = ("id", "crew_id", "status", "day", "rule", "queued_at",
                 "deliver_at", "delay_min", "delivered")


def _digest(prev: str, ts: float, actor: str, action: str, detail: str) -> str:
    blob = json.dumps([prev, round(ts, 6), actor, action, detail], separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class Store:
    def __init__(self, path: str | Path = ":memory:"):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()

    # ---------------------------------------------------------------- audit
    def log(self, actor: str, action: str, detail: Optional[dict] = None) -> dict:
        with self._lock:
            row = self._db.execute("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").fetchone()
            prev = row["hash"] if row else GENESIS
            ts = time.time()
            d = json.dumps(detail or {}, sort_keys=True, separators=(",", ":"))
            h = _digest(prev, ts, actor, action, d)
            cur = self._db.execute(
                "INSERT INTO audit(ts,actor,action,detail,prev_hash,hash) VALUES (?,?,?,?,?,?)",
                (ts, actor, action, d, prev, h))
            self._db.commit()
            return {"id": cur.lastrowid, "ts": ts, "actor": actor, "action": action,
                    "detail": detail or {}, "prev_hash": prev, "hash": h}

    def audit_tail(self, n: int = 40) -> List[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (n,)).fetchall()
        out = [dict(r) | {"detail": json.loads(r["detail"])} for r in rows]
        return list(reversed(out))

    def verify_chain(self) -> dict:
        """Recompute every hash. Any edited, removed or reordered row breaks the chain."""
        with self._lock:
            rows = self._db.execute("SELECT * FROM audit ORDER BY id").fetchall()
        prev = GENESIS
        for r in rows:
            if r["prev_hash"] != prev or _digest(prev, r["ts"], r["actor"], r["action"],
                                                 r["detail"]) != r["hash"]:
                return {"ok": False, "entries": len(rows), "broken_at": r["id"]}
            prev = r["hash"]
        return {"ok": True, "entries": len(rows), "broken_at": None, "head": prev}

    # -------------------------------------------------------------- consent
    def set_consent(self, crew_id: str, role: str, granted: bool) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO consent(crew_id,role,granted,ts) VALUES (?,?,?,?) "
                "ON CONFLICT(crew_id,role) DO UPDATE SET granted=excluded.granted, ts=excluded.ts",
                (crew_id, role, int(granted), time.time()))
            self._db.commit()

    def has_consent(self, crew_id: str, role: str) -> bool:
        with self._lock:
            r = self._db.execute("SELECT granted FROM consent WHERE crew_id=? AND role=?",
                                 (crew_id, role)).fetchone()
        return bool(r and r["granted"])

    def consents(self) -> Dict[str, Dict[str, bool]]:
        with self._lock:
            rows = self._db.execute("SELECT crew_id, role, granted FROM consent").fetchall()
        out: Dict[str, Dict[str, bool]] = {}
        for r in rows:
            out.setdefault(r["crew_id"], {})[r["role"]] = bool(r["granted"])
        return out

    # --------------------------------------------------------------- outbox
    def enqueue(self, crew_id: str, status: str, day: int, rule: Optional[str],
                delay_min: float, seconds_per_min: float) -> dict:
        now = time.time()
        deliver = now + delay_min * seconds_per_min
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO outbox(crew_id,status,day,rule,queued_at,deliver_at,delay_min) "
                "VALUES (?,?,?,?,?,?,?)", (crew_id, status, day, rule, now, deliver, delay_min))
            self._db.commit()
            return {"id": cur.lastrowid, "deliver_at": deliver}

    def deliver_due(self, now: Optional[float] = None) -> List[dict]:
        now = time.time() if now is None else now
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM outbox WHERE delivered=0 AND deliver_at<=?", (now,)).fetchall()
            for r in rows:
                self._db.execute("UPDATE outbox SET delivered=1 WHERE id=?", (r["id"],))
            self._db.commit()
        return [{k: r[k] for k in OUTBOX_FIELDS} | {"delivered": 1} for r in rows]

    def outbox(self, limit: int = 60) -> List[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM outbox ORDER BY id DESC LIMIT ?",
                                    (limit,)).fetchall()
        return [{k: r[k] for k in OUTBOX_FIELDS} for r in reversed(rows)]

    def clear_outbox(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM outbox")
            self._db.commit()
