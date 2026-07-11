"""MindBridge — a peer-support voice-AI companion for U.S. military veterans
living with PTSD.

Architecture (deliberately simple and demo-proof):
  1. Every message is checked for crisis FIRST, deterministically (crisis.py).
  2. Otherwise we retrieve grounding context (retrieval.py) and ask the
     DigitalOcean serverless-inference model to respond as a warm companion.
  3. If no inference key is configured, or the call fails, we fall back to a
     self-contained demo responder so the app is always live.

Nothing about a user's conversation is persisted server-side.
"""
import os
import threading
import time
from collections import deque
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from crisis import CrisisDetector
from retrieval import KnowledgeBase, ResourceIndex
from demo_responder import demo_reply
from basecamp import Basecamp, autonomy_signal

BASE = Path(__file__).parent


def _load_dotenv():
    """Load .env directly in Python (tolerates spaces/quotes; never echoes values).
    Only fills vars not already set in the real environment."""
    p = BASE / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'").strip()
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()

app = Flask(__name__, static_folder="static", template_folder="templates")

# Bound request bodies so a huge payload can't exhaust memory (Flask -> 413).
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

# Tracks whether the most recent live inference call actually succeeded, so
# /api/health can report reality rather than just "a key is set".
_last_inference_ok = None


@app.after_request
def set_security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
        "form-action 'self'; frame-ancestors 'none'",
    )
    return resp


KB = KnowledgeBase()
RESOURCES = ResourceIndex()
CRISIS = CrisisDetector()
BASECAMP = Basecamp()

_prompt_path = BASE / "prompts" / "system.txt"
SYSTEM_PROMPT = (
    _prompt_path.read_text(encoding="utf-8").strip()
    if _prompt_path.exists()
    else "You are MindBridge, a warm, plain-spoken companion for U.S. veterans. "
         "You listen and support. You are not a therapist and never give medical advice."
)

# --- DigitalOcean serverless inference (OpenAI-compatible) -------------------
INFERENCE_KEY = os.environ.get("MINDBRIDGE_INFERENCE_KEY") or os.environ.get("DIGITALOCEAN_INFERENCE_KEY")
INFERENCE_BASE_URL = os.environ.get("MINDBRIDGE_INFERENCE_BASE_URL", "https://inference.do-ai.run/v1")
# Set MINDBRIDGE_MODEL to any model id from your DigitalOcean model playground.
MODEL = os.environ.get("MINDBRIDGE_MODEL", "llama3.3-70b-instruct")

_client = None


def get_client():
    global _client
    if _client is None and INFERENCE_KEY:
        from openai import OpenAI
        # Bounded timeout + a couple of automatic retries so a slow/transient DO
        # response degrades gracefully instead of hanging a gunicorn worker.
        _client = OpenAI(api_key=INFERENCE_KEY, base_url=INFERENCE_BASE_URL, timeout=30.0, max_retries=2)
    return _client


# --- lightweight in-memory per-IP rate limiting (protects live credits) -----
RATE_LIMIT = int(os.environ.get("MINDBRIDGE_RATE_LIMIT", "30"))  # requests per window
RATE_WINDOW = 60  # seconds
_rate_hits = {}
_rate_lock = threading.Lock()


def _client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() if fwd else request.remote_addr) or "unknown"


def _rate_ok(ip):
    now = time.time()
    with _rate_lock:
        dq = _rate_hits.setdefault(ip, deque())
        while dq and dq[0] < now - RATE_WINDOW:
            dq.popleft()
        if len(dq) >= RATE_LIMIT:
            return False
        dq.append(now)
        return True


def build_context(kb_docs, resources):
    parts = []
    if kb_docs:
        parts.append("RELEVANT SUPPORT KNOWLEDGE (ground your reply in this; do not quote it verbatim):")
        for d in kb_docs:
            parts.append(f"## {d['title']}\n{d['text'][:1200]}")
    if resources:
        parts.append("REAL RESOURCES you may gently mention BY NAME if it fits naturally:")
        for r in resources:
            line = f"- {r['name']}"
            if r.get("phone"):
                line += f" ({r['phone']})"
            if r.get("description"):
                line += f": {r['description']}"
            parts.append(line)
    return "\n\n".join(parts)


def generate_reply(history, user_text, kb_docs, context):
    global _last_inference_ok
    client = get_client()
    if client is not None:
        try:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            if context:
                messages.append({"role": "system", "content": context})
            for m in history[-8:]:
                if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content"):
                    messages.append({"role": m["role"], "content": m["content"]})
            last = history[-1] if history else None
            if not last or (last.get("content") or "").strip() != user_text:
                messages.append({"role": "user", "content": user_text})
            resp = client.chat.completions.create(
                model=MODEL, messages=messages, temperature=0.85, max_tokens=320,
            )
            _last_inference_ok = True
            return resp.choices[0].message.content.strip(), "live"
        except Exception as exc:  # never crash the demo on an inference error
            _last_inference_ok = False
            app.logger.warning("Inference call failed, using demo responder: %s", exc)
    return demo_reply(user_text, kb_docs), "demo"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "mode": "live" if INFERENCE_KEY else "demo",
        "model": MODEL if INFERENCE_KEY else None,
        "inference_ok": _last_inference_ok,
        "kb_docs": len(KB.docs),
        "resources": len(RESOURCES.resources),
    })


