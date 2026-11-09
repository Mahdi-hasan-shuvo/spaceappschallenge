"""Offline assistant: explains what the detection rules found. Nothing else.

It never sees free text from a language model about medicine. It receives only
tool results (the alert object, baseline numbers, cached NASA records) and fills
fixed templates, in English or Bangla. Every sentence is passed through the
diagnostic-language guard. Alert explanations come from agent.py (system prompt +
post-check, template fallback), so everything works with no model and no network.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from compute.detect import SIGNALS, Config
from compute.guard import safe_text, violates

LABEL_BN = {
    "hr": "বিশ্রামকালীন হৃদস্পন্দন", "hrv": "HRV (হৃদস্পন্দনের পরিবর্তনশীলতা)",
    "spo2": "SpO2 (রক্তের অক্সিজেন)", "sleep_h": "ঘুমের সময়",
    "core_temp": "দেহের মূল তাপমাত্রা", "exercise_min": "ব্যায়াম",
}
STATUS_EN = {
    "learning": "learning (not enough days yet to know this person's normal)",
    "normal": "normal (inside this person's own range)",
    "watch": "watch (one signal is past its threshold; waiting to see if it repeats)",
    "alert": "alert (a detection rule fired; held for 3 days)",
}
STATUS_BN = {
    "learning": "শেখার ধাপে (এই ব্যক্তির স্বাভাবিক অবস্থা জানতে যথেষ্ট দিন হয়নি)",
    "normal": "স্বাভাবিক (নিজের সীমার ভেতরে)",
    "watch": "নজরে (একটি সিগন্যাল সীমা পার করেছে; আবার হয় কিনা দেখা হচ্ছে)",
    "alert": "অ্যালার্ট (একটি নিয়ম জ্বলেছে; ৩ দিন ধরে রাখা হয়)",
}
BOUNDARY_EN = ("I only report what the detection rules found and which NASA records are "
               "linked to it. I can't say what a change means for health or suggest any "
               "action. Please talk to your flight surgeon or medical designee.")
BOUNDARY_BN = ("আমি শুধু বলতে পারি ডিটেকশন নিয়মে কী ধরা পড়েছে এবং কোন NASA রেকর্ড এর সঙ্গে যুক্ত। "
               "স্বাস্থ্যের দিক থেকে এর অর্থ কী বা কী করা উচিত, তা আমি বলতে পারি না। "
               "অনুগ্রহ করে আপনার ফ্লাইট সার্জন বা মেডিকেল ডেজিগনিকে জিজ্ঞেস করুন।")

SUGGESTED = {
    "en": ["What changed?", "Which rule fired?", "Show the numbers", "Which NASA studies support this?",
           "Who can see my data?", "Is this real data?"],
    "bn": ["কী বদলেছে?", "কোন নিয়ম জ্বলেছে?", "সংখ্যাগুলো দেখাও", "কোন NASA গবেষণা এর সঙ্গে যুক্ত?",
           "আমার ডেটা কে দেখতে পারে?", "এটা কি আসল ডেটা?"],
}

SIGNAL_WORDS = {
    "hrv": ["hrv", "variab", "rmssd", "হৃদস্পন্দনের পরিবর্তন"],
    "hr": ["heart rate", "pulse", "bpm", "হৃদস্পন্দন", "পালস"],
    "spo2": ["spo2", "oxygen", "অক্সিজেন"],
    "sleep_h": ["sleep", "ঘুম"],
    "core_temp": ["temperature", "temp", "তাপ"],
    "exercise_min": ["exercise", "workout", "ব্যায়াম"],
}

INTENT_WORDS = {
    "boundary": ["diagnos", "disease", "sick", "ill", "treat", "medicine", "medic", "cure", "doctor",
                 "serious", "dangerous", "should i", "what do i do", "what should", "advice", "stress",
                 "tired", "fatigue", "রোগ", "চিকিৎসা", "ওষুধ", "অসুস্থ", "ডাক্তার", "বিপজ্জনক",
                 "কী করব", "কি করব", "পরামর্শ", "চাপ", "ক্লান্ত"],
    "privacy": ["who can see", "privacy", "consent", "share", "earth see", "কে দেখ", "গোপনীয়", "সম্মতি"],
    "simulated": ["real data", "simulat", "fake", "real or", "আসল", "সিমুলেট", "কৃত্রিম", "নকল"],
    "rule": ["which rule", "rule", "threshold", "how do you detect", "how detect", "নিয়ম", "কীভাবে ধর"],
    "evidence": ["nasa", "study", "studies", "evidence", "paper", "research", "osdr", "ntrs", "source",
                 "প্রমাণ", "গবেষণা", "স্টাডি", "সূত্র"],
    "numbers": ["number", "baseline", "value", "z-score", "z score", "sd", "how much", "সংখ্যা", "বেসলাইন",
                "মান", "কত"],
    "changed": ["what changed", "changed", "what happened", "alert", "flag", "anomal", "deviat", "why",
                "কী বদল", "কি বদল", "বদলে", "সতর্ক", "অ্যালার্ট", "কেন", "কী হয়েছে", "কি হয়েছে"],
    "status": ["status", "how am i", "how is", "normal", "অবস্থা", "স্ট্যাটাস"],
    "help": ["help", "what can you", "hello", "hi", "সাহায্য", "কী পারো", "হ্যালো", "নমস্কার"],
}


def _fmt(x: Optional[float], nd: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


def _label(s: str, lang: str) -> str:
    return LABEL_BN[s] if lang == "bn" else SIGNALS[s]["label"]


# ---------------------------------------------------------------------------
# Rule text for one alert (pure template, deterministic)
# ---------------------------------------------------------------------------
def rule_text(alert: dict, lang: str = "en") -> str:
    parts = []
    for d in alert["details"]:
        s = d["signal"]
        meta = SIGNALS[s]
        if lang == "bn":
            way = "নিচে" if d["z"] < 0 else "উপরে"
            parts.append(
                f"{LABEL_BN[s]} এই ক্রু সদস্যের নিজের {d['window_days']} দিনের বেসলাইনের চেয়ে "
                f"{abs(d['z']):.1f} SD {way} (এখন {d['current']:.1f} {meta['unit']}, "
                f"বেসলাইন {d['baseline_mean']:.1f} ± {d['baseline_sd']:.1f})।")
        else:
            way = "below" if d["z"] < 0 else "above"
            parts.append(
                f"{meta['label']} is {abs(d['z']):.1f} SD {way} this crew member's own "
                f"{d['window_days']}-day baseline (current {d['current']:.1f} {meta['unit']}, "
                f"baseline {d['baseline_mean']:.1f} +/- {d['baseline_sd']:.1f}).")
    if lang == "bn":
        return " ".join(parts) + f" যে নিয়ম জ্বলেছে: {alert['rule']}। কোনো রোগ নির্ণয় করা হয় না।"
    return " ".join(parts) + f" Rule fired: {alert['rule']}. No diagnosis is made."


def explain_alert(alert: dict, cards: Optional[List[dict]] = None) -> dict:
    """Compatibility wrapper: the explanation agent (agent.py) does the work."""
    from .agent import explain          # late import: agent.py imports rule_text from here
    return explain(alert, cards)


def validate_reword(original: str, candidate: str) -> Optional[str]:
    """Accept a reworded text only if it adds no number and no diagnostic word."""
    if not candidate or violates(candidate):
        return None
    if not set(_NUM.findall(candidate)) <= set(_NUM.findall(original)):
        return None
    return candidate


_NUM = re.compile(r"\d+(?:\.\d+)?")


# ---------------------------------------------------------------------------
# Question answering over tool results
# ---------------------------------------------------------------------------
def _score(q: str, words: List[str]) -> int:
    return sum(1 for w in words if w in q)


def classify(question: str) -> str:
    q = question.lower()
    # the boundary check comes first: a medical question never gets a clinical answer
    if _score(q, INTENT_WORDS["boundary"]) and not _score(q, ["which rule", "what changed"]):
        return "boundary"
    order = ["privacy", "simulated", "rule", "evidence", "numbers", "changed", "status", "help"]
    best, best_s = "unknown", 0
    for name in order:
        sc = _score(q, INTENT_WORDS[name])
        if sc > best_s:
            best, best_s = name, sc
    return best


def mentioned_signal(question: str) -> Optional[str]:
    q = question.lower()
    # check the more specific words first (hrv before the generic heart-rate words)
    for s in ("hrv", "spo2", "sleep_h", "core_temp", "exercise_min", "hr"):
        if any(w in q for w in SIGNAL_WORDS[s]):
            return s
    return None


def ask(question: str, ctx: dict, lang: str = "en") -> dict:
    """Answer from tool results only. `ctx` is built by the server (see server.py)."""
    lang = "bn" if lang == "bn" else "en"
    intent = classify(question)
    tools: List[str] = []
    cites: List[str] = []
    boundary = False
    cfg: Config = ctx["cfg"]
    alerts: List[dict] = ctx.get("alerts", [])
    latest = alerts[-1] if alerts else None
    name = ctx.get("callsign", "")
    bn = lang == "bn"

    if intent == "boundary":
        boundary = True
        text = BOUNDARY_BN if bn else BOUNDARY_EN
    elif ctx.get("tier", 0) != 0 and intent in ("changed", "rule", "numbers", "evidence", "status"):
        # Not this person's own data: only the tier-2 status word may be shown.
        tools.append("get_status")
        st = (STATUS_BN if bn else STATUS_EN).get(ctx["status"], ctx["status"])
        text = (f"আপনার অ্যাক্সেস স্তরে আমি শুধু স্ট্যাটাস শব্দ দেখাতে পারি: {name} — {st}।" if bn else
                f"At your access level I can only show the status word: {name} - {st}.")
    elif intent == "help" or intent == "unknown":
        text = ("আমি একটি অফলাইন সহকারী। আমি শুধু বলতে পারি: কী বদলেছে, কোন নিয়ম জ্বলেছে, সংখ্যাগুলো কী, "
                "কোন NASA রেকর্ড যুক্ত এবং কে কী দেখতে পারে। আমি কিছু নির্ণয় করি না।" if bn else
                "I am an offline assistant. I can tell you what changed, which rule fired, the numbers behind it, "
                "which cached NASA records are linked, and who can see what. I do not diagnose anything.")
        if intent == "unknown":
            text = ("প্রশ্নটি পুরোপুরি বুঝতে পারিনি। " if bn else "I did not fully understand that. ") + text
    elif intent == "status":
        tools.append("get_status")
        st = (STATUS_BN if bn else STATUS_EN).get(ctx["status"], ctx["status"])
        text = (f"{name}-এর অবস্থা এখন: {st}। মিশন দিন {ctx['day'] + 1}।" if bn else
                f"{name}'s status now: {st}. Mission day {ctx['day'] + 1}.")
    elif intent in ("changed", "rule", "numbers", "evidence") and latest is None and not mentioned_signal(question):
        text = ("এখনো কোনো অ্যালার্ট জ্বলেনি। ডিটেক্টর প্রতিদিন নিজের বেসলাইনের সঙ্গে তুলনা করছে।" if bn else
                "No rule has fired yet. The detector is comparing each day with this person's own baseline.")
        tools.append("get_alerts")
    elif intent == "changed":
        tools.append("get_alert")
        text = (latest["explanation_bn"] if bn and latest.get("explanation_bn") else
                latest["explanation"] or rule_text(latest, lang))
        text = (f"দিন {latest['day'] + 1}: " if bn else f"Day {latest['day'] + 1}: ") + text
    elif intent == "rule":
        tools.append("get_rules")
        if bn:
            text = (f"Rule S: একটি সিগন্যাল {cfg.single_threshold_sd} SD বা তার বেশি খারাপ হলে এবং টানা "
                    f"{cfg.single_persist} দিন থাকলে জ্বলে। Rule M: {cfg.multi_min_signals}টি বা বেশি সিগন্যাল "
                    f"{cfg.multi_threshold_sd} SD বা তার বেশি খারাপ হলে, {cfg.multi_window} দিনের মধ্যে। "
                    f"তুলনা হয় এই ব্যক্তির নিজের শেষ {cfg.baseline_days} দিনের সঙ্গে। কোনো AI মডেল এখানে সিদ্ধান্ত নেয় না।")
        else:
            text = (f"Rule S fires when one signal is {cfg.single_threshold_sd} SD or more worse than this "
                    f"person's own {cfg.baseline_days}-day baseline for {cfg.single_persist} days in a row. "
                    f"Rule M fires when {cfg.multi_min_signals} or more signals are {cfg.multi_threshold_sd} SD "
                    f"or more worse within {cfg.multi_window} days. No AI model makes this decision.")
        if latest:
            text += (f" সর্বশেষ জ্বলেছে: {latest['rule']} (দিন {latest['day'] + 1})।" if bn else
                     f" Most recent: {latest['rule']} (day {latest['day'] + 1}).")
    elif intent == "numbers":
        tools.append("get_baseline")
        s = mentioned_signal(question) or (latest["signals"][0] if latest else "hrv")
        sig = ctx["signals"].get(s)
        if not sig or sig["mu"] is None:
            text = ("এই সিগন্যালের বেসলাইন এখনো তৈরি হয়নি।" if bn else
                    "The baseline for this signal is not ready yet.")
        else:
            unit = SIGNALS[s]["unit"]
            w = sig["w"]
            side = (("খারাপের দিকে" if bn else "in the worse direction") if (w or 0) > 0 else
                    ("ভালোর দিকে" if bn else "in the better direction"))
            if bn:
                text = (f"{LABEL_BN[s]}: এখন {_fmt(sig['v'])} {unit}। বেসলাইন {_fmt(sig['mu'])} ± {_fmt(sig['sd'])} "
                        f"(শেষ {cfg.baseline_days} দিন)। নিজের স্বাভাবিকের চেয়ে {_fmt(abs(w or 0))} SD {side}।")
            else:
                text = (f"{SIGNALS[s]['label']}: now {_fmt(sig['v'])} {unit}. Baseline {_fmt(sig['mu'])} +/- "
                        f"{_fmt(sig['sd'])} (last {cfg.baseline_days} days). {_fmt(abs(w or 0))} SD {side} "
                        f"compared with this person's own normal.")
    elif intent == "evidence":
        tools += ["get_alert", "get_evidence"]
        cards = (latest or {}).get("evidence") or ctx["evidence_for"](mentioned_signal(question) or "hrv")
        cites = [c["id"] for c in cards[:4]]
        if not cards:
            text = ("এই সিগন্যালের জন্য ক্যাশে কোনো রেকর্ড নেই।" if bn else "No cached record for this signal.")
        else:
            lines = "; ".join(f"{c['id']} ({'সরাসরি' if c['relevance']=='direct' and bn else 'প্রাসঙ্গিক' if bn else c['relevance']})"
                              for c in cards[:4])
            text = (f"ক্যাশে থাকা NASA রেকর্ড: {lines}। এগুলো প্রসঙ্গ দেয়, প্রমাণ করে না যে নিয়মটি ক্লিনিক্যালি অর্থবহ।"
                    if bn else
                    f"Cached NASA records linked to this signal: {lines}. They give context. They do not prove "
                    f"that the rule is clinically meaningful.")
    elif intent == "privacy":
        tools.append("get_privacy")
        text = ("স্তর 0: শুধু ক্রু সদস্য নিজে নিজের সংখ্যা দেখেন। স্তর 1: মেডিকেল ডেজিগনি শুধু প্রবণতার দিক দেখেন, "
                "সম্মতি থাকলে। স্তর 2: শুধু একটি ছোট স্ট্যাটাস শব্দ পৃথিবীতে যেতে পারে, আলোর গতির দেরিসহ।" if bn else
                "Tier 0: only the crew member sees their own numbers. Tier 1: the medical designee sees trend "
                "direction only, with consent. Tier 2: only a short status word can go to Earth, after the "
                "light-time delay.")
    elif intent == "simulated":
        tools.append("get_meta")
        text = ("সব ডেটা সিমুলেটেড (কৃত্রিম)। টিমের নামে চারজন ডেমো ক্রু, প্রত্যেকের 600 দিন। সংখ্যাগুলো বানানো; এটি আসল মহাকাশচারীর বা কারও আসল স্বাস্থ্য-ডেটা নয়।"
                if bn else
                "All data here is SIMULATED: four demo crew members named after the team, 600 days each. The vitals are invented; they are not astronaut data or anyone's real health data.")
    else:  # pragma: no cover - classify() only returns the names above
        text = BOUNDARY_BN if bn else BOUNDARY_EN

    text = safe_text(text, BOUNDARY_BN if bn else BOUNDARY_EN)
    return {"answer": text, "intent": intent, "tools": tools, "cites": cites,
            "boundary": boundary, "lang": lang, "source": "offline-rules",
            "simulated": True}
