"""Astra Vigil 2.0 - deterministic detection (the "science boundary").

No language model touches this file. Every alert carries the rule that fired
and the exact numbers behind it. Nothing here interprets or diagnoses.

Each row of input is ONE tick. In the main console a tick is one mission-day
summary and the demo replays one row per second, so 600 rows = 600 mission days
compressed into 10 minutes. The same rules also run on a 1 Hz stream with
`Config.per_second()` (windows then count samples, not days).

A row may carry any subset of SIGNALS; signals that are absent are skipped.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional
import numpy as np

# direction = which way a deviation counts as "worse"; min_sd guards against
# a near-zero-variance baseline producing absurd z-scores. All tunable.
SIGNALS: Dict[str, dict] = {
    "hr":           {"label": "Resting heart rate", "unit": "bpm",  "direction": "high", "min_sd": 1.0},
    "hrv":          {"label": "HRV (RMSSD)",        "unit": "ms",   "direction": "low",  "min_sd": 2.0},
    "spo2":         {"label": "SpO2",               "unit": "%",    "direction": "low",  "min_sd": 0.3},
    "sleep_h":      {"label": "Sleep duration",     "unit": "h",    "direction": "low",  "min_sd": 0.25},
    "core_temp":    {"label": "Core temperature",   "unit": "degC", "direction": "high", "min_sd": 0.05},
    "exercise_min": {"label": "Exercise",           "unit": "min",  "direction": "low",  "min_sd": 5.0},
}


@dataclass
class Config:
    baseline_days: int = 30      # rolling personal baseline length
    min_baseline: int = 14       # need at least this many baseline days
    single_threshold_sd: float = 2.0
    single_persist: int = 2      # consecutive days beyond threshold
    multi_threshold_sd: float = 2.5
    multi_window: int = 2        # rows (= 48 h when one row per day)
    multi_min_signals: int = 2
    unit: str = "day"            # what one row is: "day" (console) or "second" (1 Hz rehearsal)

    @classmethod
    def per_second(cls) -> "Config":
        """Same two rules for a 1 Hz stream. Windows count samples. A longer baseline and
        a 3-sample persistence keep the slow breathing/circadian swing in the simulated
        stream from looking like an event."""
        return cls(baseline_days=90, min_baseline=45, single_threshold_sd=2.5, single_persist=3,
                   multi_threshold_sd=3.0, multi_window=5, multi_min_signals=2, unit="second")


@dataclass
class Alert:
    rule: str
    day: int
    signals: List[str]
    details: List[dict] = field(default_factory=list)  # per-signal numbers

    def to_dict(self) -> dict:
        return asdict(self)


def zscore(history: List[float], excluded: List[bool], current: float,
           signal: str, cfg: Config) -> Optional[dict]:
    """Personal-baseline z-score. Baseline = last `baseline_days` NON-excluded
    values. Only days that belong to a CONFIRMED episode are excluded, so a long
    event cannot quietly become the new normal, while one-off blips stay in the
    baseline (excluding every blip truncates the baseline and inflates false
    alarms - measured, see the validation section). None if baseline too short."""
    clean = [v for v, ex in zip(history, excluded) if not ex][-cfg.baseline_days:]
    if len(clean) < cfg.min_baseline:
        return None
    base = np.asarray(clean, dtype=float)
    mu = float(base.mean())
    sd = max(float(base.std(ddof=1)), SIGNALS[signal]["min_sd"])
    z = (current - mu) / sd
    return {"current": float(current), "baseline_mean": mu, "baseline_sd": sd,
            "z": float(z), "baseline_n": len(clean)}


def _worse(z: float, direction: str) -> float:
    """Signed deviation in the 'worse' direction (positive = worse)."""
    return z if direction == "high" else -z


class StreamDetector:
    def __init__(self, cfg: Optional[Config] = None):
        self.cfg = cfg or Config()
        self.hist: Dict[str, List[float]] = {s: [] for s in SIGNALS}
        self.excl: Dict[str, List[bool]] = {s: [] for s in SIGNALS}
        self.streak: Dict[str, int] = {s: 0 for s in SIGNALS}
        self.recent: List[Dict[str, dict]] = []   # per-day multi-threshold hits
        self.multi_active = False
        self.day = -1

    def update(self, row: Dict[str, float]) -> List[Alert]:
        self.day += 1
        c = self.cfg
        alerts: List[Alert] = []
        multi_hits: Dict[str, dict] = {}

        for s, meta in SIGNALS.items():
            if s not in row:          # this stream does not carry the signal
                continue
            z = zscore(self.hist[s], self.excl[s], row[s], s, c)
            deviating = False
            confirmed = False
            if z is not None:
                worse = _worse(z["z"], meta["direction"])
                z["worse_sd"] = float(worse)
                deviating = worse >= c.single_threshold_sd
                if worse >= c.multi_threshold_sd:
                    multi_hits[s] = z
                self.streak[s] = self.streak[s] + 1 if deviating else 0
                confirmed = deviating and self.streak[s] >= c.single_persist
                if deviating and self.streak[s] == c.single_persist:
                    alerts.append(Alert(
                        rule=f"{s}_{'above' if meta['direction']=='high' else 'below'}_personal_baseline",
                        day=self.day, signals=[s],
                        details=[{"signal": s, **z,
                                  "threshold_sd": c.single_threshold_sd,
                                  "window_days": c.baseline_days,
                                  "window_rows": c.baseline_days, "row_unit": c.unit,
                                  "consecutive_days": self.streak[s]}]))
            else:
                self.streak[s] = 0
            self.hist[s].append(float(row[s]))
            self.excl[s].append(confirmed)
            if confirmed and self.streak[s] == c.single_persist:
                # episode just confirmed: also keep its earlier days out of the baseline
                for k in range(2, c.single_persist + 1):
                    if len(self.excl[s]) >= k:
                        self.excl[s][-k] = True

        # multi-signal rule over the last `multi_window` rows (incl. today)
        self.recent.append(multi_hits)
        self.recent = self.recent[-c.multi_window:]
        merged: Dict[str, dict] = {}
        for day_hits in self.recent:
            for s, z in day_hits.items():
                merged[s] = z          # latest numbers per signal
        active = len(merged) >= c.multi_min_signals
        if active and not self.multi_active:
            alerts.append(Alert(
                rule="multi_signal_deviation", day=self.day,
                signals=sorted(merged),
                details=[{"signal": s, **z, "threshold_sd": c.multi_threshold_sd,
                          "window_days": c.baseline_days, "window_rows": c.baseline_days,
                          "row_unit": c.unit} for s, z in sorted(merged.items())]))
        self.multi_active = active
        return alerts


def run(rows: List[Dict[str, float]], cfg: Optional[Config] = None) -> List[Alert]:
    det = StreamDetector(cfg)
    out: List[Alert] = []
    for r in rows:
        out.extend(det.update(r))
    return out


def hrv_deviation(series, baseline_days=30, threshold_sd=2.0):
    """Stateless one-shot rule (same shape as the challenge brief's example)
    but the baseline EXCLUDES the current point so the point cannot hide itself."""
    arr = np.asarray(series, dtype=float)
    base = arr[-(baseline_days + 1):-1]
    mu, sd = base.mean(), base.std(ddof=1)
    cur = arr[-1]
    z = (cur - mu) / sd if sd else 0.0
    return {"rule": "hrv_below_personal_baseline", "current": float(cur),
            "baseline_mean": float(mu), "baseline_sd": float(sd), "z": float(z),
            "fired": bool(z <= -threshold_sd), "window_days": baseline_days}
