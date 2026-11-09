"""Explanation agent: whitelisted input, system prompt, and a post-check that blocks bad output.
A stub model stands in for the LLM, so these tests need no network and no model."""
import json

import pytest

from astra import agent as A
from astra.engine import Mission, load_fixture
from astra import config
from astra.evidence import Evidence
from compute.detect import Config
from compute.guard import violates


@pytest.fixture(scope="module")
def alert_and_cards():
    ev = Evidence()
    m = Mission(load_fixture(config.FIXTURES / "vitals.json"), Config(), explain=A.explain, evidence=ev.for_alert)
    m.reset_to(252)
    a = next(x for x in m.crew["niloy"].alerts if x["rule"] == "hrv_below_personal_baseline" and x["day"] == 251)
    return a, a["evidence"]


def stub(text, cites=None, raw=None):
    seen = {}

    def llm(system, user):
        seen.update(system=system, user=user)
        return raw if raw is not None else json.dumps({"text": text, "cites": cites or []})
    llm.seen = seen
    return llm


GOOD = ("HRV (RMSSD) is 4.6 SD below this crew member's own 30-day baseline on day 252, "
        "current 31.9 ms against 55.9 ms.")


def good_text(alert):
    d = alert["details"][0]
    return (f"HRV is {abs(d['z']):.1f} SD below this crew member's own {d['window_days']}-day baseline on "
            f"day {alert['day'] + 1}: current {d['current']:.1f} ms against a baseline of {d['baseline_mean']:.1f} ms.")


# ---------------------------------------------------------------- input boundary
def test_agent_input_is_a_whitelist(alert_and_cards):
    a, cards = alert_and_cards
    inp = A.build_input(a, cards)
    assert set(inp) == {"alert", "records"}
    assert set(inp["alert"]) == {"rule", "day", "signals", "simulated", "details"}
    blob = json.dumps(inp)
    for leak in ("niloy", "Niloy", "ground_truth", "explanation", "crew_id", "planted", "onset_day"):
        assert leak not in blob, leak
    assert all(set(r) <= {"id", "kind", "title", "url", "summary", "relevance"} for r in inp["records"])
    assert all(r["url"].startswith("https://") for r in inp["records"])


def test_model_receives_system_prompt_and_only_the_whitelisted_json(alert_and_cards):
    a, cards = alert_and_cards
    llm = stub(good_text(a), [cards[0]["id"]])
    A.ExplanationAgent(llm).explain(a, cards)
    assert llm.seen["system"] == A.SYSTEM_PROMPT
    assert json.loads(llm.seen["user"]) == A.build_input(a, cards)


def test_system_prompt_states_the_hard_rules():
    p = A.SYSTEM_PROMPT.lower()
    for must in ("never give a diagnosis", "recommend", "only numbers that appear", "cite", "simulated",
                 "do not decide", "json only"):
        assert must in p, must


def test_an_osdr_record_is_always_offered_when_the_cache_has_one(alert_and_cards):
    a, cards = alert_and_cards
    inp = A.build_input(a, cards, max_cards=2)
    assert any(r["id"].startswith("OSD-") for r in inp["records"])


# ---------------------------------------------------------------- accepted path
def test_valid_answer_is_accepted_and_citations_are_attached_by_code(alert_and_cards):
    a, cards = alert_and_cards
    cid = cards[0]["id"]
    out = A.ExplanationAgent(stub(good_text(a), [cid])).explain(a, cards)
    assert out["source"] == "llm+post-check" and out["blocked"] == []
    assert out["cites"][0]["id"] == cid and out["cites"][0]["url"] == cards[0]["url"]
    assert cards[0]["url"] in out["text"] and cid in out["text"]          # id + URL are in the shown text
    assert out["text"].endswith("No diagnosis is made.")
    assert not violates(out["text"])


# ---------------------------------------------------------------- rejected path
BAD = [
    ("diagnosis", "You have a sleep disorder; HRV is low.", "diagnostic"),
    ("cause", "HRV is lower, probably caused by stress.", "interpretation"),
    ("advice", "HRV is down. You should rest and drink water.", "interpretation"),
    ("prediction", "HRV is down and likely to fall further.", "interpretation"),
    ("alarm", "HRV is dangerously low.", "interpretation"),
    ("treatment", "Consider treatment for HRV.", "diagnostic"),
]


