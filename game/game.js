/* Slowpitch Showdown: input, rendering and game flow. */

/* =================== APP: input, 3D rendering, flow =================== */
(() => {
const cv = document.getElementById('cv');
let ctx = cv.getContext('2d');
// the stadium and field are drawn once into this layer and reused until the camera moves
const BG = { cv: document.createElement('canvas'), sig: '' }; BG.ctx = BG.cv.getContext('2d');
const ov = document.createElement('canvas'), ovCtx = ov.getContext('2d'); ov.className = 'layer'; cv.after(ov); // guides and overlays above the 3D players
const stage = document.getElementById('stage');
const $ = id => document.getElementById(id);
let W = 0, H = 0, DPR = 1;
const mouse = { sx: 0, sy: 0, down: false, seen: false, dxAcc: 0, bdx: 0, bdy: 0 };
let soundOn = true, actx = null;
let sparks = [];
let menuMode = '2p', menuInn = 3, menuBuild = 'normal';
try { const b = localStorage.getItem('fpd-build'); if (b && BUILDS[b]) menuBuild = b; } catch (_) {}

/* ---------- vector helpers ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/* ---------- camera ---------- */
const CAMS = {
  bat: { pos: [0, 2.6, -9.5], tgt: [0, 2.6, 20], fov: 58 }, // low behind the plate, about knee-high, looking up the pitch's path
  pitch: { pos: [2.4, 9.4, 67], tgt: [-0.2, 0.9, 0], fov: 31 }, // behind and above the pitcher, looking in at the batter
};
const cam = { pos: [...CAMS.bat.pos], tgt: [...CAMS.bat.tgt], fov: 50, key: 'bat', shake: 0, sx: 0, sy: 0 };
let F, R, U, focal;
function basis() {
  F = norm(sub(cam.tgt, cam.pos));
  R = norm([F[2], 0, -F[0]]);
  U = cross(F, R);
  focal = H / (2 * Math.tan(cam.fov * D2R / 2));
}
function toCam(p) { if (MIRX) p = [-p[0], p[1], p[2]]; const v = sub(p, cam.pos); return [dotv(v, R), dotv(v, U), dotv(v, F)]; }
function projC(c) { const s = focal / c[2]; return [W / 2 + c[0] * s + cam.sx, H / 2 - c[1] * s + cam.sy, s]; }
let MIRX = false; // drawing a lefty: reflect his points across the middle of the field
function P(p) { const c = toCam(p); if (c[2] < 0.25) return null; return projC(c); }
function mouseRay(sx, sy) { const xn = (sx - W / 2) / focal, yn = (H / 2 - sy) / focal; return norm(addv(addv(F, mul(R, xn)), mul(U, yn))); }

function camKey() {
  if (S && (S.phase === 'batted' || S.phase === 'result') && S.batted) return 'field';
  if (S && humanPitches() && ['windup', 'throwing', 'flight', 'waitPlay', 'replay', 'wait', 'result'].includes(S.phase)) return 'pitch'; // one static shot for the whole pitch
  return 'bat';
}
function updateCam(dt) {
  const key = camKey();
  if (key === 'field') {
    const b = S.ball, d = hyp(b.x, b.z), pr = S.batted && S.batted.pred;
    const far = pr && !isTargets() && (pr.overFence || pr.wall || (pr.land && hyp(pr.land.x, pr.land.z) > 150));
    let pos, tgt;
    if (far) { // deep drive: ride out behind the ball so the wall comes up to meet it
      const dir = d > 1 ? [b.x / d, b.z / d] : [0, 1], back = clamp(d - 55, -30, FENCE_R - 38), off = 10;
      pos = [dir[0] * back + dir[1] * off, 8 + b.y * 0.35, dir[1] * back - dir[0] * off];
      tgt = [b.x + dir[0] * 12, Math.max(4, b.y * 0.75), b.z + dir[1] * 12];
    } else {
      pos = [b.x * 0.22, 15 + d * 0.15 + b.y * 0.3, -30 - d * 0.06];
      tgt = [b.x * 0.78, Math.max(2, b.y * 0.6), b.z * 0.78 + 6];
    }
    const k = 1 - Math.exp(-dt * (far ? 3.8 : 3.2)); cam.fov = far ? 42 : 50;
    cam.pos = lerp3(cam.pos, pos, k); cam.tgt = lerp3(cam.tgt, tgt, k);
  } else {
    const c = CAMS[key]; cam.fov = c.fov;
    if (key !== cam.key && !(isTargets() && cam.key === 'field')) { cam.pos = [...c.pos]; cam.tgt = [...c.tgt]; } // target practice glides back to the plate
    else { const k = 1 - Math.exp(-dt * 6); cam.pos = lerp3(cam.pos, c.pos, k); cam.tgt = lerp3(cam.tgt, c.tgt, k); }
  }
  cam.key = key;
  if (cam.shake > 0.3) { cam.sx = (Math.random() - .5) * cam.shake; cam.sy = (Math.random() - .5) * cam.shake; cam.shake *= Math.exp(-dt * 10); }
  else { cam.sx = cam.sy = 0; cam.shake = 0; }
  basis();
}

/* ---------- hooks used by core ---------- */
let bannerTimer = 0;
const hooks = {
  banner(text, sub, size) {
    const el = $('banner');
    el.className = 'banner' + (size ? ' ' + size : '');
    el.innerHTML = ''; el.append(text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
    el.hidden = false; void el.offsetWidth; el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.hidden = true; }, size === 'huge' ? 2600 : 1600);
  },
  sound: play,
  newGame() { // the park and weather for this game: your picks, or (online) the same weather on both screens
    S.myBats = menuBats; S.myThrows = menuThrows;
    if (S.mode !== 'online') S.oppThrows = Math.random() < 0.25 ? 'L' : 'R'; // about one CPU pitcher in four is a lefty
    if (S.mode === 'online' || rankedNext) applyConditions('stadium', 'sunny', S.gid);
    else if (!S.rogue) applyConditions(menuPark, menuWx);
  },
  spark(x, y, z, sp) { for (let i = 0; i < 14 + sp / 8; i++) { const v = norm([Math.random() - .5, Math.random() - .5, Math.random() - .5]), m = 6 + Math.random() * sp / 6; sparks.push({ p: [x, y, z], v: mul(v, m), life: 0.3 + Math.random() * 0.25 }); } },
  shake(sp) { cam.shake = Math.min(16, sp / 10); },
};

/* ---------- audio ---------- */
function ac() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } if (actx) setTimeout(() => crowd.start(), 0); } return actx; }
function noise(dur, freq, q, gain, type = 'bandpass') {
  const a = ac(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination); src.start();
}
function tone(freq, dur, gain, type = 'sine', slide = 0) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
/* the ping of an aluminum bat: a sharp click, then a few metallic partials ringing at slightly off-harmonic ratios */
function ping(k) {
  const a = ac(); if (!a) return; const t = a.currentTime, out = a.createGain(); out.gain.value = 0.55 * k; out.connect(a.destination);
  noise(0.025, 4200, 0.9, 0.5 * k, 'highpass');
  for (const [f, g, d] of [[1240, 0.5, 0.45], [2310, 0.35, 0.32], [3530, 0.22, 0.22], [5010, 0.12, 0.14], [880, 0.18, 0.2]]) {
    const o = a.createOscillator(), e = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f * (1.04 + 0.04 * k), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(g, t + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, t + d * (0.6 + 0.6 * k));
    o.connect(e).connect(out); o.start(t); o.stop(t + d * 1.3 + 0.05);
  }
}
/* the crowd: a steady murmur, the odd cheer, a few rounds of clapping and a whistle, and reactions to the play.
   All made on the fly (no audio files). */
const crowd = (() => {
  let bus = null, bed = null, next = 0;
  const loopNoise = (a, secs) => { const n = a.sampleRate * secs, b = a.createBuffer(2, n, a.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let l = 0; for (let i = 0; i < n; i++) { l = l * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = l * 6 + (Math.random() * 2 - 1) * 0.12; } } const s = a.createBufferSource(); s.buffer = b; s.loop = true; return s; };
  function start() {
    const a = ac(); if (!a || bus) return;
    bus = a.createGain(); bus.gain.value = soundOn ? 1 : 0; bus.connect(a.destination);
    // the murmur: two bands of babble that slowly breathe
    for (const [f, q, g, r] of [[480, 0.7, 0.05, 0.11], [1150, 1.1, 0.025, 0.07]]) {
      const s = loopNoise(a, 3), fl = a.createBiquadFilter(), gn = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; gn.gain.value = g; lfo.frequency.value = r; lg.gain.value = g * 0.4;
      lfo.connect(lg).connect(gn.gain); s.connect(fl).connect(gn).connect(bus); s.start(); lfo.start();
    }
    bed = true; next = a.currentTime + 3;
  }
  const swell = (peak, up, down, f = 1000, q = 0.5) => { // a group of voices rising and falling
    const a = ac(); if (!a || !bus) return; const t = a.currentTime, s = loopNoise(a, 2), fl = a.createBiquadFilter(), g = a.createGain();
    fl.type = 'bandpass'; fl.frequency.setValueAtTime(f * 0.8, t); fl.frequency.linearRampToValueAtTime(f * 1.15, t + up); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + up); g.gain.exponentialRampToValueAtTime(0.0001, t + up + down);
    s.connect(fl).connect(g).connect(bus); s.start(t); s.stop(t + up + down + 0.1);
  };
  const claps = (n, dur, vol) => { const a = ac(); if (!a || !bus) return; const t = a.currentTime;
    for (let i = 0; i < n; i++) { const at = t + Math.random() * dur, s = a.createBufferSource(), len = Math.floor(a.sampleRate * 0.03), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 4); s.buffer = b;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 1400; f.Q.value = 1.2; const g = a.createGain(); g.gain.value = vol * (0.4 + Math.random() * 0.6);
      s.connect(f).connect(g).connect(bus); s.start(at); } };
  const whistle = () => { const a = ac(); if (!a || !bus) return; const t = a.currentTime, o = a.createOscillator(), g = a.createGain(), f0 = 1900 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.18); o.frequency.linearRampToValueAtTime(f0 * 1.1, t + 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.04, t + 0.04); g.gain.setValueAtTime(0.04, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.65); };
  function tick() { // random background moments
    const a = actx; if (!a || !bus || a.currentTime < next) return;
    const r = Math.random();
    if (r < 0.35) swell(0.05, 0.4, 1.4, 900 + Math.random() * 500); else if (r < 0.65) claps(25 + Math.random() * 30, 1.6, 0.06); else if (r < 0.8) whistle(); else swell(0.03, 0.2, 0.8, 700);
    next = a.currentTime + 4 + Math.random() * 7;
  }
  return {
    start, tick, setOn(on) { if (bus) bus.gain.setTargetAtTime(on ? 1 : 0, actx.currentTime, 0.1); },
    react(k) { swell(0.07 * k, 0.25, 1.2 + k, 1100); }, // the crowd rises with a hard-hit ball
    roar() { swell(0.22, 0.35, 3.2, 1050, 0.4); swell(0.12, 0.5, 2.6, 1700, 0.8); claps(90, 3, 0.09); whistle(); }, // home run
    groan() { swell(0.06, 0.15, 0.9, 520, 0.8); },
  };
})();
function play(name) {
  if (!soundOn || !ac()) return;
  if (actx.state === 'suspended') actx.resume();
  switch (name) {
    case 'crack': ping(1); crowd.react(1); break; // aluminum bat: a bright PING
    case 'thwack': ping(0.7); crowd.react(0.5); break;
    case 'tick': ping(0.35); break;
    case 'mitt': noise(0.07, 600, 1.5, 0.8); tone(110, 0.08, 0.3); break;
    case 'whoosh': break; // the pitch leaves the hand silently
    case 'wall': noise(0.12, 300, 1, 0.6); break;
    case 'knock': noise(0.045, 260, 2.2, 0.9); tone(170, 0.13, 0.45, 'triangle', -70); tone(95, 0.16, 0.3, 'sine', -25); break; // the plywood board: a hollow wooden knock
    case 'thud': noise(0.06, 160, 0.8, 0.35, 'lowpass'); break; // into the dirt
    case 'thunder': { const a = ac(); if (!a) break; noise(1.8, 90, 0.4, 1.1, 'lowpass'); setTimeout(() => noise(1.2, 60, 0.3, 0.8, 'lowpass'), 250); break; }
    case 'cheer': crowd.roar(); break;
  }
}

