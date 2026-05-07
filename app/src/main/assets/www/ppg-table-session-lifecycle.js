(function () {
  "use strict";

  console.log("[PPG TABLE] lifecycle patch loading");

  var FIXED_CODE = "GUEST";
  var JOIN_TIMEOUT_MS = 120000;
  var HEARTBEAT_MS = 2000;
  var PEER_ABANDONED_MS = 45000;
  var QUIT_REPEAT = 8;
  var QUIT_INTERVAL_MS = 80;
  var CLOSE_AFTER_QUIT_MS = 900;

  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var role = (params.get("role") || "").toUpperCase();

  // Forgiving defaults to make connection easy while testing.
  if (!role && id === FIXED_CODE) role = "GUEST";
  if (!role && !id) role = "HOST";

  var IS_HOST = role === "HOST";
  var IS_GUEST = role === "GUEST" && id === FIXED_CODE;

  window.__ppgLanMode = true;
  window.__ppgLanRole = role;
  window.__ppgTableEstablished = false;
  window.__ppgTableLocalQuit = false;
  window.__ppgTableRemoteQuit = false;
  window.__ppgTableLastPeerAlive = Date.now();
  window.__ppgLanDisableDemo = true;

  function log() { console.log.apply(console, ["[PPG TABLE]"].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ["[PPG TABLE]"].concat([].slice.call(arguments))); }

  function inviteUrl() {
    return "http://" + location.host + "/index.html?role=GUEST&id=" + FIXED_CODE;
  }

  function sendReliable(type, args) {
    try {
      if (window.netLib && window.netLib.peer) {
        window.netLib.send(true, type, args || []);
        return true;
      }
    } catch (e) { warn("sendReliable failed", type, e); }
    return false;
  }

  function markEstablished(reason) {
    if (window.__ppgTableEstablished) return;
    window.__ppgTableEstablished = true;
    window.__ppgTableLastPeerAlive = Date.now();

    if (window.netLib) {
      window.netLib.connectState = 2;
      window.netLib.lobbyCode = FIXED_CODE;
      try { clearTimeout(window.netLib.joinTimer); } catch (e) {}
    }

    log("TABLE ESTABLISHED by", reason, "— signaling is now disposable");

    try { fetch("/__connected?ts=" + Date.now()).catch(function () {}); } catch (e) {}
    try { window.dispatchEvent(new Event("ppg-lan-connected")); } catch (e) {}
  }

  function resetSignalingSession(reason) {
    try { fetch("/__match-ended?reason=" + encodeURIComponent(reason) + "&ts=" + Date.now()).catch(function () {}); } catch (e) {}
  }

  function returnToFirstScreen(reason) {
    if (window.__ppgTableReturning) return;
    window.__ppgTableReturning = true;

    warn("returning to first screen:", reason);

    try { if (typeof window.removeAllButs === "function") window.removeAllButs(); } catch (e) {}
    try { window.gameVariation = 0; } catch (e) {}
    try { window.gameplayState = 0; } catch (e) {}
    try { if (typeof window.initStartScreen === "function") window.initStartScreen(); } catch (e) {}

    try {
      if (window.panel && typeof window.panel.showDisconnect === "function") {
        window.panel.showDisconnect(reason === "remote-quit" ? "disconnected" : "unableToConnect");
      }
    } catch (e) {}

    resetSignalingSession(reason);
  }

  function notifyPeerQuit() {
    window.__ppgTableLocalQuit = true;
    for (var i = 0; i < QUIT_REPEAT; i++) {
      setTimeout(function () { sendReliable("ppgTableQuit", [Date.now()]); }, i * QUIT_INTERVAL_MS);
    }
    resetSignalingSession("local-quit");
  }

  function patchNetworkMessage() {
    if (typeof window.networkMessage !== "function") {
      setTimeout(patchNetworkMessage, 100);
      return;
    }
    if (window.networkMessage.__ppgTablePatched) return;

    var original = window.networkMessage;

    window.networkMessage = function (message) {
      var head = "";
      try { head = String(message || "").split(",")[0]; } catch (e) {}

      if (head === "ppgTableAlive") {
        window.__ppgTableLastPeerAlive = Date.now();
        if (!window.__ppgTableEstablished && window.netLib && window.netLib.connectState === 2) {
          markEstablished("ppgTableAlive");
        }
        return;
      }

      if (head === "ppgTableQuit") {
        window.__ppgTableRemoteQuit = true;
        window.__ppgTableLastPeerAlive = Date.now();
        warn("peer quit/abandoned table via explicit quit message");
        try { if (window.netLib && window.netLib.network) window.netLib.network.close(); } catch (e) {}
        returnToFirstScreen("remote-quit");
        return;
      }

      if (head === "peerConnect" || head === "acceptPlayer") {
        markEstablished(head);
      }

      if (head === "opData" || head === "batPos" || head === "serveBounce" || head === "hitBounce" || head === "offSide" || head === "rematch") {
        window.__ppgTableLastPeerAlive = Date.now();
      }

      if (window.__ppgTableEstablished && !window.__ppgTableLocalQuit && !window.__ppgTableRemoteQuit) {
        if (head === "connectError" || head === "generalError" || head === "lobby-not-found" || head === "lobby-is-full" || head === "latency") {
          warn("ignored post-establish bootstrap error:", head);
          return;
        }
        if (head === "disconnected") {
          warn("ignored generic disconnected after table established; heartbeat decides real abandon");
          return;
        }
      }

      return original.apply(this, arguments);
    };

    window.networkMessage.__ppgTablePatched = true;
    log("networkMessage patched");
  }

  function patchNetLib() {
    if (!window.netLib || !window.netlib) {
      setTimeout(patchNetLib, 100);
      return;
    }
    var nl = window.netLib;
    if (nl.__ppgTablePatched) return;
    nl.__ppgTablePatched = true;

    log("netLib found role=", role);

    try {
      Object.defineProperty(nl, "shareURL", { configurable: true, get: inviteUrl, set: function () {} });
      log("invite URL ready", inviteUrl());
    } catch (e) { nl.shareURL = inviteUrl(); }

    var originalConnect = nl.connect;
    nl.connect = function (action) {
      action = action || "";

      if (window.__ppgTableEstablished && !window.__ppgTableLocalQuit && !window.__ppgTableRemoteQuit) {
        log("connect ignored; table already established", action);
        return;
      }

      if (action === "createLobby" && !IS_HOST) { warn("blocked createLobby: not host tab"); return; }
      if (action === "joinLobby" && !IS_GUEST) { warn("blocked joinLobby: not guest tab"); return; }

      var now = Date.now();
      if (this.__ppgTableLastConnectAction === action && now - (this.__ppgTableLastConnectAt || 0) < 2500) {
        log("duplicate connect ignored", action);
        return;
      }
      this.__ppgTableLastConnectAction = action;
      this.__ppgTableLastConnectAt = now;
      this.lobbyCode = FIXED_CODE;

      return originalConnect.call(this, action);
    };

    nl.createLobby = function () {
      if (!IS_HOST) { warn("createLobby refused: not host tab"); return; }
      if (this.__ppgTableCreateStarted) { log("duplicate create ignored"); return; }
      this.__ppgTableCreateStarted = true;
      this.playerNum = 0;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      log("host fixed lobby GUEST");
      this.network.create({ code: FIXED_CODE, codeFormat: "fixed", public: false, maxPlayers: 2 });
      try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
    };

    nl.joinLobby = function () {
      var self = this;
      if (!IS_GUEST) { warn("joinLobby refused: not guest tab"); return; }
      if (this.__ppgTableJoinStarted) { log("duplicate join ignored"); return; }
      this.__ppgTableJoinStarted = true;
      this.playerNum = 1;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      clearTimeout(this.joinTimer);
      this.joinTimer = setTimeout(function () {
        if (window.__ppgTableEstablished || self.connectState === 2) return;
        warn("join timeout", JOIN_TIMEOUT_MS);
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        self.__ppgTableJoinStarted = false;
        if (typeof window.networkMessage === "function") window.networkMessage("connectError");
      }, JOIN_TIMEOUT_MS);
      log("guest joining fixed lobby GUEST");
      this.network.join(FIXED_CODE);
    };

    var originalDisconnect = nl.disconnect;
    nl.disconnect = function () {
      if (window.__ppgTableEstablished && !window.__ppgTableRemoteQuit) {
        log("Pause→Quit: notifying peer, then closing local table");
        notifyPeerQuit();
        var self = this;
        setTimeout(function () {
          try { if (self.network) self.network.close(); } catch (e) {}
          try { originalDisconnect.call(self); } catch (e) {
            self.lobbyCode = ""; self.playerNum = -1; self.connectState = 0;
          }
        }, CLOSE_AFTER_QUIT_MS);
        return;
      }
      return originalDisconnect.call(this);
    };

    if (IS_HOST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgTableEstablished && nl.connectState !== 2) nl.connect("createLobby"); }, 800);
    } else if (IS_GUEST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgTableEstablished && nl.connectState !== 2) nl.connect("joinLobby"); }, 800);
    } else {
      warn("unknown role; no auto connect");
    }
  }

  function heartbeat() {
    setInterval(function () {
      if (!window.netLib || !window.__ppgTableEstablished) return;
      if (window.__ppgTableLocalQuit || window.__ppgTableRemoteQuit) return;
      try { window.netLib.connectState = 2; window.netLib.lobbyCode = FIXED_CODE; } catch (e) {}
      sendReliable("ppgTableAlive", [Date.now()]);
      var silence = Date.now() - (window.__ppgTableLastPeerAlive || Date.now());
      if (silence > PEER_ABANDONED_MS) {
        warn("peer abandoned table, silence=", silence);
        window.__ppgTableRemoteQuit = true;
        returnToFirstScreen("peer-abandoned");
      }
    }, HEARTBEAT_MS);
  }

  function pageLeave() {
    function leave() {
      if (!window.__ppgTableEstablished) return;
      if (window.__ppgTableLocalQuit || window.__ppgTableRemoteQuit) return;
      notifyPeerQuit();
    }
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);
  }

  patchNetworkMessage();
  patchNetLib();
  heartbeat();
  pageLeave();
})();
