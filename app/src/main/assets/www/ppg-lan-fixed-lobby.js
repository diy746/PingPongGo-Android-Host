(function () {
  console.log("[PPG LAN] patch active");

  function patch() {
    if (!window.netLib) {
      setTimeout(patch, 200);
      return;
    }

    var nl = window.netLib;
    if (nl.__ppgLanPatched) return;
    nl.__ppgLanPatched = true;

    try {
      Object.defineProperty(nl, "shareURL", {
        configurable: true,
        get: function () {
          return "http://" + location.host + "/index.html?id=GUEST";
        },
        set: function () {}
      });
      console.log("[PPG LAN] invite URL ready");
    } catch (e) {
      nl.shareURL = "http://" + location.host + "/index.html?id=GUEST";
    }

    nl.createLobby = function () {
      this.lobbyCode = "GUEST";
      this.playerNum = 0;
      console.log("[PPG LAN] host fixed lobby GUEST");
      this.network.create({
        code: "GUEST",
        codeFormat: "fixed",
        public: false,
        maxPlayers: 2
      });
    };

    var originalJoin = nl.joinLobby;
    nl.joinLobby = function () {
      this.lobbyCode = "GUEST";
      this.playerNum = 1;
      console.log("[PPG LAN] joining fixed lobby GUEST");
      return originalJoin ? originalJoin.apply(this, arguments) : this.network.join("GUEST");
    };

    if (window.__ppgLanConnectStarted) return;
    window.__ppgLanConnectStarted = true;

    var id = new URLSearchParams(location.search).get("id");
    setTimeout(function () {
      if (id === "GUEST") {
        console.log("[PPG LAN] guest auto joining GUEST");
        nl.lobbyCode = "GUEST";
        nl.connect("joinLobby");
      } else {
        console.log("[PPG LAN] host auto creating GUEST invitation");
        nl.lobbyCode = "GUEST";
        nl.connect("createLobby");
      }
    }, 800);
  }

  patch();
})();
