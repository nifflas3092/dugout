/* Dugout team app. The screens and logic; data access comes from ./platform.js */
import { forecast, outlook, CREDIT } from './weather.js';
import { renderGear, unreadCount, gearBusy } from './market.js';
import { RULESETS, POS_NAME as RULE_POS_NAME, rulesFor, buildLineupFor, batterAt, lineupPlayers, lineupProblems, availabilityCheck, gameClock } from './rules.js';
export function startApp(platform) {
/* ---------- state ---------- */
const POS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'];
const POS_NAME = RULE_POS_NAME;
const RULES = () => rulesFor(st.team);          // the team's league rules (Team tab → settings)
const FPOS = () => RULES().pos;                // fielding positions under those rules
const GENDER = { m: 'Man', w: 'Woman', x: 'Non-binary' };
const slotLabel = (L, slot) => slot && slot[0] === '~' ? `${slot[1] === 'w' ? 'Women' : 'Men'}’s spot ↻ (${((L.rot || {})[slot[1]] || []).map(pName).join(', ')})` : pName(slot);
const RESULTS = [
  { k: '1B', label: 'Single', cls: 'hit' }, { k: '2B', label: 'Double', cls: 'hit' }, { k: '3B', label: 'Triple', cls: 'hit' }, { k: 'HR', label: 'Home run', cls: 'hit' },
  { k: 'BB', label: 'Walk' }, { k: 'E', label: 'Reached on error' }, { k: 'SF', label: 'Sac fly' },
  { k: 'OUT', label: 'Out', cls: 'outy' }, { k: 'K', label: 'Strikeout', cls: 'outy' },
];
const st = { listings: [], threads: [], messages: [], contacts: {}, agents: [], diamonds: [], invites: [], team: null, players: [], games: [], rsvp: {}, ab: [], posts: [], loaded: { team: false, players: false, games: false }, canEdit: false, canWrite: false, offline: false };
let db = null, user = null;
const view = document.getElementById('view');
const LS = { get(k, d) { try { const v = localStorage.getItem('dugout-' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem('dugout-' + k, JSON.stringify(v)); } catch (_) {} } };
let me = null;                            // the roster spot linked to this account (players/<id>.uid), set when players load
let selGame = LS.get('game', null);
let openRules = false;                     // open the league-rules card when arriving at the Team tab
const openLists = new Set();              // RSVP lists the viewer has opened, kept open when data updates

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); };
const uid = () => Math.random().toString(36).slice(2, 10);
const pName = id => { const p = st.players.find(x => x.id === id); return p ? p.name : 'Former player'; };
const pNum = id => { const p = st.players.find(x => x.id === id); return p && p.number !== '' && p.number != null ? '#' + p.number : ''; };
const sortedGames = () => [...st.games].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };  // the local date
const fmtDate = d => { if (!d) return { m: '', d: '', w: '' }; const x = new Date(d + 'T12:00:00'); return { m: x.toLocaleString(undefined, { month: 'short' }), d: x.getDate(), w: x.toLocaleString(undefined, { weekday: 'short' }) }; };
const fmtTime = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const sum = a => (a || []).reduce((s, v) => s + (+v || 0), 0);
const rsvpOf = (gid, pid) => (st.rsvp[gid + '_' + pid] || {}).s || '';
const defaultGame = () => { const g = sortedGames().filter(x => x.status !== 'rainout'); if (selGame && g.some(x => x.id === selGame)) return selGame; const up = g.find(x => x.date >= today() && x.status !== 'final'); return up ? up.id : (g.length ? g[g.length - 1].id : null); };

/* ---------- writes ---------- */
async function write(fn, ok) {
  if (!db) { toast('Sign in to save changes'); return false; }
  try { await fn(); if (ok) toast(ok); return true; }
  catch (e) { toast(e && e.userMessage ? e.userMessage : e && e.code === 'not_granted' ? 'You don’t have permission to change that' : 'Could not save. Check your connection and try again.'); return false; }
}

/* ---------- views ---------- */
/* navigation: five groups, in the order a team uses them */
const GROUP = { home: 'home', gameday: 'home', schedule: 'games', lineup: 'games', score: 'games', roster: 'team', stats: 'team', board: 'team', subs: 'subs', gear: 'gear' };
const SUBNAV = { games: [['schedule', 'Schedule'], ['lineup', 'Lineup'], ['score', 'Score']], team: [['roster', 'Roster'], ['stats', 'Stats'], ['board', 'Board']] };
function subnav(tab) {
  const items = SUBNAV[GROUP[tab]]; if (!items) return;
  view.insertAdjacentHTML('afterbegin', `<nav class="subnav" aria-label="${GROUP[tab] === 'games' ? 'Games' : 'Team'}">${items.map(([k, l]) => `<a href="#${k}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`);
}
function render() {
  const tab = (location.hash || '#home').slice(1);
  document.querySelectorAll('.tabs-main a').forEach(a => a.setAttribute('aria-current', a.dataset.group === (GROUP[tab] || 'home') ? 'page' : 'false'));
  document.querySelectorAll('.tabs-side a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tab || (tab === 'gameday' && a.dataset.tab === 'home') ? 'page' : 'false'));
  header();
  if (!st.loaded.team && !st.offline) { view.innerHTML = `<div class="empty">Loading your team…</div>`; return; }
  if (tab === 'subs' && (st.loaded.team || st.offline)) return renderSubs();
  if (tab === 'gear' && (st.loaded.team || st.offline)) return renderGear(gearCtx());
  if (!st.team && !st.offline) return renderSetup();
  if (st.offline && !st.team) return renderOffline();
  const fn = ({ home: renderHome, gameday: renderGameday, subs: renderSubs, schedule: renderSchedule, lineup: renderLineup, score: renderScore, stats: renderStats, roster: renderRoster, board: renderBoard }[tab] || renderHome);
  fn();
  subnav(tab);
}
function header() {
  const t = st.team;
  document.getElementById('teamTitle').textContent = t ? t.name : 'Dugout';
  document.getElementById('teamSub').textContent = t ? [t.league, t.season].filter(Boolean).join(' · ') || 'Rec league slowpitch' : 'Team app for rec league slowpitch';
  document.getElementById('crest').textContent = t ? (t.name || 'D').trim().slice(0, 2).toUpperCase() : 'D';
  const fin = st.games.filter(g => g.status === 'final');
  const w = fin.filter(g => sum(g.us) > sum(g.them)).length, l = fin.filter(g => sum(g.us) < sum(g.them)).length, tie = fin.length - w - l;
  document.getElementById('record').textContent = fin.length ? `${w}-${l}${tie ? '-' + tie : ''}` : '';
  renderNotice();
  const n = myId ? unreadCount(st, myId) : 0;
  document.querySelectorAll('.gearBadge').forEach(badge => { badge.textContent = n; badge.hidden = !n; badge.setAttribute('aria-label', `${n} unread`); });
}

function renderOffline() {
  view.innerHTML = `<h2>Can’t reach Dugout</h2><div class="notice">Your team couldn’t be loaded. Check your connection, then reload the page.</div>`;
}

function renderSetup() {
  if (!st.canEdit) { view.innerHTML = `<h2>No team yet</h2><div class="panel"><p>The captain hasn't set up the team yet. Check back once they have.</p></div>`; return; }
  view.innerHTML = `<h2>Set up your team</h2>
  <form class="panel" id="setup">
    <p class="muted">Takes a minute. You can change all of this later.</p>
    <label for="sName">Team name<input id="sName" type="text" required placeholder="e.g. Sunday Sluggers" maxlength="40"></label>
    <div class="form-grid">
      <label for="sLeague">League<input id="sLeague" type="text" placeholder="e.g. City Co-Ed Slowpitch" maxlength="60"></label>
      <label for="sSeason">Season<input id="sSeason" type="text" placeholder="e.g. Fall 2026" maxlength="30"></label>
      <label for="sFee">Player fee for the season ($)<input id="sFee" type="number" min="0" step="1" placeholder="e.g. 60"></label>
      <label for="sInn">Innings per game<input id="sInn" type="number" min="3" max="9" value="7"></label>
    </div>
    <div class="row"><button class="btn cta" type="submit">Create team</button><button class="btn ghost" type="button" id="demo">Try it with a sample team</button></div>
  </form>`;
  document.getElementById('setup').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('sName').value.trim(); if (!name) return;
    await write(() => db.doc('team/info').set({ name, league: document.getElementById('sLeague').value.trim(), season: document.getElementById('sSeason').value.trim(), fee: +document.getElementById('sFee').value || 0, innings: +document.getElementById('sInn').value || 7 }), 'Team created. Add your players next.');
    location.hash = '#roster';
  });
  document.getElementById('demo').addEventListener('click', loadDemo);
}

