"""Lightweight, dependency-free retrieval over the MindBridge knowledge base
and the real veteran-resources dataset.

We deliberately avoid an external embeddings service here: keyword + term-overlap
scoring is fast, has zero moving parts, and never fails mid-demo. The knowledge
base and resources are plain files, so content can be regenerated without touching
this code.
"""
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
KB_DIR = BASE / "knowledge_base"
DATA_DIR = BASE / "data"

_WORD = re.compile(r"[a-z0-9']+")
_HEADING = re.compile(r"^#\s+(.+)$", re.M)


def tokens(text):
    return _WORD.findall((text or "").lower())


def first_heading(text):
    m = _HEADING.search(text or "")
    return m.group(1).strip() if m else None


def public(record):
    """Strip internal (underscore-prefixed) fields before sending to the client."""
    return {k: v for k, v in record.items() if not k.startswith("_")}


class KnowledgeBase:
    """Retrieves grounding content the AI uses to answer, so replies are anchored
    to vetted material rather than invented."""

    def __init__(self):
        self.docs = []
        self._load()

    def _load(self):
        index = []
        index_path = KB_DIR / "_index.json"
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                index = []
        by_file = {e.get("file"): e for e in index}
        if not KB_DIR.exists():
            return
        for md in sorted(KB_DIR.glob("*.md")):
            meta = by_file.get(md.name, {})
            text = md.read_text(encoding="utf-8")
            self.docs.append({
                "file": md.name,
                "title": meta.get("title") or first_heading(text) or md.stem,
                "keywords": [k.lower() for k in meta.get("keywords", [])],
                "text": text,
                "_tokens": set(tokens(text)),
            })

    def search(self, query, k=2):
        ql = (query or "").lower()
        qset = set(tokens(query))
        scored = []
        for d in self.docs:
            score = 0.0
            for kw in d["keywords"]:
                if kw in ql:                       # whole keyword/phrase present
                    score += 4.0
                elif kw in qset:                    # single-word keyword token
                    score += 2.0
            score += len(qset & d["_tokens"]) * 0.5  # general term overlap
            if score > 0:
                scored.append((score, d))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [d for _, d in scored[:k]]


class ResourceIndex:
    """Retrieves real, verifiable veteran resources to recommend by name."""

    def __init__(self):
        self.resources = []
        path = DATA_DIR / "sf_resources.json"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
            if isinstance(data, dict):
                self.resources = data.get("resources", [])
            elif isinstance(data, list):
                self.resources = data
            else:
                self.resources = []
        self.resources = [r for r in self.resources if isinstance(r, dict)]
        for r in self.resources:
            blob = " ".join([
                r.get("name", ""), r.get("category", ""), r.get("description", ""),
                " ".join(r.get("keywords", [])),
            ])
            r["_tokens"] = set(tokens(blob))
            r["_keywords"] = [k.lower() for k in r.get("keywords", [])]

    def all(self):
        return [public(r) for r in self.resources]

    def search(self, query, k=3):
        ql = (query or "").lower()
        qset = set(tokens(query))
        scored = []
        for r in self.resources:
            score = float(len(qset & r["_tokens"]))
            for kw in r["_keywords"]:
                if kw in ql:
                    score += 2.0
            if score > 0:
                scored.append((score, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [public(r) for _, r in scored[:k]]
