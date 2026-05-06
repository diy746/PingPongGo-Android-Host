(function () {
  console.log("[PPG LAN] patch active");

  function fixedGuestUrl() {
    return "http://" + location.host + "/index.html?id=GUEST";
  }

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
          return fixedGuestUrl();
        },
        set: function () {}
      });
      console.log("[PPG LAN] invite URL ready");
    } catch (e) {
      console.warn("[PPG LAN] shareURL patch failed", e);
    }

    nl.createLobby = function () {
      this.lobbyCode = "GUEST";
      console.log("[PPG LAN] host fixed lobby GUEST");

      this.network.create({
        code: "GUEST",
        codeFormat: "fixed",
        public: false,
        maxPlayers: 2
      });
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
        nl.lobbyCode = "GUEST";
        nl.connect("createLobby");
      }
    }, 800);
  }

  patch();
})();
