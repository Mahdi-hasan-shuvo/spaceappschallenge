import itertools

from astra.assistant import ask, explain_alert, validate_reword
from compute.guard import violates
from astra.engine import Mission, load_fixture
from astra import config
from compute.detect import SIGNALS, Config
from astra.evidence import Evidence

QUESTIONS = [
    "What changed?", "Which rule fired?", "Show the numbers", "Show HRV numbers",
    "Which NASA studies support this?", "Who can see my data?", "Is this real data?",
    "Am I sick?", "Should I rest?", "Do I have a disease?", "What medicine should I take?",
    "how stressed am i", "hello", "asdf qwer", "কী বদলেছে?", "কোন নিয়ম জ্বলেছে?",
    "আমার কি রোগ হয়েছে?", "আসল ডেটা?", "কে দেখতে পারে?", "প্রমাণ দেখাও", "status",
]


def _ctx(day, tier=0):
    ev = Evidence()
    m = Mission(load_fixture(config.FIXTURES / "vitals.json"), Config(), explain=explain_alert, evidence=ev.for_alert)
    m.reset_to(day)
    cs = m.crew["niloy"]
    rec = cs.records[-1]
    sigs = {s: {"v": rec["v"][s], "mu": rec["mu"][s], "sd": rec["sd"][s], "w": rec["w"][s]} for s in SIGNALS}
    return {"cfg": m.cfg, "alerts": cs.alerts, "callsign": "Niloy", "status": m.status_now()["niloy"],
            "day": m.day, "signals": sigs, "tier": tier, "evidence_for": ev.for_signal}


def test_every_answer_is_guard_clean():
    for day, tier in itertools.product([5, 100, 255, 402], [0, 2]):
        ctx = _ctx(day, tier)
        for q, lang in itertools.product(QUESTIONS, ["en", "bn"]):
            out = ask(q, ctx, lang)
            assert not violates(out["answer"]), (q, lang, out["answer"])
            assert out["simulated"] is True


def test_medical_questions_get_boundary_refusal():
    ctx = _ctx(255)
    for q in ["Am I sick?", "Do I have a disease?", "What should I do about this?", "আমার কি রোগ হয়েছে?"]:
        assert ask(q, ctx, "en")["boundary"], q


def test_numbers_come_from_tool_results():
    ctx = _ctx(255)
    out = ask("Show HRV numbers", ctx, "en")
    sig = ctx["signals"]["hrv"]
    assert f"{sig['mu']:.1f}" in out["answer"] and out["tools"] == ["get_baseline"]


def test_restricted_tier_gets_status_word_only():
    out = ask("Show the numbers", _ctx(255, tier=2), "en")
    assert "status word" in out["answer"]


def test_explanation_has_numbers_and_no_diagnosis():
    ctx = _ctx(255)
    ex = explain_alert(ctx["alerts"][0])
    assert "SD" in ex["text"] and "No diagnosis is made" in ex["text"]
    assert not violates(ex["text"]) and not violates(ex["text_bn"])


def test_reword_guard_rejects_new_numbers_and_diagnosis():
    orig = "HRV is 3.5 SD below baseline 55.0."
    assert validate_reword(orig, "HRV sits 3.5 SD under the 55.0 baseline.")
    assert validate_reword(orig, "HRV sits 4.5 SD under the 55.0 baseline.") is None
    assert validate_reword(orig, "You have a disorder; HRV is 3.5 SD, 55.0.") is None
