"""Simulated vitals fixtures. ALWAYS labelled simulated. Seeded = reproducible.

Files written by `build_all()` (and by `tools/make_fixtures.py`) into demo_fixtures/:

  vitals.json           4 demo crew x 600 rows (one mission-day summary per row,
                        replayed at 1 row/second). Planted events at KNOWN indices; the
                        demo beat is niloy's HRV drop at index 250-251.
  vitals_clean.json     same shape, NO planted events and bounded noise -> the detector
                        must stay silent (see CLEAN_CLIP for why this is honest).
  rehearsal_1hz.json    600 true one-second samples (hr, hrv, spo2, core_temp) with an
                        anomaly planted at index 420-439.
  rehearsal_1hz_clean.json   same stream without the anomaly.

`make_rows(seed=7)` is the challenge-brief fixture: single-signal HRV event at
index 250-251 and a multi-signal event at 400-402. `make_rows_events` plants
arbitrary ground-truth events so the console can measure its own detection delay.
Everything here is SIMULATED; none of it is astronaut data.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np

from .detect import SIGNALS

N_ROWS = 600
PLANT_A = (250, 251)
PLANT_B = (400, 401, 402)
REHEARSAL_ROWS = 600
REHEARSAL_ANOMALY_INDEX = 420
REHEARSAL_ANOMALY_DURATION = 20

PARAMS = {  # mean, sd  (illustrative values, NOT real astronaut data)
    "hr": (62.0, 2.5), "hrv": (55.0, 6.0), "spo2": (97.5, 0.6),
    "sleep_h": (7.0, 0.5), "core_temp": (36.8, 0.12), "exercise_min": (120.0, 15.0),
}
PHI = 0.3  # mild day-to-day autocorrelation

# The "clean" fixture is QUIET BY CONSTRUCTION: every 15-day block is a shuffle of the same
# evenly spread set of deviations (unit SD, never beyond 1.73 SD), so no day can stand out
# against a 30-day personal baseline. Zero alerts there tests "the rules need a cause". It is
# NOT the real false-alarm rate: unbounded Gaussian noise on six signals gives ~24 chance
# alerts per 1000 crew-days (measured; backend/astra/data/validation.json).
QUIET_BLOCK = 15
CLEAN_SEED = 101

# Demo crew: the four Team MANTA names (roles are placeholders). The VITALS are invented and seeded;
# nothing here is anyone's real health data.
CREW: List[dict] = [
    {"id": "niloy", "callsign": "Niloy", "title": "Commander", "seed": 7,
     "events": [
         {"days": list(PLANT_A), "signals": ["hrv"], "sd": 3.5},
         {"days": list(PLANT_B), "signals": ["hrv", "hr", "sleep_h"], "sd": 3.5}]},
    {"id": "puja", "callsign": "Puja", "title": "Flight Engineer", "seed": 11,
     "events": [
         {"days": [180, 181], "signals": ["core_temp"], "sd": 3.5},
         {"days": [470, 471, 472], "signals": ["sleep_h", "exercise_min"], "sd": 3.5}]},
    {"id": "dhiraj", "callsign": "Dhiraj", "title": "Medical Officer", "seed": 23,
     "events": [{"days": [320, 321], "signals": ["spo2"], "sd": 3.5}]},
    {"id": "tusar", "callsign": "Tusar", "title": "Mission Scientist", "seed": 31,
     "events": []},
]


def _ar1(rng: np.random.Generator, n: int) -> np.ndarray:
    e = rng.normal(0, 1, n)
    x = np.zeros(n)
    x[0] = e[0]
    for t in range(1, n):
        x[t] = PHI * x[t - 1] + np.sqrt(1 - PHI ** 2) * e[t]  # unit marginal variance
    return x


def _quiet(rng: np.random.Generator, n: int, block: int = QUIET_BLOCK) -> np.ndarray:
    """Bounded, evenly spread, unit-SD noise: shuffled copies of one fixed set per block."""
    base = np.linspace(-1.0, 1.0, block)
    base = (base - base.mean()) / base.std(ddof=1)
    out: List[float] = []
    while len(out) < n:
        out.extend(rng.permutation(base))
    return np.asarray(out[:n])


def _noise(rng: np.random.Generator, n: int, quiet: bool) -> np.ndarray:
    return _quiet(rng, n) if quiet else _ar1(rng, n)


def make_rows(seed: int = 7, plant: bool = True, n: int = N_ROWS,
              plant_sd: float = 3.5, quiet: bool = False) -> List[Dict]:
    rng = np.random.default_rng(seed)
    cols = {s: mu + sd * _noise(rng, n, quiet) for s, (mu, sd) in PARAMS.items()}
    if plant:
        k = plant_sd
        for i in PLANT_A:
            cols["hrv"][i] = PARAMS["hrv"][0] - k * PARAMS["hrv"][1]
        for i in PLANT_B:
            cols["hrv"][i] = PARAMS["hrv"][0] - k * PARAMS["hrv"][1]
            cols["hr"][i] = PARAMS["hr"][0] + k * PARAMS["hr"][1]
            cols["sleep_h"][i] = PARAMS["sleep_h"][0] - k * PARAMS["sleep_h"][1]
    return _to_rows(cols, n)


def make_rows_events(seed: int, events: Optional[Iterable[dict]] = None,
                     n: int = N_ROWS, quiet: bool = False) -> List[Dict]:
    """Same noise model, but plant `events` = [{days, signals, sd}] in the 'worse'
    direction of each signal (exact ground truth, known only because simulated)."""
    rng = np.random.default_rng(seed)
    cols = {s: mu + sd * _noise(rng, n, quiet) for s, (mu, sd) in PARAMS.items()}
    for ev in events or []:
        for d in ev["days"]:
            for s in ev["signals"]:
                mu, sd = PARAMS[s]
                sign = 1.0 if SIGNALS[s]["direction"] == "high" else -1.0
                cols[s][d] = mu + sign * ev["sd"] * sd
    return _to_rows(cols, n)


def make_rehearsal_fixture(seed: int = 42, plant: bool = True) -> dict:
    """Generate a 10-minute, one-sample-per-second simulated vitals rehearsal.
    plant=False gives the clean twin (same noise, no anomaly)."""
    rng = np.random.default_rng(seed)
    seconds = np.arange(REHEARSAL_ROWS)
    slow = _ar1(rng, REHEARSAL_ROWS)
    fast = _ar1(rng, REHEARSAL_ROWS)

    hr = 62.0 + 1.8 * np.sin(2 * np.pi * seconds / 180) + 0.55 * slow
    hrv = 55.0 + 3.0 * np.sin(2 * np.pi * seconds / 240 + 0.4) + 1.1 * fast
    spo2 = 97.5 + 0.16 * _ar1(rng, REHEARSAL_ROWS)
    core_temp = 36.8 + 0.035 * np.sin(2 * np.pi * seconds / 600) + 0.012 * _ar1(rng, REHEARSAL_ROWS)

    onset = REHEARSAL_ANOMALY_INDEX
    end = onset + REHEARSAL_ANOMALY_DURATION
    if plant:
        hr[onset:end] += 8.0
        hrv[onset:end] -= 14.0
        spo2[onset:end] -= 1.2

    rows = []
    for i in range(REHEARSAL_ROWS):
        rows.append({
            "index": i,
            "elapsed_seconds": i,
            "simulated": True,
            "hr": round(float(hr[i]), 2),
            "hrv": round(float(hrv[i]), 2),
            "spo2": round(float(spo2[i]), 2),
            "core_temp": round(float(core_temp[i]), 3),
            "planted_anomaly": bool(plant and onset <= i < end),
        })

    return {
        "meta": {
            "simulated": True,
            "label": "SIMULATED DATA",
            "sample_count": REHEARSAL_ROWS,
            "sample_interval_seconds": 1,
            "seed": seed,
            "note": "Fictional synthetic vitals for demo rehearsal; not OSDR measurements or medical data.",
            "replay": {"rows_per_second": 1, "default_speed": 1},
            "planted_anomaly": ({
                "onset_index": onset,
                "end_index_exclusive": end,
                "duration_samples": REHEARSAL_ANOMALY_DURATION,
                "signals": ["hr", "hrv", "spo2"],
                "expected_first_alert_index": onset,
            } if plant else None),
        },
        "rows": rows,
    }


def write_rehearsal_fixture(path: str | Path, seed: int = 42) -> None:
    """Write the deterministic second-resolution event fixture as compact JSON."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(make_rehearsal_fixture(seed), f, separators=(",", ":"))


