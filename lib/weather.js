// 即時天氣 + AQI（瀏覽器端）
// 來源：Open-Meteo（免費、無需 key），1h localStorage 快取
(function (root) {
  const TTL = 60 * 60 * 1000;

  function cacheKey(prefix, lat, lng) {
    return `ct_${prefix}_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  }

  function readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > TTL) return null;
      return obj.data;
    } catch (_) { return null; }
  }

  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  }

  // WMO weather code 簡化敘述
  const WMO = {
    0: '☀ 晴', 1: '☀ 多雲晴', 2: '⛅ 多雲', 3: '☁ 陰',
    45: '🌫 霧', 48: '🌫 霧凇',
    51: '🌧 毛毛雨', 53: '🌧 毛毛雨', 55: '🌧 毛毛雨',
    61: '🌧 小雨', 63: '🌧 中雨', 65: '🌧 大雨',
    71: '🌨 小雪', 73: '🌨 中雪', 75: '🌨 大雪',
    77: '🌨 雪粒',
    80: '🌧 陣雨', 81: '🌧 陣雨', 82: '🌧 強陣雨',
    85: '🌨 陣雪', 86: '🌨 強陣雪',
    95: '⛈ 雷雨', 96: '⛈ 雷雨夾雹', 99: '⛈ 強雷雨',
  };

  async function fetchWeather(lat, lng) {
    const key = cacheKey('weather', lat, lng);
    const cached = readCache(key);
    if (cached) return cached;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      const cur = j.current || {};
      const daily = j.daily || {};
      const max = (daily.temperature_2m_max || []);
      const min = (daily.temperature_2m_min || []);
      const data = {
        current: cur.temperature_2m !== undefined ? Math.round(cur.temperature_2m) : '—',
        weather: WMO[cur.weather_code] || '—',
        forecastMin: min.length ? Math.round(Math.min(...min)) : '—',
        forecastMax: max.length ? Math.round(Math.max(...max)) : '—',
      };
      writeCache(key, data);
      return data;
    } catch (_) { return null; }
  }

  async function fetchAQI(lat, lng) {
    const key = cacheKey('aqi', lat, lng);
    const cached = readCache(key);
    if (cached) return cached;
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,european_aqi`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      const cur = j.current || {};
      const data = {
        aqi: cur.european_aqi !== undefined ? Math.round(cur.european_aqi) : '—',
        pm25: cur.pm2_5 !== undefined ? Math.round(cur.pm2_5 * 10) / 10 : '—',
      };
      writeCache(key, data);
      return data;
    } catch (_) { return null; }
  }

  root.CT_WEATHER = { fetchWeather, fetchAQI };
}(typeof self !== 'undefined' ? self : this));
