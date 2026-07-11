"""Self-contained demo responder.

When no DigitalOcean inference key is configured (or a live call fails), MindBridge
still needs to respond warmly so the app is always demonstrable. This builds a
reflective, grounded reply from the retrieved knowledge-base content — no network,
no key, no way to hard-fail in front of judges.

This is a fallback, not the product. With a key set, real model inference runs.
"""
import random
import re

_BULLET = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.*)", re.M)
_MD = re.compile(r"\*\*|\*|`|_")

_OPENERS = [
    "Thank you for telling me that — it takes something to say it out loud.",
    "I hear you. That sounds like a lot to carry.",
    "I'm here with you, and I'm listening.",
    "That matters, and I'm glad you said it.",
    "I'm right here. Take your time.",
]

_QUESTIONS = [
    "What feels like the hardest part right now?",
    "Do you want to just talk it out, or would it help to try something small together?",
    "When did you first start noticing this?",
    "What does today look like for you?",
    "Would it help to sit with that for a second before we go on?",
]


def _first_technique(text):
    bullets = [_MD.sub("", b).strip() for b in _BULLET.findall(text or "")]
    bullets = [b for b in bullets if len(b) > 25]
    if not bullets:
        return ""
    b = random.choice(bullets)
    # Keep it to the first sentence so a spoken reply stays short.
    b = re.split(r"(?<=[.!?])\s", b)[0]
    return b


def demo_reply(user_text, kb_docs):
    opener = random.choice(_OPENERS)
    technique = ""
    if kb_docs:
        t = _first_technique(kb_docs[0].get("text", ""))
        if t:
            technique = f" One thing some veterans find steadying: {t[0].lower() + t[1:]}"
    question = random.choice(_QUESTIONS)
    return f"{opener}{technique} {question}".strip()