def _to_rows(cols: Dict[str, np.ndarray], n: int) -> List[Dict]:
    rows = []
    for t in range(n):
        r = {"index": t, "day": t, "simulated": True}
        for s in PARAMS:
            r[s] = round(float(cols[s][t]), 3)
        rows.append(r)
    return rows


def write_fixture(path: str, seed: int = 7) -> None:
    """The single-person challenge-brief fixture (600 rows, planted anomalies)."""
    payload = {"meta": {"simulated": True, "rows": N_ROWS,
                        "row_means": "one mission-day summary; replay 1 row/sec",
                        "planted": {"single_hrv": list(PLANT_A), "multi": list(PLANT_B)},
                        "seed": seed},
               "rows": make_rows(seed)}
    with open(path, "w") as f:
        json.dump(payload, f)


def _meta(kind: str, extra: dict) -> dict:
    return {"simulated": True, "label": "SIMULATED DATA", "kind": kind, "rows_per_crew": N_ROWS,
            "note": "SIMULATED vitals for a demo crew named after Team MANTA. Invented numbers: not astronaut data, not anyone's health data.",
            "row_means": "one mission-day summary per row",
            "replay": {"rows_per_second": 1, "default_speed": 1},
            "signals": list(PARAMS), **extra}


def build_vitals() -> dict:
    """Four-person simulated crew with known planted events (ground truth)."""
    crew = [{"id": c["id"], "callsign": c["callsign"], "title": c["title"],
             "seed": c["seed"], "planted": c["events"],
             "rows": make_rows_events(c["seed"], c["events"])} for c in CREW]
    return {"meta": _meta("planted", {
        "demo_beat": {"crew_id": "niloy", "planted_index": PLANT_A[0],
                      "planted_indices": list(PLANT_A), "expected_alert_index": PLANT_A[1],
                      "rule": "hrv_below_personal_baseline", "signal": "hrv"}}),
        "crew": crew}


