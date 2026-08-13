// 共用格式化函式：Node 與瀏覽器都可用
// Node: const F = require('./lib/format'); 瀏覽器: <script src="lib/format.js"></script> 使用 window.CT_FORMAT
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CT_FORMAT = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const SYMBOL = { CNY: 'CNY', USD: 'USD', EUR: '€', JPY: '¥' };

  function thousands(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatCostRange(cost) {
    if (!cost) return '—';
    const { currency, min, max } = cost;
    const a = thousands(min), b = thousands(max);
    if (currency === 'CNY') return `${a}–${b}`;
    if (currency === 'JPY' || currency === 'EUR') return `${SYMBOL[currency]}${a}–${b}`;
    return `${currency} ${a}–${b}`; // USD
  }

  // 將 cost 轉成 CNY 等值（用快照匯率）
  function costMidCNY(cost, fxRates) {
    if (!cost) return 0;
    const rate = (fxRates && fxRates[cost.currency]) || 1;
    return Math.round(((cost.min + cost.max) / 2) * rate);
  }

  function costMidNative(cost) {
    if (!cost) return 0;
    return (cost.min + cost.max) / 2;
  }

  // CNY → TWD 顯示
  function formatTWDFromCost(cost, fxRates) {
    if (!cost || !fxRates) return '';
    const cny = costMidCNY(cost, fxRates);
    const twd = Math.round(cny * (fxRates.TWD || 0.22) * 100) / 100;
    // 為符合原顯示，回傳整月區間
    const minTwd = Math.round(cost.min * (fxRates[cost.currency] || 1) * (fxRates.TWD || 0.22));
    const maxTwd = Math.round(cost.max * (fxRates[cost.currency] || 1) * (fxRates.TWD || 0.22));
    return `NT$${thousands(minTwd)}–${thousands(maxTwd)}`;
  }

  function costBucket(cny, buckets) {
    if (cny < buckets.low) return 'low';
    if (cny < buckets.mid) return 'mid';
    return 'high';
  }

  return { formatCostRange, costMidCNY, costMidNative, formatTWDFromCost, costBucket, thousands };
}));
