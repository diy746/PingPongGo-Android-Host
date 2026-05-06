(function(){
  "use strict";
  const LOBBY_ID = "GUEST";
  const DEFAULT_TIMEOUT = 180000;
  window.PPG_QR_TIMEOUT_MS = window.PPG_QR_TIMEOUT_MS || DEFAULT_TIMEOUT;
  window.PPG_INVITE_DEBUG = window.PPG_INVITE_DEBUG !== undefined ? window.PPG_INVITE_DEBUG : true;
  function dbg(...a){ if (window.PPG_INVITE_DEBUG) console.log("[PPG invite]", ...a); }
  function stableInviteURL(){
    const base = window.location.origin + window.location.pathname;
    return base + "?id=" + encodeURIComponent(LOBBY_ID);
  }
  function isGuest(){ return new URLSearchParams(location.search).get("id") === LOBBY_ID; }
  function removeQR(reason){
    const el = document.getElementById("ppg-lan-qr-overlay");
    if (el) { el.remove(); dbg("QR removed", reason || ""); }
    if (window.PPG_QR_TIMER) { clearTimeout(window.PPG_QR_TIMER); window.PPG_QR_TIMER = null; }
  }
  function showQR(url){
    if (isGuest()) return;
    removeQR("refresh");
    const box = document.createElement("div");
    box.id = "ppg-lan-qr-overlay";
    box.style.cssText = "position:fixed;left:18px;top:18px;z-index:99999;background:rgba(255,255,255,.96);padding:10px;border:3px solid #111;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);font:12px Arial,sans-serif;color:#111;text-align:center;max-width:180px;pointer-events:none";
    const host = location.hostname || "127.0.0.1";
    const qrSrc = (location.protocol === "https:" ? "https://" : "http://") + host + ":8124/qr.svg?url=" + encodeURIComponent(url);
    box.innerHTML = '<div style="font-weight:bold;margin-bottom:5px">SCAN TO JOIN</div>'+
      '<img alt="LAN invite QR" src="'+qrSrc+'" width="150" height="150" style="display:block;width:150px;height:150px" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'block\'">'+
      '<div style="display:none;width:150px;height:150px;align-content:center;font-size:11px">QR endpoint unavailable<br>Use link below</div>'+
      '<div style="margin-top:6px;word-break:break-all;line-height:1.15">'+url+'</div>';
    document.body.appendChild(box);
    window.PPG_QR_TIMER = setTimeout(() => removeQR("timeout"), window.PPG_QR_TIMEOUT_MS|0);
    dbg("QR shown", url);
  }
  window.PPG_STABLE_INVITE_URL = stableInviteURL;
  window.PPG_SHOW_INVITE_QR = showQR;
  window.PPG_HIDE_INVITE_QR = removeQR;
  if (window.PokiSDK && typeof window.PokiSDK.shareableURL === "function") {
    window.PokiSDK.shareableURL = function(data){
      const u = stableInviteURL();
      dbg("shareableURL overridden", data, u);
      setTimeout(() => showQR(u), 0);
      return Promise.resolve(u);
    };
  }
  const oldWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols){
    const ws = protocols === undefined ? new oldWebSocket(url) : new oldWebSocket(url, protocols);
    ws.addEventListener("message", ev => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "connect" || m.type === "connected" || (m.type === "lobbyUpdated" && m.lobbyInfo && m.lobbyInfo.players && m.lobbyInfo.players.length >= 2)) removeQR(m.type);
      } catch(e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = oldWebSocket.prototype;
  Object.keys(oldWebSocket).forEach(k => { try { window.WebSocket[k] = oldWebSocket[k]; } catch(e){} });
})();