/* --- Games --- */
/* ---------- Home: what's next, what you need to do, what's new ---------- */
const SEAM = `<svg class="seam" viewBox="0 0 200 200" aria-hidden="true"><path d="M30 -10 C 95 40, 95 160, 30 210" /><path d="M170 -10 C 105 40, 105 160, 170 210" /></svg>`;
function renderHome() {
  const g = nextGame(), rules = RULES(), mine = me && st.players.find(p => p.id === me);
  const fin = st.games.filter(x => x.status === 'final');
  const w = fin.filter(x => sum(x.us) > sum(x.them)).length, l = fin.filter(x => sum(x.us) < sum(x.them)).length, t = fin.length - w - l;
  const last = [...fin].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))[0];
  const myLine = me ? statLine(me) : null;
  const f3 = v => v.toFixed(3).replace(/^0/, '');
  // the matchup card
  let hero;
  if (!g) hero = `<section class="matchup empty-matchup">${SEAM}<p class="mu-when">No games on the schedule</p><h2 class="mu-vs">${st.canEdit ? 'Add your first game' : 'Nothing booked yet'}</h2>${st.canEdit ? `<a class="btn cta" href="#schedule">Add a game</a>` : '<p>Your captain will add games soon.</p>'}</section>`;
  else {
    const ins = st.players.filter(p => rsvpOf(g.id, p.id) === 'in'), my = me ? rsvpOf(g.id, me) : '';
    const av = rules.coed ? availabilityCheck(ins, rules) : null, need = rules.field, wx = gameWeather(g), maps = mapsUrl(g);
    const slots = Array.from({ length: Math.max(need, ins.length) }, (_, i) => i < ins.length ? (rules.coed ? (ins[i].g === 'w' ? 'w' : ins[i].g === 'm' ? 'm' : 'x') : 'x') : '');
    hero = `<section class="matchup" aria-label="Next game">${SEAM}
      <div class="mu-top"><span class="mu-when">${g.date === today() ? 'Game day' : esc(gameWhen(g).split(',')[0])}</span><span class="mu-count">${esc(untilText(g))}</span></div>
      <h2 class="mu-vs"><span class="mu-side">${g.home ? 'vs' : 'at'}</span> ${esc(g.opp)}</h2>
      <div class="mu-facts">
        <span>${esc(fmtTime(g.time) || 'Time to be set')}</span>
        <span>${esc(g.field || 'Field to be set')}${maps ? ` <a href="${esc(maps)}" target="_blank" rel="noopener">Directions</a>` : ''}</span>
        ${wx ? `<span class="mu-wx mu-wx-${wx.level}">${wx.icon} ${esc(wx.temp)}°C, ${esc(wx.text.toLowerCase())}</span>` : ''}
      </div>
      ${me ? `<div class="mu-rsvp"><span class="mu-q">${my ? `You’re ${my === 'in' ? 'in' : my === 'out' ? 'out' : 'a maybe'}` : 'Are you in?'}</span>
        <div class="mu-btns">${[['in', 'I’m in'], ['maybe', 'Maybe'], ['out', 'Can’t make it']].map(([v, lbl]) => `<button type="button" class="mu-btn mu-${v}" data-rsvp data-g="${esc(g.id)}" data-p="${esc(me)}" data-v="${v}" aria-pressed="${my === v}">${lbl}</button>`).join('')}</div></div>`
      : `<a class="btn ghost-light" href="#schedule">Find your name to answer</a>`}
      <div class="mu-squad"><div class="mu-slots" aria-hidden="true">${slots.map(sx => `<i class="${sx ? 'on ' + sx : ''}"></i>`).join('')}</div>
        <span>${ins.length} of ${need} in${rules.coed ? `: ${ins.filter(p => p.g === 'm').length} men, ${ins.filter(p => p.g === 'w').length} women` : ''}</span></div>
      ${av ? `<p class="mu-warn">${esc(av.text)}</p>` : ''}
      <div class="mu-links"><a href="#gameday">Gameday view</a><a href="#lineup" data-golu="${esc(g.id)}">${g.lineup ? 'See the lineup' : st.canEdit ? 'Build the lineup' : 'Lineup'}</a></div>
    </section>`;
  }
  // stat tiles
  const tiles = [
    `<div class="tile"><span class="tile-n">${fin.length ? `${w}–${l}${t ? '–' + t : ''}` : '0–0'}</span><span class="tile-l">Season record</span></div>`,
    last ? `<div class="tile"><span class="tile-n">${sum(last.us)}–${sum(last.them)}</span><span class="tile-l">${sum(last.us) > sum(last.them) ? 'Won' : sum(last.us) < sum(last.them) ? 'Lost' : 'Tied'} ${last.home ? 'vs' : 'at'} ${esc(last.opp)}</span></div>` : '',
    myLine && myLine.PA ? `<div class="tile"><span class="tile-n">${f3(myLine.AVG)}</span><span class="tile-l">Your average, ${myLine.H} hits</span></div>` : '',
    myLine && myLine.PA ? `<div class="tile"><span class="tile-n">${myLine.RBI}</span><span class="tile-l">Your RBIs</span></div>` : '',
  ].filter(Boolean);
  // captain's to-do, in the order it matters before a game
  const todo = [];
  if (st.canEdit) {
    if (!st.games.length) todo.push(['Add your schedule', 'Put your season’s games in so players can answer In or Out.', '#schedule', 'Add games']);
    if (!st.players.length) todo.push(['Add your roster', 'Add players so they can claim their name and RSVP.', '#roster', 'Add players']);
    if (rules.coed) { const unset = st.players.filter(p => !p.g); if (unset.length) todo.push([`Set Man or Woman for ${unset.length} player${unset.length === 1 ? '' : 's'}`, `${rules.short} lineups need it.`, '#roster', 'Open roster']); }
    if (g) {
      const waiting = st.players.filter(p => !rsvpOf(g.id, p.id));
      if (waiting.length) todo.push([`${waiting.length} haven’t answered for ${gameWhen(g).split(',')[0]}`, waiting.slice(0, 4).map(p => p.name).join(', ') + (waiting.length > 4 ? ` and ${waiting.length - 4} more` : ''), null, 'Remind team', `data-remind="${esc(g.id)}"`]);
      if (!g.lineup) todo.push(['Build the lineup', 'Dugout makes a fair one from everyone who’s in.', '#lineup', 'Build it', `data-golu="${esc(g.id)}"`]);
    }
    const mk = st.games.filter(x => x.status === 'rainout' && !x.makeup);
    if (mk.length) todo.push([`${mk.length} rain-out${mk.length === 1 ? '' : 's'} need a makeup date`, mk.map(x => `${x.home ? 'vs' : 'at'} ${x.opp}`).join(', '), '#schedule', 'Schedule']);
    if (st.team && st.team.lat == null) todo.push(['Turn on game forecasts', 'Add your home area so each game shows the weather.', '#roster', 'Add area']);
  } else if (!me && st.players.length) todo.push(['Find your name on the roster', 'Tap This is me so you can answer In or Out.', '#schedule', 'Find me']);
  const post = [...st.posts].sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at)[0];
  const unread = myId ? unreadCount(st, myId) : 0;
  view.innerHTML = `${hero}
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : ''}
    ${todo.length ? `<section class="home-block"><h3>${st.canEdit ? 'Before the next game' : 'Get set up'}</h3><ul class="todo">${todo.map(([h, sub, href, cta, attr]) => `<li><span class="grow"><b>${esc(h)}</b><span class="muted small">${esc(sub)}</span></span>${href ? `<a class="btn small" href="${href}" ${attr || ''}>${cta}</a>` : `<button class="btn small" type="button" ${attr || ''}>${cta}</button>`}</li>`).join('')}</ul></section>` : ''}
    <section class="home-block"><h3>From the team</h3>
      ${post ? `<a class="home-post" href="#board"><b>${esc(post.text)}</b><span class="muted small">${post.pin ? 'Pinned' : esc(new Date(post.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span></a>` : `<a class="home-post" href="#board"><span class="muted">Nothing on the board yet. Post the first note.</span></a>`}
      ${unread ? `<a class="home-post" href="#gear"><b>${unread} new gear message${unread === 1 ? '' : 's'}</b><span class="muted small">Open your inbox</span></a>` : ''}
    </section>`;
  view.querySelectorAll('.mu-btns [data-rsvp]').forEach(b => b.addEventListener('click', () => setRsvp(b.dataset.g, b.dataset.p, b.dataset.v)));
  view.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', () => shareSheet('Remind the team', reminderMessage(st.games.find(x => x.id === b.dataset.remind)))));
  view.querySelectorAll('[data-golu]').forEach(a => a.addEventListener('click', () => { selGame = a.dataset.golu; LS.set('game', selGame); }));
}

/* ---------- Gameday: the three things you need walking in from the parking lot ---------- */
const nextGame = () => sortedGames().find(g => g.status !== 'final' && g.status !== 'rainout' && g.date >= today());
const posAt = (L, i, pid) => (L && L.field[i] ? FPOS().find(k => L.field[i][k] === pid) : null) || 'BN';
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
function mapsUrl(g) {
  const lat = g.lat ?? null, lng = g.lng ?? null;
  const q = lat != null && lng != null && !g.field ? `${lat},${lng}` : [g.field, (st.diamonds.find(d => d.id === g.diamond) || {}).label || st.team?.place].filter(Boolean).join(', ');
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null;
}
function untilText(g) {
  const ms = new Date(`${g.date}T${g.time || '18:30'}`).getTime() - Date.now();
  if (ms < -2 * 3600e3) return ''; if (ms < 0) return 'Game on now';
  const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
  return h >= 24 ? `in ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}` : `starts in ${h ? h + ' h ' : ''}${m} min`;
}
function gamedayCard(g, full) {
  const L = g.lineup, wx = gameWeather(g), maps = mapsUrl(g), isToday = g.date === today();
  const rules = RULES(), myRot = me && L && L.rot ? Object.keys(L.rot).find(k => L.rot[k].includes(me)) : null;
  const mySpot = me && L ? L.order.indexOf(me) : -1, myPos = me && L ? posAt(L, 0, me) : null;
  const pitcher = L ? (rules.offensePitcher ? L.pitcher : L.field[0] && L.field[0].P) : null;
  const av = rules.coed ? availabilityCheck(st.players.filter(p => rsvpOf(g.id, p.id) === 'in'), rules) : null;
  return `<section class="panel gameday" aria-label="Gameday">
    <div class="row" style="align-items:flex-start"><span class="gd-tag">${isToday ? 'Gameday' : 'Next game · ' + esc(fmtDate(g.date).w + ' ' + fmtDate(g.date).m + ' ' + fmtDate(g.date).d)}</span>${full ? '' : `<a class="small gd-more" href="#gameday">Open gameday view →</a>`}</div>
    <div class="gd-time">${esc(fmtTime(g.time) || 'Time TBA')}</div>
    <div class="gd-sub">${esc(untilText(g))}${untilText(g) ? ' · ' : ''}${g.home ? 'vs' : '@'} ${esc(g.opp)}</div>
    <div class="gd-field"><span aria-hidden="true">📍</span><span class="grow"><b>${esc(g.field || 'Field not set')}</b>${(st.diamonds.find(d => d.id === g.diamond) || {}).name ? `<span class="muted small" style="display:block">${esc(st.diamonds.find(d => d.id === g.diamond).name)}</span>` : ''}</span>
      ${maps ? `<a class="btn cta small" href="${esc(maps)}" target="_blank" rel="noopener">Directions</a>` : ''}</div>
    ${wx ? `<div class="wx wx-${wx.level}"><span class="wx-icon" aria-hidden="true">${wx.icon}</span><span class="grow"><b>${esc(wx.temp)}°C</b> · ${esc(wx.text)}</span></div>` : ''}
    ${av ? `<div class="wx wx-${av.level === 'danger' ? 'high' : 'watch'}"><span class="wx-icon" aria-hidden="true">👥</span><span class="grow">${esc(av.text)}</span></div>` : ''}
    ${me && myRot ? `<div class="gd-you">You bat in the rotating ${myRot === 'w' ? 'women’s' : 'men’s'} spots · ${myPos === 'BN' ? 'start on the <b>bench</b>' : `start at <b>${esc(POS_NAME[myPos])}</b>`}</div>` : ''}
    ${me && !myRot ? (mySpot >= 0 ? `<div class="gd-you">You bat <b>${ordinal(mySpot + 1)}</b> · ${myPos === 'BN' ? 'start on the <b>bench</b>' : `start at <b>${esc(POS_NAME[myPos])}</b>`}</div>`
      : `<div class="gd-you"><span class="grow">Are you playing?</span>${rsvpSeg(g.id, me)}</div>`) : ''}
    ${L ? `${pitcher ? `<div class="small" style="margin-top:8px">${rules.offensePitcher ? 'Pitching for us when we bat' : 'Pitching'}: <b>${esc(pName(pitcher))}</b></div>` : ''}
      <ol class="gd-order">${L.order.map((p, i) => `<li${p === me ? ' class="me"' : ''}><span class="n">${i + 1}</span><span class="grow">${esc(slotLabel(L, p))}</span>${p[0] === '~' ? '<span class="pos bench">↻</span>' : `<span class="pos${posAt(L, 0, p) === 'BN' ? ' bench' : ''}">${esc(posAt(L, 0, p))}</span>`}</li>`).join('')}</ol>
      <div class="row">${full ? `<button class="btn ghost small" type="button" data-sharelu="${esc(g.id)}">Share lineup</button>` : ''}<a class="btn ghost small" href="#lineup" data-golu="${esc(g.id)}">Full lineup by inning</a></div>`
      : `<p class="muted small" style="margin-top:8px">${st.canEdit ? 'No lineup yet. Build it on the Lineup tab.' : 'The lineup isn’t posted yet.'}</p>`}
  </section>`;
}
function renderGameday() {
  const g = nextGame();
  view.innerHTML = `<h2>Gameday</h2>${g ? gamedayCard(g, true) : '<div class="panel empty">No upcoming games.</div>'}`;
  bindGameday();
}
function bindGameday() {
  view.querySelectorAll('[data-sharelu]').forEach(b => b.onclick = () => shareSheet('Share the lineup', lineupText(st.games.find(x => x.id === b.dataset.sharelu))));
  view.querySelectorAll('[data-golu]').forEach(a => a.addEventListener('click', () => { selGame = a.dataset.golu; LS.set('game', selGame); }));
  view.querySelectorAll('.gameday [data-rsvp]').forEach(b => b.addEventListener('click', () => setRsvp(b.dataset.g, b.dataset.p, b.dataset.v)));
}

/* ---------- 3. the lineup as a group-chat message, or as a picture ---------- */
function lineupText(g) {
  const L = g.lineup; if (!L) return '';
  const pad = (t, n) => (t + ' '.repeat(n)).slice(0, n);
  return `⚾ ${st.team?.name || 'Lineup'}: ${gameWhen(g)} ${g.home ? 'vs' : '@'} ${g.opp}${g.field ? ' (' + g.field + ')' : ''}\n\n` +
    `BATTING ORDER\n` + L.order.map((p, i) => `${i + 1}. ${slotLabel(L, p)}`).join('\n') +
    `\n\nIN THE FIELD (innings 1–${L.field.length})\n` + lineupPlayers(L).map(p => `${pName(p)}: ${L.field.map((_, k) => posAt(L, k, p)).join(' ')}`).join('\n') +
    (RULES().offensePitcher && L.pitcher ? `\n\nPitching for us: ${pName(L.pitcher)}` : '') +
    `\n\nBN = bench that inning${RULES().id === 'ossc' ? ', ROV = rover' : ''}. Full lineup in Dugout:`;
}
async function lineupImage(g) {
  const L = g.lineup, people = lineupPlayers(L), n = people.length, inn = L.field.length;
  const W = 1080, rowH = 66, top = 250, H = top + n * rowH + 110, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), disp = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif', body = '"Atkinson Hyperlegible", Arial, sans-serif';
  try { await document.fonts.ready; } catch (_) {}
  x.fillStyle = '#f8fafc'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#3b8256'; x.fillRect(0, 0, W, 190);
  x.fillStyle = '#ffffff'; x.font = `800 64px ${disp}`; x.fillText((st.team?.name || 'Lineup').toUpperCase().slice(0, 28), 48, 92);
  x.font = `400 30px ${body}`; x.fillText(`${gameWhen(g)} · ${g.home ? 'vs' : '@'} ${g.opp}${g.field ? ' · ' + g.field : ''}`.slice(0, 70), 48, 146);
  const nameW = 330, colW = Math.min(76, (W - 48 - 70 - nameW - 48) / inn), x0 = 48 + 70 + nameW;
  x.fillStyle = '#475569'; x.font = `700 22px ${body}`;
  for (let k = 0; k < inn; k++) { x.textAlign = 'center'; x.fillText(`INN ${k + 1}`, x0 + colW * k + colW / 2, top - 22); }
  x.textAlign = 'left';
  people.forEach((p, i) => {
    const y = top + i * rowH, spot = L.order.indexOf(p);
    x.fillStyle = i % 2 ? '#f8fafc' : '#ffffff'; x.fillRect(32, y, W - 64, rowH);
    x.fillStyle = '#3b8256'; x.font = `800 34px ${disp}`; x.fillText(spot >= 0 ? String(spot + 1) : '↻', 52, y + 44);
    x.fillStyle = '#0f172a'; x.font = `700 30px ${body}`; x.fillText(pName(p).slice(0, 20), 118, y + 43);
    for (let k = 0; k < inn; k++) {
      const pos = posAt(L, k, p), cx = x0 + colW * k + colW / 2;
      x.fillStyle = pos === 'BN' ? '#e2e8f0' : pos === 'P' ? '#f59e0b' : '#e8f3ec'; x.beginPath(); x.roundRect(cx - colW / 2 + 5, y + 12, colW - 10, rowH - 24, 8); x.fill();
      x.fillStyle = pos === 'BN' ? '#64748b' : '#0f172a'; x.font = `700 24px ${body}`; x.textAlign = 'center'; x.fillText(pos, cx, y + 42); x.textAlign = 'left';
    }
  });
  x.fillStyle = '#475569'; x.font = `400 24px ${body}`; x.fillText(`BN = bench${RULES().id === 'ossc' ? ' · ROV = rover' : ' · P (gold) = pitching'}${Object.keys(L.rot || {}).length ? ' · ↻ = rotating spot' : ''} · made with Dugout`, 48, H - 44);
  return new Promise(r => cv.toBlob(r, 'image/png'));
}
async function saveLineupImage(g) {
  const blob = await lineupImage(g), name = `lineup-${g.date}.png`, file = new File([blob], name, { type: 'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Lineup' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Lineup image saved');
}

/* ---------- 4. team notice banner (fields closed, time changed, ...) ---------- */
const NOTICE_PRESETS = [['danger', '⚠️ GAMES CANCELLED TONIGHT: fields are closed'], ['warn', '🌧️ Fields being checked. Decision by 5 PM, watch for an update'], ['warn', '⏰ Game time changed. Check the schedule'], ['info', '📍 Diamond changed. Check the schedule']];
const liveNotice = () => { const a = st.team && st.team.alert; return a && a.text && (!a.until || Date.now() < a.until) ? a : null; };
function renderNotice() {
  const box = document.getElementById('notice'); if (!box) return;
  const a = liveNotice();
  if (!a) { box.innerHTML = ''; box.hidden = true; return; }
  const hidden = LS.get('noticeHidden', 0) === a.at;
  box.hidden = false; box.className = `notice-bar notice-${['danger', 'warn', 'info'].includes(a.level) ? a.level : 'warn'}${hidden ? ' small' : ''}`;
  box.innerHTML = hidden ? `<button type="button" class="notice-toggle" data-nshow>Team notice · show</button>`
    : `<div class="grow" role="alert"><b>${esc(a.text)}</b><span class="notice-meta">Posted ${esc(new Date(a.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}${a.until ? ' · clears automatically tonight' : ''}</span></div>
      <div class="row" style="gap:6px">${st.canEdit ? `<button type="button" class="notice-btn" data-nshare>Send to chat</button><button type="button" class="notice-btn" data-nclear>Remove</button>` : ''}<button type="button" class="notice-btn" data-nhide aria-label="Hide this notice">Hide</button></div>`;
  const on = (sel, fn) => { const b = box.querySelector(sel); if (b) b.onclick = fn; };
  on('[data-nshow]', () => { LS.set('noticeHidden', 0); renderNotice(); });
  on('[data-nhide]', () => { LS.set('noticeHidden', a.at); renderNotice(); });
  on('[data-nclear]', () => write(() => db.doc('team/info').update({ alert: null }), 'Notice removed'));
  on('[data-nshare]', () => shareSheet('Send the notice to your team', `${st.team?.name || 'Team'}: ${a.text}`));
}
function noticeForm() {
  const box = document.getElementById('gameForm');
  box.innerHTML = `<form class="panel" id="nf" style="margin-top:12px"><h3>Post a team notice</h3>
    <p class="muted small" style="margin-top:-4px">Shows at the top of Dugout for everyone on the team.</p>
    <div class="row">${NOTICE_PRESETS.map(([lv, t], i) => `<button type="button" class="chip-btn" data-preset="${i}">${esc(t.split(':')[0].split('.')[0])}</button>`).join('')}</div>
    <label for="nText">Message<input id="nText" type="text" maxlength="140" required placeholder="e.g. Rain delay. Games start 30 minutes late"></label>
    <div class="form-grid">
      <label for="nLevel">How urgent<select id="nLevel"><option value="danger">Red: cancelled or closed</option><option value="warn" selected>Orange: heads-up</option><option value="info">Green: good to know</option></select></label>
      <label for="nUntil">Show until<select id="nUntil"><option value="today">The end of today</option><option value="">I remove it</option></select></label>
    </div>
    <div class="row"><button class="btn cta" type="submit">Post notice</button><button class="btn ghost" type="button" id="nCancel">Cancel</button></div></form>`;
  box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const [lv, t] = NOTICE_PRESETS[+b.dataset.preset]; box.querySelector('#nText').value = t; box.querySelector('#nLevel').value = lv; });
  box.querySelector('#nCancel').onclick = () => box.innerHTML = '';
  box.querySelector('#nf').addEventListener('submit', async e => {
    e.preventDefault(); const text = box.querySelector('#nText').value.trim(); if (!text) return;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const alert = { text, level: box.querySelector('#nLevel').value, at: Date.now(), until: box.querySelector('#nUntil').value === 'today' ? end.getTime() : null };
    if (await write(() => db.doc('team/info').update({ alert }), 'Notice posted')) { box.innerHTML = ''; shareSheet('Also send it to your team chat?', `${st.team?.name || 'Team'}: ${text}`); }
  });
}

function renderSchedule() {
  const games = sortedGames(), rained = games.filter(g => g.status === 'rainout'), up = games.filter(g => g.status !== 'final' && g.status !== 'rainout' && g.date >= today()), past = games.filter(g => !up.includes(g) && g.status !== 'rainout');
  const needMakeup = rained.filter(g => !g.makeup);
  const mine = me && st.players.find(p => p.id === me);
  view.innerHTML = `
  <div class="row" style="margin-top:12px"><div class="grow small muted">${mine ? `You're <b>${esc(mine.name)}</b> <button class="btn ghost small" id="notMe" type="button">Change</button>` : st.players.length ? `Open <b>Show everyone</b> and tap <b>This is me</b> next to your name so you can answer for yourself.` : ''}</div>
  ${st.canEdit ? `<button class="btn ghost" id="postNotice" type="button">Post notice</button><button class="btn cta" id="addGame" type="button">Add game</button>` : ''}</div>
  <div id="gameForm"></div>
  ${up[0] && up[0].date === today() ? gamedayCard(up[0], false) : ''}
  <h2>Coming up</h2>
  <div class="stack games">${up.length ? up.map(gameCard).join('') : `<div class="panel empty">No games scheduled.${st.canEdit ? ' Tap <b>Add game</b> to put one on the schedule.' : ''}</div>`}</div>
  ${rained.length ? `<h2>Rained out</h2><p class="muted small" style="margin-top:-6px">${rained.length} this season${needMakeup.length ? ` · <b style="color:var(--out)">${needMakeup.length} still need${needMakeup.length === 1 ? 's' : ''} a makeup date</b>` : ' · all made up'}</p><div class="stack games">${[...needMakeup, ...rained.filter(g => g.makeup)].map(gameCard).join('')}</div>` : ''}
  ${past.length ? `<h2>Played</h2><div class="stack games">${past.reverse().map(gameCard).join('')}</div>` : ''}
  ${up.some(g => g.wx) ? `<p class="muted small" style="margin-top:16px">${CREDIT}. Forecasts change; your league makes the final call.</p>` : ''}`;
  view.querySelectorAll('[data-rain]').forEach(b => b.addEventListener('click', () => confirmInline(b, 'Mark this game rained out?', async () => {
    const id = b.dataset.rain;
    if (await write(() => db.doc('games/' + id).update({ status: 'rainout', rainedAt: Date.now() }), 'Marked rained out')) { const g = st.games.find(x => x.id === id); if (g) shareSheet('Tell the team it’s rained out', rainMessage({ ...g, makeup: null })); }
  })));
  view.querySelectorAll('[data-tell]').forEach(b => b.addEventListener('click', () => { const g = st.games.find(x => x.id === b.dataset.tell); shareSheet(g.makeup ? 'Share the makeup date' : 'Tell the team it’s rained out', rainMessage(g)); }));
  view.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', () => shareSheet('Remind the team', reminderMessage(st.games.find(x => x.id === b.dataset.remind)))));
  view.querySelectorAll('[data-unrain]').forEach(b => b.addEventListener('click', () => write(() => db.doc('games/' + b.dataset.unrain).update({ status: 'scheduled' }), 'Back on the schedule')));
  view.querySelectorAll('[data-makeup]').forEach(b => b.addEventListener('click', () => { gameForm(null, st.games.find(g => g.id === b.dataset.makeup)); document.getElementById('gameForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  view.querySelectorAll('.game [data-rsvp], .rsvp-list [data-rsvp]').forEach(b => b.addEventListener('click', () => setRsvp(b.dataset.g, b.dataset.p, b.dataset.v)));
  bindGameday();
  view.querySelectorAll('[data-findsub]').forEach(b => b.onclick = () => { F.gender = b.dataset.findsub; F.activeOnly = true; saveF(); subMode = 'find'; LS.set('submode', 'find'); location.hash = '#subs'; });
  const pn = document.getElementById('postNotice'); if (pn) pn.onclick = () => noticeForm();
  view.querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => write(() => platform.claimPlayer(b.dataset.me), 'Got it. You can answer for yourself now.')));
  view.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const el = document.getElementById('rs-' + b.dataset.open); el.hidden = !el.hidden; if (el.hidden) openLists.delete(b.dataset.open); else openLists.add(b.dataset.open); b.setAttribute('aria-expanded', !el.hidden); b.textContent = el.hidden ? 'Show everyone' : 'Hide list'; }));
  view.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { selGame = b.dataset.g; LS.set('game', selGame); location.hash = '#' + b.dataset.go; }));
  view.querySelectorAll('[data-delgame]').forEach(b => b.addEventListener('click', () => confirmInline(b, 'Delete this game?', () => write(() => db.doc('games/' + b.dataset.delgame).delete(), 'Game deleted'))));
  view.querySelectorAll('[data-editgame]').forEach(b => b.addEventListener('click', () => gameForm(st.games.find(g => g.id === b.dataset.editgame))));
  const ng = document.getElementById('notMe'); if (ng) ng.addEventListener('click', () => confirmInline(ng, 'Unlink you from this name?', () => write(() => platform.unclaimPlayer(me), 'Unlinked'))); 
  const ag = document.getElementById('addGame'); if (ag) ag.addEventListener('click', () => gameForm(null));
}
function gameCard(g) {
  const d = fmtDate(g.date), counts = { in: 0, maybe: 0, out: 0 };
  st.players.forEach(p => { const s = rsvpOf(g.id, p.id); if (counts[s] !== undefined) counts[s]++; });
  const noReply = st.players.length - counts.in - counts.maybe - counts.out;
  const final = g.status === 'final', us = sum(g.us), them = sum(g.them), rain = g.status === 'rainout';
  if (rain) return rainCard(g, d);
  const wx = final ? null : gameWeather(g); g.wx = !!wx;
  const players = st.players.filter(p => p.id !== me);
  const meRow = me && st.players.find(p => p.id === me);
  return `<article class="panel game" aria-label="${esc(g.home ? 'Home' : 'Away')} game against ${esc(g.opp)} on ${esc(g.date)}">
    <div class="game-head">
      <div class="datebox" aria-hidden="true"><div class="m">${esc(d.m)}</div><div class="d">${esc(d.d)}</div><div class="w">${esc(d.w)}</div></div>
      <div class="grow" style="min-width:0">
        <div class="vs">${g.home ? 'vs' : '@'} ${esc(g.opp)}</div>
        <div class="muted small">${esc(fmtTime(g.time))}${g.field ? ' · ' + esc(g.field) : ''}${g.home ? ' · Home' : ' · Away'}</div>
        ${final ? `<div class="row" style="margin-top:6px"><span class="pill final">${us > them ? 'Won' : us < them ? 'Lost' : 'Tied'} ${us}-${them}</span></div>` : ''}
        ${g.makeupOf ? `<div class="muted small">Makeup for the rained-out game${(() => { const o = st.games.find(x => x.id === g.makeupOf); return o ? ' on ' + esc(fmtDate(o.date).m + ' ' + fmtDate(o.date).d) : ''; })()}</div>` : ''}
      </div>
    </div>
    ${wx ? `<div class="wx wx-${wx.level}" role="note"><span class="wx-icon" aria-hidden="true">${wx.icon}</span><span class="grow"><b>${esc(wx.temp)}°C</b> · ${esc(wx.text)}${wx.wind >= 30 ? ` · windy (${esc(wx.wind)} km/h)` : ''}</span>${st.canEdit && wx.level !== 'ok' ? `<button class="btn ghost small" type="button" data-rain="${esc(g.id)}">Rained out</button>` : ''}</div>` : ''}
    ${final ? '' : `<div class="count-pills" aria-label="Attendance">
      <span class="pill in">${counts.in} in</span><span class="pill maybe">${counts.maybe} maybe</span><span class="pill out">${counts.out} out</span>
      ${noReply ? `<span class="pill" style="border:1.5px solid var(--line)">${noReply} no reply</span>` : ''}
      ${(() => { const av = RULES().coed ? availabilityCheck(st.players.filter(p => rsvpOf(g.id, p.id) === 'in'), RULES()) : null;
        if (av) return `<span class="pill ${av.level === 'danger' ? 'out' : 'warn'}">${esc(av.text)}</span>${st.canEdit && av.need ? `<button class="btn ghost small" type="button" data-findsub="${esc(av.need)}">Find a ${av.need === 'w' ? 'woman' : 'man'} sub</button>` : ''}`;
        return !RULES().coed && counts.in < RULES().field ? `<span class="pill warn">Need ${RULES().field - counts.in} more for a full field</span>` : ''; })()}
    </div>
    ${meRow ? `<div class="rsvp-row me"><span class="who">${esc(meRow.name)}</span>${rsvpSeg(g.id, meRow.id)}</div>` : ''}
    <div class="row"><button class="btn ghost small" type="button" data-open="${esc(g.id)}" aria-expanded="${openLists.has(g.id)}" aria-controls="rs-${esc(g.id)}">${openLists.has(g.id) ? 'Hide list' : 'Show everyone'}</button></div>
    <div class="rsvp-list" id="rs-${esc(g.id)}"${openLists.has(g.id) ? '' : ' hidden'}>
      ${players.map(p => `<div class="rsvp-row${p.id === me ? ' me' : ''}"><span class="who">${esc(p.name)} <span class="muted">${esc(pNum(p.id))}</span></span>${rsvpSeg(g.id, p.id)}${!me && !p.uid ? `<button class="btn ghost small" type="button" data-me="${esc(p.id)}">This is me</button>` : ''}</div>`).join('') || '<p class="muted">Add players on the Team tab first.</p>'}
    </div>`}
    <div class="row">
      ${!final && nextGame() && nextGame().id === g.id && g.date !== today() ? `<a class="btn ghost small" href="#gameday">Gameday view</a>` : ''}
      <button class="btn ghost small" type="button" data-go="lineup" data-g="${esc(g.id)}">Lineup</button>
      <button class="btn ghost small" type="button" data-go="score" data-g="${esc(g.id)}">${final ? 'Box score' : 'Keep score'}</button>
      ${st.canEdit && !final ? `<button class="btn ghost small" type="button" data-remind="${esc(g.id)}">Remind team</button>` : ''}
      ${st.canEdit ? `<button class="btn ghost small" type="button" data-editgame="${esc(g.id)}">Edit</button>${!final && !(wx && wx.level !== 'ok') ? `<button class="btn ghost small" type="button" data-rain="${esc(g.id)}">Rained out</button>` : ''}<button class="btn danger small" type="button" data-delgame="${esc(g.id)}">Delete</button>` : ''}
    </div>
  </article>`;
}
/* send a ready-made message to the team's group chat: WhatsApp, text message, the phone's share menu, or copy */
function shareSheet(title, text) {
  const link = location.origin + location.pathname;
  let d = document.getElementById('share'); if (d) d.remove();
  d = document.createElement('dialog'); d.id = 'share'; d.className = 'menu'; d.setAttribute('aria-labelledby', 'shareT'); document.body.append(d);
  d.innerHTML = `<div class="mhead"><h2 id="shareT">${esc(title)}</h2><button class="btn ghost small" type="button" data-x>Close</button></div>
  <section><label for="shareTxt" class="small">Message <span class="muted">(edit it if you like)</span><textarea id="shareTxt" rows="6">${esc(text + '\n' + link)}</textarea></label>
  <div class="share-grid">
    ${navigator.share ? '<button class="btn cta" type="button" data-native>Share…</button>' : ''}
    <button class="btn" type="button" data-wa>WhatsApp</button>
    <button class="btn ghost" type="button" data-sms>Text message</button>
    <button class="btn ghost" type="button" data-copy>Copy</button>
  </div>
  <p class="muted small" style="margin:10px 0 0">Opens your own WhatsApp or messages, so it goes to your team group from you.</p></section>`;
  d.showModal();
  const msg = () => d.querySelector('#shareTxt').value;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.querySelector('[data-wa]').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(msg()), '_blank', 'noopener');
  d.querySelector('[data-sms]').onclick = () => { location.href = 'sms:?&body=' + encodeURIComponent(msg()); };
  d.querySelector('[data-copy]').onclick = async e => { try { await navigator.clipboard.writeText(msg()); e.target.textContent = 'Copied'; } catch (_) { d.querySelector('#shareTxt').select(); } };
  const n = d.querySelector('[data-native]'); if (n) n.onclick = async () => { try { await navigator.share({ text: msg() }); d.close(); } catch (_) {} };
}
const gameWhen = g => `${fmtDate(g.date).w} ${fmtDate(g.date).m} ${fmtDate(g.date).d}${g.time ? ', ' + fmtTime(g.time) : ''}`;
function rainMessage(g, newMakeup = null) {
  const mk = newMakeup || (g.makeup && st.games.find(x => x.id === g.makeup)), team = st.team?.name || 'Team';
  return `🌧️ ${team}: ${gameWhen(g)} ${g.home ? 'vs' : '@'} ${g.opp}${g.field ? ' (' + g.field + ')' : ''} is RAINED OUT.` +
    (mk ? `\n📅 Makeup: ${gameWhen(mk)}${mk.field ? ' at ' + mk.field : ''}. Tap In or Out in Dugout:` : `\nMakeup date to come. Details in Dugout:`);
}
function reminderMessage(g) {
  const ins = st.players.filter(p => rsvpOf(g.id, p.id) === 'in').length, waiting = st.players.filter(p => !rsvpOf(g.id, p.id));
  return `⚾ ${st.team?.name || 'Team'}: ${gameWhen(g)} ${g.home ? 'vs' : '@'} ${g.opp}${g.field ? ' at ' + g.field : ''}.\n` +
    `${ins} in so far${ins < 10 ? `, need ${10 - ins} more` : ''}.` + (waiting.length ? `\nStill need answers from: ${waiting.map(p => p.name).join(', ')}.` : '') + `\nTap In or Out in Dugout:`;
}
function rainCard(g, d) {
  const mk = g.makeup && st.games.find(x => x.id === g.makeup);
  return `<article class="panel game rained" aria-label="Rained-out game against ${esc(g.opp)} on ${esc(g.date)}">
    <div class="game-head">
      <div class="datebox" aria-hidden="true"><div class="m">${esc(d.m)}</div><div class="d">${esc(d.d)}</div><div class="w">${esc(d.w)}</div></div>
      <div class="grow" style="min-width:0">
        <div class="vs">${g.home ? 'vs' : '@'} ${esc(g.opp)}</div>
        <div class="muted small">${esc(fmtTime(g.time))}${g.field ? ' · ' + esc(g.field) : ''}</div>
        <div class="row" style="margin-top:6px"><span class="pill rain">🌧️ Rained out</span>${mk ? `<span class="pill in">Makeup ${esc(fmtDate(mk.date).w)} ${esc(fmtDate(mk.date).m)} ${esc(fmtDate(mk.date).d)}${mk.time ? ', ' + esc(fmtTime(mk.time)) : ''}</span>` : '<span class="pill warn">Needs a makeup</span>'}</div>
      </div>
    </div>
    ${st.canEdit ? `<div class="row"><button class="btn cta small" type="button" data-tell="${esc(g.id)}">Tell the team</button>${mk ? '' : `<button class="btn small" type="button" data-makeup="${esc(g.id)}">Schedule makeup</button>`}<button class="btn ghost small" type="button" data-unrain="${esc(g.id)}">Not rained out</button><button class="btn danger small" type="button" data-delgame="${esc(g.id)}">Delete</button></div>` : ''}
  </article>`;
}
/* where a game is played, for the forecast: its diamond if one was picked, otherwise the team's home area */
function gameWeather(g) {
  const lat = g.lat ?? st.team?.lat, lng = g.lng ?? st.team?.lng;
  if (lat == null || lng == null) return null;
  const series = forecast(lat, lng, () => render());
  return series ? outlook(series, g.date, g.time) : null;
}
function rsvpSeg(gid, pid) {
  const s = rsvpOf(gid, pid), name = pName(pid);
  if (!st.canEdit && pid !== me) return s ? `<span class="pill ${s === 'in' ? 'in' : s === 'out' ? 'out' : 'maybe'}">${s === 'in' ? 'In' : s === 'out' ? 'Out' : 'Maybe'}</span>` : '<span class="muted small">No reply</span>';
  return `<div class="seg" role="group" aria-label="${esc(name)} attending?">${[['in', 'In'], ['maybe', 'Maybe'], ['out', 'Out']].map(([v, l]) => `<button type="button" data-rsvp data-g="${esc(gid)}" data-p="${esc(pid)}" data-v="${esc(v)}" aria-pressed="${esc(s === v)}">${l}</button>`).join('')}</div>`;
}
async function setRsvp(gid, pid, v) {
  const key = gid + '_' + pid, prev = st.rsvp[key];
  st.rsvp[key] = { g: gid, p: pid, s: v }; render(); // show it right away
  const ok = await write(() => db.doc('rsvp/' + key).set({ g: gid, p: pid, s: v, at: Date.now() }), `${pName(pid)}: ${v === 'in' ? 'in' : v === 'out' ? 'out' : 'maybe'}`);
  if (!ok) { if (prev) st.rsvp[key] = prev; else delete st.rsvp[key]; render(); }
}
function gameForm(g, makeupOf = null) {
  const box = document.getElementById('gameForm'), src = g || makeupOf;
  const nearby = [...st.diamonds].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  box.innerHTML = `<form class="panel" id="gf" style="margin-top:12px">
    <h3>${g ? 'Edit game' : makeupOf ? `Makeup for ${esc(makeupOf.opp)}` : 'New game'}</h3>
    <div class="form-grid">
      <label for="gOpp">Opponent<input id="gOpp" type="text" required maxlength="40" value="${esc(src?.opp || '')}"></label>
      <label for="gDate">Date<input id="gDate" type="date" required value="${esc(g?.date || today())}"></label>
      <label for="gTime">Start time<input id="gTime" type="time" value="${esc(src?.time || '18:30')}"></label>
      <label for="gField">Field<input id="gField" type="text" maxlength="40" value="${esc(src?.field || '')}" placeholder="e.g. Diamond 3"></label>
      <label for="gHome">Home or away<select id="gHome"><option value="1"${src?.home !== false ? ' selected' : ''}>Home</option><option value="0"${src?.home === false ? ' selected' : ''}>Away</option></select></label>
      <label for="gDia">Park, for the forecast<select id="gDia"><option value="">${st.team?.lat != null ? `Team home area${st.team.place ? ' (' + esc(st.team.place) + ')' : ''}` : 'Not set'}</option>${nearby.map(d => `<option value="${esc(d.id)}"${src?.diamond === d.id ? ' selected' : ''}>${esc(d.name)}${d.label ? ' · ' + esc(d.label) : ''}</option>`).join('')}</select></label>
    </div>
    <div class="row"><button class="btn" type="submit">${g ? 'Save game' : 'Add game'}</button><button class="btn ghost" type="button" id="gCancel">Cancel</button></div>
  </form>`;
  document.getElementById('gOpp').focus();
  document.getElementById('gCancel').onclick = () => box.innerHTML = '';
  document.getElementById('gf').addEventListener('submit', async e => {
    e.preventDefault();
    const dia = st.diamonds.find(d => d.id === document.getElementById('gDia').value);
    const data = { opp: document.getElementById('gOpp').value.trim(), date: document.getElementById('gDate').value, time: document.getElementById('gTime').value, field: document.getElementById('gField').value.trim(), home: document.getElementById('gHome').value === '1',
      diamond: dia ? dia.id : null, lat: dia ? dia.lat : null, lng: dia ? dia.lng : null };
    if (!data.opp || !data.date) return;
    if (g) await write(() => db.doc('games/' + g.id).update(data), 'Game saved');
    else if (makeupOf) { const id = uid(); if (await write(async () => { await db.doc('games/' + id).set({ ...data, makeupOf: makeupOf.id, status: 'scheduled', us: [], them: [], inning: 1, bi: 0 }); await db.doc('games/' + makeupOf.id).update({ makeup: id }); }, 'Makeup game scheduled')) shareSheet('Share the makeup date', rainMessage(makeupOf, data)); }
    else await write(() => db.doc('games/' + uid()).set({ ...data, status: 'scheduled', us: [], them: [], inning: 1, bi: 0 }), 'Game added');
    box.innerHTML = '';
  });
}

/* --- Lineup: batting order and fielding by inning, with fair rotation --- */
function buildLineup(game) {
  const games = sortedGames(), idx = Math.max(0, games.findIndex(x => x.id === game.id));
  let avail = st.players.filter(p => rsvpOf(game.id, p.id) === 'in');
  if (avail.length < RULES().field) avail = avail.concat(st.players.filter(p => rsvpOf(game.id, p.id) === 'maybe'));
  if (!avail.length) avail = st.players.filter(p => rsvpOf(game.id, p.id) !== 'out');
  return buildLineupFor(avail, RULES(), { innings: (st.team && st.team.innings) || 7, gameIndex: idx });
}
function renderLineup() {
  const gid = defaultGame(), g = st.games.find(x => x.id === gid), rules = RULES(), POSL = rules.pos;
  if (!g) { view.innerHTML = `<h2>Lineup</h2><div class="panel empty">Add a game on the Games tab, then build its lineup here.</div>`; return; }
  const L = g.lineup, innings = L ? L.field.length : (st.team?.innings || 7), people = lineupPlayers(L);
  const problems = L ? lineupProblems(L, st.players, rules) : [];
  view.innerHTML = `<h2>Lineup</h2>
  ${gamePicker(gid)}
  ${rules.coed ? `<p class="muted small" style="margin-top:-4px">Following <b>${esc(rules.short)}</b> rules. <a href="#roster" data-rulesjump>See rules</a></p>` : ''}
  ${!L ? `<div class="panel"><p>No lineup yet for this game.</p>${st.canEdit ? `<p class="muted small">Build one from everyone who said <b>In</b>. Batting order moves down a spot each game, bench innings are shared out evenly, and players get their listed positions first.${rules.coed ? ` It follows your league’s co-ed rules for the batting order and who’s in the field.` : ''}</p><div class="row"><button class="btn cta" id="build" type="button">Build fair lineup</button></div>` : '<p class="muted small">The captain will post it before the game.</p>'}</div>` : `
  <div class="row"><div class="grow muted small">${people.length} players · ${innings} innings${people.length > POSL.length ? ` · each player sits about ${Math.round((people.length - POSL.length) * innings / people.length * 10) / 10} innings` : ''}</div>
  ${st.canEdit ? `<button class="btn ghost small" id="rebuild" type="button">Rebuild</button><button class="btn danger small" id="clearL" type="button">Clear</button>` : ''}</div>
  <div class="row" style="margin-top:6px"><button class="btn cta small" id="shareLu" type="button">Send to team chat</button><button class="btn ghost small" id="imgLu" type="button">Save as image</button></div>
  ${problems.length ? `<div class="notice small" style="margin-top:10px" role="alert"><b>Check against ${esc(rules.short)} rules:</b><ul style="margin:4px 0 0;padding-left:18px">${problems.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : rules.coed ? `<p class="small" style="color:var(--in);margin:8px 0 0">✓ Meets ${esc(rules.short)} batting-order and field rules.</p>` : ''}
  ${rules.offensePitcher ? `<label for="ourP" style="margin-top:10px">Pitches for us when we bat<select id="ourP" ${st.canEdit ? '' : 'disabled'}><option value="">Not picked</option>${people.map(id => `<option value="${esc(id)}"${L.pitcher === id ? ' selected' : ''}>${esc(pName(id))}</option>`).join('')}</select></label>` : ''}
  <h3 style="margin-top:8px">Batting order</h3>
  <ol class="panel" style="list-style:none;padding:8px 16px;margin:0;gap:0">${L.order.map((id, i) => `<li class="row" style="padding:6px 0;border-top:${i ? '1px solid var(--line)' : '0'}"><span class="order-num">${i + 1}</span><span class="grow"><b>${esc(slotLabel(L, id))}</b> ${id[0] === '~' ? '' : `<span class="muted">${esc(pNum(id))}</span>`}${rules.coed && id[0] !== '~' && (st.players.find(p => p.id === id) || {}).g ? ` <span class="gtag">${esc((st.players.find(p => p.id === id) || {}).g.toUpperCase())}</span>` : ''}</span>${st.canEdit ? `<button class="iconbtn" type="button" data-up="${esc(i)}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button class="iconbtn" type="button" data-down="${esc(i)}" aria-label="Move down" ${i < L.order.length - 1 ? '' : 'disabled'}>↓</button>` : ''}</li>`).join('')}</ol>
  <h3 style="margin-top:18px">Positions by inning</h3>
  <p class="muted small" style="margin:4px 0 8px">${st.canEdit ? 'Pick from a box to swap someone in; the player who had that spot moves to where they were.' : 'BN means on the bench that inning.'}${rules.id === 'ossc' ? ' ROV is the rover.' : ''}</p>
  <div class="lineup-scroll"><table>
    <thead><tr><th scope="col">Player</th>${L.field.map((_, i) => `<th scope="col" class="num">Inn ${i + 1}</th>`).join('')}</tr></thead>
    <tbody>${people.map(id => `<tr><th scope="row" style="position:static;background:transparent;color:var(--ink);font:700 15px var(--font-body);text-transform:none;letter-spacing:0">${esc(pName(id))}</th>${L.field.map((inn, i) => { const pos = POSL.find(k => inn[k] === id) || 'BN'; return `<td class="pos${pos === 'BN' ? ' bench' : ''}">${st.canEdit ? `<select aria-label="${esc(pName(id))}, inning ${i + 1}" data-cell="${esc(i)}" data-p="${esc(id)}" style="min-height:40px;width:auto;padding:4px 6px">${['BN', ...POSL].map(k => `<option${k === pos ? ' selected' : ''}>${k}</option>`).join('')}</select>` : pos}</td>`; }).join('')}</tr>`).join('')}</tbody>
  </table></div>
  ${L.field.some(inn => POSL.some(k => !inn[k])) ? `<p class="notice small" style="margin-top:10px">Some innings have open positions${rules.id === 'ossc' ? '. Short-handed, OSSC plays one fewer per missing player' : `. With fewer than ${POSL.length} players, play three outfielders`}.</p>` : ''}`}`;
  bindPicker();
  const rj = view.querySelector('[data-rulesjump]'); if (rj) rj.onclick = () => { openRules = true; };
  const op = document.getElementById('ourP'); if (op) op.onchange = () => write(() => db.doc('games/' + g.id).update({ lineup: { ...L, pitcher: op.value || null } }), 'Pitcher set');
  const sl = document.getElementById('shareLu'); if (sl) sl.onclick = () => shareSheet('Send the lineup to your team', lineupText(g));
  const il = document.getElementById('imgLu'); if (il) il.onclick = () => saveLineupImage(g).catch(() => toast('Couldn’t make the image'));
  const b = document.getElementById('build') || document.getElementById('rebuild');
  if (b) b.addEventListener('click', () => { const nl = buildLineup(g); if (!nl) { toast('Nobody is marked In or Maybe yet'); return; } write(() => db.doc('games/' + g.id).update({ lineup: nl }), 'Lineup built'); });
  const c = document.getElementById('clearL'); if (c) c.addEventListener('click', () => confirmInline(c, 'Clear this lineup?', () => write(() => db.doc('games/' + g.id).update({ lineup: null }), 'Lineup cleared')));
  view.querySelectorAll('[data-up],[data-down]').forEach(btn => btn.addEventListener('click', () => {
    const i = +(btn.dataset.up ?? btn.dataset.down), j = btn.dataset.up !== undefined ? i - 1 : i + 1, o = [...L.order];[o[i], o[j]] = [o[j], o[i]];
    write(() => db.doc('games/' + g.id).update({ lineup: { ...L, order: o } }));
  }));
  view.querySelectorAll('select[data-cell]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.cell, id = sel.dataset.p, field = L.field.map(x => ({ ...x, bench: [...(x.bench || [])] })), inn = field[i];
    const was = POSL.find(k => inn[k] === id) || 'BN', want = sel.value, other = want === 'BN' ? null : inn[want];
    if (was !== 'BN') delete inn[was]; else inn.bench = inn.bench.filter(x => x !== id);
    if (want === 'BN') inn.bench.push(id); else inn[want] = id;
    if (other) { if (was === 'BN') inn.bench.push(other); else inn[was] = other; } // swap
    write(() => db.doc('games/' + g.id).update({ lineup: { ...L, field } }));
  }));
}
function gamePicker(gid) {
  const g = sortedGames().filter(x => x.status !== 'rainout');  // rained-out games can't be scored or given a lineup
  return `<label for="gamePick" class="sr">Game</label><select id="gamePick" style="margin-bottom:12px">${g.map(x => `<option value="${esc(x.id)}"${x.id === gid ? ' selected' : ''}>${esc(fmtDate(x.date).w)} ${esc(fmtDate(x.date).m)} ${esc(fmtDate(x.date).d)} · ${x.home ? 'vs' : '@'} ${esc(x.opp)}${x.status === 'final' ? ' (final)' : ''}</option>`).join('')}</select>`;
}
function bindPicker() { const s = document.getElementById('gamePick'); if (s) s.addEventListener('change', () => { selGame = s.value; LS.set('game', selGame); render(); }); }

/* --- Scorekeeper --- */
let rbi = 0, scorers = [];   // runs on the play being entered, and which runners crossed the plate
function renderScore() {
  const gid = defaultGame(), g = st.games.find(x => x.id === gid);
  if (!g) { view.innerHTML = `<h2>Score</h2><div class="panel empty">Add a game first.</div>`; return; }
  const innings = Math.max((st.team?.innings || 7), (g.us || []).length, (g.them || []).length, g.inning || 1);
  const abs = st.ab.filter(a => a.g === g.id).sort((a, b) => a.at - b.at);
  const order = g.lineup ? g.lineup.order : st.players.filter(p => rsvpOf(g.id, p.id) === 'in').map(p => p.id);
  const batter = order.length ? batterAt(g.lineup, g.bi || 0, order) : null, onDeck = order.length > 1 ? batterAt(g.lineup, (g.bi || 0) + 1, order) : null;
  const final = g.status === 'final', keep = st.canEdit && !final;
  const cell = (arr, i) => arr && arr[i] != null ? arr[i] : '';
  const nowInn = g.inning || 1, innAbs = abs.filter(a => a.inn === nowInn);
  const outs = innAbs.filter(a => ['OUT', 'K', 'SF'].includes(a.r)).length;
  // who could score: anyone who reached base this inning and hasn't scored yet, newest first, then the batter
  const scoredThisInn = new Set(innAbs.flatMap(a => a.scored || []));
  const onBase = [...new Set(innAbs.filter(a => ['1B', '2B', '3B', 'BB', 'E'].includes(a.r)).map(a => a.p).reverse())].filter(p => !scoredThisInn.has(p));
  const box = boxScore(abs);
  // league-rule helpers: run limit, mercy, home-run limit, game clock, walk rule
  const rules = RULES(), gOf = id => (st.players.find(p => p.id === id) || {}).g, nInn = st.team?.innings || 7;
  const usInn = +((g.us || [])[nowInn - 1] || 0), lastInn = nowInn >= nInn, cap = rules.runCap && !lastInn ? rules.runCap : 0;
  const capHit = cap && usInn >= cap;
  const lead = sum(g.us) - sum(g.them), mercy = rules.mercy && nowInn > rules.mercy.after && Math.abs(lead) >= rules.mercy.lead;
  const themHR = g.themHR || { m: 0, w: 0, t: 0 }, ourHR = abs.filter(a => a.r === 'HR');
  const hrNote = (() => {
    if (!rules.hr || !batter) return '';
    if (rules.hr.byGender) { const bg = gOf(batter); if (bg !== 'm' && bg !== 'w') return ''; const us = ourHR.filter(a => gOf(a.p) === bg).length, them = themHR[bg] || 0;
      return us - them >= rules.hr.plus ? `${bg === 'w' ? 'Women' : 'Men'}’s home runs are ${us}–${them}: one more by ${pName(batter)} is over the +${rules.hr.plus} limit${rules.hr.fencedOnly ? ' (fenced fields)' : ''}. Over the limit: ${rules.hr.over}.` : ''; }
    const us = ourHR.length, them = themHR.t || 0;
    return us - them >= rules.hr.plus ? `Home runs are ${us}–${them}: one more is over the +${rules.hr.plus} limit and counts as ${rules.hr.over}.` : '';
  })();
  const clock = gameClock(g.date, g.time, rules), hhmm = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const twoBases = rules.walkOnDeck && onDeck && gOf(onDeck) === 'w';
  view.innerHTML = `<h2>${final ? 'Box score' : 'Keep score'}</h2>
  ${gamePicker(gid)}
  <div class="panel">
    <div class="scoreboard"><span class="vs">${esc(st.team?.name || 'Us')}</span><span class="big" aria-label="Our runs">${sum(g.us)}</span><span class="vs">${esc(g.opp)}</span><span class="big" aria-label="Their runs">${sum(g.them)}</span></div>
    <div class="lineup-scroll"><table class="linescore"><thead><tr><th scope="col">Team</th>${Array.from({ length: innings }, (_, i) => `<th scope="col"${!final && i + 1 === g.inning ? ' style="color:var(--gold)"' : ''}>${i + 1}</th>`).join('')}<th scope="col">R</th></tr></thead>
    <tbody><tr><th scope="row">Us</th>${Array.from({ length: innings }, (_, i) => `<td>${cell(g.us, i)}</td>`).join('')}<td><b>${sum(g.us)}</b></td></tr>
    <tr><th scope="row">Them</th>${Array.from({ length: innings }, (_, i) => `<td>${cell(g.them, i)}</td>`).join('')}<td><b>${sum(g.them)}</b></td></tr></tbody></table></div>
  </div>
  ${box.length ? `<h3 style="margin-top:16px">${esc(st.team?.name || 'Our')} box score</h3>
  <div class="lineup-scroll"><table><thead><tr><th scope="col">Batter</th>${['AB', 'R', 'H', 'RBI', 'BB', 'HR'].map(k => `<th scope="col" class="num">${k}</th>`).join('')}</tr></thead>
  <tbody>${box.map(r => `<tr><td><b>${esc(pName(r.p))}</b></td>${['AB', 'R', 'H', 'RBI', 'BB', 'HR'].map(k => `<td class="num">${r[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
  ${keep ? `
  <div class="panel" style="margin-top:12px">
    <div class="row"><div class="grow"><div class="muted small">Inning ${esc(nowInn)} · <span class="outs" aria-label="${outs} out${outs === 1 ? '' : 's'}">${[0, 1, 2].map(i => `<span class="${i < outs ? 'on' : ''}"></span>`).join('')}</span> ${Math.min(outs, 3)} out${outs === 1 ? '' : 's'} · now batting</div><div class="atbat">${batter ? esc(pName(batter)) : 'No lineup'}</div>${onDeck ? `<div class="muted small">On deck: ${esc(pName(onDeck))}</div>` : ''}</div></div>
    ${batter ? `<div class="row"><span class="grow small"><b>Runs scored on this play</b></span><div class="stepper"><button class="iconbtn" type="button" id="rbiM" aria-label="One fewer run">−</button><output id="rbiV" aria-live="polite">${rbi}</output><button class="iconbtn" type="button" id="rbiP" aria-label="One more run">+</button></div></div>
    <div id="scorers"></div>
    ${rules.coed || rules.runCap ? `<div class="rule-notes small">
      ${clock ? `<span class="${clock.pastLastNew ? 'hot' : ''}">⏱ ${clock.pastLastNew ? `<b>Past ${esc(hhmm(clock.lastNew))}: don’t start a new inning</b>` : `No new inning after ${esc(hhmm(clock.lastNew))}`} · ends ${esc(hhmm(clock.end))}</span>` : ''}
      ${cap ? `<span>Run limit ${cap} an inning: ${usInn}/${cap} this inning</span>` : rules.runCap ? '<span>Last inning: no run limit</span>' : ''}
      ${rules.pitches ? `<span>${rules.pitches} pitches per batter</span>` : ''}
      ${rules.offensePitcher && g.lineup && g.lineup.pitcher ? `<span>Pitching for us: <b>${esc(pName(g.lineup.pitcher))}</b></span>` : ''}
      ${rules.hr ? `<span>HR ${rules.hr.byGender ? `men ${ourHR.filter(a => gOf(a.p) === 'm').length}–${themHR.m || 0}, women ${ourHR.filter(a => gOf(a.p) === 'w').length}–${themHR.w || 0}` : `${ourHR.length}–${themHR.t || 0}`} (+${rules.hr.plus} rule)</span>` : ''}
    </div>` : ''}
    ${capHit ? `<p class="notice small" style="margin:8px 0" role="alert"><b>${cap}-run limit reached.</b> The side is retired: tap <b>Next inning</b>.</p>` : ''}
    ${mercy ? `<p class="notice small" style="margin:8px 0" role="alert"><b>Mercy rule:</b> a ${rules.mercy.lead}-run lead after the ${ordinal(rules.mercy.after)}${rules.mercy.optional ? '. The losing team can call the game or keep playing' : '. The game is over'}.</p>` : ''}
    ${hrNote ? `<p class="notice small" style="margin:8px 0">${esc(hrNote)}</p>` : ''}
    ${twoBases ? `<p class="muted small" style="margin:6px 0">Woman on deck: a walk is <b>2 bases</b> and she must bat.</p>` : ''}
    ${outs >= 3 ? `<p class="notice small" style="margin:8px 0">Three outs. Tap <b>Next inning</b> when the side is retired.</p>` : ''}
    <div class="result-grid">${RESULTS.map(r => `<button type="button" class="${esc(r.cls || '')}" data-res="${esc(r.k)}">${r.k === 'BB' && twoBases ? 'Walk (2 bases)' : r.label}</button>`).join('')}</div>` : `<p class="muted">Build a lineup first, or mark players In on the Games tab.</p>`}
    <div class="row">
      <button class="btn ghost small" type="button" id="themM" aria-label="Take a run off their score this inning">Them −1</button>
      <button class="btn ghost small" type="button" id="themP">Them +1 run</button>
      <button class="btn ${outs >= 3 || capHit ? 'cta' : 'ghost'} small" type="button" id="nextInn">Next inning</button>
      ${rules.hr ? (rules.hr.byGender ? `<button class="btn ghost small" type="button" data-themhr="m">Their HR (man)</button><button class="btn ghost small" type="button" data-themhr="w">Their HR (woman)</button>` : `<button class="btn ghost small" type="button" data-themhr="t">Their HR</button>`) : ''}
      <button class="btn ghost small" type="button" id="undo" ${abs.length ? '' : 'disabled'}>Undo last at-bat</button>
      <button class="btn small" type="button" id="finish">Final</button>
    </div>
  </div>` : final && st.canEdit ? `<div class="row" style="margin-top:12px"><button class="btn ghost small" id="reopen" type="button">Reopen game</button></div>` : ''}
  <h3 style="margin-top:18px">At-bats</h3>
  ${abs.length ? `<div class="lineup-scroll"><table><thead><tr><th scope="col">Inn</th><th scope="col">Batter</th><th scope="col">Result</th><th scope="col" class="num">Runs in</th></tr></thead><tbody>${abs.slice().reverse().map(a => `<tr><td>${a.inn}</td><td>${esc(pName(a.p))}</td><td>${esc((RESULTS.find(r => r.k === a.r) || {}).label || a.r)}</td><td class="num">${a.rbi || ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">No at-bats recorded for this game.</p>`}`;
  bindPicker();
  if (!keep) { const ro = document.getElementById('reopen'); if (ro) ro.onclick = () => write(() => db.doc('games/' + g.id).update({ status: 'live' }), 'Game reopened'); return; }
  const inn = (g.inning || 1) - 1, setArr = (arr, d) => { const a = [...(arr || [])]; while (a.length <= inn) a.push(0); a[inn] = Math.max(0, (+a[inn] || 0) + d); return a; };
  // pick which runners crossed the plate (as many as runs on the play)
  const drawScorers = () => {
    const box = document.getElementById('scorers'); if (!box) return;
    scorers = scorers.filter(p => onBase.includes(p) || p === batter).slice(0, rbi);
    if (!rbi) { box.innerHTML = ''; return; }
    const who = [...onBase, ...(batter && !onBase.includes(batter) ? [batter] : [])];
    box.innerHTML = `<fieldset class="scorers"><legend class="small"><b>Who scored?</b> <span class="muted">(pick ${rbi}, or skip)</span></legend><div class="row">${who.map(p => `<button type="button" class="chip-btn" data-scorer="${esc(p)}" aria-pressed="${scorers.includes(p)}">${esc(pName(p))}${p === batter ? ' (batter)' : ''}</button>`).join('') || '<span class="muted small">No one on base yet this inning.</span>'}</div></fieldset>`;
    box.querySelectorAll('[data-scorer]').forEach(b => b.onclick = () => { const p = b.dataset.scorer; scorers = scorers.includes(p) ? scorers.filter(x => x !== p) : scorers.length < rbi ? [...scorers, p] : [...scorers.slice(1), p]; drawScorers(); });
  };
  view.querySelectorAll('[data-themhr]').forEach(b => b.onclick = () => { const k = b.dataset.themhr, t = { m: 0, w: 0, t: 0, ...(g.themHR || {}) }; t[k]++; if (k !== 't') t.t++; write(() => db.doc('games/' + g.id).update({ themHR: t }), 'Their home run counted'); });
  const rb = v => { rbi = Math.max(0, Math.min(cap ? Math.max(0, cap - usInn) : 4, rbi + v)); document.getElementById('rbiV').textContent = rbi; drawScorers(); };
  drawScorers();
  const m = document.getElementById('rbiM'); if (m) { m.onclick = () => rb(-1); document.getElementById('rbiP').onclick = () => rb(1); }
  view.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', async () => {
    const r = b.dataset.res, runs = r === 'HR' ? Math.max(1, rbi) : rbi;
    let scored = scorers.slice(0, runs);
    if (r === 'HR' && !scored.includes(batter)) scored = [...scored.slice(0, runs - 1), batter];   // the batter always scores on a homer
    const ok = await write(async () => {
      await db.doc('ab/' + uid()).set({ g: g.id, p: batter, r, rbi: r === 'E' ? 0 : runs, runs, scored, inn: g.inning || 1, at: Date.now() });
      await db.doc('games/' + g.id).update({ bi: (g.bi || 0) + 1, us: setArr(g.us, runs), status: 'live' });
    }, `${pName(batter)}: ${b.textContent}${runs ? `, ${runs} run${runs > 1 ? 's' : ''}` : ''}`);
    if (ok) { rbi = 0; scorers = []; }
  }));
  document.getElementById('themP').onclick = () => write(() => db.doc('games/' + g.id).update({ them: setArr(g.them, 1), status: 'live' }));
  document.getElementById('themM').onclick = () => write(() => db.doc('games/' + g.id).update({ them: setArr(g.them, -1) }));
  document.getElementById('nextInn').onclick = () => write(() => db.doc('games/' + g.id).update({ inning: (g.inning || 1) + 1, us: setArr(g.us, 0), them: setArr(g.them, 0) }), `Inning ${(g.inning || 1) + 1}`);
  document.getElementById('undo').onclick = () => { const last = abs[abs.length - 1]; if (!last) return;
    const a = [...(g.us || [])]; a[last.inn - 1] = Math.max(0, (+a[last.inn - 1] || 0) - (last.runs || 0));
    write(async () => { await db.doc('ab/' + last.id).delete(); await db.doc('games/' + g.id).update({ bi: Math.max(0, (g.bi || 0) - 1), us: a }); }, 'Last at-bat removed'); };
  const fin = document.getElementById('finish'); fin.onclick = () => confirmInline(fin, `Final: ${sum(g.us)}-${sum(g.them)}?`, () => write(() => db.doc('games/' + g.id).update({ status: 'final' }), 'Game final'));
}

/* --- Stats --- */
let statSort = LS.get('sort', 'AVG');
/* one game's batting lines, in the order people first batted */
function boxScore(abs) {
  const order = [...new Set(abs.map(a => a.p))];
  return order.map(p => {
    const a = abs.filter(x => x.p === p), c = k => a.filter(x => x.r === k).length;
    return { p, AB: a.length - c('BB') - c('SF'), R: abs.reduce((s, x) => s + ((x.scored || []).includes(p) ? 1 : 0), 0), H: c('1B') + c('2B') + c('3B') + c('HR'), RBI: a.reduce((s, x) => s + (x.rbi || 0), 0), BB: c('BB'), HR: c('HR') };
  });
}
function statLine(pid) {
  const a = st.ab.filter(x => x.p === pid), c = k => a.filter(x => x.r === k).length;
  const H = c('1B') + c('2B') + c('3B') + c('HR'), BB = c('BB'), SF = c('SF'), AB = a.length - BB - SF, TB = c('1B') + 2 * c('2B') + 3 * c('3B') + 4 * c('HR');
  const G = new Set(a.map(x => x.g)).size, RBI = a.reduce((s, x) => s + (x.rbi || 0), 0);
  const Rn = st.ab.reduce((s, x) => s + ((x.scored || []).includes(pid) ? 1 : 0), 0);
  return { G, PA: a.length, AB, R: Rn, H, '2B': c('2B'), '3B': c('3B'), HR: c('HR'), BB, RBI, AVG: AB ? H / AB : 0, OBP: (AB + BB + SF) ? (H + BB) / (AB + BB + SF) : 0, SLG: AB ? TB / AB : 0 };
}
function renderStats() {
  const cols = ['G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'BB', 'RBI', 'AVG', 'OBP', 'SLG'];
  const rows = st.players.map(p => ({ p, s: statLine(p.id) })).filter(r => r.s.PA).sort((a, b) => b.s[statSort] - a.s[statSort]);
  const f3 = v => v.toFixed(3).replace(/^0/, '');
  view.innerHTML = `<h2>Season stats</h2>
  ${rows.length ? `<p class="muted small">Tap a column to sort. Built from every at-bat on the Score tab.</p>
  <div class="lineup-scroll"><table><thead><tr><th scope="col">Player</th>${cols.map(k => `<th scope="col" class="num"><button type="button" data-sort="${esc(k)}" style="all:unset;cursor:pointer;${k === statSort ? 'color:var(--grass)' : ''}" aria-pressed="${esc(k === statSort)}">${k}</button></th>`).join('')}</tr></thead>
  <tbody>${rows.map(({ p, s }) => `<tr><td><b>${esc(p.name)}</b></td>${cols.map(k => `<td class="num">${['AVG', 'OBP', 'SLG'].includes(k) ? f3(s[k]) : s[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<div class="panel empty">Stats show up here once you keep score for a game.</div>`}`;
  view.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { statSort = b.dataset.sort; LS.set('sort', statSort); render(); }));
}

/* --- Team: roster and fees --- */
function rulesCard() {
  const r = RULES();
  return `<details class="panel rules-card" id="rulesCard" style="margin-top:14px"><summary><b>League rules: ${esc(r.name)}</b></summary>
    <ul>${r.summary.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    ${r.source ? `<p class="muted small">Summarised from the league’s <a href="${esc(r.source)}" target="_blank" rel="noopener">official rules</a>. Rules change, so check there for the latest.${st.canEdit ? ' Captains can change the ruleset in Team settings below.' : ''}</p>` : st.canEdit ? '<p class="muted small">Pick OttawaSoftball or OSSC rules in Team settings below to have Dugout follow them.</p>' : ''}
  </details>`;
}
function renderRoster() {
  const fee = st.team?.fee || 0, paid = st.players.filter(p => p.paid).length;
  view.innerHTML = `<h2>Roster</h2>
  ${fee ? `<p class="muted small" style="margin-top:-4px">Season fee $${esc(fee)}: ${paid} of ${st.players.length} paid · $${esc(paid * fee)} collected, $${esc((st.players.length - paid) * fee)} to go</p>` : ''}
  ${st.canEdit ? `<form class="panel" id="pf">
    <h3 id="pfTitle">Add a player</h3>
    <div class="form-grid">
      <label for="pName">Name<input id="pName" type="text" required maxlength="40" placeholder="First name, last initial"></label>
      <label for="pNum">Jersey number<input id="pNum" type="text" inputmode="numeric" maxlength="3"></label>
      <label for="pG">Plays as${RULES().coed ? '' : ' <span class="muted small">(for co-ed rules)</span>'}<select id="pG"><option value="">Not set</option><option value="w">Woman</option><option value="m">Man</option><option value="x">Non-binary</option></select></label>
    </div>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:6px">Positions they like</legend>
      <div class="row">${RULES().prefPos.map(k => `<label style="display:flex;gap:6px;align-items:center;font-weight:400;min-height:44px;padding:0 6px;border:1.5px solid var(--line);border-radius:10px"><input type="checkbox" value="${esc(k)}" class="posbox"> ${k === 'P' && RULES().offensePitcher ? 'P (pitches for us)' : k}</label>`).join('')}</div>
    </fieldset>
    <input type="hidden" id="pId">
    <div class="row"><button class="btn" type="submit" id="pfSave">Add player</button><button class="btn ghost" type="button" id="pfCancel" hidden>Cancel</button></div>
  </form>` : ''}
  <div class="stack" style="margin-top:12px">
  ${(() => { const ng = nextGame(); if (!ng || !st.players.length) return ''; const c = { in: 0, maybe: 0, out: 0 }; st.players.forEach(p => { const v = rsvpOf(ng.id, p.id); if (c[v] !== undefined) c[v]++; });
    return `<div class="panel avail-head"><div class="grow"><b>Availability</b> for ${esc(gameWhen(ng))} ${ng.home ? 'vs' : '@'} ${esc(ng.opp)}<div class="muted small">${c.in} in · ${c.maybe} maybe · ${c.out} out · ${st.players.length - c.in - c.maybe - c.out} no reply. The lineup builder uses In first, then Maybe, and never Out.</div></div>${st.canEdit ? `<button class="btn ghost small" type="button" data-remind="${esc(ng.id)}">Remind team</button>` : ''}</div>`; })()}
  ${st.players.length ? st.players.map(p => `<div class="panel" style="padding:12px 16px"><div class="row">
      <div class="grow"><b>${esc(p.name)}</b> <span class="muted">${esc(pNum(p.id))}</span>${p.g ? ` <span class="gtag">${esc(GENDER[p.g] || '')}</span>` : RULES().coed && st.canEdit ? ' <span class="gtag warn">Set Man/Woman</span>' : ''}<div class="muted small">${(p.pos || []).map(k => POS_NAME[k] || k).join(', ') || 'Any position'}</div></div>
      ${fee ? (st.canEdit ? `<button class="chip-btn" type="button" data-paid="${esc(p.id)}" aria-pressed="${esc(!!p.paid)}">${p.paid ? 'Paid' : 'Not paid'}</button>` : `<span class="pill ${p.paid ? 'in' : 'out'}">${p.paid ? 'Paid' : 'Not paid'}</span>`) : ''}
      ${nextGame() ? rsvpSeg(nextGame().id, p.id) : ''}
      ${st.canEdit ? `<button class="btn ghost small" type="button" data-edit="${esc(p.id)}">Edit</button><button class="btn danger small" type="button" data-del="${esc(p.id)}">Remove</button>` : ''}
    </div></div>`).join('') : `<div class="panel empty">No players yet.${st.canEdit ? ' Add your first one above.' : ''}</div>`}
  </div>
  ${rulesCard()}
  ${st.canEdit ? `<h2>Team settings</h2>
  <form class="panel" id="tf">
    <div class="form-grid">
      <label for="tName">Team name<input id="tName" type="text" maxlength="40" value="${esc(st.team?.name)}"></label>
      <label for="tLeague">League<input id="tLeague" type="text" maxlength="60" value="${esc(st.team?.league)}"></label>
      <label for="tSeason">Season<input id="tSeason" type="text" maxlength="30" value="${esc(st.team?.season)}"></label>
      <label for="tFee">Player fee ($)<input id="tFee" type="number" min="0" value="${esc(st.team?.fee || 0)}"></label>
      <label for="tPlace">Home area, for game forecasts<input id="tPlace" type="text" maxlength="80" value="${esc(st.team?.place || '')}" placeholder="Postal code or neighbourhood"></label>
      <label for="tInn">Innings per game<input id="tInn" type="number" min="3" max="9" value="${esc(st.team?.innings || 7)}"></label>
      <label for="tRules">League rules<select id="tRules">${Object.values(RULESETS).map(r => `<option value="${esc(r.id)}"${RULES().id === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <label for="tDiv" id="tDivW"${RULES().id === 'ossc' ? '' : ' hidden'}>OSSC division<select id="tDiv"><option value="rec"${st.team?.division !== 'int' ? ' selected' : ''}>Recreational (+3 home runs)</option><option value="int"${st.team?.division === 'int' ? ' selected' : ''}>Intermediate (+5 home runs)</option></select></label>
    </div>
    <div class="row"><button class="btn" type="submit">Save settings</button></div>
    <p class="muted small">Players join with your invite link: open the team menu at the top and choose <b>Invite players</b>. Make someone a co-captain from the same menu so they can manage the lineup and keep score.</p>
  </form>` : ''}`;
  view.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', () => setRsvp(b.dataset.g, b.dataset.p, b.dataset.v)));
  view.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', () => shareSheet('Remind the team', reminderMessage(st.games.find(x => x.id === b.dataset.remind)))));
  const tr = document.getElementById('tRules'); if (tr) tr.onchange = () => { document.getElementById('tDivW').hidden = tr.value !== 'ossc'; };
  if (openRules) { openRules = false; const rc = document.getElementById('rulesCard'); if (rc) { rc.open = true; rc.scrollIntoView({ block: 'start' }); } }
  if (!st.canEdit) return;
  const form = document.getElementById('pf'), reset = () => { form.reset(); document.getElementById('pId').value = ''; document.getElementById('pfTitle').textContent = 'Add a player'; document.getElementById('pfSave').textContent = 'Add player'; document.getElementById('pfCancel').hidden = true; };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('pName').value.trim(); if (!name) return;
    const id = document.getElementById('pId').value || uid(), prev = st.players.find(p => p.id === id);
    const data = { name, number: document.getElementById('pNum').value.trim(), g: document.getElementById('pG').value, pos: [...form.querySelectorAll('.posbox:checked')].map(b => b.value), paid: prev ? !!prev.paid : false, order: prev ? prev.order : Date.now() };
    if (await write(() => db.doc('players/' + id).set(data), prev ? 'Player saved' : `${name} added`)) reset();
  });
  document.getElementById('pfCancel').onclick = reset;
  view.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const p = st.players.find(x => x.id === b.dataset.edit);
    document.getElementById('pId').value = p.id; document.getElementById('pName').value = p.name; document.getElementById('pNum').value = p.number || ''; document.getElementById('pG').value = p.g || '';
    form.querySelectorAll('.posbox').forEach(c => c.checked = (p.pos || []).includes(c.value));
    document.getElementById('pfTitle').textContent = 'Edit ' + p.name; document.getElementById('pfSave').textContent = 'Save player'; document.getElementById('pfCancel').hidden = false;
    document.getElementById('pName').focus(); form.scrollIntoView({ block: 'start' });
  }));
  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => confirmInline(b, 'Remove from roster?', () => write(() => db.doc('players/' + b.dataset.del).delete(), 'Player removed'))));
  view.querySelectorAll('[data-paid]').forEach(b => b.addEventListener('click', () => { const p = st.players.find(x => x.id === b.dataset.paid); write(() => db.doc('players/' + p.id).update({ paid: !p.paid }), `${p.name}: ${p.paid ? 'not paid' : 'paid'}`); }));
  document.getElementById('tf').addEventListener('submit', e => { e.preventDefault();
    const place = document.getElementById('tPlace').value.trim();
    const ruleId = document.getElementById('tRules').value, ruleChanged = ruleId !== RULES().id;
    const save = loc => write(() => db.doc('team/info').update({ rules: ruleId, division: document.getElementById('tDiv').value, ...(ruleId !== 'standard' ? { innings: 7 } : {}), name: document.getElementById('tName').value.trim() || st.team.name, league: document.getElementById('tLeague').value.trim(), season: document.getElementById('tSeason').value.trim(), fee: +document.getElementById('tFee').value || 0, innings: +document.getElementById('tInn').value || 7,
      ...(loc ? { place: loc.label, lat: loc.lat, lng: loc.lng } : place ? {} : { place: '', lat: null, lng: null }) }), loc ? `Settings saved. Forecasts use ${loc.label}.` : ruleChanged ? `Now using ${RULESETS[ruleId].short} rules. Rebuild upcoming lineups.` : 'Settings saved');
    if (place && place !== st.team?.place) locate(place).then(save, () => { toast('Couldn’t find that area. Try a postal code.'); save(null); });
    else save(null); });
}

/* --- Board: announcements and chat --- */
let names = {};
async function renderBoard() {
  view.innerHTML = `<h2>Team board</h2>
  ${st.canWrite ? `<form class="panel" id="bf"><label for="bText">Post to the team<textarea id="bText" maxlength="600" placeholder="e.g. Bring the orange balls on Sunday. Diamond 3 moved to 7pm."></textarea></label><div class="row"><button class="btn" type="submit">Post</button></div></form>` : `<p class="muted">You can read the board. Join the team to post.</p>`}
  <div class="panel" style="margin-top:12px">${st.posts.length ? [...st.posts].sort((a, b) => b.at - a.at).map(p => `<div class="post"><div class="meta">${esc(names[p.u] || 'Teammate')} · ${esc(new Date(p.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${p.pin ? ' · <b style="color:var(--clay)">Pinned</b>' : ''}</div><p>${esc(p.text)}</p>${st.canEdit ? `<div class="row"><button class="btn ghost small" type="button" data-pin="${esc(p.id)}">${p.pin ? 'Unpin' : 'Pin'}</button><button class="btn danger small" type="button" data-delpost="${esc(p.id)}">Delete</button></div>` : p.u && p.u === myId ? `<div class="row"><button class="btn danger small" type="button" data-delpost="${esc(p.id)}">Delete</button></div>` : ''}</div>`).join('') : '<p class="empty">No posts yet.</p>'}</div>`;
  const f = document.getElementById('bf');
  if (f) f.addEventListener('submit', async e => { e.preventDefault(); const t = document.getElementById('bText').value.trim(); if (!t) return; const u = user ? await user.id() : null; if (await write(() => db.doc('posts/' + uid()).set({ text: t, at: Date.now(), u }), 'Posted')) document.getElementById('bText').value = ''; });
  view.querySelectorAll('[data-delpost]').forEach(b => b.addEventListener('click', () => confirmInline(b, 'Delete post?', () => write(() => db.doc('posts/' + b.dataset.delpost).delete(), 'Post deleted'))));
  view.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', () => { const p = st.posts.find(x => x.id === b.dataset.pin); write(() => db.doc('posts/' + p.id).update({ pin: !p.pin })); }));
  const ids = [...new Set(st.posts.map(p => p.u).filter(Boolean))].filter(id => !(id in names));
  if (user && ids.length) { try { const ps = await user.profiles(ids); ids.forEach(id => names[id] = (ps[id] && ps[id].name) || 'Teammate'); if ((location.hash || '').slice(1) === 'board') render(); } catch (_) {} }
}

/* ---------- Subs: a pool of players looking to fill in, searchable by captains ---------- */
const SKILL = ['', 'Beginner', 'Rec', 'Intermediate', 'Competitive', 'Elite'];
const STRENGTHS = ['Power hitter', 'Contact hitter', 'Gap hitter', 'Fast on the bases', 'Strong arm', 'Accurate arm', 'Soft hands', 'Covers ground', 'Pitching', 'Catching', 'Tracks fly balls', 'Shows up on time'];
const WORKING_ON = ['Hitting for power', 'Speed', 'Arm strength', 'Fly balls', 'Ground balls', 'Pitching', 'Catching', 'Timing the arc', 'New to the game'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES = [['early', 'Before 6 pm'], ['evening', '6 to 9 pm'], ['late', 'After 9 pm']];
const GENDERS = [['w', 'Woman'], ['m', 'Man'], ['x', 'Non-binary'], ['', 'Prefer not to say']];
let myId = null, sample = null, subMode = LS.get('submode', 'find');
let F = Object.assign({ from: '', km: 25, pos: [], gender: '', skill: 0, day: '', time: '', bats: '', throws: '', tags: [], activeOnly: true, inRange: false, q: '' }, LS.get('filters', {}));
const saveF = () => LS.set('filters', F);
const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// turn a place into rough coordinates: typed coordinates are used as-is, anything else (postal code, neighbourhood, park) goes to the geocoder in platform.js
function gearCtx() {
  return { platform, db, st, view, esc, toast, write, render, locate, km, LS, confirmInline, uid, myId: () => myId, myName: () => (user && user.name ? user.name() : '') };
}
async function locate(text) {
  const m = String(text).match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (m) return { lat: +m[1], lng: +m[2], label: `${(+m[1]).toFixed(3)}, ${(+m[2]).toFixed(3)}` };
  const r = await platform.geocode(String(text).slice(0, 120));
  if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number') throw new Error('unknown');
  return { lat: Math.round(r.lat * 100) / 100, lng: Math.round(r.lng * 100) / 100, label: String(r.label || text).slice(0, 60) }; // rounded to about 1 km so nobody's exact address is stored
}
const fromPoint = () => { if (!F.from) return null; const d = st.diamonds.find(x => x.id === F.from); return d ? d : (F.fromLoc || null); };

function renderSubs() {
  view.innerHTML = `<h2>Subs</h2>
  <div class="seg" role="tablist" aria-label="Subs" style="margin-bottom:14px">
    <button type="button" role="tab" aria-selected="${esc(subMode === 'find')}" aria-pressed="${esc(subMode === 'find')}" data-mode="find" data-v="in">Find a sub</button>
    <button type="button" role="tab" aria-selected="${esc(subMode === 'me')}" aria-pressed="${esc(subMode === 'me')}" data-mode="me" data-v="in">${st.agents.some(a => a.id === myId) ? 'My sub profile' : 'Sign up to sub'}</button>
  </div>
  <div id="subBody"></div>`;
  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { subMode = b.dataset.mode; LS.set('submode', subMode); renderSubs(); }));
  if (subMode === 'me') renderMySub(); else renderFind();
}

function chips(name, list, sel, labelFn = x => x) {
  return `<div class="chipset" role="group" aria-label="${esc(name)}">${list.map(v => { const val = Array.isArray(v) ? v[0] : v, lab = Array.isArray(v) ? v[1] : labelFn(v);
    return `<label class="chk"><input type="checkbox" value="${esc(val)}" data-set="${esc(name)}"${sel.includes(val) ? ' checked' : ''}> <span>${esc(lab)}</span></label>`; }).join('')}</div>`;
}
const checked = (root, name) => [...root.querySelectorAll(`input[data-set="${esc(name)}"]:checked`)].map(x => x.value);

function renderMySub() {
  const box = document.getElementById('subBody');
  if (!myId) { box.innerHTML = `<div class="panel"><p>Sign in to create a sub profile.</p></div>`; return; }
  const a = st.agents.find(x => x.id === myId) || { active: true, pos: [], days: [], times: [], str: [], weak: [], skill: 3, radius: 15 };
  const inv = st.invites.filter(i => i.agent === myId).sort((x, y) => y.at - x.at);
  box.innerHTML = `
  ${inv.length ? `<h3>Requests from captains</h3><div class="stack" style="margin:8px 0 18px">${inv.map(i => `<div class="panel" style="padding:12px 16px"><div class="row"><div class="grow"><b>${esc(i.team)}</b> wants you ${i.date ? `on ${esc(fmtDate(i.date).w)} ${esc(fmtDate(i.date).m)} ${esc(fmtDate(i.date).d)}` : ''}${i.time ? ' at ' + esc(fmtTime(i.time)) : ''}${i.field ? ' · ' + esc(i.field) : ''}${i.opp ? ' vs ' + esc(i.opp) : ''}${i.note ? `<div class="muted small">“${esc(i.note)}”</div>` : ''}</div>
      ${i.status === 'pending' ? `<button class="btn small" type="button" data-inv="${esc(i.id)}" data-s="accepted">I'm in</button><button class="btn ghost small" type="button" data-inv="${esc(i.id)}" data-s="declined">Can't make it</button>` : `<span class="pill ${i.status === 'accepted' ? 'in' : 'out'}">${i.status === 'accepted' ? 'You said yes' : 'You said no'}</span>`}</div></div>`).join('')}</div>` : ''}
  <form class="panel" id="af">
    <p class="muted small">Captains in this league see this profile when they search for subs. Only fill in what you're happy to share.</p>
    <label class="chk big"><input type="checkbox" id="aActive"${a.active ? ' checked' : ''}> <span><b>I'm available to sub right now</b></span></label>
    <div class="form-grid">
      <label for="aName">Name captains will see<input id="aName" type="text" required maxlength="40" value="${esc(a.name || '')}" placeholder="e.g. Jordan P."></label>
      <label for="aGender">Gender <span class="muted small">(co-ed leagues need it)</span><select id="aGender">${GENDERS.map(([v, l]) => `<option value="${esc(v)}"${(a.gender || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label for="aSkill">Level<select id="aSkill">${SKILL.slice(1).map((l, i) => `<option value="${esc(i + 1)}"${+a.skill === i + 1 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label for="aBats">Bats<select id="aBats">${[['R', 'Right'], ['L', 'Left'], ['S', 'Switch']].map(([v, l]) => `<option value="${esc(v)}"${a.bats === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label for="aThrows">Throws<select id="aThrows">${[['R', 'Right'], ['L', 'Left']].map(([v, l]) => `<option value="${esc(v)}"${a.throws === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <fieldset><legend>Where I like to play</legend>${chips('pos', POS.map(k => [k, POS_NAME[k]]), a.pos || [])}</fieldset>
    <fieldset><legend>Strengths</legend>${chips('str', STRENGTHS, a.str || [])}</fieldset>
    <fieldset><legend>Still working on</legend>${chips('weak', WORKING_ON, a.weak || [])}</fieldset>
    <label for="aAbout">About my game <span class="muted small">(optional)</span><textarea id="aAbout" maxlength="400" placeholder="e.g. Played 6 seasons of co-ed. Happy anywhere in the outfield, can pitch in a pinch.">${esc(a.about || '')}</textarea></label>
    <fieldset><legend>Days I can play</legend>${chips('days', DAYS, a.days || [])}</fieldset>
    <fieldset><legend>Game times</legend>${chips('times', TIMES, a.times || [])}</fieldset>
    <div class="form-grid">
      <label for="aWhere">Where I'm coming from<input id="aWhere" type="text" maxlength="80" value="${esc(a.area || '')}" placeholder="Postal code, neighbourhood or city"></label>
      <label for="aRadius">How far I'll travel<select id="aRadius">${[5, 10, 15, 25, 40, 60].map(k => `<option value="${esc(k)}"${+a.radius === k ? ' selected' : ''}>Up to ${k} km</option>`).join('')}</select></label>
    </div>
    <p class="muted small" id="aLocNote">${a.lat != null ? `Located near <b>${esc(a.area)}</b>. Only an area about 1 km wide is stored, never your address.` : 'Only a rough area (about 1 km) is stored, never your address.'}</p>
    <label for="aContact">How captains can reach you<input id="aContact" type="text" maxlength="80" value="${esc(st.contacts[myId] || '')}" placeholder="e.g. text 416-555-0142, or @jordanplays"></label>
    <p class="muted small" style="margin-top:-6px">Private. A captain sees this only after you say yes to their request.</p>
    <div class="row"><button class="btn cta" type="submit" id="aSave">${st.agents.some(x => x.id === myId) ? 'Save profile' : 'Join the sub list'}</button>
    ${st.agents.some(x => x.id === myId) ? `<button class="btn danger" type="button" id="aDel">Remove my profile</button>` : ''}</div>
  </form>`;
  box.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => write(() => db.doc('invites/' + b.dataset.inv).update({ status: b.dataset.s, answeredAt: Date.now() }), b.dataset.s === 'accepted' ? 'Told the captain you’re in' : 'Told the captain you can’t make it')));
  const form = document.getElementById('af');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('aSave'); btn.disabled = true; btn.textContent = 'Saving…';
    const area = document.getElementById('aWhere').value.trim();
    let loc = a.lat != null && area === a.area ? { lat: a.lat, lng: a.lng, label: a.area } : null;
    if (area && !loc) { try { loc = await locate(area); } catch (_) { loc = null; toast('Couldn’t place that location. Try a postal code or city.'); } }
    const data = { name: document.getElementById('aName').value.trim(), gender: document.getElementById('aGender').value, skill: +document.getElementById('aSkill').value,
      bats: document.getElementById('aBats').value, throws: document.getElementById('aThrows').value, pos: checked(form, 'pos'), str: checked(form, 'str'), weak: checked(form, 'weak'),
      about: document.getElementById('aAbout').value.trim(), days: checked(form, 'days'), times: checked(form, 'times'), radius: +document.getElementById('aRadius').value,
      active: document.getElementById('aActive').checked, area: loc ? loc.label : area,
      lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, updated: Date.now() };
    if (!data.name) { btn.disabled = false; return; }
    const contact = document.getElementById('aContact').value.trim();
    await write(async () => { await db.doc('agents/' + myId).set(data); if (contact) await db.doc('contacts/' + myId).set({ contact }); else if (st.contacts[myId]) await db.doc('contacts/' + myId).delete(); }, 'Your sub profile is live');
    btn.disabled = false;
  });
  const del = document.getElementById('aDel');
  if (del) del.addEventListener('click', () => confirmInline(del, 'Remove your sub profile?', () => write(async () => { await db.doc('agents/' + myId).delete(); if (st.contacts[myId]) await db.doc('contacts/' + myId).delete(); }, 'Profile removed')));
}

function renderFind() {
  const box = document.getElementById('subBody'), from = fromPoint();
  const list = st.agents.map(a => ({ a, d: from && a.lat != null ? km(from, a) : null })).filter(({ a, d }) =>
    (!F.activeOnly || a.active) &&
    (!F.pos.length || F.pos.some(p => (a.pos || []).includes(p))) &&
    (!F.gender || a.gender === F.gender) &&
    (!F.skill || (+a.skill || 0) >= F.skill) &&
    (!F.day || (a.days || []).includes(F.day)) &&
    (!F.time || (a.times || []).includes(F.time)) &&
    (!F.bats || a.bats === F.bats) && (!F.throws || a.throws === F.throws) &&
    (!F.tags.length || F.tags.every(t => (a.str || []).includes(t))) &&
    (!F.q || [a.name, a.about, a.area].join(' ').toLowerCase().includes(F.q.toLowerCase())) &&
    (!from || d == null || d <= F.km) &&
    (!F.inRange || d == null || d <= (a.radius || 999))
  ).sort((x, y) => (x.d ?? 1e9) - (y.d ?? 1e9) || (y.a.skill || 0) - (x.a.skill || 0));
  const nF = F.pos.length + F.tags.length + [F.gender, F.skill, F.day, F.time, F.bats, F.throws, F.q].filter(Boolean).length + (F.inRange ? 1 : 0);
  box.innerHTML = `<div class="split">
  <aside class="filters panel" aria-label="Search filters">
    <details id="filtDet"${window.innerWidth >= 900 || LS.get('filtOpen', false) ? ' open' : ''}><summary><b>Filters</b>${nF ? ` <span class="pill in">${nF} on</span>` : ''}</summary>
    <div class="stack" style="margin-top:12px">
      <label for="fQ">Search names and notes<input id="fQ" type="search" value="${esc(F.q)}" placeholder="e.g. pitcher, Leslieville"></label>
      <label for="fFrom">Distance from diamond<select id="fFrom"><option value="">Anywhere</option>${st.diamonds.map(d => `<option value="${esc(d.id)}"${F.from === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}${F.fromLoc ? `<option value="custom"${F.from === 'custom' ? ' selected' : ''}>${esc(F.fromLoc.label)}</option>` : ''}</select></label>
      ${F.from ? `<label for="fKm"><span>Within <output id="fKmOut">${F.km}</output> km</span><input id="fKm" type="range" min="2" max="60" step="1" value="${esc(F.km)}"></label>` : ''}
      <form class="row" id="dForm"><label for="dName" class="grow" style="font-weight:400"><span class="small muted">${st.canEdit ? 'Add a diamond' : 'Search from a place'}</span><input id="dName" type="text" maxlength="80" placeholder="e.g. Christie Pits, Toronto"></label><button class="btn ghost small" type="submit" style="align-self:end">${st.canEdit ? 'Add' : 'Use'}</button></form>
      <fieldset><legend>Plays</legend>${chips('fpos', POS.map(k => [k, k]), F.pos)}</fieldset>
      <label for="fGender">Gender<select id="fGender"><option value="">Any</option>${GENDERS.filter(g => g[0]).map(([v, l]) => `<option value="${esc(v)}"${F.gender === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label for="fSkill">Level at least<select id="fSkill"><option value="0">Any</option>${SKILL.slice(1).map((l, i) => `<option value="${esc(i + 1)}"${F.skill === i + 1 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <label for="fDay">Free on<select id="fDay"><option value="">Any day</option>${DAYS.map(d => `<option${F.day === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
        <label for="fTime">Time<select id="fTime"><option value="">Any time</option>${TIMES.map(([v, l]) => `<option value="${esc(v)}"${F.time === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label for="fBats">Bats<select id="fBats"><option value="">Either</option><option value="R"${F.bats === 'R' ? ' selected' : ''}>Right</option><option value="L"${F.bats === 'L' ? ' selected' : ''}>Left</option><option value="S"${F.bats === 'S' ? ' selected' : ''}>Switch</option></select></label>
        <label for="fThrows">Throws<select id="fThrows"><option value="">Either</option><option value="R"${F.throws === 'R' ? ' selected' : ''}>Right</option><option value="L"${F.throws === 'L' ? ' selected' : ''}>Left</option></select></label>
      </div>
      <fieldset><legend>Must have</legend>${chips('ftags', STRENGTHS, F.tags)}</fieldset>
      <label class="chk"><input type="checkbox" id="fActive"${F.activeOnly ? ' checked' : ''}> <span>Only players available now</span></label>
      <label class="chk"><input type="checkbox" id="fRange"${F.inRange ? ' checked' : ''}> <span>Only players willing to travel that far</span></label>
      <button class="btn ghost small" type="button" id="fClear">Clear filters</button>
    </div></details>
  </aside>
  <section class="results" aria-label="Matching subs">
    <p class="muted small" aria-live="polite" style="margin:0 0 10px">${list.length} ${list.length === 1 ? 'player' : 'players'}${from ? ` within ${F.km} km of ${esc(from.name || from.label)}` : ''}${!st.agents.length ? '' : ` of ${st.agents.length} on the list`}</p>
    <div class="stack">${list.length ? list.map(({ a, d }) => agentCard(a, d)).join('') : `<div class="panel empty">${st.agents.length ? 'No one matches these filters. Try widening the distance or clearing a filter.' : 'No one has signed up to sub yet. Share Dugout with players and point them to <b>Sign up to sub</b>.'}</div>`}</div>
  </section></div>`;
  const det = document.getElementById('filtDet'); det.addEventListener('toggle', () => LS.set('filtOpen', det.open));
  const upd = (k, v) => { F[k] = v; saveF(); renderFind(); };
  const q = document.getElementById('fQ'); q.addEventListener('input', () => { F.q = q.value; saveF(); clearTimeout(q.t); q.t = setTimeout(() => { const pos = q.selectionStart; renderFind(); const n = document.getElementById('fQ'); n.focus(); n.setSelectionRange(pos, pos); }, 350); });
  document.getElementById('fFrom').onchange = e => upd('from', e.target.value);
  const r = document.getElementById('fKm'); if (r) { r.oninput = () => document.getElementById('fKmOut').textContent = r.value; r.onchange = () => upd('km', +r.value); }
  [['fGender', 'gender', v => v], ['fSkill', 'skill', v => +v], ['fDay', 'day', v => v], ['fTime', 'time', v => v], ['fBats', 'bats', v => v], ['fThrows', 'throws', v => v]].forEach(([id, k, f]) => document.getElementById(id).onchange = e => upd(k, f(e.target.value)));
  box.querySelectorAll('input[data-set="fpos"]').forEach(c => c.onchange = () => upd('pos', checked(box, 'fpos')));
  box.querySelectorAll('input[data-set="ftags"]').forEach(c => c.onchange = () => upd('tags', checked(box, 'ftags')));
  document.getElementById('fActive').onchange = e => upd('activeOnly', e.target.checked);
  document.getElementById('fRange').onchange = e => upd('inRange', e.target.checked);
  document.getElementById('fClear').onclick = () => { Object.assign(F, { pos: [], gender: '', skill: 0, day: '', time: '', bats: '', throws: '', tags: [], inRange: false, q: '' }); saveF(); renderFind(); };
  document.getElementById('dForm').addEventListener('submit', async e => {
    e.preventDefault(); const t = document.getElementById('dName').value.trim(); if (!t) return;
    const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Finding…';
    try {
      const loc = await locate(t);
      if (st.canEdit) { const id = uid(); await write(() => db.doc('diamonds/' + id).set({ name: t, label: loc.label, lat: loc.lat, lng: loc.lng }), `Added ${t} (near ${loc.label})`); F.from = id; }
      else { F.fromLoc = { name: t, label: loc.label, lat: loc.lat, lng: loc.lng }; F.from = 'custom'; toast(`Searching from ${loc.label}`); }
      saveF(); renderFind();
    } catch (_) { toast('Couldn’t place that. Try a park name with the city, a postal code, or coordinates like 43.66, -79.42'); b.disabled = false; b.textContent = st.canEdit ? 'Add' : 'Use'; }
  });
  box.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => askForm(b)));
}
function agentCard(a, d) {
  const sent = st.invites.filter(i => i.agent === a.id).sort((x, y) => y.at - x.at)[0];
  const far = d != null && a.radius && d > a.radius;
  return `<article class="panel agent" aria-label="${esc(a.name)}">
    <div class="row" style="align-items:flex-start">
      <div class="crest" aria-hidden="true" style="width:40px;height:40px;font-size:17px">${esc((a.name || '?').trim().slice(0, 1).toUpperCase())}</div>
      <div class="grow" style="min-width:0"><div class="vs" style="font-size:1.15em">${esc(a.name)}</div>
        <div class="muted small">${[SKILL[a.skill] || '', (GENDERS.find(g => g[0] === a.gender) || [, ''])[1] && a.gender ? GENDERS.find(g => g[0] === a.gender)[1] : '', `Bats ${esc(a.bats || '?')} · Throws ${esc(a.throws || '?')}`].filter(Boolean).join(' · ')}</div></div>
      ${d != null ? `<span class="pill ${far ? 'maybe' : 'in'}" title="${far ? `Further than the ${esc(a.radius)} km they said they'd travel` : ''}">${d < 1 ? '<1' : Math.round(d)} km${far ? ' · far for them' : ''}</span>` : a.area ? `<span class="pill" style="border:1.5px solid var(--line)">${esc(a.area)}</span>` : ''}
    </div>
    ${(a.pos || []).length ? `<div class="small"><b>Plays:</b> ${(a.pos || []).map(k => esc(POS_NAME[k] || k)).join(', ')}</div>` : ''}
    ${(a.str || []).length ? `<div class="tagrow">${a.str.map(t => `<span class="tag good">${esc(t)}</span>`).join('')}</div>` : ''}
    ${(a.weak || []).length ? `<div class="small muted"><b>Working on:</b> ${a.weak.map(esc).join(', ')}</div>` : ''}
    ${a.about ? `<p style="margin:0">${esc(a.about)}</p>` : ''}
    <div class="small muted">${(a.days || []).length ? 'Free ' + a.days.map(esc).join(', ') : 'Days not given'}${(a.times || []).length ? ' · ' + a.times.map(t => esc((TIMES.find(x => x[0] === t) || [, t])[1])).join(', ') : ''}${a.area ? ' · from ' + esc(a.area) : ''}${a.radius ? ` · travels up to ${esc(a.radius)} km` : ''}${a.active ? '' : ' · <b>not available right now</b>'}</div>
    ${st.contacts[a.id] ? `<div class="small"><b>Reach them:</b> <span style="user-select:all">${esc(st.contacts[a.id])}</span></div>` : a.id !== myId && st.canEdit ? `<div class="small muted">Their contact details show here once they say yes to a request.</div>` : ''}
    <div class="row">${a.id === myId ? '<span class="muted small">This is you</span>' : st.canEdit ? `<button class="btn small" type="button" data-ask="${esc(a.id)}">Ask to sub</button>` : ''}
      ${sent ? `<span class="pill ${sent.status === 'accepted' ? 'in' : sent.status === 'declined' ? 'out' : 'maybe'}">${sent.status === 'accepted' ? 'Said yes' : sent.status === 'declined' ? 'Said no' : 'Asked, waiting'}${sent.date ? ' · ' + esc(fmtDate(sent.date).m + ' ' + fmtDate(sent.date).d) : ''}</span>` : ''}</div>
    <div data-askbox="${esc(a.id)}"></div>
  </article>`;
}
function askForm(btn) {
  const a = st.agents.find(x => x.id === btn.dataset.ask), box = view.querySelector(`[data-askbox="${esc(a.id)}"]`);
  const games = sortedGames().filter(g => g.status !== 'final' && g.date >= today());
  box.innerHTML = `<form class="stack" style="border-top:1px solid var(--line);padding-top:12px">
    <label for="ag-${esc(a.id)}">Which game?<select id="ag-${esc(a.id)}">${games.map(g => `<option value="${esc(g.id)}">${esc(fmtDate(g.date).w)} ${esc(fmtDate(g.date).m)} ${esc(fmtDate(g.date).d)}, ${esc(fmtTime(g.time))} · ${g.home ? 'vs' : '@'} ${esc(g.opp)}${g.field ? ' · ' + esc(g.field) : ''}</option>`).join('') || '<option value="">Any upcoming game</option>'}</select></label>
    <label for="an-${esc(a.id)}">Message <span class="muted small">(optional)</span><input id="an-${esc(a.id)}" type="text" maxlength="160" placeholder="e.g. We need an outfielder, can you make it?"></label>
    <div class="row"><button class="btn small" type="submit">Send request</button><button class="btn ghost small" type="button" data-cancel>Cancel</button></div>
    <p class="muted small" style="margin:0">They'll see it on their sub profile in Dugout. If they say yes, their contact details appear on their card.</p>
  </form>`;
  box.querySelector('[data-cancel]').onclick = () => box.innerHTML = '';
  box.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); const g = st.games.find(x => x.id === document.getElementById('ag-' + a.id).value);
    const data = { agent: a.id, teamId: platform.teamId, team: st.team ? st.team.name : 'A team', gid: g ? g.id : '', opp: g ? g.opp : '', date: g ? g.date : '', time: g ? g.time : '', field: g ? g.field : '', note: document.getElementById('an-' + a.id).value.trim(), by: myId, at: Date.now(), status: 'pending' };
    await write(() => db.doc('invites/' + uid()).set(data), `Asked ${a.name} to sub`);
  });
}

/* an inline "are you sure" in place of the button */
function confirmInline(btn, q, go) {
  const box = document.createElement('span'); box.className = 'confirm';
  box.innerHTML = `<span class="small"><b>${esc(q)}</b></span><button class="btn danger small" type="button">Yes</button><button class="btn ghost small" type="button">No</button>`;
  btn.replaceWith(box); box.querySelector('.danger').focus();
  box.querySelector('.danger').onclick = () => go();
  box.querySelectorAll('button')[1].onclick = () => render();
}

/* sample team for trying it out, clearly labeled */
async function loadDemo() {
  const names = ['Sam R.', 'Priya K.', 'Marcus T.', 'Jen L.', 'Diego M.', 'Alexis W.', 'Tom B.', 'Keisha D.', 'Ryan O.', 'Mei C.', 'Luis G.', 'Hannah P.'];
  const pos = [['P'], ['C', '1B'], ['SS', '2B'], ['LF', 'LCF'], ['3B'], ['2B'], ['RCF', 'RF'], ['1B'], ['LCF', 'RCF'], ['RF', 'LF'], ['P', '3B'], ['C']];
  const d0 = new Date(); const day = n => { const d = new Date(d0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  await write(async () => {
    await db.doc('team/info').set({ name: 'Sample Sluggers', league: 'Example league (sample data)', season: 'Demo season', fee: 60, innings: 7, demo: true });
    for (let i = 0; i < names.length; i++) await db.doc('players/demo' + i).set({ name: names[i], number: String(3 + i * 4), pos: pos[i], paid: i % 3 !== 0, order: i });
    await db.doc('games/demoA').set({ opp: 'Base Invaders', date: day(3), time: '18:30', field: 'Diamond 3', home: true, status: 'scheduled', us: [], them: [], inning: 1, bi: 0 });
    await db.doc('games/demoB').set({ opp: 'Pitch Slaps', date: day(10), time: '19:45', field: 'Diamond 1', home: false, status: 'scheduled', us: [], them: [], inning: 1, bi: 0 });
    for (let i = 0; i < names.length; i++) await db.doc('rsvp/demoA_demo' + i).set({ g: 'demoA', p: 'demo' + i, s: i < 11 ? 'in' : 'maybe', at: Date.now() });
  }, 'Sample team loaded. Change anything you like.');
}

/* ---------- boot ---------- */
const big = document.getElementById('bigText');
if (LS.get('big', false)) { document.documentElement.classList.add('big'); big.setAttribute('aria-pressed', 'true'); }
big.addEventListener('click', () => { const on = !document.documentElement.classList.contains('big'); document.documentElement.classList.toggle('big', on); big.setAttribute('aria-pressed', on); LS.set('big', on); });
window.addEventListener('hashchange', render);
render();

(async () => {
  const timer = setTimeout(() => { if (!st.loaded.team) { st.offline = true; render(); } }, 10000);
  try { db = await platform.use('db'); } catch (_) { db = null; }
  try { user = await platform.use('user'); } catch (_) { user = null; }
  if (!db) { clearTimeout(timer); st.offline = true; render(); return; }
  st.canEdit = user ? !!user.canEdit() : false;
  try { myId = user ? await user.id() : null; } catch (_) { myId = null; }
  const cw = user ? user.can('data.write') : null; st.canWrite = cw === null ? true : !!cw;
  let pending = null; const soon = () => { clearTimeout(pending); pending = setTimeout(() => { if ((location.hash || '') === '#gear' && gearBusy()) { header(); return; } const ae = document.activeElement, chatting = ae && ae.id === 'mtxt'; if (!ae || !['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) || chatting) { render(); if (chatting) { const m = document.getElementById('mtxt'); if (m) { m.focus(); m.setSelectionRange(m.value.length, m.value.length); } } } else pendingRender = true; }, 60); };
  let pendingRender = false; document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });
  const fail = () => { clearTimeout(timer); };
  db.doc('team/info').onSnapshot(s => { clearTimeout(timer); st.team = s.exists ? s.data() : null; st.loaded.team = true; st.offline = false; soon(); }, fail);
  db.collection('players').onSnapshot(s => { st.players = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)); const mine = myId && st.players.find(p => p.uid === myId); me = mine ? mine.id : null; soon(); }, fail);
  db.collection('games').onSnapshot(s => { st.games = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
  db.collection('rsvp').onSnapshot(s => { st.rsvp = {}; s.docs.forEach(d => st.rsvp[d.id] = d.data()); soon(); }, fail);
  db.collection('ab').onSnapshot(s => { st.ab = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
    db.collection('agents').onSnapshot(s => { st.agents = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
  db.collection('diamonds').onSnapshot(s => { st.diamonds = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
  db.collection('invites').onSnapshot(s => { st.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); db.collection('contacts').refresh().catch(() => {}); soon(); }, fail);
  db.collection('contacts').onSnapshot(s => { st.contacts = {}; s.docs.forEach(d => st.contacts[d.id] = d.data().contact); soon(); }, fail);
  db.collection('posts').onSnapshot(s => { st.posts = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
  db.collection('listings').onSnapshot(s => { st.listings = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
  db.collection('threads').onSnapshot(s => { st.threads = s.docs.map(d => ({ id: d.id, ...d.data() })); db.collection('messages').refresh().catch(() => {}); soon(); }, fail);
  db.collection('messages').onSnapshot(s => { st.messages = s.docs.map(d => ({ id: d.id, ...d.data() })); soon(); }, fail);
})();
}
