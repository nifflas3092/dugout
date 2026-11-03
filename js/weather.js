/* Game-time weather from MET Norway (api.met.no), the Norwegian Meteorological Institute.
   Free for commercial use under CC BY 4.0 as long as they're credited; forecasts cover the next ~9 days.
   We only ever send a location rounded to about 1 km, and we keep each forecast until MET says it's stale. */

const cache = new Map();          // "43.65,-79.51" -> { exp, series } | { promise }
const LSKEY = 'dugout-wx-';
const MIN_KEEP = 30 * 60 * 1000;  // never re-ask more often than every 30 minutes

export const CREDIT = 'Forecast from <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a> (CC BY 4.0)';

const keyOf = (lat, lng) => `${(+lat).toFixed(2)},${(+lng).toFixed(2)}`;

/* returns the cached forecast series right away (or null), and calls onReady once a fresh one arrives */
export function forecast(lat, lng, onReady) {
  if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return null;
  const key = keyOf(lat, lng);
  let hit = cache.get(key);
  if (!hit) { try { const s = JSON.parse(localStorage.getItem(LSKEY + key) || 'null'); if (s && s.exp > Date.now()) { hit = s; cache.set(key, s); } } catch (_) {} }
  if (hit && hit.series && hit.exp > Date.now()) return hit.series;
  if (!hit || !hit.promise) {
    const [la, lo] = key.split(',');
    const promise = fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`)
      .then(r => { if (!r.ok) throw new Error('weather ' + r.status); const exp = Date.parse(r.headers.get('expires') || '') || 0; return r.json().then(j => ({ j, exp })); })
      .then(({ j, exp }) => {
        const series = (j.properties && j.properties.timeseries || []).map(t => ({
          t: Date.parse(t.time),
          temp: t.data.instant.details.air_temperature,
          wind: t.data.instant.details.wind_speed,
          h1: t.data.next_1_hours ? { sym: t.data.next_1_hours.summary.symbol_code, mm: t.data.next_1_hours.details.precipitation_amount || 0 } : null,
          h6: t.data.next_6_hours ? { sym: t.data.next_6_hours.summary.symbol_code, mm: t.data.next_6_hours.details.precipitation_amount || 0 } : null,
        }));
        const entry = { exp: Math.max(exp, Date.now() + MIN_KEEP), series };
        cache.set(key, entry);
        try { localStorage.setItem(LSKEY + key, JSON.stringify(entry)); } catch (_) {}
        onReady && onReady();
      })
      .catch(() => { cache.set(key, { exp: Date.now() + 10 * 60 * 1000, series: [] }); }); // offline or down: try again in 10 minutes
    cache.set(key, { ...(hit || {}), promise });
  }
  return hit && hit.series ? hit.series : null;
}

/* each forecast step as a time span with its rain amount; hourly where MET has it, 6-hourly further out */
function spans(series) {
  const out = [];
  for (const s of series) {
    if (s.h1) out.push({ a: s.t, b: s.t + 3600e3, mm: s.h1.mm, sym: s.h1.sym, temp: s.temp, wind: s.wind });
    else if (s.h6 && (!out.length || s.t >= out[out.length - 1].b)) out.push({ a: s.t, b: s.t + 6 * 3600e3, mm: s.h6.mm, sym: s.h6.sym, temp: s.temp, wind: s.wind });
  }
  return out;
}
const rainIn = (sp, a, b) => sp.reduce((sum, s) => { const o = Math.max(0, Math.min(b, s.b) - Math.max(a, s.a)); return sum + (o ? s.mm * o / (s.b - s.a) : 0); }, 0);

/* what the weather looks like for a game: null if it's outside the forecast window */
export function outlook(series, date, time) {
  if (!series || !series.length || !date) return null;
  const start = new Date(`${date}T${time || '18:30'}`).getTime(), end = start + 90 * 60e3;
  if (!Number.isFinite(start) || end < Date.now() - 3600e3) return null;
  const sp = spans(series);
  if (!sp.length || start < sp[0].a - 3600e3 || start > sp[sp.length - 1].b) return null;
  const during = rainIn(sp, start, end), before = rainIn(sp, start - 6 * 3600e3, start);
  const covering = sp.filter(s => s.b > start && s.a < end);
  const at = covering[0] || sp.reduce((best, s) => (Math.abs(s.a - start) < Math.abs(best.a - start) ? s : best), sp[0]);
  const thunder = covering.some(s => /thunder/.test(s.sym));
  const snow = covering.some(s => /snow|sleet/.test(s.sym));
  let level = 'ok', text = 'Looks playable';
  if (thunder) { level = 'high'; text = 'Thunderstorms possible. Lightning stops play'; }
  else if (snow) { level = 'high'; text = 'Snow or sleet in the forecast'; }
  else if (during >= 2) { level = 'high'; text = `Rain likely during the game (about ${Math.round(during)} mm)`; }
  else if (during + before >= 6) { level = 'high'; text = `Heavy rain beforehand (about ${Math.round(during + before)} mm). Field may be unplayable`; }
  else if (during >= 0.4) { level = 'watch'; text = 'Some showers possible during the game'; }
  else if (before >= 2) { level = 'watch'; text = `Rain earlier (about ${Math.round(before)} mm). Field may be wet`; }
  return { level, text, temp: Math.round(at.temp), wind: Math.round(at.wind * 3.6), icon: icon(at.sym), during, before, days: Math.round((start - Date.now()) / 864e5) };
}

function icon(sym = '') {
  if (/thunder/.test(sym)) return '⛈️';
  if (/snow|sleet/.test(sym)) return '🌨️';
  if (/rain/.test(sym)) return '🌧️';
  if (/fog/.test(sym)) return '🌫️';
  if (/partlycloudy|fair/.test(sym)) return /night/.test(sym) ? '☁️' : '⛅';
  if (/cloudy/.test(sym)) return '☁️';
  if (/clearsky/.test(sym)) return /night/.test(sym) ? '🌙' : '☀️';
  return '🌡️';
}
