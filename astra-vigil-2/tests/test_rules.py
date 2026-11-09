"""Each detection rule, tested on its own with hand-built rows (no randomness).

The baseline is a fixed alternating pattern, so its mean and SD are known exactly and a
"k SD" deviation really is k SD. The science boundary (src/compute) has no model in it.
"""
import numpy as np
import pytest

from compute.detect import SIGNALS, Config, StreamDetector, run, zscore

MU = {"hr": 62.0, "hrv": 55.0, "spo2": 97.5, "sleep_h": 7.0, "core_temp": 36.8, "exercise_min": 120.0}
STEP = {"hr": 2.0, "hrv": 5.0, "spo2": 0.5, "sleep_h": 0.5, "core_temp": 0.1, "exercise_min": 12.0}


def base_row(i):
    sign = 1 if i % 2 else -1
    return {s: MU[s] + sign * STEP[s] for s in SIGNALS}


def baseline_sd(signal, n=30):
    vals = [base_row(i)[signal] for i in range(n)]
    return max(float(np.std(vals, ddof=1)), SIGNALS[signal]["min_sd"])


def deviate(signal, k):
    """Value that is k SD in the WORSE direction of `signal`, against the pattern baseline."""
    sign = 1 if SIGNALS[signal]["direction"] == "high" else -1
    return MU[signal] + sign * k * baseline_sd(signal)


def stream(n, plant=None):
    """n baseline rows; plant = {row_index: {signal: value}} overrides."""
    rows = []
    for i in range(n):
        r = base_row(i)
        r.update((plant or {}).get(i, {}))
        rows.append(r)
    return rows


def fired(alerts, rule=None, signals=None):
    return [a for a in alerts if (rule is None or a.rule == rule) and (signals is None or a.signals == signals)]


# ---------------------------------------------------------------- baseline
def test_baseline_needs_min_days_before_any_judgement():
    rows = stream(20, {10: {"hrv": deviate("hrv", 6)}, 11: {"hrv": deviate("hrv", 6)}})
    assert run(rows) == []                                     # days 10-11 are inside the learning period
    d = StreamDetector()
    for r in rows[:13]:
        d.update(r)
    assert zscore(d.hist["hrv"], d.excl["hrv"], 55.0, "hrv", Config()) is None   # 13 < min_baseline 14


def test_baseline_is_the_last_30_rows_personal_mean_and_sd():
    rows = stream(60)
    d = StreamDetector()
    for r in rows:
        d.update(r)
    z = zscore(d.hist["hrv"], d.excl["hrv"], 55.0, "hrv", Config())
    last30 = [r["hrv"] for r in rows[-30:]]
    assert z["baseline_n"] == 30
    assert z["baseline_mean"] == pytest.approx(np.mean(last30))
    assert z["baseline_sd"] == pytest.approx(np.std(last30, ddof=1))


def test_baseline_ignores_a_confirmed_episode():
    ev = {i: {"hrv": deviate("hrv", 4)} for i in range(40, 55)}
    d = StreamDetector()
    for r in stream(70, ev):
        d.update(r)
    z = zscore(d.hist["hrv"], d.excl["hrv"], 55.0, "hrv", Config())
    assert abs(z["baseline_mean"] - MU["hrv"]) < 2.0, "a long event must not become the new normal"


def test_min_sd_floor_stops_a_flat_baseline_exploding():
    rows = [{**{s: MU[s] for s in SIGNALS}} for _ in range(40)]          # perfectly flat: SD = 0
    rows += [{**rows[0], "hr": MU["hr"] + 0.5}] * 3                        # tiny wobble
    assert fired(run(rows), "hr_above_personal_baseline") == []           # 0.5 / min_sd 1.0 = 0.5 SD
    rows2 = rows[:40] + [{**rows[0], "hr": MU["hr"] + 3.0}] * 2           # a real 3 bpm shift
    assert fired(run(rows2), "hr_above_personal_baseline")


# ---------------------------------------------------------------- Rule S
def test_rule_s_needs_two_consecutive_rows():
    one = stream(50, {40: {"hrv": deviate("hrv", 3.5)}})
    assert fired(run(one), signals=["hrv"]) == []
    two = stream(50, {40: {"hrv": deviate("hrv", 3.5)}, 41: {"hrv": deviate("hrv", 3.5)}})
    a = fired(run(two), "hrv_below_personal_baseline")
    assert len(a) == 1 and a[0].day == 41
    gap = stream(50, {40: {"hrv": deviate("hrv", 3.5)}, 42: {"hrv": deviate("hrv", 3.5)}})
    assert fired(run(gap), signals=["hrv"]) == [], "a gap breaks the streak"


