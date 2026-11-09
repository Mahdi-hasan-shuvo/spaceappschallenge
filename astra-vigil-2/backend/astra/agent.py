"""Explanation agent: turns ONE alert object + cached NASA records into plain words.

What it is allowed to see (everything else is stripped before the call, see `build_input`):
  - the alert object the detector produced: rule, day, signals, and the numbers behind it
  - cached NASA study/report metadata (id, kind, title, url, summary) for that alert's signals
It never sees crew names, raw series, ground-truth labels, other alerts or the user's question.

What it is allowed to say: what deviated, by how much, when, and which cached record is linked.
It must NOT diagnose, interpret, predict or recommend. That is enforced twice:
  1. SYSTEM_PROMPT (asks the model not to), and
  2. `post_check` (code that rejects the model's answer if it breaks the rules).
Anything rejected is replaced by a deterministic template, so the console never shows an
unchecked sentence. With no model configured the template IS the agent (works fully offline).

Citations are never taken from model text: study ids and URLs are re-attached by code from
the cache, so a model cannot invent a source.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Callable, Dict, List, Optional, Tuple

from compute.guard import violates

from .assistant import LABEL_BN, rule_text

SYSTEM_PROMPT = """You are the explanation layer of a crew health MONITORING console. All data is SIMULATED.
A deterministic rule in code already decided that something deviated. You do not decide, detect or judge.

You receive ONE JSON object: {"alert": ..., "records": [...]}. Use only what is in it.

Do:
- Say which signal moved, in which direction, by how many SD, against which personal baseline window.
- Use only numbers that appear in the alert object, written the way they appear.
- Cite at least one record by its exact "id" from "records". You may only cite ids present in "records".

Never:
- Never give a diagnosis, a probable cause, a prognosis, a risk estimate or a "this means".
- Never recommend or hint at any action, treatment, medication, rest, or contacting anyone.
- Never invent a study, an id, a URL, a number, or a finding. Do not describe what a record "shows".
- Never use alarming or reassuring words (serious, dangerous, healthy, normal for...).

