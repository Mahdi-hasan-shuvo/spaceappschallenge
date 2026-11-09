"""The science boundary: deterministic rules, tested on planted and clean fixtures."""
from compute.detect import Config, hrv_deviation, run
from compute.fixture import make_rows, make_rows_events


def test_planted_single_event_is_caught_within_two_days():
    rows = make_rows(seed=7)
    alerts = run(rows)
    hits = [a for a in alerts if a.rule == "hrv_below_personal_baseline" and 250 <= a.day <= 252]
    assert hits, "planted HRV event at day 250-251 must fire the single-signal rule"
    assert hits[0].day == 251  # needs 2 consecutive days
    d = hits[0].details[0]
    assert d["z"] < -2.0 and d["window_days"] == 30 and d["baseline_n"] >= 14


def test_planted_multi_event_fires_multi_rule():
    alerts = run(make_rows(seed=7))
    multi = [a for a in alerts if a.rule == "multi_signal_deviation" and 400 <= a.day <= 402]
    assert multi
    assert {"hrv", "hr"} <= set(multi[0].signals)


def test_clean_fixture_has_few_false_alarms():
    total = 0
    days = 0
    for seed in range(40, 60):
        total += len(run(make_rows(seed=seed, plant=False)))
        days += 600
    assert total / days * 1000 < 40, "false alarm rate should stay low (about 24 per 1000 days)"


def test_no_alert_during_learning_period():
    rows = make_rows(seed=7)
    assert [a for a in run(rows) if a.day < 14] == []


def test_alert_carries_rule_and_numbers_only():
    a = run(make_rows(seed=7))[0].to_dict()
    assert {"rule", "day", "signals", "details"} <= set(a)
    for d in a["details"]:
        assert {"current", "baseline_mean", "baseline_sd", "z", "threshold_sd"} <= set(d)


def test_hrv_deviation_excludes_current_point():
    base = [55.0 + (i % 3) for i in range(40)]
    r = hrv_deviation(base + [30.0])
    assert r["fired"] and r["z"] < -2
    assert not hrv_deviation(base + [55.5])["fired"]


def test_event_does_not_become_new_normal():
    ev = [{"days": list(range(200, 215)), "signals": ["hrv"], "sd": 3.5}]
    rows = make_rows_events(5, ev)
    hr = [a for a in run(rows, Config()) if a.signals == ["hrv"] and a.day >= 200]
    assert hr and hr[0].day == 201
