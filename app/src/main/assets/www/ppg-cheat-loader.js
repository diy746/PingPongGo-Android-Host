(function(){
  "use strict";
  const TAG = "[PPG cheat]";
  const DEFAULT_KEY = "ppgv8";
  const BAT_COUNT = 57;
  const BAT_START = 56;
  function log(cfg, ...a){ if (cfg && cfg.debug) console.log(TAG, ...a); }
  function parseSave(raw){
    if (!raw || typeof raw !== "string") return null;
    return raw.split(",").map(v => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    });
  }
  function defaultSave(){
    const a = [0,0,0,2,0,2,0,0,0,500,11,3,0,0];
    for (let i=0;i<42;i++) a.push(0);
    for (let i=0;i<BAT_COUNT;i++) a.push(i===0 ? 2 : (i<3 ? 1 : 0));
    for (let i=0;i<16;i++) a.push(0);
    return a;
  }
  function ensureLen(a){
    const d = defaultSave();
    for (let i=a.length;i<d.length;i++) a[i] = d[i];
    return a;
  }
  function applyConfig(cfg){
    if (!cfg || !cfg.enabled) return {applied:false, reason:"disabled/missing"};
    const key = cfg.storageKey || DEFAULT_KEY;
    let arr;
    if (cfg.mode === "replace" && typeof cfg.value === "string") {
      arr = parseSave(cfg.value);
    } else {
      arr = parseSave(localStorage.getItem(key)) || defaultSave();
      arr = ensureLen(arr);
      if (Number.isFinite(cfg.gems)) arr[0] = Math.max(arr[0] || 0, cfg.gems|0);
      if (Number.isFinite(cfg.rank)) arr[9] = cfg.rank|0;
      if (Number.isFinite(cfg.level)) arr[1] = Math.max(arr[1] || 0, cfg.level|0);
      if (cfg.unlockAllBats) {
        for (let i=0;i<BAT_COUNT;i++) if (arr[BAT_START+i] !== 2) arr[BAT_START+i] = 1;
      }
      if (Array.isArray(cfg.unlockBatIds)) {
        cfg.unlockBatIds.forEach(id => {
          id = id|0;
          if (id >= 0 && id < BAT_COUNT && arr[BAT_START+id] !== 2) arr[BAT_START+id] = 1;
        });
      }
    }
    if (!arr || !arr.length) return {applied:false, reason:"invalid save array"};
    localStorage.setItem(key, arr.join(","));
    log(cfg, "applied to", key, {gems:arr[0], rank:arr[9], bats: arr.slice(BAT_START, BAT_START+BAT_COUNT).filter(Boolean).length});
    return {applied:true};
  }
  window.PPG_applyCheatConfig = applyConfig;
  window.PPG_CHEAT_READY = fetch("ppg-cheat.json", {cache:"no-store"})
    .then(r => r.ok ? r.json() : null)
    .then(cfg => { if (cfg && cfg.applyOnLoad !== false) applyConfig(cfg); return cfg; })
    .catch(() => null);
  if (window.PokiSDK && typeof window.PokiSDK.init === "function") {
    const oldInit = window.PokiSDK.init.bind(window.PokiSDK);
    window.PokiSDK.init = function(){
      return Promise.resolve(window.PPG_CHEAT_READY).catch(()=>null).then(() => oldInit());
    };
  }
})();
