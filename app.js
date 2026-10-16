(function () {
  "use strict";

  var HINTS = {
    ru: { idle: "Потряси телефон или нажми на шар", again: "Потряси ещё раз или нажми на шар", busy: "Трясу…" },
    en: { idle: "Shake your phone or tap the ball", again: "Shake again or tap the ball", busy: "Shaking…" },
  };
  var SHAKE_DELTA = 12; // m/s^2 change between two samples that counts as a jolt
  var SHAKE_JOLTS = 3; // jolts needed within the window
  var SHAKE_WINDOW = 1000; // ms
  var SHAKE_DURATION = 1300; // ms of shaking before the answer floats up

  // Worker that posts the answer to the chat (worker/); empty = answers stay inside the app
  var WORKER_URL = "https://another8ball-answer.n-zhashkova.workers.dev";
  var POST_DELAY = 5000; // ms the user sees the answer before it goes to the chat and the app closes

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var params = new URLSearchParams(location.search);
  var lang = params.get("lang") === "ru" ? "ru" : "en";
  var answers = (window.ANSWERS && window.ANSWERS[lang]) || [];
  var ball = document.getElementById("ball");
  var win = document.getElementById("window");
  var answerEl = document.getElementById("answer");
  var hint = document.getElementById("hint");
  var busy = false;
  var current = -1;
  var jolts = [];
  var last = null;

  var face8 = document.getElementById("face8");
  function ready() { ball.classList.add("ready"); }
  if (face8.complete && face8.naturalWidth) ready();
  else {
    face8.addEventListener("load", ready);
    face8.addEventListener("error", ready);
    setTimeout(ready, 4000); // never leave the page blank
  }

  document.documentElement.lang = lang;
  hint.textContent = HINTS[lang].idle;

  function haptic(kind) {
    try {
      if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(kind);
    } catch (e) {}
  }

  // Inner triangle of ball.jpg in ball-width fractions (inset from the glass edge).
  var TRI = { apexY: 0.279, baseY: 0.6, slope: 0.576, inset: 0.026, cx: 0.5 };
  var LINE_H = 1.12;
  var measure = document.createElement("canvas").getContext("2d");

  function halfWidthAt(y) {
    return Math.max(0, TRI.slope * (y - TRI.apexY) - TRI.inset);
  }

  function wrap(words, width) {
    var lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + " " + words[i] : words[i];
      if (line && measure.measureText(t).width > width) {
        lines.push(line);
        line = words[i];
      } else {
        line = t;
      }
    }
    lines.push(line);
    return lines;
  }

  // Largest font size (fraction of ball width) whose centered lines all stay inside the triangle.
  function fitText(text) {
    var words = text.split(/\s+/);
    var best = null;
    for (var size = 0.1; size >= 0.022 && !best; size -= 0.002) {
      measure.font = "700 100px Philosopher, Georgia, serif";
      var k = size / 100; // px at 100px font -> ball fraction
      for (var w = 0.34; w >= 0.1 && !best; w -= 0.01) {
        var lines = wrap(words, w / k);
        var widths = lines.map(function (l) { return measure.measureText(l).width * k; });
        var h = lines.length * size * LINE_H;
        var maxW = Math.max.apply(null, widths);
        if (maxW > w * 1.001 || h > TRI.baseY - TRI.apexY) continue;
        // try block centers from the triangle's visual center outwards
        for (var d = 0; d <= 0.1 && !best; d += 0.005) {
          var signs = d ? [1, -1] : [1];
          for (var s = 0; s < signs.length && !best; s++) {
            var top = 0.51 + signs[s] * d - h / 2;
            if (top + h > TRI.baseY) continue;
            var ok = true;
            for (var i = 0; i < lines.length && ok; i++) {
              var y = top + i * size * LINE_H + size * 0.15; // glyphs start a little below the line box top
              if (widths[i] / 2 > halfWidthAt(y)) ok = false;
            }
            if (ok) best = { lines: lines, size: size, top: top };
          }
        }
      }
    }
    return best || { lines: [text], size: 0.022, top: 0.46 };
  }

  function showAnswer(index) {
    var fit = fitText(answers[index]);
    answerEl.className = "answer";
    void answerEl.offsetWidth; // restart the CSS animation
    answerEl.textContent = "";
    fit.lines.forEach(function (l) {
      var row = document.createElement("span");
      row.textContent = l;
      answerEl.appendChild(row);
    });
    answerEl.style.fontSize = fit.size * 100 + "cqw";
    answerEl.style.top = fit.top * 100 + "cqw";
    answerEl.className = "answer rise";
  }

  function pickIndex() {
    if (answers.length < 2) return 0;
    var i;
    do {
      i = Math.floor(Math.random() * answers.length);
    } while (i === current);
    return i;
  }

  function postToChat(text) {
    if (!WORKER_URL || !inTelegram) return;
    if (!new URLSearchParams(tg.initData).get("query_id")) return;
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData, text: text }),
    })
      .then(function (r) { if (r.ok) tg.close(); })
      .catch(function () {});
  }

  function shake() {
    if (busy || !answers.length) return;
    busy = true;
    ball.classList.add("shaking");
    hint.textContent = HINTS[lang].busy;
    ball.classList.add("answered"); // the "8" fades out, revealing the empty triangle
    if (current >= 0) answerEl.className = "answer sink";
    haptic("heavy");
    setTimeout(function () {
      current = pickIndex();
      ball.classList.remove("shaking");
      showAnswer(current);
      hint.textContent = HINTS[lang].again;
      haptic("medium");
      var shown = current;
      setTimeout(function () { if (shown === current) postToChat(answers[shown]); }, POST_DELAY);
      busy = false;
    }, SHAKE_DURATION);
  }

  function onSample(x, y, z) {
    if (x == null || y == null || z == null) return;
    if (last) {
      var d = Math.hypot(x - last[0], y - last[1], z - last[2]);
      if (d > SHAKE_DELTA) {
        var now = Date.now();
        jolts.push(now);
        jolts = jolts.filter(function (t) { return now - t < SHAKE_WINDOW; });
        if (jolts.length >= SHAKE_JOLTS) {
          jolts = [];
          shake();
        }
      }
    }
    last = [x, y, z];
  }

  function startMotionFallback() {
    var listen = function () {
      window.addEventListener("devicemotion", function (e) {
        var a = e.accelerationIncludingGravity;
        if (a) onSample(a.x, a.y, a.z);
      });
    };
    var DM = window.DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === "function") {
      // iOS Safari: motion needs a user gesture, ask on the first tap
      var ask = function () {
        document.removeEventListener("click", ask, true);
        DM.requestPermission().then(function (r) { if (r === "granted") listen(); }).catch(function () {});
      };
      document.addEventListener("click", ask, true);
    } else {
      listen();
    }
  }

  function startMotion() {
    var acc = inTelegram && tg.Accelerometer;
    if (acc && typeof acc.start === "function") {
      tg.onEvent("accelerometerChanged", function () { onSample(acc.x, acc.y, acc.z); });
      tg.onEvent("accelerometerFailed", startMotionFallback);
      try {
        acc.start({ refresh_rate: 60 });
      } catch (e) {
        startMotionFallback();
      }
    } else {
      startMotionFallback();
    }
  }

  ball.addEventListener("click", shake);

  if (inTelegram) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch (e) {}
  }
  if (document.fonts && document.fonts.load) document.fonts.load("700 20px Philosopher", "Абв Abc");
  startMotion();
})();
