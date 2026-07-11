<div align="center">

# 🌉 MindBridge

**A voice you can call at 3 a.m. — a steady, honest AI battle-buddy for veterans living with PTSD.**

*Built for the MLH × DigitalOcean "AI for Social Good" Hackathon (SF 2026)*

**▶ [Try the live demo](https://vnmoorthy.github.io/mindbridge/)** — runs entirely in your browser, no sign-up

</div>

---

## The problem

Roughly **one in eleven** U.S. veterans will live with PTSD in their lifetime — yet the people trained to run toward danger are often the last to ask for help. Stigma, self-reliance, and long waits at the VA leave too many carrying it alone, especially at night when clinics are closed and the people who understand are asleep.

**The gap between "I'm not okay" and "I called someone" is where veterans are lost.** MindBridge is built to be the low-friction, judgment-free first step across that gap.

## What MindBridge is

MindBridge is a **peer-support voice companion**. A veteran talks to it out loud — like a phone call — and it:

- **Listens and reflects** without judgment, in warm, plain, spoken-length language.
- **Grounds** them with simple, evidence-informed techniques (5-4-3-2-1, box breathing, orienting) drawn from a curated knowledge base — not invented on the fly.
- **Connects** them to **real, verified resources** (VA health care, Vet Centers, homeless-veteran and employment support, family help) by name and location.
- **Knows its limits.** The moment a conversation signals crisis, it stops everything and hands off to the **Veterans Crisis Line (dial 988, then press 1)**.

> MindBridge is **a companion and navigator, not a therapist or crisis service.** It never diagnoses, never gives medical advice, and never replaces a human. See [SAFETY.md](SAFETY.md).

## Why it's built the way it is

| Design choice | Why |
|---|---|
| **Crisis detection is deterministic** (`crisis.py`), runs *first* on every message, and never depends on the LLM | Safety must be predictable and testable — not left to a model's judgment |
| **Graceful demo mode** — the app runs and responds warmly even with **no** API key or if an inference call fails | It can never hard-crash in front of a judge (or a veteran) |
| **Retrieval-grounded answers** over a real knowledge base + resource dataset | The AI recommends *real* help, not hallucinated programs or phone numbers |
| **Voice-first, calm, single-screen UI** with a text fallback | Meets people where they are; works on any machine, accessible by keyboard |

## How it maps to the hackathon tracks

- **🏆 Best Use of Gradient AI** — the companion's brain runs on **DigitalOcean serverless inference** (OpenAI-compatible), grounded via a retrieval layer that acts as a knowledge base.
- **🏆 Best Use of Data** — recommendations are drawn from a **real, web-verified veteran-resources dataset** (national + SF Bay Area).
- **🏆 Best UI/UX** — a low-arousal, voice-first interface designed for someone in distress.
- **🏆 Best Beginner** — a focused, single-purpose build with a clear, honest scope.

## Architecture

```
Browser (Web Speech API: voice in + out)
        │  POST /api/chat  { messages: [...] }
        ▼
Flask app.py
   ├─ crisis.py        → deterministic safety check (runs FIRST)
   ├─ retrieval.py     → knowledge-base + resource retrieval (keyword/term overlap, zero deps)
   ├─ DigitalOcean serverless inference  (live mode)
   └─ demo_responder.py → warm fallback (no key / call fails)
```

Content lives in plain files so it can be regenerated without touching code:
`prompts/system.txt`, `knowledge_base/*.md`, `data/crisis.json`, `data/sf_resources.json`.

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Demo mode — no key needed:
python app.py
# open http://localhost:8080

# Live mode — real DigitalOcean inference:
export MINDBRIDGE_INFERENCE_KEY=your_do_model_access_key
export MINDBRIDGE_MODEL=llama3.3-70b-instruct   # any model from your DO playground
python app.py
```

Run the tests:

```bash
python -m pytest -q
```

## Deploy to DigitalOcean App Platform

```bash
doctl apps create --spec .do/app.yaml
```

Then add `MINDBRIDGE_INFERENCE_KEY` as an app-level **secret** in the DigitalOcean
console (App → Settings → Environment Variables). The app auto-deploys on push to `main`.
See [.do/app.yaml](.do/app.yaml).

## Repo layout

```
app.py                 Flask server + inference wiring
crisis.py              Deterministic crisis detection + escalation
retrieval.py           Dependency-free knowledge-base + resource retrieval
demo_responder.py      Self-contained fallback responder
prompts/system.txt     The companion's system prompt
knowledge_base/        8 evidence-informed, non-clinical support docs (+ _index.json)
data/crisis.json       Crisis phrases, keywords, escalation copy, contacts
data/sf_resources.json Real national + SF Bay Area veteran resources
templates/ static/     Voice-first web UI
tests/                 Smoke tests (health, chat, crisis path)
DEMO.md                3-minute demo & pitch script
SAFETY.md              Safety, ethics, privacy, and limitations
```

## Important disclaimer

MindBridge is a hackathon project and a **support companion, not medical care**. It does
not provide diagnosis, treatment, or crisis counseling. If you or a veteran you know is
struggling, contact the **Veterans Crisis Line: dial 988, then press 1**, text **838255**,
or chat at **veteranscrisisline.net**. In an emergency, call **911**.

---

<div align="center"><sub>Made with care for those who served. 🇺🇸</sub></div>
