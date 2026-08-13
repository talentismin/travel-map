// ── Service Worker：旅居城市地圖 ───────────────────────────
// 策略：
//   - city_pages / proposal_pages → Stale-While-Revalidate
//       （秒開＋背景抓新版回填，下次必為最新；離線仍可讀）
//   - 地圖主頁 → Network First（保持最新），離線時降級到快取
//   - Leaflet CDN → Cache First（版本固定）
//   - 地圖 Tiles → 不快取（體積過大）
//
// CACHE_NAME 帶部署 build id（deploy workflow 注入 commit sha）：
// 每次部署 → cache 名變更 → activate 清掉所有舊快取 → 內容必更新。
// 本機未注入時退回 'dev'。

const BUILD_ID = 'd3bb67faf4de7bd26a592a9f9789598729fb9a60';
const CACHE_NAME = 'china-travel-' +
  (BUILD_ID.indexOf('BUILD_ID') !== -1 ? 'dev' : BUILD_ID);

const PRECACHE_URLS = [
  './city_map.html',
  './manifest.json',
];

// ── Install：預快取核心資源 ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate：清除舊版快取 ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch：攔截請求 ──────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 不快取地圖 tiles
  if (url.hostname.includes('cartocdn') || url.hostname.includes('openstreetmap')) {
    return; // 直接走網路
  }

  // Leaflet CDN → Cache First
  if (url.hostname.includes('unpkg.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 旅伴 App 頁 → Network First
  // 行程可能在旅途中臨時改（改了時間、加了備註），這頁必須拿得到最新版；
  // 走 Cache First 的話要等 SW 換代，同行的人會看到舊行程。離線時仍降級到快取。
  if (url.pathname.endsWith('_app.html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // city_pages / proposal_pages / 行程頁與其圖片 → Stale-While-Revalidate
  if (url.pathname.includes('/city_pages/') || url.pathname.includes('/proposal_pages/') ||
      url.pathname.includes('/itineraries/')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 主地圖頁 → Network First，離線降級
  if (url.pathname.endsWith('city_map.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 其他本地資源 → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
});

// ── Cache First ───────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('離線中，尚未快取此頁面。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// ── Stale-While-Revalidate ────────────────────────────────
// 立刻回快取（秒開），同時背景抓網路最新版回填 cache，
// 下一次造訪即拿到新內容；無快取則等網路；離線給提示。
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    network; // 背景更新，不 await
    return cached;
  }
  const fresh = await network;
  return fresh || new Response('離線中，尚未快取此頁面。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ── Network First ─────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('離線中，請先連線載入頁面。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
