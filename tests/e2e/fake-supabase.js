// In-browser stand-in for @supabase/supabase-js, for testing the Dugout app without a real backend.
// State lives in localStorage so several pages (users) in one browser context share it, like a server.
const K = 'fake-sb-db';
const load = () => { const d = JSON.parse(localStorage.getItem(K) || '{"profiles":[],"teams":[],"team_members":[],"docs":[]}'); d.accounts = d.accounts || []; d.users = d.users || []; d.seen = d.seen || {}; d.admins = d.admins || []; d.bans = d.bans || []; d.log = d.log || []; return d; };
const acct = (d, id) => { let a = d.accounts.find(x => x.user_id === id); if (!a) { a = { user_id: id, captain_status: 'none', captain_until: null, grandfathered: false, ad_free: false, cal_token: 'c'.repeat(64) }; d.accounts.push(a); } return a; };
const isAdm = d => d.admins.includes(ME()?.id);
const banned = d => d.bans.some(b => b.user_id === ME()?.id);
const paid = (d, id) => { const a = acct(d, id); return a.grandfathered || ['active', 'trialing'].includes(a.captain_status); };
const save = d => { localStorage.setItem(K, JSON.stringify(d)); bc.postMessage('x'); };
const bc = new BroadcastChannel('fake-sb');
const listeners = new Set();
bc.onmessage = () => listeners.forEach(f => f());
let n = 0; const rid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ME = () => window.__fakeUser || JSON.parse(sessionStorage.getItem('fakeUser') || 'null'); // { id, email, name }
const pk = { accounts: ['user_id'], profiles: ['id'], teams: ['id'], team_members: ['team_id', 'user_id'], docs: ['scope', 'col', 'id'] };
const isMember = (d, t) => d.team_members.some(m => m.team_id === t && m.user_id === ME()?.id);
const isCap = (d, t) => d.team_members.some(m => m.team_id === t && m.user_id === ME()?.id && m.role === 'captain');
function canWriteDoc(d, r, old) {
  if (r.scope !== 'global') {
    if (isCap(d, r.scope)) return true;
    if (r.col === 'rsvp') return isMember(d, r.scope) && d.docs.some(p => p.scope === r.scope && p.col === 'players' && p.id === r.data.p && p.data.uid === ME().id);
    if (r.col === 'posts' || r.col === 'chat') return isMember(d, r.scope) && !old;
    return false;
  }
  if (r.col === 'agents' || r.col === 'contacts') return r.id === ME().id;
  if (r.col === 'listings') return (!old || old.owner === ME().id) && (r === old || (!banned(d) && !(old && old.data.status === 'removed') && r.data.status !== 'removed'));
  if (r.col === 'threads') return !old && !banned(d) && r.id.endsWith('_' + ME().id);
  if (r.col === 'messages') { const t = d.docs.find(x => x.col === 'threads' && x.id === r.data.thread); return !old && t && (t.data.buyer === ME().id || t.data.seller === ME().id); }
  if (r.col === 'reports') return !old;
  if (r.col === 'diamonds') return old ? old.owner === ME().id : d.team_members.some(m => m.user_id === ME().id && m.role === 'captain');
  if (r.col === 'invites') return old ? (old.owner === ME().id || old.data.agent === ME().id) : d.team_members.some(m => m.user_id === ME().id && m.role === 'captain');
  return false;
}
function canRead(d, table, r) {
  if (table === 'docs') {
    if (r.col === 'contacts') return r.id === ME().id || d.docs.some(i => i.col === 'invites' && i.owner === ME().id && i.data.agent === r.id && i.data.status === 'accepted');
    if (r.col === 'invites') return r.owner === ME().id || r.data.agent === ME().id;
    if (r.col === 'threads') return r.data.buyer === ME().id || r.data.seller === ME().id;
    if (r.col === 'messages') { const t = d.docs.find(x => x.col === 'threads' && x.id === r.data.thread); return t && (t.data.buyer === ME().id || t.data.seller === ME().id); }
    if (r.col === 'reports') return isAdm(d);
    if (r.col === 'listings' && r.data.status === 'removed') return r.owner === ME().id || isAdm(d);
    if (r.col === 'agents') return r.id === ME().id || paid(d, ME().id);
    return r.scope === 'global' || isMember(d, r.scope);
  }
  if (table === 'teams') return isMember(d, r.id);
  if (table === 'team_members') return isMember(d, r.team_id);
  if (table === 'accounts') return r.user_id === ME()?.id;
  return true;
}
const denied = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select(cols) { if (this.op === 'select') this.cols = cols; return this; }
  eq(k, v) { this.f.push(r => String(r[k]) === String(v)); return this; }
  in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
  match(o) { Object.entries(o).forEach(([k, v]) => this.eq(k, v)); return this; }
  upsert(row) { this.op = 'upsert'; this.row = row; return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { this.single = true; return this; }
  order() { return this; }
  limit() { return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const d = load(); if (this.t === 'accounts' && ME()) acct(d, ME().id); const rows = d[this.t]; const hit = r => this.f.every(f => f(r));
    if (this.op === 'select') {
      let out = rows.filter(r => hit(r) && canRead(d, this.t, r));
      if (this.t === 'team_members') out = out.map(m => ({ ...m, teams: d.teams.find(t => t.id === m.team_id), profiles: { display_name: d.profiles.find(p => p.id === m.user_id)?.display_name } }));
      return { data: this.single ? out[0] || null : out, error: null };
    }
    if (this.op === 'upsert') {
      const r = { ...this.row }; const old = rows.find(x => pk[this.t].every(k => x[k] === r[k]));
      if (this.t === 'docs') { if (!canWriteDoc(d, r, old)) return denied(); r.owner = old ? old.owner : ME().id;
        if (r.col === 'players' && old) r.data = { ...r.data, uid: old.data.uid }; if (r.col === 'players' && !old) delete r.data.uid;
        if (r.col === 'posts' || r.col === 'chat') r.data.u = r.owner;
        if (r.col === 'reports' && !old) { r.data.status = 'open'; r.data.by = r.owner; r.data.at = Date.now(); }
        if (r.col === 'chat') { if (!String(r.data.text || '').trim()) return { data: null, error: { code: 'P0001', message: 'Messages are 1 to 1000 characters' } }; r.data.at = Date.now(); }
        if (r.col === 'listings') r.data.seller = r.owner;
        if (r.col === 'threads' && !old) { const l = d.docs.find(x => x.col === 'listings' && x.id === r.data.listing); if (!l || l.owner === ME().id) return { data: null, error: { code: 'P0001', message: 'That’s your own listing' } }; r.data = { listing: l.id, buyer: ME().id, seller: l.owner, title: l.data.title, at: Date.now() }; }
        if (r.col === 'messages') { r.data = { thread: r.data.thread, text: r.data.text, from: ME().id, at: Date.now() }; const t = d.docs.find(x => x.col === 'threads' && x.id === r.data.thread); Object.assign(t.data, { last: r.data.text, lastAt: r.data.at, lastFrom: ME().id, [t.data.buyer === ME().id ? 'seenBuyer' : 'seenSeller']: r.data.at }); }
        if (r.col === 'invites' && !old) { if (!isCap(d, r.data.teamId)) return { data: null, error: { code: 'P0001', message: 'You can only ask on behalf of a team you captain' } }; r.data.team = d.teams.find(t => t.id === r.data.teamId).name; r.data.status = 'pending'; } }
      if (old) Object.assign(old, r); else rows.push(r); save(d); return { data: this.single ? { data: r.data } : null, error: null };
    }
    const targets = rows.filter(hit);
    if (this.t === 'docs' && targets.some(r => !(canWriteDoc(d, r, r) || (this.op === 'delete' && (r.col === 'posts' || r.col === 'chat') && r.owner === ME().id)))) return denied();
    if (this.t === 'team_members' && targets.some(r => !(isCap(d, r.team_id) || (this.op === 'delete' && r.user_id === ME().id)))) return denied();
    if (this.op === 'update') targets.forEach(r => Object.assign(r, this.patch));
    else d[this.t] = rows.filter(r => !targets.includes(r));
    save(d); return { data: null, error: null };
  }
}
function createClient() {
  const authSubs = [];
  return {
    auth: {
      onAuthStateChange(fn) { authSubs.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { const u = ME(); if (u) { const d = load(); if (!d.profiles.find(p => p.id === u.id)) { d.profiles.push({ id: u.id, display_name: u.name }); save(d); } } return { data: { session: u ? { user: u } : null } }; },
      async signUp({ email, password, options }) { const d = load(); if (d.users.some(u => u.email === email)) return { data: {}, error: { message: 'User already registered' } };
        const u = { id: 'u-' + email.split('@')[0], email, name: options?.data?.name || '', pw: password }; d.users.push(u); acct(d, u.id); save(d); window.__signedUp = u;
        if (window.__confirmEmail) return { data: { user: u, session: null }, error: null };
        return this._in(u); },
      async _in(u) { const me = { id: u.id, email: u.email, name: u.name }; window.__fakeUser = me; sessionStorage.setItem('fakeUser', JSON.stringify(me)); const s = await this.getSession(); authSubs.forEach(f => f('SIGNED_IN', s.data.session)); return { data: { user: me, session: s.data.session }, error: null }; },
      async signInWithPassword({ email, password }) { const u = load().users.find(x => x.email === email); if (!u || u.pw !== password) return { data: {}, error: { message: 'Invalid login credentials' } }; return this._in(u); },
      async resetPasswordForEmail(email) { window.__reset = email; return { data: {}, error: null }; },
      async resend() { return { data: {}, error: null }; },
      async updateUser({ password }) { const d = load(), u = d.users.find(x => x.id === ME().id); if (u && u.pw === password) return { error: { message: 'New password should be different from the old password.' } }; if (u) u.pw = password; save(d); return { data: {}, error: null }; },
      async signInWithOtp(o) { window.__otp = o; return { error: null }; },
      async verifyOtp(o) { if (o.token !== '123456') return { error: { message: 'Token has expired or is invalid' } }; window.__fakeUser = window.__pendingUser; sessionStorage.setItem('fakeUser', JSON.stringify(window.__pendingUser)); const s = await this.getSession(); authSubs.forEach(f => f('SIGNED_IN', s.data.session)); return { error: null }; },
      async signOut(o) { window.__signOutScope = o && o.scope; window.__fakeUser = null; sessionStorage.removeItem('fakeUser'); authSubs.forEach(f => f('SIGNED_OUT', null)); return { error: null }; },
    },
    from: t => new Q(t),
    // server functions: checkout pays instantly; the schedule reader returns a canned schedule
    functions: { async invoke(name, { body }) {
      const d = load(), a = acct(d, ME().id); window.__invoked = (window.__invoked || []).concat(name);
      if (name === 'create-checkout') { if (body.product === 'captain') a.captain_status = 'active'; else a.ad_free = true; save(d); return { data: { url: body.return_url + '?paid=' + body.product }, error: null }; }
      if (name === 'billing-portal') return { data: { url: body.return_url }, error: null };
      if (name === 'import-schedule') { if (!paid(d, ME().id)) return { data: null, error: { context: { json: async () => ({ error: 'Schedule import is a captain feature.' }) } } };
        return { data: { league: 'Tuesday Co-ed C', teams: ['Riverside Rally', 'Pitch Slaps', 'Bunts'], games: [
          { date: '2026-11-24', time: '19:30', opp: 'Pitch Slaps', home: true, diamond: 'Hampton Park D2', park: 'Hampton Park', address: '' },
          { date: '2026-12-01', time: '18:30', opp: 'Bunts', home: false, diamond: 'Etobicoke Park', park: 'Etobicoke Park', address: '' }] }, error: null }; }
      return { data: null, error: { message: 'no such function' } };
    } },
    async rpc(name, a) {
      const d = load();
      if (name === 'is_admin') return { data: isAdm(d), error: null };
      if (name.startsWith('admin_')) {
        if (!isAdm(d)) return { data: null, error: { code: '42501', message: 'Admins only' } };
        const note = (act, target, n) => { d.log.unshift({ at: new Date().toISOString(), admin: ME().id, action: act, target, note: n || '' }); };
        const L = id => d.docs.find(x => x.col === 'listings' && x.id === id);
        const pname = id => (d.profiles.find(p => p.id === id) || {}).display_name;
        if (name === 'admin_overview') { const ls = d.docs.filter(x => x.col === 'listings'), by = {}; ls.forEach(l => by[l.data.status || 'active'] = (by[l.data.status || 'active'] || 0) + 1);
          return { data: { listings: by, newListings7: ls.length, openReports: d.docs.filter(x => x.col === 'reports' && (x.data.status || 'open') === 'open').length, conversations7: 0, messages7: 0, sellers: new Set(ls.map(l => l.owner)).size, bans: d.bans.length, people: d.profiles.length }, error: null }; }
        if (name === 'admin_listing_status') { const l = L(a.p_listing); l.data.status = a.p_status; l.data.removedNote = a.p_status === 'removed' ? a.p_note : null; note(a.p_status === 'removed' ? 'remove listing' : 'restore listing', a.p_listing, a.p_note); save(d); return { data: null, error: null }; }
        if (name === 'admin_delete_listing') { d.docs = d.docs.filter(x => !(x.col === 'listings' && x.id === a.p_listing)); note('delete listing', a.p_listing, a.p_note); save(d); return { data: null, error: null }; }
        if (name === 'admin_resolve_report') { const r = d.docs.find(x => x.col === 'reports' && x.id === a.p_report); r.data.status = a.p_outcome; note('report ' + a.p_outcome, a.p_report, a.p_note); save(d); return { data: null, error: null }; }
        if (name === 'admin_ban') { d.bans = d.bans.filter(b => b.user_id !== a.p_user); d.bans.push({ user_id: a.p_user, reason: a.p_reason, at: new Date().toISOString(), until: a.p_days ? new Date(Date.now() + a.p_days * 864e5).toISOString() : null, by: ME().id });
          if (a.p_hide_listings) d.docs.filter(x => x.col === 'listings' && x.owner === a.p_user && ['active', 'pending'].includes(x.data.status || 'active')).forEach(x => { x.data.status = 'removed'; x.data.removedNote = 'Seller banned'; });
          note('ban', a.p_user, a.p_reason); save(d); return { data: null, error: null }; }
        if (name === 'admin_unban') { d.bans = d.bans.filter(b => b.user_id !== a.p_user); note('unban', a.p_user, ''); save(d); return { data: null, error: null }; }
        if (name === 'admin_bans') return { data: d.bans.map(b => ({ ...b, name: pname(b.user_id), by_name: pname(b.by) })), error: null };
        if (name === 'admin_activity') return { data: d.log.map(l => ({ ...l, admin_name: pname(l.admin) })), error: null };
        if (name === 'admin_user_summary') return { data: { name: pname(a.p_user), joined: new Date().toISOString(), listings: d.docs.filter(x => x.col === 'listings' && x.owner === a.p_user).length, removed: 0, reportsAgainst: 1, banned: null }, error: null };
      }
      if (name === 'create_team' && !paid(d, ME().id)) return { data: null, error: { code: 'P0001', message: 'Starting a team is a captain feature. Upgrade to captain first.' } };
      if (name === 'i_am_here') { d.seen[ME().id] = Date.now(); save(d); return { data: null, error: null }; }
      if (name === 'online_subs') return { data: paid(d, ME().id) ? d.docs.filter(x => x.col === 'agents' && !x.data.hideOnline && Date.now() - (d.seen[x.id] || 0) < 180000).map(x => x.id) : [], error: null };
      if (name === 'reset_cal_token') { const t = 'd'.repeat(64); acct(d, ME().id).cal_token = t; save(d); return { data: t, error: null }; }
      if (name === 'create_team') { const id = 't' + rid(); d.teams.push({ id, name: a.team_name, join_code: rid(), created_by: ME().id }); d.team_members.push({ team_id: id, user_id: ME().id, role: 'captain' }); d.docs.push({ scope: id, col: 'team', id: 'info', owner: ME().id, data: { name: a.team_name, league: '', season: '', fee: 0, innings: 7 } }); save(d); return { data: id, error: null }; }
      if (name === 'join_team') { const t = d.teams.find(t => t.join_code === a.code.trim().toUpperCase()); if (!t) return { data: null, error: { message: 'No team has that code' } }; if (!isMember(d, t.id)) d.team_members.push({ team_id: t.id, user_id: ME().id, role: 'player' }); save(d); return { data: t.id, error: null }; }
      if (name === 'claim_player' || name === 'unclaim_player') { const p = d.docs.find(x => x.scope === a.p_team && x.col === 'players' && x.id === a.p_player); if (!p) return { error: { code: 'P0001', message: 'No such player' } }; if (name === 'claim_player') { if (p.data.uid && p.data.uid !== ME().id) return { error: { code: 'P0001', message: 'Someone else already picked that name. Ask your captain.' } }; d.docs.filter(x => x.scope === a.p_team && x.col === 'players' && x.data.uid === ME().id).forEach(x => delete x.data.uid); p.data.uid = ME().id; } else delete p.data.uid; save(d); return { data: null, error: null }; }
      if (name === 'reset_join_code') { const t = d.teams.find(t => t.id === a.p_team); t.join_code = rid() + 'XY'; save(d); return { data: t.join_code, error: null }; }
      if (name === 'delete_my_account') { const me = ME().id; d.docs = d.docs.filter(x => !(x.owner === me && (x.scope === 'global' || x.col === 'posts')) && !(x.id === me)); d.team_members = d.team_members.filter(m => m.user_id !== me); d.profiles = d.profiles.filter(p => p.id !== me); save(d); window.__fakeUser = null; sessionStorage.removeItem('fakeUser'); return { data: null, error: null }; }
      if (name === 'mark_thread_seen') { const t = d.docs.find(x => x.col === 'threads' && x.id === a.p_thread); t.data[t.data.buyer === ME().id ? 'seenBuyer' : 'seenSeller'] = Date.now(); save(d); return { data: null, error: null }; }
      if (name === 'doc_update') { const r = d.docs.find(x => x.scope === a.p_scope && x.col === a.p_col && x.id === a.p_id); if (!r || !canWriteDoc(d, r, r)) return { data: null, error: { message: 'Not found or not allowed' } }; Object.assign(r.data, a.patch); save(d); return { data: null, error: null }; }
    },
    storage: { from: () => ({
      async upload(path, blob) { if (!path.startsWith(ME().id + '/')) return { error: { message: 'new row violates row-level security policy' } }; const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }); const m = JSON.parse(localStorage.getItem('fake-photos') || '{}'); m[path] = url; localStorage.setItem('fake-photos', JSON.stringify(m)); return { error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: JSON.parse(localStorage.getItem('fake-photos') || '{}')[path] || 'data:,' } }; },
      async remove(paths) { const m = JSON.parse(localStorage.getItem('fake-photos') || '{}'); paths.forEach(p => delete m[p]); localStorage.setItem('fake-photos', JSON.stringify(m)); return { error: null }; },
      async list() { return { data: [], error: null }; },
    }) },
    channel() {
      let fn; let snap = JSON.stringify(load().docs);
      const ch = { on(_, __, f) { fn = f; return ch; }, subscribe(cb) { cb && setTimeout(() => cb('SUBSCRIBED'), 0); return ch; } };
      const tick = () => { // diff the docs table and send change events
        const d = load(); const before = JSON.parse(snap); snap = JSON.stringify(d.docs);
        const key = r => r.scope + '|' + r.col + '|' + r.id; const bm = new Map(before.map(r => [key(r), r]));
        for (const r of d.docs) { const o = bm.get(key(r)); bm.delete(key(r)); if (!o || JSON.stringify(o) !== JSON.stringify(r)) if (canRead(d, 'docs', r)) fn({ eventType: o ? 'UPDATE' : 'INSERT', new: r, old: {} }); }
        for (const o of bm.values()) fn({ eventType: 'DELETE', new: {}, old: { scope: o.scope, col: o.col, id: o.id } });
      };
      listeners.add(tick); ch._tick = tick; return ch;
    },
    removeChannel(ch) { listeners.delete(ch._tick); },
  };
}

window.supabase = { createClient };
