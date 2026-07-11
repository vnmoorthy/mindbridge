/* Basecamp SF — routine engine view (OPORD builder + Phase-Down engine + SitRep).
   One file, two surfaces: if window.BC_DATA is present (static demo) everything
   runs client-side; otherwise it talks to the Flask /api/basecamp/* endpoints.
   Telemetry (the Freedom Gauge) lives in localStorage — no account needed. */
(function () {
  "use strict";
  var HAS_LOCAL = !!(window.BC_DATA && window.BC_DATA.tracks);

  var CONFIG = null, BLOCKS = [], BOARD_PHASE = 1;
  var CONFIRM_PTS = 8, SITREP_PTS = { "1": 10, "0": 3, "-1": -4 };

  var S = {
    track: localStorage.getItem("bc_track") || null,
    score: parseInt(localStorage.getItem("bc_score") || "0", 10) || 0,
    done: safeJSON("bc_done", []),
    choices: safeJSON("bc_choices", {}),
  };
  function safeJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save() {
    localStorage.setItem("bc_track", S.track || "");
    localStorage.setItem("bc_score", String(S.score));
    localStorage.setItem("bc_done", JSON.stringify(S.done));
    localStorage.setItem("bc_choices", JSON.stringify(S.choices));
  }
  function clamp(n) { return Math.max(0, Math.min(100, n)); }

  // ---- data adapter (local vs API) ----
  var BC = {
    config: function (cb) {
      if (HAS_LOCAL) {
        cb({ tracks: BC_DATA.tracks.map(function (t) { return { id: t.id, name: t.name, focus: t.focus }; }),
             phases: BC_DATA.phases, sitrep: BC_DATA.sitrep });
      } else { fetch("/api/basecamp/config").then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); }); }
    },
    opord: function (track, phase, cb) {
      if (HAS_LOCAL) {
        var t = BC_DATA.tracks.filter(function (x) { return x.id === track; })[0];
        if (!t) { cb(null); return; }
        var s = (t.schedules || []).filter(function (x) { return x.phase === phase; })[0] || t.schedules[0];
        cb({ track: { id: t.id, name: t.name }, phase: phase, blocks: (s || {}).blocks || [] });
      } else {
        fetch("/api/basecamp/opord", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track: track, phase: phase }) })
          .then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); });
      }
    },
    sitrep: function (payload, cb) {
      if (HAS_LOCAL) { cb(localSitrep(payload)); }
      else {
        fetch("/api/basecamp/sitrep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(function (r) { return r.json(); }).then(cb).catch(function () { cb({ reply: "Couldn't reach the SitRep service, but I logged it locally.", crisis: false, autonomy: 0 }); });
      }
    },
  };

  function localSitrep(p) {
    var note = (p.note || "").toLowerCase();
    var cr = (window.MB_DATA && MB_DATA.crisis) ? MB_DATA.crisis : null;
    if (cr && note) {
      var t = note; ["’", "‘", "ʼ"].forEach(function (c) { t = t.split(c).join("'"); });
      if ((cr.highRiskPhrases || []).some(function (ph) { return t.indexOf(ph) >= 0; })) {
        return { crisis: true, reply: cr.spokenResponse, escalation: { title: cr.escalationTitle, markdown: cr.escalationMarkdown, resources: cr.resources }, autonomy: 0 };
      }
    }
    var acks = (BC_DATA.sitrep && BC_DATA.sitrep.demoAcks) || {};
    var A = ["i chose", "i decided", "i adjusted", "my plan", "i handled", "i'll", "i will", "i can"];
    var X = ["can't", "cant", "hopeless", "pointless", "overwhelmed", "exhausted", "no point", "stuck"];
    var a = A.filter(function (w) { return note.indexOf(w) >= 0; }).length;
    var x = X.filter(function (w) { return note.indexOf(w) >= 0; }).length;
    var auto = (a || x) ? Math.max(-1, Math.min(1, a - x)) : 0;
    return { reply: acks[p.moodBucket] || acks.mid || "Logged. One block at a time today.", crisis: false, autonomy: auto, resources: [] };
  }

  // ---- helpers ----
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function phaseFor(score) {
    var best = (CONFIG.phases || [])[0] || { n: 1, name: "Garrison" };
    (CONFIG.phases || []).forEach(function (p) { if (score >= (p.rciThreshold || 0)) best = p; });
    return best;
  }
  function nextPhase(score) {
    var np = null;
    (CONFIG.phases || []).forEach(function (p) { if ((p.rciThreshold || 0) > score && (!np || p.rciThreshold < np.rciThreshold)) np = p; });
    return np;
  }

  // ---- render ----
  var root;
  function render() {
    root = document.getElementById("bcRoot");
    if (!root) return;
    root.innerHTML = "";
    if (!CONFIG) { root.appendChild(h("p", "bc-sub", "Loading Basecamp…")); return; }
    if (!S.track) { renderOnboarding(); } else { renderBoard(); }
  }

  function renderOnboarding() {
    root.appendChild(h("div", "bc-eyebrow", "Basecamp SF · Onboarding"));
    root.appendChild(h("h1", "bc-h1", "Select your reintegration track"));
    root.appendChild(h("p", "bc-sub", "Your track shapes the daily Operations Order. You can change it anytime — and as your consistency grows, Basecamp hands structure back to you."));
    var wrap = h("div", "bc-tracks");
    (CONFIG.tracks || []).forEach(function (t) {
      var card = h("button", "bc-track"); card.type = "button";
      var code = (t.name.split("—")[0] || t.id).trim();
      card.appendChild(h("div", "bc-track__code", code.toUpperCase()));
      card.appendChild(h("div", "bc-track__name", (t.name.split("—")[1] || t.name).trim()));
      card.appendChild(h("div", "bc-track__focus", t.focus || ""));
      card.addEventListener("click", function () {
        S.track = t.id; S.score = 0; S.done = []; S.choices = {}; save(); loadBoard();
      });
      wrap.appendChild(card);
    });
    root.appendChild(wrap);
  }

  function loadBoard() {
    BOARD_PHASE = phaseFor(S.score).n || 1;
    BC.opord(S.track, BOARD_PHASE, function (o) { BLOCKS = (o && o.blocks) || []; render(); });
  }

  function renderBoard() {
    var ph = phaseFor(S.score);
    // gauge
    var g = h("div", "bc-gauge");
    var rowEl = h("div", "bc-gauge__row");
    var phEl = h("div", "bc-gauge__phase"); phEl.innerHTML = "Phase " + (ph.n) + " · <b>" + esc(ph.name) + "</b>";
    rowEl.appendChild(phEl);
    rowEl.appendChild(h("div", "bc-gauge__pct", "Freedom Gauge " + S.score + "%"));
    g.appendChild(rowEl);
    var bar = h("div", "bc-gauge__bar"); var fill = h("div", "bc-gauge__fill"); fill.style.width = S.score + "%"; bar.appendChild(fill); g.appendChild(bar);
    var np = nextPhase(S.score);
    g.appendChild(h("div", "bc-gauge__hint", np ? ((np.rciThreshold - S.score) + "% more consistency to reach Phase " + np.n + " — " + np.name + " (the schedule loosens).") : "Stand-Down reached — you're running your own calendar. Mission accomplished."));
    root.appendChild(g);

    root.appendChild(h("div", "bc-section-label", "Today's Operations Order · " + esc(ph.name) + " · " + phaseTermNote(ph)));

    // blocks with dependency gate
    var firstUndone = -1;
    for (var i = 0; i < BLOCKS.length; i++) { if (S.done.indexOf(i) < 0) { firstUndone = i; break; } }
    BLOCKS.forEach(function (b, i) {
      var done = S.done.indexOf(i) >= 0;
      var active = i === firstUndone;
      var locked = !done && !active;
      var card = h("div", "bc-block bc-block--" + b.type + (done ? " done" : locked ? " locked" : ""));
      card.appendChild(h("div", "bc-block__time", b.time || ""));
      var body = h("div", "bc-block__body");
      body.appendChild(h("div", "bc-block__tag", tagLabel(b.type)));
      body.appendChild(h("div", "bc-block__title", b.title || ""));
      if (b.detail) body.appendChild(h("div", "bc-block__detail", b.detail));
      // asymmetric menu
      var chosenKey = BOARD_PHASE + ":" + i;
      if (b.type === "asymmetric" && b.menu && b.menu.length) {
        var menu = h("div", "bc-menu");
        b.menu.forEach(function (m, mi) {
          var opt = h("button", "bc-menu__opt" + (S.choices[chosenKey] === mi ? " chosen" : "")); opt.type = "button";
          opt.appendChild(h("b", null, m.title)); opt.appendChild(h("span", null, m.detail));
          if (!done) opt.addEventListener("click", function () { S.choices[chosenKey] = mi; save(); render(); });
          menu.appendChild(opt);
        });
        body.appendChild(menu);
      }
      card.appendChild(body);
      var btn = h("button", "bc-block__confirm", done ? "✓ Done" : locked ? "Locked" : "Confirm");
      if (active) {
        btn.addEventListener("click", function () {
          if (b.type === "asymmetric" && b.menu && b.menu.length && S.choices[chosenKey] == null) { btn.textContent = "Pick one ↑"; return; }
          S.done.push(i); S.score = clamp(S.score + CONFIRM_PTS); save(); render();
        });
      }
      card.appendChild(btn);
      root.appendChild(card);
    });

    // actions
    var actions = h("div", "bc-actions");
    var sit = h("button", "bc-btn", "Voice SitRep check-in"); sit.addEventListener("click", openSitrep); actions.appendChild(sit);
    var allDone = S.done.length >= BLOCKS.length && BLOCKS.length > 0;
    var adv = h("button", "bc-btn bc-btn--ghost", allDone ? "Start next day →" : "Skip to next day");
    adv.addEventListener("click", function () {
      var before = phaseFor(S.score).n; S.done = []; save();
      var after = phaseFor(S.score).n;
      loadBoard();
      if (after > before) toast("Phase up — you've earned more autonomy. Now: " + phaseFor(S.score).name);
    });
    actions.appendChild(adv);
    var chg = h("button", "bc-btn bc-btn--ghost", "Change track"); chg.addEventListener("click", function () { S.track = null; save(); render(); }); actions.appendChild(chg);
    root.appendChild(actions);
  }

  function phaseTermNote(ph) {
    return ph.terminology === "civilian" ? "self-directed" : ph.terminology === "hybrid" ? "loosening up" : "full structure";
  }
  function tagLabel(t) {
    return { formation: "SitRep", sortie: "Focused Sortie", standdown: "Stand-Down", asymmetric: "Asymmetric Block — your call", civic: "Civic Mission" }[t] || t;
  }
  function esc(s) { return (s || "").replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  // ---- SitRep modal ----
  var sitSel = {};
  function openSitrep() {
    var m = document.getElementById("bcSitrep"); if (!m) return;
    sitSel = {};
    var card = document.getElementById("bcSitrepCard"); card.innerHTML = "";
    var period = (new Date().getHours() < 15) ? "am" : "pm";
    var sr = CONFIG.sitrep || {};
    card.appendChild(h("div", "bc-eyebrow", (period === "am" ? "0700" : "2100") + " Situation Report"));
    card.appendChild(h("p", "bc-sub", period === "am" ? (sr.amPrompt || "How did you sleep, and how ready do you feel?") : (sr.pmPrompt || "How did the day go?")));
    (sr.fields || []).forEach(function (f) {
      var fd = h("div", "bc-field"); fd.appendChild(h("div", "bc-field__label", f.label));
      var opts = h("div", "bc-field__opts");
      (f.options || []).forEach(function (o, oi) {
        var c = h("button", "bc-chip", o); c.type = "button";
        c.addEventListener("click", function () {
          sitSel[f.key] = { value: o, idx: oi, len: (f.options || []).length, label: f.label };
          Array.prototype.forEach.call(opts.children, function (x) { x.classList.remove("sel"); });
          c.classList.add("sel");
        });
        opts.appendChild(c);
      });
      fd.appendChild(opts); card.appendChild(fd);
    });
    var ta = h("textarea"); ta.id = "bcSitNote"; ta.placeholder = "In your own words (optional) — speak freely."; card.appendChild(ta);
    var reply = h("div"); reply.id = "bcSitReply"; card.appendChild(reply);
    var act = h("div", "bc-actions");
    var submit = h("button", "bc-btn", "Submit SitRep"); submit.addEventListener("click", function () { submitSitrep(period, ta.value, reply); }); act.appendChild(submit);
    var close = h("button", "bc-btn bc-btn--ghost", "Close"); close.addEventListener("click", closeSitrep); act.appendChild(close);
    card.appendChild(act);
    m.hidden = false;
  }
  function closeSitrep() { var m = document.getElementById("bcSitrep"); if (m) m.hidden = true; }

  function submitSitrep(period, note, replyEl) {
    var fields = {}; var moodBucket = "mid";
    Object.keys(sitSel).forEach(function (k) {
      fields[sitSel[k].label] = sitSel[k].value;
      if (/emotion|mood|baseline|feel/i.test(k) || /emotion|mood|baseline|feel/i.test(sitSel[k].label)) {
        var r = sitSel[k].idx / Math.max(1, sitSel[k].len - 1);
        moodBucket = r < 0.34 ? "low" : r < 0.67 ? "mid" : "high";
      }
    });
    BC.sitrep({ period: period, fields: fields, moodBucket: moodBucket, note: (note || "").trim() }, function (res) {
      res = res || {};
      replyEl.innerHTML = "";
      var box = h("div", "bc-sitrep__reply", res.reply || "Logged.");
      replyEl.appendChild(box);
      if (res.crisis && res.escalation) {
        var cr = h("div", "bc-sitrep__reply");
        cr.style.borderColor = "var(--danger)";
        cr.innerHTML = "<strong>" + esc(res.escalation.title || "You don't have to face this alone") + "</strong><br>Veterans Crisis Line — <strong>dial 988, then press 1</strong> · text 838255";
        replyEl.appendChild(cr);
      } else {
        var d = SITREP_PTS[String(res.autonomy != null ? res.autonomy : 0)] || SITREP_PTS["0"];
        S.score = clamp(S.score + d); save();
        if ((res.resources || []).length) {
          var r = res.resources[0];
          var rc = h("div", "bc-sitrep__reply", "Suggested: " + r.name + (r.phone ? " · " + r.phone : ""));
          replyEl.appendChild(rc);
        }
        // reflect the gauge change behind the modal
        render();
      }
    });
  }

  // ---- toast ----
  function toast(msg) {
    var t = h("div", null, msg);
    t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#14303a;border:1px solid rgba(79,209,197,.5);color:#eaf4f4;padding:12px 18px;border-radius:12px;z-index:90;box-shadow:0 10px 30px rgba(0,0,0,.4)";
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  // ---- open / close the whole view ----
  function openBasecamp() {
    var v = document.getElementById("basecampView"); if (!v) return;
    v.hidden = false;
    if (!CONFIG) { BC.config(function (c) { CONFIG = c; if (S.track && CONFIG) { loadBoard(); } else { render(); } }); }
    else if (S.track) { loadBoard(); } else { render(); }
  }
  function closeBasecamp() { var v = document.getElementById("basecampView"); if (v) v.hidden = true; }

  var openBtn = document.getElementById("basecampBtn"); if (openBtn) openBtn.addEventListener("click", openBasecamp);
  var closeBtn = document.getElementById("bcClose"); if (closeBtn) closeBtn.addEventListener("click", closeBasecamp);
  var sitClose = document.getElementById("bcSitrepClose"); if (sitClose) sitClose.addEventListener("click", closeSitrep);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var m = document.getElementById("bcSitrep");
    if (m && !m.hidden) { closeSitrep(); return; }
    var v = document.getElementById("basecampView");
    if (v && !v.hidden) closeBasecamp();
  });
})();