/* ---------- conditions: the park and the weather ---------- */
let menuPark = 'stadium', menuWx = 'sunny', menuBats = 'R', menuThrows = 'R';
try { menuBats = localStorage.getItem('fpd-bats') || 'R'; menuThrows = localStorage.getItem('fpd-throws') || 'R'; } catch (_) {}
try { menuPark = localStorage.getItem('fpd-park') || 'stadium'; menuWx = localStorage.getItem('fpd-wx2') || 'sunny'; } catch (_) {}
let PARK = 'stadium';
const WX = { kind: 'sunny', label: 'Sunny', parts: [], flash: 0, nextBolt: 0, t: 0, funnel: 0, silly: '🦆', gustBase: [0, 0] };
const WX_LABEL = { sunny: '☀ Sunny', rain: '🌧 Rain', snow: '❄ Snow', storm: '⛈ Thunderstorm', tornado: '🌪 Tornado warning', silly: '🦆 Silly weather' };
const SILLY = ['🦆', '🌭', '🐸', '🍕', '⚾', '🐟', '🥨', '🎈'];
// the same game id gives the same weather on both screens (online)
function seeded(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function pickWeather(choice, rnd) {
  if (choice !== 'random') return choice;
  const r = rnd();
  return r < 0.45 ? 'sunny' : r < 0.62 ? 'rain' : r < 0.74 ? 'snow' : r < 0.85 ? 'storm' : r < 0.92 ? 'silly' : 'tornado';
}
function applyConditions(park, wxChoice, seed) {
  const rnd = seeded(seed || Math.random());
  PARK = park === 'hampton' ? 'hampton' : 'stadium';
  FENCE_H = PARK === 'hampton' ? 6 : 10;                 // Hampton's chain-link is lower than the stadium's padded wall
  const kind = pickWeather(wxChoice || 'random', rnd);
  WX.kind = kind; WX.parts = []; WX.flash = 0; WX.t = 0; WX.nextBolt = 4 + rnd() * 6;
  WX.silly = SILLY[Math.floor(rnd() * SILLY.length)];
  FIELD.wet = kind === 'rain' || kind === 'storm' ? 1 : kind === 'snow' ? 0.6 : 0;
  // a prevailing wind for the game, gusting a little pitch to pitch (ft/s^2; 1 is a light breeze)
  const ang = rnd() * Math.PI * 2, base = { sunny: 0.6, rain: 1.2, snow: 1.0, storm: 3.2, tornado: 6.5, silly: 0.8 }[kind] * (0.6 + rnd() * 0.6);
  WX.gustBase = [Math.sin(ang) * base, Math.cos(ang) * base]; WX.rnd = rnd;
  gust();
  BG.sig = ''; updateWxLine();
}
function gust() { // between pitches: the wind shifts a bit (a lot in a tornado)
  const r = WX.rnd || Math.random, k = WX.kind === 'tornado' ? 1 : 0.35;
  let [x, z] = WX.gustBase;
  if (WX.kind === 'tornado') { const a = (WX.spin = (WX.spin || 0) + 0.9 + r() * 0.8), m = Math.hypot(x, z); x = Math.sin(a) * m; z = Math.cos(a) * m; }
  WIND.x = x * (1 + (r() - 0.5) * k); WIND.z = z * (1 + (r() - 0.5) * k);
  if (S && S.rogue) WIND.z += S.rogue.tail * 2.7; // Tailwind perk: about 6 mph blowing out per pick
  updateWxLine();
}
function updateWxLine() {
  const el = $('wxline'); if (!el) return;
  const mph = Math.round(Math.hypot(WIND.x, WIND.z) * 2.2);   // a feel number, not a forecast
  const dir = Math.abs(WIND.z) > Math.abs(WIND.x) ? (WIND.z > 0 ? 'blowing out' : 'blowing in') : (WIND.x > 0 ? 'to right' : 'to left');
  el.textContent = `${WX_LABEL[WX.kind] || ''}${mph >= 2 ? ` · wind ${mph} mph ${dir}` : ''}${PARK === 'hampton' ? ' · Hampton Park' : ''}`;
}
/* weather on screen: particles in screen space, a darker sky, lightning, a funnel cloud out past the trees */
function drawWeather(dt) {
  const g = ctx; WX.t += dt;
  const k = WX.kind; if (k === 'sunny') return;
  const tint = { rain: 'rgba(40,52,66,.22)', storm: 'rgba(20,26,40,.36)', snow: 'rgba(235,240,248,.16)', tornado: 'rgba(48,62,40,.34)', silly: 'rgba(255,200,240,.06)' }[k];
  if (tint) { g.fillStyle = tint; g.fillRect(0, 0, W, H); }
  const want = { rain: 220, storm: 380, snow: 170, tornado: 120, silly: 26 }[k] || 0, sx = WIND.x * 14; // the wind slants it
  while (WX.parts.length < want) WX.parts.push({ x: Math.random() * W, y: Math.random() * H, v: 0.7 + Math.random() * 0.6, r: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 });
  if (WX.parts.length > want) WX.parts.length = want;
  if (k === 'rain' || k === 'storm') {
    g.strokeStyle = k === 'storm' ? 'rgba(200,215,235,.5)' : 'rgba(210,222,240,.42)'; g.lineWidth = 1.2; g.beginPath();
    for (const p of WX.parts) { p.y += 900 * p.v * dt; p.x += sx * 6 * dt; if (p.y > H) { p.y = -20; p.x = Math.random() * W; } if (p.x < -40) p.x += W + 80; if (p.x > W + 40) p.x -= W + 80;
      g.moveTo(p.x, p.y); g.lineTo(p.x + sx * 0.02 * 14, p.y + 16 * p.v); }
    g.stroke();
  } else if (k === 'snow') {
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (const p of WX.parts) { p.y += 60 * p.v * dt; p.x += (sx * 3 + Math.sin(WX.t * 1.3 + p.r) * 18) * dt; if (p.y > H) { p.y = -6; p.x = Math.random() * W; } if (p.x < -10) p.x += W + 20; if (p.x > W + 10) p.x -= W + 20;
      g.beginPath(); g.arc(p.x, p.y, 1.4 + p.s * 1.6, 0, 6.29); g.fill(); }
  } else if (k === 'silly') {
    g.font = '26px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of WX.parts) { p.y += 110 * p.v * dt; p.r += dt * (p.v - 1) * 4; if (p.y > H + 30) { p.y = -30; p.x = Math.random() * W; }
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(p.s * 1.1, p.s * 1.1); g.fillText(WX.silly, 0, 0); g.restore(); }
    // and a rainbow over the outfield
    const c = P([0, 0, 620]); if (c) { const R = Math.min(W, H) * 0.9; ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'].forEach((col, i) => { g.strokeStyle = col; g.globalAlpha = 0.28; g.lineWidth = 8; g.beginPath(); g.arc(c[0], c[1] + R * 0.35, R - i * 8, Math.PI * 1.08, Math.PI * 1.92); g.stroke(); }); g.globalAlpha = 1; }
  } else if (k === 'tornado') {
    // the funnel wanders across the horizon beyond the outfield
    const a = Math.sin(WX.t * 0.05) * 0.7, base = [Math.sin(a) * 900, 0, Math.cos(a) * 900], top = [base[0] + 60, 520, base[2]];
    const pb = P(base), pt = P(top);
    if (pb && pt) {
      for (let i = 0; i < 26; i++) { const u = i / 25, x = pb[0] + (pt[0] - pb[0]) * u + Math.sin(WX.t * 3 + i) * 6 * (1 - u), y = pb[1] + (pt[1] - pb[1]) * u, w = (6 + u * u * 110) * pb[2] * 4;
        g.fillStyle = `rgba(70,78,70,${0.2 + 0.25 * (1 - u)})`; g.beginPath(); g.ellipse(x, y, Math.max(3, w), Math.max(2, w * 0.28), 0, 0, 6.29); g.fill(); }
    }
    g.fillStyle = 'rgba(90,70,50,.7)';
    for (const p of WX.parts) { p.x += (sx * 9 + 140 * p.v) * dt; p.y += Math.sin(WX.t * 4 + p.r) * 40 * dt; if (p.x > W + 20) { p.x = -20; p.y = Math.random() * H; } g.fillRect(p.x, p.y, 3 * p.s, 2 * p.s); }
    if (Math.floor(WX.t * 0.25) !== WX.cowAt) { WX.cowAt = Math.floor(WX.t * 0.25); WX.cow = { x: -40, y: H * (0.2 + Math.random() * 0.3), r: 0 }; }
    if (WX.cow) { WX.cow.x += 260 * dt; WX.cow.r += dt * 5; g.save(); g.translate(WX.cow.x, WX.cow.y); g.rotate(WX.cow.r); g.font = '30px serif'; g.textAlign = 'center'; g.fillText('🐄', 0, 0); g.restore(); }
  }
  if (k === 'storm' || k === 'tornado') { // lightning: a flash, then the thunder a moment later
    WX.nextBolt -= dt;
    if (WX.nextBolt <= 0) { WX.flash = 1; WX.nextBolt = 6 + Math.random() * 9; setTimeout(() => play('thunder'), 500 + Math.random() * 1200);
      WX.bolt = { x: W * (0.15 + Math.random() * 0.7), segs: Array.from({ length: 9 }, () => (Math.random() - 0.5) * 50) }; }
    if (WX.flash > 0) {
      g.fillStyle = `rgba(235,240,255,${WX.flash * 0.55})`; g.fillRect(0, 0, W, H);
      if (WX.bolt && WX.flash > 0.5) { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3; g.beginPath(); let x = WX.bolt.x, y = 0; g.moveTo(x, y); for (const d of WX.bolt.segs) { x += d; y += H * 0.045; g.lineTo(x, y); } g.stroke(); }
      WX.flash = Math.max(0, WX.flash - dt * 3.5);
    }
  }
}

/* ---------- flow ---------- */
/* ranked play: only on the Dugout site, where window.SHOWDOWN_NET (ranked.js) talks to the server */
const NET = () => window.SHOWDOWN_NET || null;
let rankedNext = false;
function rankedOn() { return menuMode === 'cpu' && !!NET() && !!NET().user() && $('rankChk').checked; }
function startCpuGame() {
  leaveOnline();
  const ranked = rankedOn();
  rankedNext = ranked;
  newGame('cpu', ranked ? 3 : menuInn);
  rankedNext = false;
  S.myBuild = ranked ? 'normal' : menuBuild; resetPitch();
  beginGameUI();
  if (ranked) {
    S.ranked = { id: null };
    const gid = S.gid;
    NET().start().then(id => { if (S.gid === gid) S.ranked.id = id; })
      .catch(e => { if (S.gid === gid) { S.ranked = null; hooks.banner('Unranked game', (e && e.message) || 'couldn’t reach the leaderboard', 'small'); } });
  }
}
function submitRanked() {
  const R = S.ranked; if (!R || R.sent) return;
  R.sent = true;
  const me = mySeat(), rf = S.score[me], ra = S.score[1 - me];
  if (!R.id) { $('overNote').textContent += ' This one didn’t count: the leaderboard couldn’t be reached when it started.'; return; }
  $('overNote').textContent += ' Saving to the leaderboard…';
  const note = $('overNote').textContent.replace(' Saving to the leaderboard…', '');
  NET().finish(R.id, { won: rf > ra, strikeouts: Math.min(9, S.myK || 0), home_runs: S.myHR || 0, runs_for: rf, runs_against: ra })
    .then(() => { $('overNote').textContent = note + ` Ranked: ${S.myK || 0} K, ${S.myHR || 0} HR saved.`; })
    .catch(e => { $('overNote').textContent = note + ` Not saved: ${(e && e.message) || 'the leaderboard couldn’t be reached'}.`; });
}
let lbStat = 'wins';
function openBoard() {
  $('lbOverlay').hidden = false;
  document.querySelectorAll('#lbSeg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.stat === lbStat));
  const list = $('lbList'), note = $('lbNote'); list.innerHTML = '';
  if (!NET()) { note.textContent = 'Ranked games and the leaderboard live in Slowpitch Showdown on Dugout: sign in there and turn on Ranked for a Vs CPU game.'; return; }
  if (!NET().user()) { note.textContent = 'Sign in to Dugout to play ranked and see the leaderboard.'; return; }
  note.textContent = 'Loading…';
  const stat = lbStat;
  NET().board(stat).then(rows => {
    if (stat !== lbStat) return;
    note.textContent = rows.length ? 'Totals from ranked Vs CPU games.' : 'No ranked games yet. Be the first on the board.';
    rows.forEach(r => {
      const li = document.createElement('li'); if (r.me) li.className = 'me';
      li.innerHTML = '<span class="n"></span><span class="who"></span><span class="v"></span>';
      li.children[0].textContent = r.rank; li.children[1].textContent = r.name;
      const g = document.createElement('small'); g.textContent = `${r.games} game${r.games == 1 ? '' : 's'}`; li.children[1].append(g);
      li.children[2].textContent = r.value; list.append(li);
    });
  }).catch(e => { note.textContent = 'Couldn’t load the leaderboard: ' + ((e && e.message) || 'try again'); });
}
function rankUI() {
  const n = NET(), u = n && n.user();
  $('rankBox').hidden = !(menuMode === 'cpu' && u);
}
addEventListener('showdown-net', rankUI);
/* practice modes: no score, no innings, just reps and a stat line */
/* ---------- Target Practice: red-and-white bullseyes set out around the field; hit them all before time runs out ---------- */
const TARGET_TIME = 180, TARGET_COUNT = 5;
const isTargets = () => !!(S && S.prac && S.prac.targets);
function targetReachable(d, h, r) { // can a well-struck ball pass through this disc? (launch 0-45 deg, 55-150 ft/s)
  for (let la = 10; la <= 50; la += 2) for (let sp = 90; sp <= 150; sp += 4) {
    let x = 0, y = 3, vx = sp * Math.cos(la * D2R), vy = sp * Math.sin(la * D2R), t = 0; const dt = 1 / 120;
    while (x < d && t < 8) { const s = Math.hypot(vx, vy); vx -= DRAG * s * vx * dt; vy -= (G + DRAG * s * vy) * dt; x += vx * dt; y += vy * dt; t += dt;
      if (y < BALL_R) { if (vy < -4) { vy = -vy * 0.4; vx *= 0.85; y = BALL_R; } else { vy = 0; y = BALL_R; vx *= 1 - dt; } } }
    if (x >= d && Math.abs(y - h) < r * 0.6) return true;
  }
  return false;
}
function makeTargets() {
  const out = []; let guard = 0;
  while (out.length < TARGET_COUNT && guard++ < 2000) {
    // home run targets: out past the wall, between the fence and the stands, the bottom edge above the top of the wall
    const ang = (Math.random() * 2 - 1) * 40 * D2R, d = FENCE_R + 8 + Math.random() * Math.max(4, standR(ang) - FENCE_R - 16), r = 7 + Math.random() * 3;
    const h = FENCE_H + 1 + r + Math.random() * 16;
    if (out.some(o => Math.abs(o.ang - ang) < 14 * D2R)) continue; // spread them around the outfield
    if (!targetReachable(d, h, r)) continue;
    out.push({ ang, d, h, r, x: Math.sin(ang) * d, z: Math.cos(ang) * d, hit: false });
  }
  return out;
}
function checkTargets(prev, cur) { // did the ball pass through any disc between two frames?
  if (!isTargets() || !prev) return;
  for (const tg of S.prac.targets) {
    if (tg.hit) continue;
    const n = [Math.sin(tg.ang), Math.cos(tg.ang)], a0 = prev[0] * n[0] + prev[2] * n[1] - tg.d, a1 = cur[0] * n[0] + cur[2] * n[1] - tg.d;
    if (a0 > 0 || a1 < 0) continue; // crossed the disc's plane, going out
    const k = a0 / (a0 - a1), px = prev[0] + (cur[0] - prev[0]) * k, py = prev[1] + (cur[1] - prev[1]) * k, pz = prev[2] + (cur[2] - prev[2]) * k;
    if (Math.hypot(px - tg.x, py - tg.h, pz - tg.z) <= tg.r + BALL_R) {
      tg.hit = true; S.prac.hitNow = (S.prac.hitNow || 0) + 1;
      play('cheer'); hooks.spark(px, py, pz, 120); hooks.shake(20);
      const left = S.prac.targets.filter(t => !t.hit).length;
      hooks.banner('Target!', left ? `${left} to go` : 'all of them!', left ? 'small' : 'huge'); hud();
    }
  }
}
const DERBY_OUTS = 10;
/* ---------- rogue-lite: score your way through stages, take a perk after each ---------- */
const PERKS = [
  { id: 'barrel', name: 'Big Barrel', text: 'A bigger sweet spot: 20% more room to square it up.', stack: true, take: R => { MODS.hitR *= 1.2; } },
  { id: 'juice', name: 'Juiced Bat', text: 'The ball comes off the bat 8% harder.', stack: true, take: R => { MODS.power *= 1.08; } },
  { id: 'outs', name: 'Extra Outs', text: '+2 outs every stage.', stack: true, take: R => { R.bonusOuts += 2; } },
  { id: 'moon', name: 'Moonshot', text: 'Home runs are worth 6 instead of 4.', take: R => { R.val.hr += 2; } },
  { id: 'gap', name: 'Gap Power', text: 'Doubles and triples are worth 1 more.', take: R => { R.val.double++; R.val.triple++; } },
  { id: 'bloop', name: 'Bloop Bonus', text: 'Singles are worth 2.', take: R => { R.val.single = Math.max(R.val.single, 2); } },
  { id: 'tail', name: 'Tailwind', text: 'About 6 mph of wind blowing out, every stage.', stack: true, take: R => { R.tail++; } },
  { id: 'porch', name: 'Short Porch', text: 'The wall plays 4 ft shorter.', take: R => { R.porch = 4; } },
  { id: 'lob', name: 'Slow Lob', text: 'Pitches float in 15% slower: easier to time.', take: R => { MODS.ts *= 0.85; } },
  { id: 'umbrella', name: 'Umbrella', text: 'Sunny skies for the rest of the run.', take: R => { R.sunny = true; } },
  { id: 'eye', name: 'Batting Eye', text: 'One swing-and-miss per stage is free.', stack: true, take: R => { R.eye++; } },
  { id: 'tape', name: 'Tape Measure', text: 'Home runs score +1 for every 40 ft past 250.', take: R => { R.tape = true; } },
  { id: 'streak', name: 'Hot Streak', text: 'Each hit in a row is worth +1 more than the last (an out resets it).', take: R => { R.streakOn = true; } },
  { id: 'second', name: 'Second Chance', text: 'Your first out each stage doesn’t count.', take: R => { R.second = true; } },
  { id: 'clutch', name: 'Clutch Hitter', text: 'Down to your last out, every hit is worth double.', take: R => { R.clutch = true; } },
  { id: 'lowg', name: 'Low Gravity', text: 'Everything floats: 15% less gravity (the pitches too).', take: R => { MODS.grav *= 0.85; } },
  { id: 'rubber', name: 'Rubber Ball', text: 'The ball jumps 15% harder off the bat, but the sweet spot shrinks 10%.', take: R => { MODS.power *= 1.15; MODS.hitR *= 0.9; } },
  { id: 'giant', name: 'Giant Bat', text: 'The sweet spot grows 35%, but hits come off 6% softer.', take: R => { MODS.hitR *= 1.35; MODS.power *= 0.94; } },
  { id: 'glass', name: 'Glass Cannon', text: 'Home runs are worth double, but you get 2 fewer outs every stage.', take: R => { R.glass = true; R.bonusOuts -= 2; } },
  { id: 'small', name: 'Small Ball', text: 'Singles are worth 3. Home runs drop to 3.', take: R => { R.val.single = 3; R.val.hr = Math.min(R.val.hr, 3); } },
  { id: 'bank', name: 'Piggy Bank', text: 'Points past the target carry into the next stage.', take: R => { R.bank = true; } },
  { id: 'eagle', name: 'Eagle Eye', text: 'Pitches come in as if it were two stages earlier.', stack: true, take: R => { R.ease += 2; } },
  { id: 'coin', name: 'Coin Flip', text: 'Every out has a 1 in 3 chance of being called back.', take: R => { R.coin = true; } },
  { id: 'scout', name: 'Scouting Report', text: 'No more knuckleballs from the CPU.', take: R => { R.noKnuck = true; } },
];
const ROGUE = {
  fresh: () => ({ stage: 1, pts: 0, total: 0, outs: 0, outsMax: 6, need: 5, bonusOuts: 0, val: { single: 1, double: 2, triple: 3, hr: 4 }, perks: [], tail: 0, porch: 0, sunny: false, eye: 0, eyeLeft: 0, hr: 0, hits: 0,
    tape: false, streakOn: false, streak: 0, second: false, secondLeft: false, clutch: false, glass: false, bank: false, ease: 0, coin: false, noKnuck: false, longest: 0 }),
  best() { try { return JSON.parse(localStorage.getItem('fpd-rogue-best') || 'null'); } catch (_) { return null; } },
  stageStart() {
    const R = S.rogue, carry = R.bank ? Math.max(0, R.pts - R.need) : 0;
    R.need = 3 + 2 * R.stage; R.pts = R.stage > 1 ? carry : 0; R.outs = 0; R.outsMax = Math.max(2, 6 + R.bonusOuts); R.eyeLeft = R.eye; R.secondLeft = R.second; R.streak = 0;
    applyConditions(menuPark, R.sunny ? 'sunny' : R.stage === 1 ? 'sunny' : 'random'); // weather rolls fresh every stage after the first
    FENCE_H = Math.max(3, FENCE_H - R.porch);
    gust(); updateWxLine();
  },
  pitch() { // the CPU lobs get nastier as the stages go up: wider, more arc range, some spin, and later the odd knuckleball
    const R = S.rogue, k = Math.min(1, Math.max(0, R.stage - 1 - R.ease) / 6), r = Math.random;
    const spin = r() < 0.15 + 0.5 * k ? [3, (r() < 0.5 ? -1 : 1) * (2 + 4 * k), 0] : [3, 0, 0];
    const P = computeLob((r() - 0.5) * (0.7 + 1.1 * k), -0.5 + r() * (1.2 + 0.8 * k), 8.4 - 2.2 * k + r() * (2.2 + 4.6 * k), spin);
    return !R.noKnuck && k > 0.3 && r() < 0.25 * k ? knuckleize(P, undefined, true) : P;
  },
  result(contact) {
    const R = S.rogue, P = S.prac;
    let res, out = null;
    const outCall = (text) => {
      R.streak = 0;
      if (R.secondLeft) { R.secondLeft = false; return { text, sub: 'Second Chance: that one doesn’t count', size: 'small' }; }
      if (R.coin && Math.random() < 1 / 3) return { text, sub: 'Coin Flip: called back, no out', size: 'small' };
      R.outs++; return { text, sub: `out ${R.outs} of ${R.outsMax} · ${Math.max(0, R.need - R.pts)} points to go`, size: '' };
    };
    if (contact) {
      P.swings++; out = S.batted.out;
      let pts = R.val[out.type] || 0;
      if (pts) {
        let extra = '', dist = 0;
        if (out.type === 'hr') {
          R.hr++; dist = Math.round(hrDistance()); P.longest = Math.max(P.longest, dist); R.longest = Math.max(R.longest, dist);
          if (R.tape && dist > 250) { const t = Math.floor((dist - 250) / 40); if (t) { pts += t; extra += ` · tape +${t}`; } }
          if (R.glass) pts *= 2;
        }
        if (R.streakOn) { pts += R.streak; if (R.streak) extra += ` · streak +${R.streak}`; R.streak++; }
        if (R.clutch && R.outs === R.outsMax - 1) { pts *= 2; extra += ' · clutch ×2'; }
        R.pts += pts; R.total += pts; R.hits++;
        const name = { single: 'Single', double: 'Double', triple: 'Triple', hr: 'Home run!' }[out.type];
        res = { text: `${name} +${pts}`, sub: (dist ? `${dist} ft · ` : '') + `${Math.min(R.pts, R.need)} of ${R.need} points` + extra, size: out.type === 'hr' ? 'huge' : 'small' };
      } else if (out.type === 'foul') res = { text: 'Foul ball', sub: 'no harm done · swing again', size: 'small' };
      else res = outCall('Out');
    } else if (S.swung) {
      P.swings++;
      if (R.eyeLeft > 0) { R.eyeLeft--; res = { text: 'Swing and miss', sub: 'Batting Eye: that one’s free', size: 'small' }; }
      else res = outCall('Swing and miss');
    } else res = { text: 'Take', sub: 'wait for your pitch', size: 'small' };
    S.afterNext = R.pts >= R.need ? 'perk' : R.outs >= R.outsMax ? 'over' : 'next';
    if (S.afterNext === 'perk') res = { text: `Stage ${R.stage} cleared!`, sub: res.text.replace(/!$/, '') + (res.sub && /ft/.test(res.sub) ? ' · ' + res.sub.split(' · ')[0] : '') + ` · ${R.total} points this run`, size: 'huge' };
    return res;
  },
  offer() {
    const R = S.rogue, pool = PERKS.filter(p => p.stack || !R.perks.includes(p.id)), pick = [];
    while (pick.length < 3 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    S.phase = 'perk';
    $('perkStage').textContent = `Stage ${R.stage} cleared · ${R.total} points`;
    $('perkNote').textContent = `Stage ${R.stage + 1}: score ${3 + 2 * (R.stage + 1)} points. The pitches get trickier.`;
    const list = $('perkList'); list.innerHTML = '';
    pick.forEach(p => {
      const b = document.createElement('button'); b.type = 'button';
      const n = R.perks.filter(x => x === p.id).length;
      b.innerHTML = '<strong></strong><span></span>';
      b.firstChild.textContent = p.name; if (n) { const e = document.createElement('em'); e.textContent = `have ${n}`; b.firstChild.append(e); }
      b.lastChild.textContent = p.text;
      b.addEventListener('click', () => ROGUE.take(p));
      list.append(b);
    });
    $('perks').hidden = false; list.firstChild && list.firstChild.focus();
  },
  take(p) {
    const R = S.rogue; if (S.phase !== 'perk') return;
    $('perks').hidden = true;
    p.take(R); R.perks.push(p.id); R.stage++;
    ROGUE.stageStart(); resetPitch(); hud();
    hooks.banner(`Stage ${R.stage}`, `${p.name} · score ${R.need} in ${R.outsMax} outs`, '');
    S.phase = 'wait';
    const gid = S.gid;
    setTimeout(() => { if (S.phase === 'wait' && S.gid === gid) nextPitch(); }, 1300);
  },
  stats() {
    const R = S.rogue;
    return `<span><b>${R.pts}</b>/${R.need} points</span><span><b>${R.outs}</b>/${R.outsMax} outs</span><span><b>${R.total}</b> run total</span><span><b>${R.longest || '—'}</b>${R.longest ? ' ft' : ''} longest HR</span><span><b>${R.perks.length}</b> perks</span>`;
  },
  over() {
    const R = S.rogue, cleared = R.stage - 1, prev = ROGUE.best();
    const better = !prev || cleared > prev.cleared || cleared === prev.cleared && R.total > prev.total;
    if (better) try { localStorage.setItem('fpd-rogue-best', JSON.stringify({ cleared, total: R.total })); } catch (_) {}
    $('overTitle').textContent = 'Run over';
    $('overScore').textContent = `Stage ${R.stage} · ${R.total} point${R.total === 1 ? '' : 's'}`;
    const names = R.perks.map(id => PERKS.find(p => p.id === id).name);
    $('overNote').textContent = `${cleared} stage${cleared === 1 ? '' : 's'} cleared, ${R.hr} home run${R.hr === 1 ? '' : 's'}${R.longest ? ` (longest ${R.longest} ft)` : ''}.` + (names.length ? ` Perks: ${names.join(', ')}.` : '') +
      (better ? ' New personal best!' : prev ? ` Best: ${prev.cleared} stages, ${prev.total} points.` : '');
    $('rematchBtn').textContent = 'New run';
  },
};
function startPractice(mode) {
  leaveOnline();
  const kind = mode;
  if (mode === 'targets' || mode === 'rogue') mode = 'derby'; // same setup as the derby: you bat, the CPU lobs it in
  newGame(mode, 1);
  S.myBuild = menuBuild; resetPitch();
  if (mode === 'bullpen') S.half = 1; // you're on the mound, the CPU batter just stands in and takes
  S.prac = { kind, hr: 0, outs: 0, longest: 0, swings: 0, pitches: 0, strikes: 0, legal: 0, streak: 0, best: 0, last: '' };
  if (kind === 'rogue') { S.rogue = ROGUE.fresh(); ROGUE.stageStart(); }
  if (kind === 'targets') {
    S.prac.targets = makeTargets(); S.prac.timeLeft = TARGET_TIME;
    S.fielders.forEach(f => { if (f.kind === 'IF' || f.kind === 'OF') f.base = [f.base[0] * 3, 600]; }); // the fielders clear out (they'd stand in front of the targets)
    resetPitch();
  }
  $('menu').hidden = true; $('over').hidden = true;
  hud();
  if (kind === 'rogue') hooks.banner('Stage 1', `score ${S.rogue.need} in ${S.rogue.outsMax} outs · 1B 1 · 2B 2 · 3B 3 · HR 4`, '');
  else if (kind === 'targets') hooks.banner('Home Run Targets', `hit all ${TARGET_COUNT} on the fly in ${TARGET_TIME / 60 >= 1 ? Math.floor(TARGET_TIME / 60) + ':' + String(TARGET_TIME % 60).padStart(2, '0') : TARGET_TIME + ' s'}`, '');
  else hooks.banner(mode === 'derby' ? 'Home Run Derby' : 'Bullpen', mode === 'derby' ? `${DERBY_OUTS} outs · anything but a homer is an out (fouls are free)` : 'throw strikes · the batter takes every pitch', '');
  S.phase = 'wait';
  const gid = S.gid;
  setTimeout(() => { if (S.phase === 'wait' && S.gid === gid) nextPitch(); }, 1100);
}
function practiceResult(contact) {
  const P = S.prac;
  let res;
  if (isTargets()) {
    if (contact || S.swung) P.swings++;
    if (contact && S.batted.pred.overFence) { P.hr++; P.longest = Math.max(P.longest, Math.round(hrDistance())); }
    const left = P.targets.filter(t => !t.hit).length, got = P.hitNow || 0; P.hitNow = 0;
    if (!left) { res = { text: 'All targets down!', sub: `${Math.round(TARGET_TIME - P.timeLeft)} s · ${P.swings} swings`, size: 'huge' }; P.won = true; }
    else if (got) res = { text: got > 1 ? `${got} targets!` : 'Target!', sub: `${left} to go`, size: 'small' };
    else res = { text: contact ? (S.batted.pred.overFence ? 'Gone, but no target' : 'Not out of the park') : S.swung ? 'Swing and miss' : 'Take', sub: `${left} target${left > 1 ? 's' : ''} left · ${Math.ceil(P.timeLeft)} s`, size: 'small' };
    S.afterNext = !left || P.timeLeft <= 0 ? 'over' : 'next';
  } else if (S.rogue) {
    res = ROGUE.result(contact);
  } else if (S.mode === 'derby') {
    if (contact) {
      P.swings++;
      const out = S.batted.out;
      if (out.type === 'hr') { const d = Math.round(hrDistance()); P.hr++; P.longest = Math.max(P.longest, d); res = { text: 'Home run!', sub: `${d} ft · ${P.hr} so far`, size: 'huge' }; }
      else if (out.type === 'foul') res = { text: 'Foul ball', sub: 'no out · swing again', size: 'small' };
      else { P.outs++; res = { text: 'Out', sub: `${P.outs} of ${DERBY_OUTS} · ${out.msg || out.note || out.type}`, size: '' }; }
    } else if (S.swung) { P.swings++; P.outs++; res = { text: 'Swing and miss', sub: `out ${P.outs} of ${DERBY_OUTS}`, size: '' }; }
    else res = { text: 'Take', sub: 'wait for your pitch', size: 'small' };
    S.afterNext = P.outs >= DERBY_OUTS ? 'over' : 'next';
  } else { // bullpen
    const call = applyPitchCall(); S.balls = 0; S.strikes = 0; S.outs = 0; S.bases = [0, 0, 0]; S.score = [0, 0];
    const strike = S.mark && S.mark.strike, legal = S.apex >= ARC.lo && S.apex <= ARC.hi;
    P.pitches++; if (strike) { P.strikes++; P.streak++; P.best = Math.max(P.best, P.streak); } else P.streak = 0;
    if (legal) P.legal++;
    res = { text: strike ? 'Strike' : 'Ball', sub: `${S.lastMph} mph · ${S.apex.toFixed(1)} ft arc · ${strike ? (P.streak > 1 ? P.streak + ' in a row' : 'on the mat') : call.sub}`, size: 'small' };
    S.afterNext = 'next';
  }
  hooks.banner(res.text, res.sub, res.size);
  if (res.size === 'huge') play('cheer');
  S.phase = 'result'; S.timer = res.size === 'huge' ? 2.4 : isTargets() ? (contact ? 0.9 : 0.8) : contact ? 1.8 : 1.1;
  hud();
}
function beginGameUI(quick) {
  $('menu').hidden = true; $('over').hidden = true;
  hud();
  if (!quick) hooks.banner(`${teamName(0)} at the plate`, `${S.innings} inning${S.innings > 1 ? 's' : ''} · play ball`, '');
  S.phase = 'wait';
  const gid = S.gid;
  setTimeout(() => { if (S.phase === 'wait' && S.gid === gid) nextPitch(); }, quick ? 300 : 1100);
  netPresence();
}
function nextPitch() {
  gust();
  resetPitch(); hud();
  if (S.over) { showOver(); return; }
  S.aim = null; S.aimPreview = null;
  if (humanPitches()) { S.phase = 'windup'; S.arm.a = -95 * D2R; S.arm.w = 0; } // start neutral, arm at the side
  else if (S.mode === 'cpu' || S.mode === 'derby') { // the CPU pitches as a righty; a lefty gets the mirror image
    let P = S.mode === 'cpu' ? cpuPickPitch() : S.rogue ? ROGUE.pitch() : derbyPitch();
    if (S.mode === 'cpu' && Math.random() < 0.1) P = knuckleize(P, undefined, true); // now and then a knuckler
    startOppWindup(pitMirror() ? mirrorPitch(P) : P, 0.95);
  }
  else {
    S.phase = 'waitPitch';
    const m = net.pending; net.pending = null;
    if (m && m.gid === S.gid && m.seq === S.seq + 1) startOppWindup(m.P, 0.8);
  }
  netPresence();
}
function startOppWindup(P, dur) { S.phase = 'oppWindup'; S.timer = 0; S.oppPitch = P; S.windDur = dur; }
function releaseMyPitch(P) { S.phase = 'throwing'; S.timer = 0; S.myPitch = S.mode === 'online' ? roundP(P) : P; S.throwFrom = S.arm.a; } // online: throw exactly what the rival will see
function afterMyLaunch() {
  if (S.mode !== 'online') { beginFlight(); return; }
  S.phase = 'waitPlay'; S.hideBall = true;
  net.lastPitchMsg = { gid: S.gid, seq: S.seq + 1, P: roundP(S.myPitch), th: S.myThrows || 'R' };
  net.pitchSentAt = performance.now();
  net.lastOut = { k: 'pitch', ...net.lastPitchMsg }; netPresence(); // the reliable copy: presence is re-sent until the rival has it
  net.rm && net.rm.emit('pitch', net.lastPitchMsg).catch(netErr); // the fast copy
}
function beginFlight() {
  S.phase = 'flight'; S.t = 0; S.tReal = 0; S.rec = []; S.recNext = 0;
  S.iBatThisPitch = humanBats();
  if (!humanBats()) S.cpuPlan = S.mode === 'bullpen' ? null : cpuPlanSwing();
}
function finishPlay(result, delay) {
  hooks.banner(result.text, result.sub, result.size);
  if (result.size === 'huge') play('cheer');
  else if (soundOn && (result.text === 'Strikeout' || /robbed/i.test(result.text))) crowd.groan();
  const refereeing = S.mode === 'online' && S.iBatThisPitch;
  if (refereeing) S.seq += 1;
  S.afterNext = afterPlay();
  S.phase = 'result'; S.timer = delay;
  hud();
  if (refereeing) sendPlay(result);
  netPresence();
}
function proceedAfterResult() {
  const n = S.afterNext;
  if (n === 'over' || S.over) { showOver(); return; }
  if (n === 'perk') { ROGUE.offer(); return; }
  if (n === 'half') {
    resetPitch(); hud();
    hooks.banner(`${S.half === 0 ? 'Top' : 'Bottom'} ${S.inning}`, `${teamName(battingTeam())} batting · ${teamName(fieldingTeam())} pitching`, '');
    S.phase = 'wait';
    const gid = S.gid, seq = S.seq;
    setTimeout(() => { if (S.phase === 'wait' && S.gid === gid && S.seq === seq) nextPitch(); }, 1400);
    return;
  }
  nextPitch();
}
function showOver() {
  S.phase = 'over';
  if (isTargets()) {
    const P = S.prac, hit = P.targets.filter(t => t.hit).length;
    $('overTitle').textContent = P.won ? 'All targets down' : 'Time!';
    $('overScore').textContent = P.won ? `${Math.round(TARGET_TIME - P.timeLeft)} seconds` : `${hit} of ${TARGET_COUNT} targets`;
    $('overNote').textContent = `${P.swings} swings. A new set of targets every round.`;
    $('rematchBtn').textContent = 'Go again';
    $('over').hidden = false; hud(); return;
  }
  if (S.rogue) { ROGUE.over(); $('over').hidden = false; hud(); return; }
  if (S.mode === 'derby') {
    const P = S.prac;
    $('overTitle').textContent = 'Derby over';
    $('overScore').textContent = `${P.hr} home run${P.hr === 1 ? '' : 's'}`;
    $('overNote').textContent = P.hr ? `Longest: ${P.longest} ft. ${P.swings} swings.` : `${P.swings} swings. Meet it out front and lift it.`;
    $('rematchBtn').textContent = 'Go again';
    $('over').hidden = false; hud(); return;
  }
  $('rematchBtn').textContent = 'Rematch';
  const [a, h] = S.score, winner = a > h ? 0 : 1;
  const me = mySeat();
  $('overTitle').textContent = winner === me ? 'You win' : S.mode === 'cpu' ? 'CPU wins' : 'Rival wins';
  $('overScore').textContent = `${teamName(0)} ${a} – ${h} ${teamName(1)}`;
  $('overNote').textContent = (S.walkoff ? 'Walk-off in the bottom of the ' + ordinal(S.inning) + '. ' : '') + `Hits: ${teamName(0)} ${S.hits[0]}, ${teamName(1)} ${S.hits[1]}.`;
  if (S.ranked) submitRanked();
  $('over').hidden = false;
  hud();
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

/* ---------- online ---------- */
const net = { room: null, rm: null, code: null, seat: 0, opp: null, unsub: [], pending: null, lastPlay: null, lastPitchMsg: null, pitchSentAt: 0, behindSince: 0, lastSyncAt: 0, joining: false };
const round = (v, d = 1000) => Math.round(v * d) / d;
const roundP = P => ({ p: P.p.map(v => round(v)), v: P.v.map(v => round(v)), spin: (P.spin || [0, 0, 0]).map(v => round(v)), ax: round(P.ax || 0), mph: P.mph, releaseA: round(P.releaseA), kn: P.kn || 0, kp: round(P.kp || 0) });
function netErr(e) { if (e && (e.code === 'not_permitted' || e.code === 'not_granted') && !net.denied) { net.denied = true; lobbyUI(); hooks.banner('Not connected', 'you need “can contribute” access to play online', ''); } }
function codeOk(c) { return /^[a-z0-9]{4,8}$/.test(c); }
function newCode() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
async function joinCode(code, seat) {
  leaveOnline();
  if (!net.room) return false;
  net.joining = true; lobbyUI();
  try { net.rm = await net.room.join('duel-' + code); }
  catch (e) { net.joining = false; net.rm = null; lobbyUI(e.code === 'not_permitted' ? 'This page can’t open game rooms for you.' : 'Couldn’t reach the game room. Try again in a moment.'); return false; }
  net.joining = false; net.code = code; net.seat = seat;
  try { localStorage.setItem('fpd-code', JSON.stringify({ code, seat })); } catch (_) {}
  const rm = net.rm;
  net.unsub.push(rm.on('pitch', m => { if (!m.sameTab) onRemotePitch(m.data); }));
  net.unsub.push(rm.on('play', m => { if (!m.sameTab) onRemotePlay(m.data); }));
  net.unsub.push(rm.on('sync', m => { if (!m.sameTab) onRemoteSync(m.data); }));
  net.unsub.push(rm.onPeers(ch => {
    net.opp = ch.peers.find(p => !p.sameTab && p.presence && p.presence.seat === 1 - net.seat) || null;
    if (net.opp && S && S.mode === 'online' && S.phase === 'lobbyWait') beginGameUI();
    if (net.opp) fromPresence(net.opp.presence);
    lobbyUI();
  }));
  netPresence();
  lobbyUI();
  return true;
}
function leaveOnline() {
  net.unsub.forEach(u => { try { u(); } catch (_) {} }); net.unsub = [];
  if (net.rm) net.rm.leave().catch(() => {});
  net.rm = null; net.opp = null; net.code = null; net.pending = null; net.lastPlay = null;
}
/* Every message also rides in presence: the platform keeps each player's presence, hands it to whoever (re)joins and
   re-sends it after a dropped connection, so a lost 'pitch' or 'play' can't freeze the game, and it works even for
   players who can only set presence. The emitted copy is just the fast path. */
function netPresence() {
  if (!net.rm) return;
  const inGame = S && S.mode === 'online';
  const pr = { seat: net.seat, gid: inGame ? S.gid : null, started: inGame ? S.started : 0, seq: inGame ? S.seq : 0, bats: menuBats, throws: menuThrows,
    snap: inGame ? snapshot() : null, out: inGame && net.lastOut && net.lastOut.gid === S.gid ? net.lastOut : null };
  if (pr.out && pr.out.rec) { const o = pr.out = { ...pr.out }; while (JSON.stringify(pr).length > 3800 && o.rec.length > 4) o.rec = o.rec.filter((_, i) => i % 2 === 0); }
  if (JSON.stringify(pr).length > 3900) pr.snap = null;
  net.rm.presence(pr).catch(() => {});
}
function fromPresence(p) {
  if (!p) return;
  if (S && S.mode === 'online') { if (p.bats === 'L' || p.bats === 'R') S.oppBats = p.bats; if (p.throws === 'L' || p.throws === 'R') S.oppThrows = p.throws; }
  const o = p.out;
  if (o && o.k === 'pitch') onRemotePitch(o);
  else if (o && o.k === 'play') onRemotePlay(o.snap ? o : { ...o, snap: p.snap });
  // far behind (a reload, or several messages lost): jump straight to their state. One step behind is normal: the next pitch or play brings it.
  const sn = p.snap;
  const behind = sn && typeof sn.gid === 'string' && (!S || S.mode !== 'online' ? true : sn.gid !== S.gid ? sn.started > S.started : sn.seq > S.seq + 1);
  if (behind && !(S && S.replay)) onRemoteSync({ snap: sn });
}
function snapNewer(o) {
  if (!S || S.mode !== 'online') return true;
  if (o.gid !== S.gid) return o.started > S.started;
  return o.seq > S.seq;
}
function onRemoteSync(d) {
  if (!d || !d.snap || typeof d.snap.gid !== 'string') return;
  const o = d.snap;
  if (!snapNewer(o)) return;
  if (S && S.mode === 'online' && S.replay && o.gid === S.gid) return; // the replay will hand us this state itself
  newGame('online', clamp(+o.innings || 3, 1, 9), net.seat, o.gid, o.started);
  adoptSnap(o);
  hud();
  if (S.over) { $('menu').hidden = true; showOver(); return; }
  beginGameUI(o.seq > 0);
}
function onRemotePitch(d) {
  if (!S || S.mode !== 'online' || !d || d.gid !== S.gid || humanPitches()) return;
  if (d.th === 'L' || d.th === 'R') S.oppThrows = d.th;
  if (d.seq === S.seq + 1) {
    if (S.phase === 'waitPitch') startOppWindup(d.P, 0.8);
    else if (!['oppWindup', 'flight', 'batted'].includes(S.phase)) net.pending = d;
  } else if (net.lastPlay && d.seq === net.lastPlay.seq) {
    net.rm && net.rm.emit('play', net.lastPlay).catch(netErr); // our answer was lost: say it again
  }
}
function sendPlay(result) {
  const out = S.batted ? S.batted.out : null;
  const msg = {
    gid: S.gid, seq: S.seq, endT: round(S.tReal),
    rec: S.rec, contact: S.contactRec ? { t: round(S.contactRec.t), ball: Object.fromEntries(Object.entries(S.contactRec.ball).map(([k, v]) => [k, round(v)])) } : null,
    out: out ? JSON.parse(JSON.stringify(out, (k, v) => typeof v === 'number' ? round(v) : v)) : null,
    res: result, mark: S.mark, snap: snapshot(), next: S.afterNext,
  };
  while (JSON.stringify(msg).length > 3900 && msg.rec.length > 8) msg.rec = msg.rec.filter((_, i) => i % 2 === 0);
  net.lastPlay = msg;
  net.lastOut = { k: 'play', ...msg, snap: undefined }; netPresence(); // presence already carries the snapshot
  net.rm && net.rm.emit('play', msg).catch(netErr);
}
function onRemotePlay(d) {
  if (!S || S.mode !== 'online' || !d || d.gid !== S.gid) return;
  if (S.phase !== 'waitPlay' || d.seq !== S.seq + 1) return;
  S.replay = d;
  const P = S.lastPitch;
  resetBallTo(P);
  S.phase = 'replay'; S.t = 0; S.tReal = 0; S.trail = []; S.hideBall = false;
}
function resetBallTo(P) {
  const b = S.ball;
  b.x = P.p[0]; b.y = P.p[1]; b.z = P.p[2]; b.vx = P.v[0]; b.vy = P.v[1]; b.vz = P.v[2]; b.ax = P.ax; b.spin = P.spin ? [...P.spin] : [0, 0, 0]; b.mx = 1; b.kn = P.kn || 0; b.kp = P.kp || 0;
  S.inHand = false; S.caughtByCatcher = false; S.atPlate = null; S.contacted = false;
}
function replayBat(t) {
  const r = S.replay.rec, bt = S.bat;
  if (!r || !r.length) return;
  let i = 0; while (i < r.length && r[i][0] <= t) i++;
  const a = r[Math.max(0, i - 1)], b = r[Math.min(r.length - 1, i)];
  const k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
  bt.w = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
  bt.phi = a[1] + (b[1] - a[1]) * k; bt.e = a[2] + (b[2] - a[2]) * k;
  bt.hx = a[3] + (b[3] - a[3]) * k; bt.hy = a[4] + (b[4] - a[4]) * k;
  if (a.length > 5) { bt.hz = a[5] + (b[5] - a[5]) * k; bt.bx = a[6]; bt.bz = a[7]; }
}
function finishRemote() {
  const m = S.replay;
  hooks.banner(m.res.text, m.res.sub, m.res.size);
  if (m.res.size === 'huge') play('cheer');
  adoptSnap(m.snap);
  S.mark = m.mark || null;
  S.afterNext = m.next;
  S.phase = 'result'; S.timer = m.res.size === 'small' ? 1.0 : m.res.size === 'huge' ? 2.6 : 1.9;
  hud(); netPresence();
}
function netTick(now) {
  if (!net.rm || !S || S.mode !== 'online') return;
  if (S.phase === 'waitPlay' && net.lastPitchMsg && now - net.pitchSentAt > 1600) {
    net.pitchSentAt = now; net.rm.emit('pitch', net.lastPitchMsg).catch(netErr);
  }
  // keep a rival who reloaded or missed a message in step with us
  const o = net.opp && net.opp.presence;
  if (o && S.phase !== 'lobbyWait' && aheadOf(o)) {
    if (!net.behindSince) net.behindSince = now;
    if (now - net.behindSince > (o.gid ? 2500 : 0) && now - net.lastSyncAt > 1500) { net.lastSyncAt = now; net.rm.emit('sync', { snap: snapshot() }).catch(netErr); }
  } else net.behindSince = 0;
}

/* ---------- input → hands / aim ---------- */
/* Mouse left/right drives the bat around the body, locked to it with no weight: far left is loaded by the back
   shoulder, the middle is through the hitting zone, far right is the follow-through. Up/down sets the hands' height.
   How fast you move the mouse is how fast the bat goes. */
const SWING_MAP = { lo: -120 * D2R, hi: 135 * D2R };
function handsFromMouse() {
  if (!mouse.seen) return;
  const mxs = batMirror() ? W - mouse.sx : mouse.sx; // a lefty loads to the other side
  const fx = clamp((mxs / W - 0.08) / 0.84, 0, 1), fy = clamp((mouse.sy / H - 0.15) / 0.7, 0, 1);
  S.bat.phiT = SWING_MAP.lo + (SWING_MAP.hi - SWING_MAP.lo) * fx;
  S.bat.ty = BAT.box.y1 - (BAT.box.y1 - BAT.box.y0) * fy;
}
/* The flick: the fastest upward stroke in the last ~150 ms (measured over spans of 25 ms or more),
   its sideways part, and how fast its direction was turning. Speeds are in screen-heights per second. */
function measureFlick(g, now) {
  if (!g) return null;
  const sm = g.samples.filter(s => now - s[0] <= 150);
  let best = null;
  for (let j = 1; j < sm.length; j++) {
    let i = j - 1; while (i > 0 && sm[j][0] - sm[i][0] < 25) i--;
    const dt = (sm[j][0] - sm[i][0]) / 1000; if (dt <= 0) continue;
    const vUp = -(sm[j][2] - sm[i][2]) / H / dt, vx = (sm[j][1] - sm[i][1]) / H / dt;
    if (!best || vUp > best.vUp) best = { vUp, vx, j };
  }
  if (!best || best.vUp < FLICK.minUp) return null;
  // curl: compare the flick's direction early vs late
  let curl = 0;
  if (sm.length >= 4) {
    const m = sm.length >> 1, d1 = [sm[m][1] - sm[0][1], sm[m][2] - sm[0][2]], d2 = [sm[sm.length - 1][1] - sm[m][1], sm[sm.length - 1][2] - sm[m][2]];
    const a1 = Math.atan2(d1[0], -d1[1]), a2 = Math.atan2(d2[0], -d2[1]), span = (sm[sm.length - 1][0] - sm[0][0]) / 1000;
    if (span > 0.02 && Math.hypot(...d1) > 4 && Math.hypot(...d2) > 4) curl = wrap(a2 - a1) / span;
  }
  return { vUp: best.vUp, vx: best.vx, curl: clamp(curl, -8, 8) };
}
function flickPreview() { return S.grip ? pitchFromArm() : null; }
function cursorHand(sx, sy) {
  // the cursor slides the hand along a gently tilted "lane" in front of you (forward and up at ~33 deg),
  // like a stick blade on ice; the shoulder still stops it at full reach
  const sh = shoulderNow(), tilt = 33 * D2R;
  const Fw = [PFWD[0] * Math.cos(tilt), Math.sin(tilt), PFWD[2] * Math.cos(tilt)];
  const Q = [sh[0], sh[1] - 2.15, sh[2]];
  const nrm = norm(cross(Fw, [PFWD[2], 0, -PFWD[0]]));
  const below = Math.max(0, sy - H * 0.98);
  const d = mouseRay(sx, Math.min(sy, H * 0.98)), o = [sh[0], cam.pos[1], cam.pos[2]];
  const den = dotv(d, nrm); if (Math.abs(den) < 1e-4) return null;
  const t = dotv(sub(Q, o), nrm) / den; if (t < 0) return null;
  let p = addv(o, mul(d, t));
  if (below > 0) p = addv(p, mul(Fw, -(below / (H * 0.3)) * 2.6)); // keep dragging down: the arm goes back behind you
  p[1] = Math.max(0.6, p[1]);
  return p;
}
function sidePlaneHit(sx, sy) { // the vertical plane the throwing arm moves in, seen side-on
  const d = mouseRay(sx, sy);
  if (Math.abs(d[0]) < 1e-3) return null;
  const t = (ARM.S[0] - cam.pos[0]) / d[0];
  if (t < 0) return null;
  const p = addv(cam.pos, mul(d, t));
  return [p[1], p[2]];
}
const keys = new Set();
addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); keys.add(k);
  if (k === 'k' && !e.repeat && S && humanPitches() && S.phase === 'windup') { S.knuck = !S.knuck; hooks.banner(S.knuck ? 'Knuckleball' : 'Normal grip', S.knuck ? 'slower, no spin, it wobbles' : 'sweep to curve it', 'small'); } if (k.startsWith('arrow') && $('menu').hidden) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function zoneHit(sx, sy) {
  const d = mouseRay(sx, sy);
  if (Math.abs(d[2]) < 1e-3) return null;
  const t = (PLATE_Z - cam.pos[2]) / d[2];
  if (t < 0) return null;
  const p = addv(cam.pos, mul(d, t));
  return { tx: clamp(p[0], -2.2, 2.2), ty: clamp(p[1], 0.4, 5.5) };
}
const ease = u => u * u * (3 - 2 * u);

/* ---------- update ---------- */
function update(dt) {
  if (!S) return;
  sparks.forEach(p => { p.v[1] -= G * dt * 0.6; p.p = addv(p.p, mul(p.v, dt)); p.life -= dt; });
  sparks = sparks.filter(p => p.life > 0);

  const batLive = humanBats() && ['waitPitch', 'oppWindup', 'flight'].includes(S.phase);
  if (batLive) {
    handsFromMouse();
    const dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const dz = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    if (dx || dz) walkBatter(dt, batMirror() ? -dx : dx, dz);
  } else if (!humanBats()) S.bat.phiT = undefined;
  if (batLive && S.phase !== 'flight') idleBat(dt);

  switch (S.phase) {
    case 'windup': {
      // holding: the arm follows the mouse up and down (down = back, up = forward); not holding: it hangs at the hip
      const held = S.grip && mouse.down;
      // neutral: the arm hangs at the side. Down swings it back, up swings it through toward the plate.
      const tgt = held ? clamp(-90 + ((mouse.sy - S.grip.y0) / (H * 0.2)) * 60, -155, -20) * D2R : -95 * D2R;
      const m = pitMirror() ? -1 : 1; // a lefty is worked out as a mirrored righty
      const lat = held ? ((mouse.sx - S.grip.x0) / (H * 0.2)) * 0.6 * m : 0; // the hand follows the mouse across the screen
      const leanW = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
      const leanT = Math.min(0, leanW * m); // you can only lean toward your throwing hand (D for a righty, A for a lefty)
      S.lean = (S.lean || 0) + (leanT - (S.lean || 0)) * Math.min(1, dt * 5);
      stepHoldArm(dt, tgt, lat);
      const h = handWorld(); S.ball.x = h[0]; S.ball.y = h[1]; S.ball.z = h[2];
      break;
    }
    case 'throwing': case 'oppWindup': {
      S.timer += dt;
      const mine = S.phase === 'throwing', P = mine ? S.myPitch : S.oppPitch;
      const dur = mine ? 0.12 : S.windDur;
      const u = Math.min(1, S.timer / dur), prev = S.arm.a;
      if (mine) { S.arm.a = S.throwFrom + (P.releaseA - S.throwFrom) * u; S.oppStride = ease(u); } // stride and swing through with the flick
      else { // slowpitch: set, swing back, swing through with the stride, let go out front
        const back = -25 * D2R, rel = P.releaseA > -60 * D2R ? -130 * D2R : P.releaseA;
        S.arm.a = u < 0.45 ? ARM_DOWN + (back - ARM_DOWN) * ease(u / 0.45) : back + (rel - back) * ((u - 0.45) / 0.55) ** 1.4;
        S.oppStride = u < 0.6 ? 0 : ease((u - 0.6) / 0.4);
      }
      S.arm.w = (S.arm.a - prev) / dt;
      const h = handWorld(); S.ball.x = h[0]; S.ball.y = h[1]; S.ball.z = h[2];
      if (u >= 1) { if (!mine) S.arm.a = P.releaseA > -60 * D2R ? -130 * D2R : P.releaseA; launchExact(P); hud(); if (mine) afterMyLaunch(); else beginFlight(); }
      break;
    }
    case 'waitPlay': S.lean = (S.lean || 0) * 0.92; S.arm.w *= 0.9; S.arm.a = clamp(S.arm.a + S.arm.w * dt, -200 * D2R, 20 * D2R); break;
    case 'flight': {
      S.arm.w *= 0.9; S.arm.a = clamp(S.arm.a + S.arm.w * dt, -200 * D2R, 20 * D2R);
      const r = stepFlight(dt);
      if (S.mode === 'online' && S.iBatThisPitch && S.tReal >= S.recNext) {
        const b = S.bat; S.rec.push([round(S.tReal), round(b.phi), round(b.e), round(b.hx), round(b.hy), round(b.hz), round(b.bx, 100), round(b.bz, 100)]); S.recNext += 1 / 30;
      }
      trail();
      if (r === 'contact') { swingFeedback(true); startBatted(); }
      else if (r === 'done') { swingFeedback(false); if (PRACTICE(S.mode)) practiceResult(false); else { const res = applyPitchCall(); finishPlay(res, res.size === 'small' ? 1.0 : 1.7); } }
      break;
    }
    case 'replay': {
      const m = S.replay;
      const r = stepFlight(dt, replayBat);
      trail();
      if (m.contact && S.tReal >= m.contact.t) { Object.assign(S.ball, m.contact.ball); S.contacted = true; startBatted(m.out); }
      else if (!m.contact && (r === 'done' || S.tReal > m.endT + 0.3)) finishRemote();
      break;
    }
    case 'batted': {
      const r = stepBatted(dt);
      trail();
      if (r === 'done') {
        if (S.replay) finishRemote();
        else if (PRACTICE(S.mode)) practiceResult(true);
        else { const res = applyBattedOutcome(S.batted.out); finishPlay(res, res.size === 'small' ? 1.0 : res.size === 'huge' ? 2.6 : 1.9); }
      }
      break;
    }
    case 'result':
      if (S.batted) { stepBatted(dt); trail(); }
      S.timer -= dt;
      if (S.timer <= 0) proceedAfterResult();
      break;
  }
  if (isTargets() && S.phase !== 'over' && S.phase !== 'idle' && S.phase !== 'wait') { // the clock
    const before = Math.ceil(S.prac.timeLeft); S.prac.timeLeft = Math.max(0, S.prac.timeLeft - dt);
    if (Math.ceil(S.prac.timeLeft) !== before) hud();
    if (S.prac.timeLeft <= 0 && (S.phase === 'oppWindup' || S.phase === 'waitPitch')) { S.prac.timeLeft = 0; hooks.banner('Time!', '', ''); S.afterNext = 'over'; S.phase = 'result'; S.timer = 1.2; }
  }
  if (isTargets() && S.batted && S.ball.held === undefined) { const cur = [S.ball.x, S.ball.y, S.ball.z]; checkTargets(S.prac.lastBall, cur); S.prac.lastBall = cur; }
  else if (isTargets()) S.prac.lastBall = null;
  stepJiggle(dt);
  if (soundOn) crowd.tick();
  netTick(performance.now());
  prompt();
}
/* "too early / too late": after each swing, how the timing and the height compared with a square, centered hit */
function swingFeedback(contact) {
  if (!S || !S.iBatThisPitch || !humanBats()) return;
  let timing = '', height = '', d;
  if (contact && S.contactInfo) {
    d = (S.contactInfo.phi / D2R) - 12; // degrees past square
    const off = S.contactInfo.off;
    height = off > 0.45 ? 'got on top of it' : off < -0.45 ? 'got under it' : '';
  } else if (S.swung && S.atBat) {
    d = (S.atBat.phi / D2R) - 12;
    const dy = S.atBat.barrelY - S.atBat.ballY;
    height = dy > 0.5 ? 'swung over it' : dy < -0.5 ? 'swung under it' : '';
  } else return;
  timing = d > 40 ? 'Way too early' : d > 14 ? 'A bit early' : d < -40 ? 'Way too late' : d < -14 ? 'A bit late' : 'Right on time';
  const good = timing === 'Right on time' && !height;
  const el = $('swingfb'); if (!el) return;
  el.className = 'swingfb ' + (good ? 'good' : Math.abs(d) > 40 ? 'bad' : 'meh');
  el.innerHTML = `${timing}${height ? ` · <span>${height}</span>` : ''}`;
  el.hidden = false; void el.offsetWidth; el.classList.add('show');
  clearTimeout(swingFeedback.t); swingFeedback.t = setTimeout(() => { el.hidden = true; }, 1900);
}
function trail() { S.trail.push([S.ball.x, S.ball.y, S.ball.z]); if (S.trail.length > 16) S.trail.shift(); }

/* ---------- prompt + hint ---------- */
let lastPrompt = null, lastHint = '';
const HINT_PITCH = `<b>Pitching:</b> to curve it, sweep the mouse left or right as you let go: the faster the sweep, the bigger the break, and it breaks the way you swept. Press K to grip a knuckleball (slower, no spin, it wobbles on the way in; press K again to go back). The wind pushes the ball too (the arrow in the box shows it; the ring shows a still day). Hold D (right-hander) or A (left-hander) to lean out toward your throwing hand and change the angle. Hold the left button and the arm is yours: mouse down swings it back, up swings it through, left and right moves the hand out to the side. Let go while it's coming through. The pitch goes as fast as the arm is really swinging; let go earlier for a flatter pitch, later for more arc. The ring on the dirt and the box show where it lands if you let go now. Arc it 6 to 16 ft and drop it on the plate or plywood board for a strike. `;
const HINT_BAT = `<b>Batting:</b> the pitch drops in on an arc. A/D (or ←/→) step toward or away from the plate, W/S (or ↑/↓) move up or back in the box. Mouse left and right drives the bat around your body with no lag: far left is loaded by your back shoulder, the middle is through the zone, far right is the follow-through. Up and down sets the height. Move fast to swing hard. The ring slides left and right to wherever the pitch is crossing, and once the pitch starts dropping a ring on the ground shows where it will land; you set the height and the timing. Match the height of the ball as it comes down: square it up and it jumps, catch the top and it's a grounder, the bottom and it's a pop-up. Swinging all-out hits it harder but makes it harder to square up. Early pulls it, late goes the other way. Take a pitch that lands on the plate or board and it's a strike.`;
function prompt() {
  let p = '', h = '';
  const online = S.mode === 'online';
  switch (S.phase) {
    case 'lobbyWait': p = `Waiting for your rival · code <b>${net.code || ''}</b>`; h = 'Send your rival the code. They open this page, pick Online 1v1 and join with it.'; break;
    case 'windup':
      p = !S.grip ? '<b>Hold the button</b> to take the ball' : S.arm.w < -4 ? 'Let go when the ring is <b>on the board</b>' : 'Pull <b>down</b> to bring it back, then <b>swing up</b>';
      { const R = S.grip && mouse.down ? flickPreview() : null, cv = R && R.spin ? R.spin[1] / CURVE.max : 0, ln = (S.lean || 0) * (pitMirror() ? -1 : 1), bits = [];
        if (S.knuck) bits.push('<b>knuckleball</b>');
        else if (Math.abs(cv) > 0.12) { // +y sidespin breaks toward -x: screen right from the mound, the side a righty bats on
          const right = cv > 0, batterRight = !batMirror();
          bits.push(`breaking <b>${right ? 'right' : 'left'} ${Math.round(Math.abs(cv) * 100)}%</b> (${right === batterRight ? 'in' : 'away'})`); }
        if (Math.abs(ln) > 0.15) bits.push(`leaning <b>${ln > 0 ? 'left' : 'right'}</b>`);
        if (bits.length) p += ' · ' + bits.join(' · '); }
      h = HINT_PITCH; break;
    case 'waitPlay': p = 'Rival is swinging…'; h = HINT_PITCH; break;
    case 'replay': p = ''; break;
    case 'waitPitch': p = 'Rival is on the mound…'; h = HINT_BAT; break;
    case 'oppWindup': case 'flight': h = humanBats() ? HINT_BAT : (online ? HINT_PITCH : 'CPU is batting.'); break;
  }
  if (online && !net.opp && S.phase !== 'lobbyWait' && S.phase !== 'over') p = 'Rival disconnected · waiting for them to come back';
  if (p !== lastPrompt) { const el = $('prompt'); el.innerHTML = p; el.hidden = !p; lastPrompt = p; }
  if (h && h !== lastHint) { $('hint').innerHTML = h; lastHint = h; }
}

/* ---------- HUD ---------- */
function hud() {
  if (!S) return;
  const prac = PRACTICE(S.mode);
  document.body.classList.toggle('practice', prac);
  if (prac && S.prac) {
    const P = S.prac;
    $('pstats').innerHTML = S.rogue ? ROGUE.stats() : isTargets()
      ? `<span><b>${P.targets.filter(t => t.hit).length}</b>/${TARGET_COUNT} targets</span><span><b>${Math.max(0, Math.ceil(P.timeLeft))}</b> s left</span><span><b>${P.swings}</b> swings</span>`
      : S.mode === 'derby'
      ? `<span><b>${P.hr}</b> home runs</span><span><b>${P.outs}</b>/${DERBY_OUTS} outs</span><span><b>${P.longest || '—'}</b>${P.longest ? ' ft' : ''} longest</span>`
      : `<span><b>${P.pitches}</b> pitches</span><span><b>${P.pitches ? Math.round(100 * P.strikes / P.pitches) : 0}%</b> strikes</span><span><b>${P.pitches ? Math.round(100 * P.legal / P.pitches) : 0}%</b> legal arc</span><span><b>${P.best}</b> best streak</span>`;
    $('inn').textContent = S.rogue ? `Rogue-lite · Stage ${S.rogue.stage}` : isTargets() ? 'HR Targets' : S.mode === 'derby' ? 'HR Derby' : 'Bullpen';
    $('mph').textContent = (S.mode === 'derby' ? `${BUILDS[S.bb || 'normal'].label} hitter · ` : '') + (S.lastMph ? `Last pitch ${S.lastMph} mph` : 'Last pitch —');
    return;
  }
  const n = Math.max(S.innings, S.inning);
  let html = '<tr><th></th>';
  for (let i = 1; i <= n; i++) html += `<th>${i}</th>`;
  html += '<th>R</th><th>H</th></tr>';
  [0, 1].forEach(t => {
    html += `<tr class="${battingTeam() === t && S.phase !== 'over' ? 'batting' : ''}"><td class="team"><i style="background:${t ? 'var(--home)' : 'var(--away)'}"></i>${teamName(t)}</td>`;
    for (let i = 0; i < n; i++) {
      const v = S.line[t][i], now = i === S.inning - 1 && S.half === t && S.phase !== 'over';
      html += `<td class="slot${now ? ' now' : ''}"><span>${v === undefined ? '' : v}</span></td>`;
    }
    html += `<td class="slot tot"><span>${S.score[t]}</span></td><td class="slot tot"><span>${S.hits[t]}</span></td></tr>`;
  });
  $('ls').innerHTML = html;
  const lights = (id, k) => [...$(id).children].forEach((b, i) => b.classList.toggle('on', i < k));
  lights('cB', S.balls); lights('cS', S.strikes); lights('cO', S.outs);
  ['b1', 'b2', 'b3'].forEach((id, i) => $(id).classList.toggle('on', !!S.bases[i]));
  $('inn').textContent = S.phase === 'over' ? 'Final' : `${S.half === 0 ? 'Top' : 'Bot'} ${S.inning}`;
  $('mph').textContent = `${BUILDS[S.bb || 'normal'].label} hitter up · ` + (S.lastMph ? `Last ${S.lastMph} mph` : 'Last pitch —');
}

/* ---------- static scene geometry (world) ---------- */
const arc = (cx, cz, r, a0, a1, n, y = 0) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]); } return o; };
const GRASS_C = [0, 60], GRASS_R = 232;
const GEO = {
  grass: arc(0, 60, GRASS_R, 0, Math.PI * 2, 72),
  stripes: [], patches: [],
  dirt: [[0, 0, 0], ...arc(0, 0, 80, -52 * D2R, 52 * D2R, 20)],
  home: arc(0, 0.5, 13, 0, Math.PI * 2, 24),
  mound: arc(0, 50.2, 8, 0, Math.PI * 2, 28),
  fence: [], stands: [], crowd: [], rows: [], clouds: [],
  track: [...arc(0, 0, FENCE_R, -45 * D2R, 45 * D2R, 30), ...arc(0, 0, FENCE_R - 13, 45 * D2R, -45 * D2R, 30)],
};
/* mowing pinstripes: straight bands toward center field, clipped to the grass */
function clipHalf(pts, nx, nz, c) { // keep the part of a convex [x,z] polygon where nx*x + nz*z >= c
  const o = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], da = a[0] * nx + a[1] * nz - c, db = b[0] * nx + b[1] * nz - c;
    if (da >= 0) o.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); o.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return o;
}
const STRIPE_W = 13;
const stripeOf = x => Math.floor(x / STRIPE_W) & 1; // 1 = the lighter band (mowed away from you)
(() => {
  const ring = GEO.grass.map(p => [p[0], p[2]]);
  for (let x = -GRASS_R - STRIPE_W; x < GRASS_R + STRIPE_W; x += STRIPE_W) {
    if (!stripeOf(x + 1)) continue;
    let p = clipHalf(ring, 1, 0, x); p = clipHalf(p, -1, 0, -(x + STRIPE_W));
    if (p.length > 2) GEO.stripes.push(p.map(([px, pz]) => [px, 0.004, pz]));
  }
})();
/* infield and turf detail placed on the ground itself, so it stays put in 3D as the camera moves */
const INF = { grains: [], rakes: [], blades: [[], [], [], []] };
const inDirt = (x, z) => { const r = hyp(x, z), a = Math.atan2(x, z); return (r < 81 && Math.abs(a) < 53 * D2R) || hyp(x, z - 0.5) < 14; };
const onTrack = (x, z) => { const r = hyp(x, z), a = Math.abs(Math.atan2(x, z)); return a < 45.5 * D2R && r > FENCE_R - 14 && r < FENCE_R + 1; };
const inGrass = (x, z) => hyp(x - GRASS_C[0], z - GRASS_C[1]) < GRASS_R - 1;
(() => {
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const cols = ['rgba(92,46,20,.6)', 'rgba(118,62,30,.55)', 'rgba(236,184,132,.5)', 'rgba(250,214,170,.4)', 'rgba(140,80,44,.55)'];
  while (INF.grains.length < 2600) {
    const r = Math.pow(rnd(), 0.8) * 82, a = (rnd() * 2 - 1) * 58 * D2R, x = Math.sin(a) * r, z = Math.cos(a) * r + (rnd() < 0.08 ? -8 : 0);
    if (!inDirt(x, z)) continue;
    INF.grains.push({ p: [x, 0.02, z], s: 0.1 + rnd() * 0.22, c: cols[(rnd() * cols.length) | 0] });
  }
  for (let r = 18; r < 79; r += 2.6) INF.rakes.push({ pts: arc(0, 0, r, -50 * D2R, 50 * D2R, 24, 0.012), light: (r / 2.6 | 0) % 2 === 0 });
  // grass blades: thick near the infield where the camera is close, thinner out deep. Bucketed by shade so each is one stroke.
  let n = 0;
  while (n < 5200) {
    const near = rnd() < 0.6, r = near ? 14 + rnd() * 110 : 120 + rnd() * 140, a = (rnd() * 2 - 1) * (near ? 85 : 60) * D2R;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (inDirt(x, z) || onTrack(x, z) || !inGrass(x, z) || (z < -4 && Math.abs(x) < 16)) continue;
    const light = stripeOf(x), k = rnd();
    INF.blades[light * 2 + (k < 0.5 ? 0 : 1)].push([x, z, 0.28 + rnd() * 0.3, (rnd() - 0.5) * 0.25]);
    n++;
  }
  // soft mottling so the turf isn't a flat fill
  for (let i = 0; i < 70; i++) {
    const r = 85 + rnd() * 150, a = (rnd() * 2 - 1) * 70 * D2R, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (!inGrass(x, z)) continue;
    GEO.patches.push({ pts: circle(x, z, 5 + rnd() * 12, 14, 0.006), c: rnd() < 0.5 ? 'rgba(30,70,20,.07)' : 'rgba(190,230,120,.06)' });
  }
})();
function drawSpecks(list) {
  for (const g of list) {
    const q = P(g.p); if (!q) continue;
    const px = g.s * q[2]; if (px < 0.6) continue;
    ctx.fillStyle = g.c; ctx.fillRect(q[0] - px / 2, q[1] - px * 0.2, px, px * 0.45); // flattened: lying on the ground
  }
}
const BLADE_COLS = ['rgba(38,96,34,.55)', 'rgba(96,160,64,.45)', 'rgba(70,140,52,.5)', 'rgba(170,214,104,.42)'];
function drawBlades() {
  ctx.lineCap = 'butt';
  INF.blades.forEach((list, i) => {
    ctx.strokeStyle = BLADE_COLS[i]; ctx.lineWidth = 1; ctx.beginPath();
    for (const [x, z, h, lean] of list) {
      const c = toCam([x, 0, z]); if (c[2] < 1) continue;
      const s = focal / c[2], px = h * s; if (px < 0.7) continue;
      const sx = W / 2 + c[0] * s + cam.sx, sy = H / 2 - c[1] * s + cam.sy;
      ctx.moveTo(sx, sy); ctx.lineTo(sx + lean * px, sy - px);
    }
    ctx.stroke();
  });
}
function circle(cx, cz, r, n = 24, y = 0.015) { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]); } return o; }
for (let a = -45; a < 45; a += 3) GEO.fence.push([a * D2R, (a + 3) * D2R]);

