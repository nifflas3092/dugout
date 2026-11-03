/* Start-up: sign in with an emailed code or link, pick or join a team, then open the team app. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { createPlatform } from './platform.js';
import { startApp } from './app.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get(k) { try { return localStorage.getItem('dugout-' + k); } catch (_) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem('dugout-' + k) : localStorage.setItem('dugout-' + k, v); } catch (_) {} } };
const forgetDevice = () => { try { Object.keys(localStorage).filter(k => k.startsWith('dugout-')).forEach(k => localStorage.removeItem(k)); } catch (_) {} };
const gate = document.getElementById('gate'), appEl = document.getElementById('app');
const crest = '<div class="crest" aria-hidden="true">D</div>';
const footer = '<footer><a href="privacy.html">Privacy</a></footer>';
// errors raised by the database's own checks are written for people; anything else gets a generic line
const friendly = (error, fallback) => (error && error.code === 'P0001' && error.message && error.message.length < 120 ? error.message : fallback);

function showGate(html) { appEl.hidden = true; gate.hidden = false; gate.innerHTML = `<div class="gate"><div class="brand">${crest}<h1>Dugout</h1></div>${html}${footer}</div>`; }

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  showGate(`<div class="panel"><h2>Almost there</h2><p>Dugout isn’t connected to a database yet. Put your Supabase project URL and public key in <b>config.js</b>, then reload.</p></div>`);
  throw new Error('config.js not filled in');
}
if (!window.supabase || !window.supabase.createClient) {
  showGate(`<div class="panel"><h2>Can’t load Dugout</h2><p>Part of the app didn’t download. Check your connection and reload.</p></div>`);
  throw new Error('supabase-js did not load');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });

// keep an invite code across the sign-in round trip (codes are letters and digits only)
const params = new URLSearchParams(location.search);
if (params.get('join')) { LS.set('join', params.get('join').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)); params.delete('join'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }

let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { forgetDevice(); location.replace(location.pathname); return; }
  if (session && !started) { started = true; setTimeout(() => afterSignIn(session), 0); }
});
const { data: { session } } = await sb.auth.getSession();
if (!session) signInScreen(); else if (!started) { started = true; afterSignIn(session); }

/* ---------- sign in ---------- */
function signInScreen() {
  const pending = LS.get('join');
  showGate(`${pending ? `<div class="notice" style="margin-bottom:14px">You’ve been invited to a team. Sign in to join it.</div>` : ''}
  <form class="panel" id="signin">
    <h2>Sign in</h2>
    <p class="muted">We’ll email you a code. No password to remember.</p>
    <label for="em">Email<input id="em" type="email" autocomplete="email" required maxlength="254"></label>
    <label for="nm">Your name <span class="muted small">(what teammates see)</span><input id="nm" type="text" maxlength="40" autocomplete="name"></label>
    <div class="row"><button class="btn" type="submit">Email me a code</button></div>
    <p class="small" id="msg" role="status"></p>
    <p class="small muted" style="margin:0">By signing in you agree to how we handle your information in our <a href="privacy.html">privacy policy</a>.</p>
  </form>
  <form class="panel" id="codeF" hidden>
    <h2>Enter your code</h2>
    <p class="muted" id="codeHelp"></p>
    <label for="cd">Code from the email<input id="cd" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required style="letter-spacing:.2em;font-size:1.3em"></label>
    <div class="row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" id="back">Use a different email</button></div>
    <p class="small" id="cMsg" role="status"></p>
  </form>`);
  let email = '';
  const signin = document.getElementById('signin'), codeF = document.getElementById('codeF');
  signin.addEventListener('submit', async e => {
    e.preventDefault();
    email = document.getElementById('em').value.trim();
    const name = document.getElementById('nm').value.trim(), msg = document.getElementById('msg'), btn = e.submitter;
    btn.disabled = true; msg.className = 'small'; msg.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, data: name ? { name } : undefined } });
    btn.disabled = false;
    if (error) { msg.className = 'small err'; msg.textContent = /rate|seconds/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the email. Check the address and try again.'; return; }
    msg.textContent = '';
    signin.hidden = true; codeF.hidden = false;
    document.getElementById('codeHelp').innerHTML = `We sent it to <b>${esc(email)}</b>. It can take a minute; check spam too. You can also tap the link in the email on this device.`;
    document.getElementById('cd').focus();
  });
  document.getElementById('back').onclick = () => { codeF.hidden = true; signin.hidden = false; };
  codeF.addEventListener('submit', async e => {
    e.preventDefault();
    const token = document.getElementById('cd').value.replace(/\D/g, ''), cMsg = document.getElementById('cMsg');
    e.submitter.disabled = true; cMsg.className = 'small'; cMsg.textContent = 'Checking…';
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    e.submitter.disabled = false;
    if (error) { cMsg.className = 'small err'; cMsg.textContent = 'That code didn’t work or has expired. Check it, or go back and ask for a new one.'; return; }
    cMsg.textContent = 'Signed in.';
  });
}

