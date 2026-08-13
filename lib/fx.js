// 即時匯率（瀏覽器端，CNY→TWD 用）
// 來源：open.er-api.com（免費，無需 API key），24h localStorage 快取
// Fallback：data/meta.json 內的 fxSnapshot.rates
(function (root) {
  const KEY = 'ct_fx_v1';
  const TTL = 24 * 3600 * 1000;
  const ENDPOINT = 'https://open.er-api.com/v6/latest/CNY';

  function readCache() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > TTL) return null;
      return obj.rates;
    } catch (_) { return null; }
  }

  function writeCache(rates) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), rates }));
    } catch (_) {}
  }

  // 回傳 { CNY, USD, EUR, JPY, TWD } 對 CNY 比值（CNY=1，其他幣別 = 1 X 幣 = N CNY）
  async function getRates() {
    const cached = readCache();
    if (cached) return cached;
    try {
      const r = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      // open.er-api.com 回傳 base=CNY 時 rates.USD = 1 CNY 換多少 USD
      // 我們要的是 1 X 幣 = ? CNY → 1 / rates[X]
      const usd = j.rates && j.rates.USD;
      const eur = j.rates && j.rates.EUR;
      const jpy = j.rates && j.rates.JPY;
      const twd = j.rates && j.rates.TWD;
      if (!usd || !eur || !jpy || !twd) return null;
      const rates = {
        CNY: 1,
        USD: 1 / usd,
        EUR: 1 / eur,
        JPY: 1 / jpy,
        TWD: twd, // 1 CNY = N TWD（顯示用）
      };
      writeCache(rates);
      return rates;
    } catch (_) { return null; }
  }

  root.CT_FX = { getRates };
}(typeof self !== 'undefined' ? self : this));
