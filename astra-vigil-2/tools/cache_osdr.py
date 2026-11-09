#!/usr/bin/env python3
"""Refresh the offline NASA OSDR study metadata cache (backend/astra/data/evidence_cache.json).

  python3 tools/cache_osdr.py                 # refresh every OSDR record from the OSDR API
  python3 tools/cache_osdr.py --ids OSD-575   # refresh only these
  python3 tools/cache_osdr.py --add OSD-123   # also add a study (no signal mapping until you add one)
  python3 tools/cache_osdr.py --validate      # offline: check the cache, touch nothing
  python3 tools/cache_osdr.py --dry-run       # fetch + report, write nothing

Source: NASA OSDR Biological Data API v2, one request per study:
  https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-569/
  -> {"OSD-569": {"metadata": {"study title", "organism", "study public release date" (unix),
                               "mission": {...}, "study description", ...}}}
The app itself never calls the network: it reads only this cache. A failed fetch keeps the old
record and exits non-zero, so a flaky connection can never blank a citation. Signal -> study
`mappings` are hand-curated context pointers and are never changed by this tool.
Only OSDR records are refreshed here (NTRS and journal records keep their stored text).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

CACHE = ROOT / "backend" / "astra" / "data" / "evidence_cache.json"
API = "https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/{id}/"
STATUS = "fetched from the NASA OSDR Biological Data API"

Fetcher = Callable[[str], dict]


def fetch_json(url: str, timeout: float = 20.0) -> dict:
    if not url.startswith("https://visualization.osdr.nasa.gov/"):
        raise ValueError("refusing to fetch outside visualization.osdr.nasa.gov")
    req = urllib.request.Request(url, headers={"User-Agent": "astra-vigil-cache/2.0 (simulation project)",
                                               "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _mission_text(m) -> str:
    if isinstance(m, str):
        return m.strip()
    if isinstance(m, dict):
        name = next((str(m[k]).strip() for k in ("name", "Name", "identifier", "id", "mission name") if m.get(k)), "")
        start = str(m.get("start_date") or m.get("start date") or m.get("Start Date") or "").strip()
        end = str(m.get("end_date") or m.get("end date") or m.get("End Date") or "").strip()
        span = f" ({start} to {end})" if start and end else ""
        return (name + span).strip()
    return ""


def parse_dataset(osd_id: str, payload: dict) -> dict:
    """Pull the fields we cache out of one API response. Raises ValueError if the shape is wrong."""
    body = payload.get(osd_id)
    if not isinstance(body, dict) or not isinstance(body.get("metadata"), dict):
        raise ValueError(f"unexpected response shape for {osd_id}")
    md = body["metadata"]
    title = str(md.get("study title") or "").strip()
    if not title:
        raise ValueError(f"{osd_id}: response has no study title")
    out = {"title": title}
    if md.get("organism"):
        out["organism"] = str(md["organism"]).strip()
    rel = md.get("study public release date")
    if isinstance(rel, (int, float)):
        out["release_date"] = dt.datetime.fromtimestamp(rel, dt.timezone.utc).strftime("%Y-%m-%d")
    elif isinstance(rel, str) and rel.strip():
        out["release_date"] = rel.strip()[:10]
    mission = _mission_text(md.get("mission"))
    if mission:
        out["mission"] = mission
    desc = str(md.get("study description") or "").strip()
    if desc:
        out["description"] = desc[:600]
    return out


def refresh(cache: dict, ids: Optional[List[str]], add: List[str], fetcher: Fetcher,
            today: Optional[str] = None) -> Tuple[dict, List[Tuple[str, str]], List[str]]:
    """Return (new_cache, failures[(id, why)], updated_ids). Never drops or blanks a record."""
    today = today or dt.date.today().isoformat()
    new = json.loads(json.dumps(cache))
    by_id: Dict[str, dict] = {r["id"]: r for r in new["records"]}
    targets = ids if ids else [r["id"] for r in new["records"] if r.get("kind") == "OSDR"]
    for a in add:
        if a not in by_id:
            rec = {"id": a, "kind": "OSDR", "title": "", "url": API.format(id=a), "summary": "", "retrieved": ""}
            new["records"].append(rec)
            by_id[a] = rec
        targets.append(a)
    failures: List[Tuple[str, str]] = []
    updated: List[str] = []
    for osd in dict.fromkeys(targets):
        rec = by_id.get(osd)
        if rec is None or rec.get("kind") != "OSDR":
            failures.append((osd, "not an OSDR record in the cache"))
            continue
        try:
            got = parse_dataset(osd, fetcher(API.format(id=osd)))
        except Exception as e:
            failures.append((osd, f"{type(e).__name__}: {e}"))
            if not rec.get("title"):                     # a brand-new record that never fetched: drop it
                new["records"].remove(rec)
            continue
        description = got.pop("description", "")
        rec.update(got)
        if description and not rec.get("summary"):
            rec["summary"] = description[:240]
        rec.update(retrieved=today, status=STATUS, url=API.format(id=osd))
        updated.append(osd)
    if updated:
        new["meta"]["retrieved"] = today
    return new, failures, updated


def main(argv=None, fetcher: Fetcher = fetch_json) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, default=CACHE)
    ap.add_argument("--ids", nargs="*", help="refresh only these OSD ids")
    ap.add_argument("--add", nargs="*", default=[], help="fetch and add these OSD ids")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--validate", action="store_true", help="offline check of the cache only")
    a = ap.parse_args(argv)

    from astra.evidence import Evidence
    if a.validate:
        problems = Evidence(a.cache).validate()
        print("cache OK" if not problems else "\n".join(problems))
        return 1 if problems else 0

    cache = json.loads(a.cache.read_text(encoding="utf-8"))
    new, failures, updated = refresh(cache, a.ids, a.add, fetcher)
    for osd in updated:
        print(f"updated  {osd}")
    for osd, why in failures:
        print(f"FAILED   {osd}: {why}", file=sys.stderr)
    if updated and not a.dry_run:
        tmp = a.cache.with_suffix(".tmp")
        tmp.write_text(json.dumps(new, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(a.cache)
        problems = Evidence(a.cache).validate()
        if problems:
            print("cache written but fails validation:\n" + "\n".join(problems), file=sys.stderr)
            return 2
        print(f"wrote {a.cache} ({len(updated)} updated)")
    elif not updated:
        print("nothing updated; cache left untouched")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
