/* The bridge between the Dugout screens and Supabase.
   The screens talk to a tiny document store: db.doc('games/abc').set({...}), db.collection('players').onSnapshot(fn).
   Here that is mapped onto one Postgres table, public.docs (scope, col, id, data), with live updates. */
import { GEOCODER, MAPBOX_TOKEN } from '../config.js';

const GLOBAL = new Set(['agents', 'contacts', 'diamonds', 'invites']); // the league-wide sub list; everything else belongs to one team

export function createPlatform(sb, { session, teamId, role, profileName }) {
  const uid = session.user.id;
  const scopeOf = col => (GLOBAL.has(col) ? 'global' : teamId);
  const cache = new Map();      // col -> Map(id -> data)
  const colSubs = new Map();    // col -> Set(fn)
  const docSubs = new Map();    // 'col/id' -> Set(fn)
  const loaded = new Set();
  const loading = new Map();
  let channel = null;

  const docSnap = (col, id) => { const d = cache.get(col)?.get(id); return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)) }; };
  const colSnap = col => ({ docs: [...(cache.get(col) || new Map()).entries()].map(([id, d]) => ({ id, exists: true, data: () => structuredClone(d) })) });

  function emit(col, id) {
    (colSubs.get(col) || []).forEach(fn => fn(colSnap(col)));
    if (id != null) (docSubs.get(col + '/' + id) || []).forEach(fn => fn(docSnap(col, id)));
    else for (const [k, set] of docSubs) if (k.startsWith(col + '/')) set.forEach(fn => fn(docSnap(col, k.slice(col.length + 1))));
  }
  function put(col, id, data) { if (!cache.has(col)) cache.set(col, new Map()); if (data === undefined) cache.get(col).delete(id); else cache.get(col).set(id, data); emit(col, id); }

  function live() {
    if (channel) return;
    channel = sb.channel('docs-' + teamId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
        const row = p.eventType === 'DELETE' ? p.old : p.new;
        if (!row || (row.scope !== teamId && row.scope !== 'global') || !loaded.has(row.col)) return;
        if (row.scope !== scopeOf(row.col)) return;
        put(row.col, row.id, p.eventType === 'DELETE' ? undefined : row.data);
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') for (const col of loaded) refetch(col); }); // catch anything missed while reconnecting
  }
  async function refetch(col) {
    const { data, error } = await sb.from('docs').select('id,data').eq('scope', scopeOf(col)).eq('col', col);
    if (error) throw error;
    const m = new Map(); data.forEach(r => m.set(r.id, r.data)); cache.set(col, m); loaded.add(col); emit(col, null);
  }
  function ensure(col) {
    live();
    if (loaded.has(col)) return Promise.resolve();
    if (!loading.has(col)) loading.set(col, refetch(col).finally(() => loading.delete(col)));
    return loading.get(col);
  }
  // database errors → something the app can show. Messages raised by our own checks (code P0001) are written for people.
  const fail = e => {
    const err = new Error(e.message || 'failed');
    if (e.code === '42501' || /row-level security|not allowed/i.test(e.message || '')) err.code = 'not_granted';
    if (e.code === 'P0001' && e.message && e.message.length < 120) err.userMessage = e.message;
    return err;
  };
  const rpc = async (fn, args) => { const { error } = await sb.rpc(fn, args); if (error) throw fail(error); };
  const split = path => { const i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; };

  const db = {
    doc(path) {
      const [col, id] = split(path), scope = scopeOf(col);
      return {
        id,
        async get() { await ensure(col); return docSnap(col, id); },
        async set(data) {
          const { error } = await sb.from('docs').upsert({ scope, col, id, data });
          if (error) throw fail(error); put(col, id, structuredClone(data));
        },
        async update(patch) {
          const { error } = await sb.rpc('doc_update', { p_scope: scope, p_col: col, p_id: id, patch });
          if (error) throw fail(error); const cur = cache.get(col)?.get(id) || {}; put(col, id, { ...cur, ...structuredClone(patch) });
        },
        async delete() {
          const { error } = await sb.from('docs').delete().match({ scope, col, id });
          if (error) throw fail(error); put(col, id, undefined);
        },
        onSnapshot(fn, onErr) {
          const k = col + '/' + id; if (!docSubs.has(k)) docSubs.set(k, new Set()); docSubs.get(k).add(fn);
          ensure(col).then(() => fn(docSnap(col, id)), e => onErr && onErr(e));
          return () => docSubs.get(k).delete(fn);
        },
      };
    },
    collection(col) {
      return {
        async get() { await ensure(col); return colSnap(col); },
        refresh: () => (loaded.has(col) ? refetch(col) : ensure(col)),  // re-read after something changed what we're allowed to see
        onSnapshot(fn, onErr) {
          if (!colSubs.has(col)) colSubs.set(col, new Set()); colSubs.get(col).add(fn);
          ensure(col).then(() => fn(colSnap(col)), e => onErr && onErr(e));
          return () => colSubs.get(col).delete(fn);
        },
      };
    },
  };

  const user = {
    canEdit: () => role === 'captain',
    can: () => true,
    id: async () => uid,
    name: () => profileName,
    async profiles(ids) {
      const { data, error } = await sb.from('profiles').select('id,display_name').in('id', ids);
      if (error) throw error; const out = {}; data.forEach(p => out[p.id] = { name: p.display_name }); return out;
    },
  };

  return {
    teamId,
    claimPlayer: async pid => { await rpc('claim_player', { p_team: teamId, p_player: pid }); await refetch('players'); },
    unclaimPlayer: async pid => { await rpc('unclaim_player', { p_team: teamId, p_player: pid }); await refetch('players'); },
    use: async name => (name === 'db' ? db : name === 'user' ? user : null),
    geocode,
    stop: () => { if (channel) sb.removeChannel(channel); channel = null; },
  };
}

/* place text → { lat, lng, label }. Mapbox when a token is set (better for postal codes), otherwise OpenStreetMap's free Nominatim. */
export async function geocode(text) {
  if (GEOCODER === 'mapbox' && MAPBOX_TOKEN) {
    const u = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(text)}&limit=1&access_token=${MAPBOX_TOKEN}`;
    const j = await (await fetch(u)).json(); const f = j.features && j.features[0]; if (!f) return null;
    const [lng, lat] = f.geometry.coordinates; return { lat, lng, label: f.properties.place_formatted || f.properties.name || text };
  }
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(text)}`;
  const j = await (await fetch(u, { headers: { 'Accept-Language': navigator.language || 'en' } })).json(); const r = j[0]; if (!r) return null;
  const a = r.address || {}; const place = a.suburb || a.neighbourhood || a.city_district || a.town || a.city || a.village || r.name;
  const city = a.city || a.town || a.village || ''; const prov = a.state || '';
  const label = [place, place !== city ? city : prov].filter(Boolean).join(', '); // short, e.g. 'Etobicoke, Toronto'
  return { lat: +r.lat, lng: +r.lon, label: label || r.display_name.split(',').slice(0, 2).join(',') };
}
