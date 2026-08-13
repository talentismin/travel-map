// 旅遊日誌照片：IndexedDB 存原圖，localStorage 只放縮圖（見 lib/ct_store.js）
//
// ⚠️ 三個 iOS Safari 的坑，全部繞開了，改的時候別退回去：
//  1. 存 ArrayBuffer 而不是 Blob。Safari 有「Blob 寫進 IDB、讀回來變空」的歷史 bug，
//     尤其在 page / service worker 生命週期交界時。讀回來再 new Blob([buf]) 組回去。
//  2. createImageBitmap 要帶 { imageOrientation: 'from-image' }，否則 iPhone 直向手持拍的
//     照片會躺著（EXIF orientation 沒被套用）。不支援時走 <img>.decode() fallback。
//  3. 逐張序列處理。Promise.all 一次壓 20 張會讓 iOS 直接殺掉分頁。
//
// 無痕模式配額極小甚至開不了 IDB —— isAvailable() 會回 false，UI 要據此停用照片功能。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CT_PHOTOS = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var DB_NAME = 'ct_photos';
  var DB_VER = 1;
  var STORE = 'photos';

  var MAX_EDGE = 1600;       // 原圖長邊
  var QUALITY = 0.72;
  var RETRY_QUALITY = 0.60;  // 超過 SIZE_LIMIT 再壓一次
  var SIZE_LIMIT = 600 * 1024;
  var THUMB_EDGE = 120;
  var THUMB_QUALITY = 0.5;
  var QUOTA_STOP = 0.8;      // 用量超過 80% 就擋新增

  var _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var tryOpen = function (attempt) {
        var req;
        try { req = indexedDB.open(DB_NAME, DB_VER); }
        catch (e) { return reject(e); }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var os = db.createObjectStore(STORE, { keyPath: 'id' });
            os.createIndex('by_trip', 'tripSlug', { unique: false });
            os.createIndex('by_trip_poi', ['tripSlug', 'poiId'], { unique: false });
          }
        };
        req.onsuccess = function () { _db = req.result; resolve(_db); };
        req.onerror = function () {
          // 頁面剛載入時偶爾會拿到壞連線，退一步再試一次
          if (attempt < 1) setTimeout(function () { tryOpen(attempt + 1); }, 500);
          else reject(req.error || new Error('IndexedDB 開啟失敗'));
        };
      };
      tryOpen(0);
    });
  }

  function isAvailable() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(false);
    return openDB().then(function () { return true; }).catch(function () { return false; });
  }

  function tx(mode) {
    return openDB().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function reqP(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  // ── 配額 ──
  function quota() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve({ usage: 0, quota: 0, ratio: 0, known: false });
    }
    return navigator.storage.estimate().then(function (e) {
      var usage = e.usage || 0, q = e.quota || 0;
      return { usage: usage, quota: q, ratio: q ? usage / q : 0, known: !!q };
    });
  }

  function persist() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  // ── 解碼（含 EXIF 方向修正）──
  function decode(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('無法解碼這張圖（HEIC？）')); };
      img.src = url;
    });
  }

  function drawScaled(src, maxEdge, quality) {
    var w = src.width, h = src.height;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var dw = Math.round(w * scale), dh = Math.round(h * scale);
    var canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    canvas.getContext('2d').drawImage(src, 0, 0, dw, dh);
    return { canvas: canvas, w: dw, h: dh, quality: quality };
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (res) {
      canvas.toBlob(function (b) { res(b); }, 'image/jpeg', quality);
    });
  }

  // 逐張處理：回 { meta, buf }
  function processOne(file, tripSlug, poiId, date) {
    return decode(file).then(function (bmp) {
      var big = drawScaled(bmp, MAX_EDGE, QUALITY);
      var small = drawScaled(bmp, THUMB_EDGE, THUMB_QUALITY);
      var thumb = small.canvas.toDataURL('image/jpeg', THUMB_QUALITY);
      if (bmp.close) bmp.close();

      return canvasToBlob(big.canvas, QUALITY).then(function (blob) {
        if (blob && blob.size > SIZE_LIMIT) return canvasToBlob(big.canvas, RETRY_QUALITY);
        return blob;
      }).then(function (blob) {
        if (!blob) throw new Error('壓縮失敗');
        return blob.arrayBuffer().then(function (buf) {
          var id = 'ph_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
            : Math.random().toString(36).slice(2, 14));
          return {
            meta: {
              id: id, poiId: poiId, date: date,
              w: big.w, h: big.h, bytes: buf.byteLength, mime: 'image/jpeg',
              thumb: thumb, updatedAt: new Date().toISOString(), deleted: false,
            },
            record: {
              id: id, tripSlug: tripSlug, poiId: poiId, date: date,
              buf: buf, mime: 'image/jpeg', w: big.w, h: big.h,
              bytes: buf.byteLength, createdAt: new Date().toISOString(),
            },
          };
        });
      });
    });
  }

  // files：FileList / Array。onProgress(done, total)
  // 序列處理，不用 Promise.all（iOS 記憶體會爆）
  function addPhotos(files, tripSlug, poiId, date, onProgress) {
    var list = Array.prototype.slice.call(files);
    var out = [], errs = [];
    return quota().then(function (q) {
      if (q.known && q.ratio > QUOTA_STOP) {
        throw new Error('儲存空間已用 ' + Math.round(q.ratio * 100) + '%，請先匯出備份再繼續');
      }
      return list.reduce(function (chain, f, i) {
        return chain.then(function () {
          return processOne(f, tripSlug, poiId, date).then(function (r) {
            return tx('readwrite').then(function (store) {
              return reqP(store.put(r.record));
            }).then(function () {
              out.push(r.meta);
              if (onProgress) onProgress(i + 1, list.length);
            });
          }).catch(function (e) {
            errs.push((f.name || '第 ' + (i + 1) + ' 張') + '：' + e.message);
            if (onProgress) onProgress(i + 1, list.length);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return { metas: out, errors: errs };
    });
  }

  // 讀回原圖 → objectURL（Blob 在這裡才組回去）
  function getObjectURL(id) {
    return tx('readonly').then(function (store) { return reqP(store.get(id)); })
      .then(function (rec) {
        if (!rec || !rec.buf) return null;
        return URL.createObjectURL(new Blob([rec.buf], { type: rec.mime || 'image/jpeg' }));
      });
  }

  function getBlob(id) {
    return tx('readonly').then(function (store) { return reqP(store.get(id)); })
      .then(function (rec) {
        return rec && rec.buf ? new Blob([rec.buf], { type: rec.mime || 'image/jpeg' }) : null;
      });
  }

  function removePhoto(id) {
    return tx('readwrite').then(function (store) { return reqP(store.delete(id)); });
  }

  function countFor(tripSlug) {
    return tx('readonly').then(function (store) {
      return reqP(store.index('by_trip').count(IDBKeyRange.only(tripSlug)));
    }).catch(function () { return 0; });
  }

  return {
    isAvailable: isAvailable,
    addPhotos: addPhotos,
    getObjectURL: getObjectURL,
    getBlob: getBlob,
    removePhoto: removePhoto,
    countFor: countFor,
    quota: quota,
    persist: persist,
    MAX_EDGE: MAX_EDGE,
    THUMB_EDGE: THUMB_EDGE,
  };
}));