def build_vitals_clean() -> dict:
    """Same shape, no planted events, bounded noise. The rules must stay silent."""
    crew = []
    for k, c in enumerate(CREW):
        seed = CLEAN_SEED + k
        crew.append({"id": c["id"], "callsign": c["callsign"], "title": c["title"],
                     "seed": seed, "planted": [],
                     "rows": make_rows_events(seed, [], quiet=True)})
    return {"meta": _meta("clean", {
        "demo_beat": None,
        "noise": "bounded: 15-day blocks, each a shuffle of the same evenly spread deviations",
        "caveat": ("Quiet by construction. Zero alerts here only shows the rules need a cause; it "
                   "is NOT the real false-alarm rate, which is measured on ordinary Gaussian noise "
                   "in validation.json (about 24 chance alerts per 1000 crew-days).")}),
        "crew": crew}


def build_all() -> Dict[str, dict]:
    """Every committed fixture, keyed by file name. Pure + seeded = reproducible."""
    return {"vitals.json": build_vitals(),
            "vitals_clean.json": build_vitals_clean(),
            "rehearsal_1hz.json": make_rehearsal_fixture(42, plant=True),
            "rehearsal_1hz_clean.json": make_rehearsal_fixture(42, plant=False)}


def write_crew_fixture(path: str) -> None:
    with open(path, "w") as f:
        json.dump(build_vitals(), f, separators=(",", ":"))