def test_rule_s_threshold_is_2_sd():
    for k, expect in ((1.8, False), (2.3, True)):
        plant = {40: {"hrv": deviate("hrv", k)}, 41: {"hrv": deviate("hrv", k)}}
        assert bool(fired(run(stream(50, plant)), "hrv_below_personal_baseline")) is expect, k


@pytest.mark.parametrize("signal", list(SIGNALS))
def test_rule_s_fires_only_in_the_worse_direction(signal):
    worse = deviate(signal, 3.5)
    better = 2 * MU[signal] - worse                                        # same size, other side
    name = f"{signal}_{'above' if SIGNALS[signal]['direction'] == 'high' else 'below'}_personal_baseline"
    bad = fired(run(stream(50, {40: {signal: worse}, 41: {signal: worse}})), name)
    good = fired(run(stream(50, {40: {signal: better}, 41: {signal: better}})), name)
    assert len(bad) == 1 and good == []


def test_rule_s_alert_carries_exact_numbers():
    plant = {40: {"hr": deviate("hr", 4)}, 41: {"hr": deviate("hr", 4)}}
    a = fired(run(stream(50, plant)), "hr_above_personal_baseline")[0]
    d = a.details[0]
    assert d["current"] == pytest.approx(deviate("hr", 4))
    # on the confirming row the baseline still contains the first deviating row, so z reads a little
    # under the 4 SD planted - the alert reports exactly what the rule saw, not the planted size
    assert 3.0 < d["z"] < 4.0
    assert d["window_days"] == 30 and d["threshold_sd"] == 2.0 and d["baseline_n"] == 30
    assert d["baseline_mean"] == pytest.approx(MU["hr"], abs=0.5)   # includes the first deviating row (8 bpm / 30)


# ---------------------------------------------------------------- Rule M
def two_signal(k, day_a, day_b):
    plant = {}
    plant.setdefault(day_a, {})["hr"] = deviate("hr", k)
    plant.setdefault(day_b, {})["hrv"] = deviate("hrv", k)      # same day -> one row with both
    return stream(60, plant)


def test_rule_m_fires_when_two_signals_deviate_on_the_same_day():
    a = fired(run(two_signal(3.0, 45, 45)), "multi_signal_deviation")
    assert len(a) == 1 and a[0].day == 45 and a[0].signals == ["hr", "hrv"]
    assert all(d["threshold_sd"] == 2.5 for d in a[0].details)


def test_rule_m_window_is_two_rows_48h():
    assert fired(run(two_signal(3.0, 45, 46)), "multi_signal_deviation"), "1 row apart: inside 48 h"
    assert not fired(run(two_signal(3.0, 45, 47)), "multi_signal_deviation"), "2 rows apart: outside"


def test_rule_m_needs_two_signals_and_2_5_sd():
    one = stream(60, {45: {"hrv": deviate("hrv", 5)}})
    assert fired(run(one), "multi_signal_deviation") == []
    weak = two_signal(2.2, 45, 45)                                          # above 2.0 but below 2.5
    assert fired(run(weak), "multi_signal_deviation") == []


def test_rule_m_fires_once_per_episode():
    plant = {i: {"hr": deviate("hr", 3.5), "hrv": deviate("hrv", 3.5)} for i in range(45, 49)}
    assert len(fired(run(stream(60, plant)), "multi_signal_deviation")) == 1


# ---------------------------------------------------------------- general
def test_rows_may_carry_a_subset_of_signals():
    rows = [{"hr": r["hr"], "hrv": r["hrv"]} for r in stream(50, {
        40: {"hrv": deviate("hrv", 4)}, 41: {"hrv": deviate("hrv", 4)}})]
    assert [a.rule for a in run(rows)] == ["hrv_below_personal_baseline"]


def test_detection_is_deterministic_and_pure():
    rows = stream(60, {50: {"hr": deviate("hr", 4)}, 51: {"hr": deviate("hr", 4)}})
    first = [a.to_dict() for a in run(rows)]
    assert first == [a.to_dict() for a in run(rows)]
    assert first and first[0]["rule"] == "hr_above_personal_baseline"


def test_per_second_preset_keeps_the_same_two_rules():
    c = Config.per_second()
    assert c.unit == "second" and c.single_persist >= 2 and c.multi_min_signals == 2
    assert Config().unit == "day" and Config().baseline_days == 30       # console defaults unchanged
