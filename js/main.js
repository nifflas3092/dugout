/* Start-up: log in or create an account, pick or join a team, then open the team app.
   Also the menu: invites, members, your plan (captain / no ads), calendar sync, display settings, account. */
import { SUPABASE_URL, SUPABASE_ANON_KEY, CAPTAIN_PRICE, ADFREE_PRICE } from '../config.js';
import { createPlatform } from './platform.js';
import { startApp } from './app.js';
import { prefsForm, bindPrefs } from './prefs.js';
import { icon } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get(k) { try { return localStorage.getItem('dugout-' + k); } catch (_) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem('dugout-' + k) : localStorage.setItem('dugout-' + k, v); } catch (_) {} } };
const forgetDevice = () => { try { Object.keys(localStorage).filter(k => k.startsWith('dugout-') && k !== 'dugout-prefs').forEach(k => localStorage.removeItem(k)); } catch (_) {} };
const gate = document.getElementById('gate'), appEl = document.getElementById('app');
const crest = '<img class="brand-logo" src="icons/logo.svg" alt="" width="72" height="72">';
const footer = '<footer><button type="button" class="linkish" data-showprefs>Display &amp; accessibility</button> · <a href="privacy.html">Privacy</a></footer>';
// errors raised by the database's own checks are written for people; anything else gets a generic line
const friendly = (error, fallback) => (error && error.code === 'P0001' && error.message && error.message.length < 140 ? error.message : fallback);
const eye = icon('eye');

function showGate(html) {
  appEl.hidden = true; gate.hidden = false;
  gate.innerHTML = `<main class="gate"><div class="brand">${crest}<h1>Dugout</h1></div>${html}<div id="gatePrefs" hidden class="panel" style="margin-top:14px"><h2>Display &amp; accessibility</h2>${prefsForm('gp')}</div>${footer}</main>`;
  bindPrefs(gate, 'gp');
  gate.querySelector('[data-showprefs]').onclick = () => { const p = document.getElementById('gatePrefs'); p.hidden = !p.hidden; if (!p.hidden) p.scrollIntoView({ block: 'nearest' }); };
  const h = gate.querySelector('h2'); if (h) { h.tabIndex = -1; }
}
// show/hide password buttons and the caps-lock warning
function bindPasswords(root) {
  root.querySelectorAll('.pw').forEach(w => {
    const inp = w.querySelector('input'), btn = w.querySelector('.pw-eye'), caps = w.parentElement.querySelector('.caps');
    btn.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; btn.setAttribute('aria-pressed', show); btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); inp.focus(); };
    const capsCheck = e => { if (caps && e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
    inp.addEventListener('keyup', capsCheck); inp.addEventListener('keydown', capsCheck);
  });
}
const pwField = (id, label, auto, extra = '') => `<label for="${id}">${label}<span class="pw"><input id="${id}" type="password" autocomplete="${auto}" required ${extra}><button type="button" class="pw-eye" aria-label="Show password" aria-pressed="false">${eye}</button></span></label><p class="caps small" hidden role="status">Caps Lock is on</p>`;

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  showGate(`<div class="panel"><h2>Almost there</h2><p>Dugout isn’t connected to a database yet. Put your Supabase project URL and public key in <b>config.js</b>, then reload.</p></div>`);
  throw new Error('config.js not filled in');
}
if (!window.supabase || !window.supabase.createClient) {
  showGate(`<div class="panel"><h2>Can’t load Dugout</h2><p>Part of the app didn’t download. Check your connection and reload.</p></div>`);
  throw new Error('supabase-js did not load');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });

// keep an invite code across sign-up (codes are letters and digits only)
const params = new URLSearchParams(location.search);
if (params.get('join')) { LS.set('join', params.get('join').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)); params.delete('join'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }
const paidReturn = params.get('paid'); if (paidReturn) { params.delete('paid'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }

let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { forgetDevice(); location.replace(location.pathname); return; }
  if (event === 'PASSWORD_RECOVERY') { started = true; return newPasswordScreen(); }
  if (session && !started) { started = true; setTimeout(() => afterSignIn(session), 0); }
});
const { data: { session } } = await sb.auth.getSession();
if (!session && !started) signInScreen(LS.get('join') ? 'signup' : 'login');
else if (session && !started) { started = true; afterSignIn(session); }

