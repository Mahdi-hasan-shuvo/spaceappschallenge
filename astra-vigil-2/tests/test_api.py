import json

import pytest

from compute.fixture import make_rehearsal_fixture


def seek(c, day):
    assert c.post("/api/control", json={"action": "seek", "value": day}).status_code == 200


def test_meta_is_labelled_simulated(client):
    m = client.get("/api/meta").json()
    assert m["simulated"] is True and m["label"] == "SIMULATED DATA" and m["license"] == "Apache-2.0"
    assert m["author"] == "Niloy Bhattacharjee"


def test_fixture_has_600_rows_per_crew(client):
    app = client.app.state.astra
    assert app.mission.n == 600
    assert all(len(cs.rows) == 600 for cs in app.mission.crew.values())


def test_rehearsal_fixture_has_one_hz_cadence_and_known_anomaly(client):
    payload = client.get("/api/rehearsal-fixture").json()
    rows = payload["rows"]
    anomaly = payload["meta"]["planted_anomaly"]

    assert payload == make_rehearsal_fixture(seed=42)
    assert payload["meta"]["simulated"] is True
    assert payload["meta"]["sample_count"] == 600 and len(rows) == 600
    assert payload["meta"]["sample_interval_seconds"] == 1
    assert all(row["index"] == row["elapsed_seconds"] == i for i, row in enumerate(rows))
    assert anomaly["onset_index"] == 420
    assert anomaly["end_index_exclusive"] == 440
    assert [row["index"] for row in rows if row["planted_anomaly"]] == list(range(420, 440))
    assert rows[420]["hr"] >= rows[419]["hr"] + 7
    assert rows[420]["hrv"] <= rows[419]["hrv"] - 13
    assert rows[420]["spo2"] <= rows[419]["spo2"] - 1


def test_osdr_study_metadata_is_available_from_offline_cache(client):
    payload = client.get("/api/evidence").json()
    studies = {record["id"]: record for record in payload["records"]}
    assert payload["meta"]["retrieved"]
    assert studies["OSD-569"]["kind"] == "OSDR"
    assert studies["OSD-569"]["title"]
    assert studies["OSD-569"]["url"].startswith("https://")


def test_planted_anomaly_alert_has_rule_numbers_and_evidence(client):
    seek(client, 252)
    s = client.get("/api/snapshot", params={"role": "crew", "crew": "niloy"}).json()
    a = [x for x in s["alerts"] if x["rule"] == "hrv_below_personal_baseline" and x["day"] == 251][0]
    assert a["details"][0]["z"] < -2 and a["simulated"] is True
    assert a["evidence"] and a["evidence"][0]["relevance"] == "direct"
    assert all(e["url"].startswith("https://") and e["id"] for e in a["evidence"])
    assert "No diagnosis is made" in a["explanation"]
    assert a["explanation_bn"]
    assert a["ground_truth"]["planted"] is True


def test_series_has_baseline_band(client):
    seek(client, 120)
    j = client.get("/api/series/niloy", params={"role": "crew", "viewer": "niloy"}).json()
    hrv = j["series"]["hrv"]
    assert len(hrv["v"]) == 121 and hrv["mu"][-1] is not None and hrv["sd"][-1] > 0
    assert hrv["mu"][5] is None  # still learning


@pytest.mark.parametrize("role,viewer", [("crew", "puja"), ("medical", None), ("commander", None), ("ground", None)])
def test_raw_series_forbidden_to_others(client, role, viewer):
    seek(client, 50)
    params = {"role": role}
    if viewer:
        params["viewer"] = viewer
    assert client.get("/api/series/niloy", params=params).status_code == 403


def test_snapshot_for_other_roles_leaks_no_numbers(client):
    seek(client, 255)
    for role in ("medical", "commander", "ground"):
        s = client.get("/api/snapshot", params={"role": role}).json()
        blob = json.dumps(s)
        assert s["series"] is None
        assert "baseline_mean" not in blob and '"details"' not in blob


def test_medical_trend_needs_consent_by_the_crew_member(client):
    seek(client, 255)
    assert client.get("/api/trend/niloy", params={"role": "medical"}).status_code == 403
    r = client.post("/api/consent", json={"crew_id": "niloy", "role": "medical", "granted": True, "actor": "puja"})
    assert r.status_code == 403
    r = client.post("/api/consent", json={"crew_id": "niloy", "role": "medical", "granted": True, "actor": "niloy"})
    assert r.status_code == 200
    t = client.get("/api/trend/niloy", params={"role": "medical"}).json()
    assert set(t["signals"]) >= {"hrv", "hr"} and "current" not in json.dumps(t)


def test_ground_sees_status_only_after_light_time(client):
    st = client.app.state.astra
    st.delay_min = 60.0  # one modeled hour = 60 s in the demo: nothing is delivered yet
    seek(client, 240)
    for _ in range(14):
        client.post("/api/step", json={"n": 1})
    s = client.get("/api/snapshot", params={"role": "ground"}).json()
    assert s["outbox"] == [] and all(c["status"] == "unknown" or c["as_of_day"] is not None for c in s["crew"])
    q = client.get("/api/outbox", params={"role": "crew"}).json()["items"]
    assert any(m["status"] == "alert" and m["delivered"] == 0 for m in q)


def test_audit_log_records_and_verifies(client):
    seek(client, 255)
    client.post("/api/step", json={"n": 3})
    a = client.get("/api/audit").json()
    assert a["chain"]["ok"] and a["chain"]["entries"] >= 3
    assert any(e["action"] == "control" for e in a["entries"])


def test_assistant_endpoint_refuses_medical_questions(client):
    seek(client, 255)
    r = client.post("/api/assistant", json={"question": "Am I sick? What should I take?", "viewer": "niloy", "role": "crew"}).json()
    assert r["boundary"] is True
    r = client.post("/api/assistant", json={"question": "Which rule fired?", "viewer": "niloy", "role": "crew", "lang": "bn"}).json()
    assert r["lang"] == "bn" and r["source"] == "offline-rules"


def test_assistant_hides_numbers_from_non_owner(client):
    seek(client, 255)
    r = client.post("/api/assistant", json={"question": "Show HRV numbers", "viewer": "puja", "role": "crew", "crew_id": "niloy"}).json()
    assert "status word" in r["answer"]


def test_bad_inputs_rejected(client):
    assert client.post("/api/control", json={"action": "nope"}).status_code == 422
    assert client.post("/api/control", json={"action": "speed", "value": 7}).status_code == 422
    assert client.get("/api/snapshot", params={"role": "alien"}).status_code == 422
    assert client.post("/api/delay", json={"preset": "venus"}).status_code == 422


def test_websocket_snapshot_and_tick(client):
    seek(client, 249)
    with client.websocket_connect("/ws?role=crew&crew=niloy") as w:
        snap = w.receive_json()
        assert snap["type"] == "snapshot" and snap["series"]["crew_id"] == "niloy"
        assert snap["label"] == "SIMULATED DATA"
        client.post("/api/step", json={"n": 1})
        tick = w.receive_json()
        assert tick["type"] == "tick" and tick["day"] == 250 and "niloy" in tick["rows"]


def test_validation_scoreboard_marked_simulation(client):
    seek(client, 420)
    v = client.get("/api/validation").json()
    assert v["simulated"] is True and v["live"]["caught"] >= 2
