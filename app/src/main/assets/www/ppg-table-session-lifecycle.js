(function () {
  "use strict";

  console.log("[PPG TABLE] lifecycle wrapper loading");

  var FIXED_CODE = "GUEST";
  var JOIN_TIMEOUT_MS = 120000;
  var HEARTBEAT_MS = 2000;
  var PEER_ABANDONED_MS = 45000;
  var QUIT_REPEAT = 10;
  var QUIT_SPACING_MS = 80;
  var CLOSE_AFTER_QUIT_MS = 1200;

  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var role = (params.get("role") || "").toUpperCase();

  if (!role && id === FIXED_CODE) role = "GUEST";
  if (!role && !id) role = "HOST";

  var IS_HOST = role === "HOST";
  var IS_GUEST = role === "GUEST" && id === FIXED_CODE;

  window.__ppgLanMode = true;
  window.__ppgLanRole = role;
  window.__ppgTableEstablished = false;
  window.__ppgTableLocalQuit = false;
  window.__ppgTableRemoteQuit = false;
  window.__ppgTableExiting = false;
  window.__ppgLanDisableDemo = true;
  window.__ppgLastPeerAlive = Date.now();

  var originalNetworkMessage = null;

  function log() { console.log.apply(console, ["[PPG TABLE]"].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ["[PPG TABLE]"].concat([].slice.call(arguments))); }

  function guestInviteUrl() {
    return "http://" + location.host + "/index.html?role=GUEST&id=" + FIXED_CODE;
  }

  function serverConnected() {
    try { fetch("/__connected?ts=" + Date.now()).catch(function () {}); } catch (e) {}
  }

  function serverMatchEnded(reason) {
    try { fetch("/__match-ended?reason=" + encodeURIComponent(reason || "unknown") + "&ts=" + Date.now()).catch(function () {}); } catch (e) {}
  }

  function safeSendReliable(type, args) {
    try {
      if (window.netLib && window.netLib.peer) {
        window.netLib.send(true, type, args || []);
        return true;
      }
    } catch (e) {
      warn("send failed", type, e);
    }
    return false;
  }

  function markEstablished(reason) {
    if (window.__ppgTableEstablished) return;

    window.__ppgTableEstablished = true;
    window.__ppgLastPeerAlive = Date.now();

    if (window.netLib) {
      window.netLib.connectState = 2;
      window.netLib.lobbyCode = FIXED_CODE;
      try { clearTimeout(window.netLib.joinTimer); } catch (e) {}
    }

    log("TABLE ESTABLISHED by", reason, "- signaling is now bootstrap-only");
    serverConnected();

    try { window.dispatchEvent(new Event("ppg-lan-connected")); } catch (e) {}
  }

  function returnToFirstScreen(reason) {
    if (window.__ppgTableExiting) return;
    window.__ppgTableExiting = true;

    warn("ending multiplayer table:", reason);
    serverMatchEnded(reason);

    if (window.netLib) {
      try { window.netLib.connectState = 0; } catch (e) {}
      try { window.netLib.lobbyCode = ""; } catch (e) {}
      try { window.netLib.playerNum = -1; } catch (e) {}
    }

    // Prefer the original game disconnect flow, because it knows how to leave PVP screens.
    try {
      if (originalNetworkMessage) {
        originalNetworkMessage("disconnected");
        return;
      }
    } catch (e) {
      warn("original disconnected flow failed", e);
    }

    // Fallback to first screen.
    try { if (typeof window.removeAllButs === "function") window.removeAllButs(); } catch (e) {}
    try { window.gameVariation = 0; } catch (e) {}
    try { if (typeof window.initStartScreen === "function") window.initStartScreen(); } catch (e) {}
  }

  function patchNetworkMessage() {
    if (typeof window.networkMessage !== "function") {
      setTimeout(patchNetworkMessage, 100);
      return;
    }
    if (window.networkMessage.__ppgTableLifecyclePatched) return;

    originalNetworkMessage = window.networkMessage;

    window.networkMessage = function (message) {
      var head = "";
      try { head = String(message || "").split(",")[0]; } catch (e) {}

      // Lifecycle-only messages, never pass to original switch.
      if (head === "ppgAlive") {
        window.__ppgLastPeerAlive = Date.now();
        if (!window.__ppgTableEstablished && window.netLib && window.netLib.connectState === 2) {
          markEstablished("ppgAlive");
        }
        return;
      }

      if (head === "ppgTableQuit" || head === "ppgQuit") {
        window.__ppgTableRemoteQuit = true;
        window.__ppgLastPeerAlive = Date.now();
        warn("opponent quit/abandoned table");
        returnToFirstScreen("remote-quit");
        return;
      }

      if (head === "peerConnect" || head === "acceptPlayer") markEstablished(head);

      if (
        head === "opData" || head === "batPos" || head === "serveBounce" ||
        head === "hitBounce" || head === "offSide" || head === "rematch"
      ) {
        window.__ppgLastPeerAlive = Date.now();
      }

      // Once the table is shared, signaling noise must not kill the table.
      if (window.__ppgTableEstablished && !window.__ppgTableLocalQuit && !window.__ppgTableRemoteQuit) {
        if (
          head === "connectError" || head === "generalError" ||
          head === "lobby-not-found" || head === "lobby-is-full" || head === "latency"
        ) {
          warn("ignored bootstrap error after table established:", head);
          return;
        }

        if (head === "disconnected") {
          warn("generic disconnected ignored; heartbeat/quit controls real table end");
          return;
        }
      }

      return originalNetworkMessage.apply(this, arguments);
    };

    window.networkMessage.__ppgTableLifecyclePatched = true;
    log("networkMessage patched");
  }

  function patchNetLib() {
    if (!window.netLib || !window.netlib) {
      setTimeout(patchNetLib, 100);
      return;
    }
    var nl = window.netLib;
    if (nl.__ppgTableLifecyclePatched) return;
    nl.__ppgTableLifecyclePatched = true;

    log("netLib found role=", role);

    try {
      Object.defineProperty(nl, "shareURL", {
        configurable: true,
        get: function () { return guestInviteUrl(); },
        set: function () {}
      });
      log("invite URL ready", guestInviteUrl());
    } catch (e) { nl.shareURL = guestInviteUrl(); }

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
        clearTimeout(self.joinTimer);
        markEstablished("netlib-connected");
        if (self.playerNum === 1) self.send(true, "peerConnect");
      });

      this.network.on("disconnected", function (event) {
        warn("netlib disconnected event", event);
        if (window.__ppgTableLocalQuit || window.__ppgTableRemoteQuit) return;
        if (window.__ppgTableEstablished) {
          self.connectState = 2;
          self.lobbyCode = FIXED_CODE;
          warn("stale signaling disconnect ignored after table established");
          return;
        }
        clearTimeout(self.joinTimer);
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

      function handleFatalBootstrapError(name, err) {
        warn(name, err);
        if (window.__ppgTableEstablished && !window.__ppgTableLocalQuit && !window.__ppgTableRemoteQuit) {
          self.connectState = 2;
          self.lobbyCode = FIXED_CODE;
          warn("ignored", name, "after table established");
          return;
        }
        clearTimeout(self.joinTimer);
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        if (typeof window.networkMessage === "function" && name === "signalingerror") {
          if (err && (err.code === "lobby-not-found" || err.code === "lobby-is-full")) window.networkMessage(err.code);
          else window.networkMessage("generalError");
        }
      }

      this.network.on("signalingerror", function (err) { handleFatalBootstrapError("signalingerror", err); });
      this.network.on("error", function (err) { handleFatalBootstrapError("error", err); });
      this.network.on("rtcerror", function (err) { handleFatalBootstrapError("rtcerror", err); });
    };

    nl.connect = function (action) {
      action = action || "";
      if (window.__ppgTableEstablished && !window.__ppgTableLocalQuit && !window.__ppgTableRemoteQuit) {
        log("connect ignored; table already established", action);
        return;
      }
      if (action === "createLobby" && !IS_HOST) { warn("blocked createLobby: not HOST"); return; }
      if (action === "joinLobby" && !IS_GUEST) { warn("blocked joinLobby: not GUEST"); return; }
      if (this.__ppgTableConnecting && this.__ppgTableLastAction === action) { log("duplicate connect ignored", action); return; }

      this.__ppgTableConnecting = true;
      this.__ppgTableLastAction = action;
      this.actionOnCoonect = action;
      this.lobbyCode = FIXED_CODE;
      if (this.network && !window.__ppgTableEstablished) { try { this.network.close(); } catch (e) {} }
      this.createNetwork();
    };

    // Existing Pause (II) -> Quit game (X) calls netLib.disconnect() in multiplayer.
    nl.disconnect = function () {
      window.__ppgTableLocalQuit = true;
      log("local player quit table; notifying opponent and resetting session");

      for (var i = 0; i < QUIT_REPEAT; i++) {
        setTimeout(function () { safeSendReliable("ppgTableQuit", [Date.now()]); }, i * QUIT_SPACING_MS);
      }
      serverMatchEnded("local-quit");

      var self = this;
      setTimeout(function () {
        try { if (self.network) self.network.close(); } catch (e) {}
        self.lobbyCode = "";
        self.playerNum = -1;
        self.connectState = 0;
        window.__ppgTableEstablished = false;
      }, CLOSE_AFTER_QUIT_MS);
    };

    nl.createLobby = function () {
      if (!IS_HOST) { warn("createLobby refused: not HOST"); return; }
      if (this.__ppgTableCreateStarted) { log("duplicate createLobby ignored"); return; }
      this.__ppgTableCreateStarted = true;
      this.playerNum = 0;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      log("host inviting fixed lobby GUEST");
      this.network.create({ code: FIXED_CODE, codeFormat: "fixed", public: false, maxPlayers: 2 });
      try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
    };

    nl.joinLobby = function () {
      var self = this;
      if (!IS_GUEST) { warn("joinLobby refused: not GUEST"); return; }
      if (this.__ppgTableJoinStarted) { log("duplicate joinLobby ignored"); return; }
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

    if (IS_HOST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgTableEstablished && nl.connectState !== 2) nl.connect("createLobby"); }, 800);
    } else if (IS_GUEST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgTableEstablished && nl.connectState !== 2) nl.connect("joinLobby"); }, 800);
    } else {
      warn("unknown role; no auto-connect");
    }
  }

  function heartbeatLoop() {
    setInterval(function () {
      if (!window.netLib || !window.__ppgTableEstablished) return;
      if (window.__ppgTableLocalQuit || window.__ppgTableRemoteQuit) return;

      try { window.netLib.connectState = 2; window.netLib.lobbyCode = FIXED_CODE; } catch (e) {}
      safeSendReliable("ppgAlive", [Date.now()]);

      var silence = Date.now() - (window.__ppgLastPeerAlive || Date.now());
      if (silence > PEER_ABANDONED_MS) {
        warn("peer abandoned; heartbeat silent", silence, "ms");
        window.__ppgTableRemoteQuit = true;
        returnToFirstScreen("peer-heartbeat-timeout");
      }
    }, HEARTBEAT_MS);
  }

  function pageLeaveHook() {
    function notifyLeaving() {
      if (!window.__ppgTableEstablished) return;
      if (window.__ppgTableLocalQuit || window.__ppgTableRemoteQuit) return;
      window.__ppgTableLocalQuit = true;
      try { safeSendReliable("ppgTableQuit", [Date.now()]); } catch (e) {}
      serverMatchEnded("page-leave");
    }
    window.addEventListener("pagehide", notifyLeaving);
    window.addEventListener("beforeunload", notifyLeaving);
  }

  patchNetworkMessage();
  patchNetLib();
  heartbeatLoop();
  pageLeaveHook();
})();
