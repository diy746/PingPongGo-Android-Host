(function () {
  "use strict";

  var FIXED_CODE = "GUEST";
  var JOIN_TIMEOUT_MS = 120000;
  var HEARTBEAT_MS = 2000;
  var ABANDONED_MS = 45000;
  var QUIT_REPEAT = 8;
  var QUIT_REPEAT_MS = 80;
  var QUIT_CLOSE_DELAY_MS = 900;

  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var role = (params.get("role") || "").toUpperCase();

  // Backward compatibility for old guest QR.
  if (!role && id === FIXED_CODE) role = "GUEST";

  // Important: plain /index.html should NOT become host automatically.
  // Host browser should be opened with ?role=HOST by Android app/test page.
  var IS_HOST = role === "HOST";
  var IS_GUEST = role === "GUEST" && id === FIXED_CODE;

  window.__ppgLanMode = IS_HOST || IS_GUEST;
  window.__ppgLanRole = role || "LOCAL";
  window.__ppgLanEstablished = false;
  window.__ppgLanLocalQuit = false;
  window.__ppgLanRemoteQuit = false;
  window.__ppgLanExiting = false;
  window.__ppgLanLastPeerAlive = Date.now();

  function log() {
    console.log.apply(console, ["[PPG LIFE]"].concat([].slice.call(arguments)));
  }

  function warn() {
    console.warn.apply(console, ["[PPG LIFE]"].concat([].slice.call(arguments)));
  }

  function inviteUrl() {
    return "http://" + location.host + "/index.html?role=GUEST&id=" + FIXED_CODE;
  }

  function isPvpActive() {
    try { return window.gameVariation === 4; } catch (e) { return false; }
  }

  function callOriginalDisconnectMessage() {
    // Use original game behavior when possible: networkMessage("disconnected") returns PVP game to start screen.
    try {
      if (window.__ppgOriginalNetworkMessage) {
        window.__ppgOriginalNetworkMessage("disconnected");
        return true;
      }
    } catch (e) {
      warn("original disconnected handler failed", e);
    }
    return false;
  }

  function fallbackExit(reason) {
    warn("fallback exit", reason);
    try { if (typeof window.removeAllButs === "function") window.removeAllButs(); } catch (e) {}
    try { window.gameVariation = 0; } catch (e) {}
    try { if (typeof window.initStartScreen === "function") window.initStartScreen(); } catch (e) {}
    try {
      if (window.panel && typeof window.panel.showDisconnect === "function") {
        window.panel.showDisconnect(reason === "abandoned" ? "disconnected" : "disconnected");
      }
    } catch (e) {}
  }

  function exitBecause(reason) {
    if (window.__ppgLanExiting) return;
    window.__ppgLanExiting = true;
    warn("leaving multiplayer table:", reason);

    try {
      if (window.netLib) {
        window.netLib.connectState = 0;
        window.netLib.lobbyCode = "";
      }
    } catch (e) {}

    try { if (window.netLib && window.netLib.network) window.netLib.network.close(); } catch (e) {}

    if (!callOriginalDisconnectMessage()) {
      fallbackExit(reason);
    }
  }

  function sendReliable(type, args) {
    try {
      if (window.netLib && window.netLib.peer && typeof window.netLib.send === "function") {
        window.netLib.send(true, type, args || []);
        return true;
      }
    } catch (e) {
      warn("reliable send failed", type, e);
    }
    return false;
  }

  function repeatQuit(reason) {
    window.__ppgLanLocalQuit = true;
    for (var i = 0; i < QUIT_REPEAT; i++) {
      setTimeout(function () {
        sendReliable("ppgQuit", [Date.now(), reason || "quit"]);
      }, i * QUIT_REPEAT_MS);
    }
  }

  function markEstablished(reason) {
    if (window.__ppgLanEstablished) return;
    window.__ppgLanEstablished = true;
    window.__ppgLanLastPeerAlive = Date.now();

    try {
      if (window.netLib) {
        window.netLib.connectState = 2;
        window.netLib.lobbyCode = FIXED_CODE;
        clearTimeout(window.netLib.joinTimer);
      }
    } catch (e) {}

    log("MATCH ESTABLISHED by", reason, "— keep alive until Pause→Quit / peer abandoned");

    try { fetch("/__connected?keepMs=86400000&ts=" + Date.now()).catch(function () {}); } catch (e) {}
    try { window.dispatchEvent(new Event("ppg-lan-connected")); } catch (e) {}
  }

  function patchNetworkMessage() {
    if (typeof window.networkMessage !== "function") {
      setTimeout(patchNetworkMessage, 100);
      return;
    }
    if (window.networkMessage.__ppgLifecyclePatched) return;

    var original = window.networkMessage;
    window.__ppgOriginalNetworkMessage = original;

    window.networkMessage = function (message) {
      var head = "";
      try { head = String(message || "").split(",")[0]; } catch (e) {}

      if (head === "ppgAlive") {
        window.__ppgLanLastPeerAlive = Date.now();
        if (!window.__ppgLanEstablished && window.netLib && window.netLib.connectState === 2) {
          markEstablished("ppgAlive");
        }
        return;
      }

      if (head === "ppgQuit") {
        window.__ppgLanRemoteQuit = true;
        window.__ppgLanLastPeerAlive = Date.now();
        warn("opponent quit/abandoned via explicit ppgQuit");
        exitBecause("remote-quit");
        return;
      }

      if (head === "peerConnect" || head === "acceptPlayer") {
        markEstablished(head);
      }

      // These prove peer is alive during gameplay.
      if (head === "opData" || head === "batPos" || head === "serveBounce" || head === "hitBounce" ||
          head === "ballOff" || head === "hitNet" || head === "offSide" || head === "rematch") {
        window.__ppgLanLastPeerAlive = Date.now();
      }

      // After WebRTC is established, the dummy signaling/lobby server is no longer judge of the match.
      if (window.__ppgLanEstablished && !window.__ppgLanLocalQuit && !window.__ppgLanRemoteQuit) {
        if (head === "connectError" || head === "generalError" || head === "lobby-not-found" ||
            head === "lobby-is-full" || head === "latency") {
          warn("ignored post-connect bootstrap/lobby error:", head);
          return;
        }
        if (head === "disconnected") {
          warn("ignored generic disconnected after established match; heartbeat/ppgQuit decides");
          return;
        }
      }

      return original.apply(this, arguments);
    };

    window.networkMessage.__ppgLifecyclePatched = true;
    log("networkMessage patched");
  }

  function patchNetLib() {
    if (!window.netLib || !window.netlib) {
      setTimeout(patchNetLib, 100);
      return;
    }
    var nl = window.netLib;
    if (nl.__ppgLifecyclePatched) return;
    nl.__ppgLifecyclePatched = true;

    log("netLib found role=", window.__ppgLanRole);

    try {
      Object.defineProperty(nl, "shareURL", {
        configurable: true,
        get: function () { return inviteUrl(); },
        set: function () {}
      });
      log("invite URL ready", inviteUrl());
    } catch (e) {
      try { nl.shareURL = inviteUrl(); } catch (e2) {}
    }

    nl.createNetwork = function () {
      var self = this;
      this.network = new window.netlib.Network(this.gameId);

      this.network.on("message", function (a, b, payload) {
        if (typeof window.networkMessage === "function") window.networkMessage(payload);
      });

      this.network.on("connected", function (peer) {
        log("peer connected", peer && peer.id);
        self.peer = peer;
        self.connectState = 2;
        self.lobbyCode = FIXED_CODE;
        try { clearTimeout(self.joinTimer); } catch (e) {}
        markEstablished("netlib-connected");
        if (self.playerNum === 1) self.send(true, "peerConnect");
      });

      this.network.on("disconnected", function (event) {
        warn("netlib disconnected event", event);
        if (window.__ppgLanLocalQuit || window.__ppgLanRemoteQuit) return;
        if (window.__ppgLanEstablished) {
          self.connectState = 2;
          self.lobbyCode = FIXED_CODE;
          warn("generic disconnect ignored after establishment");
          return;
        }
        try { clearTimeout(self.joinTimer); } catch (e) {}
        self.connectState = 0;
        self.lobbyCode = "";
        if (typeof window.networkMessage === "function") window.networkMessage("disconnected");
      });

      this.network.on("lobby", function (code) {
        if (self.playerNum === 0) {
          log("lobby created", code, "forcing", FIXED_CODE);
          self.lobbyCode = FIXED_CODE;
          try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
        }
      });

      this.network.on("ready", function () {
        log("network ready");
        self.networkReady = true;
        if (self.actionOnCoonect === "createLobby") self.createLobby();
        else if (self.actionOnCoonect === "joinLobby") self.joinLobby();
      });

      function softFail(kind, err) {
        warn(kind, err);
        if (window.__ppgLanEstablished && !window.__ppgLanLocalQuit && !window.__ppgLanRemoteQuit) {
          self.connectState = 2;
          self.lobbyCode = FIXED_CODE;
          warn("ignored", kind, "after established match");
          return;
        }
        try { clearTimeout(self.joinTimer); } catch (e) {}
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        if (kind === "signalingerror" && typeof window.networkMessage === "function") {
          if (err && (err.code === "lobby-not-found" || err.code === "lobby-is-full")) window.networkMessage(err.code);
          else window.networkMessage("generalError");
        }
      }

      this.network.on("signalingerror", function (err) { softFail("signalingerror", err); });
      this.network.on("error", function (err) { softFail("error", err); });
      this.network.on("rtcerror", function (err) { softFail("rtcerror", err); });
    };

    nl.connect = function (action) {
      action = action || "";
      if (window.__ppgLanEstablished && !window.__ppgLanLocalQuit && !window.__ppgLanRemoteQuit) {
        log("connect ignored; match already established", action);
        return;
      }
      if (action === "createLobby" && !IS_HOST) { warn("blocked createLobby; not HOST tab"); return; }
      if (action === "joinLobby" && !IS_GUEST) { warn("blocked joinLobby; not GUEST tab"); return; }
      if (this.__ppgLifecycleConnecting && this.__ppgLifecycleLastAction === action) {
        log("duplicate connect ignored", action);
        return;
      }
      this.__ppgLifecycleConnecting = true;
      this.__ppgLifecycleLastAction = action;
      this.actionOnCoonect = action;
      this.lobbyCode = FIXED_CODE;
      if (this.network && !window.__ppgLanEstablished) {
        try { this.network.close(); } catch (e) {}
      }
      log("creating network", action);
      this.createNetwork();
    };

    // Existing Pause (II) → Quit game (X) calls this in multiplayer. This is our real hook.
    nl.disconnect = function () {
      log("Pause→Quit detected; notifying peer before closing");
      repeatQuit("pause-quit");
      var self = this;
      setTimeout(function () {
        try { if (self.network) self.network.close(); } catch (e) {}
        self.lobbyCode = "";
        self.playerNum = -1;
        self.connectState = 0;
        window.__ppgLanEstablished = false;
      }, QUIT_CLOSE_DELAY_MS);
    };

    nl.createLobby = function () {
      if (!IS_HOST) { warn("createLobby refused: not HOST"); return; }
      if (this.__ppgLifecycleCreateStarted) { log("duplicate create ignored"); return; }
      this.__ppgLifecycleCreateStarted = true;
      this.playerNum = 0;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      log("host fixed lobby", FIXED_CODE);
      this.network.create({ code: FIXED_CODE, codeFormat: "fixed", public: false, maxPlayers: 2 });
      try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
    };

    nl.joinLobby = function () {
      var self = this;
      if (!IS_GUEST) { warn("joinLobby refused: not GUEST"); return; }
      if (this.__ppgLifecycleJoinStarted) { log("duplicate join ignored"); return; }
      this.__ppgLifecycleJoinStarted = true;
      this.playerNum = 1;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      try { clearTimeout(this.joinTimer); } catch (e) {}
      this.joinTimer = setTimeout(function () {
        if (window.__ppgLanEstablished || self.connectState === 2) { log("join timeout ignored; connected"); return; }
        warn("join timeout after", JOIN_TIMEOUT_MS, "ms");
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        self.__ppgLifecycleJoinStarted = false;
        if (typeof window.networkMessage === "function") window.networkMessage("connectError");
      }, JOIN_TIMEOUT_MS);
      log("guest joining", FIXED_CODE);
      this.network.join(FIXED_CODE);
    };

    if (IS_HOST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgLanEstablished && nl.connectState !== 2) nl.connect("createLobby"); }, 800);
    } else if (IS_GUEST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgLanEstablished && nl.connectState !== 2) nl.connect("joinLobby"); }, 800);
    } else {
      log("LOCAL session, no LAN auto-connect");
    }
  }

  function heartbeatLoop() {
    setInterval(function () {
      if (!window.netLib || !window.__ppgLanEstablished) return;
      if (window.__ppgLanLocalQuit || window.__ppgLanRemoteQuit || window.__ppgLanExiting) return;
      try {
        window.netLib.connectState = 2;
        window.netLib.lobbyCode = FIXED_CODE;
      } catch (e) {}
      sendReliable("ppgAlive", [Date.now()]);
      var silence = Date.now() - (window.__ppgLanLastPeerAlive || Date.now());
      if (isPvpActive() && silence > ABANDONED_MS) {
        window.__ppgLanRemoteQuit = true;
        warn("opponent abandoned table; no heartbeat/gameplay for", silence, "ms");
        exitBecause("abandoned");
      }
    }, HEARTBEAT_MS);
  }

  function pageLeaveHook() {
    function leaving() {
      if (!window.__ppgLanEstablished || window.__ppgLanLocalQuit || window.__ppgLanRemoteQuit) return;
      repeatQuit("page-leave");
    }
    window.addEventListener("pagehide", leaving);
    window.addEventListener("beforeunload", leaving);
  }

  log("lifecycle wrapper loading role=", window.__ppgLanRole);
  patchNetworkMessage();
  patchNetLib();
  heartbeatLoop();
  pageLeaveHook();
})();
