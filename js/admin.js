/* Gear admin: moderation for the marketplace. Reports, listings, bans and an activity log.
   Every action goes through an admin_* database function that checks you're an admin and records what you did,
   so this page can't do anything the database wouldn't allow. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { icon } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = document.getElementById('aview'), tabs = document.getElementById('atabs'), dlg = document.getElementById('adlg');
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };
const when = d => { const x = new Date(typeof d === 'number' ? d : d); return isNaN(x) ? '' : x.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const REASON = { scam: 'Scam or fraud', prohibited: 'Not allowed to sell', offensive: 'Offensive', wrong: 'Wrong category or details', other: 'Something else' };
const STATUS = { active: ['Live', 'in'], pending: ['Sale pending', 'maybe'], sold: ['Sold', ''], removed: ['Removed', 'out'] };
const price = p => (+p ? '$' + (+p).toLocaleString() : 'Free');

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
const names = {};
let tab = (location.hash || '#reports').slice(1), showAllReports = false, listQ = '', listStatus = 'all';

async function call(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw Object.assign(new Error(error.message), { userMessage: error.code === 'P0001' ? error.message : error.code === '42501' ? 'Admins only.' : 'That didn’t work. Try again.' });
  return data;
}
async function loadNames(ids) {
  const want = [...new Set(ids.filter(Boolean))].filter(id => !(id in names));
  if (!want.length) return;
  const { data } = await sb.from('profiles').select('id, display_name').in('id', want);
  (data || []).forEach(p => names[p.id] = p.display_name || 'No name');
  want.forEach(id => { if (!(id in names)) names[id] = 'Deleted account'; });
}
const photoUrl = path => sb.storage.from('listing-photos').getPublicUrl(path).data.publicUrl;
async function act(fn, ok) { try { await fn(); toast(ok); await render(); } catch (e) { toast(e.userMessage || 'That didn’t work. Try again.'); } }

/* ---------- start ---------- */
const { data: { session } } = await sb.auth.getSession();
if (!session) view.innerHTML = `<div class="panel"><h2>Log in first</h2><p>Open <a href="./">Dugout</a>, log in, then come back to this page.</p></div>`;
else {
  let admin = false; try { admin = await call('is_admin'); } catch (_) {}
  if (!admin) view.innerHTML = `<div class="panel"><h2>Admins only</h2><p>This page is for the people who run Dugout. You’re signed in as ${esc(session.user.email)}.</p><p><a href="./">Back to Dugout</a></p></div>`;
  else {
    tabs.hidden = false;
    tabs.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { location.hash = '#' + b.dataset.at; });
    window.addEventListener('hashchange', () => { tab = (location.hash || '#reports').slice(1); render(); });
    // live: new reports and listing changes show up without reloading
    sb.channel('admin-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      const row = p.new && p.new.col ? p.new : p.old; if (row && ['reports', 'listings'].includes(row.col) && !dlg.open) { clearTimeout(render.t); render.t = setTimeout(render, 400); }
    }).subscribe();
    render();
  }
}

async function render() {
  tabs.querySelectorAll('[data-at]').forEach(b => { const on = b.dataset.at === tab; b.setAttribute('aria-selected', on); b.setAttribute('aria-pressed', on); });
  try {
    const ov = await call('admin_overview');
    const badge = document.getElementById('repBadge'); badge.hidden = !ov.openReports; badge.textContent = ov.openReports;
    if (tab === 'overview') return overview(ov);
    if (tab === 'listings') return listings();
    if (tab === 'bans') return bans();
    if (tab === 'activity') return activity();
    return reports();
  } catch (e) { view.innerHTML = `<div class="panel"><p>${esc(e.userMessage || 'Couldn’t load. Check your connection and reload.')}</p></div>`; }
}

/* ---------- overview ---------- */
function overview(ov) {
  const L = ov.listings || {}, live = (L.active || 0) + (L.pending || 0);
  const tile = (n, label, href) => `<a class="tile admin-tile" href="${href || '#'}"><b>${esc(n)}</b><span class="muted small">${esc(label)}</span></a>`;
  view.innerHTML = `<h2>Overview</h2>
  <div class="admin-tiles">
    ${tile(ov.openReports, 'Open reports', '#reports')}${tile(live, 'Live listings', '#listings')}${tile(L.sold || 0, 'Sold')}${tile(L.removed || 0, 'Removed by admins', '#listings')}
    ${tile(ov.newListings7, 'New listings this week')}${tile(ov.conversations7, 'New conversations this week')}${tile(ov.messages7, 'Messages this week')}
    ${tile(ov.sellers, 'Sellers')}${tile(ov.bans, 'Banned from Gear', '#bans')}${tile(ov.people, 'Accounts')}
  </div>
  <div class="panel" style="margin-top:16px"><h3>How moderation works</h3>
    <ul class="admin-help">
      <li><b>Remove</b> hides a listing from everyone except the seller, who sees it marked “Removed by Dugout” and can’t relist it. You can restore it.</li>
      <li><b>Delete</b> erases the listing, its photos and its conversations for good.</li>
      <li><b>Ban from Gear</b> stops someone listing or messaging (for a number of days, or until you lift it) and hides what they have for sale. They can still use their teams.</li>
      <li>Every action is recorded under <a href="#activity">Activity</a>. You can’t read private buyer–seller messages from here.</li>
    </ul></div>`;
}

