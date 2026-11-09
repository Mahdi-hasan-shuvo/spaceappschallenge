import sqlite3
import time

from astra.store import Store


def test_audit_chain_verifies_and_detects_tamper(tmp_path):
    p = tmp_path / "a.db"
    s = Store(p)
    for i in range(5):
        s.log("t", "x", {"i": i})
    assert s.verify_chain()["ok"]
    db = sqlite3.connect(p)
    db.execute("UPDATE audit SET detail='{\"i\":99}' WHERE id=3")
    db.commit()
    r = Store(p).verify_chain()
    assert not r["ok"] and r["broken_at"] == 3


def test_deleted_row_breaks_chain(tmp_path):
    p = tmp_path / "b.db"
    s = Store(p)
    for i in range(4):
        s.log("t", "x", {"i": i})
    db = sqlite3.connect(p)
    db.execute("DELETE FROM audit WHERE id=2")
    db.commit()
    assert not Store(p).verify_chain()["ok"]


def test_outbox_respects_light_time_delay():
    s = Store(":memory:")
    s.enqueue("niloy", "alert", 251, "x", delay_min=0.05, seconds_per_min=1.0)  # 0.05 s
    assert s.deliver_due(time.time()) == []
    out = s.deliver_due(time.time() + 1)
    assert len(out) == 1 and out[0]["status"] == "alert"
    assert s.deliver_due(time.time() + 5) == []


def test_outbox_has_no_numeric_vitals_fields():
    s = Store(":memory:")
    s.enqueue("niloy", "watch", 10, None, 1.0, 1.0)
    assert set(s.outbox()[0]) == {"id", "crew_id", "status", "day", "rule", "queued_at",
                                  "deliver_at", "delay_min", "delivered"}


def test_consent_roundtrip():
    s = Store(":memory:")
    assert not s.has_consent("niloy", "medical")
    s.set_consent("niloy", "medical", True)
    assert s.has_consent("niloy", "medical")
    s.set_consent("niloy", "medical", False)
    assert not s.has_consent("niloy", "medical")
