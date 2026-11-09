"""One-second rehearsal stream: replays demo_fixtures/rehearsal_1hz*.json sample by sample.

This is the demo-beat rehearsal: a true 1 Hz simulated stream (hr, hrv, spo2, core_temp) with an
anomaly planted at a KNOWN index, run through the same deterministic detector
(`compute.detect`, seconds-scale preset). No language model takes part in detection.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

from compute.detect import SIGNALS, Config, StreamDetector, zscore, _worse
from compute.schema import STREAM_FIELDS, validate_rehearsal

SIM_LABEL = "SIMULATED DATA"


class RehearsalRun:
    """Deterministic state machine: one `step()` = one second of the stream."""

    def __init__(self, fixture: dict, explain: Optional[Callable[[dict, list], dict]] = None,
                 evidence: Optional[Callable[[dict], list]] = None, cfg: Optional[Config] = None):
        self.fixture = validate_rehearsal(fixture)
        self.meta = fixture["meta"]
        self.rows: List[dict] = fixture["rows"]
        self.n = len(self.rows)
        self.cfg = cfg or Config.per_second()
        self.explain, self.evidence = explain, evidence
        self.reset()

    def reset(self, to: int = -1) -> None:
        self.index = -1
        self.det = StreamDetector(self.cfg)
        self.alerts: List[dict] = []
        self.history: List[dict] = []           # samples so far (chart backfill after a seek)
        for _ in range(max(-1, min(to, self.n - 1)) + 1):   # silent, deterministic replay
            self.step()

    def done(self) -> bool:
        return self.index >= self.n - 1

    def step(self) -> Optional[dict]:
        if self.done():
            return None
        i = self.index + 1
        row = self.rows[i]
        sample = {"index": i, "elapsed_seconds": row.get("elapsed_seconds", i), "v": {}, "mu": {}, "sd": {}, "w": {}}
        for s in STREAM_FIELDS:
            z = zscore(self.det.hist[s], self.det.excl[s], row[s], s, self.cfg)
            sample["v"][s] = row[s]
            if z is None:
                sample["mu"][s] = sample["sd"][s] = sample["w"][s] = None
            else:
                sample["mu"][s] = round(z["baseline_mean"], 4)
                sample["sd"][s] = round(z["baseline_sd"], 4)
                sample["w"][s] = round(_worse(z["z"], SIGNALS[s]["direction"]), 3)
        self.history.append(sample)
        new = [self._decorate(a) for a in self.det.update({s: row[s] for s in STREAM_FIELDS})]
        self.index = i
        self.alerts.extend(new)
        return {"type": "sample", "simulated": True, "label": SIM_LABEL, **sample, "alerts": new,
                "status": self.status(), "planted_anomaly": bool(row.get("planted_anomaly"))}

    def status(self) -> str:
        if self.index < self.cfg.min_baseline:
            return "learning"
        if any(a["day"] >= self.index - 4 for a in self.alerts):
            return "alert"
        if any(self.det.streak[s] >= 1 for s in STREAM_FIELDS):
            return "watch"
        return "normal"

    def _decorate(self, a) -> dict:
        d = a.to_dict()
        d["index"] = a.day                     # for a 1 Hz stream the tick index is the second
        d["id"] = f"rehearsal-{a.day}-{a.rule}"
        d["simulated"] = True
        d["row_unit"] = "second"
        d["evidence"] = self.evidence(d) if self.evidence else []
        ex = self.explain(d, d["evidence"]) if self.explain else {"text": "", "source": "none"}
        d.update(explanation=ex["text"], explanation_bn=ex.get("text_bn", ""),
                 explanation_source=ex["source"], citations=ex.get("cites", []),
                 explanation_blocked=ex.get("blocked", []))
        pa = self.meta.get("planted_anomaly")
        d["ground_truth"] = ({"planted": True, "onset_index": pa["onset_index"],
                              "delay_samples": a.day - pa["onset_index"]}
                             if pa and pa["onset_index"] <= a.day < pa["end_index_exclusive"] + 5
                             else {"planted": False})
        return d

    def hello(self, speed: float) -> dict:
        return {"type": "hello", "simulated": True, "label": SIM_LABEL, "n": self.n,
                "meta": self.meta, "speed": speed, "signals": {s: SIGNALS[s] for s in STREAM_FIELDS},
                "config": {k: getattr(self.cfg, k) for k in
                           ("baseline_days", "min_baseline", "single_threshold_sd", "single_persist",
                            "multi_threshold_sd", "multi_window", "multi_min_signals", "unit")}}

    def run_all(self) -> List[dict]:
        self.reset()
        while self.step():
            pass
        return self.alerts