/* ---------- reports ---------- */
async function reports() {
  const { data: reps } = await sb.from('docs').select('id, data, created_at').eq('scope', 'global').eq('col', 'reports').order('created_at', { ascending: false }).limit(300);
  const all = reps || [], open = all.filter(r => (r.data.status || 'open') === 'open'), shown = showAllReports ? all : open;
  const ids = [...new Set(shown.map(r => r.data.listing))];
  const { data: ls } = ids.length ? await sb.from('docs').select('id, data, owner').eq('scope', 'global').eq('col', 'listings').in('id', ids) : { data: [] };
  const byId = Object.fromEntries((ls || []).map(l => [l.id, l]));
  await loadNames([...shown.map(r => r.data.by), ...(ls || []).map(l => l.owner)]);
  view.innerHTML = `<h2>Reports</h2>
  <div class="row" style="margin-bottom:12px"><span class="grow muted small">${open.length} open · ${all.length} in total</span>
    <button class="btn ghost small" type="button" id="toggleAll">${showAllReports ? 'Show open only' : 'Show all, including closed'}</button></div>
  <div class="stack">${shown.length ? shown.map(r => reportCard(r, byId[r.data.listing])).join('') : `<div class="panel empty">${showAllReports ? 'No reports yet.' : 'Nothing to review. Nice.'}</div>`}</div>`;
  document.getElementById('toggleAll').onclick = () => { showAllReports = !showAllReports; reports(); };
  bindListingActions();
  view.querySelectorAll('[data-close]').forEach(b => b.onclick = () => act(() => call('admin_resolve_report', { p_report: b.dataset.close, p_outcome: b.dataset.outcome, p_note: '' }), b.dataset.outcome === 'dismissed' ? 'Report dismissed' : b.dataset.outcome === 'open' ? 'Report reopened' : 'Report closed'));
  view.querySelectorAll('[data-who-summary]').forEach(b => b.onclick = () => sellerSummary(b));
}
function reportCard(r, l) {
  const d = r.data, st = d.status || 'open';
  return `<article class="panel admin-card${st === 'open' ? ' open' : ''}">
    <div class="row"><div class="grow"><span class="pill ${d.reason === 'scam' || d.reason === 'offensive' ? 'out' : 'maybe'}">${esc(REASON[d.reason] || d.reason)}</span>
      <span class="muted small"> reported by ${esc(names[d.by] || 'someone')} · ${esc(when(d.at || r.created_at))}</span></div>
      <span class="pill ${st === 'open' ? 'maybe' : ''}">${st === 'open' ? 'Open' : st === 'dismissed' ? 'Dismissed' : 'Dealt with'}</span></div>
    ${d.note ? `<blockquote class="admin-quote">${esc(d.note)}</blockquote>` : ''}
    ${l ? listingBlock(l) : `<p class="muted small">The listing is gone (the seller or an admin deleted it).</p>`}
    ${d.closedNote ? `<p class="muted small">Note: ${esc(d.closedNote)}</p>` : ''}
    <div class="row">${st === 'open'
      ? `<button class="btn small" type="button" data-close="${esc(r.id)}" data-outcome="actioned">Mark dealt with</button><button class="btn ghost small" type="button" data-close="${esc(r.id)}" data-outcome="dismissed">Dismiss</button>`
      : `<button class="btn ghost small" type="button" data-close="${esc(r.id)}" data-outcome="open">Reopen</button>`}</div>
  </article>`;
}
// a listing with its moderation buttons (used on reports and in the listings list)
function listingBlock(l) {
  const d = l.data, st = d.status || 'active', [label, cls] = STATUS[st] || [st, ''];
  const ph = (d.photos || [])[0];
  return `<div class="admin-listing" data-lid="${esc(l.id)}" data-owner="${esc(l.owner || '')}">
    <div class="admin-thumb">${ph ? `<img src="${esc(photoUrl(ph))}" alt="" loading="lazy">` : icon('tag')}</div>
    <div class="grow"><b>${esc(d.title)}</b> <span class="muted">${esc(price(d.price))}</span> <span class="pill ${cls}">${esc(label)}</span>
      <div class="muted small">Seller: ${esc(names[l.owner] || d.name || 'unknown')} · ${esc(d.area || 'no area')} · ${(d.photos || []).length} photo${(d.photos || []).length === 1 ? '' : 's'}</div>
      ${d.desc ? `<details><summary class="small">Description</summary><p class="small" style="white-space:pre-wrap;margin:6px 0 0">${esc(d.desc)}</p></details>` : ''}
      ${d.removedNote ? `<div class="muted small">Removed: ${esc(d.removedNote)}</div>` : ''}
      <div class="row admin-actions">
        ${st === 'removed' ? `<button class="btn ghost small" type="button" data-restore>Restore</button>` : `<button class="btn small" type="button" data-remove>Remove</button>`}
        <button class="btn danger small" type="button" data-delete>Delete for good</button>
        ${l.owner ? `<button class="btn ghost small" type="button" data-ban>Ban seller from Gear</button><button class="linkish small" type="button" data-who-summary="${esc(l.owner)}">Seller history</button>` : ''}
      </div><div class="seller-summary small muted"></div></div></div>`;
}
function bindListingActions() {
  view.querySelectorAll('.admin-listing').forEach(box => {
    const id = box.dataset.lid, owner = box.dataset.owner, on = (sel, fn) => { const b = box.querySelector(sel); if (b) b.onclick = fn; };
    on('[data-remove]', () => ask({ title: 'Remove this listing?', body: 'It disappears from Gear. The seller sees it marked removed and can’t relist it. You can restore it later.', note: 'Reason (the seller sees this)', go: 'Remove', run: n => call('admin_listing_status', { p_listing: id, p_status: 'removed', p_note: n }), ok: 'Listing removed' }));
    on('[data-restore]', () => act(() => call('admin_listing_status', { p_listing: id, p_status: 'active', p_note: '' }), 'Listing restored'));
    on('[data-delete]', () => ask({ title: 'Delete this listing for good?', body: 'The listing, its photos and every conversation about it are erased. This can’t be undone.', note: 'Reason (for the activity log)', go: 'Delete for good', danger: true,
      run: async n => {
        const { data: l } = await sb.from('docs').select('data').eq('scope', 'global').eq('col', 'listings').eq('id', id).maybeSingle();
        const paths = (l && l.data.photos) || []; if (paths.length) await sb.storage.from('listing-photos').remove(paths);
        await call('admin_delete_listing', { p_listing: id, p_note: n });
      }, ok: 'Listing deleted' }));
    on('[data-ban]', () => ask({ title: `Ban ${names[owner] || 'this seller'} from Gear?`, body: 'They won’t be able to list or message anyone in Gear. Their teams aren’t affected.', note: 'Reason (for the activity log)', go: 'Ban', danger: true, days: true, hide: true,
      run: (n, days, hide) => call('admin_ban', { p_user: owner, p_reason: n, p_days: days, p_hide_listings: hide }), ok: 'Seller banned from Gear' }));
  });
}
async function sellerSummary(b) {
  const out = b.closest('.admin-listing').querySelector('.seller-summary');
  try {
    const s = await call('admin_user_summary', { p_user: b.dataset.whoSummary });
    out.innerHTML = `${esc(s.name || 'No name')} · joined ${esc(s.joined ? new Date(s.joined).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '?')} · ${s.listings} listing${s.listings === 1 ? '' : 's'} (${s.removed} removed) · ${s.reportsAgainst} report${s.reportsAgainst === 1 ? '' : 's'} against them${s.banned ? ` · <b style="color:var(--out)">banned${s.banned.until ? ' until ' + esc(new Date(s.banned.until).toLocaleDateString()) : ''}</b>` : ''}`;
  } catch (e) { out.textContent = e.userMessage || 'Couldn’t load.'; }
}

