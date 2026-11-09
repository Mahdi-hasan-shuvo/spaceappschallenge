"""OSDR cache tool + cache validation. The NASA API is replaced by a stub: these tests never touch
the network (and the build sandbox cannot reach NASA, so the live call is untested by design)."""
import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import cache_osdr as C                      # noqa: E402

from astra.evidence import Evidence         # noqa: E402

CACHE = ROOT / "backend" / "astra" / "data" / "evidence_cache.json"


def api_payload(osd, title="New title from API", release=1715644800):
    return {osd: {"metadata": {"study title": title, "accession": osd, "organism": "Homo sapiens",
                               "study public release date": release,
                               "mission": {"name": "Test Mission", "start_date": "2021-09-16", "end_date": "2021-09-18"},
                               "study description": "A long description. " * 40}}}


def cache():
    return json.loads(CACHE.read_text(encoding="utf-8"))


def test_committed_cache_is_valid_and_every_signal_has_osdr_context():
    ev = Evidence()
    assert ev.validate() == []
    for sig in ("hr", "hrv", "spo2", "sleep_h", "core_temp", "exercise_min"):
        assert ev.for_signal(sig), sig
    assert all(r["url"].startswith("https://") for r in ev.records.values())


def test_validate_catches_broken_caches(tmp_path):
    def bad(mutate):
        d = cache(); mutate(d)
        p = tmp_path / "c.json"; p.write_text(json.dumps(d))
        return Evidence(p).validate()
    assert any("unknown record" in x for x in bad(lambda d: d["mappings"]["hrv:low"].append({"id": "OSD-0", "relevance": "direct"})))
    assert any("https" in x for x in bad(lambda d: d["records"][0].update(url="http://x")))
    assert any("missing title" in x for x in bad(lambda d: d["records"][0].update(title="")))
    assert any("must match its url" in x for x in bad(lambda d: d["records"][0].update(url="https://x.example/other")))
    assert any("relevance" in x for x in bad(lambda d: d["mappings"]["hr:high"][0].update(relevance="proven")))
    assert any("meta.retrieved" in x for x in bad(lambda d: d["meta"].update(retrieved="")))


def test_parse_dataset_reads_the_v2_shape():
    got = C.parse_dataset("OSD-569", api_payload("OSD-569"))
    assert got["title"] == "New title from API" and got["organism"] == "Homo sapiens"
    assert got["release_date"] == "2024-05-14"
    assert got["mission"] == "Test Mission (2021-09-16 to 2021-09-18)"
    assert len(got["description"]) <= 600


@pytest.mark.parametrize("payload", [{}, {"OSD-569": {}}, {"OSD-569": {"metadata": {}}}, {"OSD-570": {"metadata": {"study title": "x"}}}])
def test_parse_dataset_rejects_wrong_shapes(payload):
    with pytest.raises(ValueError):
        C.parse_dataset("OSD-569", payload)


def test_refresh_updates_titles_keeps_mappings_and_dates_the_fetch():
    old = cache()
    new, failures, updated = C.refresh(old, None, [], lambda url: api_payload(url.rstrip("/").split("/")[-1]), today="2030-01-02")
    assert failures == [] and len(updated) == 9 and all(i.startswith("OSD-") for i in updated)
    assert new["mappings"] == old["mappings"]
    rec = next(r for r in new["records"] if r["id"] == "OSD-569")
    assert rec["title"] == "New title from API" and rec["retrieved"] == "2030-01-02"
    assert new["meta"]["retrieved"] == "2030-01-02"
    ntrs = next(r for r in new["records"] if r["kind"] == "NTRS")
    assert ntrs == next(r for r in old["records"] if r["id"] == ntrs["id"]), "non-OSDR records are untouched"


def test_failed_fetch_keeps_the_old_record():
    old = cache()

    def flaky(url):
        if "OSD-570" in url:
            raise OSError("tunnel failed: 403")
        return api_payload(url.rstrip("/").split("/")[-1])
    new, failures, updated = C.refresh(old, None, [], flaky, today="2030-01-02")
    assert [f[0] for f in failures] == ["OSD-570"] and "OSD-570" not in updated
    assert next(r for r in new["records"] if r["id"] == "OSD-570") == next(r for r in old["records"] if r["id"] == "OSD-570")


def test_total_failure_changes_nothing():
    old = cache()

    def down(url):
        raise OSError("offline")
    new, failures, updated = C.refresh(old, None, [], down, today="2030-01-02")
    assert updated == [] and len(failures) == 9 and new == old


def test_add_a_new_study_and_drop_it_again_if_it_cannot_be_fetched():
    old = cache()
    new, failures, updated = C.refresh(old, [], ["OSD-123"], lambda url: api_payload("OSD-123", "Fresh"), today="2030-01-02")
    rec = next(r for r in new["records"] if r["id"] == "OSD-123")
    assert rec["title"] == "Fresh" and rec["url"] == C.API.format(id="OSD-123") and updated == ["OSD-123"]

    def down(url):
        raise OSError("offline")
    new2, failures2, _ = C.refresh(old, [], ["OSD-123"], down)
    assert failures2 and not any(r["id"] == "OSD-123" for r in new2["records"])


def test_cli_writes_a_valid_cache_and_validate_mode_is_offline(tmp_path, capsys):
    p = tmp_path / "c.json"; p.write_text(CACHE.read_text(encoding="utf-8"))
    rc = C.main(["--cache", str(p), "--ids", "OSD-569"], fetcher=lambda url: api_payload("OSD-569", "CLI title"))
    assert rc == 0 and json.loads(p.read_text())["records"][0]["title"] == "CLI title"
    assert C.main(["--cache", str(p), "--validate"]) == 0
    rc = C.main(["--cache", str(p), "--ids", "OSD-570"], fetcher=lambda url: (_ for _ in ()).throw(OSError("x")))
    assert rc == 1                                   # a failed refresh is reported, not hidden


def test_fetcher_refuses_non_osdr_hosts():
    with pytest.raises(ValueError):
        C.fetch_json("https://example.com/x")