/* the ballpark: a two-deck bowl whose front row sits on the edge of the grass, a roof over the upper deck,
   and a batter's eye in dead center where the seats are blacked out */
const EYE_DEG = 11;
const standR = th => { // distance from home plate to the edge of the grass along a bearing
  const dx = Math.sin(th), dz = Math.cos(th), b = dx * GRASS_C[0] + dz * GRASS_C[1];
  return b + Math.sqrt(b * b - (GRASS_C[0] ** 2 + GRASS_C[1] ** 2) + GRASS_R * GRASS_R);
};
// profile of the bowl, as [distance back from the front row, height]
const BOWL = { wall: [0, 9], lo1: [42, 32], conc: [42, 39], up0: [46, 39], up1: [88, 76], roof0: [60, 88], roof1: [96, 90] };
const SHIRTS = ['#e8e4da', '#d9463a', '#2f6cc1', '#f2c230', '#1f3a6b', '#ffffff', '#7fb24a', '#e77d2e', '#9e5bbd', '#23262d', '#f08aa0', '#4fb3c4'];
(() => {
  const step = 6;
  for (let d = -180; d < 180; d += step) {
    const a0 = d * D2R, a1 = (d + step) * D2R, mid = (d + step / 2);
    GEO.stands.push({ a0, a1, r0: standR(a0), r1: standR(a1), eye: Math.abs(mid) < EYE_DEG, mid: mid * D2R });
  }
  let s = 777; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 2600; i++) {
    const th = (rnd() * 2 - 1) * Math.PI, up = rnd() < 0.42, k = rnd();
    if (Math.abs(th) < (EYE_DEG + 1) * D2R && !up) continue; // blacked-out seats behind the batter's eye
    const r0 = standR(th), [f0, g0] = up ? BOWL.up0 : BOWL.wall, [f1, g1] = up ? [BOWL.up1[0] - 6, BOWL.up1[1] - 6] : BOWL.lo1;
    const back = f0 + (f1 - f0) * k, y = g0 + (g1 - g0) * k + 1.2;
    GEO.crowd.push({ p: [Math.sin(th) * (r0 + back), y, Math.cos(th) * (r0 + back)], c: SHIRTS[(rnd() * SHIRTS.length) | 0] });
  }
  // seat rows as rings along each deck
  const ringAt = (f, g) => { const o = []; for (let d = -180; d <= 180; d += 3) { const th = d * D2R, r = standR(th) + f; o.push([Math.sin(th) * r, g, Math.cos(th) * r]); } return o; };
  for (let k = 1; k < 8; k++) GEO.rows.push(ringAt(BOWL.wall[0] + (BOWL.lo1[0] - BOWL.wall[0]) * k / 8, BOWL.wall[1] + (BOWL.lo1[1] - BOWL.wall[1]) * k / 8));
  for (let k = 1; k < 7; k++) GEO.rows.push(ringAt(BOWL.up0[0] + (BOWL.up1[0] - BOWL.up0[0]) * k / 7, BOWL.up0[1] + (BOWL.up1[1] - BOWL.up0[1]) * k / 7));
  for (let i = 0; i < 14; i++) GEO.clouds.push({ th: (i * 26 + rnd() * 14) * D2R, y: 380 + rnd() * 260, w: 0.8 + rnd() * 0.8, puffs: Array.from({ length: 5 }, () => [rnd() * 2 - 1, rnd() * 0.4, 0.45 + rnd() * 0.5]) });
})();

/* ---------- drawing primitives ---------- */
function clipPoly(pts) {
  const c = pts.map(toCam), out = [], NZ = 0.3;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const ain = a[2] >= NZ, bin = b[2] >= NZ;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (NZ - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NZ]); }
  }
  return out.map(projC);
}
function poly(pts, fill, stroke, lw = 1) {
  const s = clipPoly(pts); if (s.length < 3) return;
  ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function polyline(pts, col, lw) {
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
  let pen = false;
  for (const p of pts) { const s = P(p); if (!s) { pen = false; continue; } if (!pen) { ctx.moveTo(s[0], s[1]); pen = true; } else ctx.lineTo(s[0], s[1]); }
  ctx.stroke();
}
let FIGQ = null; // while drawing a figure, strokes queue up so all the outlines go down before any fill
function fig(fn, at, alpha = 1) {
  if (at) { // soft contact shadow on the ground
    const L = Math.hypot(SUN[0], SUN[2]), dx = -SUN[0] / L, dz = -SUN[2] / L, pts = []; // cast away from the afternoon sun
    for (let d = 0; d < 360; d += 30) { const c = Math.cos(d * D2R), s = Math.sin(d * D2R), a = 0.9 + c * 1.7, b = s * 0.8; pts.push([at[0] + dx * a - dz * b, 0.03, at[2] + dz * a + dx * b]); }
    ctx.globalAlpha = 0.3 * alpha; poly(pts, '#123a18'); ctx.globalAlpha = 1;
  }
  FIGQ = []; fn(); const q = FIGQ; FIGQ = null;
  ctx.globalAlpha = alpha;
  q.forEach(o => o(true)); q.forEach(o => o(false));
  ctx.globalAlpha = 1;
}
const OUTLINE = 'rgba(22,20,26,.82)';
function line3(a, b, w, col) {
  if (FIGQ) { FIGQ.push(ol => line3raw(a, b, ol ? w + 0.09 : w, ol ? OUTLINE : col, !ol)); return; }
  line3raw(a, b, w, col, false);
}
function line3raw(a, b, w, col, shade) {
  const pa = P(a), pb = P(b); if (!pa || !pb) return;
  if (shade && w > 0.25) { // a thin highlight down the limb gives it a rounded look
    const lw = Math.max(1, w * (pa[2] + pb[2]) / 2);
    ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = lw * 0.35;
    ctx.beginPath(); ctx.moveTo(pa[0] - lw * 0.18, pa[1] - lw * 0.1); ctx.lineTo(pb[0] - lw * 0.18, pb[1] - lw * 0.1); ctx.stroke();
    return;
  }
  ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, w * (pa[2] + pb[2]) / 2);
  ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
}
function disc3(c, r, col, half) {
  if (FIGQ) { FIGQ.push(ol => disc3raw(c, ol ? r + 0.05 : r, ol ? OUTLINE : col, half)); return; }
  disc3raw(c, r, col, half);
}
function disc3raw(c, r, col, half) {
  const p = P(c); if (!p) return;
  ctx.fillStyle = col; ctx.beginPath();
  if (half) ctx.arc(p[0], p[1], Math.max(1, r * p[2]), Math.PI, 0); else ctx.arc(p[0], p[1], Math.max(1, r * p[2]), 0, Math.PI * 2);
  ctx.fill();
}
const quad = (a0, a1, r0, y0, r1, y1, cx = 0, cz = 0) => [[cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0], [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0], [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1], [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1]];

