// 逐日行程資料驗證（無外部依賴）
// 用法：node lib/itinerary_schema.js  → 驗 data/itineraries/*.json，失敗時 exit 1
//
// 與 lib/schema.js 同一風格：validateAll() 回 { errors, warnings, trips }。
// generator 與 scripts/check.js 共用這份，避免兩套規則漂移。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'itineraries');

const NOTE_TYPES = ['warn', 'tip', 'book', 'money', 'time', 'info'];
const WHO = ['me', 'wife', 'both'];
const INTENSITY = ['low', 'mid', 'high'];
const EFFORT = ['low', 'mid', 'high'];
const FLEX = ['fixed', 'loose', 'optional'];
const KIND = ['sight', 'food', 'cafe', 'shop', 'transit', 'rest', 'stay'];

// 釜山／慶州／大邱／巨濟／統營全含。換城市時連同這裡一起調整。
const BBOX = { latMin: 34.5, latMax: 36.3, lngMin: 128.2, lngMax: 129.7 };

const SLOT_ID_RE = /^d\d\d-s\d+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isStr(s) { return typeof s === 'string' && s.length > 0; }
function isNum(n) { return typeof n === 'number' && !Number.isNaN(n); }
function isInt(n) { return Number.isInteger(n); }
function isArr(a) { return Array.isArray(a); }

function toMin(t) { const [h, m] = t.split(':'); return (+h) * 60 + (+m); }

function nextDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function validateNotes(notes, where, errors) {
  if (notes === undefined) return;
  if (!isArr(notes)) { errors.push(`✗ ${where}: notes 應為陣列`); return; }
  notes.forEach((n, i) => {
    const w = `${where}.notes[${i}]`;
    if (!NOTE_TYPES.includes(n.type)) errors.push(`✗ ${w}: type 必須為 ${NOTE_TYPES.join('|')}（得到 ${n.type}）`);
    if (!isStr(n.text)) errors.push(`✗ ${w}: text 缺失`);
    if (n.who !== undefined && !WHO.includes(n.who)) errors.push(`✗ ${w}: who 必須為 ${WHO.join('|')}（得到 ${n.who}）`);
  });
}

function validateCost(cost, where, errors) {
  if (cost === undefined) return;
  const w = `${where}.cost`;
  if (!isStr(cost.currency)) errors.push(`✗ ${w}: currency 缺失`);
  if (!isNum(cost.min)) errors.push(`✗ ${w}: min 必須為數字`);
  if (!isNum(cost.max)) errors.push(`✗ ${w}: max 必須為數字`);
  if (isNum(cost.min) && isNum(cost.max) && cost.min > cost.max) errors.push(`✗ ${w}: min > max`);
}

function validatePoi(p, idx, ctx, errors, warnings) {
  const where = `pois[${idx}]${p.id ? ` (${p.id})` : ''}`;
  if (!isStr(p.id) || !/^[a-z][a-z0-9-]*$/.test(p.id)) errors.push(`✗ ${where}: id 必須為小寫英數字（連字號）`);
  if (!isStr(p.name)) errors.push(`✗ ${where}: name 缺失`);
  if (!KIND.includes(p.kind)) errors.push(`✗ ${where}: kind 必須為 ${KIND.join('|')}`);
  if (p.effort !== undefined && !EFFORT.includes(p.effort)) errors.push(`✗ ${where}: effort 必須為 ${EFFORT.join('|')}`);
  if (p.durationMin !== undefined && (!isInt(p.durationMin) || p.durationMin <= 0)) errors.push(`✗ ${where}: durationMin 必須為正整數`);

  const hasLat = p.lat !== undefined, hasLng = p.lng !== undefined;
  if (hasLat !== hasLng) {
    errors.push(`✗ ${where}: lat/lng 必須成對出現`);
  } else if (hasLat) {
    if (!isNum(p.lat) || !isNum(p.lng)) errors.push(`✗ ${where}: lat/lng 必須為數字`);
    else if (p.lat < BBOX.latMin || p.lat > BBOX.latMax || p.lng < BBOX.lngMin || p.lng > BBOX.lngMax) {
      errors.push(`✗ ${where}: 座標 ${p.lat},${p.lng} 超出範圍（地圖會飛走）`);
    }
  } else {
    warnings.push(`⚠ ${where}: 無座標，不會出現在地圖與導航上`);
  }

  if (p.img) {
    const imgPath = path.join(ROOT, 'itineraries', ctx.imgDir, p.img);
    if (!fs.existsSync(imgPath)) {
      errors.push(`✗ ${where}: 圖片不存在 ${ctx.imgDir}/${p.img}`);
    }
    const key = p.img.replace(/\.[^.]+$/, '');
    if (ctx.credits && !ctx.credits[key]) {
      errors.push(`✗ ${where}: 圖片 ${p.img} 在 _credits.json 沒有授權條目（key=${key}）— 授權漏標`);
    }
  }

  validateCost(p.cost, where, errors);
  validateNotes(p.notes, where, errors);
}

