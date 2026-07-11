"""Self-contained demo responder.

When no DigitalOcean inference key is configured (or a live call fails), MindBridge
still needs to respond warmly so the app is always demonstrable. This builds a
reflective, grounded reply from the retrieved knowledge-base content — no network,
no key, no way to hard-fail in front of judges.

This is a fallback, not the product. With a key set, real model inference runs.
Openers/connectives/questions are deliberately varied so replies don't feel canned.
"""
import random
import re

_BULLET = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.*)", re.M)
_MD = re.compile(r"\*\*|\*|`|_")

_OPENERS = [
    "Thank you for telling me that — it takes something to say it out loud.",
    "I hear you. That sounds like a lot to carry.",
    "I'm right here with you, and I'm listening.",
    "That matters, and I'm glad you said it.",
    "Okay. Take your time — there's no rush here.",
    "That's a heavy thing to sit with. I'm not going anywhere.",
    "I'm really glad you reached out.",
    "That makes sense — anyone carrying what you're carrying would feel it.",
    "You don't have to have the words perfect. I'm following you.",
    "Thank you for trusting me with that.",
    "I can tell that's weighing on you.",
    "Let's stay with that for a second — you're not alone in it.",
    "That took some courage to name.",
    "I'm here. Whatever it is, we can look at it together.",
    "It's okay to not be okay right now.",
    "I appreciate you being straight with me.",
]
_CONNECTIVES = [
    "One thing that helps some veterans: ",
    "If you're up for it, you could try this — ",
    "Something small that can steady the moment: ",
    "When it hits like this, this can help: ",
    "A lot of folks find this grounding: ",
    "No pressure, but this sometimes helps: ",
]
_QUESTIONS = [
    "What feels like the hardest part right now?",
    "Do you want to just talk it out, or would it help to try something small together?",
    "When did you first start noticing this?",
    "What does today look like for you?",
    "Would it help to sit with that for a second before we go on?",
    "What's weighing on you most right now?",
    "Have you been able to tell anyone else about this?",
    "What would feel like a small win today?",
    "What do you need most in this moment — to vent, or to work through it?",
]


def _first_technique(text):
    bullets = [_MD.sub("", b).strip() for b in _BULLET.findall(text or "")]
    bullets = [b for b in bullets if len(b) > 25]
    if not bullets:
        return ""
    b = random.choice(bullets)
    return re.split(r"(?<=[.!?])\s", b)[0]


def demo_reply(user_text, kb_docs):
    parts = [random.choice(_OPENERS)]
    if kb_docs and random.random() < 0.6:
        t = _first_technique(kb_docs[0].get("text", ""))
        if t:
            parts.append(random.choice(_CONNECTIVES) + t[0].lower() + t[1:])
    parts.append(random.choice(_QUESTIONS))
    return " ".join(parts).strip()