@pytest.mark.parametrize("name,text,why", BAD, ids=[b[0] for b in BAD])
def test_diagnostic_or_interpretive_text_is_blocked_and_template_used(alert_and_cards, name, text, why):
    a, cards = alert_and_cards
    out = A.ExplanationAgent(stub(text, [cards[0]["id"]])).explain(a, cards)
    assert out["source"] == "template" and out["blocked"]
    assert any(why in w for w in out["blocked"]), out["blocked"]
    assert text not in out["text"] and not violates(out["text"])


def test_invented_number_is_blocked(alert_and_cards):
    a, cards = alert_and_cards
    t = good_text(a).replace("current", "current 99.9 and")
    out = A.ExplanationAgent(stub(t, [cards[0]["id"]])).explain(a, cards)
    assert out["source"] == "template" and any("number" in w for w in out["blocked"])


def test_invented_study_id_or_url_is_blocked(alert_and_cards):
    a, cards = alert_and_cards
    for extra in (" See OSD-999.", " See https://example.org/paper.", " See NTRS-12345678."):
        out = A.ExplanationAgent(stub(good_text(a) + extra, [cards[0]["id"]])).explain(a, cards)
        assert out["source"] == "template", extra
        assert any("not in the supplied records" in w for w in out["blocked"]), extra


def test_missing_or_fake_citation_is_blocked(alert_and_cards):
    a, cards = alert_and_cards
    for cites in ([], ["OSD-999"], [cards[0]["id"], "OSD-999"]):
        out = A.ExplanationAgent(stub(good_text(a), cites)).explain(a, cards)
        assert out["source"] == "template", cites
        assert any("citation" in w or "cited" in w for w in out["blocked"]), cites


@pytest.mark.parametrize("raw", ["not json", "{}", '{"text": 5}', '{"text": "", "cites": []}', "[]"])
def test_malformed_or_empty_model_output_falls_back(alert_and_cards, raw):
    a, cards = alert_and_cards
    out = A.ExplanationAgent(stub("", raw=raw)).explain(a, cards)
    assert out["source"] == "template" and out["blocked"]


def test_model_crash_falls_back_to_template(alert_and_cards):
    a, cards = alert_and_cards

    def boom(system, user):
        raise TimeoutError("ollama down")
    out = A.ExplanationAgent(boom).explain(a, cards)
    assert out["source"] == "template" and "TimeoutError" in out["blocked"][0]


def test_overlong_answer_is_blocked(alert_and_cards):
    a, cards = alert_and_cards
    out = A.ExplanationAgent(stub(good_text(a) + " HRV." * 200, [cards[0]["id"]])).explain(a, cards)
    assert out["source"] == "template" and "too long" in out["blocked"]


# ---------------------------------------------------------------- template mode (no model)
def test_template_mode_cites_a_study_id_and_url_and_never_diagnoses(alert_and_cards):
    a, cards = alert_and_cards
    out = A.ExplanationAgent(None).explain(a, cards)
    assert out["source"] == "template" and out["cites"]
    for c in out["cites"]:
        assert c["id"] in out["text"] and c["url"] in out["text"]
        assert c["url"].startswith("https://")
    assert any(c["id"].startswith("OSD-") for c in out["cites"])
    assert "No diagnosis is made" in out["text"] and "SD" in out["text"]
    assert not violates(out["text"]) and not violates(out["text_bn"])


def test_template_with_no_cached_record_says_so_and_still_has_no_diagnosis(alert_and_cards):
    a, _ = alert_and_cards
    out = A.ExplanationAgent(None).explain(a, [])
    assert "No cached NASA record" in out["text"] and out["cites"] == []


def test_every_real_alert_in_the_fixture_gets_a_guard_clean_cited_explanation():
    ev = Evidence()
    m = Mission(load_fixture(config.FIXTURES / "vitals.json"), Config(), explain=A.explain, evidence=ev.for_alert)
    m.reset_to(599)
    n = 0
    for cs in m.crew.values():
        for al in cs.alerts:
            n += 1
            assert not violates(al["explanation"]) and not violates(al["explanation_bn"])
            assert al["citations"] and al["citations"][0]["url"].startswith("https://"), al["rule"]
    assert n > 20


def test_post_check_unit_accepts_exactly_the_alert_numbers(alert_and_cards):
    a, cards = alert_and_cards
    inp = A.build_input(a, cards)
    assert A.post_check(good_text(a), [cards[0]["id"]], inp) == []
    assert A.post_check("HRV fell 12.3 SD.", [cards[0]["id"]], inp)
