/* Gear: a used-equipment marketplace for the league. Listings with photos, filters, and private buyer–seller messages.
   Money changes hands in person; Dugout never handles payments. */

import { icon } from './icons.js';

export const CATS = [['bat', 'Bats'], ['glove', 'Gloves'], ['cleats', 'Cleats'], ['helmet', 'Helmets & face masks'], ['bag', 'Bags'], ['balls', 'Balls'],
  ['catcher', 'Catcher’s gear'], ['apparel', 'Apparel'], ['training', 'Training gear'], ['other', 'Other']];
export const CONDS = [['new', 'New'], ['likenew', 'Like new'], ['good', 'Good'], ['fair', 'Fair'], ['worn', 'Well used']];
export const CERTS = [['', 'Not sure'], ['usa', 'USA Softball'], ['usssa', 'USSSA'], ['isf', 'ISF / WBSC'], ['nsa', 'NSA'], ['multi', 'Multiple stamps'], ['none', 'No stamp']];
const REASONS = [['scam', 'Looks like a scam'], ['prohibited', 'Not allowed to be sold'], ['offensive', 'Offensive'], ['wrong', 'Wrong category or details'], ['other', 'Something else']];
const label = (list, k) => (list.find(x => x[0] === k) || [, ''])[1];

let mode = 'browse', openId = null, editId = null;      // which Gear screen is showing
let G = null;                                            // filters, remembered on this device
const MAX_PHOTOS = 4;

/* unread conversations, for the badge on the Gear tab */
export function unreadCount(st, me) {
  return st.threads.filter(t => t.lastAt && t.lastFrom !== me && (t.buyer === me ? (t.seenBuyer || 0) : (t.seenSeller || 0)) < t.lastAt).length;
}

