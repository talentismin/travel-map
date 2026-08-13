// 韓元 → 台幣匯率（釜山行程 App 專用，Node 與瀏覽器都可用）
//
// ⚠️ 刻意「不」重用 lib/fx.js：那支以 CNY 為基準，而且它的線上值與
//    data/meta.json 的 fxSnapshot 對 TWD 的語意互為倒數（差約 20 倍，
//    是既有的線上 bug）。記帳金額不能建在語意有歧義的東西上，
//    所以這裡走單一方向、自成一格：rate 永遠是「1 KRW 值多少 TWD」。
//
// 來源：open.er-api.com（免費、無需 key），24h localStorage 快取。
// 抓不到就退到 SNAPSHOT；使用者也可在出發前「鎖定匯率」把當下值釘死，
// 之後全程用同一個數字，對帳才不會今天看昨天的總額還會跳。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CT_FX_KRW = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var KEY = 'ct_fx_krw_v1';
  var TTL = 24 * 3600 * 1000;
  var ENDPOINT = 'https://open.er-api.com/v6/latest/KRW';

  // 1 KRW = 0.0224 TWD（₩1,000 ≈ NT$22.4）。2026-08-02 實測 open.er-api.com 的值。
  // 抓不到網路時的保底值；出發前記得用 App 的「🔒 鎖定匯率」釘一個當下的。
  var SNAPSHOT = { rate: 0.022406, asOf: '2026-08-02' };

  // 合理區間守門：韓元對台幣長期在 0.018–0.030 之間。
  // 落在區間外幾乎必然是 API 換了語意（回傳倒數）或資料壞掉，寧可退回 snapshot。
  var MIN = 0.015, MAX = 0.035;

  function sane(r) { return typeof r === 'number' && isFinite(r) && r > MIN && r < MAX; }

  function readCache() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (Date.now() - o.ts > TTL) return null;
      return sane(o.rate) ? { rate: o.rate, asOf: o.asOf, source: 'live' } : null;
    } catch (_) { return null; }
  }

  function writeCache(rate, asOf) {
    try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), rate: rate, asOf: asOf })); }
    catch (_) {}
  }

  // 回傳 { rate, asOf, source }；source ∈ live | cache | snapshot | locked | manual
  function getRate(locked) {
    // 鎖定優先：出發前釘住的值，旅途中不再變動
    if (locked && sane(locked.rate)) {
      return Promise.resolve({ rate: locked.rate, asOf: locked.asOf, source: 'locked' });
    }
    var cached = readCache();
    if (cached) return Promise.resolve({ rate: cached.rate, asOf: cached.asOf, source: 'cache' });

    if (typeof fetch !== 'function') {
      return Promise.resolve({ rate: SNAPSHOT.rate, asOf: SNAPSHOT.asOf, source: 'snapshot' });
    }
    return fetch(ENDPOINT, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var rate = j && j.rates && j.rates.TWD;   // base=KRW → 1 KRW 值多少 TWD
        if (!sane(rate)) return { rate: SNAPSHOT.rate, asOf: SNAPSHOT.asOf, source: 'snapshot' };
        var asOf = (j.time_last_update_utc || '').slice(5, 16) || new Date().toISOString().slice(0, 10);
        writeCache(rate, asOf);
        return { rate: rate, asOf: asOf, source: 'live' };
      })
      .catch(function () {
        return { rate: SNAPSHOT.rate, asOf: SNAPSHOT.asOf, source: 'snapshot' };
      });
  }

  // 金額換算：KRW→TWD 用乘，TWD 本身原樣回傳
  function toTWD(amount, currency, rate) {
    if (currency === 'TWD') return amount;
    if (currency === 'KRW') return amount * rate;
    return null;   // 其他幣別本行程用不到，明確回 null 而不是悄悄算錯
  }

  function fmtKRW(n) {
    return '₩' + Math.round(n).toLocaleString('en-US');
  }
  function fmtTWD(n) {
    var v = Math.round(n);
    return 'NT$' + v.toLocaleString('en-US');
  }

  var SOURCE_LABEL = {
    live: '即時', cache: '即時(快取)', snapshot: '快照', locked: '🔒 鎖定', manual: '手動',
  };

  return {
    getRate: getRate,
    toTWD: toTWD,
    fmtKRW: fmtKRW,
    fmtTWD: fmtTWD,
    SNAPSHOT: SNAPSHOT,
    SOURCE_LABEL: SOURCE_LABEL,
    _sane: sane,
  };
}));