/* ---------- scene: a sunny afternoon at the park ---------- */
const SUN = norm([-0.45, 0.7, -0.55]), SUN_AZ = Math.atan2(SUN[0], SUN[2]);
const shadeHex = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };
const sp3 = (th, r, y) => [Math.sin(th) * r, y, Math.cos(th) * r];
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const SKY = { rain: ['#56636f', '#7d8a96', '#a4aeb7', '#c3cbd1'], storm: ['#2c333d', '#4b5561', '#6e7883', '#8d969e'], snow: ['#9aa7b4', '#c5ced7', '#e2e7ec', '#f2f4f6'],
    tornado: ['#3d4a34', '#5f6d4f', '#86907a', '#a7ad9c'], silly: ['#ff9ad5', '#ffc6a8', '#fff1a8', '#bff6d6'] }[WX.kind] || ['#2f7fd0', '#6fb3e8', '#b9def4', '#e4f2f7'];
  g.addColorStop(0, SKY[0]); g.addColorStop(0.45, SKY[1]); g.addColorStop(0.8, SKY[2]); g.addColorStop(1, SKY[3]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sp = WX.kind === 'sunny' || WX.kind === 'silly' ? P(addv(cam.pos, mul(SUN, 3000))) : null; // no sun through the clouds
  if (sp) {
    const r = Math.max(W, H) * 0.35, rg = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], r);
    rg.addColorStop(0, 'rgba(255,250,225,.95)'); rg.addColorStop(0.06, 'rgba(255,246,210,.75)'); rg.addColorStop(0.25, 'rgba(255,240,200,.18)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = rg; ctx.fillRect(sp[0] - r, sp[1] - r, r * 2, r * 2);
  }
  for (const c of GEO.clouds) { // puffy cumulus far off, flat-bottomed, lit from above
    const at = [Math.sin(c.th) * 1600, c.y, Math.cos(c.th) * 1600], p = P(at); if (!p) continue;
    const u = 70 * c.w * p[2];
    if (u < 3) continue;
    const grey = { rain: 1, storm: 1, tornado: 1, snow: 0.5 }[WX.kind] || 0;
    ctx.fillStyle = grey ? `rgba(${120 - 40 * grey},${128 - 40 * grey},${138 - 40 * grey},.92)` : 'rgba(214,226,238,.9)';
    for (const [dx, dy, s] of c.puffs) { ctx.beginPath(); ctx.ellipse(p[0] + dx * u * 1.6, p[1] - dy * u + u * 0.12, u * s * 1.1, u * s * 0.8, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = grey ? `rgba(${165 - 50 * grey},${172 - 50 * grey},${182 - 50 * grey},.95)` : 'rgba(255,255,255,.95)';
    for (const [dx, dy, s] of c.puffs) { ctx.beginPath(); ctx.ellipse(p[0] + dx * u * 1.6, p[1] - dy * u - u * 0.08, u * s, u * s * 0.72, 0, 0, Math.PI * 2); ctx.fill(); }
  }
}
/* one wedge of the bowl, drawn back to front */
function drawStand(s, moving) {
  const { a0, a1, r0, r1, lit } = s;
  const band = (fa, ga, fb, gb, col) => poly([sp3(a0, r0 + fa, ga), sp3(a1, r1 + fa, ga), sp3(a1, r1 + fb, gb), sp3(a0, r0 + fb, gb)], col);
  const B = BOWL;
  band(B.up1[0], B.up1[1], B.up1[0], B.roof1[1], shadeHex('#b8bfc8', lit)); // back wall up to the roof
  band(B.up0[0], B.up0[1], B.up1[0], B.up1[1], shadeHex(s.eye ? '#2c5c9c' : '#2f63a6', lit)); // upper deck seats
  if (!moving) band(B.up0[0] + (B.up1[0] - B.up0[0]) * 0.45, B.up0[1] + (B.up1[1] - B.up0[1]) * 0.45, B.up1[0], B.up1[1], 'rgba(10,22,44,.38)'); // the roof's shadow on the top rows
  band(B.conc[0], B.lo1[1], B.up0[0], B.up0[1], shadeHex('#9aa3ad', lit)); // concourse floor
  band(B.lo1[0], B.lo1[1], B.conc[0], B.conc[1], shadeHex('#d8dce1', lit)); // upper deck facade
  if (!moving) band(B.lo1[0] + 0.5, B.conc[1] - 1.6, B.lo1[0] + 0.5, B.conc[1] - 0.4, s.i % 2 ? '#d9463a' : '#f2c230'); // ribbon of colour along the facade
  band(B.wall[0], B.wall[1], B.lo1[0], B.lo1[1], s.eye ? '#1d3528' : shadeHex(s.i % 2 ? '#2d5f9e' : '#2a5894', lit)); // lower deck
  band(0, 0, 0, B.wall[1], shadeHex('#1f4a73', lit)); // padded front wall
  if (!moving) band(0, B.wall[1] - 0.2, 0, B.wall[1] + 0.5, '#f2c230');
  band(B.roof0[0], B.roof0[1], B.roof1[0], B.roof1[1], '#7f8a96'); // roof underside
  if (!moving) band(B.roof0[0], B.roof0[1] - 0.2, B.roof0[0], B.roof0[1] + 3.2, shadeHex('#f2f3f5', lit)); // roof fascia
}
function drawStands(moving) {
  if (!GEO.standsLit) GEO.stands.forEach((s, i) => { s.i = i; s.lit = 0.82 + 0.24 * -Math.cos(s.mid - SUN_AZ); }), GEO.standsLit = true;
  const list = GEO.stands.map(s => ({ s, d: toCam(sp3(s.mid, standR(s.mid) + 40, 30))[2] })).filter(o => o.d > -120).sort((a, b) => b.d - a.d);
  for (const { s } of list) drawStand(s, moving);
  if (!moving) for (const r of GEO.rows) polyline(r, 'rgba(8,18,38,.28)', 1);
  for (let i = 0; i < GEO.crowd.length; i += moving ? 5 : 1) {
    const c = GEO.crowd[i], p = P(c.p); if (!p) continue;
    const s = Math.max(1, 1.5 * p[2]) * (moving ? 1.8 : 1);
    ctx.fillStyle = c.c; ctx.fillRect(p[0] - s / 2, p[1] - s, s, s * 1.1);
    if (s > 2.2) { ctx.fillStyle = '#c58c62'; ctx.fillRect(p[0] - s * 0.25, p[1] - s * 1.55, s * 0.5, s * 0.5); }
  }
  // the batter's eye: a flat dark green wall in dead center so hitters can pick up the ball
  const eR = standR(0) - 6, eA = (EYE_DEG + 1) * D2R;
  poly([sp3(-eA, eR, 0), sp3(eA, eR, 0), sp3(eA, eR, 44), sp3(-eA, eR, 44)], '#22422f');
  for (let k = -5; k <= 5; k++) line3([...sp3(k * eA / 6, eR - 0.2, 0)], [...sp3(k * eA / 6, eR - 0.2, 44)], 0.25, 'rgba(10,30,18,.35)');
  polyline(arc(0, 0, eR - 0.3, -eA, eA, 8, 44), '#f2c230', 1.5);
}
/* dugouts sunk into foul territory down each line, and a backstop behind the plate */
const DUGOUTS = [1, -1].map(side => {
  const u = [side * Math.SQRT1_2, Math.SQRT1_2], n = [side * Math.SQRT1_2, -Math.SQRT1_2], c = [u[0] * 62, u[1] * 62];
  const pt = (a, b, y) => [c[0] + u[0] * a + n[0] * b, y, c[1] + u[1] * a + n[1] * b];
  return { pt, side };
});
function drawDugout(dg) {
  const { pt } = dg, L = 22, f0 = 26, f1 = 36;
  poly([pt(-L, f0, 0.02), pt(L, f0, 0.02), pt(L, f1, 0.02), pt(-L, f1, 0.02)], '#33281e'); // the pit
  poly([pt(-L, f1, 0), pt(L, f1, 0), pt(L, f1, 6.8), pt(-L, f1, 6.8)], '#16202b'); // back wall in shade
  for (const a of [-L, L]) poly([pt(a, f0, 0), pt(a, f1, 0), pt(a, f1, 6.8), pt(a, f0, 6.8)], '#2a3a4c');
  for (let k = -L + 3; k < L; k += 3.2) poly([pt(k, f1 - 1.6, 0.1), pt(k + 1.4, f1 - 1.6, 0.1), pt(k + 1.4, f1 - 0.3, 2.6), pt(k, f1 - 0.3, 2.6)], '#2c3f58'); // bench silhouettes
  poly([pt(-L, f0, 0), pt(L, f0, 0), pt(L, f0, 2.2), pt(-L, f0, 2.2)], '#1f4a73'); // padded front lip
  polyline([pt(-L, f0, 2.2), pt(L, f0, 2.2)], '#f2c230', 1.5);
  poly([pt(-L - 0.5, f0 - 0.6, 6.8), pt(L + 0.5, f0 - 0.6, 6.8), pt(L + 0.5, f1 + 0.4, 7.4), pt(-L - 0.5, f1 + 0.4, 7.4)], '#b9bec6'); // roof
  poly([pt(-L - 0.5, f0 - 0.6, 5.6), pt(L + 0.5, f0 - 0.6, 5.6), pt(L + 0.5, f0 - 0.6, 6.8), pt(-L - 0.5, f0 - 0.6, 6.8)], dg.side > 0 ? teamDark(1) : teamDark(0));
}
function drawBackstop() {
  const a0 = 128 * D2R, a1 = 232 * D2R, r = 36;
  for (let i = 0; i < 12; i++) {
    const b0 = a0 + (a1 - a0) * i / 12, b1 = a0 + (a1 - a0) * (i + 1) / 12;
    poly([sp3(b0, r, 0), sp3(b1, r, 0), sp3(b1, r, 4.5), sp3(b0, r, 4.5)], i % 2 ? '#1f4a73' : '#22507c');
    poly([sp3(b0, r, 4.5), sp3(b1, r, 4.5), sp3(b1, r, 24), sp3(b0, r, 24)], 'rgba(40,44,52,.16)');
    line3(sp3(b0, r, 0), sp3(b0, r, 25), 0.25, '#4a4f58');
  }
  polyline(arc(0, 0, r, a0, a1, 14, 24), '#4a4f58', 1.2);
  polyline(arc(0, 0, r, a0, a1, 14, 4.5), '#f2c230', 1.2);
}
function drawStatic(moving) {
  // turf: dark base, the light mowing bands over it, mottling and blades of grass
  poly(GEO.grass, '#3e8a35');
  GEO.stripes.forEach(s => poly(s, '#58a645'));
  if (!moving) GEO.patches.forEach(p => poly(p.pts, p.c));
  if (!moving) drawBlades();
  poly(GEO.track, '#b8784a');
  if (!moving) polyline(arc(0, 0, FENCE_R - 13, -45 * D2R, 45 * D2R, 30, 0.02), 'rgba(40,90,30,.5)', 2);
  poly(GEO.dirt, '#c98450');
  poly(GEO.home, '#c98450');
  // groomed rings from the infield drag, then packed dirt where players stand and run
  if (!moving) for (const r of INF.rakes) polyline(r.pts, r.light ? 'rgba(255,214,170,.14)' : 'rgba(110,56,24,.12)', 2.5);
  poly(circle(0, 0.3, 9, 28), 'rgba(150,84,44,.4)');
  poly(circle(0, 50.2, 6.5, 24), 'rgba(150,84,44,.38)');
  BASES.forEach(([x, z]) => poly(circle(x, z, 4.2, 20), 'rgba(150,84,44,.38)'));
  const lanes = [[0, 0], BASES[0], BASES[1], BASES[2], [0, 0]];
  for (let i = 0; i < 4; i++) { // worn base paths, a couple of feet wide
    const [ax, az] = lanes[i], [bx, bz] = lanes[i + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), nx = -dz / L * 1.4, nz = dx / L * 1.4;
    poly([[ax + nx, 0.014, az + nz], [bx + nx, 0.014, bz + nz], [bx - nx, 0.014, bz - nz], [ax - nx, 0.014, az - nz]], 'rgba(150,84,44,.26)');
  }
  if (!moving) drawSpecks(INF.grains); // fine grain only when the camera is still (it's redrawn every frame while moving)
  // the lip where the dirt meets the grass
  polyline(arc(0, 0, 80, -52 * D2R, 52 * D2R, 40, 0.03), 'rgba(40,80,26,.7)', 2.5);
  polyline(arc(0, 0, 80.6, -52 * D2R, 52 * D2R, 40, 0.03), 'rgba(150,200,100,.3)', 1.5);
  polyline([[BASES[0][0], 0.02, BASES[0][1]], [BASES[1][0], 0.02, BASES[1][1]], [BASES[2][0], 0.02, BASES[2][1]]], 'rgba(255,248,235,.12)', 2);
  // foul lines
  const POLE = FENCE_R / Math.SQRT2;
  for (const s of [1, -1]) { const o = 0.12; poly([[s * o, 0.01, -o], [s * (POLE + o), 0.01, POLE - o], [s * (POLE - o), 0.01, POLE + o], [-s * o, 0.01, o]], '#fbf8f0'); }
  polyline(GEO.mound, 'rgba(255,248,235,.55)', 1.5);
  poly([[-1, 0.02, 50], [1, 0.02, 50], [1, 0.02, 50.5], [-1, 0.02, 50.5]], '#fbf8f0');
  // strike mat behind the plate (slowpitch): plate + mat is the target
  poly([[-MAT.half, 0.015, MAT.z1], [MAT.half, 0.015, MAT.z1], [MAT.half, 0.015, MAT.z0], [-MAT.half, 0.015, MAT.z0]], '#cfa56c', 'rgba(110,72,36,.7)', 1.5);
  poly([[-0.71, 0.02, 1.42], [0.71, 0.02, 1.42], [0.71, 0.02, 0.71], [0, 0.02, 0], [-0.71, 0.02, 0.71]], '#fbf8f0');
  for (const s of [-1, 1]) poly([[s * 1.6, 0.01, -1.6], [s * 4.6, 0.01, -1.6], [s * 4.6, 0.01, 4.6], [s * 1.6, 0.01, 4.6]], null, 'rgba(255,248,235,.6)', 1.2);
  BASES.forEach(([x, z]) => { poly([[x + 0.25, 0.03, z - 1.1], [x + 1.1, 0.03, z - 0.25], [x + 0.25, 0.03, z + 0.6], [x - 0.6, 0.03, z - 0.25]], 'rgba(60,30,10,.25)'); poly([[x, 0.05, z - 0.9], [x + 0.9, 0.05, z], [x, 0.05, z + 0.9], [x - 0.9, 0.05, z]], '#fbf8f0'); });
  // the ballpark, back to front
  if (PARK === 'hampton') drawHampton2D(moving);
  else { drawStands(moving);
  DUGOUTS.forEach(drawDugout);
  drawBackstop();
  // outfield wall: blue padding with a yellow home run line, and the distances
  GEO.fence.forEach(([a0, a1], i) => {
    const lit = 0.85 + 0.2 * -Math.cos((a0 + a1) / 2 - SUN_AZ);
    poly(quad(a0, a1, FENCE_R, 0, FENCE_R, FENCE_H), shadeHex(i % 2 ? '#1f4a73' : '#22507c', lit));
  });
  for (const [deg, txt] of [[-40, String(FENCE_R)], [40, String(FENCE_R)], [-20, String(FENCE_R)], [20, String(FENCE_R)], [0, String(FENCE_R)]]) {
    const q = P([Math.sin(deg * D2R) * (FENCE_R - 0.2), 4.2, Math.cos(deg * D2R) * (FENCE_R - 0.2)]);
    if (q && q[2] > 1.5) { ctx.fillStyle = '#fbf8f0'; ctx.textAlign = 'center'; ctx.font = `800 ${Math.max(8, 3.6 * q[2])}px ${FONT_D}`; ctx.fillText(txt, q[0], q[1]); ctx.textAlign = 'left'; }
  }
  polyline(arc(0, 0, FENCE_R, -45 * D2R, 45 * D2R, 30, FENCE_H), '#f2c230', 2.5);
  for (const s of [-1, 1]) { line3([s * POLE, 0, POLE], [s * POLE, 34, POLE], 0.6, '#f2c230'); poly([[s * POLE, 10, POLE], [s * (POLE + 2.5), 10, POLE + 2.5], [s * (POLE + 2.5), 32, POLE + 2.5], [s * POLE, 32, POLE]], 'rgba(242,194,48,.55)'); }
  }
}
/* Hampton Park (Ottawa), laid out from the satellite view. Home plate is Hampton Park Field #1, facing north
   (+z north, +x east, about 2.6 ft per real metre of map, so the field matches our 250 ft fence):
   the Queensway (417) runs SW to NE past the first-base side, Field #2 sits out past right-centre against the highway,
   the wading pool and its parking lot are past left-centre, the grocery store and the Sebring Ave plaza are behind
   third base, the old-growth woods fill everything north, and Parkview Rd's houses back onto the park to the west. */
const HAMPTON = (() => { let sd = 99; const r = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const hw = { p0: [260, -26], u: [0.61, 0.79], n: [0.79, -0.61], w: 125, t0: -760, t1: 1250 }; // the Queensway: west edge, along, across (away from the park)
  const offHw = (x, z) => (x - hw.p0[0]) * hw.n[0] + (z - hw.p0[1]) * hw.n[1]; // >0: on the highway side of its west edge
  const trees = [], cols = ['#2f6b2a', '#3d7d30', '#4f8d38', '#2a5f2c'];
  const add = (x, z, big = 1) => { if (offHw(x, z) > -12) return; trees.push({ x, z, h: (30 + r() * 30) * big, cr: (12 + r() * 9) * big, c: cols[(r() * 4) | 0] }); };
  for (let i = 0; i < 240; i++) { // the woods: trees over 250 years old, with a dog-walkers' path up the middle
    const x = -470 + r() * 900, z = 500 + r() * 820;
    if (Math.abs(x - (-30 + (z - 450) * 0.18)) < 16) continue;
    if (x > 230 && z > 640) continue; // the open grass and the dog run toward Island Park Dr
    if (Math.hypot(x - 338, z - 351) < 260) continue; // Field #2
    add(x, z, 1.1);
  }
  for (let i = 0; i < 34; i++) add(-330 + r() * 120, -10 + r() * 520);           // the treed strip between the field and the back yards
  for (let i = 0; i < 26; i++) { const t = -380 + r() * 980, o = -22 - r() * 26; add(hw.p0[0] + hw.u[0] * t + hw.n[0] * o, hw.p0[1] + hw.u[1] * t + hw.n[1] * o, 0.8); } // along the highway
  for (let i = 0; i < 10; i++) add(-120 + r() * 220, 470 + r() * 40, 0.9);      // round the pool
  const houses = [], walls = ['#d8cbb3', '#b9a690', '#e4e0d6', '#9fa9b0', '#c49a7a'], roofs = ['#4a4d52', '#6b3e2e', '#3f4a3a'];
  for (const x of [-470, -545, -700, -775]) for (let z = -60; z < 1080; z += 52 + r() * 10) houses.push({ x: x + (r() - 0.5) * 8, z, w: 30 + r() * 10, d: 34 + r() * 10, h: 18 + r() * 8, wall: walls[(r() * 5) | 0], roof: roofs[(r() * 3) | 0] });
  return {
    hw, offHw, trees, houses,
    field2: [338, 351],
    grocery: { x: -215, z: -125, w: 210, d: 160, h: 26, ang: 35 * D2R },
    plaza: { x: -585, z: -160, w: 400, d: 70, h: 20, ang: 20 * D2R },
    lots: [ [[-210, 270], [70, 270], [70, 390], [-210, 390]],                                // the pool's lot, past left-centre
            [[-470, -200], [-60, -330], [-110, -470], [-520, -340]] ],                       // the plaza and grocery lot
    pool: { x: -20, z: 425, w: 64, d: 46 }, poolHouse: { x: -95, z: 405, w: 44, d: 28, h: 12 },
    dog: [[430, 640], [620, 640], [620, 760], [430, 760]],
    lights: [[-62, 150], [62, 150], [-38, 275], [38, 275], [-105, 70], [105, 70]],
  };
})();
function drawHampton2D(moving) {
  const sp = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r], H_ = HAMPTON, hw = H_.hw;
  poly([...arc(0, 0, FENCE_R, -80 * D2R, 80 * D2R, 30, 0), ...arc(0, 0, 1400, 80 * D2R, -80 * D2R, 30, 0)], '#4c8a3c'); // the park lawn
  for (const lot of H_.lots) poly(lot.map(([x, z]) => [x, 0.05, z]), '#6d7176');
  const hwp = (t, o, y = 0.06) => [hw.p0[0] + hw.u[0] * t + hw.n[0] * o, y, hw.p0[1] + hw.u[1] * t + hw.n[1] * o];
  poly([hwp(hw.t0, -6), hwp(hw.t1, -6), hwp(hw.t1, hw.w + 6), hwp(hw.t0, hw.w + 6)], '#55595e');
  poly([hwp(hw.t0, 61, 0.1), hwp(hw.t1, 61, 0.1), hwp(hw.t1, 63, 0.1), hwp(hw.t0, 63, 0.1)], '#c9ccce');
  for (const o of [0, hw.w]) { const a0 = hwp(hw.t0, o, 0), a1 = hwp(hw.t1, o, 0); poly([a0, a1, [a1[0], 3, a1[2]], [a0[0], 3, a0[2]]], '#b5b8ba'); }
  // the pool, its changing rooms, the grocery store and the plaza behind third
  const P_ = H_.pool; poly([[P_.x - P_.w / 2, 0.08, P_.z - P_.d / 2], [P_.x + P_.w / 2, 0.08, P_.z - P_.d / 2], [P_.x + P_.w / 2, 0.08, P_.z + P_.d / 2], [P_.x - P_.w / 2, 0.08, P_.z + P_.d / 2]], '#5fb7e0');
  const box2 = (c, w, d, h, ang, wall, roof) => {
    const cs = Math.cos(ang), sn = Math.sin(ang), k = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + (i * w / 2) * cs + (j * d / 2) * sn, c[1] - (i * w / 2) * sn + (j * d / 2) * cs]);
    const walls = [0, 1, 2, 3].map(i => { const a0 = k[i], a1 = k[(i + 1) % 4]; return { q: [[a0[0], 0, a0[1]], [a1[0], 0, a1[1]], [a1[0], h, a1[1]], [a0[0], h, a0[1]]], d: toCam([(a0[0] + a1[0]) / 2, h / 2, (a0[1] + a1[1]) / 2])[2] }; }).sort((x, y) => y.d - x.d);
    for (const w_ of walls) poly(w_.q, wall, 'rgba(0,0,0,.15)');
    poly(k.map(([x, z]) => [x, h, z]), roof);
  };
  const G_ = H_.grocery, Pl = H_.plaza, PH = H_.poolHouse;
  box2([G_.x, G_.z], G_.w, G_.d, G_.h, G_.ang, '#cdbf9f', '#8e9196');
  box2([Pl.x, Pl.z], Pl.w, Pl.d, Pl.h, Pl.ang, '#a8574a', '#7d8187');
  box2([PH.x, PH.z], PH.w, PH.d, PH.h, 0, '#d9d2c2', '#5c636b');
  // Field #2: its sand infield and backstop, out past right-centre
  const [f2x, f2z] = H_.field2;
  poly([[f2x, 0.07, f2z], ...arc(f2x, f2z, 80, -52 * D2R, 52 * D2R, 16, 0.07)], '#c9a46a');
  for (let i = 0; i < 6; i++) { const b0 = (140 + i * 13) * D2R, b1 = (153 + i * 13) * D2R; poly([sp(b0, 28, 0), sp(b1, 28, 0), sp(b1, 28, 16), sp(b0, 28, 16)].map(q => [q[0] + f2x, q[1], q[2] + f2z]), 'rgba(60,66,74,.2)'); }
  // the houses backing onto the park, far ones first
  const hs = H_.houses.map(h => ({ h, d: toCam([h.x, 10, h.z])[2] })).filter(o => o.d > 5).sort((a, b) => b.d - a.d);
  for (const { h } of hs) { box2([h.x, h.z], h.w, h.d, h.h, 0, h.wall, h.roof); }
  // trees, far ones first
  const trees = H_.trees.map(t => ({ t, d: toCam([t.x, t.h, t.z])[2] })).filter(o => o.d > 2).sort((a, b) => b.d - a.d);
  for (const { t } of trees) {
    const base = P([t.x, 0, t.z]), top = P([t.x, t.h, t.z]); if (!base || !top) continue;
    ctx.strokeStyle = '#5b4636'; ctx.lineWidth = Math.max(1, 1.6 * base[2]); ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1] + 8 * top[2]); ctx.stroke();
    ctx.fillStyle = t.c; ctx.beginPath(); ctx.ellipse(top[0], top[1], Math.max(3, t.cr * 1.1 * top[2]), Math.max(3, t.cr * top[2]), 0, 0, Math.PI * 2); ctx.fill();
  }
  // light towers
  for (const [ang, r] of [[-62, 150], [62, 150], [-38, 275], [38, 275]]) { line3(sp(ang * D2R, r, 0), sp(ang * D2R, r, 72), 0.6, '#7c858f'); const q = P(sp(ang * D2R, r, 72)); if (q) { ctx.fillStyle = '#dfe3e8'; ctx.fillRect(q[0] - 5 * q[2], q[1] - 2 * q[2], 10 * q[2], 4 * q[2]); } }
  // chain-link outfield fence with a yellow cap
  const POLE = FENCE_R / Math.SQRT2;
  for (let i = 0; i < 46; i++) { const t0 = (-46 + i * 2) * D2R, t1 = (-44 + i * 2) * D2R; poly([sp(t0, FENCE_R, 0), sp(t1, FENCE_R, 0), sp(t1, FENCE_R, 6), sp(t0, FENCE_R, 6)], 'rgba(60,66,74,.22)'); }
  polyline(arc(0, 0, FENCE_R, -45 * D2R, 45 * D2R, 30, 6), '#f2c230', 2.5);
  for (let d = -45; d <= 45; d += 8) line3(sp(d * D2R, FENCE_R, 0), sp(d * D2R, FENCE_R, 6.3), 0.12, '#9aa3ad');
  for (const s of [-1, 1]) line3([s * POLE, 0, POLE], [s * POLE, 22, POLE], 0.25, '#f2c230');
  // tall chain-link backstop
  for (let i = 0; i < 10; i++) { const b0 = (130 + i * 10) * D2R, b1 = (140 + i * 10) * D2R; poly([sp(b0, 32, 0), sp(b1, 32, 0), sp(b1, 32, 18), sp(b0, 32, 18)], 'rgba(60,66,74,.18)'); line3(sp(b0, 32, 0), sp(b0, 32, 18.5), 0.2, '#8d969e'); }
}
const FONT_D = '"Big Shoulders Display", Impact, sans-serif';
/* scoreboard up on the batter's eye, showing the live game */
function drawScoreboard() {
  const z = standR(0) - 7, y0 = 44, y1 = 70, w = 30;
  line3([-18, 40, z + 0.5], [-18, y0, z + 0.5], 1, '#30353d'); line3([18, 40, z + 0.5], [18, y0, z + 0.5], 1, '#30353d');
  poly([[-w - 1.2, y0 - 1.2, z], [w + 1.2, y0 - 1.2, z], [w + 1.2, y1 + 1.2, z], [-w - 1.2, y1 + 1.2, z]], '#e8e4da');
  poly([[-w, y0, z - 0.1], [w, y0, z - 0.1], [w, y1, z - 0.1], [-w, y1, z - 0.1]], '#14202b');
  poly([[-w, y1 - 6, z - 0.2], [w, y1 - 6, z - 0.2], [w, y1, z - 0.2], [-w, y1, z - 0.2]], '#b3302a');
  const hd = P([0, y1 - 3, z]), m = P([0, 56, z]); if (!m || m[2] < 0.5) return;
  const s = m[2];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (hd) { ctx.fillStyle = '#fbf8f0'; ctx.font = `900 ${Math.max(5, 3.8 * s)}px ${FONT_D}`; ctx.fillText('SLOWPITCH SHOWDOWN', hd[0], hd[1]); }
  const prac = PRACTICE(S.mode);
  const top = prac ? (S.rogue ? `ROGUE-LITE · STAGE ${S.rogue.stage}` : isTargets() ? 'HOME RUN TARGETS' : S.mode === 'derby' ? 'HOME RUN DERBY' : 'BULLPEN') : `${teamName(0)} ${S.score[0]}  ·  ${teamName(1)} ${S.score[1]}`;
  const bot = prac ? (isTargets() ? `HIT ${S.prac.targets.filter(t => t.hit).length}/${TARGET_COUNT}   ${Math.max(0, Math.ceil(S.prac.timeLeft))} S` : S.rogue ? `PTS ${S.rogue.pts}/${S.rogue.need}   OUTS ${S.rogue.outs}/${S.rogue.outsMax}` : S.mode === 'derby' && S.prac ? `HR ${S.prac.hr}   OUTS ${S.prac.outs}` : S.prac ? `STRIKES ${S.prac.strikes}/${S.prac.pitches}` : '') : `${S.half ? 'BOT' : 'TOP'} ${S.inning}   B${S.balls} S${S.strikes} O${S.outs}`;
  ctx.fillStyle = '#ffcf6b'; ctx.font = `900 ${Math.max(6, 5 * s)}px ${FONT_D}`;
  ctx.fillText(top, m[0], m[1] - 1 * s);
  ctx.fillStyle = '#fbf8f0'; ctx.font = `700 ${Math.max(5, 3.8 * s)}px ${FONT_D}`;
  ctx.fillText(bot, m[0], m[1] + 6.5 * s);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/* uniforms: road grays with red trim, home whites with navy pinstripes */
const teamCol = t => t ? '#f4f1e8' : '#b9bfc9';
const teamDark = t => t ? '#1f3a6b' : '#b3302a';
const teamPants = t => t ? '#f4f1e8' : '#aab1bc';
const teamPin = t => t ? 'rgba(31,58,107,.45)' : null;
const PANTS = '#e9e2cf', SKIN = '#c98d63', GLOVE = '#7a4a22', CLEAT = '#15171c';

/* ---------- player models: torso panels with numbers, sleeves, socks, caps and faces ---------- */
/* three builds, each with its own frame:
   small  — short and compact, wide shoulders, thick legs, a coiled spring
   normal — athletic shortstop: long legs, a clean V from shoulders to waist
   heavy  — the slugger: barrel chest, big belly, tree-trunk arms and legs */
const BUILD_LOOK = {
  // three silhouettes you can tell apart from the outfield
  small: { h: 0.86, lg: 0.88, tr: 0.92, w: 1.12, sh: 1.3, wa: 1.0, belly: 0, thick: 1.35, arm: 1.35, hd: 1, pec: 0.5, trap: 0.2, sd: 1.08 }, // short, compact and thick through the legs and forearms
  normal: { h: 1.06, lg: 1.08, tr: 1.0, w: 1.0, sh: 1.22, wa: 0.76, belly: 0, thick: 1.05, arm: 1.15, hd: 1, pec: 0.6, trap: 0.12, sd: 0.98 }, // long-legged athlete with a V-taper
  heavy: { h: 1.16, lg: 0.98, tr: 1.1, w: 1.4, sh: 1.38, wa: 1.28, belly: 0.5, thick: 1.6, arm: 1.45, hd: 1, pec: 0, trap: 0.3, sd: 0.95 }, // the slugger: barrel chest, traps, gut, big limbs
};
const SKINS = ['#f3d0b0', '#e6b48c', '#d09a6c', '#b07a4e', '#8a5a36', '#62402a'];
const HAIRS = ['#16110d', '#2e1d12', '#5a3c22', '#8f6233', '#c4a273', '#8d8d8d'];
const bodyCache = {};
function bodyFor(key, build = 'normal', t = 0) {
  const ck = key + '|' + build + '|' + t;
  if (bodyCache[ck]) return bodyCache[ck];
  let h = 2166136261; for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  const L = BUILD_LOOK[build] || BUILD_LOOK.normal, j = () => 0.97 + rnd() * 0.06;
  const B = {
    ...L, build, h: L.h * j(), w: L.w * j(), belly: L.belly ? L.belly * (0.8 + rnd() * 0.4) : 0,
    skin: SKINS[(rnd() * SKINS.length) | 0], hair: HAIRS[(rnd() * HAIRS.length) | 0],
    beard: rnd() < (build === 'heavy' ? 0.5 : 0.3), glasses: rnd() < 0.1, long: rnd() < 0.25, // long: a long-sleeve undershirt
    pants: teamPants(t), pin: teamPin(t),
  };
  B.hd *= L.sd; // close to real proportions
  return (bodyCache[ck] = B);
}
const DEFAULT_BODY = { ...BUILD_LOOK.normal, skin: SKIN, hair: HAIRS[1], beard: false, glasses: false, long: false, pants: PANTS, pin: null };
const NUMS = { batter: [7, 24], pitcher: [21, 3], catcher: [12, 9] };
const FIELD_NUMS = [0, 33, 4, 2, 15, 18, 8, 44, 11, 21];
function polyF(pts, col) { // a filled panel that joins the outline-first queue
  if (FIGQ) { FIGQ.push(ol => { const p = P(pts[0]); if (!p) return; poly(pts, ol ? null : col, ol ? OUTLINE : null, Math.max(1.5, 0.09 * p[2] * 2)); }); return; }
  poly(pts, col);
}
function textF(at, txt, sizeFt, col) {
  const fn = () => { const p = P(at); if (!p) return; const px = sizeFt * p[2]; if (px < 5) return;
    ctx.font = `900 ${px}px ${FONT_D}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1, px * 0.14); ctx.strokeStyle = 'rgba(8,10,22,.7)'; ctx.strokeText(txt, p[0], p[1]);
    ctx.fillStyle = col; ctx.fillText(txt, p[0], p[1]); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; };
  if (FIGQ) FIGQ.push(ol => { if (!ol) fn(); }); else fn();
}
const camFacing = n => -(n[0] * F[0] + n[2] * F[2]); // > 0 when this direction points at the camera
/* torso: hips to shoulders as a tapered jersey panel, belt, pinstripes, and the number on whichever side the camera sees */
function torso(hip, neck, side, col, dk, num, B = DEFAULT_BODY) {
  const S1 = 0.62 * B.w * B.sh, H1 = 0.44 * B.w * B.wa + B.belly * 0.5, mid = lerp3(hip, neck, 0.38), M1 = Math.max(H1, S1 * 0.8) + B.belly;
  const chest = lerp3(hip, neck, 0.78), C1 = S1 * 0.98 + B.belly * 0.3;
  const pts = [addv(hip, mul(side, -H1)), addv(hip, mul(side, H1)), addv(mid, mul(side, M1)), addv(chest, mul(side, C1)), addv(neck, mul(side, S1)), addv(neck, mul(side, -S1)), addv(chest, mul(side, -C1)), addv(mid, mul(side, -M1))];
  polyF(pts, col);
  if (B.pin) for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) lineF(addv(hip, mul(side, k * H1)), addv(neck, mul(side, k * S1)), 0.035, B.pin);
  line3(addv(hip, mul(side, -H1 * 0.95)), addv(hip, mul(side, H1 * 0.95)), 0.12, '#1b1d2b'); // belt
  line3(addv(neck, mul(side, -S1 * 0.55)), addv(neck, mul(side, S1 * 0.55)), 0.1, dk); // collar trim
  const n = [-side[2], 0, side[0]], c = lerp3(hip, neck, 0.58);
  if (num !== undefined && Math.abs(camFacing(n)) > 0.3) textF(c, String(num), 0.85 * Math.min(1.2, B.w), dk);
}
function lineF(a, b, w, col) { if (FIGQ) FIGQ.push(ol => { if (!ol) line3raw(a, b, w, col, false); }); else line3raw(a, b, w, col, false); }
/* a limb in two parts: sleeve then skin (arms), or pants then sock (legs). Big builds get a bulge at the biceps and forearm. */
function arm(sh, hand, col, w = 0.22, B = DEFAULT_BODY) {
  const el = lerp3(sh, hand, 0.45); w *= B.arm;
  line3(sh, el, w + 0.05, col);
  if (B.arm > 1.2) disc3(lerp3(sh, el, 0.45), w * 0.62, col);
  line3(el, hand, w - 0.02, B.long ? '#1b1d2b' : B.skin);
  if (B.arm > 1.2 && !B.long) disc3(lerp3(el, hand, 0.35), w * 0.5, B.skin);
  disc3(hand, 0.15 * Math.min(1.3, B.arm), B.skin);
}
function leg(hipP, knee, foot, dk, toe, B = DEFAULT_BODY) {
  const k = B.thick, pc = B.pants || PANTS; line3(hipP, knee, 0.34 * k, pc); const sock = lerp3(knee, foot, 0.4);
  line3(knee, sock, 0.3 * k, pc); line3(sock, foot, 0.25 * Math.sqrt(k), dk); // high socks, old-school
  line3(foot, addv(foot, toe), 0.24, CLEAT);
}
/* head with a cap (or batting helmet / catcher's mask), brim pointing where they face, and a face when it's toward us */
/* you, as a bobblehead on your batter: your photo cut out and given a glossy painted-resin finish,
   on an oversized head that wobbles on a spring neck. (The cartoon below is the fallback if the image can't load.) */
const FACE = { on: true, jig: 0, jv: 0, img: null };
/* photo face removed; the cartoon face is used */
try { FACE.on = localStorage.getItem('fpd-toon') !== 'off'; } catch (_) {}
function drawCaricature(g, r, t) {
  const SK = '#f1c7a4', SKD = '#d9a07c', HAIR = '#8b4a28', INK = '#14161c';
  g.lineJoin = 'round'; g.lineCap = 'round';
  // ears
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * r * 0.98, r * 0.08, r * 0.2, r * 0.27, 0, 0, Math.PI * 2); g.fillStyle = SKD; g.fill(); g.lineWidth = r * 0.07; g.strokeStyle = INK; g.stroke(); }
  // big round face, a little wider at the cheeks
  g.beginPath(); g.ellipse(0, r * 0.08, r * 0.98, r * 0.92, 0, 0, Math.PI * 2); g.fillStyle = SK; g.fill(); g.lineWidth = r * 0.09; g.strokeStyle = INK; g.stroke();
  // rosy cheeks
  g.fillStyle = 'rgba(226,110,100,.35)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * r * 0.55, r * 0.34, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); g.fill(); }
  // goatee and chin scruff
  g.fillStyle = HAIR; g.beginPath(); g.moveTo(-r * 0.32, r * 0.62); g.quadraticCurveTo(0, r * 1.12, r * 0.32, r * 0.62); g.quadraticCurveTo(0, r * 0.82, -r * 0.32, r * 0.62); g.fill();
  g.globalAlpha = 0.25; g.beginPath(); g.ellipse(0, r * 0.62, r * 0.72, r * 0.38, 0, 0, Math.PI); g.fill(); g.globalAlpha = 1;
  // the grin
  g.beginPath(); g.moveTo(-r * 0.36, r * 0.5); g.quadraticCurveTo(0, r * 0.78, r * 0.36, r * 0.5); g.closePath(); g.fillStyle = '#5a1f1a'; g.fill(); g.lineWidth = r * 0.06; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(-r * 0.28, r * 0.53); g.quadraticCurveTo(0, r * 0.62, r * 0.28, r * 0.53); g.lineTo(r * 0.24, r * 0.5); g.lineTo(-r * 0.24, r * 0.5); g.fillStyle = '#fff'; g.fill();
  // handlebar-ish mustache
  g.fillStyle = HAIR; g.beginPath(); g.moveTo(0, r * 0.38); g.quadraticCurveTo(-r * 0.3, r * 0.3, -r * 0.46, r * 0.52); g.quadraticCurveTo(-r * 0.24, r * 0.46, 0, r * 0.47); g.quadraticCurveTo(r * 0.24, r * 0.46, r * 0.46, r * 0.52); g.quadraticCurveTo(r * 0.3, r * 0.3, 0, r * 0.38); g.fill();
  // nose
  g.beginPath(); g.ellipse(0, r * 0.24, r * 0.13, r * 0.1, 0, 0, Math.PI * 2); g.fillStyle = SKD; g.fill();
  // googly eyes behind chunky black glasses
  const look = Math.sin(t * 1.7) * 0.05;
  for (const s of [-1, 1]) {
    g.beginPath(); g.ellipse(s * r * 0.36, -r * 0.08, r * 0.24, r * 0.22, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(s * r * 0.36 + r * (0.06 + look), -r * 0.05 + Math.abs(FACE.jig) * r * 0.06, r * 0.09, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  }
  g.lineWidth = r * 0.12; g.strokeStyle = INK;
  for (const s of [-1, 1]) { g.beginPath(); g.roundRect ? g.roundRect(s * r * 0.36 - r * 0.32, -r * 0.3, r * 0.64, r * 0.46, r * 0.08) : g.rect(s * r * 0.36 - r * 0.32, -r * 0.3, r * 0.64, r * 0.46); g.stroke(); }
  g.beginPath(); g.moveTo(-r * 0.05, -r * 0.12); g.lineTo(r * 0.05, -r * 0.12); g.stroke();
  g.beginPath(); g.moveTo(-r * 0.68, -r * 0.14); g.lineTo(-r * 0.92, -r * 0.2); g.moveTo(r * 0.68, -r * 0.14); g.lineTo(r * 0.92, -r * 0.2); g.stroke();
  // black trucker cap with a mesh back and a cream S, brim tipped up a touch
  g.beginPath(); g.moveTo(-r * 1.02, -r * 0.34); g.bezierCurveTo(-r * 1.0, -r * 1.45, r * 1.0, -r * 1.45, r * 1.02, -r * 0.34); g.closePath();
  g.fillStyle = '#262a31'; g.fill(); g.lineWidth = r * 0.09; g.strokeStyle = INK; g.stroke();
  g.fillStyle = 'rgba(120,124,132,.35)'; for (let k = -3; k <= 3; k++) for (let m = 0; m < 3; m++) { g.beginPath(); g.arc(r * (k * 0.13 + (m % 2) * 0.065) + r * 0.62, -r * (0.5 + m * 0.16), r * 0.025, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.moveTo(-r * 1.05, -r * 0.36); g.quadraticCurveTo(-r * 0.2, -r * 0.62, r * 0.75, -r * 0.42); g.quadraticCurveTo(r * 1.45, -r * 0.3, r * 1.55, -r * 0.12); g.quadraticCurveTo(r * 0.6, -r * 0.2, -r * 1.05, -r * 0.3); g.closePath();
  g.fillStyle = '#3a3f47'; g.fill(); g.lineWidth = r * 0.07; g.stroke();
  g.fillStyle = '#eee3c4'; g.font = `900 ${r * 0.62}px ${FONT_D}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = r * 0.06; g.strokeStyle = INK; g.strokeText('S', -r * 0.05, -r * 0.82); g.fillText('S', -r * 0.05, -r * 0.82);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
function bobbleHead(c, dk) {
  const draw = () => {
    const q = P(addv(c, [0, 0.75 + FACE.jig * 0.1, 0])), nk = P(addv(c, [0, -0.15, 0])); if (!q || !nk) return;
    const r = 0.82 * q[2]; // a proper bobblehead: about twice a normal head
    // the spring neck it bobbles on
    ctx.strokeStyle = '#d9a07c'; ctx.lineWidth = Math.max(2, r * 0.28); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(nk[0], nk[1]); ctx.lineTo(q[0] + FACE.jig * r * 0.15, q[1] + r * 0.7); ctx.stroke();
    ctx.save(); ctx.translate(q[0] + FACE.jig * r * 0.15, q[1]); ctx.rotate(FACE.jig * 0.22);
    if (FACE.img) {
      const hh = r * 3.1, ww = hh * FACE.img.width / FACE.img.height; // oversized, like a real bobblehead
      ctx.drawImage(FACE.img, -ww * 0.47, -hh * 0.55, ww, hh);
    } else drawCaricature(ctx, r, performance.now() / 1000);
    ctx.restore();
  };
  if (FIGQ) FIGQ.push(ol => { if (!ol) draw(); }); else draw();
}
function stepJiggle(dt) { // a spring that the swing kicks
  const w = Math.abs(S && S.bat ? S.bat.w : 0);
  FACE.jv += (-FACE.jig * 90 - FACE.jv * 6 + (w > 10 ? w * 1.4 * Math.sign(Math.sin(performance.now() / 40)) : 0)) * dt;
  FACE.jig = clamp(FACE.jig + FACE.jv * dt, -1.5, 1.5);
}
function headF(c, face, dk, kind = 'cap', B = DEFAULT_BODY) {
  const side = [face[2], 0, -face[0]], hz = B.hd || 1;
  if (kind !== 'mask') disc3(addv(addv(c, mul(face, -0.12)), [0, -0.02, 0]), 0.39 * hz, B.hair); // hair showing under the back of the cap
  disc3(c, 0.38 * hz, B.skin);
  const toward = camFacing(face);
  if (B.beard && kind !== 'mask' && toward > -0.5) disc3(addv(addv(c, mul(face, 0.16)), [0, -0.2, 0]), 0.24 * hz, B.hair);
  if (toward > 0.15 && kind !== 'mask') { // eyes and a little shadow under the brim
    for (const s of [-1, 1]) disc3(addv(addv(c, mul(face, 0.3)), addv(mul(side, s * 0.13), [0, -0.02, 0])), 0.045, '#1a1410');
    if (B.glasses) line3(addv(addv(c, mul(face, 0.33)), mul(side, -0.2)), addv(addv(c, mul(face, 0.33)), mul(side, 0.2)), 0.05, '#20222c');
  }
  if (kind === 'mask') { disc3(c, 0.4, '#2b2f45'); line3(addv(c, [0, 0.12, 0]), addv(c, [0, -0.2, 0]), 0.05, '#9aa0ad'); line3(addv(addv(c, mul(side, -0.2)), [0, -0.05, 0]), addv(addv(c, mul(side, 0.2)), [0, -0.05, 0]), 0.05, '#9aa0ad'); return; }
  disc3(addv(c, [0, 0.12, 0]), (kind === 'helmet' ? 0.46 : 0.41) * hz, dk, true);
  line3(addv(c, addv(mul(face, 0.18), [0, 0.12, 0])), addv(c, addv(mul(face, kind === 'helmet' ? 0.5 : 0.58), [0, 0.1, 0])), 0.1, dk); // brim
  if (kind === 'helmet') disc3(addv(addv(c, mul(side, -0.3)), [0, -0.05, 0]), 0.17, dk); // ear flap on the side facing the pitcher
}

function standing(base, face, col, dk, o = {}) {
  const B = o.body || DEFAULT_BODY, hs = B.h, ws = B.w;
  const f = [Math.sin(face), 0, Math.cos(face)], r = [f[2], 0, -f[0]];
  const at = (rx, y, fz) => [base[0] + r[0] * rx * ws + f[0] * fz, y, base[2] + r[2] * rx * ws + f[2] * fz];
  const sw = o.run ? Math.sin(o.run * 1.1) * 0.8 : 0;
  const hipY = 2.7 * B.lg * hs, kneeY = 1.4 * B.lg * hs, neckY = hipY + 1.85 * B.tr * hs, shY = neckY - 0.15 * hs, armY = shY - 1.25 * hs;
  const lx = 0.28 * Math.max(1, B.wa + B.belly * 0.5);
  leg(at(lx, hipY, 0), at(lx + 0.05, kneeY, sw * 0.5 + 0.1), at(lx + 0.1, 0.1, sw), dk, mul(f, 0.35), B);
  leg(at(-lx, hipY, 0), at(-lx - 0.05, kneeY, -sw * 0.5 + 0.1), at(-lx - 0.1, 0.1, -sw), dk, mul(f, 0.35), B);
  torso(at(0, hipY, 0), at(0, neckY, 0), r, col, dk, o.num, B);
  const hold = o.hold, sx = 0.55 * B.sh, ax = sx + 0.12 + B.belly * 0.6;
  arm(at(sx, shY, 0), hold ? at(sx, shY - 0.1, 0.6) : at(ax + 0.1, armY, 0.3 - sw * 0.3), col, 0.22, B);
  disc3(hold ? at(sx, shY - 0.1, 0.75) : at(ax + 0.14, armY - 0.1, 0.38 - sw * 0.3), 0.3, GLOVE);
  arm(at(-sx, shY, 0), at(-ax, armY, sw * 0.3), col, 0.22, B);
  headF(at(0, neckY + 0.57 * hs * B.hd, 0.02), f, dk, o.helmet ? 'helmet' : 'cap', B);
}
const LINEUP = [[7, 24, 2, 15, 31, 9, 44, 12, 5], [24, 1, 18, 3, 27, 8, 13, 50, 6]];
/* A slowpitch swing from the ground up: the weight shifts onto the front side, the hips open first and lead the
   shoulders, the back foot turns over onto its toe ("squash the bug"), the back knee drives in toward the front one,
   and the front leg firms up to hit against. Everything is keyed to how far around the bat is. */
function swingBody(bt) {
  const ph = bt.phi, rest = BAT.rest, sq = 12 * D2R;
  const load = clamp((ph - rest) / (sq - rest), 0, 1), fin = clamp((ph - sq) / (110 * D2R), 0, 1);
  const pivot = ease(clamp((load - 0.25) / 0.75, 0, 1));
  return {
    yaw: clamp(0.7 * (ph + 100 * D2R) - 25 * D2R, -40 * D2R, 100 * D2R),           // shoulders
    hipYaw: clamp(-22 * D2R + 0.8 * (ph + 100 * D2R), -25 * D2R, 110 * D2R),        // hips: ahead of the shoulders
    shift: 0.36 * ease(load) - 0.05 * fin,                                          // weight forward
    pivot, fin,
  };
}
function drawBatter() {
  const t = battingTeam(), col = teamCol(t), dk = teamDark(t), bt = S.bat;
  const slot = ((S.order && S.order[t]) || 0) % 9, B = bodyFor('bat' + t + '-' + slot, S.bb || 'normal', t), hs = B.h;
  const bx = bt.bx, bz = bt.bz, hands = [bt.hx, bt.hy, bt.hz];
  // the chest turns with the swing: slightly closed in the stance, square at contact, facing the pitcher after
  const SB = swingBody(bt), yaw = SB.yaw;
  const chest = [Math.cos(yaw), 0, Math.sin(yaw)], side = [-Math.sin(yaw), 0, Math.cos(yaw)]; // side points to the front shoulder
  const hy = SB.hipYaw, hipSide = [-Math.sin(hy), 0, Math.cos(hy)];
  const hipY = 2.8 * hs * B.lg - 0.06 * SB.pivot, hip = [bx - 0.05, hipY, bz + SB.shift], sc = [bx, hipY + 1.7 * hs * B.tr, bz + SB.shift * 0.55];
  const footF = [bx + 0.15, 0.1, bz + 1.25], footB = [bx - 0.1, 0.1 + 0.16 * SB.pivot, bz - 1.05 + 0.12 * SB.pivot];
  const hipF = addv(hip, mul(hipSide, 0.36)), hipB = addv(hip, mul(hipSide, -0.36));
  const kneeF = lerp3(hipF, footF, 0.5), kneeB = lerp3(hipB, footB, 0.5);
  kneeF[0] += 0.25 * (1 - 0.6 * SB.pivot); kneeB[0] += 0.3 + 0.2 * SB.pivot; kneeB[2] += 0.55 * SB.pivot; kneeF[1] = 1.4 * hs * B.lg + 0.12 * SB.pivot; kneeB[1] = 1.4 * hs * B.lg - 0.12 * SB.pivot;
  const sF = addv(sc, mul(side, 0.6 * B.w * B.sh)), sB = addv(sc, mul(side, -0.6 * B.w * B.sh));
  const head = addv([bx, sc[1] + 0.65 * hs * B.hd, bz], mul(chest, 0.1));
  const look = norm([0.35 * chest[0] + 0.1, 0, 1]); // eyes stay on the pitcher
  const body = () => {
    leg(hipF, kneeF, footF, dk, [0.35, 0, 0], B); leg(hipB, kneeB, footB, dk, [0.35, 0, 0], B);
    torso(hip, sc, side, col, dk, LINEUP[t][slot], B);
    if (FACE.on && humanBats()) bobbleHead(head, dk); else headF(head, look, dk, 'helmet', B);
  };
  const arms = () => {
    drawBatStick(hands);
    // draw the farther arm first so the near one overlaps it
    const nearF = toCam(sF)[2] < toCam(sB)[2];
    const [a1, a2] = nearF ? [sB, sF] : [sF, sB];
    arm(a1, hands, col, 0.22, B); arm(a2, hands, col, 0.22, B);
    disc3(hands, 0.18, '#1b1d2b'); // batting gloves
  };
  // whichever is farther from the camera is drawn first
  if (toCam(hands)[2] > toCam(sc)[2]) { arms(); body(); } else { body(); arms(); }
}
function drawBatStick(hands) {
  const bt = S.bat, d = batDir(bt.phi, bt.e);
  if (Math.abs(bt.w) > 14) { // swing blur
    const pts = [hands];
    for (let i = 0; i <= 6; i++) { const ph = bt.phi - bt.w * 0.02 * (1 - i / 6); pts.push(addv(hands, mul(batDir(ph, bt.e), BAT.L))); }
    poly(pts, 'rgba(243,234,210,.12)');
  }
  line3(addv(hands, mul(d, -0.2)), addv(hands, mul(d, 0.95)), 0.11, '#1b1b1b');
  line3(addv(hands, mul(d, 0.95)), addv(hands, mul(d, BAT.L)), 0.25, '#c9ced6');
  line3(addv(hands, mul(d, 1.6)), addv(hands, mul(d, 2.15)), 0.255, '#e2553f');
}
function drawPitcher() {
  const t = fieldingTeam(), col = teamCol(t), dk = teamDark(t);
  // stride: mine comes from the delivery physics, the opponent's from its animation
  const st = S.oppStride || 0;
  S.strideNow = S.freeHand ? 0 : st;
  const ln = S.lean || 0, la = Math.abs(ln); // A/D lean tilts the upper body over the rubber
  const dz = -FLICK.stride * st, S0 = [ARM.S[0] + 0.85 * ln, ARM.S[1] - 0.25 * st - 0.2 * la, ARM.S[2] + dz];
  const hip = [-0.1 + 0.25 * ln, 2.75 - 0.2 * st, 50.55 + dz * 0.7];
  // back (right) foot stays on the rubber, the front (left) foot strides toward the plate
  const toe = [0, 0, -0.35], B = bodyFor('pit' + t, 'normal', t);
  leg([-0.3, hip[1], hip[2]], [-0.4, 1.4, 50.45 + dz * 0.3], [-0.45, 0.1, 50.35], dk, toe, B);
  leg([0.3, hip[1], hip[2]], [0.55, 1.3 - 0.3 * st, 49.9 + dz * 1.1], [0.6, 0.1, 49.6 + dz * 1.6], dk, toe, B);
  const neck = [0.75 * ln, 4.55 - 0.25 * st - 0.18 * la, 50.35 + dz];
  torso([0.25 * ln, hip[1], hip[2]], neck, [-1, 0, 0], col, dk, NUMS.pitcher[t], B);
  arm([0.8 + neck[0], neck[1] - 0.05, neck[2]], [0.9 + neck[0], 3.7, neck[2] - 0.8], col, 0.22, B); disc3([0.9 + neck[0], 3.65, neck[2] - 0.9], 0.32, GLOVE);
  const h = handPos();
  // throwing arm: shoulder to elbow to hand, with a soft bend
  const mid = lerp3(S0, h, 0.5); mid[2] += 0.25; mid[1] -= 0.05;
  line3(S0, mid, 0.27 * B.arm, col); line3(mid, h, 0.2 * B.arm, B.long ? '#1b1d2b' : B.skin); disc3(h, 0.15, B.skin);
  headF([neck[0] * 1.1, neck[1] + 0.68, neck[2] - 0.05], [0, 0, -1], dk, 'cap', B);
}
/* first person: your own throwing arm and glove hand */
function drawFPArm() {
  const col = teamCol(fieldingTeam()), S0 = shoulderNow(), h = pendHand();
  // only the part of the arm out in front of your eyes is drawn (the upper arm is beside your head)
  const elbow = addv(lerp3(S0, h, 0.5), [-0.25, -0.25, 0]);
  const from = lerp3(S0, elbow, 0.55);
  if (toCam(from)[2] > 0.6) line3(from, elbow, 0.34, col);
  if (toCam(elbow)[2] > 0.5) line3(elbow, h, 0.22, SKIN);
  disc3(h, 0.16, SKIN);
  const e = cam.pos; disc3([e[0] + 0.75, e[1] - 1.55, e[2] - 1.25], 0.3, GLOVE);
}
function drawCatcher(alpha) {
  const t = fieldingTeam(), col = teamCol(t);
  const b = [0, 0, -4.4];
  const dk = teamDark(t);
  const B = bodyFor('cat' + t, 'heavy', t);
  leg([-0.35, 1.5, -4.5], [-0.65, 0.9, -3.9], [-0.6, 0.1, -4.2], dk, [0, 0, 0.3], B); leg([0.35, 1.5, -4.5], [0.65, 0.9, -3.9], [0.6, 0.1, -4.2], dk, [0, 0, 0.3], B);
  torso([0, 1.5, -4.6], [0, 3.05, -4.3], [1, 0, 0], col, dk, NUMS.catcher[t], B);
  polyF([[-0.45, 1.75, -4.2], [0.45, 1.75, -4.2], [0.5, 3.0, -4.05], [-0.5, 3.0, -4.05]], '#2b2f45'); // chest protector
  const mitt = S.caughtByCatcher ? [S.ball.x, S.ball.y, -3.4] : [0.1, 2.5, -3.6];
  arm([0.55, 2.9, -4.2], mitt, col, 0.22, B); disc3(mitt, 0.38, GLOVE);
  headF([0, 3.6, -4.2], [0, 0, 1], dk, 'mask');
  ctx.globalAlpha = 1;
}
/* ---------- base running: who runs where after the ball is hit, timed against the throw, with the umpire's call ---------- */
const LEG = Math.hypot(BASES[0][0], BASES[0][1]);
const BASE_PATH = [[0, 0], BASES[0], BASES[1], BASES[2], [0, 0]];
function pathPos(from, d) { // d feet along the base paths starting at base `from` (0 = home)
  let i = from; while (d >= LEG && i < 3) { d -= LEG; i++; }
  const a = BASE_PATH[i], b = BASE_PATH[i + 1], k = clamp(d / LEG, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], b[1] - a[1])];
}
let RUNPLAN = null;
function runnerPlan() {
  const bt = S.batted;
  if (!bt || !bt.out || PRACTICE(S.mode) && S.mode !== 'derby' || isTargets()) return null; // no running in target practice
  if (RUNPLAN && RUNPLAN.bt === bt) return RUNPLAN;
  const out = bt.out, b0 = bt.bases0 || [0, 0, 0], t = battingTeam(), R = [], calls = [];
  const plan = RUNPLAN = { bt, R, calls, stay: [], batter: null };
  if (out.type === 'foul') { b0.forEach((on, i) => on && plan.stay.push(i)); return plan; }
  const n = { single: 1, double: 2, triple: 3, hr: 4 }[out.type] || 0, deadline = bt.resolveAt + 1.3;
  const tf = 3.3 / BUILDS[S.bb || 'normal'].run, vBat = LEG / (tf - 0.35);
  const slot = ((S.order && S.order[t]) || 0) % 9;
  const add = (from, to, start, v, who, outAt) => {
    const dist = (to - from) * LEG;
    if (!outAt && start + dist / v > deadline) v = dist / Math.max(0.6, deadline - start); // long trips get hurried so the play doesn't drag
    const r = { from, to, start, v, dist, arrive: start + dist / v, outAt, ...who }; R.push(r); return r;
  };
  const batWho = { key: 'bat' + t + '-' + slot, build: S.bb || 'normal', num: LINEUP[t][slot], batter: true };
  const runWho = i => ({ key: 'run' + t + '-' + i, build: LINEUP_BUILDS[(i * 4 + 1) % 9], num: [5, 10, 16][i] });
  const moved = [false, false, false];
  if (out.type === 'out' && out.how === 'ground') {
    const ballAt1 = out.T + out.throwT;
    if (out.dp) {
      const t2 = out.T + hyp(out.at.x - BASES[1][0], out.at.z - BASES[1][1]) / 90 + 0.35, t1 = t2 + 0.3 + Math.hypot(BASES[1][0] - BASES[0][0], BASES[1][1] - BASES[0][1]) / 95;
      add(1, 2, 0.1, 20, runWho(0), t2); moved[0] = true; calls.push({ at: t2, base: 2, txt: 'OUT' });
      plan.batter = add(0, 1, 0.35, vBat, batWho, t1); calls.push({ at: t1, base: 1, txt: 'OUT' });
    } else { plan.batter = add(0, 1, 0.35, vBat, batWho, ballAt1); calls.push({ at: ballAt1, base: 1, txt: 'OUT' }); }
  } else if (out.type === 'out') { // caught in the air: the batter peels off, runners hold (or tag from third on a deep one)
    plan.batter = add(0, 1, 0.35, vBat * 0.8, batWho, out.T + 0.3);
    calls.push({ at: out.T, pos: [out.at.x, out.at.z], txt: 'OUT' });
    if (out.deep && (bt.outs0 || 0) < 2 && b0[2]) { const r = add(3, 4, out.T + 0.15, 22, runWho(2)); moved[2] = true; calls.push({ at: r.arrive, base: 4, txt: 'SCORES' }); }
  } else {
    const trot = n === 4;
    plan.batter = add(0, n, 0.35, trot ? 17 : vBat, batWho);
    if (!trot) calls.push({ at: plan.batter.arrive, base: n, txt: 'SAFE' });
    for (let i = 2; i >= 0; i--) if (b0[i]) {
      const to = Math.min(4, i + 1 + n), r = add(i + 1, to, trot ? 0.35 : 0.15, trot ? 17 : 21, runWho(i)); moved[i] = true;
      if (to === 4) calls.push({ at: r.arrive, base: 4, txt: 'SCORES' });
    }
  }
  b0.forEach((on, i) => { if (on && !moved[i]) plan.stay.push(i); });
  return plan;
}
/* where a runner is at time t: position, heading, whether he's moving, and the distance run (drives the stride) */
function runnerAt(r, t) {
  if (t < r.start) { const [x, z] = BASE_PATH[r.from]; return { x, z, face: 0, run: 0, d: 0 }; }
  let d = Math.min(r.dist, (t - r.start) * r.v); const stopped = r.outAt && t > r.outAt;
  if (stopped) d = Math.min(d, (r.outAt - r.start) * r.v);
  const [x, z, face] = pathPos(r.from, d);
  // runners take their bases a step to the side of the bag so they don't stand on it
  return { x, z, face, d, run: (d < r.dist && !stopped) ? d + 0.01 : 0 };
}
function runnersNow() { // the runners to draw right now, or null to use the plain base occupants
  const plan = (S.phase === 'batted' || S.phase === 'result') && runnerPlan(); if (!plan) return null;
  const t = plan.bt.t, list = [];
  for (const r of plan.R) {
    if (r.batter && t < r.start) continue; // still finishing the swing
    if (r.outAt && t > r.outAt + 1.3) continue; // out: he's gone back to the dugout
    if (r.to === 4 && t > r.arrive + 0.8) continue; // scored
    const p = runnerAt(r, t); list.push({ ...r, ...p });
  }
  for (const i of plan.stay) { const [x, z] = BASES[i], off = [[2, -2], [0, -2.5], [-2, -2]][i]; list.push({ key: 'run' + battingTeam() + '-' + i, build: LINEUP_BUILDS[(i * 4 + 1) % 9], num: [5, 10, 16][i], x: x + off[0], z: z + off[1], face: Math.atan2(-x, -z) + 1.2, run: 0, idle: true }); }
  return { plan, list, batterGone: t >= (plan.batter ? plan.batter.start : 0.35) && !!plan.batter };
}
/* the umpire's call over the bag, drawn on the overlay */
function drawCalls() {
  const plan = (S.phase === 'batted' || S.phase === 'result') && RUNPLAN && RUNPLAN.bt === S.batted ? RUNPLAN : null; if (!plan) return;
  const t = plan.bt.t;
  for (const c of plan.calls) {
    if (t < c.at || t > c.at + 1.5) continue;
    const [x, z] = c.pos || BASE_PATH[c.base], p = P([x, c.pos ? 15 : 9, z]); if (!p) continue;
    const k = clamp((t - c.at) / 0.12, 0, 1), sz = Math.max(16, Math.min(34, 5.5 * p[2])) * (0.6 + 0.4 * k);
    const col = c.txt === 'OUT' ? '#e2553f' : c.txt === 'SAFE' ? '#7fd36b' : '#ffcf6b';
    ctx.font = `900 ${sz}px ${FONT_D}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(c.txt).width + sz * 0.8;
    ctx.globalAlpha = Math.min(1, (c.at + 1.5 - t) / 0.3);
    ctx.fillStyle = 'rgba(13,20,32,.82)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p[0] - w / 2, p[1] - sz * 0.62, w, sz * 1.24, sz * 0.3) : ctx.rect(p[0] - w / 2, p[1] - sz * 0.62, w, sz * 1.24); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(c.txt, p[0], p[1] + 1);
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
}

/* ---------- 3D players: a small WebGL renderer for smooth-shaded, jointed figures (falls back to the flat ones if WebGL is missing) ---------- */
const GL3 = (() => {
  const cvs = document.createElement('canvas');
  let gl = null;
  try { gl = cvs.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }); } catch (_) { gl = null; }
  if (!gl) return null;
  const VS = `attribute vec3 aP; attribute vec3 aN; attribute vec2 aT;
uniform mat4 uM; uniform mat4 uVP; uniform mat3 uNM;
varying vec3 vN; varying vec2 vT; varying vec3 vW;
void main(){ vec4 w = uM * vec4(aP, 1.0); vW = w.xyz; vN = uNM * aN; vT = aT; gl_Position = uVP * w; }`;
  const DER = gl.getExtension('OES_standard_derivatives');
  const FS = (DER ? '#extension GL_OES_standard_derivatives : enable\n' : '') + `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uRim;
uniform float uFacet; uniform vec3 uC; uniform float uA; uniform vec3 uFogC; uniform sampler2D uTex; uniform float uTexOn; uniform vec3 uSun; uniform vec3 uEye; uniform float uSpec; uniform float uFlat;
varying vec3 vN; varying vec2 vT; varying vec3 vW;
void main(){
  vec4 t = vec4(1.0);
  if (uTexOn > 0.5) { t = texture2D(uTex, vT); if (uTexOn > 1.5 && t.a < 0.45) discard; }
  vec3 base = uC * t.rgb;
  float al = uA * (uTexOn > 0.5 ? t.a : 1.0);
  if (uFlat > 0.5) { gl_FragColor = vec4(base * al, al); return; }
  vec3 n = normalize(vN); vec3 v = normalize(uEye - vW);
  ${DER ? 'if (uFacet > 0.5) n = normalize(cross(dFdx(vW), dFdy(vW)));' : ''}
  if (dot(n, v) < 0.0) n = -n;
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(vec3(0.30, 0.36, 0.26), vec3(0.62, 0.70, 0.82), hemi);
  float d = max(dot(n, uSun), 0.0); d = mix(d, smoothstep(0.0, 0.5, d), 0.2); // a touch of painted, banded light
  vec3 col = base * (amb * 0.78 + vec3(1.0, 0.95, 0.84) * d * 0.82);
  vec3 h = normalize(v + uSun);
  col += uSpec * pow(max(dot(n, h), 0.0), 36.0) * vec3(1.0, 0.98, 0.92);
  col += uRim * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.14 * vec3(0.85, 0.92, 1.0);
  col = mix(col, uFogC, clamp((length(uEye - vW) - 260.0) / 1600.0, 0.0, 0.32));
  gl_FragColor = vec4(col * al, al);
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  try { gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); } catch (e) { return null; }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const A = { P: gl.getAttribLocation(prog, 'aP'), N: gl.getAttribLocation(prog, 'aN'), T: gl.getAttribLocation(prog, 'aT') };
  const UL = {}; ['uM', 'uVP', 'uNM', 'uC', 'uA', 'uFogC', 'uFacet', 'uRim', 'uTex', 'uTexOn', 'uSun', 'uEye', 'uSpec', 'uFlat'].forEach(k => UL[k] = gl.getUniformLocation(prog, k));
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const ANI = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

  /* ---- geometry ---- */
  function geo(pos, nrm, uv, idx) {
    const mk = (data, T = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(T, b); gl.bufferData(T, data, gl.STATIC_DRAW); return b; };
    return { p: mk(new Float32Array(pos)), n: mk(new Float32Array(nrm)), t: mk(new Float32Array(uv)), i: mk(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER), count: idx.length };
  }
  function grid(nu, nv, f) { // f(u, v) -> [pos, nrm]; a (nu+1) x (nv+1) sheet of quads
    const pos = [], nrm = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [p, n] = f(i / nu, j / nv); pos.push(...p); nrm.push(...n); uv.push(i / nu, j / nv); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
    return geo(pos, nrm, uv, idx);
  }
  const sphere = (t0 = 0, t1 = Math.PI, nu = 18, nv = 12) => grid(nu, nv, (u, v) => { // v=0 at the top
    const th = t0 + (t1 - t0) * v, ph = u * Math.PI * 2, p = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)]; return [p, p];
  });
  const lathe = (prof, nu = 18, ph0 = Math.PI / 2) => grid(nu, prof.length - 1, (u, v) => { // prof: [[y, r], ...] bottom to top
    const j = Math.round(v * (prof.length - 1)), [y, r] = prof[j], a = prof[Math.max(0, j - 1)], b = prof[Math.min(prof.length - 1, j + 1)];
    const dy = b[0] - a[0], dr = b[1] - a[1], L = Math.hypot(dy, dr) || 1, ph = ph0 + u * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
    return [[s * r, y, c * r], [s * dy / L, -dr / L, c * dy / L]];
  });
  const cylCache = {};
  const cyl = k => cylCache[k] || (cylCache[k] = lathe([[0, 1], [1, k]], 12));
  const cylLoCache = {}, cylLo = k => cylLoCache[k] || (cylLoCache[k] = lathe([[0, 1], [1, k]], 16));
  const G = { sph: sphere(), half: sphere(0, Math.PI / 2, 18, 6), helm: sphere(0, Math.PI * 0.6, 18, 8),
    lsph: sphere(0, Math.PI, 14, 10), lhalf: sphere(0, Math.PI / 2, 14, 5), lhelm: sphere(0, Math.PI * 0.6, 14, 6) }; // players: lighter meshes, there are a lot of them
  // a unit cube for blocky fists
  G.cube = (() => { const P = [], N = [], T = [], I = []; const f = (n, u, v) => { const k = P.length / 3; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b); N.push(...n); T.push(0, 0); } I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    f([1, 0, 0], [0, 1, 0], [0, 0, 1]); f([-1, 0, 0], [0, 1, 0], [0, 0, 1]); f([0, 1, 0], [1, 0, 0], [0, 0, 1]); f([0, -1, 0], [1, 0, 0], [0, 0, 1]); f([0, 0, 1], [1, 0, 0], [0, 1, 0]); f([0, 0, -1], [1, 0, 0], [0, 1, 0]); return geo(P, N, T, I); })();
  let low = false; // drawing a low-poly player right now
  G.bat = lathe([[0, 0], [0.005, 0.075], [0.06, 0.075], [0.08, 0.045], [0.95, 0.05], [1.45, 0.092], [2.6, 0.105], [2.9, 0.1], [2.93, 0.06], [2.95, 0]], 14);

  /* ---- textures ---- */
  function tex(canvas, old) {
    const t = old || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    const pot = (canvas.width & (canvas.width - 1)) === 0 && (canvas.height & (canvas.height - 1)) === 0;
    if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (ANI && pot) gl.texParameterf(gl.TEXTURE_2D, ANI.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ANI.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const jerseyTex = {};
  let mirror = false; const setMirror = v => { mirror = !!v; };
  function jersey(t, num) { // the jersey wraps around the torso: back number at u=.25, front at u=.75, drawn mirrored for the world's handedness
    const mir = mirror, k = t + '-' + num + (mir ? 'm' : ''); if (jerseyTex[k]) return jerseyTex[k];
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128);
    if (teamPin(t)) { g.fillStyle = 'rgba(31,58,107,.55)'; for (let x = 3; x < 256; x += 9) g.fillRect(x, 0, 1.6, 128); }
    else { g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 256, 1); } // road-gray flannel texture
    g.save(); g.translate(256, 0); g.scale(-1, 1);
    const ink = teamDark(t);
    g.fillStyle = ink; g.fillRect(64 + 9, 0, 1.5, 117); g.fillRect(64 + 13, 0, 1.5, 117); // piping (under the lettering) either side of the button placket
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 14; y < 112; y += 18) { g.beginPath(); g.arc(64 + 11.2, y, 1.4, 0, Math.PI * 2); g.fill(); } // buttons
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const NAMES = ['MORALES', 'KOWALSKI', 'BRENNAN', 'OKAFOR', 'DUBOIS', 'HARTLEY', 'NAKAMURA', 'REYES', 'LINDQVIST', 'CALLOWAY', 'PETRAKIS', 'WHITLOCK', 'SANTANA', 'MCBRIDE', 'FONTAINE', 'GALLAGHER'];
    const T = (fn, str, x, y) => { if (!mir) return g[fn](str, x, y); g.save(); g.translate(x, y); g.scale(-1, 1); g[fn](str, 0, 0); g.restore(); }; // a mirrored body needs its lettering flipped back
    g.font = `800 15px ${FONT_D}`; g.fillStyle = ink; T('fillText', NAMES[num % NAMES.length], 192, 30); // name across the shoulders
    g.font = `900 52px ${FONT_D}`; g.lineWidth = 7; g.strokeStyle = '#fff'; T('strokeText', String(num), 192, 70); g.fillStyle = ink; T('fillText', String(num), 192, 70);
    g.font = `900 22px ${FONT_D}`; g.fillStyle = ink; T('fillText', t ? 'DUEL' : 'ROAD', 64, 52);
    g.font = `900 20px ${FONT_D}`; T('fillText', String(num), 78, 80);
    g.restore();
    g.fillStyle = '#22252e'; g.fillRect(0, 117, 256, 11); g.fillStyle = '#9a9ea8'; for (const x of [64, 192]) g.fillRect(x - 5, 118, 10, 9); // belt and buckles
    return (jerseyTex[k] = tex(c));
  }
  const batTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#c9ced6'; g.fillRect(0, 0, 4, 64); g.fillStyle = '#1b1b1b'; g.fillRect(0, 40, 4, 24); g.fillStyle = '#d9463a'; g.fillRect(0, 10, 4, 5); g.fillStyle = '#e9edf2'; g.fillRect(0, 18, 4, 2); return tex(c); })();
  const ballTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
    g.fillStyle = '#eef24c'; g.fillRect(0, 0, 64, 32); g.strokeStyle = '#c43a2a'; g.lineWidth = 2;
    g.beginPath(); for (let x = 0; x <= 64; x++) { const y = 16 + Math.sin(x / 64 * Math.PI * 4) * 9; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); return tex(c); })();
  let faceTex = null, faceAspect = 1, faceSrc = null;
  function bobbleTex() {
    const src = FACE.img || 'cartoon';
    if (faceSrc === src) return faceTex;
    if (FACE.img) { faceTex = tex(FACE.img, faceTex); faceAspect = FACE.img.width / FACE.img.height; }
    else { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 140); drawCaricature(g, 90, 0); faceTex = tex(c, faceTex); faceAspect = 1; }
    faceSrc = src; return faceTex;
  }

  /* ---- drawing parts ---- */
  const hexCache = {};
  const rgb = h => hexCache[h] || (hexCache[h] = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
  const M = new Float32Array(16), NM = new Float32Array(9);
  let alpha = 1, bound = null;
  function part(g, col, o, X, Y, Z, sx, sy, sz, opt = {}) {
    M[0] = X[0] * sx; M[1] = X[1] * sx; M[2] = X[2] * sx; M[3] = 0;
    M[4] = Y[0] * sy; M[5] = Y[1] * sy; M[6] = Y[2] * sy; M[7] = 0;
    M[8] = Z[0] * sz; M[9] = Z[1] * sz; M[10] = Z[2] * sz; M[11] = 0;
    M[12] = o[0]; M[13] = o[1]; M[14] = o[2]; M[15] = 1;
    NM[0] = X[0] / sx; NM[1] = X[1] / sx; NM[2] = X[2] / sx; NM[3] = Y[0] / sy; NM[4] = Y[1] / sy; NM[5] = Y[2] / sy; NM[6] = Z[0] / sz; NM[7] = Z[1] / sz; NM[8] = Z[2] / sz;
    if (mirror) { M[0] = -M[0]; M[4] = -M[4]; M[8] = -M[8]; M[12] = -M[12]; NM[0] = -NM[0]; NM[3] = -NM[3]; NM[6] = -NM[6]; } // a lefty: the righty's body reflected across the middle
    gl.uniformMatrix4fv(UL.uM, false, M); gl.uniformMatrix3fv(UL.uNM, false, NM);
    gl.uniform3fv(UL.uC, col.length === 3 && typeof col[0] === 'number' ? col : rgb(col));
    gl.uniform1f(UL.uA, alpha); gl.uniform1f(UL.uSpec, opt.spec ?? 0.04); gl.uniform1f(UL.uFlat, opt.flat ? 1 : 0);
    if (opt.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.tex); gl.uniform1f(UL.uTexOn, opt.alphaTest ? 2 : 1); } else gl.uniform1f(UL.uTexOn, 0);
    if (bound !== g) {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.p); gl.vertexAttribPointer(A.P, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.vertexAttribPointer(A.N, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.t); gl.vertexAttribPointer(A.T, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i); bound = g;
    }
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
  }
  const UP = [0, 1, 0];
  function frameOf(Y) { // any two axes perpendicular to Y
    const ref = Math.abs(Y[1]) < 0.9 ? UP : [1, 0, 0], X = norm(cross(Y, ref)); return [X, cross(X, Y)];
  }
  function frameOfLimb(a, b) { const Y = norm(sub(b, a)), [X, Z] = frameOf(Y); return [X, Y, Z]; }
  function seg(a, b, r, k, col, opt) { // tapered limb from a (radius r) to b (radius r*k)
    const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-4) return;
    const Y = mul(d, 1 / L), [X, Z] = frameOf(Y);
    part(low ? cylLo(k) : cyl(k), col, a, X, Y, Z, r, L, r, opt);
  }
  const ball = (c, r, col, opt) => part(low ? G.lsph : G.sph, col, c, [1, 0, 0], UP, [0, 0, 1], r, r, r, opt);
  // an oriented ellipsoid: o + local offset, axes X/Y/Z
  const at3 = (o, X, Y, Z, x, y, z) => [o[0] + X[0] * x + Y[0] * y + Z[0] * z, o[1] + X[1] * x + Y[1] * y + Z[1] * z, o[2] + X[2] * x + Y[2] * y + Z[2] * z];
  const ell = (g, col, o, X, Y, Z, x, y, z, sx, sy, sz, opt) => part(g, col, at3(o, X, Y, Z, x, y, z), X, Y, Z, sx, sy, sz, opt);
  function ik(a, c, L1, L2, pole) {
    const d = sub(c, a), D = Math.hypot(d[0], d[1], d[2]) || 1e-3, dn = mul(d, 1 / D), Dc = Math.min(D, (L1 + L2) * 0.999);
    const x = (L1 * L1 - L2 * L2 + Dc * Dc) / (2 * Dc), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    let p = sub(pole, mul(dn, dotv(pole, dn))); const pl = Math.hypot(p[0], p[1], p[2]); p = pl > 1e-4 ? mul(p, 1 / pl) : frameOf(dn)[0];
    return addv(addv(a, mul(dn, x)), mul(p, h));
  }

  /* ---- a whole player from a pose ---- */
  const torsoGeo = new Map();
  function torsoFor(B) {
    if (torsoGeo.has(B)) return torsoGeo.get(B);
    const w = B.w, sh = B.sh * w, wa = B.wa * w, be = B.belly;
    const key = [[0, 0.43 * wa + be * 0.2], [0.14, 0.42 * wa + be * 0.45], [0.38, Math.max(0.44 * wa, 0.43 * sh) + be * 0.55], [0.62, 0.53 * sh + be * 0.3], [0.78, 0.6 * sh + be * 0.1], [0.88, 0.56 * sh], [0.95, 0.42 * sh], [1, 0.22]]; // shoulders slope into the neck
    const prof = [], N = 18, at = i => key[clamp(i, 0, key.length - 1)];
    for (let k = 0; k <= N; k++) { // Catmull-Rom through the key radii
      const y = k / N; let i = 0; while (i < key.length - 2 && key[i + 1][0] < y) i++;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), u = (y - p1[0]) / Math.max(1e-6, p2[0] - p1[0]);
      const r = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u * u + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u * u * u);
      prof.push([y, Math.max(0.15, r)]);
    }
    const g = lathe(prof, 28);
    torsoGeo.set(B, g); return g;
  }
  function player(...args) { low = true; gl.uniform1f(UL.uRim, 1); try { playerBody(...args); } finally { low = false; gl.uniform1f(UL.uRim, 0); } }
  function playerBody(p, B, t, num, kind) {
    const col = teamCol(t), dk = teamDark(t), pants = B.pants || teamPants(t), skin = B.skin;
    const px = focal / Math.max(1, toCam(p.hip)[2]), fine = px > 9, far = px < 4; // level of detail: skip what's too small to see
    if (!p.armsOnly) {
    // legs
    for (let s = 0; s < 2; s++) {
      const hp = p.hp[s], kn = p.kn[s], ft = p.ft[s], k = B.thick, ank = addv(ft, [0, 0.22, 0]), mid = lerp3(kn, ank, 0.38);
      seg(hp, kn, 0.32 * k, 0.74, pants, { spec: 0.05 }); if (!far) ball(kn, 0.22 * k, pants);
      seg(kn, mid, 0.23 * k, 0.88, pants, { spec: 0.05 }); // pants cut just below the knee, a little baggy
      if (kind === 'catcher') { seg(sub(kn, [0, 0.1, 0]), ank, 0.24, 0.85, '#2b2f45', { spec: 0.3 }); }
      else { seg(lerp3(kn, mid, 0.85), ank, 0.165 * Math.sqrt(k), 0.66, dk); } // high socks in the team color
      const Z = norm([p.toe[s][0], 0, p.toe[s][2]]), X = norm(cross(UP, Z));
      ell(G.lsph, CLEAT, ft, X, UP, Z, 0, 0.08, 0.26, 0.25, 0.19, 0.6, { spec: 0.25 });
      if (fine) { ell(G.lsph, '#e8e4da', ft, X, UP, Z, 0, -0.02, 0.28, 0.255, 0.05, 0.61); ell(G.lsph, dk, ft, X, UP, Z, 0, 0.12, 0.22, 0.255, 0.035, 0.3); } // sole, and a team-color stripe
    }
    // torso: lathe from hips to neck, oriented so +z is the chest
    const Y = norm(sub(p.neck, p.hip)), Lt = Math.hypot(...sub(p.neck, p.hip));
    let X = norm(sub(p.side, mul(Y, dotv(p.side, Y)))), Z = cross(X, Y);
    if (dotv(Z, p.fwd) < 0) { X = mul(X, -1); Z = cross(X, Y); }
    { let hX = X, hZ = Z; // hips can turn ahead of the shoulders (the batter's swing)
      if (p.hipSide) { hX = norm(sub(p.hipSide, mul(Y, dotv(p.hipSide, Y)))); hZ = cross(hX, Y); if (dotv(hZ, Z) < 0) { hX = mul(hX, -1); hZ = cross(hX, Y); } }
      ell(G.lsph, pants, p.hip, hX, Y, hZ, 0, -0.12, 0, 0.41 * B.wa * B.w + B.belly * 0.2, 0.34, 0.27 + B.belly * 0.28); } // seat of the pants, tucked inside the jersey line
    part(torsoFor(B), col, p.hip, X, Y, Z, 1, Lt, 0.7 + B.belly * 0.28, { tex: jersey(t, num) }); // a deeper barrel for a big belly
    if (B.pec) ell(G.lsph, col, p.hip, X, Y, Z, 0, 0.7 * Lt, 0.1 + B.belly * 0.15, 0.5 * B.sh * B.w, 0.24 * Lt + 0.05, 0.3 + B.pec * 0.12 * B.w); // chest
    if (B.trap) ell(G.lsph, col, p.hip, X, Y, Z, 0, 0.96 * Lt, -0.05, 0.32 * B.sh * B.w, 0.1 + B.trap * 0.18, 0.24 + B.trap * 0.1); // traps rising to the neck
    if (kind === 'catcher') ell(G.lsph, '#2b2f45', p.hip, X, Y, Z, 0, 0.6 * Lt, 0.28, 0.5, 0.62 * Lt, 0.18, { spec: 0.3 });
    }
    // arms
    const L1 = 1.08 * B.h, L2 = 1.0 * B.h;
    for (let s = 0; s < 2; s++) {
      let S0 = p.sh[s], H0 = p.ha[s];
      if (p.armsOnly) { const gz = norm(sub(H0, S0)), [gx, gy] = frameOf(gz); ell(G.lsph, '#1b1d2b', H0, gx, gy, gz, 0, 0, 0.03, 0.12, 0.13, 0.16); continue; } // through your own eyes: just your gloved hands on the bat
      if (p.id && !p.fixedHands) H0 = ease(p.id + 'h' + s, H0, p.noEase ? Infinity : 14); // hands glide between poses instead of snapping
      const dd = Math.hypot(...sub(H0, S0)), reach = (L1 + L2) * 0.97;
      if (dd > reach && !p.el) S0 = addv(S0, mul(sub(H0, S0), Math.min(0.4, dd - reach) / dd)); // the shoulder reaches out rather than the arm stretching
      let el = p.el ? p.el[s] : ik(S0, H0, L1, L2, p.pole[s]);
      if (p.id) el = ease(p.id + 'e' + s, el, p.noEase ? Infinity : 20); // elbows settle instead of flipping
      const a = B.arm;
      ball(addv(S0, [0, -0.08, 0]), (0.13 + 0.025 * (B.sh - 1)) * a, col); // shoulder cap
      const arm = B.long ? '#1b1d2b' : skin;
      seg(S0, el, 0.15 * a, 0.78, arm); if (!far) ell(G.lsph, arm, lerp3(S0, el, 0.55), ...frameOfLimb(S0, el), 0, 0, 0, 0.165 * a, 0.3 * B.h, 0.165 * a); // upper arm with a bicep
      seg(S0, lerp3(S0, el, 0.5), 0.19 * a, 0.92, col, { spec: 0.05 }); // sleeve to mid-bicep
      if (fine) seg(lerp3(S0, el, 0.44), lerp3(S0, el, 0.52), 0.195 * a, 1, dk); // sleeve piping
      ball(el, 0.12 * a, arm);
      const wr = lerp3(el, H0, 0.88);
      seg(el, wr, 0.14 * a, 0.68, arm); // forearm: thick by the elbow, tapering to the wrist
      if (fine && !p.batGloves) seg(lerp3(el, H0, 0.74), lerp3(el, H0, 0.88), 0.11 * a, 1, dk); // wristband
      if (p.glove !== s) { const hz2 = norm(sub(H0, el)), [hx2, hy2] = frameOf(hz2), k2 = Math.min(1.3, a) * (p.batGloves ? 0.85 : 1); const hc = p.batGloves ? '#1b1d2b' : skin; ell(G.lsph, hc, H0, hx2, hy2, hz2, 0, 0, 0.05, 0.1 * k2, 0.12 * k2, 0.14 * k2); ell(G.lsph, hc, H0, hx2, hy2, hz2, 0.08 * k2, 0.02, 0.02, 0.05 * k2, 0.05 * k2, 0.09 * k2); } // closed hand with a thumb
      if (p.glove === s) {
        const gz = norm(sub(H0, el)), [gx, gy] = frameOf(gz), big = kind === 'catcher';
        const s2 = big ? 1.25 : 1; // a leather mitt: wide palm, fingers fanned past the hand, a darker pocket and web
        ell(G.lsph, GLOVE, H0, gx, gy, gz, 0, 0, 0.12, 0.3 * s2, 0.36 * s2, 0.13 * s2, { spec: 0.18 });
        ell(G.lsph, GLOVE, H0, gx, gy, gz, 0, 0.2 * s2, 0.2, 0.24 * s2, 0.2 * s2, 0.1 * s2, { spec: 0.18 });
        if (fine) { ell(G.lsph, '#4a2a12', H0, gx, gy, gz, 0, 0.04, 0.22, 0.19 * s2, 0.22 * s2, 0.05); ell(G.lsph, '#3a2010', H0, gx, gy, gz, 0.2 * s2, 0.18 * s2, 0.18, 0.06, 0.12 * s2, 0.04); }
      }
    }
    // neck and head
    const hz = (B.hd || 1) * 1.08, c = p.head, U2 = UP;
    const fz = norm([p.face[0], 0, p.face[2]]), fx = cross(U2, fz);
    if (p.armsOnly) return;
    seg(addv(p.neck, mul(sub(c, p.neck), -0.15)), addv(c, [0, -0.22 * hz, 0]), 0.24 * Math.max(1, B.w * 0.9), 0.82, skin);
    if (p.bobble) { bobble(c); return; }
    const e = (g, cl, x, y, z, sx, sy, sz, o) => ell(g, cl, c, fx, U2, fz, x * hz, y * hz, z * hz, sx * hz, sy * hz, sz * hz, o);
    e(G.lsph, skin, 0, 0.03, -0.02, 0.31, 0.38, 0.35); // skull
    e(G.lsph, skin, 0, -0.16, 0.06, 0.25 + B.belly * 0.12, 0.2, 0.27); // jaw
    e(G.lsph, skin, 0, -0.27, 0.13, 0.12, 0.08, 0.12); // chin
    e(G.lsph, B.hair, 0, 0.01, -0.07, 0.32, 0.36, 0.33);
    if (B.beard) e(G.lsph, B.hair, 0, -0.2, 0.08, 0.26 + B.belly * 0.12, 0.17, 0.25);
    if (fine) {
      e(G.lsph, skin, 0, -0.04, 0.34, 0.055, 0.1, 0.07); // nose
      e(G.lsph, skin, 0, 0.1, 0.27, 0.24, 0.05, 0.08); // brow ridge
      for (const sd of [-1, 1]) {
        e(G.lsph, skin, sd * 0.32, -0.01, -0.02, 0.06, 0.1, 0.06); // ears
        e(G.lsph, '#f2efe6', sd * 0.115, 0.04, 0.3, 0.05, 0.03, 0.025); e(G.lsph, '#2a1d14', sd * 0.11, 0.04, 0.315, 0.027, 0.028, 0.015);
        e(G.lsph, B.hair, sd * 0.115, 0.1, 0.31, 0.075, 0.016, 0.03); // brows
      }
      if (!B.beard) e(G.lsph, '#8a4a40', 0, -0.17, 0.31, 0.075, 0.014, 0.025); // mouth
    }
    if (B.glasses && fine) for (const sd of [-1, 1]) e(G.lsph, '#20222c', sd * 0.115, 0.04, 0.34, 0.085, 0.06, 0.01);
    const hk = p.headKind;
    if (hk === 'helmet' || hk === 'mask') {
      e(G.lhelm, dk, 0, 0.06, -0.03, 0.4, 0.41, 0.43, { spec: 0.75 });
      for (const sd of [-1, 1]) e(G.lsph, dk, sd * 0.33, -0.1, 0.02, 0.11, 0.16, 0.15, { spec: 0.75 });
      e(G.lsph, dk, 0, 0.12, 0.37, 0.26, 0.02, 0.12, { spec: 0.75 });
      if (hk === 'mask') { for (const y of [0.1, -0.05, -0.2]) e(G.lsph, '#2b2f36', 0, y, 0.37, 0.29, 0.022, 0.035); e(G.lsph, '#2b2f36', 0, -0.05, 0.39, 0.025, 0.2, 0.03); }
    } else {
      e(G.lhalf, dk, 0, 0.08, -0.03, 0.35, 0.33, 0.39, { spec: 0.06 });
      e(G.lsph, dk, 0, 0.09, 0.36, 0.27, 0.022, 0.2, { spec: 0.06 }); // brim
      e(G.lsph, dk, 0, 0.41, -0.03, 0.035, 0.025, 0.035);
      if (fine) e(G.lsph, '#ffffff', 0, 0.26, 0.3, 0.07, 0.07, 0.02, { spec: 0 }); // cap logo
    }
  }
  // a damped spring per player: the head lags behind the body's motion, overshoots, and settles
  const WOB = new Map();
  function wobble(key, at) {
    let s = WOB.get(key); const dt = easeDt;
    if (!s || Math.hypot(at[0] - s.p[0], at[2] - s.p[2]) > 6) { s = { p: [...at], v: [0, 0], o: [0, 0], ov: [0, 0], ph: Math.random() * 6 }; WOB.set(key, s); return [0, 0]; }
    const v = [(at[0] - s.p[0]) / dt, (at[2] - s.p[2]) / dt], acc = [(v[0] - s.v[0]) / dt, (v[1] - s.v[1]) / dt];
    s.p = [...at]; s.v = v; s.ph += dt;
    for (let k = 0; k < 2; k++) {
      const a = -140 * s.o[k] - 7 * s.ov[k] - clamp(acc[k], -400, 400) * 0.0035 + Math.sin(s.ph * 1.7 + k) * 0.25; // lags, overshoots, plus a gentle idle bob
      s.ov[k] += a * dt; s.o[k] = clamp(s.o[k] + s.ov[k] * dt, -0.32, 0.32);
    }
    return s.o;
  }
  function bobble(c) { // your photo on a billboard, wobbling on a spring neck
    const t = bobbleTex(); if (!t) return;
    const up = 0.75 + FACE.jig * 0.1, hh = 2.5, ww = hh * faceAspect, rot = FACE.jig * 0.22;
    const ctr = addv(c, [0, up, 0]);
    seg(addv(c, [0, -0.2, 0]), addv(ctr, mul(R, FACE.jig * 0.12)), 0.12, 0.9, '#d9a07c');
    const cr = Math.cos(rot), sr = Math.sin(rot), X = addv(mul(R, cr), mul(U, -sr)), Y = addv(mul(R, sr), mul(U, cr)), Z = cross(X, Y);
    const o = addv(ctr, addv(mul(X, ww * 0.03 + FACE.jig * 0.12), mul(Y, hh * 0.05)));
    const was = mirror, at = addv(o, mul(F, -0.6)); // a billboard faces the camera: place it where the (mirrored) neck is, but never flip the picture
    if (was) mirror = false;
    part(G.quad || (G.quad = grid(1, 1, (u, v) => [[u - 0.5, v - 0.5, 0], [0, 0, 1]])), [1, 1, 1], was ? [-o[0] - F[0] * 0.6, o[1] - F[1] * 0.6, o[2] - F[2] * 0.6] : at, X, Y, Z, ww, hh, 1, { tex: t, alphaTest: true, flat: true });
    mirror = was;
  }

  const shoulderOut = B => 0.53 * B.sh * B.w + 0.07 * B.arm; // the edge of the torso at the shoulder, plus half an upper arm
  /* ---- poses (world joints) ---- */
  function standingPose(base, face, o, B) {
    const hs = B.h, ws = B.w, f = [Math.sin(face), 0, Math.cos(face)], r = [f[2], 0, -f[0]], jy = o.jump || 0;
    const at = (rx, y, fz) => [base[0] + r[0] * rx * ws + f[0] * fz, y + jy, base[2] + r[2] * rx * ws + f[2] * fz];
    const run = o.run > 0, ready = !run && !o.helmet && !o.hold && !(o.throwK >= 0) && !(o.jump > 0);
    const LL = 1.36 * B.lg * hs; // thigh and shin length
    const sx = shoulderOut(B) / ws, lx = 0.27 * Math.max(1, B.wa + B.belly * 0.5);
    const p = { side: r, fwd: f, face: f, headKind: o.helmet ? 'helmet' : 'cap', glove: o.helmet ? -1 : 1, toe: [f, f] };
    if (run) {
      // A run cycle built from real mechanics. Legs: each foot traces a loop under the hip, planted and pushing back
      // half the time, swinging through low the other half. Arms: each upper arm swings about 38 degrees forward and
      // back from the shoulder with the elbow held near 90 degrees, in time with the opposite leg.
      const cyc = 7.5 * LL, ph = o.run / cyc * Math.PI * 2;
      const hipY = 2 * LL * 0.94 + 0.08 * Math.abs(Math.cos(ph)), lean = 0.35;
      p.hip = at(0, hipY, 0.05); p.neck = at(0, hipY + 1.85 * B.tr * hs, lean);
      const shY = p.neck[1] - 0.17 * hs, L1 = 1.08 * B.h, L2 = 1.0 * B.h, UPV = [0, 1, 0], DN = [0, -1, 0];
      p.hp = []; p.ft = []; p.kn = []; p.ha = []; p.el = []; p.sh = [];
      for (let s = 0; s < 2; s++) {
        const a = ph + s * Math.PI, sgn = s ? -1 : 1, swing = Math.cos(a) > 0;
        const fz = Math.sin(a) * 1.0 * LL, lift = swing ? Math.cos(a) * 0.5 * LL : 0;
        const hp = at(sgn * lx * 0.75, hipY, 0.05), ft = at(sgn * (lx + 0.02), 0.1 + lift, fz);
        p.hp.push(hp); p.ft.push(ft); p.kn.push(ik(hp, ft, LL, LL, addv(f, [0, 0.15, 0])));
      }
      for (let j = 0; j < 2; j++) { // arm j (0 = the +side) moves with the opposite leg
        const aOpp = ph + (j === 0 ? 1 : 0) * Math.PI, th = 38 * D2R * Math.sin(aOpp), sgn = j ? -1 : 1;
        const sh = at(sgn * sx, shY, lean + 0.1 * Math.sin(aOpp)); // the shoulder rocks forward with its arm
        const u = addv(mul(DN, Math.cos(th)), mul(f, Math.sin(th)));
        const el = addv(addv(sh, mul(u, L1)), mul(r, sgn * 0.06)); // elbows just off the body
        const v = norm(addv(addv(mul(f, Math.cos(th)), mul(UPV, Math.sin(th) + 0.15)), mul(r, -sgn * 0.3))); // forearm forward, a little across
        p.sh.push(sh); p.el.push(el); p.ha.push(addv(el, mul(v, L2 * 0.92)));
      }
      p.pole = [DN, DN]; p.noEase = true;
      p.head = at(0, p.neck[1] + (0.44 * B.hd + 0.02) * hs, lean + 0.12);
      return p;
    }
    const crouch = ready ? 0.35 * hs : 0;
    const hipY = 2.7 * B.lg * hs - crouch, neckY = hipY + 1.85 * B.tr * hs * (ready ? 0.97 : 1), shY = neckY - 0.17 * hs;
    const wide = lx * (ready ? 1.45 : 1), lean = ready ? 0.35 : o.throwK >= 0 ? 0.25 : 0;
    p.hip = at(0, hipY, 0); p.neck = at(0, neckY, lean);
    p.hp = [at(wide * 0.75, hipY, 0), at(-wide * 0.75, hipY, 0)];
    p.ft = jy > 0 ? [at(wide * 0.7, 0.55, -0.35), at(-wide * 0.7, 0.4, 0.2)] : [at(wide + 0.05, 0.1, 0), at(-wide - 0.05, 0.1, o.throwK >= 0 ? 0.9 : 0)];
    p.kn = p.hp.map((hp, s) => ik(hp, p.ft[s], LL, LL, f));
    p.sh = [at(sx, shY, lean), at(-sx, shY, lean)];
    if (o.throwK >= 0) { // throwing: ball hand from back behind the head, over the top, through and down across the body
      const k = o.throwK, P0 = at(sx + 0.3, shY + 0.7, -1.0), P1 = at(sx * 0.6, shY + 0.75, 0.6), P2 = at(-0.4, hipY + 0.3, 1.1);
      p.ha = [k < 0.45 ? lerp3(P0, P1, k / 0.45) : lerp3(P1, P2, (k - 0.45) / 0.55), at(-sx - 0.1, shY - 0.4, 0.5)];
    } else if (o.hold) p.ha = [at(0.12, shY - 0.75, 0.7), at(-0.08, shY - 0.7, 0.78)];
    else if (o.helmet) p.ha = [at(sx + 0.2, hipY + 0.05, 0.3), at(-sx - 0.2, hipY + 0.05, 0.3)];
    else p.ha = [at(sx - 0.1, hipY + 0.15, 0.85), at(-sx + 0.05, hipY + 0.25, 0.9)];
    if (jy > 0) p.ha[0] = at(sx + 0.3, shY + 1.2 * hs, 0.3);
    if (o.reach) { // glove out toward an incoming ball
      const S1 = p.sh[1], d = sub(o.reach, S1), L = Math.hypot(...d);
      p.ha[1] = addv(S1, mul(d, Math.min(1, 2.1 * hs / Math.max(L, 0.01))));
    }
    p.pole = [addv(addv(mul(f, -0.8), mul(r, 0.7)), [0, -0.6, 0]), addv(addv(mul(f, -0.8), mul(r, -0.7)), [0, -0.6, 0])];
    if (o.throwK >= 0) p.pole[0] = addv(mul(r, 1), [0, -0.25, 0]); // throwing elbow up and out, level with the shoulder
    p.head = at(0, neckY + (0.44 * B.hd + 0.02) * hs, lean + 0.05);
    return p;
  }
  function batterPose(B) {
    const bt = S.bat, hs = B.h, bx = bt.bx, bz = bt.bz, handsPhys = [bt.hx, bt.hy, bt.hz];
    const SB = swingBody(bt), yaw = SB.yaw;
    const chest = [Math.cos(yaw), 0, Math.sin(yaw)], side = [-Math.sin(yaw), 0, Math.cos(yaw)];
    const hy = SB.hipYaw, hipSide = [-Math.sin(hy), 0, Math.cos(hy)];
    const hipY = 2.65 * hs * B.lg - 0.07 * SB.pivot, hip = [bx - 0.05, hipY, bz + SB.shift], sc = [bx + 0.15, hipY + 1.7 * hs * B.tr, bz + SB.shift * 0.55];
    const footF = [bx + 0.15, 0.1, bz + 1.3], footB = [bx - 0.1, 0.1 + 0.18 * SB.pivot, bz - 1.1 + 0.14 * SB.pivot];
    const hipF = addv(hip, mul(hipSide, 0.32)), hipB = addv(hip, mul(hipSide, -0.32));
    const kneeF = lerp3(hipF, footF, 0.5), kneeB = lerp3(hipB, footB, 0.5);
    kneeF[0] += 0.3 * (1 - 0.6 * SB.pivot); kneeB[0] += 0.35 + 0.25 * SB.pivot; kneeB[2] += 0.6 * SB.pivot;
    kneeF[1] = 1.35 * hs * B.lg + 0.12 * SB.pivot; kneeB[1] = 1.35 * hs * B.lg - 0.14 * SB.pivot;
    const toeB = [Math.cos(70 * D2R * SB.pivot), 0, Math.sin(70 * D2R * SB.pivot)]; // the back foot turns over toward the pitcher
    const sF = addv(sc, mul(side, shoulderOut(B))), sB = addv(sc, mul(side, -shoulderOut(B)));
    // What you see vs. the physics: the bat's real path (used for contact) loads far back behind the hitter. On screen,
    // while it's loaded, he holds it the way a hitter does: hands up by the back shoulder, just off the chest, bat
    // standing nearly straight up. As the swing starts the hands drive forward and the bat drops into its real path,
    // which it fully matches well before it can reach the ball.
    const dPhys = batDir(bt.phi, bt.e), load = 0;
    const stanceHands = addv(addv(sB, mul(chest, 0.3 + (0.53 * B.sh * B.w + 0.3 * B.belly) * (0.7 + B.belly * 0.28))), [0, -0.12, 0]); // just off the front of the chest, however big it is
    const stanceDir = norm(addv(addv([0, 1, 0], [0, 0, -0.38]), mul(chest, -0.12)));
    const hands = lerp3(handsPhys, stanceHands, load), d = norm(lerp3(dPhys, stanceDir, load));
    return {
      hip, neck: sc, side, fwd: chest, hipSide, hp: [hipF, hipB], kn: [kneeF, kneeB], ft: [footF, footB], toe: [[0.6, 0, 0.5], toeB],
      // right-handed: the front (left) arm holds the bat at the knob, the back (right) arm holds it just above;
      // the front elbow hangs down toward the plate, the back elbow down and back behind the hands
      sh: [sF, sB], ha: [hands, addv(hands, mul(d, 0.17))], pole: [addv(addv([0, -1, 0], mul(chest, 0.35)), mul(side, 0.2)), addv(addv([0, -1, 0], mul(side, -0.55)), mul(chest, -0.25))], glove: -1, batGloves: true, fixedHands: true, id: 'bat',
      head: addv([bx + 0.1, sc[1] + (0.48 * B.hd + 0.02) * hs, bz], mul(chest, 0.1)), face: norm([0.35 * chest[0] + 0.1, 0, 1]), headKind: 'helmet',
      bat: { a: addv(hands, mul(d, -0.2)), d },
    };
  }
  function pitcherPose(B) {
    const ln = S.lean || 0, la = Math.abs(ln), hx = 0.25 * ln; // A/D lean tilts the upper body over the rubber
    const st = S.oppStride || 0, dz = -FLICK.stride * st, S0 = [ARM.S[0] + 0.85 * ln, ARM.S[1] - 0.25 * st - 0.2 * la, ARM.S[2] + dz];
    const hip = [-0.1, 2.75 - 0.2 * st, 50.55 + dz * 0.7], neck = [0.75 * ln, 4.55 - 0.25 * st - 0.18 * la, 50.35 + dz], h = handPos();
    const mid = lerp3(S0, h, 0.5); mid[2] += 0.25; mid[1] -= 0.05;
    const g0 = [0.8 + neck[0], neck[1] - 0.05, neck[2]], gh = [0.75 + neck[0], 3.8, neck[2] - 0.75];
    return {
      hip: [hx, hip[1], hip[2]], neck, side: [-1, 0, 0], fwd: [0, 0, -1],
      hp: [[-0.28 + hx, hip[1], hip[2]], [0.28 + hx, hip[1], hip[2]]], kn: [[-0.4, 1.4, 50.45 + dz * 0.3], [0.55, 1.3 - 0.3 * st, 49.9 + dz * 1.1]], ft: [[-0.45, 0.1, 50.35], [0.6, 0.1, 49.6 + dz * 1.6]], toe: [[0, 0, -1], [0, 0, -1]],
      sh: [S0, g0], ha: [h, gh], el: [mid, ik(g0, gh, 1.08, 1, [1, -0.6, 0.4])], glove: 1, fixedHands: true, id: 'pit',
      head: [neck[0] * 1.1, neck[1] + 0.62, neck[2] - 0.05], face: [0, 0, -1], headKind: 'cap',
    };
  }
  function catcherPose() {
    const mitt = S.caughtByCatcher ? [S.ball.x, S.ball.y, -3.4] : [0.1, 2.5, -3.6];
    return {
      hip: [0, 1.5, -4.6], neck: [0, 3.05, -4.3], side: [1, 0, 0], fwd: [0, 0, 1],
      hp: [[0.32, 1.5, -4.55], [-0.32, 1.5, -4.55]], kn: [[0.7, 1.05, -3.75], [-0.7, 1.05, -3.75]], ft: [[0.65, 0.1, -4.25], [-0.65, 0.1, -4.25]], toe: [[0.3, 0, 1], [-0.3, 0, 1]],
      sh: [[0.55, 2.85, -4.25], [-0.55, 2.85, -4.25]], ha: [mitt, [-0.75, 1.4, -3.75]], pole: [[0.6, -1, 0], [-0.6, -1, 0]], glove: 0, id: 'cat',
      head: [0, 3.65, -4.2], face: [0, 0, 1], headKind: 'mask',
    };
  }

  /* ---- frame ---- */
  const VP = new Float32Array(16);
  // per-player easing of hands and elbows, frame-rate independent
  const EASE = new Map(); let easeDt = 1 / 60, lastNow = 0;
  function ease(key, target, rate) {
    const prev = EASE.get(key);
    if (!prev || Math.hypot(prev[0] - target[0], prev[1] - target[1], prev[2] - target[2]) > 6) { EASE.set(key, [...target]); return target; }
    if (rate === Infinity) { EASE.set(key, [...target]); return target; }
    const k = 1 - Math.exp(-rate * easeDt), v = lerp3(prev, target, k); EASE.set(key, v); return v;
  }
  function begin() {
    const now = performance.now(); easeDt = clamp((now - lastNow) / 1000, 1 / 240, 1 / 15); lastNow = now;
    const w = Math.round(W * DPR), h = Math.round(H * DPR);
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const n = 0.4, fr = 2500, f = 1 / Math.tan(cam.fov * D2R / 2), asp = W / H, dx = 2 * cam.sx / W, dy = -2 * cam.sy / H;
    // view rows R, U, -F; projection with the shake offset folded in
    const Pm = [f / asp, 0, 0, 0, 0, f, 0, 0, -dx, -dy, (fr + n) / (n - fr), -1, 0, 0, 2 * fr * n / (n - fr), 0];
    const V = [R[0], U[0], -F[0], 0, R[1], U[1], -F[1], 0, R[2], U[2], -F[2], 0, -dotv(R, cam.pos), -dotv(U, cam.pos), dotv(F, cam.pos), 1];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += Pm[k * 4 + r] * V[c * 4 + k]; VP[c * 4 + r] = s; }
    gl.useProgram(prog); gl.uniformMatrix4fv(UL.uVP, false, VP);
    gl.uniform1f(UL.uFacet, 0); gl.uniform1f(UL.uRim, 0); gl.uniform3fv(UL.uSun, SUN); gl.uniform3fv(UL.uFogC, [0.78, 0.88, 0.95]); gl.uniform3fv(UL.uEye, cam.pos); gl.uniform1i(UL.uTex, 0);
    [A.P, A.N, A.T].forEach(a => gl.enableVertexAttribArray(a));
    gl.disable(gl.BLEND); gl.depthMask(true); alpha = 1; bound = null;
  }
  function setAlpha(a) {
    alpha = a;
    if (a < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
  }
  function drawBat(b) {
    const [X, Z] = frameOf(b.d);
    part(G.bat, [1, 1, 1], b.a, X, b.d, Z, 1.2, 1, 1.2, { tex: batTex, spec: 0.7 }); // a 20% fatter barrel to match the bigger sweet spot
  }
  function drawBallGL() {
    const b = S.ball, p = [b.x, b.y, b.z], dist = Math.max(1, toCam(p)[2]), r = Math.max(BALL_R * 1.15, 2.6 * dist / focal);
    const a = S.t * 30, X = [Math.cos(a), Math.sin(a), 0], Y = [-Math.sin(a), Math.cos(a), 0];
    part(G.sph, [1, 1, 1], p, X, Y, [0, 0, 1], r, r, r, { tex: ballTex, spec: 0.35 });
  }
  /* ---- the ballpark in 3D: textured turf and clay, a two-deck bowl full of fans, padded wall, dugouts, backstop, scoreboard ---- */
  const canvasTex = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return tex(c); };
  let sd = 4242; const rr = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const pick = a => a[(rr() * a.length) | 0];
  const T = {};
  // turf: one dark and one light mowing band per 26 ft tile, speckled with blades and soft mottling
  // soft, seamless ground textures: blotches wrap around the tile edges and the fine grain is blurred,
  // so nothing turns into streaks when the ground is seen at a low angle
  const blotches = (g, w, h, n, rMin, rMax, cols, al) => {
    for (let i = 0; i < n; i++) { const x = rr() * w, y = rr() * h, r = rMin + rr() * (rMax - rMin), c = pick(cols);
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, `rgba(${c},${al})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
  };
  const grain = (g, w, h, n, cols) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d');
    for (let i = 0; i < n; i++) { q.fillStyle = pick(cols); q.fillRect(rr() * w, rr() * h, 2, 2); }
    g.filter = 'blur(1.2px)'; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.drawImage(c, ox, oy); g.filter = 'none';
  };
  T.grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#459339'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#62b34f'; g.fillRect(w / 2, 0, w / 2, h);
    blotches(g, w, h, 60, 40, 110, ['40,90,30', '150,200,100'], 0.06);
  });
  // clay: warm base, soft blotches, fine blurred grain
  T.dirt = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#c98a58'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, 50, 40, 110, ['160,96,56', '226,170,124'], 0.12);
  });
  // a section of seats with fans in it; rows run across, the front row at the bottom
  const MUTED = ['#d8d4cc', '#b85a50', '#4f74a8', '#c9a54a', '#3d4f6e', '#e9e6df', '#7d9a62', '#c27a4a', '#6c6f78', '#a3b6c9'];
  const crowd = (dark) => canvasTex(1024, 256, (g, w, h) => {
    const rows = 14, rh = h / rows;
    g.fillStyle = '#2d5a92'; g.fillRect(0, 0, w, h);
    g.filter = 'blur(0.7px)';
    for (let r = 0; r < rows; r++) {
      const y0 = h - (r + 1) * rh;
      g.fillStyle = 'rgba(10,22,44,.35)'; g.fillRect(0, y0 + rh - 2, w, 2);
      for (let x = 2 + rr() * 6; x < w - 10; x += 14 + rr() * 6) {
        if (rr() < 0.22) continue;
        const sw = 9 + rr() * 2;
        g.globalAlpha = 0.8; g.fillStyle = pick(MUTED); g.fillRect(x, y0 + rh * 0.45, sw, rh * 0.55);
        g.fillStyle = pick(['#e2b48f', '#c48a5c', '#9a6a44', '#6f4a30']); g.beginPath(); g.arc(x + sw / 2, y0 + rh * 0.32, rh * 0.2, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      }
    }
    g.filter = 'none';
    if (dark) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(8,16,34,.5)'); gr.addColorStop(0.5, 'rgba(8,16,34,.3)'); gr.addColorStop(0.6, 'rgba(8,16,34,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  });
  T.crowdLo = crowd(false); T.crowdUp = crowd(true);
  T.pad = canvasTex(128, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a5b8a'); gr.addColorStop(1, '#1d4670'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,20,40,.5)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 2, 0, 2, h);
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, 6);
  });
  T.eye = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#21402d'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(8,24,14,.45)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h); g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, 4); });
  T.ply = canvasTex(256, 512, (g, w, h) => { // a sheet of plywood: pale face veneer, long grain, a couple of knots, a seam, scuffed edges
    g.fillStyle = '#d7b27a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x0 = rr() * w, wv = 3 + rr() * 9; g.strokeStyle = `rgba(${rr() < 0.5 ? '150,100,50' : '235,205,150'},${0.18 + rr() * 0.22})`; g.lineWidth = 1 + rr() * 2.5;
      g.beginPath(); for (let y = 0; y <= h; y += 8) { const x = x0 + Math.sin(y / (40 + rr() * 30) + i) * wv; y ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    for (let i = 0; i < 3; i++) { const x = 30 + rr() * (w - 60), y = 40 + rr() * (h - 80); g.fillStyle = 'rgba(110,70,30,.55)'; g.beginPath(); g.ellipse(x, y, 5 + rr() * 4, 9 + rr() * 6, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(120,80,40,.35)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, 10, 18, 0, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(90,60,30,.55)'; g.fillRect(0, h * 0.5 - 1, w, 2);
    g.strokeStyle = 'rgba(90,60,30,.6)'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
    g.fillStyle = 'rgba(160,110,60,.12)'; for (let i = 0; i < 1500; i++) g.fillRect(rr() * w, rr() * h, 2, 2);
  });
  T.blob = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  T.num = canvasTex(128, 64, (g, w, h) => { g.font = `900 52px ${FONT_D}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fbf8f0'; g.fillText(String(FENCE_R), w / 2, h / 2 + 2); });
  T.net = canvasTex(64, 64, (g, w, h) => { g.strokeStyle = 'rgba(40,44,52,.9)'; g.lineWidth = 2; for (let k = 0; k <= 64; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); } });

  // mesh builders
  const MB = () => ({ p: [], n: [], t: [], i: [] });
  function qB(b, a, b2, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const n = norm(cross(sub(b2, a), sub(d, a))), k = b.p.length / 3;
    [[a, uv[0]], [b2, uv[1]], [c, uv[2]], [d, uv[3]]].forEach(([q, u]) => { b.p.push(...q); b.n.push(...n); b.t.push(...u); });
    b.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const wuv = (s = 26) => q => [q[0] / s, q[2] / s];
  function fanB(b, center, ring, uvf) {
    const k = b.p.length / 3; [center, ...ring].forEach(q => { b.p.push(...q); b.n.push(0, 1, 0); b.t.push(...uvf(q)); });
    for (let j = 1; j < ring.length; j++) b.i.push(k, k + j, k + j + 1);
  }
  function ringB(b, cx, cz, r0, r1, a0, a1, n, y, uvf) { // a band between two arcs
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n, P2 = (r, t) => [cx + Math.sin(t) * r, y, cz + Math.cos(t) * r];
      const q = [P2(r0, t0), P2(r0, t1), P2(r1, t1), P2(r1, t0)]; qB(b, ...q, uvf ? q.map(uvf) : undefined);
    }
  }
  const lineB = (b, ax, az, bx, bz, w, y = 0) => { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), nx = -dz / L * w / 2, nz = dx / L * w / 2; qB(b, [ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]); };
  const boxB = (b, c, hx, hy, hz) => { // axis-aligned box
    const [x, y, z] = c, v = (i, j, k) => [x + i * hx, y + j * hy, z + k * hz];
    qB(b, v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1)); qB(b, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); qB(b, v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1));
    qB(b, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); qB(b, v(1, -1, -1), v(1, -1, 1), v(1, 1, 1), v(1, 1, -1));
  };
  const ENV = { flat: [], solid: [], glass: [], posts: [] };
  const put = (list, b, col, opt = {}) => { if (b.i.length) list.push({ g: geo(b.p, b.n, b.t, b.i), col, ...opt }); };
  (() => {
    const D = D2R;
    // ---- ground, drawn flat in painter's order ----
    let b = MB(); fanB(b, [0, 0, GRASS_C[1]], GEO.grass, wuv(26)); put(ENV.flat, b, [1, 1, 1], { tex: T.grass });
    b = MB(); ringB(b, 0, 0, FENCE_R - 13, FENCE_R + 0.5, -45.5 * D, 45.5 * D, 40, 0, wuv(16)); put(ENV.flat, b, [0.9, 0.86, 0.84], { tex: T.dirt });
    b = MB(); ringB(b, 0, 0, FENCE_R - 13.6, FENCE_R - 13, -45 * D, 45 * D, 40, 0); put(ENV.flat, b, '#2d6a28', { a: 0.6 });
    b = MB(); fanB(b, [0, 0, 0], arc(0, 0, 80, -52 * D, 52 * D, 30), wuv(16)); fanB(b, [0, 0, 0.5], GEO.home, wuv(16)); put(ENV.flat, b, [1, 1, 1], { tex: T.dirt });
    b = MB(); const cl = c => [...c, c[0]];
    fanB(b, [0, 0, 0.3], cl(circle(0, 0.3, 9, 28, 0)), q => [0, 0]); fanB(b, [0, 0, 50.2], cl(circle(0, 50.2, 6.5, 24, 0)), q => [0, 0]);
    BASES.forEach(([x, z]) => fanB(b, [x, 0, z], cl(circle(x, z, 4.2, 20, 0)), q => [0, 0]));
    const lanes = [[0, 0], BASES[0], BASES[1], BASES[2], [0, 0]];
    for (let i = 0; i < 4; i++) lineB(b, lanes[i][0], lanes[i][1], lanes[i + 1][0], lanes[i + 1][1], 2.8);
    put(ENV.flat, b, '#9a5a30', { a: 0.1 });
    b = MB(); ringB(b, 0, 0, 79.6, 80.4, -52 * D, 52 * D, 40, 0); put(ENV.flat, b, '#2a5a22', { a: 0.7 }); // the lip where the clay meets the grass
    // the plywood strike board goes down first so the plate sits on top of it
    b = MB(); qB(b, [-MAT.half, 0, MAT.z1], [MAT.half, 0, MAT.z1], [MAT.half, 0, MAT.z0], [-MAT.half, 0, MAT.z0]); put(ENV.flat, b, [1, 1, 1], { tex: T.ply });
    // chalk
    b = MB(); const POLE = FENCE_R / Math.SQRT2;
    for (const s of [1, -1]) lineB(b, 0, 0, s * POLE, POLE, 0.24);
    for (const s of [-1, 1]) { const x0 = s * 1.6, x1 = s * 4.6; lineB(b, x0, -1.6, x1, -1.6, 0.17); lineB(b, x1, -1.6, x1, 4.6, 0.17); lineB(b, x1, 4.6, x0, 4.6, 0.17); lineB(b, x0, 4.6, x0, -1.6, 0.17); }
    lineB(b, -1, 50.25, 1, 50.25, 0.5);
    for (let i = 0; i < 28; i++) { const t0 = i / 28 * Math.PI * 2, t1 = (i + 1) / 28 * Math.PI * 2; lineB(b, Math.sin(t0) * 8, 50.2 + Math.cos(t0) * 8, Math.sin(t1) * 8, 50.2 + Math.cos(t1) * 8, 0.2); }
    fanB(b, [0, 0, 0.75], [[-0.71, 0, 1.42], [0.71, 0, 1.42], [0.71, 0, 0.71], [0, 0, 0], [-0.71, 0, 0.71], [-0.71, 0, 1.42]], q => [0, 0]); // plate
    put(ENV.flat, b, '#ece7da', { a: 0.92 });
    // ---- solid things, depth-tested ----
    b = MB(); BASES.forEach(([x, z]) => boxB(b, [x, 0.1, z], 0.65, 0.1, 0.65)); put(ENV.solid, b, '#fbf8f0');
    // the bowl
    const lo = MB(), up = MB(), eyeLo = MB(), conc = MB(), concF = MB(), wallF = MB(), cap = MB(), roofU = MB(), roofT = MB(), fasc = MB(), rib = [MB(), MB()];
    const B = BOWL; let arcLen = 0;
    GEO.stands.forEach((s, i) => {
      const { a0, a1, r0, r1 } = s, P3 = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
      const band = (bb, fa, ga, fb, gb, uv) => qB(bb, P3(a0, r0 + fa, ga), P3(a1, r1 + fa, ga), P3(a1, r1 + fb, gb), P3(a0, r0 + fb, gb), uv);
      const L = (a1 - a0) * (r0 + 40), u0 = arcLen / 60, u1 = (arcLen + L) / 60; arcLen += L;
      const uv = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
      band(wallF, 0, 0, 0, B.wall[1]); band(cap, 0, B.wall[1], 1.2, B.wall[1]);
      band(s.eye ? eyeLo : lo, 0.6, B.wall[1], B.lo1[0], B.lo1[1], uv);
      band(concF, B.lo1[0], B.lo1[1], B.conc[0], B.conc[1]);
      band(rib[i % 2], B.lo1[0] - 0.05, B.conc[1] - 2, B.lo1[0] - 0.05, B.conc[1] - 0.6);
      band(conc, B.conc[0], B.lo1[1] + 7, B.up0[0], B.up0[1]);
      band(up, B.up0[0], B.up0[1], B.up1[0], B.up1[1], uv);
      band(conc, B.up1[0], B.up1[1], B.up1[0], B.roof1[1]);
      band(roofU, B.roof0[0], B.roof0[1], B.roof1[0], B.roof1[1]); band(roofT, B.roof0[0], B.roof0[1] + 3, B.roof1[0], B.roof1[1] + 3);
      band(fasc, B.roof0[0], B.roof0[1], B.roof0[0], B.roof0[1] + 3);
      if (i % 3 === 0) { const f = B.roof0[0] + 4, k = (f - B.up0[0]) / (B.up1[0] - B.up0[0]); ENV.posts.push([P3(a0, r0 + f, B.up0[1] + (B.up1[1] - B.up0[1]) * k), P3(a0, r0 + f, B.roof0[1])]); }
    });
    put(ENV.solid, lo, [1, 1, 1], { tex: T.crowdLo }); put(ENV.solid, up, [1, 1, 1], { tex: T.crowdUp }); put(ENV.solid, eyeLo, '#1d3528');
    put(ENV.solid, conc, '#a9b1ba'); put(ENV.solid, concF, '#dfe2e6'); put(ENV.solid, wallF, '#2b5d8c'); put(ENV.solid, cap, '#f2c230');
    put(ENV.solid, rib[0], '#d9463a'); put(ENV.solid, rib[1], '#f2c230');
    put(ENV.solid, roofU, '#7f8a96'); put(ENV.solid, roofT, '#c9ced4'); put(ENV.solid, fasc, '#f2f3f5');
    // batter's eye
    const eR = standR(0) - 6, eA = (EYE_DEG + 1) * D;
    b = MB(); for (let i = 0; i < 6; i++) { const t0 = -eA + 2 * eA * i / 6, t1 = -eA + 2 * eA * (i + 1) / 6; qB(b, [Math.sin(t0) * eR, 0, Math.cos(t0) * eR], [Math.sin(t1) * eR, 0, Math.cos(t1) * eR], [Math.sin(t1) * eR, 44, Math.cos(t1) * eR], [Math.sin(t0) * eR, 44, Math.cos(t0) * eR], [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]]); }
    put(ENV.solid, b, [1, 1, 1], { tex: T.eye });
    // padded outfield wall, with a cap on top and the distances
    b = MB(); const c2 = MB();
    GEO.fence.forEach(([t0, t1]) => {
      const p = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r];
      qB(b, p(t0, FENCE_R, 0), p(t1, FENCE_R, 0), p(t1, FENCE_R, FENCE_H), p(t0, FENCE_R, FENCE_H));
      qB(c2, p(t0, FENCE_R, FENCE_H), p(t1, FENCE_R, FENCE_H), p(t1, FENCE_R + 1, FENCE_H), p(t0, FENCE_R + 1, FENCE_H));
    });
    put(ENV.solid, b, [1, 1, 1], { tex: T.pad }); put(ENV.solid, c2, '#f2c230');
    b = MB(); for (const deg of [-40, -20, 0, 20, 40]) { const t = deg * D, r = FENCE_R - 0.12, x = Math.sin(t), z = Math.cos(t), sx = Math.cos(t) * 3, sz = -Math.sin(t) * 3; qB(b, [x * r - sx, 2.6, z * r - sz], [x * r + sx, 2.6, z * r + sz], [x * r + sx, 5.6, z * r + sz], [x * r - sx, 5.6, z * r - sz]); }
    put(ENV.solid, b, [1, 1, 1], { tex: T.num, alphaTest: true, flat: true });
    // foul poles and their screens
    b = MB(); for (const s of [-1, 1]) qB(b, [s * POLE, 10, POLE], [s * (POLE + 2.5), 10, POLE + 2.5], [s * (POLE + 2.5), 32, POLE + 2.5], [s * POLE, 32, POLE]);
    put(ENV.solid, b, '#e9c03a');
    for (const s of [-1, 1]) ENV.posts.push([[s * POLE, 0, POLE], [s * POLE, 34, POLE], 0.35, '#f2c230']);
    // dugouts
    DUGOUTS.forEach(dg => {
      const { pt } = dg, L = 22, f0 = 26, f1 = 36, m = MB(), back = MB(), lip = MB(), roof = MB(), trim = MB();
      qB(m, pt(-L, f0, 0.02), pt(L, f0, 0.02), pt(L, f1, 0.02), pt(-L, f1, 0.02));
      qB(back, pt(-L, f1, 0), pt(L, f1, 0), pt(L, f1, 6.8), pt(-L, f1, 6.8));
      for (const a of [-L, L]) qB(back, pt(a, f0, 0), pt(a, f1, 0), pt(a, f1, 6.8), pt(a, f0, 6.8));
      for (let k = -L + 2; k < L - 2; k += 4) qB(back, pt(k, f1 - 1.8, 1.6), pt(k + 3, f1 - 1.8, 1.6), pt(k + 3, f1 - 0.2, 1.6), pt(k, f1 - 0.2, 1.6)); // bench
      qB(lip, pt(-L, f0, 0), pt(L, f0, 0), pt(L, f0, 2.4), pt(-L, f0, 2.4));
      qB(roof, pt(-L - 0.5, f0 - 0.6, 6.8), pt(L + 0.5, f0 - 0.6, 6.8), pt(L + 0.5, f1 + 0.4, 7.4), pt(-L - 0.5, f1 + 0.4, 7.4));
      qB(trim, pt(-L - 0.5, f0 - 0.6, 5.6), pt(L + 0.5, f0 - 0.6, 5.6), pt(L + 0.5, f0 - 0.6, 6.8), pt(-L - 0.5, f0 - 0.6, 6.8));
      put(ENV.solid, m, '#3a2c20'); put(ENV.solid, back, '#24303e'); put(ENV.solid, lip, '#1f4a73'); put(ENV.solid, roof, '#5d6670'); put(ENV.solid, trim, dg.side > 0 ? '#1f3a6b' : '#b3302a');
      for (const a of [-L + 1, 0, L - 1]) ENV.posts.push([pt(a, f0 + 0.2, 2.4), pt(a, f0 + 0.2, 6.8), 0.18, '#3a414c']);
    });
    // backstop: padded wall low, netting above, posts
    const a0 = 128 * D, a1 = 232 * D, rB = 36, pad = MB(), net = MB();
    for (let i = 0; i < 12; i++) {
      const t0 = a0 + (a1 - a0) * i / 12, t1 = a0 + (a1 - a0) * (i + 1) / 12, p = (t, y) => [Math.sin(t) * rB, y, Math.cos(t) * rB];
      qB(pad, p(t0, 0), p(t1, 0), p(t1, 4.5), p(t0, 4.5), [[0, 0.1], [1, 0.1], [1, 0.9], [0, 0.9]]);
    }
    put(ENV.solid, pad, [1, 1, 1], { tex: T.pad }); put(ENV.glass, net, [1, 1, 1], { tex: T.net, a: 0.55 });
    // scoreboard frame on top of the batter's eye
    const zS = standR(0) - 7;
    b = MB(); boxB(b, [0, 57, zS + 0.8], 31.5, 14, 0.7); put(ENV.solid, b, '#e8e4da');
    for (const x of [-18, 18]) ENV.posts.push([[x, 40, zS + 1], [x, 44, zS + 1], 0.8, '#30353d']);
  })();
  /* ---- Hampton Park, Ottawa: a city park diamond. Lawn and big trees past a 6 ft chain-link fence, light towers
     (the diamonds there are lit), aluminum bleachers and team benches behind chain-link, a tall backstop, and the
     Queensway's sound wall beyond left field. Same 250 ft dimensions as the stadium so stats compare. ---- */
  const ENV_H = { flat: [], solid: [], glass: [], posts: [] };
  (() => {
    const D = D2R; let sdH = 99; const rh = () => { sdH = (sdH * 1103515245 + 12345) & 0x7fffffff; return sdH / 0x7fffffff; };
    let b = MB(); ringB(b, 0, 0, 2, 2400, -Math.PI, Math.PI, 72, -0.02, wuv(30)); ENV_H.flat.push({ g: geo(b.p, b.n, b.t, b.i), col: [0.93, 0.98, 0.9], tex: T.grass }); // park lawn out to the trees
    const P3 = (t, r, y) => [Math.sin(t) * r, y, Math.cos(t) * r];
    // chain-link outfield fence with a yellow safety cap, galvanized posts every 8 degrees
    const fence = MB(), capY = MB();
    for (let i = 0; i < 46; i++) { const t0 = (-46 + i * 2) * D, t1 = (-44 + i * 2) * D;
      qB(fence, P3(t0, FENCE_R, 0), P3(t1, FENCE_R, 0), P3(t1, FENCE_R, 6), P3(t0, FENCE_R, 6), [[0, 0], [2, 0], [2, 1.2], [0, 1.2]]);
      qB(capY, P3(t0, FENCE_R, 5.75), P3(t1, FENCE_R, 5.75), P3(t1, FENCE_R, 6.25), P3(t0, FENCE_R, 6.25)); }
    ENV_H.glass.push({ g: geo(fence.p, fence.n, fence.t, fence.i), col: [1, 1, 1], tex: T.net, a: 0.5 });
    put(ENV_H.solid, capY, '#f2c230');
    for (let d = -45; d <= 45; d += 8) ENV_H.posts.push([P3(d * D, FENCE_R, 0), P3(d * D, FENCE_R, 6.3), 0.12, '#9aa3ad']);
    const POLE = FENCE_R / Math.SQRT2;
    for (const sgn of [-1, 1]) ENV_H.posts.push([[sgn * POLE, 0, POLE], [sgn * POLE, 22, POLE], 0.25, '#f2c230']);
    // backstop: tall chain-link on posts, no padding
    const bs = MB(), rB = 32;
    for (let i = 0; i < 10; i++) { const t0 = (130 + i * 10) * D, t1 = (140 + i * 10) * D; qB(bs, P3(t0, rB, 0), P3(t1, rB, 0), P3(t1, rB, 18), P3(t0, rB, 18), [[0, 0], [3, 0], [3, 4], [0, 4]]); ENV_H.posts.push([P3(t0, rB, 0), P3(t0, rB, 18.5), 0.2, '#8d969e']); }
    ENV_H.glass.push({ g: geo(bs.p, bs.n, bs.t, bs.i), col: [1, 1, 1], tex: T.net, a: 0.6 });
    // team benches behind chain-link down each line, aluminum bleachers behind them
    for (const sgn of [1, -1]) {
      const u = [sgn * Math.SQRT1_2, Math.SQRT1_2], n = [sgn * Math.SQRT1_2, -Math.SQRT1_2];
      const pt = (a, o, y) => [u[0] * a + n[0] * o, y, u[1] * a + n[1] * o];
      const bench = MB(), wire = MB(), bl = MB();
      boxB(bench, pt(70, 22, 1.4), 9, 0.12, 0.6); // a long bench (axis-aligned is close enough at this distance)
      qB(wire, pt(52, 18, 0), pt(88, 18, 0), pt(88, 18, 7), pt(52, 18, 7), [[0, 0], [9, 0], [9, 1.6], [0, 1.6]]);
      for (let r = 0; r < 5; r++) boxB(bl, pt(112, 30 + r * 2.2, 0.6 + r * 1.3), 8, 0.12, 1.1); // five rows of aluminum planks
      put(ENV_H.solid, bench, '#b8bfc6'); put(ENV_H.solid, bl, '#c9ced4');
      ENV_H.glass.push({ g: geo(wire.p, wire.n, wire.t, wire.i), col: [1, 1, 1], tex: T.net, a: 0.45 });
      for (const a of [104, 120]) ENV_H.posts.push([pt(a, 30, 0), pt(a, 39, 6.5), 0.1, '#aeb4ba']);
    }
    // light towers: the Hampton diamonds are lit
    for (const [ang, r] of [[-62, 150], [62, 150], [-38, 275], [38, 275], [-105, 70], [105, 70]]) {
      const base = P3(ang * D, r, 0), top = P3(ang * D, r, 72);
      ENV_H.posts.push([base, top, 0.6, '#7c858f']);
      const lamps = MB(); boxB(lamps, top, 4.5, 2.2, 1.2); put(ENV_H.solid, lamps, '#dfe3e8');
    }
    // ---- everything around the diamond, from the satellite view (see HAMPTON) ----
    const H_ = HAMPTON, hw = H_.hw, flatB = MB(), lotB = MB();
    const hwp = (t, o, y = 0) => [hw.p0[0] + hw.u[0] * t + hw.n[0] * o, y, hw.p0[1] + hw.u[1] * t + hw.n[1] * o];
    for (const lot of H_.lots) fanB(lotB, [lot.reduce((m, q) => m + q[0], 0) / lot.length, 0.03, lot.reduce((m, q) => m + q[1], 0) / lot.length], [...lot, lot[0]].map(([x, z]) => [x, 0.03, z]), wuv(40));
    qB(lotB, hwp(hw.t0, -8, 0.04), hwp(hw.t1, -8, 0.04), hwp(hw.t1, hw.w + 8, 0.04), hwp(hw.t0, hw.w + 8, 0.04), [[0, 0], [60, 0], [60, 4], [0, 4]]); // the Queensway's eight lanes
    put(ENV_H.flat, lotB, '#5d6166');
    const dashB = MB();
    for (const o of [15.5, 31, 46.5, 77.5, 93, 108.5]) for (let t = hw.t0; t < hw.t1; t += 40) { const a0 = hwp(t, o - 0.4, 0.06), a1 = hwp(t + 14, o - 0.4, 0.06), a2 = hwp(t + 14, o + 0.4, 0.06), a3 = hwp(t, o + 0.4, 0.06); qB(dashB, a3, a2, a1, a0); } // dashed lane lines
    put(ENV_H.flat, dashB, '#e9e6dc', { a: 0.85 });
    // gravel path round Field #1 and up into the woods
    ringB(flatB, 0, 0, FENCE_R + 14, FENCE_R + 20, -70 * D, 70 * D, 40, 0.03);
    for (let z = 420; z < 1250; z += 30) { const x0 = -30 + (z - 450) * 0.18, x1 = -30 + (z + 30 - 450) * 0.18; lineB(flatB, x0, z, x1, z + 30, 7, 0.03); }
    put(ENV_H.flat, flatB, '#c8b896');
    const P_ = H_.pool, pool = MB(); qB(pool, [P_.x - P_.w / 2, 0.05, P_.z + P_.d / 2], [P_.x + P_.w / 2, 0.05, P_.z + P_.d / 2], [P_.x + P_.w / 2, 0.05, P_.z - P_.d / 2], [P_.x - P_.w / 2, 0.05, P_.z - P_.d / 2]); put(ENV_H.flat, pool, '#5fb7e0');
    // Field #2: sand infield, home plate, a backstop and benches of its own
    const [f2x, f2z] = H_.field2, f2 = MB();
    fanB(f2, [f2x, 0.05, f2z], arc(f2x, f2z, 80, -52 * D, 52 * D, 24, 0.05), wuv(16)); put(ENV_H.flat, f2, [0.95, 0.9, 0.85], { tex: T.dirt });
    const f2c = MB(); for (const sg of [1, -1]) lineB(f2c, f2x, f2z, f2x + sg * 120, f2z + 120, 0.3, 0.07); put(ENV_H.flat, f2c, '#ece7da', { a: 0.9 });
    ENV_H.flat.push(...ENV.flat);
    // rotated boxes: buildings, and the trunks merged into one mesh
    const obox = (bb, x, z, w, d, h, ang = 0, y0 = 0, roof = null) => {
      const cs = Math.cos(ang), sn = Math.sin(ang), k = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [x + (i * w / 2) * cs + (j * d / 2) * sn, z - (i * w / 2) * sn + (j * d / 2) * cs]);
      for (let i = 0; i < 4; i++) { const a0 = k[i], a1 = k[(i + 1) % 4]; qB(bb, [a0[0], y0, a0[1]], [a1[0], y0, a1[1]], [a1[0], y0 + h, a1[1]], [a0[0], y0 + h, a0[1]]); }
      if (roof) { // a gable roof along the long side
        const m0 = [(k[0][0] + k[3][0]) / 2, (k[0][1] + k[3][1]) / 2], m1 = [(k[1][0] + k[2][0]) / 2, (k[1][1] + k[2][1]) / 2], top = y0 + h + roof.rise;
        qB(roof.b, [k[0][0], y0 + h, k[0][1]], [k[1][0], y0 + h, k[1][1]], [m1[0], top, m1[1]], [m0[0], top, m0[1]]);
        qB(roof.b, [k[2][0], y0 + h, k[2][1]], [k[3][0], y0 + h, k[3][1]], [m0[0], top, m0[1]], [m1[0], top, m1[1]]);
        qB(bb, [k[3][0], y0 + h, k[3][1]], [k[0][0], y0 + h, k[0][1]], [m0[0], top, m0[1]], [m0[0], top, m0[1]]);
        qB(bb, [k[1][0], y0 + h, k[1][1]], [k[2][0], y0 + h, k[2][1]], [m1[0], top, m1[1]], [m1[0], top, m1[1]]);
      } else qB(bb, [k[0][0], y0 + h, k[0][1]], [k[1][0], y0 + h, k[1][1]], [k[2][0], y0 + h, k[2][1]], [k[3][0], y0 + h, k[3][1]]);
    };
    const G_ = H_.grocery, Pl = H_.plaza, PH = H_.poolHouse;
    let bb = MB(); obox(bb, G_.x, G_.z, G_.w, G_.d, G_.h, G_.ang); put(ENV_H.solid, bb, '#cdbf9f');           // the grocery store: a big flat-roofed box
    bb = MB(); obox(bb, G_.x, G_.z, G_.w + 1, G_.d + 1, 3.5, G_.ang, G_.h - 3.5); put(ENV_H.solid, bb, '#2f7a4a');  // its coloured fascia
    bb = MB(); obox(bb, Pl.x, Pl.z, Pl.w, Pl.d, Pl.h, Pl.ang); put(ENV_H.solid, bb, '#a8574a');                 // the Sebring Ave plaza
    bb = MB(); obox(bb, PH.x, PH.z, PH.w, PH.d, PH.h, 0); put(ENV_H.solid, bb, '#d9d2c2');                       // the pool's changing rooms
    const pf = MB(); for (const [x0, z0, x1, z1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) { const A = [P_.x + x0 * (P_.w / 2 + 8), P_.z + z0 * (P_.d / 2 + 8)], B = [P_.x + x1 * (P_.w / 2 + 8), P_.z + z1 * (P_.d / 2 + 8)]; qB(pf, [A[0], 0, A[1]], [B[0], 0, B[1]], [B[0], 6, B[1]], [A[0], 6, A[1]], [[0, 0], [8, 0], [8, 1.2], [0, 1.2]]); }
    ENV_H.glass.push({ g: geo(pf.p, pf.n, pf.t, pf.i), col: [1, 1, 1], tex: T.net, a: 0.45 });
    // the houses on Parkview Rd and Westview Ave, backing onto the park
    const wallsB = {}, roofsB = {};
    for (const h of H_.houses) { const wb = wallsB[h.wall] || (wallsB[h.wall] = MB()), rb = roofsB[h.roof] || (roofsB[h.roof] = MB()); obox(wb, h.x, h.z, h.w, h.d, h.h, 0, 0, { b: rb, rise: 9 }); }
    for (const c in wallsB) put(ENV_H.solid, wallsB[c], c); for (const c in roofsB) put(ENV_H.solid, roofsB[c], c);
    // the dog run's fence, along the highway toward Island Park Dr
    const dg = MB(), dl = H_.dog; for (let i = 0; i < 4; i++) { const A = dl[i], B = dl[(i + 1) % 4]; qB(dg, [A[0], 0, A[1]], [B[0], 0, B[1]], [B[0], 5, B[1]], [A[0], 5, A[1]], [[0, 0], [20, 0], [20, 1], [0, 1]]); }
    ENV_H.glass.push({ g: geo(dg.p, dg.n, dg.t, dg.i), col: [1, 1, 1], tex: T.net, a: 0.4 });
    // the trees: low-poly round crowns, trunks merged into one mesh
    const trunkB = MB(), crowns = [MB(), MB(), MB(), MB()], ccols = ['#2f6b2a', '#3d7d30', '#4f8d38', '#2a5f2c'];
    const blob = (bb2, c, r, h) => { // three lumpy rings between a top and a bottom
      const N = 8, rings = [[-0.55, 0.62], [0, 1], [0.5, 0.78]].map(([dy, k]) => Array.from({ length: N }, (_, j) => { const q = j / N * Math.PI * 2, w = r * k * (0.82 + rh() * 0.36); return [c[0] + Math.cos(q) * w, c[1] + dy * h + (rh() - 0.5) * 1.5, c[2] + Math.sin(q) * w]; }));
      const top = [c[0], c[1] + h * 0.85, c[2]], bot = [c[0], c[1] - h * 0.8, c[2]];
      for (let j = 0; j < N; j++) { const j2 = (j + 1) % N;
        qB(bb2, rings[0][j2], rings[0][j], bot, bot); qB(bb2, rings[0][j], rings[0][j2], rings[1][j2], rings[1][j]);
        qB(bb2, rings[1][j], rings[1][j2], rings[2][j2], rings[2][j]); qB(bb2, rings[2][j], rings[2][j2], top, top); }
    };
    for (const t of H_.trees) { obox(trunkB, t.x, t.z, 2, 2, t.h - t.cr * 0.5, rh() * 1.5); blob(crowns[ccols.indexOf(t.c)], [t.x, t.h, t.z], t.cr, t.cr * 0.95); }
    put(ENV_H.solid, trunkB, '#5b4636'); crowns.forEach((c, i) => put(ENV_H.solid, c, ccols[i]));
    // the Queensway: concrete barriers on each side and down the middle, tall lamp posts on the median
    const bar = MB(); for (const o of [-3, 61, 63, hw.w + 3]) { const a0 = hwp(hw.t0, o), a1 = hwp(hw.t1, o); qB(bar, a0, a1, [a1[0], 3.4, a1[2]], [a0[0], 3.4, a0[2]]); }
    put(ENV_H.solid, bar, '#c4c6c4');
    for (let t = hw.t0 + 60; t < hw.t1; t += 170) ENV_H.posts.push([hwp(t, 62, 3), hwp(t, 62, 42), 0.45, '#8d969e']);
    // the big green sign on a gantry over the westbound lanes, facing the park
    const signT = canvasTex(512, 160, (g, w, h) => { g.fillStyle = '#0f6b3d'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f3f3ef'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#f3f3ef'; g.font = '800 64px "Chivo", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('417 Queensway', w / 2, h / 2 - 12);
      g.font = '600 30px "Chivo", Arial, sans-serif'; g.fillText('Exit 124 · Island Park Dr', w / 2, h / 2 + 42); });
    const st = 40, sg0 = hwp(st, 4, 22), sg1 = hwp(st, 58, 22), sign = MB();
    qB(sign, sg0, sg1, [sg1[0], 40, sg1[2]], [sg0[0], 40, sg0[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    ENV_H.solid.push({ g: geo(sign.p, sign.n, sign.t, sign.i), col: [1, 1, 1], tex: signT, flat: true });
    for (const o of [-4, hw.w + 4]) ENV_H.posts.push([hwp(st, o, 0), hwp(st, o, 42), 0.7, '#8d969e']);
    ENV_H.posts.push([hwp(st, -4, 41), hwp(st, hw.w + 4, 41), 0.6, '#8d969e']);
    // Field #2's backstop and its two light towers
    const bs2 = MB();
    for (let i = 0; i < 6; i++) { const t0 = (140 + i * 13) * D, t1 = (153 + i * 13) * D, Q = (t, y) => [f2x + Math.sin(t) * 28, y, f2z + Math.cos(t) * 28]; qB(bs2, Q(t0, 0), Q(t1, 0), Q(t1, 16), Q(t0, 16), [[0, 0], [3, 0], [3, 3], [0, 3]]); ENV_H.posts.push([Q(t0, 0), Q(t0, 16.5), 0.2, '#8d969e']); }
    ENV_H.glass.push({ g: geo(bs2.p, bs2.n, bs2.t, bs2.i), col: [1, 1, 1], tex: T.net, a: 0.5 });
    for (const [dx, dz] of [[-70, 110], [70, 110]]) { ENV_H.posts.push([[f2x + dx, 0, f2z + dz], [f2x + dx, 70, f2z + dz], 0.6, '#7c858f']); const lm = MB(); boxB(lm, [f2x + dx, 70, f2z + dz], 4.5, 2.2, 1.2); put(ENV_H.solid, lm, '#dfe3e8'); }
  })();
  const envNow = () => (PARK === 'hampton' ? ENV_H : ENV);
  // live scoreboard face
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = 512; sbCanvas.height = 256;
  let sbTex = null, sbKey = '';
  const sbQuad = (() => { const b = MB(), zS = standR(0) - 7.1; qB(b, [-30, 44, zS], [30, 44, zS], [30, 70, zS], [-30, 70, zS]); return geo(b.p, b.n, b.t, b.i); })();
  function scoreboard() {
    const prac = PRACTICE(S.mode);
    const top = prac ? (S.rogue ? `ROGUE-LITE · STAGE ${S.rogue.stage}` : isTargets() ? 'HOME RUN TARGETS' : S.mode === 'derby' ? 'HOME RUN DERBY' : 'BULLPEN') : `${teamName(0)} ${S.score[0]}  ·  ${teamName(1)} ${S.score[1]}`;
    const bot = prac ? (isTargets() ? `HIT ${S.prac.targets.filter(t => t.hit).length}/${TARGET_COUNT}   ${Math.max(0, Math.ceil(S.prac.timeLeft))} S` : S.rogue ? `PTS ${S.rogue.pts}/${S.rogue.need}   OUTS ${S.rogue.outs}/${S.rogue.outsMax}` : S.mode === 'derby' && S.prac ? `HR ${S.prac.hr}   OUTS ${S.prac.outs}` : S.prac ? `STRIKES ${S.prac.strikes}/${S.prac.pitches}` : '') : `${S.half ? 'BOT' : 'TOP'} ${S.inning}   B${S.balls} S${S.strikes} O${S.outs}`;
    const key = top + '|' + bot;
    if (key !== sbKey) {
      const g = sbCanvas.getContext('2d'), w = 512, h = 256;
      g.fillStyle = '#14202b'; g.fillRect(0, 0, w, h); g.fillStyle = '#b3302a'; g.fillRect(0, 0, w, 58);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fbf8f0'; g.font = `900 40px ${FONT_D}`; g.fillText('SLOWPITCH SHOWDOWN', w / 2, 31);
      g.fillStyle = '#ffcf6b'; g.font = `900 58px ${FONT_D}`; g.fillText(top, w / 2, 120);
      g.fillStyle = '#fbf8f0'; g.font = `700 44px ${FONT_D}`; g.fillText(bot, w / 2, 196);
      sbTex = tex(sbCanvas, sbTex); sbKey = key;
    }
    part(sbQuad, [1, 1, 1], [0, 0, 0], [1, 0, 0], UP, [0, 0, 1], 1, 1, 1, { tex: sbTex, flat: true });
  }
  const I3 = [[1, 0, 0], UP, [0, 0, 1]];
  const drawList = list => list.forEach(m => { setAlpha(m.a ?? 1); part(m.g, m.col, [0, 0, 0], ...I3, 1, 1, 1, { tex: m.tex, alphaTest: m.alphaTest, flat: m.flat, spec: 0 }); });
  function envFlat() { gl.disable(gl.DEPTH_TEST); drawList(envNow().flat); setAlpha(1); }
  function blob(at, a = 1, size = 1) { // a soft contact shadow stretched away from the sun
    const L = Math.hypot(SUN[0], SUN[2]), X = [-SUN[0] / L, 0, -SUN[2] / L], Y = [-X[2], 0, X[0]];
    setAlpha(0.42 * a);
    part(G.quad || (G.quad = grid(1, 1, (u, v) => [[u - 0.5, v - 0.5, 0], [0, 0, 1]])), '#0e2a12', addv([at[0], 0, at[2]], mul(X, 0.9 * size)), X, Y, UP, 3.6 * size, 1.9 * size, 1, { tex: T.blob, flat: true });
    setAlpha(1);
  }
  function envSolid() {
    gl.enable(gl.DEPTH_TEST); setAlpha(1);
    const E = envNow();
    drawList(E.solid);
    for (const [a, b2, r = 0.6, col = '#9aa3ad'] of E.posts) seg(a, b2, r, 1, col);
    if (E === ENV) scoreboard(); else queenswayTraffic();
  }
  /* cars and trucks on the Queensway, four lanes each way (just for looks: they never come near the field) */
  const CAR_COLS = ['#d8dadc', '#1f2328', '#9b1c1c', '#2c4f86', '#7a7f86', '#f0f0ee', '#b8892f', '#3c6e47'];
  const CARS = Array.from({ length: 30 }, (_, i) => ({ lane: i % 8, ph: (i * 397) % 2000, v: 92 + ((i * 37) % 30), col: CAR_COLS[(i * 5) % 8], truck: i % 7 === 3 }));
  function queenswayTraffic() {
    const hw = HAMPTON.hw, L = hw.t1 - hw.t0, now = performance.now() / 1000;
    const X = [hw.u[0], 0, hw.u[1]], Z = [hw.n[0], 0, hw.n[1]];
    for (const c of CARS) {
      const east = c.lane < 4, o = east ? 77.5 + 15.5 * (c.lane % 4) - 7.5 : 7.5 + 15.5 * (c.lane % 4); // northeast-bound lanes are the far ones
      let t = (c.ph + c.v * now) % L; if (!east) t = L - t; t += hw.t0;
      const len = c.truck ? 14 : 7.5, hgt = c.truck ? 5.5 : 2.6, wid = c.truck ? 4.2 : 3.4;
      const at = [hw.p0[0] + hw.u[0] * t + hw.n[0] * o, hgt, hw.p0[1] + hw.u[1] * t + hw.n[1] * o];
      part(G.cube, c.truck ? '#e7e7e2' : c.col, at, X, UP, Z, len, hgt, wid, { spec: 0.4 });
      if (!c.truck) part(G.cube, '#2a3138', [at[0], hgt * 1.75, at[2]], X, UP, Z, len * 0.55, hgt * 0.45, wid * 0.9, { spec: 0.6 }); // the cabin and windows
    }
  }
  function envGlass() { gl.depthMask(false); drawList(envNow().glass); gl.depthMask(true); setAlpha(1); }

  const clearGL = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); };
  // bullseye boards on posts, facing home plate; a hit one gets knocked flat onto its back
  const bullseye = (hit) => canvasTex(256, 256, (g) => {
    const cols = hit ? ['#8d939c', '#d6d9de'] : ['#d32f2f', '#f7f4ee'];
    for (let i = 0; i < 5; i++) { g.fillStyle = cols[i % 2]; g.beginPath(); g.arc(128, 128, 126 - i * 25, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.stroke();
  });
  const TT = { live: bullseye(false), hit: bullseye(true) };
  function drawTargets(list) {
    const quad = G.quad || (G.quad = grid(1, 1, (u, v) => [[u - 0.5, v - 0.5, 0], [0, 0, 1]]));
    for (const tg of list) {
      const n = [Math.sin(tg.ang), 0, Math.cos(tg.ang)], X = [Math.cos(tg.ang), 0, -Math.sin(tg.ang)];
      const tilt = tg.hit ? 1.25 : 0, Y = norm(addv(mul(UP, Math.cos(tilt)), mul(n, Math.sin(tilt)))), Z = cross(X, Y);
      const base = [tg.x, 0, tg.z], ctr = tg.hit ? addv(base, addv(mul(Y, tg.r), [0, 0.3, 0])) : [tg.x, tg.h, tg.z];
      if (!tg.hit) { seg([tg.x, 0, tg.z], [tg.x, tg.h - tg.r * 0.9, tg.z], 0.22, 1, '#3a3f47', { spec: 0.3 }); seg(addv(base, mul(n, 0.4)), addv([tg.x, tg.h - tg.r * 0.9, tg.z], mul(n, 0.4)), 0.14, 1, '#3a3f47'); }
      part(quad, [1, 1, 1], ctr, X, Y, Z, tg.r * 2, tg.r * 2, 1, { tex: tg.hit ? TT.hit : TT.live, alphaTest: true, spec: 0.15 });
    }
  }
  return { drawTargets, envFlat, envSolid, envGlass, blob, clear: clearGL, canvas: cvs, begin, setAlpha, player, drawBat, drawBallGL, setMirror, standingPose, batterPose, pitcherPose, catcherPose };
})();
if (GL3) { GL3.canvas.className = 'layer'; cv.after(GL3.canvas); }
let useGL = true; try { useGL = localStorage.getItem('fpd-gfx') !== 'classic'; } catch (_) {}
const use3D = () => !!GL3 && useGL; // sits between the field canvas and the overlay
/* the soft ground shadow under a figure, cast away from the sun */
function shadowAt(at, alpha = 1, size = 1) {
  const L = Math.hypot(SUN[0], SUN[2]), dx = -SUN[0] / L, dz = -SUN[2] / L, pts = [];
  for (let d = 0; d < 360; d += 30) { const c = Math.cos(d * D2R), s = Math.sin(d * D2R), a = (0.9 + c * 1.7) * size, b = s * 0.8 * size; pts.push([at[0] + dx * a - dz * b, 0.03, at[2] + dz * a + dx * b]); }
  ctx.globalAlpha = 0.3 * alpha; poly(pts, '#123a18'); ctx.globalAlpha = 1;
}
const ballGone = () => !!S.batted && hyp(S.ball.x, S.ball.z) > (isTargets() ? 330 : FENCE_R + 1.5); // out of the park: it's gone
function drawFxGL() { // ball trail and swing blur, drawn over the 3D layer
  const ballOn = S.phase !== 'over' && S.phase !== 'idle' && S.phase !== 'lobbyWait' && !S.hideBall && !ballGone();
  if (ballOn) drawBall('trail');
  if (ballOn && (S.phase === 'flight' || S.phase === 'replay') && !S.contacted && !S.inHand) { // a thin line from the ball down to its shadow: you can read its height and where it is over the ground
    const b = S.ball, top = P([b.x, b.y, b.z]), bot = P([b.x, 0.02, b.z]);
    if (top && bot) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(bot[0], bot[1], 3, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  const bt = S.bat;
  if (Math.abs(bt.w) > 14 && bt.phi > -50 * D2R) {
    const hands = [bt.hx, bt.hy, bt.hz], pts = [hands];
    for (let i = 0; i <= 6; i++) { const ph = bt.phi - bt.w * 0.02 * (1 - i / 6); pts.push(addv(hands, mul(batDir(ph, bt.e), BAT.L))); }
    poly(pts, 'rgba(255,255,255,.12)');
  }
}
/* what a fielder's body is doing: chasing, throwing, reaching for the ball, holding it */
function fielderAction(f, i) {
  const o = { run: f.run, hold: S.ball.held === i }, bt = S.batted, b = S.ball;
  if (f.jump > 0) { // up at the wall: glove at the ball if he has it, otherwise reaching as high as he can over the top
    o.jump = f.jump; o.run = 0; o.hold = false;
    o.reach = S.ball.held === i ? [b.x, b.y, b.z] : [f.x + Math.sin(f.face) * 1.2, 20, f.z + Math.cos(f.face) * 1.2];
    return o;
  }
  if (bt && f.threwAt !== undefined && bt.t >= f.threwAt && bt.t < f.threwAt + 0.5) { o.throwK = 0.45 + (bt.t - f.threwAt) / 0.5 * 0.55; o.run = 0; o.hold = false; }
  else if (bt && b.held === undefined && hyp(b.x - f.x, b.z - f.z) < 9 && b.y < 9) {
    const incoming = (b.thrown && b.thrown.toIdx === i) || (f.plan && (f.plan.chase || f.plan.holdAt !== undefined));
    if (incoming) o.reach = [b.x, b.y, b.z];
  }
  return o;
}
function drawPlayersGL(fieldT, batT, pitcherOff) {
  const list = [], ballOn = S.phase !== 'over' && S.phase !== 'idle' && S.phase !== 'lobbyWait' && !S.hideBall && !ballGone();
  S.fielders.forEach((f, i) => {
    if (f.kind === 'C' || (f.kind === 'P' && !pitcherOff)) return;
    const isP = f.kind === 'P', B = bodyFor(isP ? 'pit' + fieldT : 'f' + fieldT + '-' + i, f.build, fieldT);
    list.push([Object.assign(GL3.standingPose([f.x, 0, f.z], f.face ?? Math.atan2(-f.x, -f.z), fielderAction(f, i), B), { id: 'f' + i }), B, fieldT, isP ? NUMS.pitcher[fieldT] : FIELD_NUMS[i], '', [f.x, 0, f.z]]);
  });
  const rn = runnersNow();
  if (rn) for (const r of rn.list) { const B = bodyFor(r.key, r.build, batT); list.push([Object.assign(GL3.standingPose([r.x, 0, r.z], r.face, { run: r.run, helmet: true }, B), { id: r.key }), B, batT, r.num, '', [r.x, 0, r.z]]); }
  else S.bases.forEach((on, i) => {
    if (!on) return;
    const [x, z] = BASES[i], off = [[2, -2], [0, -2.5], [-2, -2]][i], at = [x + off[0], 0, z + off[1]], B = bodyFor('run' + batT + '-' + i, LINEUP_BUILDS[(i * 4 + 1) % 9], batT);
    list.push([GL3.standingPose(at, Math.atan2(-x, -z) + 1.2, { helmet: true }, B), B, batT, [5, 10, 16][i], '', at]);
  });
  const cf = S.fielders[0], catcherMoving = S.batted && (Math.abs(cf.x - cf.home[0]) > 0.5 || Math.abs(cf.z - cf.home[1]) > 0.5), Bc = bodyFor('cat' + fieldT, 'heavy', fieldT);
  let catcher = null;
  if (catcherMoving) { const p = GL3.standingPose([cf.x, 0, cf.z], cf.face || 0, { run: cf.run, hold: S.ball.held === 0 }, Bc); p.headKind = 'mask'; list.push([p, Bc, fieldT, NUMS.catcher[fieldT], '', [cf.x, 0, cf.z]]); }
  else catcher = [GL3.catcherPose(), Bc, fieldT, NUMS.catcher[fieldT], 'catcher', [0, 0, -4.4]];
  if (!pitcherOff) { const B = bodyFor('pit' + fieldT, 'normal', fieldT); list.push([GL3.pitcherPose(B), B, fieldT, NUMS.pitcher[fieldT], '', [0, 0, 50.2 - FLICK.stride * (S.oppStride || 0) * 0.6], pitMirror()]); }
  const slot = ((S.order && S.order[batT]) || 0) % 9, Bb = bodyFor('bat' + batT + '-' + slot, S.bb || 'normal', batT), bp = GL3.batterPose(Bb);
  bp.bobble = FACE.on && humanBats();
  const batterGone = rn && rn.batterGone;
  const bm = batMirror();
  if (!batterGone) list.push([bp, Bb, batT, LINEUP[batT][slot], 'batter', [bm ? -S.bat.bx : S.bat.bx, 0, S.bat.bz], bm]);
  else if (bp.bobble) { const me = list.find(it => it[1] === Bb && it[0].headKind === 'helmet'); if (me) me[0].bobble = true; } // your face goes down the line with you
  // the players themselves, lit and depth-tested
  GL3.begin();
  GL3.envFlat(); // turf, clay and chalk, then the soft shadows on top of them
  for (const it of list) GL3.blob(it[5], 1, it[1].w);
  if (catcher && cam.key !== 'bat') GL3.blob(catcher[5], 1, 1.2);
  if (ballOn && !S.inHand && hyp(S.ball.x, S.ball.z) < FENCE_R) { const pitch = S.phase === 'flight' || S.phase === 'replay'; GL3.blob([S.ball.x, 0, S.ball.z], pitch ? 1.6 / (1 + S.ball.y * 0.04) : 0.8 / (1 + S.ball.y * 0.08), pitch ? 0.32 : 0.22); }
  GL3.envSolid(); // the park, depth-tested
  if (isTargets()) GL3.drawTargets(S.prac.targets);
  for (const [p, B, t, num, kind, , mir] of list) { GL3.setMirror(mir); GL3.player(p, B, t, num, kind); }
  GL3.setMirror(bm); GL3.drawBat(batterGone ? { a: [S.bat.bx + 0.9, 0.11, S.bat.bz - 0.6], d: norm([0.85, 0, 0.5]) } : bp.bat); GL3.setMirror(false); // dropped in the dirt once he takes off
  if (ballOn) GL3.drawBallGL();
  GL3.envGlass();
  if (catcher && cam.key !== 'bat') GL3.player(...catcher.slice(0, 5));
}
function drawBall(flatOnly) {
  const b = S.ball;
  const sh = P([b.x, 0.01, b.z]);
  if (sh && flatOnly !== 'trail' && hyp(b.x, b.z) < FENCE_R) { const r = Math.max(1.5, 0.3 * sh[2]) / (1 + b.y * 0.05); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], r * 1.4, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
  if (!S.inHand && S.trail.length > 1 && b.held === undefined && !S.caughtByCatcher) {
    ctx.lineCap = 'round';
    for (let i = 1; i < S.trail.length; i++) {
      const a = P(S.trail[i - 1]), c = P(S.trail[i]); if (!a || !c) continue;
      ctx.strokeStyle = `rgba(232,240,80,${i / S.trail.length * 0.5})`; ctx.lineWidth = Math.max(1.2, BALL_R * c[2] * 1.4) * i / S.trail.length;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
  }
  if (flatOnly) return;
  const p = P([b.x, b.y, b.z]); if (!p) return;
  const r = Math.max(2.5, BALL_R * 1.2 * p[2]);
  ctx.fillStyle = '#e5ee4a'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
  if (r > 4) { ctx.strokeStyle = '#c43a2a'; ctx.lineWidth = Math.max(1, r * 0.15); const sp = S.t * 30; ctx.beginPath(); ctx.arc(p[0] - r * 0.9, p[1], r * 0.75, -0.9 + sp, 0.9 + sp); ctx.stroke(); }
}
function drawGuides() {
  const k = cam.key;
  if ((k === 'bat' || k === 'pitch') && !S.contacted && ['windup', 'throwing', 'waitPlay', 'replay', 'waitPitch', 'oppWindup', 'flight', 'result', 'wait', 'idle', 'lobbyWait'].includes(S.phase)) {
    if (S.mark && S.phase === 'result' && S.mark.z !== undefined) { // where the pitch came down
      const pts = []; for (let d = 0; d <= 360; d += 20) pts.push([S.mark.x + Math.cos(d * D2R) * 0.3, 0.04, S.mark.z + Math.sin(d * D2R) * 0.3]);
      polyline(pts, S.mark.strike ? '#ffcf6b' : '#7fd36b', 2.5);
    }
  }
  if (k === 'bat' && S.phase === 'flight' && !S.contacted && S.ball.vy < 0 && S.ball.z > -1) { // once the pitch starts dropping, a faint ring shows where it will come down
    const b = S.ball, L = simLanding([b.x, b.y, b.z], [b.vx, b.vy, b.vz], b.spin);
    if (L && L.z > -6 && L.z < 12) {
      const pts = []; for (let d = 0; d <= 360; d += 20) pts.push([L.x + Math.cos(d * D2R) * 0.35, 0.05, L.z + Math.sin(d * D2R) * 0.35]);
      polyline(pts, 'rgba(20,24,32,.55)', 3.5); polyline(pts, 'rgba(255,207,107,.9)', 1.8);
    }
  }
  if (k === 'bat' && humanBats() && mouse.seen && (['waitPitch', 'oppWindup'].includes(S.phase) || (S.phase === 'flight' && !S.contacted))) {
    // the aim ring: where the sweet spot of the barrel will cross in front of the plate at your current height. Put it on the ball.
    const bt = S.bat, hz2 = handsAt(bt, 0), e0 = batElev(0);
    const spot = addv([hz2[0], clamp(bt.ty, BAT.box.y0, BAT.box.y1), hz2[1]], mul(batDir(0, e0), BAT.L * 0.74));
    const p = P(spot);
    if (p) { const r = Math.max(6, HIT_Y * p[2]); ctx.strokeStyle = S.phase === 'flight' ? 'rgba(255,207,107,.95)' : 'rgba(255,207,107,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p[0] - r - 5, p[1]); ctx.lineTo(p[0] - r + 3, p[1]); ctx.moveTo(p[0] + r - 3, p[1]); ctx.lineTo(p[0] + r + 5, p[1]); ctx.stroke(); }
  }
  if (S.phase === 'windup' && cam.key === 'pitch') {
    // reach of the arm
    // where it would come down if you let go now, marked on the ground
    const R = flickPreview(), L = R ? simLanding(R.p, R.v, R.spin, true) : null;
    if (L && L.z > -12 && L.z < 48) {
      const ok = onMat(L.x, L.z) && L.apex >= ARC.lo && L.apex <= ARC.hi;
      const pts = []; for (let d = 0; d <= 360; d += 20) pts.push([L.x + Math.cos(d * D2R) * 0.45, 0.05, L.z + Math.sin(d * D2R) * 0.45]);
      polyline(pts, ok ? 'rgba(255,207,107,.9)' : 'rgba(229,238,74,.55)', 2);
    }
    drawPitchGuide();
  }
}
/* Inset: where the ball would come down if you let go right now, seen from above, plus how high it would arc.
   Real physics, just predicted. */
function drawPitchGuide() {
  const R = flickPreview() || { mph: 0, speed: 0 }, L = R.v ? simLanding(R.p, R.v, R.spin, true) : null;
  const bw = Math.min(170, W * 0.32), bh = bw * 1.25, x0 = W - bw - 12, y0 = H - bh - 12;
  ctx.fillStyle = 'rgba(10,15,31,.8)'; ctx.fillRect(x0, y0, bw, bh);
  ctx.strokeStyle = 'rgba(243,234,210,.25)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
  const sc = bw / 7, cx = x0 + bw / 2, cz = y0 + bh * 0.56; // 7 ft across; the pitcher's side is at the top
  const X = x => cx - x * sc, Z = z => cz - z * sc; // seen from behind the mound, like the main view: +x (first base) on the left
  ctx.fillStyle = 'rgba(168,98,58,.55)'; ctx.fillRect(x0 + 1, y0 + 22, bw - 2, bh - 40);
  ctx.fillStyle = '#cfa56c'; ctx.fillRect(X(MAT.half), Z(MAT.z1), MAT.half * 2 * sc, (MAT.z1 - MAT.z0) * sc);
  ctx.fillStyle = '#f3ead2'; ctx.beginPath(); ctx.moveTo(X(-0.71), Z(1.42)); ctx.lineTo(X(0.71), Z(1.42)); ctx.lineTo(X(0.71), Z(0.71)); ctx.lineTo(X(0), Z(0)); ctx.lineTo(X(-0.71), Z(0.71)); ctx.closePath(); ctx.fill();
  ctx.font = `700 11px ${FONT_D}`; ctx.fillStyle = 'rgba(243,234,210,.7)'; ctx.textAlign = 'left';
  ctx.fillText('LET GO NOW', x0 + 8, y0 + 15);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffcf6b'; ctx.font = `800 14px ${FONT_D}`;
  ctx.fillText(R.speed > 8 ? `${R.mph} MPH` : '—', x0 + bw - 8, y0 + 15);
  let arcTxt = 'ARC —', arcOk = false;
  if (L) {
    arcOk = L.apex >= ARC.lo && L.apex <= ARC.hi;
    arcTxt = `ARC ${L.apex.toFixed(1)} FT${arcOk ? '' : L.apex < ARC.lo ? ' · TOO FLAT' : ' · TOO HIGH'}`;
    const good = arcOk && onMat(L.x, L.z);
    const off = Z(L.z) < y0 + 24 ? 'up' : Z(L.z) > y0 + bh - 20 ? 'down' : '';
    const px = clamp(X(L.x), x0 + 5, x0 + bw - 5), pz = clamp(Z(L.z), y0 + 26, y0 + bh - 22);
    ctx.fillStyle = good ? '#ffcf6b' : '#e5ee4a'; ctx.globalAlpha = good ? 1 : 0.75;
    ctx.beginPath(); ctx.arc(px, pz, Math.max(4, BALL_R * sc * 1.6), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (off) { ctx.fillStyle = 'rgba(243,234,210,.8)'; ctx.font = `600 11px ${FONT_D}`; ctx.textAlign = 'center'; ctx.fillText(off === 'up' ? `SHORT · ${Math.round(L.z)} FT OUT` : 'LONG', cx, off === 'up' ? y0 + 38 : y0 + bh - 26); }
  }
  ctx.textAlign = 'left'; ctx.font = `700 12px ${FONT_D}`; ctx.fillStyle = arcOk ? '#7fd36b' : 'rgba(243,234,210,.8)';
  ctx.fillText(arcTxt, x0 + 8, y0 + bh - 6);
  // the wind, seen from above the same way as the box (the pitcher's side at the top)
  const wm = Math.hypot(WIND.x, WIND.z), mph = Math.round(wm * 2.2);
  if (mph >= 2) {
    const ax = x0 + bw - 22, ay = y0 + bh - 32, ux = -WIND.x / wm, uz = -WIND.z / wm, len = 9 + Math.min(9, wm * 2);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(uz, ux));
    ctx.strokeStyle = ctx.fillStyle = '#8fd3ff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len - 5, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(len - 7, -5); ctx.lineTo(len - 7, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.textAlign = 'right'; ctx.font = `700 10px ${FONT_D}`; ctx.fillStyle = '#8fd3ff'; ctx.fillText(`WIND ${mph}`, x0 + bw - 6, ay - 14);
  }
}
function draw() {
  const moving = cam.key === 'field' || cam.shake > 0.3;
  const sig = (use3D() ? '3d|' : '2d|') + [...cam.pos, ...cam.tgt].map(v => v.toFixed(3)).join(',') + '|' + cam.fov + '|' + W + 'x' + H + '|' + cam.sx.toFixed(1) + ',' + cam.sy.toFixed(1) + '|' + !!S + '|' + PARK + WX.kind;
  if (sig !== BG.sig) { // camera moved: rebuild the background layer
    const main = ctx; ctx = BG.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    drawSky(); if (S && !use3D()) drawStatic(moving);
    ctx = main; BG.sig = sig;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(BG.cv, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ovCtx.setTransform(1, 0, 0, 1, 0, 0); ovCtx.clearRect(0, 0, ov.width, ov.height);
  if (!S) { if (GL3) GL3.clear(); return; }
  // live bits on top: the scoreboard and the odd camera flash in the crowd
  if (!use3D() && PARK !== 'hampton') drawScoreboard();
  // (day game: no flashbulbs)
  const objs = [];
  const depth = p => { const c = toCam(p); return c[2]; };
  const fieldT = fieldingTeam(), batT = battingTeam();
  // the pitcher is a fielder too: once a ball is in play and he leaves the rubber (to cover first, back up a throw) he's drawn as one
  const pi = S.fielders.findIndex(f => f.kind === 'P'), pf = S.fielders[pi];
  const pitcherOff = !!(pf && S.batted && hyp(pf.x - pf.base[0], pf.z - pf.base[1]) > 1.5);
  if (use3D()) drawPlayersGL(fieldT, batT, pitcherOff);
  else {
  if (GL3) GL3.clear();
  S.fielders.forEach((f, i) => {
    if (f.kind === 'C' || (f.kind === 'P' && !pitcherOff)) return;
    objs.push({ d: depth([f.x, 3, f.z]), fn: () => fig(() => standing([f.x, 0, f.z], f.face ?? Math.atan2(-f.x, -f.z), teamCol(fieldT), teamDark(fieldT), { run: f.run, hold: S.ball.held === i, num: f.kind === 'P' ? NUMS.pitcher[fieldT] : FIELD_NUMS[i], body: bodyFor(f.kind === 'P' ? 'pit' + fieldT : 'f' + fieldT + '-' + i, f.build, fieldT) }), [f.x, 0, f.z]) });
  });
  const rn2 = runnersNow();
  if (rn2) for (const r of rn2.list) objs.push({ d: depth([r.x, 3, r.z]), fn: () => fig(() => standing([r.x, 0, r.z], r.face, teamCol(batT), teamDark(batT), { helmet: true, run: r.run, num: r.num, body: bodyFor(r.key, r.build, batT) }), [r.x, 0, r.z]) });
  if (!rn2) S.bases.forEach((on, i) => {
    if (!on) return;
    const [x, z] = BASES[i], off = [[2, -2], [0, -2.5], [-2, -2]][i];
    objs.push({ d: depth([x + off[0], 3, z + off[1]]), fn: () => fig(() => standing([x + off[0], 0, z + off[1]], Math.atan2(-x, -z) + 1.2, teamCol(batT), teamDark(batT), { helmet: true, num: [5, 10, 16][i], body: bodyFor('run' + batT + '-' + i, LINEUP_BUILDS[(i * 4 + 1) % 9], batT) }), [x + off[0], 0, z + off[1]]) });
  });
  const cf = S.fielders[0];
  const catcherMoving = S.batted && (Math.abs(cf.x - cf.home[0]) > 0.5 || Math.abs(cf.z - cf.home[1]) > 0.5);
  objs.push({ d: depth([0, 3, -4.2]), fn: () => catcherMoving ? fig(() => standing([cf.x, 0, cf.z], cf.face || 0, teamCol(fieldT), teamDark(fieldT), { run: cf.run, hold: S.ball.held === 0, num: NUMS.catcher[fieldT], body: bodyFor('cat' + fieldT, 'heavy', fieldT) }), [cf.x, 0, cf.z]) : fig(() => drawCatcher(1), [0, 0, -4.4], cam.key === 'bat' ? 0.3 : 1) });
  if (!pitcherOff) objs.push({ d: depth([0, 3, 50.3]), fn: () => { MIRX = pitMirror(); try { fig(drawPitcher, [0, 0, 50.2 - FLICK.stride * (S.oppStride || 0) * 0.6]); } finally { MIRX = false; } } });
  if (isTargets()) for (const tg of S.prac.targets) objs.push({ d: depth([tg.x, tg.h, tg.z]) + 1, fn: () => {
    const X = [Math.cos(tg.ang), 0, -Math.sin(tg.ang)], cy = tg.hit ? 0.3 : tg.h;
    if (!tg.hit) line3([tg.x, 0, tg.z], [tg.x, tg.h - tg.r, tg.z], 0.22, '#3a3f47');
    for (let i = 0; i < 5; i++) { const r = tg.r * (1 - i * 0.2), pts = [];
      for (let k = 0; k < 24; k++) { const q = k / 24 * Math.PI * 2; pts.push(tg.hit ? [tg.x + X[0] * Math.cos(q) * r + Math.sin(tg.ang) * Math.sin(q) * r, cy, tg.z + X[2] * Math.cos(q) * r + Math.cos(tg.ang) * Math.sin(q) * r] : [tg.x + X[0] * Math.cos(q) * r, cy + Math.sin(q) * r, tg.z + X[2] * Math.cos(q) * r]); }
      poly(pts, tg.hit ? (i % 2 ? '#d6d9de' : '#8d939c') : (i % 2 ? '#f7f4ee' : '#d32f2f')); }
  } });
  if (!(rn2 && rn2.batterGone)) objs.push({ d: depth([S.bat.bx, 3, S.bat.bz]), fn: () => { MIRX = batMirror(); try { fig(drawBatter, [S.bat.bx, 0, S.bat.bz]); } finally { MIRX = false; } } });
  if (S.phase !== 'over' && S.phase !== 'idle' && S.phase !== 'lobbyWait' && !S.hideBall && !ballGone()) objs.push({ d: depth([S.ball.x, S.ball.y, S.ball.z]) - 0.05, fn: drawBall });
  objs.sort((a, b) => b.d - a.d).forEach(o => o.fn());
  }
  const mainCtx = ctx; ctx = ovCtx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (use3D()) drawFxGL();
  drawCalls();
  drawGuides();
  // stadium light spilling over the infield, and a soft vignette
  if (!BG.vg || BG.vgW !== W || BG.vgH !== H) { BG.vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8); BG.vg.addColorStop(0, 'rgba(20,30,40,0)'); BG.vg.addColorStop(1, 'rgba(20,30,40,.28)'); BG.vgW = W; BG.vgH = H; }
  const vg = BG.vg;
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  drawWeather(1 / 60);
  for (const s of sparks) { const p = P(s.p); if (!p) continue; ctx.fillStyle = `rgba(255,230,150,${s.life * 2.4})`; ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); }
  ctx = mainCtx;
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000)); last = now;
  if (W > 0) { basis(); update(dt); updateCam(dt); draw(); }
  perfSample(now);
  requestAnimationFrame(frame);
}
/* automatic quality: if frames are slow, draw fewer pixels (and come back up when there's room) */
const PERF = { scale: 1, ts: [], changed: 0 };
try { PERF.scale = clamp(+localStorage.getItem('fpd-scale') || 1, 0.5, 1); } catch (_) {}
function perfSample(now) {
  const T = PERF.ts; T.push(now);
  if (T.length < 120) return;
  const d = []; for (let i = 1; i < T.length; i++) d.push(T[i] - T[i - 1]); d.sort((a, b) => a - b);
  const med = d[d.length >> 1]; PERF.ts = [now];
  if (document.hidden || med > 250) return; // a background tab or a hitch, not a slow machine
  let next = PERF.scale;
  if (med > 21 && PERF.scale > 0.5) next = Math.max(0.5, PERF.scale - 0.15);                          // under ~48 fps: step down
  else if (med < 12 && PERF.scale < 1 && now - PERF.changed > 15000) next = Math.min(1, PERF.scale + 0.15); // lots of headroom: step back up
  if (next !== PERF.scale) { PERF.scale = next; PERF.changed = now; try { localStorage.setItem('fpd-scale', next); } catch (_) {} resize(); }
}
function resize() {
  const r = stage.getBoundingClientRect();
  DPR = Math.min(1.5, window.devicePixelRatio || 1) * (typeof PERF === 'undefined' ? 1 : PERF.scale); // sharp enough on retina screens, far fewer pixels to fill; lower on slow machines
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  BG.cv.width = cv.width; BG.cv.height = cv.height; BG.sig = '';
  ov.width = cv.width; ov.height = cv.height;
  if (W > 0) basis();
}
new ResizeObserver(resize).observe(stage);

/* ---------- input ---------- */
function setMouse(e) {
  const r = cv.getBoundingClientRect(), nx = e.clientX - r.left, ny = e.clientY - r.top;
  if (mouse.seen) { mouse.dxAcc += nx - mouse.sx; mouse.bdx += nx - mouse.sx; mouse.bdy += ny - mouse.sy; }
  mouse.sx = nx; mouse.sy = ny; mouse.seen = true;
  if (S && S.grip) {
    const g = S.grip, now = performance.now();
    g.samples.push([now, nx, ny]);
    while (g.samples.length > 2 && now - g.samples[0][0] > 400) g.samples.shift();
  }
}
cv.addEventListener('pointermove', e => {
  if (mouse.down && e.pointerType === 'mouse' && !(e.buttons & 1)) { up(e); return; } // let go of the left button while still holding the right one
  if (e.getCoalescedEvents) { const evs = e.getCoalescedEvents(); if (evs.length) { evs.forEach(setMouse); return; } }
  setMouse(e);
});
cv.addEventListener('contextmenu', e => { if (S && S.phase === 'windup') e.preventDefault(); });
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
  setMouse(e); ac();
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  mouse.down = true;
  if (!S) return;
  if (S.phase === 'result' && S.timer > 0.25) S.timer = Math.min(S.timer, 0.15);
  if (S.phase === 'windup') { S.grip = { x0: mouse.sx, y0: mouse.sy, samples: [[performance.now(), mouse.sx, mouse.sy]] }; S.arm.w = 0; }
});
const up = e => {
  if (e && e.pointerType === 'mouse' && e.type === 'pointerup' && e.button === 2) return;
  if (e) setMouse(e);
  mouse.down = false;
  if (!S || S.phase !== 'windup' || !S.grip) return;
  S.grip = null;
  const P = pitchFromArm();
  if (!P) { hooks.banner('Swing it through first', 'hold, pull down, swing up, let go', 'small'); return; }
  const P1 = roundP(P); S.myPitch = P1;
  launchExact(P1); hud(); afterMyLaunch();
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', () => { mouse.down = false; if (S) S.grip = null; });

/* ---------- menus + lobby ---------- */
function setMode(m) {
  menuMode = m;
  document.querySelectorAll('#modeSeg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === m));
  $('cpuPanel').hidden = m === 'online';
  $('onlinePanel').hidden = m !== 'online';
  $('innBox').hidden = PRACTICE(m);
  $('buildBox').hidden = !(m === 'cpu' || m === 'derby' || m === 'targets' || m === 'rogue');
  rankUI();
  $('startBtn').textContent = m === 'rogue' ? 'Start the run' : m === 'derby' ? 'Start the derby' : m === 'bullpen' ? 'Take the mound' : m === 'targets' ? 'Start the clock' : 'Play ball';
  lobbyUI();
}
function lobbyUI(err) {
  const st = $('netStatus');
  if (!st) return;
  $('hostBtn').disabled = !net.room || net.joining;
  $('joinBtn').disabled = !net.room || net.joining;
  $('codeIn').disabled = !net.room;
  $('codeBox').hidden = !(net.rm && net.seat === 0);
  $('codeOut').textContent = net.code || '';
  let msg = '';
  if (err) msg = err;
  else if (net.room === undefined) msg = 'Connecting…';
  else if (!net.room) msg = 'Online play needs you signed in to claude.ai, with this game shared to you by email (Share → invite, at least “can contribute”). Opening it from a public link, or signed out, can’t join a game. Vs CPU works anywhere.';
  else if (net.denied) msg = 'Your moves aren’t reaching your rival: whoever shared this game needs to give you “can contribute” (or edit) access in the Share menu, then reload.';
  else if (net.joining) msg = 'Opening the game room…';
  else if (net.rm && net.opp) msg = `Rival connected. ${S && S.mode === 'online' ? 'Game on.' : 'Starting…'}`;
  else if (net.rm && net.seat === 0) msg = 'Waiting for your rival to join with this code.';
  else if (net.rm) msg = `In room ${net.code}. Waiting for the host…`;
  else msg = 'Create a game and send your rival the code, or join theirs.';
  st.textContent = msg;
}
document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
const pickSeg = (seg, attr, get, set) => document.querySelectorAll(`#${seg} button`).forEach(b => {
  b.setAttribute('aria-pressed', b.dataset[attr] === get());
  b.addEventListener('click', () => { set(b.dataset[attr]); document.querySelectorAll(`#${seg} button`).forEach(x => x.setAttribute('aria-pressed', x === b)); });
});
pickSeg('batsSeg', 'bats', () => menuBats, v => { menuBats = v; try { localStorage.setItem('fpd-bats', v); } catch (_) {} });
pickSeg('throwsSeg', 'throws', () => menuThrows, v => { menuThrows = v; try { localStorage.setItem('fpd-throws', v); } catch (_) {} });
pickSeg('parkSeg', 'park', () => menuPark, v => { menuPark = v; try { localStorage.setItem('fpd-park', v); } catch (_) {} });
pickSeg('wxSeg', 'wx', () => menuWx, v => { menuWx = v; try { localStorage.setItem('fpd-wx2', v); } catch (_) {} });
document.querySelectorAll('#innSeg button').forEach(b => b.addEventListener('click', () => {
  menuInn = +b.dataset.inn;
  document.querySelectorAll('#innSeg button').forEach(x => x.setAttribute('aria-pressed', x === b));
}));
document.querySelectorAll('#buildSeg button').forEach(b => {
  b.setAttribute('aria-pressed', b.dataset.build === menuBuild);
  b.addEventListener('click', () => {
    menuBuild = b.dataset.build;
    try { localStorage.setItem('fpd-build', menuBuild); } catch (_) {}
    document.querySelectorAll('#buildSeg button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
});
$('startBtn').addEventListener('click', () => { ac(); if (PRACTICE(menuMode)) startPractice(menuMode); else startCpuGame(); });
$('hostBtn').addEventListener('click', async () => {
  ac();
  const code = newCode();
  if (!(await joinCode(code, 0))) return;
  newGame('online', menuInn, 0);
  S.phase = 'lobbyWait';
  netPresence(); hud(); lobbyUI();
  if (net.opp) beginGameUI();
});
$('joinBtn').addEventListener('click', async () => {
  ac();
  const code = $('codeIn').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!codeOk(code)) { lobbyUI('Codes are 4 to 8 letters and numbers.'); return; }
  if (await joinCode(code, 1)) { newGame('cpu', 3); S.phase = 'idle'; S.mode = 'lobby'; netPresence(); lobbyUI(); }
});
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('copyBtn').addEventListener('click', e => {
  const t = net.code || '', btn = e.currentTarget;
  const done = ok => { btn.textContent = ok ? 'Copied' : 'Select it'; setTimeout(() => btn.textContent = 'Copy', 1400); };
  try { navigator.clipboard.writeText(t).then(() => done(true), () => { selectCode(); done(false); }); } catch (_) { selectCode(); done(false); }
});
function selectCode() { const r = document.createRange(); r.selectNodeContents($('codeOut')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
$('rematchBtn').addEventListener('click', () => {
  if (PRACTICE(S.mode)) { startPractice(S.prac && S.prac.kind || S.mode); return; }
  if (S.mode === 'online') { newGame('online', S.innings, net.seat); beginGameUI(); }
  else startCpuGame();
});
$('lbBtn').addEventListener('click', openBoard);
$('lbClose').addEventListener('click', () => { $('lbOverlay').hidden = true; });
document.querySelectorAll('#lbSeg button').forEach(b => b.addEventListener('click', () => { lbStat = b.dataset.stat; openBoard(); }));
$('overMenuBtn').addEventListener('click', () => { $('over').hidden = true; $('menu').hidden = false; });
$('menuBtn').addEventListener('click', () => { $('over').hidden = true; $('menu').hidden = !$('menu').hidden; });
$('gfxBtn').hidden = !GL3;
const gfxLabel = () => { $('gfxBtn').textContent = useGL ? '3D' : 'Classic'; $('gfxBtn').setAttribute('aria-pressed', useGL); };
gfxLabel();
$('gfxBtn').addEventListener('click', () => { useGL = !useGL; try { localStorage.setItem('fpd-gfx', useGL ? '3d' : 'classic'); } catch (_) {} gfxLabel(); BG.sig = ''; });
$('snd').addEventListener('click', e => { soundOn = !soundOn; crowd.setOn(soundOn); e.currentTarget.textContent = soundOn ? 'Sound on' : 'Sound off'; e.currentTarget.setAttribute('aria-pressed', soundOn); });

Object.assign(UI, hooks);
$('faceBtn').textContent = FACE.on ? 'Bobblehead on' : 'Bobblehead off';
$('faceBtn').addEventListener('click', () => {
  FACE.on = !FACE.on; $('faceBtn').textContent = FACE.on ? 'Bobblehead on' : 'Bobblehead off';
  try { localStorage.setItem('fpd-toon', FACE.on ? 'on' : 'off'); } catch (_) {}
});
window.__duel = { mouse, ROGUE, showOver, tip: () => { const b = S.bat, d = batDir(b.phi, b.e); return P([b.hx + d[0] * BAT.L, b.hy + d[1] * BAT.L, b.hz + d[2] * BAT.L]); }, CAMS, runnersNow, GL3, nextPitch, net, flickPreview, tick: s => { for (let i = 0; i < s * 60; i++) { update(1 / 60); updateCam(1 / 60); } } };

newGame('cpu', 3); S.phase = 'idle';
hud();
$('hint').innerHTML = 'Pick a mode to play.';
setMode('cpu');
net.room = undefined; lobbyUI();
(async () => {
  let room = null;
  try { room = window.claude && window.claude.use ? await window.claude.use('room') : null; } catch (_) { room = null; }
  net.room = room;
  try { const saved = JSON.parse(localStorage.getItem('fpd-code') || 'null'); if (saved && codeOk(saved.code) && saved.seat === 1) $('codeIn').value = saved.code; } catch (_) {}
  lobbyUI();
})();
resize();
requestAnimationFrame(frame);
})();
