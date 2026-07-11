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
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from crisis import CrisisDetector
from retrieval import KnowledgeBase, ResourceIndex
from demo_responder import demo_reply

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
        _client = OpenAI(api_key=INFERENCE_KEY, base_url=INFERENCE_BASE_URL)
    return _client


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
                model=MODEL, messages=messages, temperature=0.7, max_tokens=320,
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("MINDBRIDGE_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    # Never expose the debug reloader / Werkzeug PIN on all interfaces.
    host = os.environ.get("MINDBRIDGE_HOST") or ("127.0.0.1" if debug else "0.0.0.0")
    app.run(host=host, port=port, debug=debug)
