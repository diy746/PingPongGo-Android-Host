(function(){
  const DELAY_MS = 2000;
  const SHOW_MS = 30000;

  let timer = null;
  let visibleTimer = null;

  function isJoinClient(){
    const p = new URLSearchParams(location.search);
    return !!(p.get("id") || p.get("gdid") || p.get("lobby"));
  }

  function makeJoinUrl(code){
    return location.origin + location.pathname + "?id=" + encodeURIComponent(code);
  }

  function removeQR(){
    document.querySelectorAll(".ppg-qr-overlay").forEach(e => e.remove());
  }

  function showQR(code){
    if (!code || isJoinClient()) return;

    removeQR();

    const url = makeJoinUrl(code);

    const box = document.createElement("div");
    box.className = "ppg-qr-overlay";
    box.style.position = "fixed";
    box.style.left = "8px";
    box.style.top = "8px";
    box.style.width = "150px";
    box.style.height = "150px";
    box.style.background = "rgba(0,0,0,0.72)";
    box.style.padding = "8px";
    box.style.borderRadius = "12px";
    box.style.zIndex = "999999";
    box.style.boxSizing = "border-box";
    box.style.transition = "opacity 0.6s ease";
    box.style.pointerEvents = "none";

    document.body.appendChild(box);

    new QRCode(box, {
      text: url,
      width: 134,
      height: 134,
      correctLevel: QRCode.CorrectLevel.M
    });

    console.log("[QR invite visible]", code, url);

    clearTimeout(visibleTimer);
    visibleTimer = setTimeout(() => {
      box.style.opacity = "0";
      setTimeout(() => box.remove(), 700);
    }, SHOW_MS);
  }

  window.PPG_showInviteQR = function(code){
    if (!code || isJoinClient()) return;
    clearTimeout(timer);
    timer = setTimeout(() => showQR(code), DELAY_MS);
  };

  window.PPG_hideInviteQR = function(){
    clearTimeout(timer);
    clearTimeout(visibleTimer);
    removeQR();
  };

  // Schowaj QR po faktycznym połączeniu WebRTC / rozpoczęciu gry.
  const oldLog = console.log;
  console.log = function(){
    try {
      const txt = Array.from(arguments).join(" ");
      if (
        txt.includes("connected") ||
        txt.includes("gameplayStart") ||
        txt.includes("rtc")
      ) {
        if (typeof window.PPG_hideInviteQR === "function") {
          window.PPG_hideInviteQR();
        }
      }
    } catch(e) {}
    return oldLog.apply(console, arguments);
  };

  console.log("[QR overlay] invite-only top-left loaded");
})();