function validateDay(day, idx, ctx, errors) {
  const where = `days[${idx}] (${day.date || '?'})`;
  if (!DATE_RE.test(day.date || '')) errors.push(`✗ ${where}: date 格式必須為 YYYY-MM-DD`);
  if (!isStr(day.label)) errors.push(`✗ ${where}: label 缺失`);
  if (!INTENSITY.includes(day.intensity)) errors.push(`✗ ${where}: intensity 必須為 ${INTENSITY.join('|')}`);
  if (!isInt(day.fatigueTarget) || day.fatigueTarget < 1 || day.fatigueTarget > 5) {
    errors.push(`✗ ${where}: fatigueTarget 必須為 1–5 整數`);
  }
  if (day.stay !== null && day.stay !== undefined && !ctx.stayIds.has(day.stay)) {
    errors.push(`✗ ${where}: stay 參照不存在的住宿 "${day.stay}"`);
  }
  validateNotes(day.dayNotes, where, errors);

  if (!isArr(day.slots) || day.slots.length === 0) {
    errors.push(`✗ ${where}: slots 應為非空陣列`);
    return;
  }

  day.slots.forEach((s, si) => {
    const sw = `${where}.slots[${si}] (${s.id || '?'})`;
    if (!SLOT_ID_RE.test(s.id || '')) {
      errors.push(`✗ ${sw}: id 必須符合 d##-s# 格式（消費／日誌綁在上面）`);
    } else if (ctx.seenSlotIds.has(s.id)) {
      errors.push(`✗ ${sw}: slot id 重複 —— 會造成消費／日誌互相污染`);
    } else {
      ctx.seenSlotIds.add(s.id);
    }
    if (!isStr(s.title)) errors.push(`✗ ${sw}: title 缺失`);
    if (!FLEX.includes(s.flex)) errors.push(`✗ ${sw}: flex 必須為 ${FLEX.join('|')}`);
    if (!KIND.includes(s.kind)) errors.push(`✗ ${sw}: kind 必須為 ${KIND.join('|')}`);
    if (!TIME_RE.test(s.start || '')) errors.push(`✗ ${sw}: start 格式必須為 HH:MM`);
    if (!TIME_RE.test(s.end || '')) errors.push(`✗ ${sw}: end 格式必須為 HH:MM`);
    if (TIME_RE.test(s.start || '') && TIME_RE.test(s.end || '') && toMin(s.start) >= toMin(s.end)) {
      errors.push(`✗ ${sw}: start 必須早於 end`);
    }
    if (s.poi !== null && s.poi !== undefined && !ctx.poiIds.has(s.poi)) {
      errors.push(`✗ ${sw}: poi 參照不存在 "${s.poi}"`);
    }
    if (s.alt && s.alt.poi && !ctx.poiIds.has(s.alt.poi)) {
      errors.push(`✗ ${sw}: alt.poi 參照不存在 "${s.alt.poi}"`);
    }
    validateCost(s.transit && s.transit.cost, `${sw}.transit`, errors);
    validateNotes(s.notes, sw, errors);
  });

  // 同一天非 optional 的時段不可重疊（optional 本來就是平行備選）
  const fixedish = day.slots.filter(s => s.flex !== 'optional' && TIME_RE.test(s.start || '') && TIME_RE.test(s.end || ''));
  for (let i = 0; i + 1 < fixedish.length; i++) {
    const a = fixedish[i], b = fixedish[i + 1];
    if (toMin(a.end) > toMin(b.start)) {
      errors.push(`✗ ${where}: ${a.id}（–${a.end}）與 ${b.id}（${b.start}–）時間重疊`);
    }
  }
}

