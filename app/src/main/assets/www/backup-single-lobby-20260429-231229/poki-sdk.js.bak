(function(){
  console.log("[offline] local poki-sdk.js loaded");

  function resolved(v){ return Promise.resolve(v); }

  function makeUrl(data){
    const url = new URL(location.href);
    if (data && data.id) {
      url.searchParams.set("id", data.id);
    }
    return url.href;
  }

  window.PokiSDK = {
    init: function(){
      console.log("[offline] PokiSDK.init()");
      return resolved();
    },

    gameLoadingStart: function(){},
    gameLoadingFinished: function(){},

    gameplayStart: function(){},
    gameplayStop: function(){},

    commercialBreak: function(cb){
      if (typeof cb === "function") cb();
      return resolved();
    },

    rewardedBreak: function(cb){
      if (typeof cb === "function") cb(false);
      return resolved(false);
    },

    shareableURL: function(data){
      const u = makeUrl(data);
      console.log("[offline] shareableURL data=", data, "url=", u);
      if (data && data.id && typeof window.PPG_showInviteQR === "function") {
        window.PPG_showInviteQR(data.id);
      }
      return resolved(u);
    },

    getURLParam: function(name){
      return new URLSearchParams(location.search).get(name);
    },

    happyTime: function(){},
    setDebug: function(){},
    captureError: function(e){ console.warn("[offline] captureError", e); }
  };
})();