@app.route("/api/resources")
def resources():
    return jsonify({"resources": RESOURCES.all()})


@app.route("/api/chat", methods=["POST"])
def chat():
    if not _rate_ok(_client_ip()):
        return jsonify({
            "reply": "You're sending messages very fast — take a breath, I'm still right here. Give it a moment and try again.",
            "crisis": False, "resources": [], "sources": [], "mode": "rate_limited",
        }), 429

    body = request.get_json(force=True, silent=True) or {}
    history = body.get("messages")
    if not isinstance(history, list):
        history = []
    history = [m for m in history if isinstance(m, dict)]

    user_text = body.get("message")
    if not isinstance(user_text, str):
        user_text = None
    if not user_text and history:
        for m in reversed(history):
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                user_text = m.get("content")
                break
    user_text = (user_text or "").strip()
    if not user_text:
        return jsonify({"error": "empty message"}), 400

    # 1) Safety first — deterministic, over a short rolling window of recent user
    #    turns so risk expressed across several messages still escalates.
    recent_user = []
    for m in reversed(history):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            val = m["content"].strip()
            if val and val != user_text:
                recent_user.append(val)
        if len(recent_user) >= 2:
            break
    c = CRISIS.check("\n".join([user_text] + recent_user))
    if c["triggered"]:
        return jsonify({
            "reply": c["spoken"],
            "crisis": True,
            "escalation": {"title": c["title"], "markdown": c["markdown"], "resources": c["resources"]},
            "resources": [],
            "sources": [],
            "mode": "safety",
        })

    # 2) Retrieve grounding + real resources.
    kb_docs = KB.search(user_text, k=2)
    matched_resources = RESOURCES.search(user_text, k=3)
    context = build_context(kb_docs, matched_resources)

    # 3) Respond.
    reply, mode = generate_reply(history, user_text, kb_docs, context)

    return jsonify({
        "reply": reply,
        "crisis": False,
        "resources": matched_resources,
        "sources": [d["title"] for d in kb_docs],
        "mode": mode,
    })


# ---------------- MindBridge (routine engine, alongside the companion) --------
def analyze_sitrep(period, fields, note, mood_bucket):
    global _last_inference_ok
    summary = ", ".join(f"{k}: {v}" for k, v in (fields or {}).items() if v)
    client = get_client()
    if client is not None:
        try:
            sysp = BASECAMP.sitrep.get("systemPrompt") or "You are the MindBridge SitRep AI, a warm companion for a veteran. You are not a clinician."
            content = f"{str(period).upper()} SitRep. Ratings — {summary or 'none given'}. In their words: {note or '(no note)'}"
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "system", "content": sysp}, {"role": "user", "content": content}],
                temperature=0.85, max_tokens=220,
            )
            _last_inference_ok = True
            return resp.choices[0].message.content.strip(), "live"
        except Exception as exc:
            _last_inference_ok = False
            app.logger.warning("SitRep inference failed, using demo ack: %s", exc)
    acks = BASECAMP.sitrep.get("demoAcks", {})
    reply = acks.get(mood_bucket) or acks.get("mid") or "Thanks for the SitRep — logged. Let's take the day one block at a time."
    return reply, "demo"


@app.route("/api/basecamp/config")
def basecamp_config():
    return jsonify(BASECAMP.config())


@app.route("/api/basecamp/opord", methods=["POST"])
def basecamp_opord():
    body = request.get_json(force=True, silent=True) or {}
    o = BASECAMP.get_opord(body.get("track"), body.get("phase", 1))
    if not o:
        return jsonify({"error": "unknown track"}), 400
    return jsonify(o)


@app.route("/api/basecamp/sitrep", methods=["POST"])
def basecamp_sitrep():
    if not _rate_ok(_client_ip()):
        return jsonify({"reply": "Easy — one SitRep at a time. Give it a moment.", "crisis": False, "autonomy": 0}), 429
    body = request.get_json(force=True, silent=True) or {}
    note = body.get("note") if isinstance(body.get("note"), str) else ""
    note = (note or "").strip()
    fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
    period = body.get("period", "am")
    mood_bucket = body.get("moodBucket", "mid")

    c = CRISIS.check(note)
    if c["triggered"]:
        return jsonify({
            "reply": c["spoken"], "crisis": True,
            "escalation": {"title": c["title"], "markdown": c["markdown"], "resources": c["resources"]},
            "autonomy": 0,
        })
    reply, mode = analyze_sitrep(period, fields, note, mood_bucket)
    resources = RESOURCES.search(note, k=1) if note else []
    return jsonify({"reply": reply, "crisis": False, "autonomy": autonomy_signal(note),
                    "resources": resources, "mode": mode})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("MINDBRIDGE_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    # Never expose the debug reloader / Werkzeug PIN on all interfaces.
    host = os.environ.get("MINDBRIDGE_HOST") or ("127.0.0.1" if debug else "0.0.0.0")
    app.run(host=host, port=port, debug=debug)
