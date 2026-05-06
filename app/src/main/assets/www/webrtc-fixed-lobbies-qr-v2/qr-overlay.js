(function () {
  "use strict";

  var DEBUG = !!window.PPG_QR_DEBUG;
  var state = { visible: false, lastUrl: "", timer: 0 };

  function log() {
    if (DEBUG && console && console.log) console.log.apply(console, ["[PPG_QR]"].concat([].slice.call(arguments)));
  }

  function ensureBox() {
    var box = document.getElementById("ppg-qr-host-overlay");
    if (box) return box;

    box = document.createElement("div");
    box.id = "ppg-qr-host-overlay";
    box.style.cssText = [
      "position:fixed", "left:14px", "top:14px", "z-index:2147483647",
      "background:rgba(0,0,0,.78)", "color:#fff", "border-radius:14px",
      "padding:12px", "font:14px/1.25 Arial,sans-serif", "box-shadow:0 8px 24px rgba(0,0,0,.45)",
      "max-width:250px", "opacity:0", "transform:translateY(-8px)",
      "transition:opacity .25s ease, transform .25s ease", "pointer-events:auto"
    ].join(";");

    box.innerHTML = '' +
      '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">Scan to join</div>' +
      '<div id="ppg-qr-code" style="background:#fff;padding:8px;border-radius:10px;width:164px;height:164px"></div>' +
      '<div id="ppg-qr-url" style="margin-top:8px;max-width:220px;word-break:break-all;font-size:11px;color:#ddd"></div>' +
      '<button id="ppg-qr-close" style="margin-top:8px;border:0;border-radius:8px;padding:6px 9px;background:#fff;color:#000;cursor:pointer">hide</button>';
    document.body.appendChild(box);
    document.getElementById("ppg-qr-close").onclick = hide;
    return box;
  }

  function show(url, lobbyCode) {
    if (!url) return;
    // Do not show QR for guests who arrived using an invite link.
    // Host side calls this only after create->joined->shareableURL succeeds.
    var box = ensureBox();
    var qrNode = document.getElementById("ppg-qr-code");
    var urlNode = document.getElementById("ppg-qr-url");
    qrNode.innerHTML = "";

    if (window.QRCode) {
      new window.QRCode(qrNode, { text: url, width: 164, height: 164, correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0 });
    } else {
      qrNode.innerHTML = '<div style="color:#000;padding:10px;font-size:12px">QR library missing</div>';
    }
    urlNode.textContent = url;
    state.visible = true;
    state.lastUrl = url;
    clearTimeout(state.timer);
    // Safety fade: do not keep stale QR forever. Connection events hide it earlier.
    state.timer = setTimeout(hide, 120000);
    requestAnimationFrame(function () {
      box.style.opacity = "1";
      box.style.transform = "translateY(0)";
    });
    log("show", lobbyCode, url);
  }

  function hide() {
    clearTimeout(state.timer);
    state.visible = false;
    var box = document.getElementById("ppg-qr-host-overlay");
    if (!box) return;
    box.style.opacity = "0";
    box.style.transform = "translateY(-8px)";
    setTimeout(function () {
      if (!state.visible && box.parentNode) box.parentNode.removeChild(box);
    }, 280);
    log("hide");
  }

  window.PPG_QR = { show: show, hide: hide, state: state };
  window.addEventListener("ppg:lobby-link-created", function (ev) {
    var d = ev.detail || {};
    if (d.role === "host") show(d.url, d.lobbyCode);
  });
  window.addEventListener("ppg:guest-accepted", hide);
  window.addEventListener("ppg:peer-connected", hide);
  window.addEventListener("ppg:hide-qr", hide);

  log("loaded");
})();
