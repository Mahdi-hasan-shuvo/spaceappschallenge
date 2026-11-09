"""The committed demo fixtures: reproducible, valid, honest - and the planted/clean pair."""
import copy
import json

import pytest

from astra import config
from compute.detect import Config, run
from compute.fixture import (CLEAN_SEED, CREW, build_all, make_rows_events, make_rehearsal_fixture)
from compute.schema import FixtureError, validate_rehearsal, validate_vitals

FILES = ("vitals.json", "vitals_clean.json", "rehearsal_1hz.json", "rehearsal_1hz_clean.json")


def load(name):
    return json.loads((config.FIXTURES / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", FILES)
def test_committed_fixture_equals_a_fresh_rebuild(name):
    assert load(name) == json.loads(json.dumps(build_all()[name])), \
        f"{name} is stale: run python3 tools/make_fixtures.py"


def test_every_fixture_is_valid_and_labelled_simulated():
    for name in FILES:
        fx = load(name)
        (validate_rehearsal if name.startswith("rehearsal") else validate_vitals)(fx)
        assert fx["meta"]["simulated"] is True
        rows = fx["rows"] if "rows" in fx else [r for c in fx["crew"] for r in c["rows"]]
        assert all(r["simulated"] is True for r in rows)


def test_daily_fixture_is_600_rows_per_crew_with_index():
    fx = load("vitals.json")
    assert fx["meta"]["replay"]["rows_per_second"] == 1
    for c in fx["crew"]:
        assert [r["index"] for r in c["rows"]] == list(range(600))
        assert set(c["rows"][0]) >= {"hr", "hrv", "spo2", "sleep_h", "core_temp", "exercise_min"}


def test_planted_anomaly_is_at_the_documented_index():
    fx = load("vitals.json")
    beat = fx["meta"]["demo_beat"]
    niloy = next(c for c in fx["crew"] if c["id"] == beat["crew_id"])
    assert beat["planted_index"] == 250 and niloy["planted"][0]["days"] == [250, 251]
    rows = niloy["rows"]
    # the planted rows really are far from their own recent history
    hist = [r["hrv"] for r in rows[220:250]]
    mu = sum(hist) / len(hist)
    assert rows[250]["hrv"] < mu - 15 and rows[251]["hrv"] < mu - 15
    hit = [a for a in run(rows) if a.rule == "hrv_below_personal_baseline" and a.day == beat["expected_alert_index"]]
    assert hit and hit[0].details[0]["z"] < -2.0


def test_every_planted_event_in_the_crew_fixture_is_detected():
    fx = load("vitals.json")
    for c in fx["crew"]:
        alerts = run(c["rows"])
        for ev in c["planted"]:
            lo, hi = min(ev["days"]), max(ev["days"]) + 2
            assert any(lo <= a.day <= hi and set(a.signals) & set(ev["signals"]) for a in alerts), (c["id"], ev)


def test_clean_fixture_has_no_planted_events_and_no_alerts():
    fx = load("vitals_clean.json")
    assert fx["meta"]["kind"] == "clean" and fx["meta"]["demo_beat"] is None
    for c in fx["crew"]:
        assert c["planted"] == []
        assert run(c["rows"]) == [], c["id"]


def test_clean_noise_is_quiet_for_many_seeds_not_just_the_committed_one():
    """Guards against cherry-picking: the construction itself stays below both thresholds."""
    for seed in range(CLEAN_SEED, CLEAN_SEED + 30):
        assert run(make_rows_events(seed, [], quiet=True)) == [], seed


def test_clean_fixture_is_documented_as_not_the_real_false_alarm_rate():
    cav = load("vitals_clean.json")["meta"]["caveat"]
    assert "NOT the real false-alarm rate" in cav and "validation.json" in cav
    val = json.loads((config.DATA / "validation.json").read_text(encoding="utf-8"))
    assert 10 < val["false_alarms"]["all_per_1000_days"] < 40       # honest number is published


def test_ordinary_noise_false_alarm_rate_matches_the_published_band():
    n_alerts = sum(len(run(make_rows_events(s, [], n=600))) for s in range(900, 915))
    per_1000 = n_alerts / (15 * 600) * 1000
    assert 12 < per_1000 < 40, per_1000


# ---------------------------------------------------------------- 1 Hz stream
def test_rehearsal_stream_anomaly_index_is_exact():
    fx = load("rehearsal_1hz.json")
    pa = fx["meta"]["planted_anomaly"]
    assert (pa["onset_index"], pa["end_index_exclusive"]) == (420, 440)
    assert [r["index"] for r in fx["rows"] if r["planted_anomaly"]] == list(range(420, 440))
    assert fx["meta"]["replay"]["rows_per_second"] == 1


def test_rehearsal_detection_beat_is_at_the_planted_index():
    rows = load("rehearsal_1hz.json")["rows"]
    alerts = run(rows, Config.per_second())
    assert [a.day for a in alerts if a.day < 420] == [], "nothing fires before the anomaly"
    first = alerts[0]
    assert first.rule == "multi_signal_deviation" and first.day == 420
    assert {"hr", "hrv", "spo2"} <= set(first.signals)
    assert {a.rule for a in alerts} >= {"hr_above_personal_baseline", "hrv_below_personal_baseline"}
    assert all(a.day <= 425 for a in alerts)


def test_rehearsal_clean_twin_is_silent_and_has_identical_noise():
    clean, planted = load("rehearsal_1hz_clean.json"), load("rehearsal_1hz.json")
    assert run(clean["rows"], Config.per_second()) == []
    assert clean["meta"]["planted_anomaly"] is None
    same = [i for i in range(600) if not (420 <= i < 440)]
    assert all(clean["rows"][i]["hr"] == planted["rows"][i]["hr"] for i in same)


# ---------------------------------------------------------------- schema
def test_schema_rejects_unlabelled_or_malformed_fixtures():
    good = load("vitals.json")
    with pytest.raises(FixtureError, match="simulated"):
        bad = copy.deepcopy(good); bad["meta"]["simulated"] = False; validate_vitals(bad)
    with pytest.raises(FixtureError, match="not marked simulated"):
        bad = copy.deepcopy(good); bad["crew"][0]["rows"][3]["simulated"] = False; validate_vitals(bad)
    with pytest.raises(FixtureError, match="missing or not a finite"):
        bad = copy.deepcopy(good); del bad["crew"][0]["rows"][5]["spo2"]; validate_vitals(bad)
    with pytest.raises(FixtureError, match="plausible range"):
        bad = copy.deepcopy(good); bad["crew"][1]["rows"][9]["hr"] = 900; validate_vitals(bad)
    with pytest.raises(FixtureError, match="expected 600 rows"):
        bad = copy.deepcopy(good); bad["crew"][2]["rows"].pop(); validate_vitals(bad)
    with pytest.raises(FixtureError, match="out of sequence"):
        bad = copy.deepcopy(good); bad["crew"][0]["rows"][7]["index"] = 99; validate_vitals(bad)
    with pytest.raises(FixtureError, match="planted_anomaly"):
        bad = load("rehearsal_1hz.json"); bad["rows"][10]["planted_anomaly"] = True; validate_rehearsal(bad)


def test_server_refuses_to_load_a_non_simulated_fixture(tmp_path):
    from astra.engine import load_fixture
    bad = load("vitals.json"); bad["meta"]["simulated"] = False
    p = tmp_path / "x.json"; p.write_text(json.dumps(bad))
    with pytest.raises(FixtureError):
        load_fixture(p)


def test_fixture_json_schema_file_lists_the_six_signals():
    sch = json.loads((config.FIXTURES / "vitals.schema.json").read_text(encoding="utf-8"))
    props = sch["$defs"]["row"]["properties"]
    assert {"hr", "hrv", "spo2", "sleep_h", "core_temp", "exercise_min", "simulated", "index"} <= set(props)
    assert props["simulated"]["const"] is True
