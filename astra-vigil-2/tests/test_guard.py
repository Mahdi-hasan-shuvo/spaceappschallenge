import pytest

from compute.guard import safe_text, violates


@pytest.mark.parametrize("t", [
    "You have a disease.", "This is a diagnosis of anemia.", "You should take 20 mg of it.",
    "I recommend you rest.", "This means you are depressed.", "Start therapy now.",
    "আপনার রোগ হয়েছে", "ওষুধ খান",
])
def test_blocks_diagnostic_language(t):
    assert violates(t)


@pytest.mark.parametrize("t", [
    "HRV (RMSSD) is 3.5 SD below this crew member's own 30-day baseline. No diagnosis is made.",
    "Rule fired: hrv_below_personal_baseline. The detector does not diagnose.",
    "কোনো রোগ নির্ণয় করা হয় না।",
])
def test_allows_plain_statements(t):
    assert not violates(t)


def test_safe_text_falls_back():
    assert safe_text("you have a syndrome", "fallback") == "fallback"
    assert safe_text("HRV is low.", "fallback") == "HRV is low."
