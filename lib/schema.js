// 輕量資料驗證（無外部依賴）
// 用法：node lib/schema.js  → 驗 data/cities.json + data/proposals.json，失敗時 exit 1

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SEASONS = ['summer', 'winter', 'year_round', 'guangxi', 'overseas'];
const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY'];
const RATING_KEYS = ['健行跑步', '健身房', '美食', '網路/VPN', 'CP值'];

function err(list, where, msg) { list.push(`✗ ${where}: ${msg}`); }

function isInt(n) { return Number.isInteger(n); }
function isNum(n) { return typeof n === 'number' && !Number.isNaN(n); }
function isStr(s) { return typeof s === 'string' && s.length > 0; }
function isArr(a) { return Array.isArray(a); }

function validateCity(c, idx, errors) {
  const where = `cities[${idx}]${c.slug ? ` (${c.slug})` : ''}`;

  if (!isStr(c.slug) || !/^[a-z][a-z0-9-]*$/.test(c.slug)) err(errors, where, 'slug 必須為小寫英數字（連字號）');
  if (!isStr(c.name)) err(errors, where, 'name 缺失');
  if (!isStr(c.province)) err(errors, where, 'province 缺失');
  if (!SEASONS.includes(c.season)) err(errors, where, `season 必須為 ${SEASONS.join('|')}`);

  if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) err(errors, where, 'lat 必須介於 -90~90');
  if (!isNum(c.lng) || c.lng < -180 || c.lng > 180) err(errors, where, 'lng 必須介於 -180~180');

  if (!c.cost || typeof c.cost !== 'object') {
    err(errors, where, 'cost 物件缺失');
  } else {
    if (!CURRENCIES.includes(c.cost.currency)) err(errors, where, `cost.currency 必須為 ${CURRENCIES.join('|')}`);
    if (!isNum(c.cost.min) || c.cost.min <= 0) err(errors, where, 'cost.min 必須為正數');
    if (!isNum(c.cost.max) || c.cost.max <= 0) err(errors, where, 'cost.max 必須為正數');
    if (isNum(c.cost.min) && isNum(c.cost.max) && c.cost.min > c.cost.max) err(errors, where, 'cost.min > cost.max');
  }

  if (!isNum(c.stars) || c.stars < 0 || c.stars > 5) err(errors, where, 'stars 必須介於 0~5');

  if (!c.ratings || typeof c.ratings !== 'object') {
    err(errors, where, 'ratings 物件缺失');
  } else {
    RATING_KEYS.forEach(k => {
      const v = c.ratings[k];
      if (!isInt(v) || v < 1 || v > 5) err(errors, where, `ratings["${k}"] 必須為 1~5 整數`);
    });
  }

  if (!isStr(c.desc)) err(errors, where, 'desc 缺失');

  if (!isArr(c.months) || c.months.length !== 12) {
    err(errors, where, 'months 必須為長度 12 的陣列');
  } else {
    c.months.forEach((m, i) => {
      if (!isInt(m) || m < 1 || m > 5) err(errors, where, `months[${i}] 必須為 1~5`);
    });
  }

  if (!isStr(c.runRoute)) err(errors, where, 'runRoute 缺失');

  // 選填欄位的型別檢查
  ['tagline', 'bestSeason', 'gym', 'hotspring', 'warning'].forEach(k => {
    if (c[k] !== undefined && !isStr(c[k])) err(errors, where, `${k} 應為字串`);
  });
  ['running', 'food', 'notes', 'trial'].forEach(k => {
    if (c[k] !== undefined && (!isArr(c[k]) || !c[k].every(isStr))) err(errors, where, `${k} 應為字串陣列`);
  });
  if (c.climate !== undefined) {
    if (!isArr(c.climate)) {
      err(errors, where, 'climate 應為陣列');
    } else {
      c.climate.forEach((row, i) => {
        if (!row || !isStr(row.month) || !isStr(row.temp) || !isStr(row.note)) {
          err(errors, where, `climate[${i}] 必須有 month/temp/note 字串`);
        }
      });
    }
  }
}

