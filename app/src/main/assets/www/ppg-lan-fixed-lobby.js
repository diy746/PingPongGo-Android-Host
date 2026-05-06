(function () {
  console.log("[PPG LAN] patch active");

  var FIXED_CODE = "GUEST";
  var JOIN_TIMEOUT_MS = 60000;

  window.__ppgLanMode = true;
  window.__ppgLanDisableDemo = true;

  function patch() {
    if (!window.netLib) {
      setTimeout(patch, 200);
      return;
    }

    var nl = window.netLib;
    if (nl.__ppgLanPatched) return;
    nl.__ppgLanPatched = true;

    console.log("[PPG LAN] netLib found");

    try {
      Object.defineProperty(nl, "shareURL", {
        configurable: true,
        get: function () {
          return "http://" + location.host + "/index.html?id=" + FIXED_CODE;
        },
        set: function () {}
      });
      console.log("[PPG LAN] invite URL ready");
    } catch (e) {
      console.warn("[PPG LAN] shareURL override failed", e);
      nl.shareURL = "http://" + location.host + "/index.html?id=" + FIXED_CODE;
    }

    var originalConnect = nl.connect;
    nl.connect = function (action) {
      action = action || "";

      if (this.__ppgLanConnecting && this.__ppgLanLastAction === action) {
        console.log("[PPG LAN] duplicate connect ignored:", action);
        return;
      }

      if (this.connectState === 2) {
        console.log("[PPG LAN] already connected, connect ignored:", action);
        return;
      }

      this.__ppgLanConnecting = true;
      this.__ppgLanLastAction = action;

      console.log("[PPG LAN] connect:", action);
      return originalConnect.call(this, action);
    };

    nl.createLobby = function () {
      if (this.__ppgLanCreateStarted) {
        console.log("[PPG LAN] duplicate createLobby ignored");
        return;
      }

      this.__ppgLanCreateStarted = true;
      this.lobbyCode = FIXED_CODE;
      this.playerNum = 0;

      console.log("[PPG LAN] host fixed lobby GUEST");

      this.network.create({
        code: FIXED_CODE,
        codeFormat: "fixed",
        public: false,
        maxPlayers: 2
      });

      try {
        if (typeof addUrlBut === "function") addUrlBut();
      } catch (e) {
        console.warn("[PPG LAN] addUrlBut unavailable", e);
      }
    };

    nl.joinLobby = function () {
      var self = this;

      if (this.__ppgLanJoinStarted) {
        console.log("[PPG LAN] duplicate joinLobby ignored");
        return;
      }

      this.__ppgLanJoinStarted = true;
      this.playerNum = 1;
      this.lobbyCode = FIXED_CODE;

      clearTimeout(this.joinTimer);
      this.joinTimer = setTimeout(function () {
        console.warn("[PPG LAN] join still waiting after " + JOIN_TIMEOUT_MS + "ms");
        self.connectState = 0;
        self.lobbyCode = FIXED_CODE;
        self.__ppgLanJoinStarted = false;

        if (typeof networkMessage === "function") {
          networkMessage("connectError");
        }
      }, JOIN_TIMEOUT_MS);

      console.log("[PPG LAN] guest auto joining GUEST");
      this.network.join(FIXED_CODE);
    };

    var id = new URLSearchParams(location.search).get("id");
    if (id === FIXED_CODE) {
      nl.lobbyCode = FIXED_CODE;
      console.log("[PPG LAN] guest URL detected, original game will join GUEST");
    } else {
      nl.lobbyCode = FIXED_CODE;
      console.log("[PPG LAN] host mode ready, waiting for Invite button/createLobby");
    }
  }

  patch();
})();