/* ---------- listings ---------- */
async function listings() {
  const { data } = await sb.from('docs').select('id, data, owner, created_at').eq('scope', 'global').eq('col', 'listings').order('created_at', { ascending: false }).limit(500);
  const all = data || [];
  await loadNames(all.map(l => l.owner));
  const q = listQ.trim().toLowerCase();
  const list = all.filter(l => (listStatus === 'all' || (l.data.status || 'active') === listStatus) && (!q || [l.data.title, l.data.brand, l.data.desc, names[l.owner], l.data.area].join(' ').toLowerCase().includes(q)));
  const count = st => all.filter(l => (l.data.status || 'active') === st).length;
  view.innerHTML = `<h2>Listings</h2>
  <div class="row" style="margin-bottom:12px">
    <label class="grow" for="lq"><span class="sr-only">Search listings</span><input id="lq" type="search" placeholder="Search title, seller, area" value="${esc(listQ)}"></label>
    <label for="ls"><span class="sr-only">Status</span><select id="ls">${[['all', `All (${all.length})`], ['active', `Live (${count('active')})`], ['pending', `Pending (${count('pending')})`], ['sold', `Sold (${count('sold')})`], ['removed', `Removed (${count('removed')})`]].map(([v, t]) => `<option value="${v}"${listStatus === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
  </div>
  <div class="stack">${list.length ? list.map(l => `<article class="panel admin-card">${listingBlock(l)}<div class="muted small">Listed ${esc(when(l.created_at))}</div></article>`).join('') : '<div class="panel empty">No listings match.</div>'}</div>`;
  const inp = document.getElementById('lq');
  inp.oninput = () => { listQ = inp.value; clearTimeout(inp.t); inp.t = setTimeout(async () => { const pos = inp.selectionStart; await listings(); const n = document.getElementById('lq'); n.focus(); n.setSelectionRange(pos, pos); }, 300); };
  document.getElementById('ls').onchange = e => { listStatus = e.target.value; listings(); };
  bindListingActions();
  view.querySelectorAll('[data-who-summary]').forEach(b => b.onclick = () => sellerSummary(b));
}

/* ---------- bans ---------- */
async function bans() {
  const list = await call('admin_bans');
  view.innerHTML = `<h2>Banned from Gear</h2>
  <p class="muted small" style="margin-top:-6px">Ban someone from a listing (Reports or Listings). Banned people can’t list or message in Gear; their teams aren’t affected.</p>
  <div class="stack">${(list || []).length ? list.map(b => { const over = b.until && new Date(b.until) < new Date();
    return `<article class="panel admin-card"><div class="row"><div class="grow"><b>${esc(b.name || 'Deleted account')}</b>
      <div class="muted small">${esc(b.reason || 'No reason given')} · by ${esc(b.by_name || 'an admin')} on ${esc(when(b.at))} · ${b.until ? (over ? 'ended ' : 'until ') + esc(new Date(b.until).toLocaleDateString()) : 'until lifted'}</div></div>
      <button class="btn ghost small" type="button" data-unban="${esc(b.user_id)}">${over ? 'Clear' : 'Lift ban'}</button></div></article>`; }).join('') : '<div class="panel empty">Nobody is banned.</div>'}</div>`;
  view.querySelectorAll('[data-unban]').forEach(b => b.onclick = () => act(() => call('admin_unban', { p_user: b.dataset.unban }), 'Ban lifted'));
}

/* ---------- activity ---------- */
async function activity() {
  const rows = await call('admin_activity');
  view.innerHTML = `<h2>Activity</h2><p class="muted small" style="margin-top:-6px">Every admin action, newest first (last 200).</p>
  <div class="lineup-scroll"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
  <tbody>${(rows || []).map(r => `<tr><td>${esc(when(r.at))}</td><td>${esc(r.admin_name || '?')}</td><td><b>${esc(r.action)}</b></td><td class="mono small">${esc(r.target)}</td><td style="white-space:normal">${esc(r.note)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</tbody></table></div>`;
}

/* ---------- confirm dialog with a reason (and ban length) ---------- */
function ask({ title, body, note, go, danger, days, hide, run, ok }) {
  dlg.innerHTML = `<form method="dialog" id="askF"><div class="mhead"><h2 id="adlgT">${esc(title)}</h2></div>
    <section><p style="margin:0 0 10px">${esc(body)}</p>
      <label for="askN">${esc(note)}<input id="askN" type="text" maxlength="300" autocomplete="off"></label>
      ${days ? `<label for="askD" style="margin-top:10px">How long<select id="askD"><option value="7">7 days</option><option value="30">30 days</option><option value="">Until I lift it</option></select></label>` : ''}
      ${hide ? `<label class="opt opt-wide" style="margin-top:10px"><input type="checkbox" id="askH" checked> <span>Also hide everything they have for sale</span></label>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn${danger ? ' danger' : ''}" type="submit" value="go">${esc(go)}</button><button class="btn ghost" type="button" id="askX">Cancel</button></div>
    </section></form>`;
  dlg.showModal(); dlg.querySelector('#askN').focus();
  dlg.querySelector('#askX').onclick = () => dlg.close();
  dlg.querySelector('#askF').onsubmit = e => {
    e.preventDefault();
    const n = dlg.querySelector('#askN').value.trim(), d = days ? dlg.querySelector('#askD').value : null, h = hide ? dlg.querySelector('#askH').checked : false;
    dlg.close();
    act(() => run(n, d === null || d === '' ? null : +d, h), ok);
  };
}