Reply with JSON only: {"text": "<at most 2 sentences>", "cites": ["<record id>", ...]}.
If you cannot comply, reply {"text": "", "cites": []}."""

MAX_TEXT = 420

# Beyond the shared diagnostic guard: words that interpret, explain causes, predict or advise.
INTERPRETIVE = re.compile(
    r"\b(should|must|need to|recommend\w*|advis\w*|suggest\w*|likely|unlikely|probabl\w*|possibl\w*|"
    r"indicat\w*|implies|implie\w*|caus\w*|because|due to|result\w* (in|from)|sign of|symptom\w*|"
    r"risk\w*|danger\w*|serious\w*|severe|concern\w*|worr\w*|alarm\w*|healthy|unhealthy|"
    r"abnormal|condition|illness|sick|fatigue\w*|stress\w*|dehydrat\w*|inflammat\w*|"
    r"infect\w*|consult|seek|monitor closely|rest|hydrate|contact|doctor|physician|surgeon)\b",
    re.IGNORECASE)
_ID = re.compile(r"\b(OSD-\d+|NTRS-\d+|PMC\d+|DOI-[^\s,;)\]]+)", re.IGNORECASE)
_URL = re.compile(r"https?://[^\s)\]\"']+", re.IGNORECASE)
_NUM = re.compile(r"\d+(?:\.\d+)?")

LLM = Callable[[str, str], str]


# --------------------------------------------------------------------------- input
def select_cards(cards: List[dict], k: int) -> List[dict]:
    """Top-ranked cards, but always keep one OSDR dataset if the cache links one: the console's
    promise is 'which OSDR study is behind this', so it should not be cut by a tie-break."""
    chosen = list(cards[:k])
    if k and not any(c.get("kind") == "OSDR" for c in chosen):
        osdr = next((c for c in cards if c.get("kind") == "OSDR"), None)
        if osdr:
            chosen = chosen[: k - 1] + [osdr]
    return chosen


def build_input(alert: dict, cards: List[dict], max_cards: int = 4) -> dict:
    """The ONLY thing a model ever receives. Whitelist, not blacklist."""
    details = []
    for d in alert.get("details", []):
        details.append({k: d[k] for k in ("signal", "current", "baseline_mean", "baseline_sd", "z",
                                          "threshold_sd", "window_days", "baseline_n",
                                          "consecutive_days", "row_unit") if k in d})
    return {
        "alert": {"rule": alert["rule"], "day": alert["day"] + 1, "signals": list(alert["signals"]),
                  "simulated": True, "details": details},
        "records": [{k: c.get(k, "") for k in ("id", "kind", "title", "url", "summary", "relevance")}
                    for c in select_cards(cards, max_cards)],
    }


# --------------------------------------------------------------------------- post-check
def _fmt_variants(v: float) -> set:
    out = {f"{v:.{n}f}" for n in (0, 1, 2, 3)} | {f"{abs(v):.{n}f}" for n in (0, 1, 2, 3)}
    if float(v).is_integer():
        out.add(str(int(v)))
        out.add(str(abs(int(v))))
    return out


def allowed_numbers(inp: dict) -> set:
    nums = set()
    a = inp["alert"]
    nums |= _fmt_variants(float(a["day"]))
    for d in a["details"]:
        for k, v in d.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                nums |= _fmt_variants(float(v))
    return nums


def post_check(text: str, cites: List[str], inp: dict) -> List[str]:
    """Return the list of reasons to REJECT the model output (empty list = accepted)."""
    why: List[str] = []
    if not isinstance(text, str) or not text.strip():
        return ["empty answer"]
    if len(text) > MAX_TEXT:
        why.append("too long")
    if violates(text):
        why.append("diagnostic or treatment language")
    if INTERPRETIVE.search(text):
        why.append("interpretation, cause, prediction or advice")
    ids_ok = {r["id"].lower() for r in inp["records"]}
    urls_ok = {r["url"].rstrip("/").lower() for r in inp["records"] if r.get("url")}
    for m in _ID.findall(text):
        if m.rstrip(".").lower() not in ids_ok:
            why.append(f"record id not in the supplied records: {m}")
    for m in _URL.findall(text):
        if m.rstrip(".,").rstrip("/").lower() not in urls_ok:
            why.append(f"URL not in the supplied records: {m}")
    bare = _URL.sub(" ", _ID.sub(" ", text))
    extra = set(_NUM.findall(bare)) - allowed_numbers(inp)
    if extra:
        why.append(f"number not in the alert object: {sorted(extra)[:3]}")
    cited = [c for c in (cites or []) if isinstance(c, str)]
    if inp["records"] and not any(c.lower() in ids_ok for c in cited):
        why.append("no valid citation")
    if any(c.lower() not in ids_ok for c in cited):
        why.append("cited an id that was not supplied")
    return why


# --------------------------------------------------------------------------- citations
def _cite_en(cards: List[dict]) -> str:
    if not cards:
        return "No cached NASA record is linked to this signal."
    parts = []
    for c in cards:
        title = f" - {c['title']}" if c.get("title") and not violates(c["title"]) else ""
        parts.append(f"{c['id']}{title} ({c['url']})")
    return "Cached NASA context (a pointer, not proof the rule is clinically meaningful): " + "; ".join(parts) + "."


def _cite_bn(cards: List[dict]) -> str:
    if not cards:
        return "এই সিগন্যালের সঙ্গে ক্যাশে থাকা কোনো NASA রেকর্ড যুক্ত নেই।"
    return ("ক্যাশে থাকা NASA প্রসঙ্গ (শুধু সূত্র, এটি প্রমাণ করে না যে নিয়মটি ক্লিনিক্যালি অর্থবহ): "
            + "; ".join(f"{c['id']} ({c['url']})" for c in cards) + "।")


def _card_ref(c: dict) -> dict:
    return {"id": c["id"], "url": c["url"], "title": c.get("title", ""), "kind": c.get("kind", "")}


# --------------------------------------------------------------------------- agent
class ExplanationAgent:
    def __init__(self, llm: Optional[LLM] = None, max_cards: int = 4):
        self.llm = llm
        self.max_cards = max_cards

    def explain(self, alert: dict, cards: Optional[List[dict]] = None) -> dict:
        cards = select_cards(list(cards or []), self.max_cards)
        inp = build_input(alert, cards, self.max_cards)
        en_rule, bn_rule = rule_text(alert, "en"), rule_text(alert, "bn")
        shown = select_cards(cards, 2)          # keep the on-card line short; the drawer lists all
        template_en = f"{en_rule} {_cite_en(shown)}"
        template_bn = f"{bn_rule} {_cite_bn(shown)}"
        res = {"text": template_en, "text_bn": template_bn, "source": "template",
               "cites": [_card_ref(c) for c in shown], "blocked": [], "agent_input": inp}
        if self.llm is None:
            return res
        try:
            raw = self.llm(SYSTEM_PROMPT, json.dumps(inp, ensure_ascii=False))
            obj = json.loads(raw)
            text, cites = str(obj.get("text", "")).strip(), obj.get("cites", [])
        except Exception as e:                  # model down, bad JSON, timeout -> template
            res["blocked"] = [f"model unavailable or malformed: {type(e).__name__}"]
            return res
        why = post_check(text, cites, inp)
        if why:
            res["blocked"] = why                # shown in the audit trail; never shown as advice
            return res
        by_id = {c["id"].lower(): c for c in cards}
        used = [by_id[c.lower()] for c in dict.fromkeys(cites) if c.lower() in by_id]
        res.update(text=f"{text} {_cite_en(used)} No diagnosis is made.",
                   text_bn=f"{bn_rule} {_cite_bn(used)}",
                   source="llm+post-check", cites=[_card_ref(c) for c in used])
        return res


# --------------------------------------------------------------------------- local model
def ollama_llm(model: Optional[str] = None, url: Optional[str] = None, timeout: float = 6.0) -> Optional[LLM]:
    """A local Ollama model, if configured. Returns None otherwise (template mode)."""
    model = model or os.environ.get("ASTRA_OLLAMA_MODEL")
    if not model:
        return None
    url = url or os.environ.get("ASTRA_OLLAMA_URL", "http://127.0.0.1:11434/api/chat")

    def call(system: str, user: str) -> str:
        body = {"model": model, "stream": False, "format": "json", "options": {"temperature": 0},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:      # local host only
            return json.loads(r.read())["message"]["content"]
    return call


DEFAULT_AGENT = ExplanationAgent(ollama_llm())


def explain(alert: dict, cards: Optional[List[dict]] = None) -> dict:
    return DEFAULT_AGENT.explain(alert, cards)
