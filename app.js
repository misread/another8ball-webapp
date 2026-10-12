(function () {
  "use strict";

  var HINTS = {
    ru: { idle: "Потряси телефон или нажми на шар", again: "Потряси ещё раз или нажми на шар", busy: "Трясу…" },
    en: { idle: "Shake your phone or tap the ball", again: "Shake again or tap the ball", busy: "Shaking…" },
  };
  var SEND = { ru: "Отправить ответ в чат", en: "Send answer to chat" };
  var SHAKE_DELTA = 12; // m/s^2 change between two samples that counts as a jolt
  var SHAKE_JOLTS = 3; // jolts needed within the window
  var SHAKE_WINDOW = 1000; // ms
  var SHAKE_DURATION = 1300; // ms of shaking before the answer floats up

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

  document.documentElement.lang = lang;
  hint.textContent = HINTS[lang].idle;

  function haptic(kind) {
    try {
      if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(kind);
    } catch (e) {}
  }

  function sizeClass(text) {
    var n = text.length;
    return n <= 12 ? "s1" : n <= 24 ? "s2" : n <= 40 ? "s3" : "s4";
  }

  function showAnswer(index) {
    var text = answers[index];
    answerEl.className = "answer";
    void answerEl.offsetWidth; // restart the CSS animation
    answerEl.textContent = text;
    answerEl.className = "answer " + sizeClass(text) + " rise";
  }

  function pickIndex() {
    if (answers.length < 2) return 0;
    var i;
    do {
      i = Math.floor(Math.random() * answers.length);
    } while (i === current);
    return i;
  }

  function offerSend() {
    if (!inTelegram || !tg.MainButton) return;
    tg.MainButton.setParams({ text: SEND[lang], color: "#7c4dff", text_color: "#ffffff" });
    tg.MainButton.show();
  }

  function shake() {
    if (busy || !answers.length) return;
    busy = true;
    ball.classList.add("shaking");
    hint.textContent = HINTS[lang].busy;
    win.classList.add("open"); // the "8" dissolves into the dark window
    if (current >= 0) answerEl.className = "answer " + sizeClass(answers[current]) + " sink";
    haptic("heavy");
    setTimeout(function () {
      current = pickIndex();
      ball.classList.remove("shaking");
      showAnswer(current);
      hint.textContent = HINTS[lang].again;
      haptic("medium");
      offerSend();
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
    window.addEventListener("devicemotion", function (e) {
      var a = e.accelerationIncludingGravity;
      if (a) onSample(a.x, a.y, a.z);
    });
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
    if (tg.MainButton) {
      tg.MainButton.onClick(function () {
        if (current >= 0) tg.sendData("a:" + lang + ":" + current); // closes the app; the bot posts it
      });
    }
  }
  startMotion();
})();