/* ---------- log in / create account / forgot password ---------- */
function signInScreen(mode = 'login', note = '') {
  const invited = LS.get('join');
  showGate(`${invited ? `<div class="notice" style="margin-bottom:14px">You’ve been invited to a team. ${mode === 'signup' ? 'Create your free account to join it.' : 'Log in to join it.'}</div>` : ''}
  <div class="seg auth-tabs" role="tablist" aria-label="Log in or create an account">
    <button type="button" role="tab" id="tabLogin" aria-selected="${mode === 'login'}" aria-pressed="${mode === 'login'}" aria-controls="authBody">Log in</button>
    <button type="button" role="tab" id="tabSignup" aria-selected="${mode === 'signup'}" aria-pressed="${mode === 'signup'}" aria-controls="authBody">Create account</button>
  </div>
  <div id="authBody" role="tabpanel">${mode === 'login' ? `
  <form class="panel" id="loginF" novalidate>
    <h2>Welcome back</h2>
    <label for="em">Email<input id="em" type="email" autocomplete="username" inputmode="email" required maxlength="254"></label>
    ${pwField('pw', 'Password', 'current-password')}
    <div class="row"><button class="btn cta" type="submit">Log in</button><button class="linkish" type="button" id="forgot">Forgot password?</button></div>
    <p class="small" id="msg" role="alert" aria-live="assertive">${esc(note)}</p>
  </form>` : mode === 'signup' ? `
  <form class="panel" id="signupF" novalidate>
    <h2>Create your free account</h2>
    <p class="muted" style="margin-top:-4px">Everyone starts as a player: join teams, answer RSVPs, sign up to sub and use Gear. Captains can upgrade later.</p>
    <label for="nm">Your name <span class="muted small">(what teammates see)</span><input id="nm" type="text" maxlength="40" autocomplete="name" required></label>
    <label for="em">Email<input id="em" type="email" autocomplete="email" inputmode="email" required maxlength="254"></label>
    ${pwField('pw', 'Password <span class="muted small">(8 or more characters)</span>', 'new-password', 'minlength="8" aria-describedby="pwHint"')}
    <p class="small muted" id="pwHint" style="margin-top:-6px">A short phrase is easy to remember and hard to guess, like “blue-glove-sunday”.</p>
    <label class="opt opt-wide"><input type="checkbox" id="agree" required> <span>I agree to the <a href="privacy.html" target="_blank">privacy policy</a></span></label>
    <div class="row"><button class="btn cta" type="submit">Create account</button></div>
    <p class="small" id="msg" role="alert" aria-live="assertive">${esc(note)}</p>
  </form>` : `
  <form class="panel" id="resetF" novalidate>
    <h2>Reset your password</h2>
    <p class="muted" style="margin-top:-4px">We’ll email you a link to choose a new one.</p>
    <label for="em">Email<input id="em" type="email" autocomplete="email" inputmode="email" required maxlength="254"></label>
    <div class="row"><button class="btn cta" type="submit">Email me a reset link</button><button class="linkish" type="button" id="back">Back to log in</button></div>
    <p class="small" id="msg" role="alert" aria-live="assertive">${esc(note)}</p>
  </form>`}</div>`);
  bindPasswords(gate);
  document.getElementById('tabLogin').onclick = () => signInScreen('login');
  document.getElementById('tabSignup').onclick = () => signInScreen('signup');
  const msg = document.getElementById('msg'), say = (t, bad = true) => { msg.className = 'small' + (bad ? ' err' : ''); msg.textContent = t; };
  const valid = f => { const bad = [...f.querySelectorAll('input[required]')].find(i => !i.checkValidity()); if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); say(bad.type === 'email' ? 'Enter a valid email address.' : bad.type === 'checkbox' ? 'Please agree to the privacy policy.' : bad.id === 'pw' && mode === 'signup' ? 'Use at least 8 characters for your password.' : 'Fill in this field.'); return false; } return true; };
  const f = gate.querySelector('form');
  f.addEventListener('input', e => e.target.removeAttribute('aria-invalid'));
  const em = document.getElementById('em'); if (em) setTimeout(() => (document.getElementById('nm') || em).focus(), 0);
  if (mode === 'login') {
    document.getElementById('forgot').onclick = () => signInScreen('reset');
    f.onsubmit = async e => {
      e.preventDefault(); if (!valid(f)) return;
      e.submitter.disabled = true; say('Logging in…', false);
      const { error } = await sb.auth.signInWithPassword({ email: em.value.trim(), password: document.getElementById('pw').value });
      e.submitter.disabled = false;
      if (!error) return say('', false);
      if (/confirm/i.test(error.message)) { say('Confirm your email first: open the link we sent you.'); return addResend(em.value.trim()); }
      say(/invalid/i.test(error.message) ? 'That email and password don’t match. Check them, or reset your password.' : /rate|many/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t log in. Check your connection and try again.');
    };
  } else if (mode === 'signup') {
    f.onsubmit = async e => {
      e.preventDefault(); if (!valid(f)) return;
      e.submitter.disabled = true; say('Creating your account…', false);
      const email = em.value.trim();
      const { data, error } = await sb.auth.signUp({ email, password: document.getElementById('pw').value, options: { data: { name: document.getElementById('nm').value.trim() }, emailRedirectTo: location.origin + location.pathname } });
      e.submitter.disabled = false;
      if (error) return say(/registered|exists/i.test(error.message) ? 'There’s already an account with that email. Log in instead.' : /password/i.test(error.message) ? error.message : 'Couldn’t create the account. Try again.');
      if (data && data.session) return;                       // email confirmation is off: straight in
      f.innerHTML = `<h2>Check your email</h2><p>We sent a link to <b>${esc(email)}</b>. Open it to confirm your account, and you’ll be signed in. It can take a minute; check spam too.</p><div class="row"><button class="btn ghost" type="button" id="toLogin">Back to log in</button></div><p class="small" id="msg" role="status"></p>`;
      document.getElementById('toLogin').onclick = () => signInScreen('login');
      addResend(email);
    };
  } else {
    document.getElementById('back').onclick = () => signInScreen('login');
    f.onsubmit = async e => {
      e.preventDefault(); if (!valid(f)) return;
      e.submitter.disabled = true;
      await sb.auth.resetPasswordForEmail(em.value.trim(), { redirectTo: location.origin + location.pathname });
      e.submitter.disabled = false;
      say(`If there’s an account for ${em.value.trim()}, a reset link is on its way. Check spam too.`, false);   // same answer either way, so nobody can test which emails have accounts
    };
  }
}
function addResend(email) {
  const m = document.getElementById('msg'); if (!m || m.querySelector('button')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'linkish'; b.textContent = 'Send the confirmation email again';
  b.onclick = async () => { b.disabled = true; const { error } = await sb.auth.resend({ type: 'signup', email }); b.textContent = error ? 'Couldn’t send. Wait a minute and try again.' : 'Sent. Check your inbox.'; };
  m.append(' ', b);
}
function newPasswordScreen() {
  showGate(`<form class="panel" id="npF" novalidate><h2>Choose a new password</h2>
    ${pwField('pw', 'New password <span class="muted small">(8 or more characters)</span>', 'new-password', 'minlength="8"')}
    <div class="row"><button class="btn cta" type="submit">Save password</button></div><p class="small" id="msg" role="alert"></p></form>`);
  bindPasswords(gate);
  document.getElementById('npF').onsubmit = async e => {
    e.preventDefault(); const pw = document.getElementById('pw'), msg = document.getElementById('msg');
    if (pw.value.length < 8) { msg.className = 'small err'; msg.textContent = 'Use at least 8 characters.'; pw.focus(); return; }
    e.submitter.disabled = true;
    const { error } = await sb.auth.updateUser({ password: pw.value });
    if (error) { e.submitter.disabled = false; msg.className = 'small err'; msg.textContent = 'Couldn’t save it. The link may have expired: ask for a new one.'; return; }
    history.replaceState(null, '', location.pathname);
    const { data: { session } } = await sb.auth.getSession(); if (session) afterSignIn(session);
  };
}

/* ---------- your plan ---------- */
async function getAccount(uid) {
  const { data } = await sb.from('accounts').select('captain_status, captain_until, grandfathered, ad_free, cal_token').eq('user_id', uid).maybeSingle();
  const a = data || {};
  const captain = !!a.grandfathered || (['active', 'trialing'].includes(a.captain_status) && (!a.captain_until || new Date(a.captain_until).getTime() > Date.now() - 3 * 864e5));
  return { ...a, captain, adFree: captain || !!a.ad_free };
}
async function checkout(product) {
  const { data, error } = await sb.functions.invoke('create-checkout', { body: { product, return_url: location.origin + location.pathname } });
  if (error || !data || !data.url) throw new Error('checkout');
  location.href = data.url;
}
async function managePlan() {
  const { data, error } = await sb.functions.invoke('billing-portal', { body: { return_url: location.origin + location.pathname } });
  if (error || !data || !data.url) throw new Error('portal');
  location.href = data.url;
}
const upgradeCard = (why = '') => `<div class="panel upgrade"><h2>Become a captain</h2>
  <p>${why || 'Start and run your own teams, browse the full sub list and ask subs to play.'}</p>
  <ul class="ticks"><li>Start teams and invite players</li><li>See every sub in the league, with distance and availability</li><li>Lineups, scorecards and schedule import</li><li>No ads</li></ul>
  <div class="row"><button class="btn cta" type="button" data-upgrade>Upgrade for ${esc(CAPTAIN_PRICE)}</button></div>
  <p class="muted small">Cancel any time from the menu. Joining teams and playing stay free.</p></div>`;
function bindUpgrade(root) {
  root.querySelectorAll('[data-upgrade]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Opening checkout…'; try { await checkout('captain'); } catch (_) { b.disabled = false; b.textContent = 'Couldn’t open checkout. Try again'; } });
  root.querySelectorAll('[data-adfree]').forEach(b => b.onclick = async () => { b.disabled = true; try { await checkout('adfree'); } catch (_) { b.disabled = false; b.textContent = 'Couldn’t open checkout. Try again'; } });
}

