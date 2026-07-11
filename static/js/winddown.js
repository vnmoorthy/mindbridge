/* MindBridge — Wind-Down: a guided, self-contained evening routine that helps a
   veteran power the day down. Client-side only (works in the app and the static
   demo). Completing it lightly rewards routine consistency if a track is active. */
(function () {
  "use strict";
  var overlay = document.getElementById("windDownOverlay");
  var btn = document.getElementById("windDownBtn");
  if (!overlay) return;

  var STEPS = [
    { type: "intro", title: "Wind-Down", body: "You're off the clock. Let's take about three minutes to help your body power down for the night.", cta: "Begin" },
    { type: "breath", title: "Breathe", body: "Follow the circle — in as it grows, out as it settles. Four slow counts each way.", cta: "I'm settled — next" },
    { type: "settle", title: "Stand down", body: "Unclench your jaw. Drop your shoulders. Let your arms and legs get heavy. There's nothing to guard right now.", cta: "Next" },
    { type: "checklist", title: "Set up for sleep", items: [
      "Dim the lights and put screens away.",
      "Cool, dark, and quiet — as much as you can manage.",
      "Same wake-up time tomorrow, even if tonight is rough.",
      "Write down anything on your mind, so you can set it down for the night.",
    ], cta: "Next" },
    { type: "reflect", title: "How are you landing?", body: "One word for right now — there's no wrong answer.", options: ["Wired", "Restless", "Settling", "Calm"], cta: "Finish" },
    { type: "done", title: "Rest well.", body: "You showed up for yourself tonight — that counts. I'll be right here in the morning.", cta: "Close" },
  ];

  var step = 0, breatheTimer = null;
  var _phases = ["Breathe in", "Hold", "Breathe out", "Hold"];
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function open() { step = 0; overlay.hidden = false; render(); }
  function close() { clearInterval(breatheTimer); breatheTimer = null; overlay.hidden = true; }
  function finish() {
    try {
      if (localStorage.getItem("bc_track")) {
        var sc = Math.min(100, (parseInt(localStorage.getItem("bc_score") || "0", 10) || 0) + 3);
        localStorage.setItem("bc_score", String(sc));
      }
    } catch (e) {}
    close();
  }

  function render() {
    clearInterval(breatheTimer); breatheTimer = null;
    overlay.innerHTML = "";
    var s = STEPS[step];

    var dots = h("div", "wd-dots");
    STEPS.forEach(function (_, i) { dots.appendChild(h("span", "wd-dot" + (i <= step ? " on" : ""))); });
    overlay.appendChild(dots);

    if (s.type === "breath") {
      var circle = h("div", "breathe-circle");
      var phase = h("span", "breathe-phase", _phases[0]);
      circle.appendChild(phase); overlay.appendChild(circle);
      var i = 0;
      breatheTimer = setInterval(function () { i = (i + 1) % 4; phase.textContent = _phases[i]; }, 4000);
    }

    overlay.appendChild(h("div", "wd-title", s.title));
    if (s.body) overlay.appendChild(h("div", "wd-body", s.body));

    if (s.type === "checklist") {
      var ul = h("ul", "wd-list");
      s.items.forEach(function (it) { ul.appendChild(h("li", null, it)); });
      overlay.appendChild(ul);
    }
    if (s.type === "reflect") {
      var chips = h("div", "wd-chips");
      s.options.forEach(function (o) {
        var c = h("button", "wd-chip", o); c.type = "button";
        c.addEventListener("click", function () {
          Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove("sel"); });
          c.classList.add("sel");
        });
        chips.appendChild(c);
      });
      overlay.appendChild(chips);
    }

    var cta = h("button", "wd-cta", s.cta || "Next"); cta.type = "button";
    cta.addEventListener("click", function () { if (step >= STEPS.length - 1) finish(); else { step++; render(); } });
    overlay.appendChild(cta);
    if (step < STEPS.length - 1) {
      var skip = h("button", "wd-skip", "End wind-down"); skip.type = "button";
      skip.addEventListener("click", close); overlay.appendChild(skip);
    }
  }

  if (btn) btn.addEventListener("click", open);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.hidden) close(); });
})();
