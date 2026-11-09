# demo_fixtures — SIMULATED DATA

Every file here is **simulated**, seeded and reproducible. None of it is astronaut data. Each file carries
`"simulated": true` and the label `SIMULATED DATA`, and the loader refuses a file that does not.

Rebuild or verify: `python3 tools/make_fixtures.py` / `python3 tools/make_fixtures.py --check`.

| File | What it is | Known ground truth |
|---|---|---|
| `vitals.json` | 4 demo crew (Niloy, Puja, Dhiraj, Tusar) with invented vitals × 600 rows (hr, hrv, spo2, sleep_h, core_temp, exercise_min). One row = one mission-day summary, replayed at 1 row per second (600 rows = 10 minutes). | Niloy: single-signal HRV drop at index **250-251** (the demo beat; the rule fires at 251), multi-signal event at 400-402. Puja and Dhiraj have planted events too; Tusar has none. Listed in each crew member's `planted`. |
| `vitals_clean.json` | Same shape, nothing planted. | None. All four crew members give **zero alerts**. |
| `rehearsal_1hz.json` | One crew-less stream, 600 samples at a true 1 Hz (hr, hrv, spo2, core_temp). | Anomaly at index **420-439** (HR +8 bpm, HRV −14 ms, SpO2 −1.2 pts). Multi-signal rule fires at 420. |
| `rehearsal_1hz_clean.json` | Same noise, no anomaly. | None. Zero alerts. |
| `vitals.schema.json` | JSON Schema for `vitals*.json`. The same contract is enforced in `src/compute/schema.py`. | |

## Why the clean fixtures are quiet

Ordinary Gaussian noise on six signals over 600 days produces about **24 chance alerts per 1000 crew-days** (measured in
`backend/astra/data/validation.json`), so a run with no planted event is usually not alert-free. `vitals_clean.json`
is therefore *quiet by construction*: every 15-day block is a shuffle of the same evenly spread deviations, so no day can
stand out against a 30-day personal baseline. It tests that the rules need a cause. It is **not** the real false-alarm
rate. `tests/test_fixtures.py` checks the construction holds for 30 seeds (not just the committed one) and checks the honest
rate separately on ordinary noise.
