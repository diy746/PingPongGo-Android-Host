(function () {
  "use strict";

  console.log("[PPG SMART] wrapper loading");

  var FIXED_CODE = "GUEST";
  var JOIN_TIMEOUT_MS = 120000;
  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var role = (params.get("role") || "").toUpperCase();

  // Compatibility, but still session-only role. This does not limit the app/device.
  if (!role && id === FIXED_CODE) role = "GUEST";
  if (!role && !id) role = "HOST";

  var IS_HOST = role === "HOST";
  var IS_GUEST = role === "GUEST" && id === FIXED_CODE;

  window.__ppgLanMode = true;
  window.__ppgLanRole = role;
  window.__ppgLanEstablished = false;
  window.__ppgLanQuitRequested = false;
  window.__ppgLanDisableDemo = true;

  function log() { console.log.apply(console, ["[PPG SMART]"].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, ["[PPG SMART]"].concat([].slice.call(arguments))); }

  function guestInviteUrl() {
    return "http://" + location.host + "/index.html?role=GUEST&id=" + FIXED_CODE;
  }

  function notifyAndroidConnected() {
    try { fetch("/__connected?keepMs=86400000&ts=" + Date.now()).catch(function () {}); } catch (e) {}
    try { window.dispatchEvent(new Event("ppg-lan-connected")); } catch (e) {}
  }

  function markEstablished(nl, reason) {
    if (window.__ppgLanEstablished) return;
    window.__ppgLanEstablished = true;
    window.__ppgLanEstablishedAt = Date.now();

    if (nl) {
      nl.connectState = 2;
      nl.lobbyCode = FIXED_CODE;
      try { clearTimeout(nl.joinTimer); } catch (e) {}
    }

    log("ESTABLISHED by", reason || "unknown", "— signaling/HTTP errors will no longer kill match");
    notifyAndroidConnected();
  }

  function patchNetworkMessage() {
    if (typeof window.networkMessage !== "function") {
      setTimeout(patchNetworkMessage, 100);
      return;
    }
    if (window.networkMessage.__ppgSmartPatched) return;

    var original = window.networkMessage;

    window.networkMessage = function (message) {
      var head = "";
      try { head = String(message || "").split(",")[0]; } catch (e) {}

      if (head === "peerConnect" || head === "acceptPlayer") {
        markEstablished(window.netLib, head);
      }

      if (head === "batPos" || head === "opData" || head === "serveBounce" || head === "hitBounce" || head === "offSide" || head === "rematch") {
        window.__ppgLastPeerGameMessageAt = Date.now();
      }

      if (window.__ppgLanEstablished && !window.__ppgLanQuitRequested) {
        if (head === "connectError" || head === "generalError" || head === "lobby-not-found" || head === "lobby-is-full") {
          warn("ignored post-established signaling/lobby error:", head);
          return;
        }
        if (head === "disconnected") {
          warn("ignored post-established disconnected event; gameplay stays alive");
          return;
        }
      }

      return original.apply(this, arguments);
    };

    window.networkMessage.__ppgSmartPatched = true;
    log("networkMessage hardened");
  }

  function patchNetLib() {
    if (!window.netLib || !window.netlib) {
      setTimeout(patchNetLib, 100);
      return;
    }
    var nl = window.netLib;
    if (nl.__ppgSmartPatched) return;
    nl.__ppgSmartPatched = true;

    log("netLib found role=", role);

    try {
      Object.defineProperty(nl, "shareURL", {
        configurable: true,
        get: function () { return guestInviteUrl(); },
        set: function () {}
      });
      log("invite URL ready", guestInviteUrl());
    } catch (e) {
      nl.shareURL = guestInviteUrl();
    }

    nl.createNetwork = function () {
      var self = this;
      this.network = new window.netlib.Network(this.gameId);

      this.network.on("message", function (a, b, payload) {
        window.__ppgLastPeerGameMessageAt = Date.now();
        if (typeof window.networkMessage === "function") window.networkMessage(payload);
      });

      this.network.on("connected", function (peer) {
        log("netlib connected peer=", peer && peer.id);
        self.peer = peer;
        self.connectState = 2;
        self.lobbyCode = FIXED_CODE;
        try { clearTimeout(self.joinTimer); } catch (e) {}
        markEstablished(self, "netlib-connected");
        if (self.playerNum === 1) self.send(true, "peerConnect");
      });

      this.network.on("lobby", function (code) {
        if (self.playerNum === 0) {
          log("lobby created", code, "forced as", FIXED_CODE);
          self.lobbyCode = FIXED_CODE;
          try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
        }
      });

      this.network.on("ready", function () {
        log("Network ready action=", self.actionOnCoonect);
        self.networkReady = true;
        if (self.actionOnCoonect === "createLobby") self.createLobby();
        else if (self.actionOnCoonect === "joinLobby") self.joinLobby();
      });

      function softError(kind, data) {
        warn(kind, data || "");
        if (window.__ppgLanEstablished && !window.__ppgLanQuitRequested) {
          self.connectState = 2;
          self.lobbyCode = FIXED_CODE;
          warn("ignored", kind, "after established match");
          return true;
        }
        return false;
      }

      this.network.on("disconnected", function (e) {
        if (softError("disconnected", e)) return;
        try { clearTimeout(self.joinTimer); } catch (x) {}
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        if (typeof window.networkMessage === "function") window.networkMessage("disconnected");
      });

      this.network.on("signalingerror", function (e) {
        if (softError("signalingerror", e)) return;
        try { clearTimeout(self.joinTimer); } catch (x) {}
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        if (typeof window.networkMessage === "function") {
          if (e && (e.code === "lobby-not-found" || e.code === "lobby-is-full")) window.networkMessage(e.code);
          else window.networkMessage("generalError");
        }
      });

      this.network.on("error", function (e) { softError("error", e); });
      this.network.on("rtcerror", function (e) { softError("rtcerror", e); });
    };

    nl.connect = function (action) {
      action = action || "";
      if (window.__ppgLanEstablished && !window.__ppgLanQuitRequested) {
        log("connect ignored; match established", action);
        return;
      }
      if (action === "createLobby" && !IS_HOST) { warn("blocked createLobby: not HOST session"); return; }
      if (action === "joinLobby" && !IS_GUEST) { warn("blocked joinLobby: not GUEST session"); return; }
      if (this.__ppgSmartConnecting && this.__ppgSmartLastAction === action) { log("duplicate connect ignored", action); return; }

      this.__ppgSmartConnecting = true;
      this.__ppgSmartLastAction = action;
      this.actionOnCoonect = action;
      this.lobbyCode = FIXED_CODE;

      // Do not close a healthy established network. Before establishment, replace stale setup attempts.
      if (this.network && !window.__ppgLanEstablished) {
        try { this.network.close(); } catch (e) {}
      }
      log("creating smart bootstrap network", action);
      this.createNetwork();
    };

    nl.createLobby = function () {
      if (!IS_HOST) { warn("createLobby refused: not HOST"); return; }
      if (this.__ppgSmartCreateStarted) { log("duplicate createLobby ignored"); return; }
      this.__ppgSmartCreateStarted = true;
      this.playerNum = 0;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      log("host fixed lobby GUEST");
      this.network.create({ code: FIXED_CODE, codeFormat: "fixed", public: false, maxPlayers: 2 });
      try { if (typeof window.addUrlBut === "function") window.addUrlBut(); } catch (e) {}
    };

    nl.joinLobby = function () {
      var self = this;
      if (!IS_GUEST) { warn("joinLobby refused: not GUEST"); return; }
      if (this.__ppgSmartJoinStarted) { log("duplicate joinLobby ignored"); return; }
      this.__ppgSmartJoinStarted = true;
      this.playerNum = 1;
      this.lobbyCode = FIXED_CODE;
      this.connectState = 1;
      try { clearTimeout(this.joinTimer); } catch (e) {}
      this.joinTimer = setTimeout(function () {
        if (window.__ppgLanEstablished || self.connectState === 2) { log("join timeout ignored; already connected"); return; }
        warn("join still waiting after", JOIN_TIMEOUT_MS, "ms");
        self.__ppgSmartJoinStarted = false;
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        if (typeof window.networkMessage === "function") window.networkMessage("connectError");
      }, JOIN_TIMEOUT_MS);
      log("guest joining fixed lobby GUEST");
      this.network.join(FIXED_CODE);
    };

    nl.disconnect = function () {
      window.__ppgLanQuitRequested = true;
      log("explicit player quit/disconnect");
      try { if (this.network) this.network.close(); } catch (e) {}
      this.connectState = 0;
      this.playerNum = -1;
      this.lobbyCode = "";
      window.__ppgLanEstablished = false;
    };

    // Session bootstrap. Role belongs to this tab only, not to the installed app/device.
    if (IS_HOST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgLanEstablished && nl.connectState !== 2) nl.connect("createLobby"); }, 800);
    } else if (IS_GUEST) {
      nl.lobbyCode = FIXED_CODE;
      setTimeout(function () { if (!window.__ppgLanEstablished && nl.connectState !== 2) nl.connect("joinLobby"); }, 800);
    } else {
      warn("unknown role, no auto bootstrap");
    }
  }

  function installStateKeeper() {
    setInterval(function () {
      if (!window.netLib || !window.__ppgLanEstablished) return;
      window.netLib.connectState = 2;
      window.netLib.lobbyCode = FIXED_CODE;
    }, 2000);
  }

  patchNetworkMessage();
  patchNetLib();
  installStateKeeper();
})();
