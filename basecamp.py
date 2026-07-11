"""Basecamp SF module — the routine-engine layer that sits alongside the
MindBridge companion.

Three features, one loop:
  * OPORD Schedule Builder  -> get_opord(track, phase)
  * Phase-Down Autonomy Engine -> phase_for_rci(rci)  (telemetry lives client-side)
  * Voice SitRep -> analysed in app.py (Gradient AI live, templated in demo)

Content (tracks, phase definitions, SitRep config) is data in data/basecamp.json,
so it can be regenerated without touching code.
"""
import json
from pathlib import Path

BASE = Path(__file__).parent
BC_PATH = BASE / "data" / "basecamp.json"

# Autonomy signal: language that suggests self-direction vs. acute stress. Used
# to nudge the Freedom Gauge from a SitRep note.
AUTONOMY_WORDS = [
    "i chose", "i decided", "i adjusted", "my plan", "i handled", "i figured",
    "i'll ", "i will ", "i can ", "i want to", "i made", "i set up", "i planned",
]
STRESS_WORDS = [
    "can't", "cant", "hopeless", "pointless", "overwhelmed", "exhausted",
    "no point", "stuck", "trapped", "dread", "give up", "falling apart",
]


def autonomy_signal(text):
    t = (text or "").lower()
    a = sum(1 for w in AUTONOMY_WORDS if w in t)
    s = sum(1 for w in STRESS_WORDS if w in t)
    if a == 0 and s == 0:
        return 0
    return max(-1, min(1, a - s))


class Basecamp:
    def __init__(self):
        data = {}
        if BC_PATH.exists():
            try:
                data = json.loads(BC_PATH.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
        self.tracks = data.get("tracks", [])
        self.phases = sorted(data.get("phases", []), key=lambda p: p.get("n", 0))
        self.sitrep = data.get("sitrep", {})
        self._by_id = {t.get("id"): t for t in self.tracks}

    def loaded(self):
        return bool(self.tracks and self.phases)

    def config(self):
        """Public config for the frontend (never leaks the model system prompt)."""
        return {
            "tracks": [{"id": t.get("id"), "name": t.get("name"), "focus": t.get("focus")} for t in self.tracks],
            "phases": self.phases,
            "sitrep": {k: v for k, v in self.sitrep.items() if k not in ("systemPrompt", "autonomyGuidance")},
        }

    def phase_for_rci(self, rci):
        """Highest phase whose Routine-Consistency-Index threshold is met."""
        best = 1
        for p in self.phases:
            if rci >= p.get("rciThreshold", 0):
                best = p.get("n", best)
        return best

    def phase_def(self, n):
        for p in self.phases:
            if p.get("n") == n:
                return p
        return self.phases[0] if self.phases else {}

    def get_opord(self, track_id, phase):
        t = self._by_id.get(track_id)
        if not t:
            return None
        try:
            phase = int(phase or 1)
        except (TypeError, ValueError):
            phase = 1
        phase = max(1, min(4, phase))
        sched = None
        for s in t.get("schedules", []):
            if s.get("phase") == phase:
                sched = s
                break
        if sched is None and t.get("schedules"):
            sched = t["schedules"][0]
        return {
            "track": {"id": t.get("id"), "name": t.get("name")},
            "phase": phase,
            "phaseName": self.phase_def(phase).get("name", ""),
            "blocks": (sched or {}).get("blocks", []),
        }
