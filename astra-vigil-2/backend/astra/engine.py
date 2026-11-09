"""Mission replay engine: runs the deterministic detector for every crew member.

Pure Python state machine - no web, no database, no LLM. The server drives it
(`advance`, `reset_to`) and decides who may see what (see privacy.py).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

from compute.detect import SIGNALS, Alert, Config, StreamDetector, zscore, _worse
from compute.schema import validate_rehearsal, validate_vitals

LEVELS = {"learning": 0, "normal": 1, "watch": 2, "alert": 3}
ALERT_HOLD_DAYS = 3  # an alert keeps the crew member's status at "alert" this long


@dataclass
class CrewState:
    meta: dict                      # id, callsign, title, planted (ground truth)
    rows: List[dict]
    det: StreamDetector
    records: List[dict] = field(default_factory=list)   # per-day chart records
    alerts: List[dict] = field(default_factory=list)
    status: List[str] = field(default_factory=list)     # per-day coarse status


class Mission:
    def __init__(self, crew_fixture: dict, cfg: Optional[Config] = None,
                 explain: Optional[Callable[[dict, list], dict]] = None,
                 evidence: Optional[Callable[[dict], list]] = None):
        self.cfg = cfg or Config()
        self.explain = explain
        self.evidence = evidence
        self.meta = crew_fixture["meta"]
        self._fixture = crew_fixture["crew"]
        self.n = min(len(c["rows"]) for c in self._fixture)
        self.playing = False
        self.speed = 1
        self.crew: Dict[str, CrewState] = {}
        self._build()

    # ------------------------------------------------------------------ build
    def _build(self) -> None:
        self.day = -1
        self.crew = {}
        for c in self._fixture:
            meta = {k: c[k] for k in ("id", "callsign", "title") if k in c}
            meta["planted"] = c.get("planted", [])
            self.crew[c["id"]] = CrewState(meta=meta, rows=c["rows"],
                                           det=StreamDetector(self.cfg))

    @property
    def crew_ids(self) -> List[str]:
        return list(self.crew)

    # --------------------------------------------------------------- stepping
    def advance(self, k: int = 1) -> List[dict]:
        """Advance k mission days. Returns one result dict per day."""
        out = []
        for _ in range(k):
            if self.day >= self.n - 1:
                self.playing = False
                break
            out.append(self._step())
        return out

    def reset_to(self, target_day: int) -> None:
        """Deterministic: rebuild and replay silently up to `target_day`."""
        self._build()
        target = max(-1, min(int(target_day), self.n - 1))
        for _ in range(target + 1):
            self._step()

    def _step(self) -> dict:
        self.day += 1
        d = self.day
        result = {"day": d, "rows": {}, "alerts": [], "status": {}}
        for cid, cs in self.crew.items():
            row = cs.rows[d]
            rec = {"day": d, "v": {}, "mu": {}, "sd": {}, "w": {}}
            for s, meta in SIGNALS.items():
                z = zscore(cs.det.hist[s], cs.det.excl[s], row[s], s, self.cfg)
                rec["v"][s] = row[s]
                if z is None:
                    rec["mu"][s] = rec["sd"][s] = rec["w"][s] = None
                else:
                    rec["mu"][s] = round(z["baseline_mean"], 4)
                    rec["sd"][s] = round(z["baseline_sd"], 4)
                    rec["w"][s] = round(_worse(z["z"], meta["direction"]), 3)
            new = cs.det.update(row)
            cs.records.append(rec)
            for a in new:
                cs.alerts.append(self._decorate(cid, a))
                result["alerts"].append(cs.alerts[-1])
            st = self._status_for(cs, d)
            cs.status.append(st)
            result["rows"][cid] = rec
            result["status"][cid] = st
        return result

    def _decorate(self, cid: str, a: Alert) -> dict:
        d = a.to_dict()
        d["id"] = f"{cid}-{a.day}-{a.rule}"
        d["crew_id"] = cid
        d["simulated"] = bool(self.meta.get("simulated", True))
        d["evidence"] = self.evidence(d) if self.evidence else []     # cached records first ...
        ex = self.explain(d, d["evidence"]) if self.explain else {"text": "", "source": "none"}
        d["explanation"] = ex["text"]                                  # ... then the agent explains
        d["explanation_source"] = ex["source"]
        d["explanation_bn"] = ex.get("text_bn", "")
        d["citations"] = ex.get("cites", [])
        d["explanation_blocked"] = ex.get("blocked", [])
        d["ground_truth"] = self._truth_match(cid, a)
        return d

    # ----------------------------------------------------------------- status
    def _status_for(self, cs: CrewState, d: int) -> str:
        det = cs.det
        if d < self.cfg.min_baseline:
            return "learning"
        if any(a["day"] >= d - (ALERT_HOLD_DAYS - 1) for a in cs.alerts):
            return "alert"
        if any(det.streak[s] >= 1 for s in SIGNALS):
            return "watch"
        return "normal"

    def status_now(self) -> Dict[str, str]:
        if self.day < 0:
            return {cid: "learning" for cid in self.crew}
        return {cid: cs.status[self.day] for cid, cs in self.crew.items()}

    # ------------------------------------------------------------ ground truth
    def _truth_match(self, cid: str, a: Alert) -> dict:
        """Simulation-only: does this alert correspond to a planted event?
        (In a real mission there is no such label - this exists to measure the
        detector, not to drive it.)"""
        for ev in self.crew[cid].meta.get("planted", []):
            lo, hi = min(ev["days"]), max(ev["days"]) + 1
            if lo <= a.day <= hi and set(a.signals) & set(ev["signals"]):
                return {"planted": True, "onset_day": lo, "delay_days": a.day - lo}
        return {"planted": False}

    def validation_summary(self) -> dict:
        """Live scoreboard against planted ground truth, for events already replayed."""
        planted_total = caught = 0
        delays: List[int] = []
        chance = total_alerts = 0
        for cid, cs in self.crew.items():
            for ev in cs.meta.get("planted", []):
                if min(ev["days"]) <= self.day:
                    planted_total += 1
                    hit = [a for a in cs.alerts if a["ground_truth"]["planted"]
                           and a["ground_truth"]["onset_day"] == min(ev["days"])]
                    if hit:
                        caught += 1
                        delays.append(min(h["ground_truth"]["delay_days"] for h in hit))
            total_alerts += len(cs.alerts)
            chance += sum(1 for a in cs.alerts if not a["ground_truth"]["planted"])
        planted = [{"crew_id": cid, "onset_day": min(ev["days"]), "signals": ev["signals"]}
                   for cid, cs in self.crew.items() for ev in cs.meta.get("planted", [])]
        return {"day": self.day, "planted": planted, "planted_events_so_far": planted_total,
                "caught": caught, "delay_days": delays,
                "mean_delay_days": (sum(delays) / len(delays)) if delays else None,
                "alerts_total": total_alerts, "chance_alerts": chance,
                "chance_per_1000_crew_days": (round(chance / max(1, (self.day + 1) * len(self.crew)) * 1000, 1)
                                             if self.day >= 0 else None)}

    # ------------------------------------------------------------- serializers
    def series(self, cid: str, upto: Optional[int] = None) -> dict:
        """Compact column-oriented series for charts (tier-0 data!)."""
        cs = self.crew[cid]
        recs = cs.records if upto is None else cs.records[: upto + 1]
        out = {}
        for s in SIGNALS:
            out[s] = {"v": [r["v"][s] for r in recs], "mu": [r["mu"][s] for r in recs],
                      "sd": [r["sd"][s] for r in recs], "w": [r["w"][s] for r in recs]}
        return out

    def crew_public(self) -> List[dict]:
        st = self.status_now()
        return [{"id": cid, "callsign": cs.meta["callsign"], "title": cs.meta["title"],
                 "status": st[cid], "level": LEVELS[st[cid]]} for cid, cs in self.crew.items()]

    def trend_summary(self, cid: str, window: int = 7) -> dict:
        """Tier-1 view: daily trend direction per signal. No raw values."""
        cs = self.crew[cid]
        recs = cs.records[-window:]
        out = {}
        for s, meta in SIGNALS.items():
            ws = [r["w"][s] for r in recs if r["w"][s] is not None]
            if not ws:
                out[s] = {"label": meta["label"], "trend": "learning baseline"}
                continue
            m = sum(ws) / len(ws)
            trend = ("drifting toward worse" if m >= 0.5 else
                     "drifting toward better" if m <= -0.5 else "steady")
            out[s] = {"label": meta["label"], "trend": trend}
        return {"crew_id": cid, "window_days": window,
                "status": self.status_now().get(cid, "learning"), "signals": out}


def load_fixture(path: Path) -> dict:
    """Read a daily crew fixture and reject it unless it is well-formed AND marked simulated."""
    with open(path, encoding="utf-8") as f:
        return validate_vitals(json.load(f))


def load_rehearsal(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return validate_rehearsal(json.load(f))
