"""The 1 Hz rehearsal stream: websocket replay, speed control, and the planted demo beat."""
import json

from astra.rehearsal import RehearsalRun
from compute.detect import Config


def collect(ws, until="end"):
    msgs = []
    while True:
        m = ws.receive_json()
        msgs.append(m)
        if m["type"] == until:
            return msgs


def test_rehearsal_alerts_endpoint_planted(client):
    r = client.get("/api/rehearsal/alerts").json()
    assert r["simulated"] is True and r["label"] == "SIMULATED DATA"
    assert r["first_alert_index"] == 420 and r["detection_delay_samples"] == 0
    assert all(a["index"] >= 420 for a in r["alerts"])
    a = r["alerts"][0]
    assert a["rule"] == "multi_signal_deviation" and a["details"][0]["row_unit"] == "second"
    assert a["evidence"] and a["citations"] and a["citations"][0]["url"].startswith("https://")
    assert "No diagnosis is made" in a["explanation"]


def test_rehearsal_alerts_endpoint_clean_is_silent(client):
    r = client.get("/api/rehearsal/alerts", params={"fixture": "clean"}).json()
    assert r["alerts"] == [] and r["first_alert_index"] is None


def test_rehearsal_alerts_rejects_unknown_fixture(client):
    assert client.get("/api/rehearsal/alerts", params={"fixture": "nope"}).status_code == 422


def test_websocket_replays_every_second_in_order_and_ends(client):
    with client.websocket_connect("/ws/rehearsal?speed=1000&start=400") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["simulated"] is True and hello["n"] == 600
        assert hello["label"] == "SIMULATED DATA"
        assert set(hello["signals"]) == {"hr", "hrv", "spo2", "core_temp"}
        back = ws.receive_json()                  # started at 400: the chart is backfilled first
        assert back["type"] == "reset" and back["next_index"] == 400 and len(back["samples"]) == 400
        assert back["samples"][-1]["index"] == 399 and back["samples"][-1]["mu"]["hr"] is not None
        msgs = collect(ws)
    samples = [m for m in msgs if m["type"] == "sample"]
    assert [s["index"] for s in samples] == list(range(400, 600))
    assert msgs[-1]["type"] == "end" and msgs[-1]["alert_count"] >= 3
    assert all(s["simulated"] is True and s["label"] == "SIMULATED DATA" for s in samples)
    first = next(s for s in samples if s["alerts"])
    assert first["index"] == 420 and first["status"] == "alert" and first["planted_anomaly"] is True
    assert samples[0]["mu"]["hr"] is not None and samples[0]["sd"]["hr"] > 0   # baseline band is streamed
    assert all(s["status"] != "alert" for s in samples if s["index"] < 420)


def test_websocket_clean_stream_never_alerts(client):
    with client.websocket_connect("/ws/rehearsal?speed=1000&start=300&fixture=clean") as ws:
        ws.receive_json()
        ws.receive_json()
        msgs = collect(ws)
    assert not any(m.get("alerts") for m in msgs if m["type"] == "sample")


def test_speed_control_changes_the_pace_mid_stream(client):
    with client.websocket_connect("/ws/rehearsal?speed=2&start=0") as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"action": "speed", "value": 1000}))
        seen = 0
        while True:
            m = ws.receive_json()
            if m["type"] == "speed":
                assert m["speed"] == 1000
                break
            seen += 1
            assert seen < 10, "speed ack should arrive within a few samples"
        end = collect(ws)[-1]
        assert end["type"] == "end"                      # 600 samples at 2/s would take 5 minutes


def test_pause_seek_and_reset(client):
    with client.websocket_connect("/ws/rehearsal?speed=1000&start=100&paused=true") as ws:
        ws.receive_json()
        assert len(ws.receive_json()["samples"]) == 100          # backfill for start=100
        ws.send_text(json.dumps({"action": "seek", "value": 415}))
        r = ws.receive_json()
        assert r["type"] == "reset" and r["next_index"] == 415 and len(r["samples"]) == 415
        ws.send_text(json.dumps({"action": "play"}))
        nxt = ws.receive_json()
        assert nxt["type"] == "sample" and nxt["index"] == 415


def test_bad_fixture_name_closes_the_socket(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rehearsal?fixture=nope") as ws:
            ws.receive_json()


def test_run_is_deterministic_and_seekable():
    from astra import config
    from astra.engine import load_rehearsal
    fx = load_rehearsal(config.FIXTURES / "rehearsal_1hz.json")
    a, b = RehearsalRun(fx), RehearsalRun(fx)
    assert [x["index"] for x in a.run_all()] == [x["index"] for x in b.run_all()]
    b.reset(430)
    assert b.index == 430 and [x["index"] for x in b.alerts] == [x["index"] for x in a.alerts if x["index"] <= 430]
    assert a.cfg == Config.per_second()
