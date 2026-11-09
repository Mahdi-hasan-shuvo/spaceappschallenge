"""Diagnostic-language guard.

The guard is a safety net, not a proof. The real protection is architectural:
the assistant only ever receives tool results (the alert object, baseline numbers
and cached NASA records), never free medical knowledge.

Fixed boundary phrases such as "No diagnosis is made" are allowed because they
*deny* a diagnosis; everything else that sounds like a diagnosis or treatment
advice is blocked.
"""
from __future__ import annotations

import re

ALLOWED = re.compile(
    r"(no diagnosis is made|does not diagnose|do not diagnose|cannot diagnose|"
    r"nothing is diagnosed|not a diagnosis|"
    r"কোনো রোগ নির্ণয় করা হয় না|রোগ নির্ণয় করে না|চিকিৎসার পরামর্শ দেয় না)", re.IGNORECASE)

BLOCKED = re.compile(
    r"\b(diagnos\w*|you have|suffer\w* from|disease|disorder|syndrome|"
    r"depress\w*|infection|prescrib\w*|treat\w*|medicat\w*|therapy|"
    r"\d+\s?mg|you should take|you should rest|i recommend|cure\w*|this means you|"
    r"take (a|some) (rest|break)|see a doctor now)\b", re.IGNORECASE)

# Bangla words that would read as a diagnosis or a prescription.
BLOCKED_BN = re.compile(r"(রোগ|চিকিৎসা|ওষুধ|ঔষধ|নির্ণয় করা হয়েছে|আপনার .* হয়েছে)")


def violates(text: str) -> bool:
    cleaned = ALLOWED.sub(" ", text or "")
    return bool(BLOCKED.search(cleaned) or BLOCKED_BN.search(cleaned))


def safe_text(candidate: str, fallback: str) -> str:
    """Return the candidate unless it contains diagnostic or treatment language."""
    return fallback if violates(candidate) else candidate