/* ---------- pick a team ---------- */
async function myTeams(uid) {
  const { data, error } = await sb.from('team_members').select('role, teams(id, name, join_code)').eq('user_id', uid);
  if (error) throw error;
  return data.filter(r => r.teams).map(r => ({ ...r.teams, role: r.role })).sort((a, b) => a.name.localeCompare(b.name));
}

async function afterSignIn(session) {
  let account = await getAccount(session.user.id);
  if (paidReturn === 'captain' || paidReturn === 'adfree') {     // back from checkout: the payment confirmation can take a few seconds to arrive
    for (let i = 0; i < 8 && !(paidReturn === 'captain' ? account.captain : account.adFree); i++) { await new Promise(r => setTimeout(r, 1500)); account = await getAccount(session.user.id); }
  }
  const code = LS.get('join');
  if (code) {
    LS.set('join', null);
    const { data, error } = await sb.rpc('join_team', { code });
    if (error) return teamsScreen(session, account, friendly(error, 'That invite link didn’t work.') + ' Ask your captain for a new one.');
    LS.set('team', data);
  }
  let teams;
  try { teams = await myTeams(session.user.id); } catch (e) { return showGate(`<div class="panel"><h2>Can’t reach Dugout</h2><p>Check your connection and reload.</p></div>`); }
  if (new URLSearchParams(location.search).has('teams') || paidReturn === 'captain' && !teams.some(t => t.role === 'captain')) { history.replaceState(null, '', location.pathname); return teamsScreen(session, account, paidReturn === 'captain' && account.captain ? 'You’re a captain now. Start your team below.' : '', teams); }
  const pick = teams.find(t => t.id === LS.get('team'));
  if (pick) return openTeam(session, account, pick, teams);
  if (teams.length === 1) return openTeam(session, account, teams[0], teams);
  if (!teams.length) return openTeam(session, account, null, teams);     // not on a team yet: straight in, as a sub
  teamsScreen(session, account, '', teams);
}