function validateProposal(p, idx, errors) {
  const where = `proposals[${idx}]${p.slug ? ` (${p.slug})` : ''}`;
  if (!isStr(p.slug) || !/^[A-Z]$/.test(p.slug)) err(errors, where, 'slug 必須為單一大寫字母');
  if (!isStr(p.title)) err(errors, where, 'title 缺失');
  if (!isStr(p.subtitle)) err(errors, where, 'subtitle 缺失');
  if (!isStr(p.desc)) err(errors, where, 'desc 缺失（地圖 popup 一句話簡介）');
  if (!isStr(p.mapLabel)) err(errors, where, 'mapLabel 缺失（地圖路線按鈕短標籤）');
  if (!isStr(p.color) || !/^#[0-9A-F]{6}$/i.test(p.color)) err(errors, where, 'color 必須為 #RRGGBB');
  if (!isStr(p.duration)) err(errors, where, 'duration 缺失');
  if (!isInt(p.durationDays) || p.durationDays <= 0) err(errors, where, 'durationDays 必須為正整數');
  if (!isArr(p.stops)) err(errors, where, 'stops 應為陣列');
  if (!isArr(p.routeStops) || p.routeStops.length === 0) err(errors, where, 'routeStops 缺失');
  if (!isArr(p.transport)) err(errors, where, 'transport 應為陣列');
  if (!isArr(p.costs)) err(errors, where, 'costs 應為陣列');
  if (!p.ratings || typeof p.ratings !== 'object') err(errors, where, 'ratings 物件缺失');
  if (!isArr(p.luggage)) err(errors, where, 'luggage 應為陣列');
  if (!isArr(p.notes)) err(errors, where, 'notes 應為陣列');
}

function validateMeta(m, errors) {
  if (!isInt(m.schemaVersion)) err(errors, 'meta', 'schemaVersion 缺失');
  if (!isStr(m.dataUpdated)) err(errors, 'meta', 'dataUpdated 缺失');
  if (!m.fxSnapshot || typeof m.fxSnapshot !== 'object') err(errors, 'meta', 'fxSnapshot 缺失');
  else {
    if (m.fxSnapshot.base !== 'CNY') err(errors, 'meta', 'fxSnapshot.base 應為 CNY');
    if (!m.fxSnapshot.rates || typeof m.fxSnapshot.rates !== 'object') err(errors, 'meta', 'fxSnapshot.rates 缺失');
    else CURRENCIES.forEach(cur => {
      if (!isNum(m.fxSnapshot.rates[cur])) err(errors, 'meta', `fxSnapshot.rates.${cur} 缺失`);
    });
  }
  if (!m.costBuckets || !isInt(m.costBuckets.low) || !isInt(m.costBuckets.mid)) err(errors, 'meta', 'costBuckets.low/mid 缺失');
}

function validateAll() {
  const errors = [];
  const cities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cities.json'), 'utf8'));
  const proposals = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'proposals.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));

  if (!isArr(cities) || cities.length === 0) err(errors, 'cities', '應為非空陣列');
  cities.forEach((c, i) => validateCity(c, i, errors));

  // slug 唯一
  const seen = new Set();
  cities.forEach((c, i) => {
    if (c.slug && seen.has(c.slug)) err(errors, `cities[${i}]`, `slug 重複: ${c.slug}`);
    if (c.slug) seen.add(c.slug);
  });

  proposals.forEach((p, i) => validateProposal(p, i, errors));
  validateMeta(meta, errors);

  return { errors, cities, proposals, meta };
}

if (require.main === module) {
  const { errors, cities, proposals } = validateAll();
  if (errors.length === 0) {
    console.log(`✓ 驗證通過：${cities.length} 個城市、${proposals.length} 個方案`);
    process.exit(0);
  } else {
    console.error(`驗證失敗（${errors.length} 個錯誤）：\n`);
    errors.forEach(e => console.error(e));
    process.exit(1);
  }
}

module.exports = { validateAll, RATING_KEYS, SEASONS, CURRENCIES };
