/* MindBridge — static (GitHub Pages) build.
   Same UI as the Flask app, but the companion logic runs entirely in the
   browser (crisis detection, retrieval, and the demo responder) using the data
   in data.js. No server, no key — a shareable, self-contained demo. */
(function () {
  "use strict";
  var D = window.MB_DATA || { crisis: {}, resources: [], kb: [], ambivalence: [], reassure: [] };

  var messages = [];
  var muted = false, listening = false, recognition = null, sending = false;
  var lastFocused = null;

  var el = {
    transcript: document.getElementById("transcript"),
    welcome: document.getElementById("welcome"),
    interim: document.getElementById("interim"),
    micBtn: document.getElementById("micBtn"),
    micLabel: document.querySelector(".mic__label"),
    composer: document.getElementById("composer"),
    input: document.getElementById("composerInput"),
    sendBtn: document.getElementById("sendBtn"),
    muteBtn: document.getElementById("muteBtn"),
    starterChips: document.getElementById("starterChips"),
    crisisOverlay: document.getElementById("crisisOverlay"),
    crisisTitle: document.getElementById("crisisTitle"),
    crisisBody: document.getElementById("crisisBody"),
    crisisResources: document.getElementById("crisisResources"),
    crisisClose: document.getElementById("crisisClose"),
  };

  // ---------------- engine (ported from the Python backend) ----------------
  function tokens(s) { return (s || "").toLowerCase().match(/[a-z0-9']+/g) || []; }

  function detectCrisis(text) {
    var c = D.crisis;
    var t = (text || "").toLowerCase();
    ["’", "‘", "ʼ", "´", "`"].forEach(function (ch) { t = t.split(ch).join("'"); });
    var stripped = t.split("'").join("");
    var matched = (c.highRiskPhrases || []).filter(function (p) {
      return t.indexOf(p) >= 0 || stripped.indexOf(p.split("'").join("")) >= 0;
    });
    var words = new Set(tokens(t));
    var kw = (c.keywords || []).filter(function (k) { return words.has(k); });
    if (matched.length && !(D.ambivalence || []).some(function (a) { return t.indexOf(a) >= 0; })) {
      var allNeg = matched.every(function (p) {
        var i = t.indexOf(p), w = t.slice(Math.max(0, i - 25), i);
        return (D.reassure || []).some(function (r) { return w.indexOf(r) >= 0; });
      });
      if (allNeg) matched = [];
    }
    return {
      triggered: matched.length > 0 || kw.length >= 2,
      title: c.escalationTitle, markdown: c.escalationMarkdown,
      spoken: c.spokenResponse, resources: c.resources || [],
    };
  }

  function retrieveKB(query, k) {
    var ql = (query || "").toLowerCase(), qset = new Set(tokens(query));
    return (D.kb || []).map(function (d) {
      var s = 0;
      (d.keywords || []).forEach(function (kw) { if (ql.indexOf(kw) >= 0) s += 4; else if (qset.has(kw)) s += 2; });
      d._t = d._t || new Set(tokens(d.text));
      var o = 0; qset.forEach(function (w) { if (d._t.has(w)) o++; }); s += o * 0.5;
      return { s: s, d: d };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; })
      .slice(0, k || 2).map(function (x) { return x.d; });
  }

  function retrieveResources(query, k) {
    var ql = (query || "").toLowerCase(), qset = new Set(tokens(query));
    return (D.resources || []).map(function (r) {
      r._t = r._t || new Set(tokens([r.name, r.category, r.description, (r.keywords || []).join(" ")].join(" ")));
      var s = 0; qset.forEach(function (w) { if (r._t.has(w)) s++; });
      (r.keywords || []).forEach(function (kw) { if (ql.indexOf(kw.toLowerCase()) >= 0) s += 2; });
      return { s: s, r: r };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; })
      .slice(0, k || 3).map(function (x) { return x.r; });
  }

  var OPENERS = [
    "Thank you for telling me that — it takes something to say it out loud.",
    "I hear you. That sounds like a lot to carry.",
    "I'm here with you, and I'm listening.",
    "That matters, and I'm glad you said it.",
    "I'm right here. Take your time.",
  ];
  var QUESTIONS = [
    "What feels like the hardest part right now?",
    "Do you want to just talk it out, or would it help to try something small together?",
    "When did you first start noticing this?",
    "What does today look like for you?",
    "Would it help to sit with that for a second before we go on?",
  ];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function demoReply(text, kb) {
    var opener = pick(OPENERS), tech = "";
    if (kb.length) {
      var bullets = (kb[0].text.match(/^[ \t]*(?:[-*]|\d+\.)[ \t]+(.*)$/gm) || [])
        .map(function (b) { return b.replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/, "").replace(/\*\*|\*|`|_/g, "").trim(); })
        .filter(function (b) { return b.length > 25; });
      if (bullets.length) {
        var b = pick(bullets).split(/(?<=[.!?])\s/)[0];
        tech = " One thing some veterans find steadying: " + b.charAt(0).toLowerCase() + b.slice(1);
      }
    }
    return (opener + tech + " " + pick(QUESTIONS)).trim();
  }

  function respond(text) {
    var c = detectCrisis(text);
    if (c.triggered) return { reply: c.spoken, crisis: true, escalation: { title: c.title, markdown: c.markdown, resources: c.resources }, resources: [], sources: [] };
    var kb = retrieveKB(text, 2), res = retrieveResources(text, 3);
    return { reply: demoReply(text, kb), crisis: false, resources: res, sources: kb.map(function (d) { return d.title; }) };
  }

  // ---------------- UI ----------------
  function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function miniMarkdown(md) {
    var html = escapeHtml(md).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    var out = [], inList = false;
    html.split("\n").forEach(function (line) {
      var m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) { if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + m[1] + "</li>"); }
      else { if (inList) { out.push("</ul>"); inList = false; } if (line.trim()) out.push("<p>" + line + "</p>"); }
    });
    if (inList) out.push("</ul>");
    return out.join("");
  }
  function scrollDown() { el.transcript.scrollTop = el.transcript.scrollHeight; }
  function clearWelcome() { if (el.welcome && el.welcome.parentNode) el.welcome.parentNode.removeChild(el.welcome); }

  function addMessage(role, text) {
    clearWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg msg--" + (role === "user" ? "user" : "bot");
    var who = document.createElement("div"); who.className = "msg__who"; who.textContent = role === "user" ? "You" : "MindBridge";
    var b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
    wrap.appendChild(who); wrap.appendChild(b); el.transcript.appendChild(wrap); scrollDown();
    return wrap;
  }
  function addSources(wrap, sources) {
    if (!sources || !sources.length) return;
    var s = document.createElement("div"); s.className = "msg__sources"; s.textContent = "Grounded in: " + sources.join(" · "); wrap.appendChild(s);
  }
  function addResources(wrap, resources) {
    if (!resources || !resources.length) return;
    var box = document.createElement("div"); box.className = "resources";
    resources.forEach(function (r) {
      var card = document.createElement("div"); card.className = "res-card";
      var n = document.createElement("div"); n.className = "res-card__name"; n.textContent = r.name; card.appendChild(n);
      if (r.description) { var d = document.createElement("div"); d.className = "res-card__desc"; d.textContent = r.description; card.appendChild(d); }
      var meta = document.createElement("div"); meta.className = "res-card__meta";
      if (r.phone) { var tel = document.createElement("a"); tel.href = "tel:" + r.phone.replace(/[^0-9+]/g, ""); tel.textContent = "📞 " + r.phone; meta.appendChild(tel); }
      if (r.url) { var a = document.createElement("a"); a.href = r.url.indexOf("http") === 0 ? r.url : "https://" + r.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "🔗 Website"; meta.appendChild(a); }
      if (meta.childNodes.length) card.appendChild(meta);
      if (r.address) { var ad = document.createElement("div"); ad.className = "res-card__addr"; ad.textContent = "📍 " + r.address; card.appendChild(ad); }
      box.appendChild(card);
    });
    wrap.appendChild(box); scrollDown();
  }
  function showTyping() {
    if (document.getElementById("typingRow")) return;
    clearWelcome();
    var w = document.createElement("div"); w.className = "msg msg--bot"; w.id = "typingRow";
    w.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    el.transcript.appendChild(w); scrollDown();
  }
  function hideTyping() { var t = document.getElementById("typingRow"); if (t) t.parentNode.removeChild(t); }

  function speak(text) {
    if (muted || !("speechSynthesis" in window) || !text) return;
    try { window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 0.98; window.speechSynthesis.speak(u); } catch (e) {}
  }

  function showCrisis(esc) {
    if (!esc) return;
    el.crisisTitle.textContent = esc.title || "You don't have to face this alone";
    el.crisisBody.innerHTML = miniMarkdown(esc.markdown || "");
    el.crisisResources.innerHTML = "";
    (esc.resources || []).forEach(function (r) {
      var card = document.createElement("div"); card.className = "res-card";
      var n = document.createElement("div"); n.className = "res-card__name"; n.textContent = r.name;
      var cc = document.createElement("div"); cc.className = "res-card__desc"; cc.textContent = (r.contact || "") + (r.note ? " — " + r.note : "");
      card.appendChild(n); card.appendChild(cc); el.crisisResources.appendChild(card);
    });
    lastFocused = document.activeElement;
    el.crisisOverlay.hidden = false;
    document.addEventListener("keydown", onCrisisKey, true);
    el.crisisClose.focus();
  }
  function focusable() { return Array.prototype.slice.call(el.crisisOverlay.querySelectorAll("a[href], button:not([disabled])")); }
  function onCrisisKey(e) {
    if (e.key === "Escape") { closeCrisis(); return; }
    if (e.key !== "Tab") return;
    var f = focusable(); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeCrisis() {
    el.crisisOverlay.hidden = true;
    document.removeEventListener("keydown", onCrisisKey, true);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  el.crisisClose.addEventListener("click", closeCrisis);

  function setSending(on) { sending = on; el.sendBtn.disabled = on; el.input.disabled = on; if (recognition) el.micBtn.disabled = on; }

  function send(text) {
    text = (text || "").trim();
    if (!text || sending) return;
    addMessage("user", text);
    messages.push({ role: "user", content: text });
    el.input.value = "";
    setSending(true); showTyping();
    // small delay so the typing indicator reads naturally
    setTimeout(function () {
      var data = respond(text);
      hideTyping();
      var reply = data.reply || "I'm here with you.";
      var row = addMessage("bot", reply);
      messages.push({ role: "assistant", content: reply });
      if (data.crisis) showCrisis(data.escalation);
      else { addSources(row, data.sources); addResources(row, data.resources); }
      speak(reply);
      setSending(false);
    }, 450);
  }

  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { el.micBtn.disabled = true; el.micLabel.textContent = "Type below"; el.micBtn.setAttribute("aria-label", "Voice input unavailable in this browser — type below"); return; }
    recognition = new SR(); recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = function (e) {
      var interim = "", final = "";
      for (var i = e.resultIndex; i < e.results.length; i++) { var tr = e.results[i][0].transcript; if (e.results[i].isFinal) final += tr; else interim += tr; }
      if (interim) { el.interim.textContent = interim; el.interim.classList.add("show"); }
      if (final) { el.interim.classList.remove("show"); el.interim.textContent = ""; stopListening(); send(final); }
    };
    recognition.onerror = function (ev) {
      var err = ev && ev.error; stopListening();
      if (err === "not-allowed" || err === "service-not-allowed") {
        el.micBtn.disabled = true; el.micLabel.textContent = "Mic blocked";
        addMessage("bot", "It looks like microphone access is blocked, so I can't hear you right now. That's okay — just type to me below, and I'm still right here.");
      }
    };
    recognition.onend = function () { stopListening(); };
  }
  function startListening() {
    if (!recognition || listening) return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    try { recognition.start(); } catch (e) { return; }
    listening = true; el.micBtn.classList.add("listening"); el.micBtn.setAttribute("aria-pressed", "true"); el.micBtn.setAttribute("aria-label", "Listening — tap to stop"); el.micLabel.textContent = "Listening…";
  }
  function stopListening() {
    listening = false; el.micBtn.classList.remove("listening"); el.micBtn.setAttribute("aria-pressed", "false"); el.micBtn.setAttribute("aria-label", "Talk to MindBridge");
    el.micLabel.textContent = recognition ? "Tap to talk" : "Type below"; el.interim.classList.remove("show");
    if (recognition) { try { recognition.stop(); } catch (e) {} }
  }
  el.micBtn.addEventListener("click", function () { if (listening) stopListening(); else startListening(); });

  el.composer.addEventListener("submit", function (e) { e.preventDefault(); send(el.input.value); });
  el.muteBtn.addEventListener("click", function () { muted = !muted; el.muteBtn.setAttribute("aria-pressed", String(muted)); if (muted && "speechSynthesis" in window) window.speechSynthesis.cancel(); });
  if (el.starterChips) el.starterChips.addEventListener("click", function (e) { var b = e.target.closest(".chip"); if (b) send(b.textContent); });

  // ---------- resources drawer ----------
  var _resLoaded = false;
  function _resCard(r) {
    var card = document.createElement("div"); card.className = "res-card";
    var n = document.createElement("div"); n.className = "res-card__name"; n.textContent = r.name; card.appendChild(n);
    if (r.description) { var d = document.createElement("div"); d.className = "res-card__desc"; d.textContent = r.description; card.appendChild(d); }
    var meta = document.createElement("div"); meta.className = "res-card__meta";
    if (r.phone) { var tel = document.createElement("a"); tel.href = "tel:" + r.phone.replace(/[^0-9+]/g, ""); tel.textContent = "📞 " + r.phone; meta.appendChild(tel); }
    if (r.url) { var a = document.createElement("a"); a.href = r.url.indexOf("http") === 0 ? r.url : "https://" + r.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "🔗 Website"; meta.appendChild(a); }
    if (meta.childNodes.length) card.appendChild(meta);
    if (r.address) { var ad = document.createElement("div"); ad.className = "res-card__addr"; ad.textContent = "📍 " + r.address; card.appendChild(ad); }
    return card;
  }
  function renderResourceList(resources) {
    var list = document.getElementById("resList"); if (!list) return;
    list.innerHTML = "";
    var by = {};
    (resources || []).forEach(function (r) { var c = r.category || "other"; (by[c] = by[c] || []).push(r); });
    Object.keys(by).sort().forEach(function (cat) {
      var h = document.createElement("div"); h.className = "res-cat"; h.textContent = cat.replace(/-/g, " "); list.appendChild(h);
      by[cat].forEach(function (r) { list.appendChild(_resCard(r)); });
    });
  }
  function openResources() {
    var ov = document.getElementById("resDrawer"); if (!ov) return;
    ov.hidden = false;
    var close = document.getElementById("resClose"); if (close) close.focus();
    if (!_resLoaded) { _resLoaded = true; renderResourceList((window.MB_DATA && MB_DATA.resources) || []); }
  }
  function closeResources() { var ov = document.getElementById("resDrawer"); if (ov) ov.hidden = true; }
  var _resBtn = document.getElementById("resBtn"); if (_resBtn) _resBtn.addEventListener("click", openResources);
  var _resClose = document.getElementById("resClose"); if (_resClose) _resClose.addEventListener("click", closeResources);
  var _resDrawer = document.getElementById("resDrawer");
  if (_resDrawer) _resDrawer.addEventListener("click", function (e) { if (e.target === _resDrawer) closeResources(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var ov = document.getElementById("resDrawer"); if (ov && !ov.hidden) closeResources(); } });

  // ---------- grounding breath ----------
  var breatheTimer = null;
  var _phases = ["Breathe in", "Hold", "Breathe out", "Hold"];
  function openBreathing() {
    var ov = document.getElementById("breatheOverlay"), ph = document.getElementById("breathePhase");
    if (!ov || !ph) return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    var i = 0; ph.textContent = _phases[0];
    clearInterval(breatheTimer);
    breatheTimer = setInterval(function () { i = (i + 1) % 4; ph.textContent = _phases[i]; }, 4000);
    ov.hidden = false;
    var done = document.getElementById("breatheDone"); if (done) done.focus();
  }
  function closeBreathing() {
    var ov = document.getElementById("breatheOverlay"); if (ov) ov.hidden = true;
    clearInterval(breatheTimer); breatheTimer = null;
  }
  var _bBtn = document.getElementById("breatheBtn");
  if (_bBtn) _bBtn.addEventListener("click", openBreathing);
  var _bDone = document.getElementById("breatheDone");
  if (_bDone) _bDone.addEventListener("click", closeBreathing);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { var ov = document.getElementById("breatheOverlay"); if (ov && !ov.hidden) closeBreathing(); }
  });

  setupRecognition();
})();