async function teamsScreen(session, account, note = '', teams) {
  if (!teams) { try { teams = await myTeams(session.user.id); } catch (_) { teams = []; } }
  showGate(`${note ? `<div class="notice" style="margin-bottom:14px" role="status">${esc(note)}</div>` : ''}
  ${teams.length ? `<div class="panel"><h2>Your teams</h2><ul class="teamlist">${teams.map(t => `<li><button type="button" data-team="${esc(t.id)}"><b>${esc(t.name)}</b><span class="muted small">${t.role === 'captain' ? 'Captain' : 'Player'}</span></button></li>`).join('')}</ul></div>` : ''}
  <form class="panel" id="joinF"><h2>Join a team</h2><p class="muted">Use the invite link from your captain, or type the team code.</p>
    <label for="jc">Team code<input id="jc" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" required style="text-transform:uppercase;letter-spacing:.1em"></label>
    <div class="row"><button class="btn" type="submit">Join</button></div><p class="small err" id="jMsg" role="status"></p></form>
  ${account.captain ? `<form class="panel" id="newF"><h2>Start a team</h2><p class="muted">You’ll be the captain. Invite players after.</p>
    <label for="tn">Team name<input id="tn" type="text" maxlength="40" required></label>
    <label for="tr">League rules<select id="tr"><option value="standard">Standard slo-pitch</option><option value="ottawasoftball">OttawaSoftball (co-ed)</option><option value="ossc">OSSC: Ottawa Sport &amp; Social Club (mixed)</option></select></label>
    <label for="td" id="tdW" hidden>OSSC division<select id="td"><option value="rec">Recreational</option><option value="int">Intermediate</option></select></label>
    <p class="muted small" style="margin-top:-4px">Dugout builds lineups and keeps score by these rules. You can change it later.</p>
    <div class="row"><button class="btn cta" type="submit">Create team</button></div><p class="small err" id="nMsg" role="status"></p></form>`
    : upgradeCard('Want to run your own team? Captains start teams, invite players and get the full sub list.')}
  <div class="panel"><h2>No team? No problem</h2><p class="muted">Sign up to sub, buy and sell gear, find diamonds and play Slowpitch Showdown. Join a team any time.</p>
    <div class="row"><button class="btn ghost" type="button" id="solo">Use Dugout without a team</button></div></div>
  <p class="small muted">Signed in as ${esc(session.user.email)}. <button class="chip-btn" type="button" id="so">Log out</button></p>`);
  document.getElementById('solo').onclick = () => { LS.set('team', null); openTeam(session, account, null, teams); };
  bindUpgrade(gate);
  gate.querySelectorAll('[data-team]').forEach(b => b.onclick = () => openTeam(session, account, teams.find(t => t.id === b.dataset.team), teams));
  document.getElementById('so').onclick = () => sb.auth.signOut();
  document.getElementById('joinF').onsubmit = async e => {
    e.preventDefault(); e.submitter.disabled = true;
    const { data, error } = await sb.rpc('join_team', { code: document.getElementById('jc').value });
    e.submitter.disabled = false;
    if (error) { document.getElementById('jMsg').textContent = friendly(error, 'Couldn’t join. Try again.'); return; }
    LS.set('team', data); afterSignIn(session);
  };
  const nf = document.getElementById('newF'); if (!nf) return;
  document.getElementById('tr').onchange = e => { document.getElementById('tdW').hidden = e.target.value !== 'ossc'; };
  nf.onsubmit = async e => {
    e.preventDefault(); const name = document.getElementById('tn').value.trim(); e.submitter.disabled = true;
    const { data, error } = await sb.rpc('create_team', { team_name: name });
    if (error) { e.submitter.disabled = false; document.getElementById('nMsg').textContent = friendly(error, 'Couldn’t create the team. Try again.'); return; }
    const rules = document.getElementById('tr').value;
    if (rules !== 'standard') await sb.rpc('doc_update', { p_scope: data, p_col: 'team', p_id: 'info', patch: { rules, division: document.getElementById('td').value } });
    LS.set('team', data); afterSignIn(session);
  };
}