/* ---------- pick a team ---------- */
async function myTeams(uid) {
  const { data, error } = await sb.from('team_members').select('role, teams(id, name, join_code)').eq('user_id', uid);
  if (error) throw error;
  return data.filter(r => r.teams).map(r => ({ ...r.teams, role: r.role })).sort((a, b) => a.name.localeCompare(b.name));
}

async function afterSignIn(session) {
  const code = LS.get('join');
  if (code) {
    LS.set('join', null);
    const { data, error } = await sb.rpc('join_team', { code });
    if (error) return teamsScreen(session, friendly(error, 'That invite link didn’t work.') + ' Ask your captain for a new one.');
    LS.set('team', data);
  }
  let teams;
  try { teams = await myTeams(session.user.id); } catch (e) { return showGate(`<div class="panel"><h2>Can’t reach Dugout</h2><p>Check your connection and reload.</p></div>`); }
  if (new URLSearchParams(location.search).has('teams')) { history.replaceState(null, '', location.pathname); return teamsScreen(session, '', teams); }
  const pick = teams.find(t => t.id === LS.get('team'));
  if (pick) return openTeam(session, pick, teams);
  if (teams.length === 1) return openTeam(session, teams[0], teams);
  teamsScreen(session, '', teams);
}

async function teamsScreen(session, note = '', teams) {
  if (!teams) { try { teams = await myTeams(session.user.id); } catch (_) { teams = []; } }
  showGate(`${note ? `<div class="notice" style="margin-bottom:14px">${esc(note)}</div>` : ''}
  ${teams.length ? `<div class="panel"><h2>Your teams</h2><ul class="teamlist">${teams.map(t => `<li><button type="button" data-team="${esc(t.id)}"><b>${esc(t.name)}</b><span class="muted small">${t.role === 'captain' ? 'Captain' : 'Player'}</span></button></li>`).join('')}</ul></div>` : ''}
  <form class="panel" id="joinF"><h2>Join a team</h2><p class="muted">Use the invite link from your captain, or type the team code.</p>
    <label for="jc">Team code<input id="jc" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" required style="text-transform:uppercase;letter-spacing:.1em"></label>
    <div class="row"><button class="btn" type="submit">Join</button></div><p class="small err" id="jMsg" role="status"></p></form>
  <form class="panel" id="newF"><h2>Start a team</h2><p class="muted">You’ll be the captain. Invite players after.</p>
    <label for="tn">Team name<input id="tn" type="text" maxlength="40" required></label>
    <div class="row"><button class="btn" type="submit">Create team</button></div><p class="small err" id="nMsg" role="status"></p></form>
  <p class="small muted">Signed in as ${esc(session.user.email)}. <button class="chip-btn" type="button" id="so">Sign out</button></p>`);
  gate.querySelectorAll('[data-team]').forEach(b => b.onclick = () => openTeam(session, teams.find(t => t.id === b.dataset.team), teams));
  document.getElementById('so').onclick = () => sb.auth.signOut();
  document.getElementById('joinF').onsubmit = async e => {
    e.preventDefault(); e.submitter.disabled = true;
    const { data, error } = await sb.rpc('join_team', { code: document.getElementById('jc').value });
    e.submitter.disabled = false;
    if (error) { document.getElementById('jMsg').textContent = friendly(error, 'Couldn’t join. Try again.'); return; }
    LS.set('team', data); afterSignIn(session);
  };
  document.getElementById('newF').onsubmit = async e => {
    e.preventDefault(); const name = document.getElementById('tn').value.trim(); e.submitter.disabled = true;
    const { data, error } = await sb.rpc('create_team', { team_name: name });
    if (error) { e.submitter.disabled = false; document.getElementById('nMsg').textContent = friendly(error, 'Couldn’t create the team. Try again.'); return; }
    LS.set('team', data); afterSignIn(session);
  };
}

async function openTeam(session, team, teams) {
  LS.set('team', team.id);
  const { data: prof } = await sb.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
  const platform = createPlatform(sb, { session, teamId: team.id, role: team.role, profileName: prof?.display_name || '' });
  gate.hidden = true; appEl.hidden = false;
  const tools = appEl.querySelector('.tools');
  const mb = document.createElement('button'); mb.className = 'chip-btn'; mb.type = 'button'; mb.textContent = 'Team menu'; mb.setAttribute('aria-haspopup', 'dialog');
  tools.prepend(mb); mb.onclick = () => teamMenu(session, team, teams, prof?.display_name || '');
  startApp(platform);
}

