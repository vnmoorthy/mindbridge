"""Deterministic crisis detection.

This is the safety-critical path and is intentionally NOT delegated to the LLM:
it runs first, on every message, with plain string matching so its behaviour is
predictable and testable. When it fires, MindBridge stops its normal flow and
surfaces the Veterans Crisis Line immediately.

Detection policy (tuned to favour safety without spamming the banner):
  * ANY high-risk phrase (curated multi-word strings) -> trigger.
  * TWO OR MORE distinct concern keywords co-occurring -> trigger.
A single ambiguous keyword alone does not trigger, to avoid false positives on
phrases like "dead tired" or "killing time".
"""
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
CRISIS_PATH = BASE / "data" / "crisis.json"

_WORD = re.compile(r"[a-z']+")

# Always-present fallbacks so the safety net works even before content is loaded.
_FALLBACK_PHRASES = [
    "kill myself", "killing myself", "end my life", "want to die", "wish i was dead",
    "wish i were dead", "don't want to be here anymore", "do not want to be here anymore",
    "no reason to live", "better off dead", "take my own life", "suicidal", "hurt myself",
    "hurting myself", "end it all", "can't go on", "cannot go on",
    # "can't keep myself safe" family (self-harm risk stated as loss of safety/control)
    "can't keep myself safe", "keep myself safe much longer", "keep myself safe anymore",
    "how much longer i can keep myself", "don't feel safe with myself", "not safe with myself",
    "unsafe with myself", "scared of what i might do", "afraid of what i might do",
    "can't guarantee my own safety", "can't hold on much longer",
]

# Reassurance guard: a distressed person may say a risk phrase inside a clearly
# REASSURING sentence ("I would never kill myself, I'm doing better"). We suppress
# the overlay only when every matched risk phrase is directly negated by one of
# these markers AND no ambivalence marker is present. Ambivalence ALWAYS wins —
# "I can't promise I won't hurt myself" must still escalate.
_REASSURE_BEFORE = [
    "would never", "wouldn't ever", "never going to", "never gonna", "not going to",
    "not gonna", "no longer", "don't want to", "do not want to", "promise i'm not",
    "promise i am not", "not planning to", "would not", "won't ever",
]
_AMBIVALENCE = [
    "can't promise", "cannot promise", "won't be able", "not sure", "don't know if",
    "might", "maybe", "part of me", "some days", "sometimes i", "keep thinking",
    "scared i", "afraid i", "what if i", "starting to", "close to", "almost",
]
_FALLBACK_MARKDOWN = (
    "**You deserve to talk to someone who can help right now.**\n\n"
    "- **Veterans Crisis Line — dial 988, then press 1**\n"
    "- **Text 838255**\n"
    "- **Chat at veteranscrisisline.net**\n"
    "- **If you are in immediate danger, call 911.**\n\n"
    "You are not a burden, and reaching out is a sign of strength."
)
_FALLBACK_SPOKEN = (
    "I'm really glad you told me, and I want to make sure you're safe. "
    "You don't have to carry this alone right now — please reach the Veterans Crisis Line "
    "by dialing 9-8-8 and pressing 1. Can you do that with me right now?"
)
_FALLBACK_RESOURCES = [
    {"name": "Veterans Crisis Line", "contact": "Dial 988, then press 1  •  Text 838255  •  veteranscrisisline.net",
     "note": "Free, confidential, 24/7. You do not need to be enrolled in VA benefits."},
    {"name": "988 Suicide & Crisis Lifeline", "contact": "Call or text 988",
     "note": "24/7 support for anyone in emotional distress."},
    {"name": "Emergency", "contact": "911", "note": "If you are in immediate physical danger."},
]


class CrisisDetector:
    def __init__(self):
        data = {}
        if CRISIS_PATH.exists():
            try:
                data = json.loads(CRISIS_PATH.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
        phrases = [p.lower() for p in data.get("highRiskPhrases", [])]
        # Merge curated content with always-on fallbacks (deduped).
        self.phrases = sorted(set(phrases) | set(_FALLBACK_PHRASES))
        self.keywords = set(k.lower() for k in data.get("keywords", []))
        self.title = data.get("escalationTitle") or "You don't have to face this alone"
        self.markdown = data.get("escalationMarkdown") or _FALLBACK_MARKDOWN
        self.spoken = data.get("spokenResponse") or _FALLBACK_SPOKEN
        self.resources = data.get("resources") or _FALLBACK_RESOURCES

    def check(self, text):
        t = (text or "").lower()
        # Normalize Unicode apostrophes (iOS/macOS auto-substitute U+2019) to a
        # straight quote, and also match against an apostrophe-stripped copy so
        # dropped-apostrophe speech-to-text ("cant", "dont") still fires.
        for ch in ("’", "‘", "ʼ", "´", "`"):
            t = t.replace(ch, "'")
        t_stripped = t.replace("'", "")
        matched_phrases = [
            p for p in self.phrases if p in t or p.replace("'", "") in t_stripped
        ]
        words = set(_WORD.findall(t))
        matched_keywords = sorted(words & self.keywords)

        # Suppress clear reassurance ("I would never kill myself, I'm doing better")
        # unless any ambivalence marker is present, in which case we always escalate.
        if matched_phrases and not any(a in t for a in _AMBIVALENCE):
            def _negated(phrase):
                i = t.find(phrase)
                return any(r in t[max(0, i - 25):i] for r in _REASSURE_BEFORE)
            if all(_negated(p) for p in matched_phrases):
                matched_phrases = []

        triggered = bool(matched_phrases) or len(matched_keywords) >= 2
        return {
            "triggered": triggered,
            "matched": (matched_phrases + matched_keywords)[:5],
            "title": self.title,
            "markdown": self.markdown,
            "spoken": self.spoken,
            "resources": self.resources,
        }