export function renderGear(c) {
  const { st, view, esc, LS } = c, me = c.myId();
  if (!G) G = Object.assign({ q: '', cat: '', max: '', km: 0, sort: 'new', from: null, showSold: false }, LS.get('gearF', {}));
  const unread = unreadCount(st, me);
  const tabs = [['browse', 'Browse'], ['sell', editId ? 'Edit listing' : 'Sell'], ['inbox', `Inbox${unread ? ` (${unread})` : ''}`], ['mine', 'My listings']];
  view.innerHTML = `<h2>Gear</h2>
  <div class="seg" role="tablist" aria-label="Gear" style="margin-bottom:14px;overflow-x:auto;max-width:100%">${tabs.map(([k, l]) => `<button type="button" role="tab" data-gm="${k}" aria-selected="${mode === k || (k === 'browse' && mode === 'item') || (k === 'inbox' && mode === 'thread')}" aria-pressed="${mode === k || (k === 'browse' && mode === 'item') || (k === 'inbox' && mode === 'thread')}" data-v="in">${esc(l)}</button>`).join('')}</div>
  <div id="gearBody"></div>`;
  view.querySelectorAll('[data-gm]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.gm; openId = null; if (mode !== 'sell') editId = null; renderGear(c); }));
  ({ browse, item, sell, inbox, thread, mine }[mode] || browse)(c);
}
const go = (c, m, id = null) => { mode = m; openId = id; window.scrollTo(0, 0); renderGear(c); };

/* ---------- browse ---------- */
function browse(c) {
  const { st, esc, LS } = c, box = document.getElementById('gearBody');
  const from = G.from;
  let list = st.listings.map(l => ({ l, d: from && l.lat != null ? c.km(from, l) : null })).filter(({ l, d }) =>
    l.status !== 'removed' && (G.showSold || l.status !== 'sold') &&
    (!G.cat || l.cat === G.cat) &&
    (!G.max || (+l.price || 0) <= +G.max) &&
    (!G.km || !from || (d != null && d <= G.km)) &&
    (!G.q || [l.title, l.brand, l.desc, l.size].join(' ').toLowerCase().includes(G.q.toLowerCase())));
  list.sort((x, y) => G.sort === 'low' ? (+x.l.price || 0) - (+y.l.price || 0) : G.sort === 'near' ? (x.d ?? 1e9) - (y.d ?? 1e9) : (y.l.created || 0) - (x.l.created || 0));
  box.innerHTML = `<div class="panel" style="margin-bottom:14px">
    <div class="form-grid">
      <label for="gq">Search<input id="gq" type="search" value="${esc(G.q)}" placeholder="e.g. Miken, 34 inch, glove"></label>
      <label for="gcat">Category<select id="gcat"><option value="">Everything</option>${CATS.map(([k, l]) => `<option value="${esc(k)}"${G.cat === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label for="gmax">Max price ($)<input id="gmax" type="number" min="0" inputmode="numeric" value="${esc(G.max)}" placeholder="Any"></label>
      <label for="gsort">Sort<select id="gsort"><option value="new"${G.sort === 'new' ? ' selected' : ''}>Newest</option><option value="low"${G.sort === 'low' ? ' selected' : ''}>Lowest price</option><option value="near"${G.sort === 'near' ? ' selected' : ''}>Closest</option></select></label>
    </div>
    <form class="row" id="gfrom" style="margin-top:10px"><label for="gloc" class="grow" style="margin:0">Near<input id="gloc" type="text" maxlength="80" value="${esc(from ? from.label : '')}" placeholder="Postal code or neighbourhood"></label>
      <label for="gkm" style="margin:0">Within<select id="gkm">${[[0, 'Any distance'], [5, '5 km'], [10, '10 km'], [25, '25 km'], [50, '50 km']].map(([v, l]) => `<option value="${v}"${+G.km === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn ghost" type="submit" style="align-self:flex-end">Set</button></form>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="gsold"${G.showSold ? ' checked' : ''}> Show sold items</label>
  </div>
  <p class="muted small" aria-live="polite">${list.length} ${list.length === 1 ? 'item' : 'items'}${from && G.km ? ` within ${G.km} km of ${esc(from.label)}` : ''}</p>
  <div class="gear-grid">${list.map(({ l, d }) => card(c, l, d)).join('') || `<div class="panel empty" style="grid-column:1/-1">${st.listings.length ? 'Nothing matches. Try clearing a filter.' : 'No gear listed yet. Be the first: tap <b>Sell</b>.'}</div>`}</div>`;
  const save = () => { LS.set('gearF', G); };
  const upd = (k, v) => { G[k] = v; save(); browse(c); };
  box.querySelector('#gq').addEventListener('input', e => { G.q = e.target.value; save(); clearTimeout(browse.t); browse.t = setTimeout(() => { browse(c); const q = document.getElementById('gq'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); });
  box.querySelector('#gcat').onchange = e => upd('cat', e.target.value);
  box.querySelector('#gmax').onchange = e => upd('max', e.target.value);
  box.querySelector('#gsort').onchange = e => upd('sort', e.target.value);
  box.querySelector('#gkm').onchange = e => upd('km', +e.target.value);
  box.querySelector('#gsold').onchange = e => upd('showSold', e.target.checked);
  box.querySelector('#gfrom').addEventListener('submit', async e => {
    e.preventDefault(); const t = box.querySelector('#gloc').value.trim();
    if (!t) return upd('from', null);
    try { const loc = await c.locate(t); G.from = loc; if (!G.km) G.km = 25; save(); browse(c); } catch (_) { c.toast('Couldn’t find that place. Try a postal code.'); }
  });
  box.querySelectorAll('[data-item]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(c, 'item', a.dataset.item); }));
}

function card(c, l, d) {
  const { esc, platform } = c, ph = (l.photos || [])[0];
  return `<a class="panel gear-card" href="#gear" data-item="${esc(l.id)}">
    <div class="gear-ph">${ph ? `<img src="${esc(platform.photos.url(ph))}" alt="" loading="lazy">` : `<span aria-hidden="true">${catIcon(l.cat)}</span>`}${l.status !== 'active' ? `<span class="gear-flag">${l.status === 'sold' ? 'Sold' : l.status === 'removed' ? 'Removed' : 'Pending'}</span>` : ''}</div>
    <div class="gear-price">${esc(price(l.price))}</div>
    <div class="gear-title">${esc(l.title)}</div>
    <div class="muted small">${esc(label(CONDS, l.cond))}${d != null ? ` · ${d < 1 ? '<1' : Math.round(d)} km` : l.area ? ` · ${esc(l.area)}` : ''}</div>
  </a>`;
}
const price = p => (+p ? '$' + (+p).toLocaleString() : 'Free');
const catIcon = k => icon({ bat: 'bat', glove: 'glove', cleats: 'cleats', helmet: 'helmet', bag: 'bag', balls: 'ball', catcher: 'catcher', apparel: 'apparel', training: 'training' }[k] || 'tag');

/* ---------- one listing ---------- */
function item(c) {
  const { st, esc, platform } = c, me = c.myId(), box = document.getElementById('gearBody');
  const l = st.listings.find(x => x.id === openId);
  if (!l) { box.innerHTML = `<div class="panel empty">This listing is gone. <button class="btn ghost small" type="button" id="gback">Back to gear</button></div>`; box.querySelector('#gback').onclick = () => go(c, 'browse'); return; }
  const mine = l.seller === me, photos = l.photos || [];
  const th = st.threads.find(t => t.listing === l.id && t.buyer === me);
  box.innerHTML = `<button class="btn ghost small" type="button" id="gback" style="margin-bottom:10px">← All gear</button>
  <article class="panel">
    ${photos.length ? `<div class="gear-gallery"><img id="gbig" src="${esc(platform.photos.url(photos[0]))}" alt="${esc(l.title)}">${photos.length > 1 ? `<div class="row">${photos.map((p, i) => `<button type="button" class="gear-thumb" data-ph="${i}" aria-label="Photo ${i + 1}"><img src="${esc(platform.photos.url(p))}" alt=""></button>`).join('')}</div>` : ''}</div>` : ''}
    <div class="row" style="align-items:baseline"><h3 class="grow" style="margin:0;font-size:1.4em">${esc(l.title)}</h3><span class="gear-price" style="font-size:1.6em">${esc(price(l.price))}</span></div>
    <div class="row" style="margin:6px 0 10px">${l.status !== 'active' ? `<span class="pill ${l.status === 'sold' || l.status === 'removed' ? 'out' : 'maybe'}">${l.status === 'sold' ? 'Sold' : l.status === 'removed' ? 'Removed by Dugout' : 'Sale pending'}</span>` : ''}${l.status === 'removed' ? `<p class="small" style="flex-basis:100%;margin:6px 0 0">Dugout took this listing down${l.removedNote ? `: ${esc(l.removedNote)}` : ''}. Only you can see it. You can delete it, or contact Dugout if you think it’s a mistake.</p>` : ''}<span class="pill in">${esc(label(CONDS, l.cond))}</span><span class="pill" style="border:1.5px solid var(--line)">${esc(label(CATS, l.cat))}</span></div>
    <dl class="gear-facts">
      ${l.brand ? `<dt>Brand</dt><dd>${esc(l.brand)}</dd>` : ''}
      ${l.size ? `<dt>Size</dt><dd>${esc(l.size)}</dd>` : ''}
      ${l.cat === 'bat' ? `<dt>Certification</dt><dd>${esc(label(CERTS, l.cert || '') || 'Not sure')}</dd>` : ''}
      ${l.area ? `<dt>Pickup near</dt><dd>${esc(l.area)}</dd>` : ''}
      <dt>Seller</dt><dd>${esc(l.name || 'A Dugout player')}${mine ? ' (you)' : ''}</dd>
      <dt>Listed</dt><dd>${esc(new Date(l.created || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</dd>
    </dl>
    ${l.desc ? `<p style="white-space:pre-wrap">${esc(l.desc)}</p>` : ''}
    ${l.cat === 'bat' ? `<p class="notice small">Check the certification stamp against your league’s approved bat list before you buy. Many leagues ban altered or uncertified bats.</p>` : ''}
    <div class="row" style="margin-top:10px">
      ${mine && l.status === 'removed' ? `<button class="btn danger" type="button" id="gdel">Delete</button>` : mine ? `<button class="btn" type="button" id="gedit">Edit</button>
        <button class="btn ghost" type="button" data-st="${l.status === 'sold' ? 'active' : 'sold'}">${l.status === 'sold' ? 'Relist' : 'Mark sold'}</button>
        ${l.status === 'active' ? '<button class="btn ghost" type="button" data-st="pending">Mark pending</button>' : l.status === 'pending' ? '<button class="btn ghost" type="button" data-st="active">Back to available</button>' : ''}
        <button class="btn danger" type="button" id="gdel">Delete</button>`
      : l.status === 'sold' || l.status === 'removed' ? '' : `<button class="btn" type="button" id="gmsg">${th ? 'Open conversation' : 'Message seller'}</button>`}
    </div>
  </article>
  <div class="panel small" style="margin-top:12px"><b>Buying safely:</b> meet somewhere public and busy, look the item over before paying, and never send money or a deposit to someone you haven’t met. Dugout doesn’t handle payments.</div>
  ${mine ? '' : `<details style="margin-top:12px"><summary class="small">Report this listing</summary>
    <form class="stack" id="grep" style="margin-top:8px"><label for="grr">Reason<select id="grr">${REASONS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    <label for="grn">Details <span class="muted small">(optional)</span><input id="grn" type="text" maxlength="300"></label>
    <div class="row"><button class="btn ghost small" type="submit">Send report</button></div></form></details>`}`;
  box.querySelector('#gback').onclick = () => go(c, 'browse');
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { box.querySelector('#gbig').src = platform.photos.url(photos[+b.dataset.ph]); });
  const msg = box.querySelector('#gmsg');
  if (msg) msg.onclick = async () => {
    const id = `${l.id}_${me}`;
    if (!th) { const ok = await c.write(() => c.db.doc('threads/' + id).set({ listing: l.id })); if (!ok) return; }
    go(c, 'thread', id);
  };
  const ed = box.querySelector('#gedit'); if (ed) ed.onclick = () => { editId = l.id; go(c, 'sell'); };
  box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => c.write(() => c.db.doc('listings/' + l.id).update({ status: b.dataset.st, updated: Date.now() }), b.dataset.st === 'sold' ? 'Marked sold' : 'Updated'));
  const del = box.querySelector('#gdel');
  if (del) del.onclick = () => c.confirmInline(del, 'Delete this listing?', async () => {
    if (await c.write(() => c.db.doc('listings/' + l.id).delete(), 'Listing deleted')) { platform.photos.remove(photos).catch(() => {}); go(c, 'mine'); }
  });
  const rep = box.querySelector('#grep');
  if (rep) rep.addEventListener('submit', async e => {
    e.preventDefault();
    if (await c.write(() => c.db.doc('reports/' + c.uid()).set({ listing: l.id, reason: box.querySelector('#grr').value, note: box.querySelector('#grn').value.trim() }), 'Thanks. We’ll take a look.')) rep.closest('details').open = false;
  });
}

/* ---------- sell / edit ---------- */
function sell(c) {
  const { st, esc, platform } = c, me = c.myId(), box = document.getElementById('gearBody');
  const l = editId ? st.listings.find(x => x.id === editId && x.seller === me) : null;
  const id = l ? l.id : (sell.draftId ||= c.uid());
  let kept = l ? [...(l.photos || [])] : [], added = [];   // added: { blob, url }
  const draw = () => {
    box.innerHTML = `<form class="panel" id="gsf">
    <h3>${l ? 'Edit your listing' : 'Sell your gear'}</h3>
    <div class="form-grid">
      <label for="st">What is it?<input id="st" type="text" required minlength="3" maxlength="60" value="${esc(l?.title || '')}" placeholder="e.g. Miken Freak 34oz, 2-piece"></label>
      <label for="sc">Category<select id="sc">${CATS.map(([k, t]) => `<option value="${k}"${(l?.cat || 'bat') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label for="sp">Price ($)<input id="sp" type="number" min="0" max="9999" step="1" inputmode="numeric" required value="${esc(l?.price ?? '')}" placeholder="0 for free"></label>
      <label for="sco">Condition<select id="sco">${CONDS.map(([k, t]) => `<option value="${k}"${(l?.cond || 'good') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label for="sb">Brand <span class="muted small">(optional)</span><input id="sb" type="text" maxlength="30" value="${esc(l?.brand || '')}"></label>
      <label for="ss">Size <span class="muted small">(optional)</span><input id="ss" type="text" maxlength="30" value="${esc(l?.size || '')}" placeholder="e.g. 34in/26oz, 12.5in, men's 10"></label>
      <label for="sce" id="scew">Bat certification stamp<select id="sce">${CERTS.map(([k, t]) => `<option value="${k}"${(l?.cert || '') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label for="sa">Pickup area<input id="sa" type="text" maxlength="80" value="${esc(l?.area || '')}" placeholder="Postal code or neighbourhood"></label>
    </div>
    <p class="muted small" style="margin-top:-4px">Only an area about 1 km wide is shown, never your address.</p>
    <label for="sd">Description<textarea id="sd" maxlength="1000" placeholder="How much it's been used, any dents or repairs, why you're selling">${esc(l?.desc || '')}</textarea></label>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:6px">Photos <span class="muted small">(up to ${MAX_PHOTOS})</span></legend>
      <div class="row">${kept.map((p, i) => `<div class="gear-thumb"><img src="${esc(platform.photos.url(p))}" alt=""><button type="button" class="iconbtn" data-rmk="${i}" aria-label="Remove photo">✕</button></div>`).join('')}${added.map((p, i) => `<div class="gear-thumb"><img src="${p.url}" alt=""><button type="button" class="iconbtn" data-rma="${i}" aria-label="Remove photo">✕</button></div>`).join('')}
      ${kept.length + added.length < MAX_PHOTOS ? `<label class="btn ghost" style="display:inline-flex;align-items:center;cursor:pointer">Add photos<input id="sph" type="file" accept="image/*" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label>` : ''}</div>
      <p class="muted small">Photos are resized and their hidden location data is removed before upload.</p>
    </fieldset>
    <div class="row"><button class="btn cta" type="submit" id="ssave">${l ? 'Save changes' : 'Post listing'}</button>${l ? '<button class="btn ghost" type="button" id="scancel">Cancel</button>' : ''}</div>
    <p class="small muted">By posting you confirm the item is yours to sell and isn’t stolen, recalled or unsafe.</p>
  </form>`;
    // keep what was typed when the photo row redraws the form
    if (saved) { for (const [k, v] of Object.entries(saved)) { const el = box.querySelector('#' + k); if (el) el.value = v; } saved = null; }
    const f = box.querySelector('#gsf'), certW = box.querySelector('#scew'), cat = box.querySelector('#sc');
    const showCert = () => { certW.hidden = cat.value !== 'bat'; }; showCert(); cat.onchange = showCert;
    box.querySelectorAll('[data-rmk]').forEach(b => b.onclick = () => { snapshot(); kept.splice(+b.dataset.rmk, 1); draw(); });
    box.querySelectorAll('[data-rma]').forEach(b => b.onclick = () => { snapshot(); URL.revokeObjectURL(added[+b.dataset.rma].url); added.splice(+b.dataset.rma, 1); draw(); });
    const inp = box.querySelector('#sph');
    if (inp) inp.onchange = async () => {
      snapshot();
      for (const file of [...inp.files].slice(0, MAX_PHOTOS - kept.length - added.length)) {
        try { const blob = await shrink(file); added.push({ blob, url: URL.createObjectURL(blob) }); } catch (_) { c.toast('That photo couldn’t be read. Try a JPEG or PNG.'); }
      }
      draw();
    };
    const cn = box.querySelector('#scancel'); if (cn) cn.onclick = () => { editId = null; go(c, 'item', l.id); };
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = box.querySelector('#ssave'); btn.disabled = true; btn.textContent = 'Saving…';
      const area = box.querySelector('#sa').value.trim();
      let loc = l && l.area === area && l.lat != null ? { lat: l.lat, lng: l.lng, label: l.area } : null;
      if (area && !loc) { try { loc = await c.locate(area); } catch (_) { loc = null; } }
      const fresh = [];
      try {
        for (const a of added) { const path = `${me}/${id}/${c.uid()}.jpg`; await platform.photos.upload(path, a.blob); fresh.push(path); }
      } catch (err) { c.toast(err.userMessage || 'A photo didn’t upload.'); platform.photos.remove(fresh).catch(() => {}); btn.disabled = false; btn.textContent = l ? 'Save changes' : 'Post listing'; return; }
      const cat = box.querySelector('#sc').value;
      const data = { title: box.querySelector('#st').value.trim(), cat, price: Math.max(0, Math.min(9999, Math.round(+box.querySelector('#sp').value || 0))),
        cond: box.querySelector('#sco').value, brand: box.querySelector('#sb').value.trim(), size: box.querySelector('#ss').value.trim(),
        cert: cat === 'bat' ? box.querySelector('#sce').value : '', desc: box.querySelector('#sd').value.trim(),
        area: loc ? loc.label : area, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, photos: [...kept, ...fresh],
        name: c.myName() || 'A Dugout player', status: l ? l.status : 'active', created: l ? l.created : Date.now(), updated: Date.now() };
      const ok = await c.write(() => c.db.doc('listings/' + id).set(data), l ? 'Listing saved' : 'Your gear is listed');
      if (!ok) { platform.photos.remove(fresh).catch(() => {}); btn.disabled = false; btn.textContent = l ? 'Save changes' : 'Post listing'; return; }
      if (l) platform.photos.remove((l.photos || []).filter(p => !kept.includes(p))).catch(() => {});
      added.forEach(a => URL.revokeObjectURL(a.url)); sell.draftId = null; editId = null; go(c, 'item', id);
    });
  };
  let saved = null;
  const snapshot = () => { saved = {}; box.querySelectorAll('#gsf input:not([type=file]), #gsf select, #gsf textarea').forEach(el => saved[el.id] = el.value); };
  draw();
}

/* make a photo small, upright and free of hidden metadata (including GPS) by redrawing it */
async function shrink(file) {
  if (!/^image\//.test(file.type)) throw new Error('not an image');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close && bmp.close();
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) throw new Error('encode failed');
  return blob;
}

/* ---------- conversations ---------- */
function inbox(c) {
  const { st, esc } = c, me = c.myId(), box = document.getElementById('gearBody');
  const list = [...st.threads].sort((a, b) => (b.lastAt || b.at || 0) - (a.lastAt || a.at || 0));
  box.innerHTML = list.length ? `<div class="stack">${list.map(t => {
    const unread = t.lastAt && t.lastFrom !== me && (t.buyer === me ? (t.seenBuyer || 0) : (t.seenSeller || 0)) < t.lastAt;
    return `<button type="button" class="panel thread-row${unread ? ' unread' : ''}" data-th="${esc(t.id)}">
      <span class="grow" style="min-width:0;text-align:left"><b>${esc(t.title || 'Listing')}</b><span class="muted small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.buyer === me ? 'You’re buying' : 'You’re selling'}${t.last ? ' · ' + esc(t.last) : ''}</span></span>
      ${unread ? '<span class="pill in">New</span>' : ''}</button>`;
  }).join('')}</div>` : `<div class="panel empty">No conversations yet. Tap <b>Message seller</b> on any listing to start one.</div>`;
  box.querySelectorAll('[data-th]').forEach(b => b.onclick = () => go(c, 'thread', b.dataset.th));
}

function thread(c) {
  const { st, esc, platform } = c, me = c.myId(), box = document.getElementById('gearBody');
  const t = st.threads.find(x => x.id === openId);
  if (!t) { box.innerHTML = `<div class="panel empty">Opening conversation…</div>`; return; }
  const msgs = st.messages.filter(m => m.thread === t.id).sort((a, b) => (a.at || 0) - (b.at || 0));
  const l = st.listings.find(x => x.id === t.listing);
  const draft = (document.getElementById('mtxt') || {}).value || '';
  box.innerHTML = `<button class="btn ghost small" type="button" id="gback" style="margin-bottom:10px">← Inbox</button>
  <div class="panel">
    <div class="row" style="margin-bottom:8px"><div class="grow"><b>${esc(t.title || 'Listing')}</b><div class="muted small">${t.buyer === me ? `Seller: ${esc(l?.name || 'the seller')}` : 'A buyer is asking'}${l ? ` · ${esc(price(l.price))}${l.status !== 'active' ? ' · ' + (l.status === 'sold' ? 'sold' : 'pending') : ''}` : ' · listing removed'}</div></div>
      ${l ? '<button class="btn ghost small" type="button" id="gview">View listing</button>' : ''}</div>
    <div class="chat" id="chat" aria-live="polite">${msgs.map(m => `<div class="bubble${m.from === me ? ' mine' : ''}"><div>${esc(m.text)}</div><div class="muted small">${esc(new Date(m.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div></div>`).join('') || '<p class="muted small">Say hi and ask your question. Agree on a public place to meet.</p>'}</div>
    <form class="row" id="mform" style="margin-top:10px"><label for="mtxt" class="sr">Message</label><input id="mtxt" class="grow" type="text" maxlength="1000" autocomplete="off" placeholder="Write a message" value="${esc(draft)}"><button class="btn" type="submit">Send</button></form>
  </div>
  <p class="muted small" style="margin-top:10px">Never send a deposit or e-transfer before you’ve seen the item. If something feels off, report the listing.</p>`;
  const chat = box.querySelector('#chat'); chat.scrollTop = chat.scrollHeight;
  box.querySelector('#gback').onclick = () => go(c, 'inbox');
  const v = box.querySelector('#gview'); if (v) v.onclick = () => go(c, 'item', t.listing);
  box.querySelector('#mform').addEventListener('submit', async e => {
    e.preventDefault(); const inp = box.querySelector('#mtxt'), text = inp.value.trim(); if (!text) return;
    inp.value = '';
    if (!await c.write(() => c.db.doc('messages/' + c.uid()).set({ thread: t.id, text }))) inp.value = text;
    else box.querySelector('#mtxt').focus();
  });
  const unread = t.lastAt && t.lastFrom !== me && (t.buyer === me ? (t.seenBuyer || 0) : (t.seenSeller || 0)) < t.lastAt;
  if (unread) platform.markSeen(t.id).catch(() => {});
}

function mine(c) {
  const { st } = c, me = c.myId(), box = document.getElementById('gearBody');
  const list = st.listings.filter(l => l.seller === me).sort((a, b) => (b.created || 0) - (a.created || 0));
  box.innerHTML = `<div class="gear-grid">${list.map(l => card(c, l, null)).join('') || `<div class="panel empty" style="grid-column:1/-1">You haven’t listed anything. Tap <b>Sell</b> to post your first item.</div>`}</div>`;
  box.querySelectorAll('[data-item]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(c, 'item', a.dataset.item); }));
}

/* screens the app is showing a form on shouldn't be redrawn under the user's fingers */
export const gearBusy = () => mode === 'sell';
