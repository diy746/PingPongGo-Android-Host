(function () {
  const ok = () => Promise.resolve();
  window.PokiSDK = window.PokiSDK || {
    init: ok,
    commercialBreak: ok,
    rewardedBreak: () => Promise.resolve(false),
    gameplayStart: function(){},
    gameplayStop: function(){},
    happyTime: function(){},
    setDebug: function(){},
    shareableURL: () => Promise.resolve(location.href),
    getURLParam: () => null
  };
  window.PokiSDK_isInitialized = true;
})();
