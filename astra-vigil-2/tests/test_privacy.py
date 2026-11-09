from astra.privacy import may_see_series, may_see_trend, project_alert, tier_for

ALERT = {"id": "k-1", "crew_id": "niloy", "day": 1, "signals": ["hrv"], "rule": "hrv_below_personal_baseline",
         "details": [{"z": -3}], "simulated": True}


def test_tiers():
    assert tier_for("crew", "niloy", "niloy", False) == 0
    assert tier_for("crew", "niloy", "puja", False) == 2
    assert tier_for("medical", None, "niloy", False) == 2
    assert tier_for("medical", None, "niloy", True) == 1
    assert tier_for("commander", None, "niloy", True) == 2
    assert tier_for("ground", None, "niloy", True) == 2


def test_series_only_for_self():
    assert may_see_series("crew", "niloy", "niloy")
    assert not may_see_series("crew", "niloy", "puja")
    assert not may_see_series("medical", None, "niloy")
    assert not may_see_trend("medical", None, "niloy", False)
    assert may_see_trend("medical", None, "niloy", True)


def test_alert_projection_strips_numbers():
    assert project_alert(ALERT, 0) is ALERT
    t1 = project_alert(ALERT, 1)
    assert "details" not in t1 and "rule" not in t1 and t1["rule_family"] == "single_signal"
    assert project_alert(ALERT, 2) is None
