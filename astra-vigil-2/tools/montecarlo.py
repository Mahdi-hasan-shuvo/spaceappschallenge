"""Reproducible Monte Carlo for the numbers shown on the website.

    python tools/montecarlo.py --runs 300 --out backend/astra/data/validation.json

What it measures (all on SIMULATED data from the same noise model as the demo):
  * false alarms: alerts raised on 600-day runs with nothing planted,
    reported per 1000 crew-days, split by rule family;
  * detection: planted events (2-day single-signal drop, 3-day multi-signal
    shift, both 3.5 SD) and how often / how fast the detector raised an alert.

It is a statement about this detector on this noise model, not about real
astronauts. Real physiology is not Gaussian AR(1).
"""
from __future__ import annotations

import argparse
import json
import statistics as st
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

from compute.detect import run  # noqa: E402
from compute.fixture import make_rows_events  # noqa: E402

N_DAYS = 600


def false_alarms(runs: int, seed0: int) -> dict:
    single = multi = 0
    for i in range(runs):
        alerts = run(make_rows_events(seed0 + i, [], N_DAYS))
        for a in alerts:
            if a.rule == "multi_signal_deviation":
                multi += 1
            else:
                single += 1
    days = runs * N_DAYS
    return {"runs": runs, "crew_days": days, "single_alerts": single, "multi_alerts": multi,
            "single_per_1000_days": round(single / days * 1000, 2),
            "multi_per_1000_days": round(multi / days * 1000, 2),
            "all_per_1000_days": round((single + multi) / days * 1000, 2)}


def detection(runs: int, seed0: int, event: dict, rule_kind: str) -> dict:
    caught, delays = 0, []
    onset = min(event["days"])
    end = max(event["days"]) + 1
    for i in range(runs):
        alerts = run(make_rows_events(seed0 + i, [event], N_DAYS))
        hit = [a for a in alerts
               if onset <= a.day <= end and set(a.signals) & set(event["signals"])
               and (a.rule == "multi_signal_deviation") == (rule_kind == "multi")]
        if hit:
            caught += 1
            delays.append(min(a.day for a in hit) - onset)
    return {"runs": runs, "caught": caught,
            "detection_rate_pct": round(caught / runs * 100, 1),
            "mean_delay_days": round(st.mean(delays), 2) if delays else None,
            "event": event}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=300)
    ap.add_argument("--seed", type=int, default=5000)
    ap.add_argument("--out", type=str, default="")
    a = ap.parse_args()
    t0 = time.time()
    out = {
        "simulated": True,
        "noise_model": "per-signal Gaussian AR(1), phi=0.3, illustrative means/SDs (not astronaut data)",
        "days_per_run": N_DAYS,
        "seed_start": a.seed,
        "false_alarms": false_alarms(a.runs, a.seed),
        "single_event": detection(a.runs, a.seed + 10_000,
                                  {"days": [250, 251], "signals": ["hrv"], "sd": 3.5}, "single"),
        "multi_event": detection(a.runs, a.seed + 20_000,
                                 {"days": [400, 401, 402], "signals": ["hrv", "hr", "sleep_h"], "sd": 3.5}, "multi"),
    }
    out["seconds"] = round(time.time() - t0, 1)
    txt = json.dumps(out, indent=2)
    print(txt)
    if a.out:
        Path(a.out).write_text(txt)


if __name__ == "__main__":
    main()
