/* MindBridge — routine engine, tabbed shell (Schedule / Missions / Progress /
   Profile). One file drives both the live app (fetch /api/basecamp/*) and the
   static demo (window.BC_DATA). Telemetry (Freedom Gauge) lives in localStorage. */
(function () {
  "use strict";
  var HAS_LOCAL = !!(window.BC_DATA && window.BC_DATA.tracks);

  var CONFIG = null, BLOCKS = [], BOARD_PHASE = 1, TAB = "schedule";
  var CONFIRM_PTS = 8, SITREP_PTS = { "1": 10, "0": 3, "-1": -4 }, JOIN_PTS = 5;

  var S = {
    track: localStorage.getItem("bc_track") || null,
    score: parseInt(localStorage.getItem("bc_score") || "0", 10) || 0,
    done: safeJSON("bc_done", []),
    choices: safeJSON("bc_choices", {}),
    joined: safeJSON("bc_joined", []),
  };
  function safeJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save() {
    localStorage.setItem("bc_track", S.track || "");
    localStorage.setItem("bc_score", String(S.score));
    localStorage.setItem("bc_done", JSON.stringify(S.done));
    localStorage.setItem("bc_choices", JSON.stringify(S.choices));
    localStorage.setItem("bc_joined", JSON.stringify(S.joined));
  }
  function clamp(n) { return Math.max(0, Math.min(100, n)); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function esc(s) { return (s || "").replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function trackObj() { return (CONFIG.tracks || []).filter(function (t) { return t.id === S.track; })[0] || {}; }

  // ---- data adapter ----
  var BC = {
    config: function (cb) {
      if (HAS_LOCAL) {
        cb({ tracks: BC_DATA.tracks.map(function (t) { return { id: t.id, name: t.name, focus: t.focus }; }),
             phases: BC_DATA.phases, sitrep: BC_DATA.sitrep, squads: BC_DATA.squads || [] });
      } else { fetch("/api/basecamp/config").then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); }); }
    },
    opord: function (track, phase, cb) {
      if (HAS_LOCAL) {
        var t = BC_DATA.tracks.filter(function (x) { return x.id === track; })[0];
        if (!t) { cb(null); return; }
        var s = (t.schedules || []).filter(function (x) { return x.phase === phase; })[0] || t.schedules[0];
        cb({ blocks: (s || {}).blocks || [] });
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

  // ---- phase helpers ----
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
  function tagLabel(t) { return { formation: "SitRep", sortie: "Focused Sortie", standdown: "Stand-Down", asymmetric: "Asymmetric Block — your call", civic: "Civic Mission" }[t] || t; }

  // ---- top-level render / router ----
  var root;
  function render() {
    root = document.getElementById("bcRoot");
    if (!root) return;
    root.innerHTML = "";
    if (!CONFIG) { root.appendChild(h("p", "bc-sub", "Loading your routine…")); return; }
    if (!S.track) { renderOnboarding(); renderNav(); return; }
    if (TAB === "missions") renderMissions();
    else if (TAB === "progress") renderProgress();
    else if (TAB === "profile") renderProfile();
    else renderSchedule();
    renderNav();
  }

  function renderNav() {
    var nav = document.getElementById("bcNav"); if (!nav) return;
    nav.hidden = !S.track;
    nav.innerHTML = "";
    if (!S.track) return;
    [["schedule", "Schedule", "🗓"], ["missions", "Missions", "🎖"], ["progress", "Progress", "📈"], ["profile", "Profile", "👤"]].forEach(function (t) {
      var b = h("button", "bc-nav__tab" + (TAB === t[0] ? " active" : "")); b.type = "button";
      b.appendChild(h("span", "bc-nav__ico", t[2])); b.appendChild(h("span", null, t[1]));
      b.addEventListener("click", function () { TAB = t[0]; render(); var v = document.getElementById("basecampView"); if (v) v.scrollTop = 0; });
      nav.appendChild(b);
    });
  }

  // ---- onboarding ----
  function renderOnboarding() {
    root.appendChild(h("div", "bc-eyebrow", "MindBridge · Onboarding"));
    root.appendChild(h("h1", "bc-h1", "Select your reintegration track"));
    root.appendChild(h("p", "bc-sub", "Your track shapes the daily Operations Order. As your consistency grows, MindBridge hands structure back to you."));
    var wrap = h("div", "bc-tracks");
    (CONFIG.tracks || []).forEach(function (t) {
      var card = h("button", "bc-track"); card.type = "button";
      card.appendChild(h("div", "bc-track__code", (t.name.split("—")[0] || t.id).trim().toUpperCase()));
      card.appendChild(h("div", "bc-track__name", (t.name.split("—")[1] || t.name).trim()));
      card.appendChild(h("div", "bc-track__focus", t.focus || ""));
      card.addEventListener("click", function () { S.track = t.id; S.score = 0; S.done = []; S.choices = {}; save(); TAB = "schedule"; loadBoard(); });
      wrap.appendChild(card);
    });
    root.appendChild(wrap);
  }

  function loadBoard() {
    BOARD_PHASE = phaseFor(S.score).n || 1;
    BC.opord(S.track, BOARD_PHASE, function (o) { BLOCKS = (o && o.blocks) || []; render(); });
  }

  // ---- Schedule tab (OPORD) ----
  function renderSchedule() {
    var ph = phaseFor(S.score);
    root.appendChild(h("div", "bc-eyebrow", "Phase " + ph.n + " · " + ph.name));
    root.appendChild(h("h1", "bc-h1", "OPORD Schedule"));
    root.appendChild(h("p", "bc-sub", "Daily battle rhythm. Execute blocks in order — dependencies unlock as you confirm each one."));
    root.appendChild(h("div", "bc-section-label", "Track " + esc((trackObj().name || "").toUpperCase())));

    var firstUndone = -1;
    for (var i = 0; i < BLOCKS.length; i++) { if (S.done.indexOf(i) < 0) { firstUndone = i; break; } }
    BLOCKS.forEach(function (b, i) {
      var done = S.done.indexOf(i) >= 0, active = i === firstUndone, locked = !done && !active;
      var card = h("div", "bc-block bc-block--" + b.type + (done ? " done" : locked ? " locked" : ""));
      card.appendChild(h("div", "bc-block__time", b.time || ""));
      var body = h("div", "bc-block__body");
      body.appendChild(h("div", "bc-block__tag", tagLabel(b.type)));
      body.appendChild(h("div", "bc-block__title", b.title || ""));
      if (b.detail) body.appendChild(h("div", "bc-block__detail", b.detail));
      var ck = BOARD_PHASE + ":" + i;
      if (b.type === "asymmetric" && b.menu && b.menu.length) {
        var menu = h("div", "bc-menu");
        b.menu.forEach(function (m, mi) {
          var opt = h("button", "bc-menu__opt" + (S.choices[ck] === mi ? " chosen" : "")); opt.type = "button";
          opt.appendChild(h("b", null, m.title)); opt.appendChild(h("span", null, m.detail));
          if (!done) opt.addEventListener("click", function () { S.choices[ck] = mi; save(); render(); });
          menu.appendChild(opt);
        });
        body.appendChild(menu);
      }
      card.appendChild(body);
      var btn = h("button", "bc-block__confirm", done ? "✓ Done" : locked ? "Locked" : "Confirm");
      if (active) btn.addEventListener("click", function () {
        if (b.type === "asymmetric" && b.menu && b.menu.length && S.choices[ck] == null) { btn.textContent = "Pick one ↑"; return; }
        S.done.push(i); S.score = clamp(S.score + CONFIRM_PTS); save(); render();
      });
      card.appendChild(btn);
      root.appendChild(card);
    });

    var actions = h("div", "bc-actions");
    var sit = h("button", "bc-btn", "Voice SitRep check-in"); sit.addEventListener("click", openSitrep); actions.appendChild(sit);
    var allDone = S.done.length >= BLOCKS.length && BLOCKS.length > 0;
    var adv = h("button", "bc-btn bc-btn--ghost", allDone ? "Start next day →" : "Skip to next day");
    adv.addEventListener("click", function () {
      var before = phaseFor(S.score).n; S.done = []; save();
      loadBoard();
      if (phaseFor(S.score).n > before) toast("Phase up — you've earned more autonomy. Now: " + phaseFor(S.score).name);
    });
    actions.appendChild(adv);
    root.appendChild(actions);
  }

  // ---- Missions tab (Squads) ----
  function bannerBg(cat) {
    return {
      civic: "linear-gradient(135deg,#3a5a40,#24402d)", parks: "linear-gradient(135deg,#5a7d55,#365f3a)",
      library: "linear-gradient(135deg,#8a6d3b,#5f4a20)", clinic: "linear-gradient(135deg,#48696b,#2c4646)",
    }[cat] || "linear-gradient(135deg,#3a5a40,#24402d)";
  }
  function renderMissions() {
    root.appendChild(h("div", "bc-eyebrow", "Civic Service"));
    root.appendChild(h("h1", "bc-h1", "Squad Missions"));
    root.appendChild(h("p", "bc-sub", "Continue your service. Join a local squad and make a tangible impact across San Francisco."));
    (CONFIG.squads || []).forEach(function (m) {
      var card = h("div", "bc-mission");
      var banner = h("div", "bc-mission__banner", m.priority || ""); banner.style.background = bannerBg(m.category);
      card.appendChild(banner);
      var body = h("div", "bc-mission__body");
      body.appendChild(h("div", "bc-mission__title", m.title));
      body.appendChild(h("div", "bc-mission__loc", "📍 " + (m.location || "") + (m.note ? "  ·  " + m.note : "")));
      body.appendChild(h("div", "bc-mission__desc", m.description || ""));
      var meta = h("div", "bc-mission__meta");
      var lead = h("div", "bc-mission__lead"); lead.innerHTML = "Lead: <b>" + esc(m.lead || "—") + "</b> · Squad " + (m.filled || 0) + "/" + (m.size || 0);
      meta.appendChild(lead);
      var isJoined = S.joined.indexOf(m.id) >= 0, wait = m.status === "waitlist";
      var btn = h("button", "bc-mission__btn" + (wait ? " waitlist" : "") + (isJoined ? " joined" : ""), isJoined ? "✓ Joined" : wait ? "Waitlist only" : "Join Squad");
      if (!wait && !isJoined) btn.addEventListener("click", function () {
        S.joined.push(m.id); S.score = clamp(S.score + JOIN_PTS); save(); toast("You joined " + m.title + ". Squad up."); render();
      });
      meta.appendChild(btn); body.appendChild(meta); card.appendChild(body);
      root.appendChild(card);
    });
  }

  // ---- Progress tab (Phase-Down engine) ----
  function renderProgress() {
    var ph = phaseFor(S.score), np = nextPhase(S.score);
    root.appendChild(h("div", "bc-eyebrow", "Autonomy"));
    root.appendChild(h("h1", "bc-h1", "Phase-Down Engine"));
    root.appendChild(h("p", "bc-sub", "Steady progress — you're building your own compass."));

    var c1 = h("div", "bc-gauge");
    c1.appendChild(h("div", "bc-section-label", "Reintegration Track"));
    var stepper = h("div", "bc-stepper");
    (CONFIG.phases || []).forEach(function (p) {
      var st = h("div", "bc-step" + (p.n < ph.n ? " done" : p.n === ph.n ? " active" : ""));
      st.appendChild(h("div", "bc-step__dot", String(p.n)));
      st.appendChild(h("div", "bc-step__label", p.name));
      stepper.appendChild(st);
    });
    c1.appendChild(stepper);
    c1.appendChild(h("div", "bc-gauge__hint", "Current focus: " + (ph.desc || "")));
    root.appendChild(c1);

    var c2 = h("div", "bc-gauge");
    c2.appendChild(h("div", "bc-section-label", "Habit Stability"));
    var ring = h("div", "bc-ring");
    var circ = h("div", "bc-ring__circle");
    circ.style.background = "conic-gradient(var(--teal) " + (S.score * 3.6) + "deg, rgba(31,44,37,0.08) 0)";
    var inner = h("div", null, S.score + "%");
    inner.style.cssText = "width:68px;height:68px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;color:var(--teal);font-weight:700;";
    circ.appendChild(inner); ring.appendChild(circ);
    ring.appendChild(h("div", "bc-ring__label", np ? ("Schedule adherence. " + (np.rciThreshold - S.score) + "% more to unlock " + np.name + ".") : "Schedule adherence — Stand-Down reached. You're running your own calendar."));
    c2.appendChild(ring);
    root.appendChild(c2);

    var c3 = h("div", "bc-gauge");
    c3.appendChild(h("div", "bc-section-label", "The Stand-Down Plan · phase transition"));
    [["Mission Brief", "Daily Intent", "From rigid objective-based execution to mindful, flexible goal-setting."],
     ["Rally Point", "Community Hub", "From emergency grouping to sustained social connection."],
     ["Debrief", "Reflection", "From tactical analysis toward personal growth tracking."]].forEach(function (t) {
      var row = h("div", "bc-termrow");
      row.appendChild(h("div", "bc-termrow__from", t[0]));
      row.appendChild(h("div", "bc-termrow__arrow", "→"));
      var to = h("div"); to.style.flex = "1";
      to.appendChild(h("div", "bc-termrow__to", t[1])); to.appendChild(h("div", "bc-mission__desc", t[2]));
      row.appendChild(to); c3.appendChild(row);
    });
    root.appendChild(c3);
  }

  // ---- Profile tab ----
  function renderProfile() {
    var ph = phaseFor(S.score), track = trackObj();
    root.appendChild(h("div", "bc-eyebrow", "Profile"));
    root.appendChild(h("h1", "bc-h1", "Your Reintegration"));
    var card = h("div", "bc-gauge");
    card.appendChild(h("div", "bc-section-label", "Current Assignment"));
    card.appendChild(h("div", "bc-gauge__phase", track.name || "—"));
    card.appendChild(h("div", "bc-gauge__hint", "Phase " + ph.n + " · " + ph.name + "   ·   Freedom Gauge " + S.score + "%   ·   " + S.joined.length + " mission(s) joined"));
    root.appendChild(card);
    var actions = h("div", "bc-actions");
    var talk = h("button", "bc-btn", "Talk to your companion"); talk.addEventListener("click", closeBasecamp); actions.appendChild(talk);
    var chg = h("button", "bc-btn bc-btn--ghost", "Change track"); chg.addEventListener("click", function () { S.track = null; S.score = 0; S.done = []; S.choices = {}; save(); TAB = "schedule"; render(); }); actions.appendChild(chg);
    root.appendChild(actions);
  }

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
    var fields = {}, moodBucket = "mid";
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
      replyEl.appendChild(h("div", "bc-sitrep__reply", res.reply || "Logged."));
      if (res.crisis && res.escalation) {
        var cr = h("div", "bc-sitrep__reply"); cr.style.borderColor = "var(--danger)";
        cr.innerHTML = "<strong>" + esc(res.escalation.title || "You don't have to face this alone") + "</strong><br>Veterans Crisis Line — <strong>dial 988, then press 1</strong> · text 838255";
        replyEl.appendChild(cr);
      } else {
        S.score = clamp(S.score + (SITREP_PTS[String(res.autonomy != null ? res.autonomy : 0)] || SITREP_PTS["0"])); save();
        if ((res.resources || []).length) {
          var r = res.resources[0];
          replyEl.appendChild(h("div", "bc-sitrep__reply", "Suggested: " + r.name + (r.phone ? " · " + r.phone : "")));
        }
        render();
      }
    });
  }

  function toast(msg) {
    var t = h("div", null, msg);
    t.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#2c4632;color:#f6f3ea;padding:12px 18px;border-radius:12px;z-index:90;box-shadow:0 10px 30px rgba(40,55,45,.3);font-size:.9rem";
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  // ---- open / close ----
  function openBasecamp() {
    var v = document.getElementById("basecampView"); if (!v) return;
    v.hidden = false;
    if (!CONFIG) { BC.config(function (c) { CONFIG = c; if (S.track && CONFIG) loadBoard(); else render(); }); }
    else if (S.track) loadBoard(); else render();
  }
  function closeBasecamp() {
    var v = document.getElementById("basecampView"); if (v) v.hidden = true;
    var nav = document.getElementById("bcNav"); if (nav) nav.hidden = true;
  }
  var openBtn = document.getElementById("basecampBtn"); if (openBtn) openBtn.addEventListener("click", openBasecamp);
  var closeBtn = document.getElementById("bcClose"); if (closeBtn) closeBtn.addEventListener("click", closeBasecamp);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var m = document.getElementById("bcSitrep");
    if (m && !m.hidden) { closeSitrep(); return; }
    var v = document.getElementById("basecampView");
    if (v && !v.hidden) closeBasecamp();
  });
})();