async function openTeam(session, account, team, teams) {
  if (team) LS.set('team', team.id);
  const { data: prof } = await sb.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
  const platform = createPlatform(sb, { session, teamId: team ? team.id : null, role: team ? team.role : 'player', profileName: prof?.display_name || '', account });
  platform.upgrade = () => checkout('captain');
  platform.team = team;
  platform.myTeams = async () => { try { teams = await myTeams(session.user.id); } catch (_) {} return teams; };
  platform.switchTeam = id => { LS.set('team', id); location.href = location.pathname + '#home'; location.reload(); };
  platform.otherTeams = () => { location.href = location.pathname + '?teams'; };
  platform.removeAds = () => checkout('adfree');
  platform.openMenu = section => teamMenu(session, account, team, teams, prof?.display_name || '', section);
  gate.hidden = true; appEl.hidden = false;
  const tools = appEl.querySelector('.tools');
  const mb = document.createElement('button'); mb.className = 'chip-btn'; mb.type = 'button'; mb.innerHTML = icon('menu') + '<span>Menu</span>'; mb.setAttribute('aria-haspopup', 'dialog');
  tools.prepend(mb); mb.onclick = () => platform.openMenu();
  if (paidReturn === 'captain' && account.captain) setTimeout(() => platform.toast && platform.toast('You’re a captain now. Thanks!'), 400);
  if (paidReturn === 'adfree' && account.adFree) setTimeout(() => platform.toast && platform.toast('Ads are gone for good. Thanks!'), 400);
  startApp(platform);
}