function validateTrip(trip, file, allErrors, warnings) {
  const w = `itineraries/${file}`;
  // 先用本檔專屬的陣列收頭部錯誤：頭部壞掉就沒必要往下驗，
  // 但不能因此擋掉「其他行程檔」的驗證（errors 是跨檔共用的）。
  const errors = [];
  if (!isInt(trip.schemaVersion)) errors.push(`✗ ${w}: schemaVersion 缺失`);
  if (!isStr(trip.slug)) errors.push(`✗ ${w}: slug 缺失`);
  else if (`${trip.slug}.json` !== file) errors.push(`✗ ${w}: 檔名應與 slug 一致（期望 ${trip.slug}.json）`);
  if (!isStr(trip.title)) errors.push(`✗ ${w}: title 缺失`);
  if (!DATE_RE.test(trip.startDate || '')) errors.push(`✗ ${w}: startDate 格式錯`);
  if (!DATE_RE.test(trip.endDate || '')) errors.push(`✗ ${w}: endDate 格式錯`);
  if (!isStr(trip.timezone)) errors.push(`✗ ${w}: timezone 缺失（記帳日期換算要用）`);
  if (!trip.currency || !isStr(trip.currency.local) || !isStr(trip.currency.home)) {
    errors.push(`✗ ${w}: currency.local / currency.home 缺失`);
  }
  if (!isStr(trip.imgDir)) errors.push(`✗ ${w}: imgDir 缺失`);
  if (!trip.out || !isStr(trip.out.app)) errors.push(`✗ ${w}: out.app 缺失（產物檔名）`);
  if (!isArr(trip.stays)) errors.push(`✗ ${w}: stays 應為陣列`);
  if (!isArr(trip.pois)) errors.push(`✗ ${w}: pois 應為陣列`);
  if (!isArr(trip.days)) errors.push(`✗ ${w}: days 應為陣列`);
  if (errors.length) { allErrors.push(...errors); return; }

  // _credits.json（有就驗授權，沒有就警告）
  let credits = null;
  const creditsPath = path.join(ROOT, 'itineraries', trip.imgDir, '_credits.json');
  if (fs.existsSync(creditsPath)) {
    try { credits = JSON.parse(fs.readFileSync(creditsPath, 'utf8')); }
    catch (e) { errors.push(`✗ ${w}: _credits.json 無法 parse：${e.message}`); }
  } else {
    warnings.push(`⚠ ${w}: 找不到 ${trip.imgDir}/_credits.json，無法驗證圖片授權`);
  }

  const ctx = {
    imgDir: trip.imgDir,
    credits,
    poiIds: new Set(trip.pois.map(p => p.id)),
    stayIds: new Set(trip.stays.map(s => s.id)),
    seenSlotIds: new Set(),
  };

  if (ctx.poiIds.size !== trip.pois.length) errors.push(`✗ ${w}: POI id 有重複`);
  if (ctx.stayIds.size !== trip.stays.length) errors.push(`✗ ${w}: 住宿 id 有重複`);

  trip.pois.forEach((p, i) => validatePoi(p, i, ctx, errors, warnings));
  trip.days.forEach((d, i) => validateDay(d, i, ctx, errors));

  // 日期必須連續且完整涵蓋 startDate~endDate
  const expect = [];
  for (let cur = trip.startDate; ; cur = nextDate(cur)) {
    expect.push(cur);
    if (cur === trip.endDate || expect.length > 400) break;
  }
  const actual = trip.days.map(d => d.date);
  if (actual.join(',') !== expect.join(',')) {
    errors.push(`✗ ${w}: days 日期未連續涵蓋 ${trip.startDate}~${trip.endDate}\n    實際：${actual.join(', ')}\n    期望：${expect.join(', ')}`);
  }

  // 住宿必須首尾相接、覆蓋每一晚（最後一天不用住）
  const sorted = [...trip.stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  sorted.forEach((s, i) => {
    if (!DATE_RE.test(s.checkIn) || !DATE_RE.test(s.checkOut)) errors.push(`✗ ${w}: 住宿 ${s.id} checkIn/checkOut 格式錯`);
    if (i > 0 && sorted[i - 1].checkOut !== s.checkIn) {
      errors.push(`✗ ${w}: 住宿銜接有斷層／重疊：${sorted[i - 1].id} 到 ${sorted[i - 1].checkOut}，${s.id} 從 ${s.checkIn} 起`);
    }
  });
  if (sorted.length) {
    if (sorted[0].checkIn !== trip.startDate) errors.push(`✗ ${w}: 第一晚住宿未從 ${trip.startDate} 開始`);
    if (sorted[sorted.length - 1].checkOut !== trip.endDate) errors.push(`✗ ${w}: 最後一段住宿未到 ${trip.endDate} 退房`);
  }

  // 備選 POI 未排進行程：合理，只提示
  const used = new Set();
  trip.days.forEach(d => d.slots.forEach(s => {
    if (s.poi) used.add(s.poi);
    if (s.alt && s.alt.poi) used.add(s.alt.poi);
  }));
  trip.pois.forEach(p => {
    if (!used.has(p.id)) warnings.push(`⚠ ${w}: POI "${p.id}" 定義了但沒排進任何時段（備選景點則屬正常）`);
  });

  // 出發前還沒補上的待訂項目
  const daysLeft = Math.round((new Date(trip.startDate) - new Date()) / 86400000);
  const tbd = [];
  trip.days.forEach(d => d.slots.forEach(s => { if (s.tbd) tbd.push(s.id); }));
  if (tbd.length && daysLeft <= 7) {
    const msg = `${w}: 距出發 ${daysLeft} 天，仍有未定時間的項目：${tbd.join(', ')}`;
    if (daysLeft <= 3) errors.push(`✗ ${msg}`); else warnings.push(`⚠ ${msg}`);
  }

  allErrors.push(...errors);
}

function validateAll() {
  const errors = [];
  const warnings = [];
  const trips = [];

  if (!fs.existsSync(DATA_DIR)) return { errors, warnings, trips };

  fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort().forEach(file => {
    let trip;
    try {
      trip = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    } catch (e) {
      errors.push(`✗ data/itineraries/${file}: 無法 parse：${e.message}`);
      return;
    }
    trips.push(trip);
    validateTrip(trip, file, errors, warnings);
  });

  return { errors, warnings, trips };
}

if (require.main === module) {
  const { errors, warnings, trips } = validateAll();
  warnings.forEach(w => console.warn(w));
  if (errors.length === 0) {
    const stat = trips.map(t => {
      const slots = t.days.reduce((n, d) => n + d.slots.length, 0);
      return `${t.slug}（${t.days.length} 天 / ${t.pois.length} POI / ${slots} 時段）`;
    }).join('、');
    console.log(`✓ 行程驗證通過：${stat || '（無行程檔）'}`);
    process.exit(0);
  }
  console.error(`\n行程驗證失敗（${errors.length} 個錯誤）：\n`);
  errors.forEach(e => console.error(e));
  process.exit(1);
}

module.exports = { validateAll, NOTE_TYPES, WHO, INTENSITY, FLEX, KIND, BBOX };
