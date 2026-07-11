/* MindBridge front-end.
   Voice in (Web Speech API), voice out (speechSynthesis), graceful text fallback,
   and a crisis overlay that takes over the moment the server flags risk. */
(function () {
  "use strict";

  var messages = []; // conversation history sent to the server
  var muted = false;
  var listening = false;
  var recognition = null;

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
    modeBadge: document.getElementById("modeBadge"),
    starterChips: document.getElementById("starterChips"),
    crisisOverlay: document.getElementById("crisisOverlay"),
    crisisTitle: document.getElementById("crisisTitle"),
    crisisBody: document.getElementById("crisisBody"),
    crisisResources: document.getElementById("crisisResources"),
    crisisClose: document.getElementById("crisisClose"),
  };

  // ---------- helpers ----------
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Minimal, safe markdown: escape first, then re-introduce a few tags.
  function miniMarkdown(md) {
    var html = escapeHtml(md);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // bullet lines -> list
    var lines = html.split("\n");
    var out = [];
    var inList = false;
    lines.forEach(function (line) {
      var m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + m[1] + "</li>");
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        if (line.trim()) out.push("<p>" + line + "</p>");
      }
    });
    if (inList) out.push("</ul>");
    return out.join("");
  }

  function scrollDown() {
    el.transcript.scrollTop = el.transcript.scrollHeight;
  }

  function clearWelcome() {
    if (el.welcome && el.welcome.parentNode) el.welcome.parentNode.removeChild(el.welcome);
  }

  // ---------- rendering ----------
  function addMessage(role, text) {
    clearWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg msg--" + (role === "user" ? "user" : "bot");
    var who = document.createElement("div");
    who.className = "msg__who";
    who.textContent = role === "user" ? "You" : "MindBridge";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.appendChild(who);
    wrap.appendChild(bubble);
    el.transcript.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function addSources(wrap, sources) {
    if (!sources || !sources.length) return;
    var s = document.createElement("div");
    s.className = "msg__sources";
    s.textContent = "Grounded in: " + sources.join(" · ");
    wrap.appendChild(s);
  }

  function addResources(wrap, resources) {
    if (!resources || !resources.length) return;
    var box = document.createElement("div");
    box.className = "resources";
    resources.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "res-card";
      var name = document.createElement("div");
      name.className = "res-card__name";
      name.textContent = r.name;
      card.appendChild(name);
      if (r.description) {
        var d = document.createElement("div");
        d.className = "res-card__desc";
        d.textContent = r.description;
        card.appendChild(d);
      }
      var meta = document.createElement("div");
      meta.className = "res-card__meta";
      if (r.phone) {
        var tel = document.createElement("a");
        tel.href = "tel:" + r.phone.replace(/[^0-9+]/g, "");
        tel.textContent = "📞 " + r.phone;
        meta.appendChild(tel);
      }
      if (r.url) {
        var link = document.createElement("a");
        link.href = r.url.indexOf("http") === 0 ? r.url : "https://" + r.url;
        link.target = "_blank"; link.rel = "noopener";
        link.textContent = "🔗 Website";
        meta.appendChild(link);
      }
      if (meta.childNodes.length) card.appendChild(meta);
      if (r.address) {
        var addr = document.createElement("div");
        addr.className = "res-card__addr";
        addr.textContent = "📍 " + r.address;
        card.appendChild(addr);
      }
      box.appendChild(card);
    });
    wrap.appendChild(box);
    scrollDown();
  }

  function showTyping() {
    if (document.getElementById("typingRow")) return;
    clearWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg msg--bot";
    wrap.id = "typingRow";
    wrap.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    el.transcript.appendChild(wrap);
    scrollDown();
  }
  function hideTyping() {
    var t = document.getElementById("typingRow");
    if (t) t.parentNode.removeChild(t);
  }

  // ---------- voice out ----------
  function speak(text) {
    if (muted || !("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98; u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  // ---------- crisis ----------
  function showCrisis(escalation) {
    if (!escalation) return;
    el.crisisTitle.textContent = escalation.title || "You don't have to face this alone";
    el.crisisBody.innerHTML = miniMarkdown(escalation.markdown || "");
    el.crisisResources.innerHTML = "";
    (escalation.resources || []).forEach(function (r) {
      var card = document.createElement("div");
      card.className = "res-card";
      var name = document.createElement("div");
      name.className = "res-card__name";
      name.textContent = r.name;
      var contact = document.createElement("div");
      contact.className = "res-card__desc";
      contact.textContent = (r.contact || "") + (r.note ? " — " + r.note : "");
      card.appendChild(name); card.appendChild(contact);
      el.crisisResources.appendChild(card);
    });
    lastFocusedBeforeCrisis = document.activeElement;
    el.crisisOverlay.hidden = false;
    document.addEventListener("keydown", onCrisisKeydown, true);
    el.crisisClose.focus();
  }

  var lastFocusedBeforeCrisis = null;
  function focusableInCrisis() {
    return Array.prototype.slice.call(
      el.crisisOverlay.querySelectorAll("a[href], button:not([disabled])")
    );
  }
  function onCrisisKeydown(e) {
    if (e.key === "Escape") { closeCrisis(); return; }
    if (e.key !== "Tab") return;
    var f = focusableInCrisis();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeCrisis() {
    el.crisisOverlay.hidden = true;
    document.removeEventListener("keydown", onCrisisKeydown, true);
    if (lastFocusedBeforeCrisis && lastFocusedBeforeCrisis.focus) lastFocusedBeforeCrisis.focus();
  }
  el.crisisClose.addEventListener("click", closeCrisis);

  // ---------- send ----------
  var sending = false;
  function setSending(on) {
    sending = on;
    el.sendBtn.disabled = on;
    el.input.disabled = on;
    if (recognition) el.micBtn.disabled = on;
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || sending) return;
    addMessage("user", text);
    messages.push({ role: "user", content: text });
    el.input.value = "";
    setSending(true);
    showTyping();

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        hideTyping();
        var reply = data.reply || "I'm here with you.";
        var row = addMessage("bot", reply);
        messages.push({ role: "assistant", content: reply });
        if (data.crisis) {
          showCrisis(data.escalation);
        } else {
          addSources(row, data.sources);
          addResources(row, data.resources);
        }
        speak(reply);
      })
      .catch(function () {
        hideTyping();
        addMessage("bot", "I'm having trouble connecting right now, but I'm still here. If this is an emergency, please call the Veterans Crisis Line: dial 988, then press 1.");
      })
      .then(function () { setSending(false); });
  }

  // ---------- voice in ----------
  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      el.micBtn.disabled = true;
      el.micLabel.textContent = "Type below";
      el.micBtn.title = "Voice input works best in Chrome. You can type instead.";
      el.micBtn.setAttribute("aria-label", "Voice input unavailable in this browser — type below instead");
      return;
    }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = function (event) {
      var interim = "", finalText = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t; else interim += t;
      }
      if (interim) { el.interim.textContent = interim; el.interim.classList.add("show"); }
      if (finalText) {
        el.interim.classList.remove("show"); el.interim.textContent = "";
        stopListening();
        send(finalText);
      }
    };
    recognition.onerror = function (event) {
      var err = event && event.error;
      stopListening();
      if (err === "not-allowed" || err === "service-not-allowed") {
        el.micBtn.disabled = true;
        el.micLabel.textContent = "Mic blocked";
        el.micBtn.setAttribute("aria-label", "Microphone blocked — type below instead");
        addMessage("bot", "It looks like microphone access is blocked, so I can't hear you right now. That's okay — just type to me in the box below, and I'm still right here.");
      }
    };
    recognition.onend = function () { stopListening(); };
  }

  function startListening() {
    if (!recognition || listening) return;
    // stop any speaking so the mic doesn't hear the app
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    try { recognition.start(); } catch (e) { return; }
    listening = true;
    el.micBtn.classList.add("listening");
    el.micBtn.setAttribute("aria-pressed", "true");
    el.micBtn.setAttribute("aria-label", "Listening — tap to stop");
    el.micLabel.textContent = "Listening…";
  }
  function stopListening() {
    listening = false;
    el.micBtn.classList.remove("listening");
    el.micBtn.setAttribute("aria-pressed", "false");
    el.micBtn.setAttribute("aria-label", "Talk to MindBridge");
    el.micLabel.textContent = recognition ? "Tap to talk" : "Type below";
    el.interim.classList.remove("show");
    if (recognition) { try { recognition.stop(); } catch (e) {} }
  }

  el.micBtn.addEventListener("click", function () {
    if (listening) stopListening(); else startListening();
  });

  // ---------- wiring ----------
  el.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send(el.input.value);
  });

  el.muteBtn.addEventListener("click", function () {
    muted = !muted;
    el.muteBtn.setAttribute("aria-pressed", String(muted));
    if (muted && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });

  if (el.starterChips) {
    el.starterChips.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (btn) send(btn.textContent);
    });
  }

  function loadHealth() {
    fetch("/api/health")
      .then(function (r) { return r.json(); })
      .then(function (h) {
        if (h.mode === "live") {
          el.modeBadge.textContent = "live";
          el.modeBadge.className = "badge badge--live";
          el.modeBadge.title = "Answering with DigitalOcean serverless inference (" + (h.model || "model") + ")";
        } else {
          el.modeBadge.textContent = "demo";
          el.modeBadge.title = "Running in self-contained demo mode — set a DigitalOcean inference key for live model replies.";
        }
      })
      .catch(function () {});
  }

  setupRecognition();
  loadHealth();
})();