/* ---------- the menu: team, plan, calendar, display, account ---------- */
async function teamMenu(session, account, team, teams, myName, section) {
  let dlg = document.getElementById('menu'); if (dlg) dlg.remove();
  dlg = document.createElement('dialog'); dlg.id = 'menu'; dlg.className = 'menu'; dlg.setAttribute('aria-labelledby', 'menuT'); document.body.append(dlg);
  const me = session.user.id, cap = !!team && team.role === 'captain';
  const link = team ? `${location.origin}${location.pathname}?join=${encodeURIComponent(team.join_code)}` : '';
  const { data: members } = team ? await sb.from('team_members').select('user_id, role, profiles(display_name)').eq('team_id', team.id).order('joined_at') : { data: [] };
  const list = members || [];
  const { data: isAdmin } = await sb.rpc('is_admin').then(r => r, () => ({ data: false }));
  const feed = account.cal_token ? `${SUPABASE_URL}/functions/v1/calendar?t=${account.cal_token}` : '';
  const webcal = feed.replace(/^https:/, 'webcal:');
  const planLine = account.captain ? (account.grandfathered ? 'Captain (free, from before paid plans)' : `Captain, ${esc(CAPTAIN_PRICE)}${account.captain_until ? `. Renews ${esc(new Date(account.captain_until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}` : ''}`) : 'Player (free)';
  dlg.innerHTML = `<div class="mhead"><h2 id="menuT">Menu</h2><button class="btn ghost small" type="button" id="mClose">Close</button></div>
  <p class="small err" id="mErr" role="alert" style="margin:0;padding:0 16px"></p>
  ${team ? `  <section><h3>${esc(team.name)}: invite players</h3>
    <p class="small muted" style="margin:0 0 8px">Send this link in your team chat. Anyone with it can join as a player.</p>
    <div class="mrow"><span class="grow">Code <code>${esc(team.join_code)}</code></span><button class="btn small" type="button" id="mShare">${navigator.share ? 'Share link' : 'Copy link'}</button></div>
    ${cap ? `<div class="mrow"><span class="grow small muted">Link shared somewhere it shouldn’t be?</span><button class="btn ghost small" type="button" id="mNewCode">New code</button></div>` : ''}</section>
  <section><h3>Members</h3>${list.map(m => `<div class="mrow"><span class="grow">${esc(m.profiles?.display_name || 'Player')}${m.user_id === me ? ' (you)' : ''}</span><span class="muted small">${m.role === 'captain' ? 'Captain' : 'Player'}</span>${cap && m.user_id !== me ? `<button class="btn ghost small" type="button" data-role="${esc(m.user_id)}" data-to="${m.role === 'captain' ? 'player' : 'captain'}">${m.role === 'captain' ? 'Make player' : 'Make co-captain'}</button><button class="btn danger small" type="button" data-kick="${esc(m.user_id)}">Remove</button>` : ''}</div>`).join('')}</section>` : ''}
  <section id="mPlan"><h3>Your plan</h3>
    <div class="mrow"><span class="grow"><b>${planLine}</b>${account.adFree && !account.captain ? '<span class="muted small" style="display:block">No ads, for good</span>' : ''}</span>
      ${account.captain && !account.grandfathered ? '<button class="btn ghost small" type="button" id="mManage">Manage plan</button>' : !account.captain ? `<button class="btn cta small" type="button" data-upgrade>Captain ${esc(CAPTAIN_PRICE)}</button>` : ''}</div>
    ${!account.adFree ? `<div class="mrow"><span class="grow small muted">Remove ads forever, one payment</span><button class="btn ghost small" type="button" data-adfree>${esc(ADFREE_PRICE)}</button></div>` : ''}</section>
  <section id="mCal"><h3>Add games to your calendar</h3>
    <p class="small muted" style="margin:0 0 8px">Your games from every team, with the diamond’s address. Updates on its own when the schedule changes.</p>
    ${feed ? `<div class="mrow"><a class="btn small" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener">Google Calendar</a><a class="btn ghost small" href="${esc(webcal)}">Apple or Outlook</a><button class="btn ghost small" type="button" id="mCopyCal">Copy link</button></div>
      <div class="mrow"><span class="grow small muted">Shared the link by mistake?</span><button class="linkish small" type="button" id="mNewCal">Make a new link</button></div>` : '<p class="small muted">Not available yet.</p>'}</section>
  <section id="mPrefs"><h3>Display &amp; accessibility</h3>${prefsForm('mp')}</section>
  <section><h3>Teams</h3>${teams.filter(t => !team || t.id !== team.id).map(t => `<div class="mrow"><span class="grow">${esc(t.name)}</span><button class="btn ghost small" type="button" data-switch="${esc(t.id)}">Switch</button></div>`).join('')}
    <div class="mrow"><button class="btn ghost small" type="button" id="mOther">${team ? 'Join or start another team' : 'Join or start a team'}</button>${team ? `<button class="btn ghost small" type="button" id="mLeave">Leave ${esc(team.name)}</button>` : ''}</div></section>
  ${isAdmin ? `<section id="mAdmin"><h3>Admin</h3><div class="mrow"><span class="grow small muted">Reports, listings and bans for Gear</span><a class="btn small" href="admin.html">Gear admin</a></div></section>` : ''}
  <section id="mAcct"><h3>Account</h3>
    <form class="mrow" id="mName"><label for="mN" class="grow">Your name<input id="mN" type="text" maxlength="40" value="${esc(myName)}"></label><button class="btn small" type="submit" style="align-self:flex-end">Save</button></form>
    <details><summary class="small">Change password</summary><form id="mPw" style="margin-top:8px">${pwField('mPwI', 'New password <span class="muted small">(8 or more)</span>', 'new-password', 'minlength="8"')}<div class="row"><button class="btn small" type="submit">Save password</button></div></form></details>
    <div class="mrow" style="margin-top:8px"><span class="grow small muted">${esc(session.user.email)}</span><button class="btn ghost small" type="button" id="mOut">Log out</button></div>
    <div class="mrow"><span class="grow small muted">Lost a phone, or logged in on a shared computer?</span><button class="btn ghost small" type="button" id="mOutAll">Log out everywhere</button></div>
    <details><summary class="small">Delete my account</summary>
      <p class="small">This removes your login, your name, your sub profile and requests, your gear listings, photos and conversations, and your posts. Teams keep their schedule and stats. It can’t be undone.${account.captain && !account.grandfathered ? ' Cancel your captain plan first (Manage plan above).' : ''}</p>
      <form class="mrow" id="mDel"><input class="grow" id="mDelT" type="text" autocomplete="off" placeholder="Type DELETE" aria-label="Type DELETE to confirm"><button class="btn danger small" type="submit">Delete forever</button></form>
    </details></section>`;
  dlg.showModal();
  bindPrefs(dlg, 'mp'); bindUpgrade(dlg); bindPasswords(dlg);
  if (section) { const s = dlg.querySelector('#' + section); if (s) s.scrollIntoView({ block: 'start' }); }
  const err = t => { dlg.querySelector('#mErr').textContent = t; dlg.querySelector('#mErr').scrollIntoView({ block: 'nearest' }); };
  const reopen = () => teamMenu(session, account, team, teams, myName);
  dlg.querySelector('#mClose').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  if (team) dlg.querySelector('#mShare').onclick = async e => {
    try { if (navigator.share) await navigator.share({ title: `Join ${team.name} on Dugout`, url: link }); else { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } }
    catch (x) { if (x && x.name !== 'AbortError') prompt('Copy this link', link); }
  };
  const nc = dlg.querySelector('#mNewCode');
  if (nc) nc.onclick = async () => {
    if (!confirm('Make a new code? The old link will stop working for anyone who hasn’t joined yet.')) return;
    const { data, error } = await sb.rpc('reset_join_code', { p_team: team.id });
    if (error) return err(friendly(error, 'Couldn’t make a new code.'));
    team.join_code = data; reopen();
  };
  const mm = dlg.querySelector('#mManage'); if (mm) mm.onclick = async () => { mm.disabled = true; try { await managePlan(); } catch (_) { mm.disabled = false; err('Couldn’t open your plan settings. Try again.'); } };
  const cc = dlg.querySelector('#mCopyCal'); if (cc) cc.onclick = async () => { try { await navigator.clipboard.writeText(feed); cc.textContent = 'Copied'; } catch (_) { prompt('Copy this link into your calendar app', feed); } };
  const ncal = dlg.querySelector('#mNewCal'); if (ncal) ncal.onclick = async () => { const { data, error } = await sb.rpc('reset_cal_token'); if (error) return err('Couldn’t make a new link.'); account.cal_token = data; reopen(); };
  dlg.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('team_members').update({ role: b.dataset.to }).match({ team_id: team.id, user_id: b.dataset.role });
    if (error) return err(friendly(error, 'Couldn’t change that.')); reopen();
  });
  dlg.querySelectorAll('[data-kick]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this person from the team?')) return;
    const { error } = await sb.from('team_members').delete().match({ team_id: team.id, user_id: b.dataset.kick });
    if (error) return err(friendly(error, 'Couldn’t remove them.')); reopen();
  });
  dlg.querySelector('#mName').onsubmit = async e => {
    e.preventDefault(); const n = dlg.querySelector('#mN').value.trim();
    const { error } = await sb.from('profiles').update({ display_name: n }).eq('id', me);
    if (error) return err('Couldn’t save your name.'); e.submitter.textContent = 'Saved'; myName = n;
  };
  dlg.querySelector('#mPw').onsubmit = async e => {
    e.preventDefault(); const v = dlg.querySelector('#mPwI').value;
    if (v.length < 8) return err('Use at least 8 characters.');
    const { error } = await sb.auth.updateUser({ password: v });
    if (error) return err(/same|different/i.test(error.message) ? 'That’s your current password. Pick a new one.' : 'Couldn’t change it. Log out and use “Forgot password?”.');
    e.submitter.textContent = 'Saved'; dlg.querySelector('#mPwI').value = '';
  };
  dlg.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => { LS.set('team', b.dataset.switch); location.reload(); });
  dlg.querySelector('#mOther').onclick = () => { location.href = location.pathname + '?teams'; };
  if (team) dlg.querySelector('#mLeave').onclick = async () => {
    if (!confirm(`Leave ${team.name}? You’ll need a new invite to come back.`)) return;
    const { error } = await sb.from('team_members').delete().match({ team_id: team.id, user_id: me });
    if (error) return err(friendly(error, 'Couldn’t leave the team.'));
    LS.set('team', null); location.href = location.pathname + '?teams';
  };
  dlg.querySelector('#mOut').onclick = () => sb.auth.signOut();
  dlg.querySelector('#mOutAll').onclick = async () => { if (!confirm('Log out on every phone and computer?')) return; await sb.auth.signOut({ scope: 'global' }); };
  dlg.querySelector('#mDel').onsubmit = async e => {
    e.preventDefault();
    if (dlg.querySelector('#mDelT').value.trim().toUpperCase() !== 'DELETE') return err('Type DELETE to confirm.');
    e.submitter.disabled = true;
    // listing photos live in file storage, which the database can't clean up by itself: remove them first
    try {
      const b = sb.storage.from('listing-photos'), { data: folders } = await b.list(me, { limit: 1000 });
      for (const f of folders || []) { const { data: files } = await b.list(`${me}/${f.name}`, { limit: 100 }); if (files && files.length) await b.remove(files.map(x => `${me}/${f.name}/${x.name}`)); }
    } catch (_) {}
    const { error } = await sb.rpc('delete_my_account');
    if (error) { e.submitter.disabled = false; return err(friendly(error, 'Couldn’t delete your account. Try again, or email us.')); }
    forgetDevice(); await sb.auth.signOut().catch(() => {}); location.replace(location.pathname);
  };
}
