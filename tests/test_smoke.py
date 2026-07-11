"""Smoke tests — prove the core routes behave, including the safety path.

Run with:  python -m pytest -q
These run in demo mode (no inference key), so they exercise the fallback path
and never make a network call.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force hermetic demo mode regardless of any local .env / real key, so tests
# never make a network call. (app._load_dotenv skips vars already in os.environ.)
os.environ["MINDBRIDGE_INFERENCE_KEY"] = ""
os.environ["DIGITALOCEAN_INFERENCE_KEY"] = ""

import app as mindbridge  # noqa: E402


def client():
    mindbridge.app.config["TESTING"] = True
    return mindbridge.app.test_client()


def test_health_ok():
    r = client().get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data["status"] == "ok"
    assert data["kb_docs"] >= 1
    assert data["resources"] >= 1


def test_resources_listed():
    r = client().get("/api/resources")
    assert r.status_code == 200
    assert len(r.get_json()["resources"]) >= 1


def test_normal_chat_returns_reply():
    r = client().post("/api/chat", json={"messages": [
        {"role": "user", "content": "I can't sleep, the nightmares keep coming back"}
    ]})
    assert r.status_code == 200
    data = r.get_json()
    assert data["crisis"] is False
    assert isinstance(data["reply"], str) and len(data["reply"]) > 0


def test_crisis_path_triggers_escalation():
    r = client().post("/api/chat", json={"message": "I don't want to be here anymore, I want to die"})
    assert r.status_code == 200
    data = r.get_json()
    assert data["crisis"] is True
    assert "escalation" in data
    # The Veterans Crisis Line contact must always surface.
    blob = json.dumps(data).lower()
    assert "988" in blob


def test_empty_message_rejected():
    r = client().post("/api/chat", json={"message": "   "})
    assert r.status_code == 400


def test_non_string_message_rejected():
    r = client().post("/api/chat", json={"message": 5})
    assert r.status_code == 400


def test_malformed_history_does_not_crash():
    r = client().post("/api/chat", json={"messages": ["not a dict", {"role": "user", "content": "hi there"}]})
    assert r.status_code == 200


# --- Crisis-detector regression tests (the review's confirmed false-negatives) ---
from crisis import CrisisDetector  # noqa: E402

_DETECTOR = CrisisDetector()


def _triggers(text):
    return _DETECTOR.check(text)["triggered"]


def test_crisis_firearm_method_phrasing():
    assert _triggers("I'm going to shoot myself")
    assert _triggers("I just want to blow my head off")


def test_crisis_curly_apostrophe_variants():
    # iOS/macOS auto-substitute a curly apostrophe (U+2019); must still fire.
    assert _triggers("I can’t do this anymore")
    assert _triggers("I don’t want to be here anymore")
    # dropped-apostrophe speech-to-text form
    assert _triggers("I cant go on")


def test_crisis_passive_ideation():
    assert _triggers("I just want to disappear")
    assert _triggers("I'm so tired of living")


def test_crisis_harm_to_others():
    assert _triggers("I'm going to hurt my wife")


def test_benign_firearm_talk_not_flagged():
    # A veteran mentioning their firearm hobby should not be treated as crisis.
    assert not _triggers("I had a great day at the range with my pistol")
    assert not _triggers("I felt calm on my morning run today")


def test_crisis_false_negative_keep_myself_safe():
    assert _triggers("idk how much longer i can keep myself safe")
    assert _triggers("I'm scared of what I might do")


def test_crisis_reassurance_is_suppressed():
    # Clear reassurance should NOT take over the screen (988 stays in the footer).
    assert not _triggers("I would never kill myself, I am doing much better now")
    assert not _triggers("I promise I am not going to hurt myself")


def test_crisis_ambivalence_always_overrides_reassurance():
    # Negation with ambivalence is high-risk and MUST still escalate.
    assert _triggers("I can't promise I won't hurt myself")
    assert _triggers("I don't want to kill myself but I keep thinking about it")


def test_rate_limit_kicks_in():
    mindbridge._rate_hits.clear()
    c = client()
    codes = [c.post("/api/chat", json={"message": "just checking in today"}).status_code
             for _ in range(mindbridge.RATE_LIMIT + 3)]
    assert codes[0] == 200          # first request is allowed
    assert 429 in codes             # the flood is throttled
    mindbridge._rate_hits.clear()   # don't leak state into other tests
