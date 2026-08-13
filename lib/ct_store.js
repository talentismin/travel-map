// 旅程本機記錄（消費／體力／日誌），Node 與瀏覽器都可用
//
// 設計取捨：
//  - 整包存在單一 localStorage key。9 天的量最多幾十 KB，序列化成本可忽略，
//    換來「匯出＝一個 stringify」「配額一致」「不會 key 爆炸」。
//  - 照片不放這裡（會爆 5MB），走 IndexedDB，見 lib/ct_photos.js。
//  - 每筆帶 updatedAt 與 deleted(tombstone)，兩支手機互匯才能合併而不是互蓋。
//  - amountHome（台幣值）在「寫入當下」就凍結。匯率天天變，若每次顯示重算，
//    昨天的總額今天會跳，記帳就沒有信用了。
//
// ⚠️ 日期一律走 tripToday(tz)。絕不可用 toISOString().slice(0,10) —— 那是 UTC，
//    韓國凌晨 00:30 會被記到前一天（宵夜炸雞正好落在那個時間）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CT_STORE = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var SCHEMA = 1;
  var SAVE_DEBOUNCE = 300;

  function keyFor(slug) { return 'ct_trip_' + slug + '_v' + SCHEMA; }

  // ── 日期 ────────────────────────────────────────────────
  function tripToday(tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date());
  }
  function nowISO() { return new Date().toISOString(); }

  function uid(prefix) {
    var r = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return prefix + '_' + r;
  }

  // ── 讀寫 ────────────────────────────────────────────────
  function blank(slug) {
    return {
      schemaVersion: SCHEMA,
      tripSlug: slug,
      deviceId: uid('dev'),
      updatedAt: nowISO(),
      lastExportAt: null,
      settings: { lockedRate: null, viewMode: 'all' },
      expenses: [],
      fatigue: {},
      logs: {},
      photoMeta: [],
    };
  }

  function migrate(d, slug) {
    if (!d || typeof d !== 'object') return blank(slug);
    // 未來 schema 升版在這裡逐版遷移；目前只補齊缺欄位。
    var b = blank(slug);
    for (var k in b) if (!(k in d)) d[k] = b[k];
    if (!d.settings) d.settings = b.settings;
    d.tripSlug = slug;
    return d;
  }

  function load(slug) {
    try {
      var raw = localStorage.getItem(keyFor(slug));
      return migrate(raw ? JSON.parse(raw) : null, slug);
    } catch (_) {
      return blank(slug);
    }
  }

  var _timer = null;
  var _pending = null;

  function writeNow(data) {
    if (!data) return { ok: true };
    data.updatedAt = nowISO();
    try {
      localStorage.setItem(keyFor(data.tripSlug), JSON.stringify(data));
      _pending = null;
      return { ok: true };
    } catch (e) {
      // QuotaExceededError：多半是照片縮圖塞太多
      return { ok: false, error: e && e.name ? e.name : 'unknown' };
    }
  }

  // 輸入當下就排寫入；離開頁面前務必 flush()
  function save(data) {
    _pending = data;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () { _timer = null; writeNow(_pending); }, SAVE_DEBOUNCE);
  }

  function flush() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    return _pending ? writeNow(_pending) : { ok: true };
  }

  // iOS 上 beforeunload 常常不觸發，一定要掛 visibilitychange / pagehide
  function autoFlush() {
    if (typeof document === 'undefined') return;
    var f = function () { flush(); };
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') f();
    });
    window.addEventListener('pagehide', f);
  }

  // ── 消費 ────────────────────────────────────────────────
  var CATEGORIES = [
    { id: 'food', label: '吃', icon: '🍜' },
    { id: 'cafe', label: '咖啡', icon: '☕' },
    { id: 'transport', label: '交通', icon: '🚇' },
    { id: 'ticket', label: '門票', icon: '🎟' },
    { id: 'shopping', label: '購物', icon: '🛍' },
    { id: 'stay', label: '住宿', icon: '🏨' },
    { id: 'other', label: '其他', icon: '💸' },
  ];

  function addExpense(data, e) {
    var row = {
      id: uid('exp'),
      ts: nowISO(),
      date: e.date,
      slotId: e.slotId || null,
      poiId: e.poiId || null,
      amount: Number(e.amount),
      currency: e.currency || 'KRW',
      amountHome: Number(e.amountHome),
      rate: Number(e.rate),
      rateSource: e.rateSource || 'snapshot',
      category: e.category || 'other',
      payer: e.payer || 'shared',
      method: e.method || 'card',
      note: e.note || '',
      updatedAt: nowISO(),
      deleted: false,
    };
    data.expenses.push(row);
    return row;
  }

  function updateExpense(data, id, patch) {
    var row = data.expenses.find(function (x) { return x.id === id; });
    if (!row) return null;
    for (var k in patch) row[k] = patch[k];
    row.updatedAt = nowISO();
    return row;
  }

  // 軟刪除：留 tombstone，否則兩機互匯時被刪的那筆會「復活」
  function deleteExpense(data, id) {
    return updateExpense(data, id, { deleted: true });
  }

  function liveExpenses(data) {
    return data.expenses.filter(function (x) { return !x.deleted; });
  }

  function totals(data) {
    var byDate = {}, byCategory = {}, all = 0;
    liveExpenses(data).forEach(function (x) {
      all += x.amountHome;
      byDate[x.date] = (byDate[x.date] || 0) + x.amountHome;
      byCategory[x.category] = (byCategory[x.category] || 0) + x.amountHome;
    });
    return { all: all, byDate: byDate, byCategory: byCategory };
  }

  function expensesFor(data, opts) {
    return liveExpenses(data).filter(function (x) {
      if (opts.date && x.date !== opts.date) return false;
      if (opts.slotId && x.slotId !== opts.slotId) return false;
      return true;
    });
  }

  // ── 體力 ────────────────────────────────────────────────
  function setFatigue(data, date, patch) {
    var cur = data.fatigue[date] || { date: date };
    for (var k in patch) cur[k] = patch[k];
    cur.updatedAt = nowISO();
    data.fatigue[date] = cur;
    return cur;
  }

  // ── 日誌 ────────────────────────────────────────────────
  function setLog(data, poiId, patch) {
    var cur = data.logs[poiId] || { poiId: poiId, text: '', photoIds: [], deleted: false };
    for (var k in patch) cur[k] = patch[k];
    cur.updatedAt = nowISO();
    data.logs[poiId] = cur;
    return cur;
  }

  // ── 匯出／匯入 ──────────────────────────────────────────
  function exportBackup(data, tripHash) {
    return {
      format: 'ct-trip-backup',
      version: 1,
      exportedAt: nowISO(),
      deviceId: data.deviceId,
      tripSlug: data.tripSlug,
      tripHash: tripHash || null,
      data: data,
    };
  }

  // 合併，不是覆蓋：兩支手機各記各的，互匯後應為聯集
  //   同 id → updatedAt 新者勝；任一邊 deleted → 刪除勝
  function mergeList(mine, theirs, keyName) {
    var byId = {};
    mine.forEach(function (x) { byId[x[keyName]] = x; });
    var added = 0, updated = 0;
    theirs.forEach(function (t) {
      var m = byId[t[keyName]];
      if (!m) { byId[t[keyName]] = t; added++; return; }
      if (t.deleted && !m.deleted) { byId[t[keyName]] = t; updated++; return; }
      if (m.deleted && !t.deleted) return;                 // 刪除勝
      if ((t.updatedAt || '') > (m.updatedAt || '')) { byId[t[keyName]] = t; updated++; }
    });
    return { list: Object.keys(byId).map(function (k) { return byId[k]; }), added: added, updated: updated };
  }

  function mergeMap(mine, theirs) {
    var out = {}, added = 0, updated = 0;
    for (var k in mine) out[k] = mine[k];
    for (var k2 in theirs) {
      var t = theirs[k2], m = out[k2];
      if (!m) { out[k2] = t; added++; continue; }
      if ((t.updatedAt || '') > (m.updatedAt || '')) { out[k2] = t; updated++; }
    }
    return { map: out, added: added, updated: updated };
  }

  function importBackup(data, backup) {
    if (!backup || backup.format !== 'ct-trip-backup') {
      return { ok: false, error: '這不是本 App 的備份檔' };
    }
    if (backup.tripSlug !== data.tripSlug) {
      return { ok: false, error: '備份是別趟旅行的（' + backup.tripSlug + '）' };
    }
    var incoming = backup.data || {};
    var stat = { expenses: { added: 0, updated: 0 }, fatigue: { added: 0, updated: 0 }, logs: { added: 0, updated: 0 }, photoMeta: { added: 0, updated: 0 } };

    var e = mergeList(data.expenses, incoming.expenses || [], 'id');
    data.expenses = e.list; stat.expenses = { added: e.added, updated: e.updated };

    var f = mergeMap(data.fatigue, incoming.fatigue || {});
    data.fatigue = f.map; stat.fatigue = { added: f.added, updated: f.updated };

    var l = mergeMap(data.logs, incoming.logs || {});
    data.logs = l.map; stat.logs = { added: l.added, updated: l.updated };

    var p = mergeList(data.photoMeta || [], incoming.photoMeta || [], 'id');
    data.photoMeta = p.list; stat.photoMeta = { added: p.added, updated: p.updated };

    // settings 不合併：鎖定匯率與視角是每台裝置自己的事
    return { ok: true, stat: stat };
  }

  return {
    SCHEMA: SCHEMA,
    CATEGORIES: CATEGORIES,
    keyFor: keyFor,
    tripToday: tripToday,
    uid: uid,
    blank: blank,
    load: load,
    save: save,
    flush: flush,
    writeNow: writeNow,
    autoFlush: autoFlush,
    addExpense: addExpense,
    updateExpense: updateExpense,
    deleteExpense: deleteExpense,
    liveExpenses: liveExpenses,
    expensesFor: expensesFor,
    totals: totals,
    setFatigue: setFatigue,
    setLog: setLog,
    exportBackup: exportBackup,
    importBackup: importBackup,
  };
}));
