(function () {
  "use strict";

  var HINTS = {
    ru: { idle: "Потряси телефон или нажми на шар", busy: "Трясу…" },
    en: { idle: "Shake your phone or tap the ball", busy: "Shaking…" },
  };
  var SHAKE_DELTA = 12; // m/s^2 change between two samples that counts as a jolt
  var SHAKE_JOLTS = 3; // jolts needed within the window
  var SHAKE_WINDOW = 1000; // ms
  var SHAKE_DURATION = 1300; // ms of animation before sending the result

  var tg = window.Telegram && window.Telegram.WebApp;
  var params = new URLSearchParams(location.search);
  var lang = params.get("lang") === "ru" ? "ru" : "en";
  var ball = document.getElementById("ball");
  var hint = document.getElementById("hint");
  var busy = false;
  var jolts = [];
  var last = null;

  document.documentElement.lang = lang;
  hint.textContent = HINTS[lang].idle;

  function haptic(kind) {
    try {
      if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(kind);
    } catch (e) {}
  }

  function shake() {
    if (busy) return;
    busy = true;
    ball.classList.add("shaking");
    hint.textContent = HINTS[lang].busy;
    haptic("heavy");
    setTimeout(function () {
      haptic("medium");
      if (tg && tg.sendData) {
        tg.sendData("shake"); // closes the Mini App; the bot replies in the chat
      } else {
        busy = false; // opened outside Telegram (preview)
        ball.classList.remove("shaking");
        hint.textContent = HINTS[lang].idle;
      }
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
    var acc = tg && tg.Accelerometer;
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

  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch (e) {}
  }
  startMotion();
})();
