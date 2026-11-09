"""Evidence mapper: signal -> cached NASA records (direct or adjacent).

Reads the offline cache only. A mapping is a context pointer, NOT proof that a
detection rule is medically meaningful - the UI says so.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from compute.detect import SIGNALS

DATA = Path(__file__).parent / "data"
_RANK = {"direct": 0, "adjacent": 1}


class Evidence:
    def __init__(self, path: Path | None = None):
        d = json.loads((path or DATA / "evidence_cache.json").read_text(encoding="utf-8"))
        self.meta: dict = d["meta"]
        self.records: Dict[str, dict] = {r["id"]: r for r in d["records"]}
        self.mappings: Dict[str, List[dict]] = d["mappings"]

    REQUIRED = ("id", "kind", "title", "url", "retrieved")

    def validate(self) -> List[str]:
        """Problems that would make a citation unsafe to show (empty list = cache is sound)."""
        bad: List[str] = []
        if not self.meta.get("retrieved"):
            bad.append("meta.retrieved missing")
        for rid, r in self.records.items():
            for k in self.REQUIRED:
                if not r.get(k):
                    bad.append(f"{rid}: missing {k}")
            if not str(r.get("url", "")).startswith("https://"):
                bad.append(f"{rid}: url must be https")
            if r.get("kind") == "OSDR" and not (rid.startswith("OSD-") and rid in r.get("url", "")):
                bad.append(f"{rid}: OSDR id must match its url")
        for key, maps in self.mappings.items():
            sig, _, direction = key.partition(":")
            if sig not in SIGNALS or SIGNALS[sig]["direction"] != direction:
                bad.append(f"mapping {key}: not a known signal:direction")
            for m in maps:
                if m["id"] not in self.records:
                    bad.append(f"mapping {key}: unknown record {m['id']}")
                if m.get("relevance") not in _RANK:
                    bad.append(f"mapping {key}/{m['id']}: relevance must be direct or adjacent")
        for sig, meta in SIGNALS.items():
            if f"{sig}:{meta['direction']}" not in self.mappings:
                bad.append(f"signal {sig} has no mapping entry")
        return bad

    @staticmethod
    def key(signal: str) -> str:
        return f"{signal}:{SIGNALS[signal]['direction']}"

    def for_signal(self, signal: str) -> List[dict]:
        out = []
        for m in self.mappings.get(self.key(signal), []):
            rec = self.records.get(m["id"])
            if rec:
                out.append(self._card(rec, m["relevance"], signal))
        return out

    def for_alert(self, alert: dict, limit: int = 8) -> List[dict]:
        best: Dict[str, dict] = {}
        for s in alert["signals"]:
            for c in self.for_signal(s):
                old = best.get(c["id"])
                if old is None or _RANK[c["relevance"]] < _RANK[old["relevance"]]:
                    best[c["id"]] = c
                elif old is not None and s not in old["signals"]:
                    old["signals"].append(s)
        cards = sorted(best.values(), key=lambda c: (_RANK[c["relevance"]], c["id"]))
        return cards[:limit]

    def catalog(self) -> dict:
        return {"meta": self.meta, "records": list(self.records.values()),
                "mappings": self.mappings}

    @staticmethod
    def _card(rec: dict, relevance: str, signal: str) -> dict:
        return {"id": rec["id"], "kind": rec["kind"], "title": rec["title"],
                "url": rec["url"], "summary": rec.get("summary", ""),
                "mission": rec.get("mission", ""), "release_date": rec.get("release_date", ""),
                "retrieved": rec.get("retrieved", ""), "relevance": relevance,
                "signals": [signal]}
