(function () {
  "use strict";

  var HINTS = {
    ru: {
      idle: "Потряси телефон или нажми на шар", again: "Потряси ещё раз или нажми на шар", busy: "Трясу…",
      closing: "Окно закроется через {n} с", pay: "Платный шейк: {n} ⭐", ask: "Сначала задай вопрос в чате",
      error: "Не получилось, попробуй ещё раз",
    },
    en: {
      idle: "Shake your phone or tap the ball", again: "Shake again or tap the ball", busy: "Shaking…",
      closing: "Closing in {n} s", pay: "Paid shake: {n} ⭐", ask: "Ask a question in the chat first",
      error: "Something went wrong, try again",
    },
  };
  var SHAKE_DELTA = 12; // m/s^2 change between two samples that counts as a jolt
  var SHAKE_JOLTS = 3; // jolts needed within the window
  var SHAKE_WINDOW = 1000; // ms
  var SHAKE_DURATION = 1300; // ms of shaking before the answer floats up

  // The bot decides whether a shake is allowed, spends it, picks the answer and posts it to the chat.
  var BOT_URL = "https://n-zhashkova--another8ball-bot-bot.us-east.modal.run";
  var SHAKE_URL = BOT_URL + "/shake";
  var CLOSE_URL = BOT_URL + "/close";
  var DEFAULT_SECONDS = 5; // how long the answer stays on the ball (bot: /timer); outside Telegram only
  var PAID_RETRIES = 4; // the payment reaches the bot a moment after Telegram reports it

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var params = new URLSearchParams(location.search);
  var seconds = Math.max(1, Math.min(30, parseInt(params.get("t"), 10) || DEFAULT_SECONDS));
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

  var tick = null;

  function stopCountdown() {
    clearInterval(tick);
  }

  // Shows the countdown, then closes the app; the bot posts the answer to the chat by itself.
  function countdown(secs) {
    stopCountdown();
    var end = Date.now() + secs * 1000;
    var show = function () {
      var n = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      hint.textContent = HINTS[lang].closing.replace("{n}", n);
      if (n === 0) {
        stopCountdown();
        tg.close();
      }
    };
    show();
    tick = setInterval(show, 250);
  }

  var pendingShake = false; // the bot is holding an answer until the app closes or the timer ends

  // Tell the bot the app is going away so it posts the answer now instead of waiting for the timer.
  function notifyClosed() {
    if (!pendingShake || !inTelegram) return;
    pendingShake = false;
    try {
      fetch(CLOSE_URL, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" }, // a simple request: no preflight while unloading
        body: JSON.stringify({ initData: tg.initData }),
      }).catch(function () {});
    } catch (e) {}
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") notifyClosed();
  });
  window.addEventListener("pagehide", notifyClosed);

  function askBot() {
    return fetch(SHAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  function reveal(index, secs) {
    ball.classList.add("shaking");
    hint.textContent = HINTS[lang].busy;
    ball.classList.add("answered"); // the "8" fades out, revealing the empty triangle
    if (current >= 0) answerEl.className = "answer sink";
    haptic("heavy");
    setTimeout(function () {
      current = index;
      ball.classList.remove("shaking");
      showAnswer(current);
      hint.textContent = HINTS[lang].again;
      haptic("medium");
      if (secs) countdown(secs);
      busy = false;
    }, SHAKE_DURATION);
  }

  function say(key, n) {
    hint.textContent = HINTS[lang][key].replace("{n}", n);
    busy = false;
  }

  // Inside Telegram: the bot counts the shake first, so closing the app early cannot avoid it.
  function shakeViaBot(retries) {
    askBot()
      .then(function (res) {
        if (res.ok) {
          pendingShake = true;
          return reveal(res.index % answers.length, res.seconds);
        }
        if (res.reason === "retry" && retries > 0) {
          return setTimeout(function () { shakeViaBot(retries - 1); }, 700);
        }
        if (res.reason === "ask_first") return say("ask");
        if (res.reason === "pay" && res.invoice && tg.openInvoice) {
          say("pay", res.stars);
          busy = true;
          return tg.openInvoice(res.invoice, function (status) {
            if (status === "paid") {
              setTimeout(function () { shakeViaBot(PAID_RETRIES); }, 700);
            } else {
              busy = false;
            }
          });
        }
        say("error");
      })
      .catch(function () { say("error"); });
  }

  function shake() {
    if (busy || !answers.length) return;
    busy = true;
    stopCountdown();
    if (inTelegram) {
      hint.textContent = HINTS[lang].busy;
      shakeViaBot(0);
    } else {
      reveal(pickIndex(), 0); // outside Telegram (browser preview) the ball is just a toy
    }
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
