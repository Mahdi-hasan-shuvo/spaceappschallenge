"""Privacy projector: who may see what.

Tier 0  the crew member's own numbers (values, baseline, alerts, explanations)
Tier 1  trend direction only, for the medical designee, and only with consent
Tier 2  a short status word - the only thing that can leave for Earth

Roles: crew, medical, commander, ground. Everything is decided here so the
rest of the code cannot forget a rule.
"""
from __future__ import annotations

from typing import Dict, List, Optional

ROLES = ("crew", "medical", "commander", "ground")


def tier_for(role: str, viewer_id: Optional[str], subject_id: str, consented: bool) -> int:
    """Return the most detailed tier `role` may see for `subject_id`.
    0 = raw (own data), 1 = trend, 2 = status word only, -1 = nothing."""
    if role == "crew":
        return 0 if viewer_id == subject_id else 2
    if role == "medical":
        return 1 if consented else 2
    if role in ("commander", "ground"):
        return 2
    return -1


def project_crew_list(role: str, viewer_id: Optional[str], crew: List[dict],
                      consents: Dict[str, Dict[str, bool]]) -> List[dict]:
    out = []
    for c in crew:
        t = tier_for(role, viewer_id, c["id"], consents.get(c["id"], {}).get(role, False))
        item = {"id": c["id"], "callsign": c["callsign"], "title": c["title"],
                "status": c["status"], "level": c["level"], "tier": t}
        out.append(item)
    return out


def may_see_series(role: str, viewer_id: Optional[str], subject_id: str) -> bool:
    return tier_for(role, viewer_id, subject_id, False) == 0


def may_see_trend(role: str, viewer_id: Optional[str], subject_id: str, consented: bool) -> bool:
    return 0 <= tier_for(role, viewer_id, subject_id, consented) <= 1


def project_alert(alert: dict, tier: int) -> Optional[dict]:
    """Tier 0 gets the full alert. Tier 1 gets rule family + signals, no numbers.
    Tier 2 gets nothing here (status word travels through the outbox)."""
    if tier == 0:
        return alert
    if tier == 1:
        return {"id": alert["id"], "crew_id": alert["crew_id"], "day": alert["day"],
                "signals": alert["signals"], "simulated": alert.get("simulated", True),
                "rule_family": "multi_signal" if alert["rule"] == "multi_signal_deviation" else "single_signal"}
    return None
