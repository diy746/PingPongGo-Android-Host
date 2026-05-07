(function () {
  "use strict";

  var FIXED_CODE = "GUEST";
  var role = new URLSearchParams(location.search).get("id") === FIXED_CODE ? "guest" : "host";
  var guestUrl = "http://" + location.host + "/index.html?id=" + FIXED_CODE;

  function log() {
    console.log("[PPG QR]", ...arguments);
  }

  function ensureOverlay() {
    var box = document.getElementById("ppg-lan-qr-overlay");
    if (box) return box;

    box = document.createElement("div");
    box.id = "ppg-lan-qr-overlay";
    box.style.position = "fixed";
    box.style.left = "20px";
    box.style.top = "20px";
    box.style.width = "220px";
    box.style.minHeight = "220px";
    box.style.background = "rgba(255,255,255,0.96)";
    box.style.border = "2px solid #222";
    box.style.borderRadius = "12px";
    box.style.padding = "12px";
    box.style.zIndex = "99999";
    box.style.boxShadow = "0 8px 20px rgba(0,0,0,0.25)";
    box.style.transition = "opacity 0.6s ease";
    box.style.opacity = "1";

    var title = document.createElement("div");
    title.textContent = "INVITE PLAYER";
    title.style.fontWeight = "bold";
    title.style.fontSize = "16px";
    title.style.marginBottom = "8px";

    var canvasWrap = document.createElement("div");
    canvasWrap.id = "ppg-lan-qr-canvas-wrap";
    canvasWrap.style.width = "180px";
    canvasWrap.style.height = "180px";
    canvasWrap.style.margin = "0 auto";
    canvasWrap.style.display = "flex";
    canvasWrap.style.alignItems = "center";
    canvasWrap.style.justifyContent = "center";
    canvasWrap.style.background = "#fff";

    var url = document.createElement("div");
    url.textContent = guestUrl;
    url.style.fontSize = "10px";
    url.style.wordBreak = "break-all";
    url.style.marginTop = "8px";

    box.appendChild(title);
    box.appendChild(canvasWrap);
    box.appendChild(url);
    document.body.appendChild(box);
    return box;
  }

  function hideOverlay() {
    var box = document.getElementById("ppg-lan-qr-overlay");
    if (!box) return;
    box.style.opacity = "0";
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 700);
  }

  function renderFallbackQr(canvas, text) {
    // fallback pseudo-QR if real library is missing
    var ctx = canvas.getContext("2d");
    var size = canvas.width;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";

    var cell = 6;
    for (var y = 0; y < size; y += cell) {
      for (var x = 0; x < size; x += cell) {
        var i = ((x / cell) + (y / cell) * 7 + text.length) % 3;
        if (i === 0) ctx.fillRect(x, y, cell - 1, cell - 1);
      }
    }

    // finder-like corners
    function finder(px, py) {
      ctx.fillRect(px, py, 42, 42);
      ctx.fillStyle = "#fff";
      ctx.fillRect(px + 6, py + 6, 30, 30);
      ctx.fillStyle = "#000";
      ctx.fillRect(px + 12, py + 12, 18, 18);
    }
    finder(0, 0);
    finder(size - 42, 0);
    finder(0, size - 42);
  }

  function renderQr() {
    if (role !== "host") {
      log("guest mode, no QR");
      hideOverlay();
      return;
    }

    var box = ensureOverlay();
    var wrap = document.getElementById("ppg-lan-qr-canvas-wrap");
    if (!wrap) return;

    wrap.innerHTML = "";

    var canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 180;
    wrap.appendChild(canvas);

    // if a QR library exists, use it; otherwise fallback
    try {
      if (window.QRCode) {
        wrap.innerHTML = "";
        new window.QRCode(wrap, {
          text: guestUrl,
          width: 180,
          height: 180
        });
        log("real QR rendered");
      } else {
        renderFallbackQr(canvas, guestUrl);
        log("fallback QR rendered");
      }
    } catch (e) {
      renderFallbackQr(canvas, guestUrl);
      log("fallback QR rendered after error", e);
    }
  }

  function watchConnection() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.netLib && window.netLib.connectState === 2) {
        log("connected, hiding QR");
        hideOverlay();
        clearInterval(iv);
        return;
      }
      if (tries > 180) clearInterval(iv);
    }, 500);
  }

  window.addEventListener("load", function () {
    if (role === "guest") {
      hideOverlay();
      return;
    }
    setTimeout(renderQr, 800);
    setTimeout(watchConnection, 1000);
  });

  window.addEventListener("ppg-lan-connected", hideOverlay);
})();
