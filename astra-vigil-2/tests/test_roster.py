"""The demo crew: Niloy, Puja, Dhiraj, Tusar. Names and portraits are real team assets; the vitals stay invented."""
import json

from astra import config

NAMES = ["Niloy", "Puja", "Dhiraj", "Tusar"]


def test_crew_is_the_four_team_members_in_order(client):
    s = client.get("/api/snapshot", params={"role": "crew", "crew": "niloy"}).json()
    assert [c["callsign"] for c in s["crew"]] == NAMES
    assert [c["id"] for c in s["crew"]] == [n.lower() for n in NAMES]
    assert "kestrel" not in json.dumps(s).lower()


def test_portraits_are_served_for_all_four_crew(client):
    s = client.get("/api/snapshot", params={"role": "ground"}).json()
    photo = {c["id"]: c["photo"] for c in s["crew"]}
    for cid in ("niloy", "puja", "dhiraj", "tusar"):
        assert photo[cid] and photo[cid].startswith(f"/crew-photo/{cid}")
        r = client.get(photo[cid])
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and len(r.content) > 20_000
        assert r.content[:3] == b"\xff\xd8\xff"


def test_photo_route_only_serves_known_crew_ids(client):
    for bad in ("nobody", "niloy.jpg", "%2e%2e%2fLICENSE", "..%2fREADME.md", "niloy%00"):
        r = client.get(f"/crew-photo/{bad}")
        # encoded slashes fall through to the single-page-app shell: never an image, never a file from disk
        assert r.status_code in (200, 404, 400, 422), bad
        assert not r.headers.get("content-type", "").startswith("image/"), bad
        assert b"Apache License" not in r.content, bad
    r = client.get("/crew-photo/..")           # the HTTP client rewrites this to "/": it can never reach a file
    assert not r.headers.get("content-type", "").startswith("image/")


def test_dropping_a_photo_in_makes_it_appear_without_a_rebuild(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CREW_PHOTOS", tmp_path)
    assert client.get("/crew-photo/tusar").status_code == 404
    (tmp_path / "tusar.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    assert client.get("/crew-photo/tusar").status_code == 200
    s = client.get("/api/snapshot", params={"role": "ground"}).json()
    assert next(c for c in s["crew"] if c["id"] == "tusar")["photo"].startswith("/crew-photo/tusar")


def test_vitals_are_still_labelled_invented_and_the_demo_beat_moved_to_niloy():
    fx = json.loads((config.FIXTURES / "vitals.json").read_text(encoding="utf-8"))
    assert fx["meta"]["demo_beat"]["crew_id"] == "niloy"
    assert "not anyone's health data" in fx["meta"]["note"]
    assert fx["meta"]["simulated"] is True
    assert all(r["simulated"] for c in fx["crew"] for r in c["rows"])


def test_notice_says_demo_crew_with_invented_vitals(client):
    m = client.get("/api/meta").json()
    assert "invented vitals" in m["notice"] and "Fictional" not in m["notice"]
