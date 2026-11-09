"""Fixture schema checks (pure Python, no third-party validator needed).

A fixture that fails here is rejected at load time, so a malformed or non-simulated
file can never reach the detector or the console. `demo_fixtures/vitals.schema.json`
is the same contract written as JSON Schema for other tools.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List

from .detect import SIGNALS

DAILY_FIELDS = tuple(SIGNALS)                    # hr, hrv, spo2, sleep_h, core_temp, exercise_min
STREAM_FIELDS = ("hr", "hrv", "spo2", "core_temp")  # what the 1 Hz rehearsal carries

# Physiologically plausible envelopes. They catch unit mistakes, not disease.
RANGES = {"hr": (30, 220), "hrv": (1, 250), "spo2": (70, 100), "sleep_h": (0, 24),
          "core_temp": (33, 42), "exercise_min": (0, 1440)}


class FixtureError(ValueError):
    def __init__(self, problems: List[str]):
        self.problems = problems
        super().__init__("; ".join(problems[:6]) + (f" (+{len(problems) - 6} more)" if len(problems) > 6 else ""))


def _rows_problems(rows: Any, fields, where: str, expect_n: int | None) -> List[str]:
    p: List[str] = []
    if not isinstance(rows, list) or not rows:
        return [f"{where}: rows must be a non-empty list"]
    if expect_n is not None and len(rows) != expect_n:
        p.append(f"{where}: expected {expect_n} rows, found {len(rows)}")
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            p.append(f"{where}[{i}]: row is not an object")
            continue
        if r.get("index", i) != i:
            p.append(f"{where}[{i}]: index {r.get('index')} out of sequence")
        if r.get("simulated") is not True:
            p.append(f"{where}[{i}]: row is not marked simulated")
        for f in fields:
            v = r.get(f)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
                p.append(f"{where}[{i}].{f}: missing or not a finite number")
            elif not RANGES[f][0] <= v <= RANGES[f][1]:
                p.append(f"{where}[{i}].{f}: {v} outside plausible range {RANGES[f]}")
        if len(p) > 40:
            break
    return p


def _meta_problems(meta: Any) -> List[str]:
    if not isinstance(meta, dict):
        return ["meta must be an object"]
    p = []
    if meta.get("simulated") is not True:
        p.append("meta.simulated must be true: this project never ships unlabelled data")
    return p


def validate_vitals(fx: Dict[str, Any], n_rows: int | None = 600) -> Dict[str, Any]:
    """Daily crew fixture (vitals.json / vitals_clean.json). Returns fx, or raises FixtureError."""
    p = _meta_problems(fx.get("meta") if isinstance(fx, dict) else None)
    crew = fx.get("crew") if isinstance(fx, dict) else None
    if not isinstance(crew, list) or not crew:
        p.append("crew must be a non-empty list")
    else:
        seen = set()
        for c in crew:
            cid = c.get("id") if isinstance(c, dict) else None
            if not cid or cid in seen:
                p.append(f"crew id missing or duplicated: {cid!r}")
                continue
            seen.add(cid)
            p += _rows_problems(c.get("rows"), DAILY_FIELDS, f"{cid}.rows", n_rows)
            for ev in c.get("planted", []):
                rows = c.get("rows") or []
                if not ev.get("days") or max(ev["days"]) >= len(rows) or min(ev["days"]) < 0:
                    p.append(f"{cid}: planted event outside the rows: {ev}")
                if not set(ev.get("signals", [])) <= set(SIGNALS):
                    p.append(f"{cid}: planted event names an unknown signal: {ev}")
    if p:
        raise FixtureError(p)
    return fx


def validate_rehearsal(fx: Dict[str, Any], n_rows: int | None = 600) -> Dict[str, Any]:
    """One-second rehearsal stream (rehearsal_1hz*.json)."""
    meta = fx.get("meta") if isinstance(fx, dict) else None
    p = _meta_problems(meta)
    p += _rows_problems(fx.get("rows") if isinstance(fx, dict) else None, STREAM_FIELDS, "rows", n_rows)
    pa = meta.get("planted_anomaly") if isinstance(meta, dict) else None
    rows = fx.get("rows") or [] if isinstance(fx, dict) else []
    if pa:
        lo, hi = pa["onset_index"], pa["end_index_exclusive"]
        flagged = [r["index"] for r in rows if isinstance(r, dict) and r.get("planted_anomaly")]
        if flagged != list(range(lo, hi)):
            p.append("rows flagged planted_anomaly do not match meta.planted_anomaly")
    elif any(isinstance(r, dict) and r.get("planted_anomaly") for r in rows):
        p.append("rows are flagged planted_anomaly but meta.planted_anomaly is empty")
    if p:
        raise FixtureError(p)
    return fx