/* ---------- team menu: invites, members, your account ---------- */
async function teamMenu(session, team, teams, myName) {
  let dlg = document.getElementById('menu'); if (dlg) dlg.remove();
  dlg = document.createElement('dialog'); dlg.id = 'menu'; dlg.className = 'menu'; dlg.setAttribute('aria-labelledby', 'menuT'); document.body.append(dlg);
  const me = session.user.id, cap = team.role === 'captain';
  const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(team.join_code)}`;
  const { data: members } = await sb.from('team_members').select('user_id, role, profiles(display_name)').eq('team_id', team.id).order('joined_at');
  const list = members || [];
  dlg.innerHTML = `<div class="mhead"><h2 id="menuT">${esc(team.name)}</h2><button class="btn ghost small" type="button" id="mClose">Close</button></div>
  <p class="small err" id="mErr" role="alert" style="margin:0;padding:0 16px"></p>
  <section><h3>Invite players</h3>
    <p class="small muted" style="margin:0 0 8px">Send this link in your team chat. Anyone with it can join as a player.</p>
    <div class="mrow"><span class="grow">Code <code>${esc(team.join_code)}</code></span><button class="btn small" type="button" id="mShare">${navigator.share ? 'Share link' : 'Copy link'}</button></div>
    ${cap ? `<div class="mrow"><span class="grow small muted">Link shared somewhere it shouldn’t be?</span><button class="btn ghost small" type="button" id="mNewCode">New code</button></div>` : ''}</section>
  <section><h3>Members</h3>${list.map(m => `<div class="mrow"><span class="grow">${esc(m.profiles?.display_name || 'Player')}${m.user_id === me ? ' (you)' : ''}</span><span class="muted small">${m.role === 'captain' ? 'Captain' : 'Player'}</span>${cap && m.user_id !== me ? `<button class="btn ghost small" type="button" data-role="${esc(m.user_id)}" data-to="${m.role === 'captain' ? 'player' : 'captain'}">${m.role === 'captain' ? 'Make player' : 'Make captain'}</button><button class="btn danger small" type="button" data-kick="${esc(m.user_id)}">Remove</button>` : ''}</div>`).join('')}</section>
  <section><h3>Your name</h3><form class="mrow" id="mName"><input class="grow" id="mN" type="text" maxlength="40" value="${esc(myName)}" aria-label="Your name"><button class="btn small" type="submit">Save</button></form></section>
  <section><h3>Teams</h3>${teams.filter(t => t.id !== team.id).map(t => `<div class="mrow"><span class="grow">${esc(t.name)}</span><button class="btn ghost small" type="button" data-switch="${esc(t.id)}">Switch</button></div>`).join('')}
    <div class="mrow"><button class="btn ghost small" type="button" id="mOther">Join or start another team</button><button class="btn ghost small" type="button" id="mLeave">Leave ${esc(team.name)}</button></div></section>
  <section><h3>Account</h3>
    <div class="mrow"><span class="grow small muted">${esc(session.user.email)}</span><button class="btn ghost small" type="button" id="mOut">Sign out</button></div>
    <details><summary class="small">Delete my account</summary>
      <p class="small">This removes your sign-in, your name, your sub profile and requests, and your board posts. Teams keep their schedule and stats. It can’t be undone.</p>
      <form class="mrow" id="mDel"><input class="grow" id="mDelT" type="text" autocomplete="off" placeholder="Type DELETE" aria-label="Type DELETE to confirm"><button class="btn danger small" type="submit">Delete forever</button></form>
    </details></section>`;
  dlg.showModal();
  const err = t => { dlg.querySelector('#mErr').textContent = t; dlg.querySelector('#mErr').scrollIntoView({ block: 'nearest' }); };
  const reopen = () => teamMenu(session, team, teams, myName);
  dlg.querySelector('#mClose').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.querySelector('#mShare').onclick = async e => {
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
  dlg.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => { LS.set('team', b.dataset.switch); location.reload(); });
  dlg.querySelector('#mOther').onclick = () => { location.href = location.pathname + '?teams'; };
  dlg.querySelector('#mLeave').onclick = async () => {
    if (!confirm(`Leave ${team.name}? You’ll need a new invite to come back.`)) return;
    const { error } = await sb.from('team_members').delete().match({ team_id: team.id, user_id: me });
    if (error) return err(friendly(error, 'Couldn’t leave the team.'));
    LS.set('team', null); location.href = location.pathname + '?teams';
  };
  dlg.querySelector('#mOut').onclick = () => sb.auth.signOut();
  dlg.querySelector('#mDel').onsubmit = async e => {
    e.preventDefault();
    if (dlg.querySelector('#mDelT').value.trim().toUpperCase() !== 'DELETE') return err('Type DELETE to confirm.');
    e.submitter.disabled = true;
    const { error } = await sb.rpc('delete_my_account');
    if (error) { e.submitter.disabled = false; return err(friendly(error, 'Couldn’t delete your account. Try again, or email us.')); }
    forgetDevice(); await sb.auth.signOut().catch(() => {}); location.replace(location.pathname);
  };
}
