(function () {
  "use strict";

  console.log("[PPG DEMO] idle demo module loaded");

  var DEMO_IDLE_MS = 12000;      // change this later if needed
  var DEMO_TICK_MS = 33;
  var demoTimer = null;
  var demoActive = false;
  var lastInputAt = Date.now();

  function log() {
    console.log.apply(console, ["[PPG DEMO]"].concat([].slice.call(arguments)));
  }

  function hasLanRole() {
    var p = new URLSearchParams(location.search);
    return !!(p.get("role") || p.get("id"));
  }

  function isSafeStartScreen() {
    try {
      if (hasLanRole()) return false;
      if (window.__ppgLanMode || window.__ppgLanEstablished) return false;
      if (window.netLib && window.netLib.connectState && window.netLib.connectState !== 0) return false;

      /*
        The original game uses initStartScreen() for the first menu.
        On that menu, gameVariation is normally 0/undefined and gameState is not active PVP.
      */
      if (typeof window.initGame !== "function") return false;
      if (typeof window.initStartScreen !== "function") return false;
      if (typeof window.removeStartButs !== "function") return false;

      if (typeof window.gameVariation !== "undefined" && window.gameVariation === 4) return false;
      if (typeof window.gameState !== "undefined" && window.gameState !== "start" && window.gameState !== "splash") {
        /*
          Some builds may use another menu name. Permit only if not actively in game.
        */
        if (window.gameState === "game" || window.gameState === "network" || window.gameState === "batShop" || window.gameState === "awards") {
          return false;
        }
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  function resetIdleTimer() {
    lastInputAt = Date.now();

    if (demoActive) {
      stopDemo("user input");
      return;
    }

    clearTimeout(demoTimer);
    demoTimer = setTimeout(function () {
      if (Date.now() - lastInputAt >= DEMO_IDLE_MS) {
        startDemo();
      }
    }, DEMO_IDLE_MS);

    log("idle timer armed", DEMO_IDLE_MS + "ms");
  }

  function startDemo() {
    if (demoActive) return;

    if (!isSafeStartScreen()) {
      resetIdleTimer();
      return;
    }

    demoActive = true;
    window.__ppgDemoActive = true;

    log("starting CPU-style demo after idle");

    try {
      window.removeStartButs();
    } catch (e) {}

    try {
      window.gameVariation = 0;
    } catch (e) {}

    /*
      Prefer direct initGame to avoid ad flow / user gesture issues.
      This starts the normal human-vs-CPU match, then we auto-drive userBat.
    */
    try {
      window.initGame();
    } catch (e) {
      try {
        if (typeof window.butEventHandler === "function") {
          window.butEventHandler("startTouch", {
            isDown: false,
            isUp: true,
            isBeingDragged: false,
            hasLeft: false
          });
        }
      } catch (e2) {
        console.warn("[PPG DEMO] could not start demo", e, e2);
        demoActive = false;
        window.__ppgDemoActive = false;
        resetIdleTimer();
        return;
      }
    }

    try {
      if (window.enemyBat) {
        window.enemyBat.trackBall = true;
      }
    } catch (e) {}

    autoDriveUserBat();
  }

  function activeBall() {
    try {
      if (!window.aBalls || !window.aBalls.length) return null;
      return window.aBalls[window.curBallId || 0] || window.aBalls[0];
    } catch (e) {
      return null;
    }
  }

  function autoDriveUserBat() {
    if (!demoActive) return;

    try {
      var bat = window.userBat;
      var ball = activeBall();

      if (bat && ball) {
        /*
          Use real ball screen position when available.
          Fallback to table coordinates if only tablePosX/tablePosY exists.
        */
        var targetX = typeof ball.x === "number" ? ball.x : null;
        var targetY = typeof ball.y === "number" ? ball.y : null;

        if (targetX === null && typeof ball.tablePosX === "number") {
          targetX = window.canvas ? window.canvas.width / 2 + ball.tablePosX * 220 : 400 + ball.tablePosX * 220;
        }

        if (targetY === null && typeof ball.tablePosY === "number") {
          targetY = window.canvas ? window.canvas.height * (0.72 + (ball.tablePosY - 0.5) * 0.25) : 620;
        }

        if (targetX !== null) {
          bat.targX = targetX;
        }

        if (targetY !== null) {
          bat.targY = targetY;
        }

        /*
          Add small motion so it looks alive, not perfectly robotic.
        */
        if (typeof bat.targX === "number") {
          bat.targX += Math.sin(Date.now() / 280) * 20;
        }
      }
    } catch (e) {}

    setTimeout(autoDriveUserBat, DEMO_TICK_MS);
  }

  function stopDemo(reason) {
    if (!demoActive) return;

    log("exiting demo:", reason);

    demoActive = false;
    window.__ppgDemoActive = false;

    try {
      if (typeof window.removeAllButs === "function") window.removeAllButs();
    } catch (e) {}

    try {
      window.gameVariation = 0;
    } catch (e) {}

    try {
      if (typeof window.initStartScreen === "function") {
        window.initStartScreen();
      }
    } catch (e) {}

    resetIdleTimer();
  }

  function installInputHooks() {
    ["pointerdown", "mousedown", "touchstart", "keydown"].forEach(function (name) {
      window.addEventListener(name, resetIdleTimer, true);
      document.addEventListener(name, resetIdleTimer, true);
    });
  }

  window.PPGIdleDemo = {
    start: startDemo,
    stop: function () { stopDemo("manual"); },
    setIdleMs: function (ms) {
      DEMO_IDLE_MS = Math.max(3000, parseInt(ms, 10) || 12000);
      resetIdleTimer();
      log("idle time changed to", DEMO_IDLE_MS);
    }
  };

  window.addEventListener("load", function () {
    installInputHooks();
    setTimeout(resetIdleTimer, 1500);
  });
})();
