/* Slowpitch Showdown: game rules and physics (no drawing). */

/* =================== CORE: 3D physics + rules (no DOM) =================== */
/* World: feet. Origin = point of home plate. +z toward the pitcher / center field, +x toward first base, +y up. */
const G = 32.17, DRAG = 0.002, TS_PITCH = 0.7, D2R = Math.PI / 180; // pitches play out at 70% speed: same path, more hang time
const PLATE_Z = 0.71, MOUND_Z = 50, FENCE_R = 250;
let FENCE_H = 10; // the park sets this (Hampton Park's chain-link is lower)
/* weather and run modifiers, set by the app: wind pushes the ball (ft/s^2), a wet field kills the bounce,
   and the rogue-lite perks scale the hitting window, power and pitch speed */
const WIND = { x: 0, z: 0 }, FIELD = { wet: 0 }, MODS = { hitR: 1, power: 1, ts: 1, grav: 1 };
const ZONE = { lo: 1.5, hi: 3.6, half: 0.71, mid: 2.55 };
/* Slowpitch: a taken pitch is a strike only if it lands on the plate or the mat behind it, and the arc must peak 6-16 ft. */
const MAT = { half: 1.42, z0: -0.63, z1: 3.63 }; // a plywood strike board twice the old size, lined up with the batter's boxes
const ARC = { lo: 6, hi: 16 }; // legal arc: the ball has to peak between 6 and 16 ft
const onMat = (x, z) => Math.abs(x) <= MAT.half + BALL_R && z >= MAT.z0 - BALL_R && z <= MAT.z1 + BALL_R;
const BALL_R = 0.16, HIT_R = 0.76, HIT_Y = 0.69; // how far above or below the barrel's center the ball can be and still be hit
const BAT = { L: 2.75, s0: 0.45, com: 1.65, Ipm: 3.4, rest: -100 * D2R, eUp: 48 * D2R, eFlat: -8 * D2R,
  drive: 0, damp: 0, maxW: 90, hz: 2.0, box: { x0: -3.3, x1: -1.75, y0: 0.9, y1: 4.4 }, handSpd: 160 };
const ARM = { S: [-0.85, 4.7, 50.3], R: 2.35 };
const BASES = [[45.96, 45.96], [0, 91.92], [-45.96, 45.96]];
const FIELDERS = [
  { id: 'C', home: [0, -4.4], kind: 'C', spd: 19 },
  { id: '1B', home: [40, 56], kind: 'IF', spd: 21 },
  { id: '2B', home: [22, 84], kind: 'IF', spd: 22 },
  { id: 'SS', home: [-22, 84], kind: 'IF', spd: 22 },
  { id: '3B', home: [-40, 56], kind: 'IF', spd: 21 },
  { id: 'LF', home: [-112, 180], kind: 'OF', spd: 24 },
  { id: 'LC', home: [-42, 218], kind: 'OF', spd: 25 },
  { id: 'RC', home: [42, 218], kind: 'OF', spd: 25 },
  { id: 'RF', home: [112, 180], kind: 'OF', spd: 24 },
  { id: 'P', home: [0, 47], kind: 'P', spd: 19 }, // the pitcher fields his position once the ball's in play
];
/* ---------- three builds. Small: short, strong, explosive. Normal: athletic, balanced. Heavy: big, slow, huge pop. ---------- */
const BUILDS = {
  small: { label: 'Small', power: 0.92, swing: 1.18, run: 1.22, range: 1.15 },
  normal: { label: 'Normal', power: 1.0, swing: 1.0, run: 1.0, range: 1.0 },
  heavy: { label: 'Heavy', power: 1.25, swing: 0.86, run: 0.78, range: 0.82 },
};
const LINEUP_BUILDS = ['normal', 'small', 'normal', 'heavy', 'heavy', 'normal', 'small', 'heavy', 'small'];
const FIELD_BUILDS = { C: 'heavy', '1B': 'heavy', '2B': 'small', SS: 'normal', '3B': 'normal', LF: 'normal', LC: 'small', RC: 'normal', RF: 'heavy', P: 'normal' };
function batterBuild() {
  if (!S) return 'normal';
  if ((S.mode === 'derby' || S.mode === 'cpu') && humanBats() && S.myBuild) return S.myBuild;
  const t = battingTeam(), slot = ((S.order && S.order[t]) || 0) % 9;
  return LINEUP_BUILDS[(slot + t * 4) % 9];
}
const BB = () => BUILDS[(S && S.bb) || 'normal'];
const FIELD_NAME = { C: 'catcher', '1B': 'first', '2B': 'second', SS: 'short', '3B': 'third', LF: 'left', LC: 'left-center', RC: 'right-center', RF: 'right', P: 'the pitcher' };
const UI = (typeof window !== 'undefined' && window.UIHooks) || { banner() {}, sound() {}, spark() {}, shake() {} };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const hyp = (x, z) => Math.hypot(x, z);
const fairAt = (x, z) => z > 0 && Math.abs(x) <= z;
/* how the ground plays: grass is quick (keeps its speed off the bounce, rolls far), dirt is a bit slower */
const SURF = { grass: { keep: 0.92, up: 0.4, roll: 0.5 }, dirt: { keep: 0.85, up: 0.35, roll: 1.0 } };
function surfAt(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(x, z);
  const dirt = (r < 80 && Math.abs(a) < 52 * D2R) || Math.hypot(x, z - 0.5) < 13 || (r > FENCE_R - 13 && r < FENCE_R && Math.abs(a) < 45 * D2R);
  return dirt ? SURF.dirt : SURF.grass;
}

let S = null;
const PRACTICE = m => m === 'derby' || m === 'bullpen' || m === 'targets' || m === 'rogue';
function teamName(t) { return S.mode === 'online' ? (t === S.mySeat ? 'YOU' : 'RIVAL') : (t === 0 ? 'YOU' : 'CPU'); }
function battingTeam() { return S.half; }
function fieldingTeam() { return 1 - S.half; }
function mySeat() { return S.mode === 'online' ? S.mySeat : 0; }
function humanPitches() { return S.mode === 'bullpen' ? true : S.mode === 'derby' ? false : fieldingTeam() === mySeat(); }
function humanBats() { return S.mode === 'derby' ? true : S.mode === 'bullpen' ? false : battingTeam() === mySeat(); }
/* Home Run Derby batting practice: a hittable strike every time */
function derbyPitch() { return computeLob((Math.random() - 0.5) * 0.7, -0.5 + Math.random() * 1.2, 8.4 + Math.random() * 2.2, [3, 0, 0]); }

function newGame(mode, innings, seat = 0, gid = null, started = 0) {
  S = {
    mode, innings, mySeat: seat, gid: gid || Math.random().toString(36).slice(2, 10), started: started || Date.now(), seq: 0, inning: 1, half: 0, outs: 0, balls: 0, strikes: 0,
    bases: [0, 0, 0], score: [0, 0], hits: [0, 0], line: [[0], []], order: [0, 0],
    over: false, halfDone: false, lastMph: null, walkoff: false,
    phase: 'idle', timer: 0, tReal: 0, t: 0, ts: TS_PITCH,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, trail: [],
    arm: { a: 100 * D2R, w: 0 },
    bat: { phi: BAT.rest, w: 0, e: BAT.eUp, hx: -2.6, hy: 3.9, hz: 2, hvx: 0, hvy: 0, hvz: 0, ax: 0, tx: -2.6, ty: 3.9, bx: STANCE.x, bz: STANCE.z },
    fielders: FIELDERS.map(f => { const b = FIELD_BUILDS[f.id], sp = f.spd * BUILDS[b].range; return { ...f, base: f.home, build: b, spd: sp, x: f.home[0], z: f.home[1], run: 0 }; }),
    holding: false, handoff: null, mark: null,
  };
  Object.assign(MODS, { hitR: 1, power: 1, ts: 1, grav: 1 });
  if (UI.newGame) UI.newGame();
  resetPitch();
}

function resetPitch() {
  const b = S.ball;
  Object.assign(b, { vx: 0, vy: 0, vz: 0, ax: 0, spin: [0, 0, 0], held: undefined, thrown: null });
  S.trail = [];
  S.inHand = true; S.contacted = false; S.caughtByCatcher = false; S.swung = false;
  S.atPlate = null; S.atBat = null; S.contactInfo = null; S.land = null; S.apex = 0; S.t = 0; S.tReal = 0; S.ts = TS_PITCH * MODS.ts;
  S.knocked = false; S.knuckSeed = Math.random() * 6.28;
  if (!humanPitches()) S.lean = 0;
  S.cpuPlan = null; S.batted = null; S.mark = null; S.replay = null; S.rec = []; S.contactRec = null; S.hideBall = false;
  S.arm.a = -90 * D2R; S.arm.w = 0; S.oppStride = 0; S.strideNow = 0; resetHand();
  const bt = S.bat;
  bt.w = 0; bt.ax = 0; bt.swinging = false; bt.u = 0; bt.reach = 0;
  if (!humanBats()) { bt.phi = BAT.rest; bt.e = BAT.eUp; bt.hy = 3.9; bt.bx = STANCE.x; bt.bz = STANCE.z; placeHands(bt); }
  const h = handWorld(); b.x = h[0]; b.y = h[1]; b.z = h[2];
  S.bb = batterBuild();
  // the defense shades deep for a big hitter and creeps in for a small one
  const depth = S.bb === 'heavy' ? 1 : S.bb === 'small' ? -1 : 0;
  S.fielders.forEach(f => {
    const [bx, bz] = f.base, r = hyp(bx, bz), k = f.kind === 'OF' ? 1 + 0.08 * depth : f.kind === 'IF' ? (r + 4 * depth) / r : 1;
    f.home = [bx * k, bz * k]; f.x = f.home[0]; f.z = f.home[1]; f.run = 0; f.plan = null; f.threwAt = undefined; f.jump = 0;
  });
}

function handPos() {
  if (S.freeHand) return pendHand();
  const h = armHandAt(S.arm.a), st = S.strideNow || 0, lat = S.hold ? S.hold.lat : 0; // the arm rides along with the stride
  const lean = S.lean || 0; // A/D: the pitcher leans left (+x, toward first) or right, and lets go from out there
  return [h[0] - lat + LEAN.x * lean, h[1] - 0.25 * st - LEAN.drop * Math.abs(lean), h[2] - 1.4 * st];
}
function batDir(phi, e) { const ce = Math.cos(e); return [ce * Math.cos(phi), Math.sin(e), ce * Math.sin(phi)]; }

/* ---------- pitching: aim a spot, pull back, flick to throw ---------- */
// Arm angle lives in the (z, y) plane around the shoulder: -90 deg is straight down. The windup
// rotates it to -270 (up over the head) and the throw carries on round to the release near -450.
const ARM_DOWN = -90 * D2R, ARM_TOP = -270 * D2R, ARM_RELEASE = -450 * D2R;
function armHandAt(a) { const [sx, sy, sz] = ARM.S; return [sx, sy + Math.sin(a) * ARM.R, sz + Math.cos(a) * ARM.R]; }
/* Build the exact launch for a pitch that should finish at (tx, th) on the plate, curving brk feet sideways on the way. */
function launchExact(P) {
  const b = S.ball;
  b.x = P.p[0]; b.y = P.p[1]; b.z = P.p[2];
  b.vx = P.v[0]; b.vy = P.v[1]; b.vz = P.v[2]; b.ax = P.ax || 0; b.spin = P.spin ? [...P.spin] : [0, 0, 0]; b.mx = 1; b.kn = P.kn || 0; b.kp = P.kp || 0;
  S.inHand = false; S.lastMph = P.mph; S.lastPitch = P; S.freeHand = false;
}

/* ---------- ball flight: gravity, air drag and spin (Magnus) ---------- */
const KM = 0.0045; // Magnus strength: extra acceleration per (rad/s of spin x ft/s of speed)
/* knuckleball: almost no spin, so the seams catch the air unevenly and it wobbles side to side and dips on the way in.
   The wobble is fixed by the pitch's own seed (kp) and where the ball is (z), so both screens see the same flutter. */
const KNUCK = { side: 5.5, drop: 3.2, f1: 0.33, f2: 0.47, slow: 0.86 };
function ballAccel(b) {
  const sp = Math.hypot(b.vx, b.vy, b.vz), s = b.spin || [0, 0, 0], w = b.noWind ? 0 : 1, mx = b.mx || 1;
  let fx = 0, fy = 0;
  if (b.kn && !b.noKnuck && b.z > 1) { const ph = b.kp || 0; fx = KNUCK.side * b.kn * Math.sin(b.z * KNUCK.f1 + ph) * mx; fy = KNUCK.drop * b.kn * Math.sin(b.z * KNUCK.f2 + ph * 1.7); }
  return [
    -DRAG * sp * b.vx + KM * (s[1] * b.vz - s[2] * b.vy) + (b.ax || 0) + WIND.x * w * mx + fx,
    -G * MODS.grav - DRAG * sp * b.vy + KM * (s[2] * b.vx - s[0] * b.vz) + fy,
    -DRAG * sp * b.vz + KM * (s[0] * b.vy - s[1] * b.vx) + WIND.z * w,
  ];
}
/* lefties: everything a pitcher or batter does is worked out as a right-hander, then mirrored across the middle of the field */
function mirrorPitch(P) { return P && { ...P, p: [-P.p[0], P.p[1], P.p[2]], v: [-P.v[0], P.v[1], P.v[2]], spin: [P.spin[0], -P.spin[1], -P.spin[2]], ax: -(P.ax || 0), curve: -(P.curve || 0) }; }
function mirrorBallState(b) { b.x = -b.x; b.vx = -b.vx; if (b.spin) b.spin = [b.spin[0], -b.spin[1], -b.spin[2]]; if (b.ax) b.ax = -b.ax; b.mx = -(b.mx || 1); }
function cpuBatsAt(slot) { return [2, 5, 7].includes(slot % 9) ? 'L' : 'R'; } // the CPU lineup has three lefties
function throwsOf(t) { return t === mySeat() && S.mode !== 'derby' ? (S.myThrows || 'R') : (S.oppThrows || 'R'); }
function batsOf(t) {
  if (t === mySeat() && S.mode !== 'bullpen') return S.myBats || 'R';
  if (S.mode === 'online') return S.oppBats || 'R';
  return cpuBatsAt((S.order && S.order[t]) || 0);
}
const pitMirror = () => !!S && throwsOf(fieldingTeam()) === 'L';
const batMirror = () => !!S && batsOf(battingTeam()) === 'L';
function knuckleize(P, seed, keep) { // turn a lob into a knuckler: slower, nearly no spin, a wobble of its own
  const k = KNUCK.slow;
  const Q = { ...P, v: [P.v[0] * k, P.v[1], P.v[2] * k], spin: [0.4, 0, 0], kn: 1, kp: seed ?? Math.random() * 6.28, mph: Math.round((P.mph || 0) * k) };
  if (keep) { // the CPU: still aim it at the same spot (more loft makes up for less speed)
    const T = simLanding(P.p, P.v, P.spin, true);
    for (let i = 0; T && i < 8; i++) { const r = simLanding(Q.p, Q.v, Q.spin, true); if (!r) break; Q.v[1] *= 1 + 0.03 * clamp(r.z - T.z, -5, 5); Q.v[0] += (T.x - r.x) / r.t; }
  }
  return Q;
}
/* Fly a pitch (no bat, no ground) until it reaches depth zEnd. */
function simPitch(p, v, spin, zEnd = PLATE_Z) {
  const b = { x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], spin };
  const dt = 1 / 240;
  for (let t = 0; t < 4; t += dt) {
    const a = ballAccel(b);
    b.vx += a[0] * dt; b.vy += a[1] * dt; b.vz += a[2] * dt;
    const zp = b.z; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (zp > zEnd && b.z <= zEnd) { const k = (zp - zEnd) / (zp - b.z); return { t: t + dt * k, x: b.x - b.vx * dt * (1 - k), y: b.y - b.vy * dt * (1 - k) }; }
    if (b.vz >= 0) return null;
  }
  return null;
}
/* Fly a pitch until it first touches the ground: where, when, and how high it peaked. */
function simLanding(p, v, spin, noWind = false, kn = 0, kp = 0) { // noWind: where it would land on a still day with no flutter (the pitcher has to allow for the wind)
  const b = { x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], spin, noWind, kn, kp, noKnuck: noWind };
  const dt = 1 / 240; let apex = b.y;
  for (let t = 0; t < 6; t += dt) {
    const a = ballAccel(b);
    b.vx += a[0] * dt; b.vy += a[1] * dt; b.vz += a[2] * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    apex = Math.max(apex, b.y);
    if (b.y <= BALL_R && b.vy < 0) return { x: b.x, z: b.z, t, apex };
  }
  return null;
}
/* CPU: find the lob that peaks near `apex` and lands at (tx, tz). */
function computeLob(tx, tz, apex, spin = [0, 0, 0]) {
  const releaseA = -135 * D2R; // slowpitch: let go out front on the way up, after the stride
  const p0 = armHandAt(releaseA), p = [p0[0], p0[1] - 0.25, p0[2] - 1.4];
  const vy = Math.sqrt(2 * G * Math.max(0.5, apex - p[1]));
  const tUp = vy / G, tDown = Math.sqrt(2 * Math.max(0.1, apex - BALL_R) / G), T = tUp + tDown;
  const v = [(tx - p[0]) / T, vy, (tz - p[2]) / T];
  for (let k = 0; k < 6; k++) { const r = simLanding(p, v, spin, true); /* the CPU aims as if it were calm: the wind pushes its pitches too */ if (!r) break; v[0] += (tx - r.x) / r.t; v[2] += (tz - r.z) / r.t; }
  return { p, releaseA, v, spin, ax: 0, mph: Math.round(Math.hypot(...v) * 0.6818) };
}
function cpuPickPitch() {
  // behind in the count: throw strikes. Ahead: work the edges and try to get a chase.
  const behind = S.balls >= 2 && S.balls > S.strikes, ahead = S.strikes === 2 && S.balls < 2;
  const onTarget = Math.random() < (behind ? 0.85 : ahead ? 0.5 : 0.66);
  const edge = ahead && onTarget, side = Math.random() < 0.5 ? -1 : 1;
  const tx = edge ? side * (0.45 + Math.random() * 0.25) : onTarget ? (Math.random() * 2 - 1) * 0.6 : side * (0.9 + Math.random() * 0.8);
  // a hittable strike comes down on the back half of the board, over the plate; misses sail past it or drop short of it
  const tz = onTarget ? -0.4 + Math.random() * 1.8 : (Math.random() < 0.6 ? MAT.z0 - 0.3 - Math.random() * 1.4 : MAT.z1 + 0.3 + Math.random() * 1.2);
  const apex = Math.random() < 0.9 ? 6 + Math.random() * 8.5 : (Math.random() < 0.5 ? 4.2 : 17.2);
  const r = Math.random(), spin = r < 0.35 ? [-(6 + Math.random() * 10), 0, 0] : r < 0.55 ? [0, (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8), 0] : [0, 0, 0];
  return computeLob(tx, tz, apex, spin);
}

/* ---------- my pitcher: the arm throws it. While you hold the ball the arm follows the mouse with a little
   weight: up/down swings it back and through, left/right moves the hand out to the side (so it isn't on one line).
   Let go whenever: the pitch takes its speed from how fast the arm is really swinging (smoothed over the last
   ~0.1 s so small jitters don't matter), its arc from where in the swing you let go, and its aim from the hand. ---------- */
const FLICK = { stride: 1.4, releaseA: -125 * D2R };
const LEAN = { x: 1.1, drop: 0.25, yaw: 0.024 };   // how far a full lean moves the hand, and how much it angles the pitch back across
const CURVE = { k: 2.6, max: 12 };                   // sweeping the mouse sideways as you let go: sidespin per ft/s of sweep (about 3 ft of break at full)
const ARMC = { kp: 420, kd: 38, amax: 1100, latMax: 0.9, speedMid: 41.5, speedSpread: 8, handMid: 18, handSoft: 11, minHand: 10 };
const YAW0 = (() => { const h = armHandAt(-115 * D2R); return Math.atan2(-h[0], h[2] - FLICK.stride - PLATE_Z); })();
const PFWD = [Math.sin(YAW0), 0, -Math.cos(YAW0)];
function resetHand() { S.pend = null; S.freeHand = false; S.yaw = YAW0; S.hold = { lat: 0, latv: 0, hist: [] }; }
function shoulderNow() { return ARM.S; }
function pendHand() { return handPos(); }
function handWorld() { const h = handPos(); return pitMirror() ? [-h[0], h[1], h[2]] : h; } // where the ball really is in a lefty's hand
/* aT: arm angle the mouse asks for; latT: sideways hand offset it asks for (ft) */
function stepHoldArm(dt, aT, latT = 0) {
  const a = S.arm, h = S.hold || (S.hold = { lat: 0, latv: 0, hist: [] });
  const acc = clamp(ARMC.kp * (aT - a.a) - ARMC.kd * a.w, -ARMC.amax, ARMC.amax);
  a.w += acc * dt; a.a = clamp(a.a + a.w * dt, -160 * D2R, -15 * D2R);
  const la = 260 * (clamp(latT, -ARMC.latMax, ARMC.latMax) - h.lat) - 30 * h.latv; h.latv += la * dt; h.lat += h.latv * dt;
  h.hist.push([a.w, h.latv]); if (h.hist.length > 6) h.hist.shift(); // ~0.1 s of swing at 60 fps
  // the stride: once the arm is really coming through past the hip
  if (a.w < -4 && a.a < -80 * D2R) S.oppStride = Math.min(1, (S.oppStride || 0) + dt * 7);
}
function pitchFromArm() {
  const h = S.hold; if (!h || !h.hist.length) return null;
  const w = h.hist.reduce((m, x) => m + x[0], 0) / h.hist.length, latv = h.hist.reduce((m, x) => m + x[1], 0) / h.hist.length;
  const hand = -w * ARM.R; // hand speed along the swing, ft/s (+ = coming forward)
  if (hand < ARMC.minHand) return null;
  // a soft curve around a normal slowpitch speed: harder swings still go farther, but they can't run away
  const speed = ARMC.speedMid + ARMC.speedSpread * Math.tanh((hand - ARMC.handMid) / ARMC.handSoft);
  const past = -90 - S.arm.a / D2R; // degrees past the bottom of the swing
  const elev = clamp(36 + 0.35 * past, 28, 52) * D2R; // later release = a bit more arc, within a sane range
  const yaw = YAW0 - h.lat * 0.035 - latv * 0.004 - (S.lean || 0) * LEAN.yaw; // from a lean, it comes back across on an angle
  const f = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const v = [f[0] * speed * Math.cos(elev), speed * Math.sin(elev), f[2] * speed * Math.cos(elev)];
  // the curve: whichever way the hand is sweeping as you let go, the ball breaks that way
  // (hand moving toward -x (latv > 0) needs +y sidespin: the Magnus push is spin x velocity, and the ball travels toward -z)
  const curve = clamp(latv * CURVE.k, -CURVE.max, CURVE.max);
  let P = { p: handPos(), v, spin: [4, curve, 0], ax: 0, releaseA: S.arm.a, mph: Math.round(speed * 0.6818), speed, curve: curve / CURVE.max, lean: S.lean || 0 };
  if (S.knuck) P = knuckleize(P, S.knuckSeed);
  return pitMirror() ? mirrorPitch(P) : P;
}
/* ---------- the bat: hands follow the mouse, bat is a pendulum hanging off the hands ---------- */
/* The bat is a weighted object pulled toward where the mouse says it should be (a stiff spring with damping
   and a strength limit), so it lags, carries momentum and overshoots a little. Mouse left/right sweeps it,
   up/down sets the height. How fast you sweep is how fast it moves. */
const BAT_PD = { kp: 8000, kd: 178, amax: 15000 }; // stiff: the bat tracks the mouse almost exactly
function batElev(phi) {
  // nearly level through the zone, so the barrel is where your hands say
  const plane = clamp(-3 * D2R + phi * 0.12, -10 * D2R, 12 * D2R), k = clamp((phi + 75 * D2R) / (45 * D2R), 0, 1), s = k * k * (3 - 2 * k);
  return 72 * D2R + (plane - 72 * D2R) * s;
}
const SWEEP = { lo: -150 * D2R, hi: 135 * D2R };
/* The swing is a body turn: the hands ride around the batter's spine, just in front of the chest, and the bat
   points outward from the hands, so it never passes through the body or arms. */
const STANCE = { x: -2.75, z: 2.0, rh: 1.25, lag: 10 * D2R, box: { x0: -3.5, x1: -2.25, z0: -0.6, z1: 3.6 }, walk: 1.6 };
function handsAt(bt, phi) { const a = phi - STANCE.lag, rh = STANCE.rh + (bt.reach || 0); return [bt.bx + Math.cos(a) * rh, bt.bz + Math.sin(a) * rh]; }
function placeHands(bt) { const [x, z] = handsAt(bt, bt.phi); bt.hx = x; bt.hz = z; }
/* step the batter around the box (dx: toward the plate, dz: toward the pitcher), slowly */
function walkBatter(dt, dx, dz) {
  const bt = S.bat, m = STANCE.walk * dt;
  bt.bx = clamp(bt.bx + dx * m, STANCE.box.x0, STANCE.box.x1);
  bt.bz = clamp(bt.bz + dz * m, STANCE.box.z0, STANCE.box.z1);
}
function moveHands(dt) {
  const bt = S.bat, m = BAT.handSpd * dt;
  const ty = clamp(bt.ty, BAT.box.y0, BAT.box.y1);
  const ny = bt.hy + clamp(ty - bt.hy, -m, m);
  bt.hvy = (ny - bt.hy) / dt;
  const from = [bt.hx, bt.hy];
  bt.hy = ny;
  return from;
}
function stepBatPhys(h) {
  const bt = S.bat;
  const tgt = bt.phiT === undefined ? BAT.rest : bt.phiT;
  const sw = BB().swing; // small hitters whip it through, heavy ones are a touch slower to get going
  const acc = clamp(BAT_PD.kp * (tgt - bt.phi) - BAT_PD.kd * bt.w, -BAT_PD.amax * sw, BAT_PD.amax * sw); // build only caps how fast it can whip
  bt.w = clamp(bt.w + acc * h, -BAT.maxW, BAT.maxW);
  bt.phi += bt.w * h;
  const [nx, nz] = handsAt(bt, bt.phi);
  bt.hvx = (nx - bt.hx) / h; bt.hvz = (nz - bt.hz) / h; bt.hx = nx; bt.hz = nz;
  // slowpitch uppercut: the swing plane tilts up toward the pitcher, matching a ball dropping in on an arc
  bt.e = batElev(bt.phi);
}
function idleBat(dt) { // human bat between pitches
  moveHands(dt);
  const N = 4; for (let i = 0; i < N; i++) stepBatPhys(dt / N);
}
function cpuBatAt(tReal) {
  const bt = S.bat, p = S.cpuPlan;
  if (!p) { bt.phi += (BAT.rest - bt.phi) * 0.1; bt.w = 0; bt.e += (BAT.eUp - bt.e) * 0.2; placeHands(bt); return; }
  bt.hy += (p.hy - bt.hy) * 0.15; bt.hvy = 0; bt.hvx = 0; bt.hvz = 0;
  if (tReal < p.t0) { bt.w = 0; bt.e += (BAT.eUp - bt.e) * 0.1; placeHands(bt); return; }
  const phi = Math.min(BAT.rest + p.w * (tReal - p.t0), 160 * D2R);
  bt.w = phi < 160 * D2R ? p.w : 0;
  bt.phi = phi;
  bt.e = batElev(bt.phi);
  const a = bt.phi - STANCE.lag; placeHands(bt);
  bt.hvx = -Math.sin(a) * STANCE.rh * bt.w; bt.hvz = Math.cos(a) * STANCE.rh * bt.w;
}
function cpuPlanSwing() { if (batMirror()) { mirrorBallState(S.ball); try { return cpuPlanSwingRaw(); } finally { mirrorBallState(S.ball); } } return cpuPlanSwingRaw(); }
function cpuPlanSwingRaw() {
  const b = S.ball, vz = -b.vz;
  const at = z => { const r = simPitch([b.x, b.y, b.z], [b.vx, b.vy, b.vz], b.spin, z) || { t: (b.z - z) / Math.max(vz, 1), x: 9, y: -9 }; return [r.t, r.x, r.y]; };
  const [, xp] = at(PLATE_Z), [tc, , yc] = at(S.bat.bz + 0.3);
  const L = simLanding([b.x, b.y, b.z], [b.vx, b.vy, b.vz], b.spin);
  const apex = Math.max(b.y, L ? L.apex : 0);
  const inZone = L && onMat(L.x * 0.8, L.z * 0.7) && apex >= ARC.lo - 0.6 && apex <= ARC.hi + 0.6;
  const reachable = yc > 1.2 && yc < 4.6 && Math.abs(xp) < 1.6;
  // count-aware: take on 3-0, protect with two strikes, otherwise swing at strikes and mostly lay off balls
  let p = inZone ? 0.88 : 0.18;
  if (S.balls === 3 && S.strikes === 0) p = inZone ? 0.3 : 0.02;
  else if (S.strikes === 2) p = inZone ? 0.98 : 0.45;
  else if (S.balls >= 2 && S.balls > S.strikes) p = inZone ? 0.95 : 0.1; // hitter's count: look for one to drive
  if (!reachable) p *= 0.3;
  if (Math.random() > p) return null;
  const w = (26 + Math.random() * 14) * BB().swing;
  const tHit = tc / S.ts + gauss() * 0.05;
  return { w, t0: tHit - (0 - BAT.rest) / w, hy: yc - Math.sin(batElev(0)) * BAT.L * 0.74 + gauss() * 0.16 };
}

/* ---------- pitch in flight, sub-stepped against the bat ---------- */
function stepFlight(dt, script) { // a lefty batter swings in his own (mirrored) frame
  if (!batMirror()) return stepFlightRaw(dt, script);
  const land0 = S.land, plate0 = S.atPlate, rec0 = S.contactRec;
  mirrorBallState(S.ball);
  const r = stepFlightRaw(dt, script);
  mirrorBallState(S.ball);
  if (S.land && S.land !== land0) S.land.x = -S.land.x;
  if (S.atPlate && S.atPlate !== plate0) S.atPlate.x = -S.atPlate.x;
  if (S.contactRec && S.contactRec !== rec0) { S.contactRec.ball.x = -S.contactRec.ball.x; S.contactRec.ball.vx = -S.contactRec.ball.vx; }
  return r;
}
function stepFlightRaw(dt, script) {
  const b = S.ball, bt = S.bat;
  const human = !script && humanBats();
  // reach: the hitter extends for an outside pitch and pulls his hands in on an inside one, so the sweet spot lines up
  // with where the ball crosses; you take care of height and timing
  if (!script && b.vz < -1) {
    const xp = b.x + b.vx * (b.z - bt.bz) / -b.vz;
    const tgt = 0.6 * clamp(xp - bt.bx - STANCE.rh - 0.74 * BAT.L * Math.cos(batElev(0)), -0.75, 0.75); // most of the way: very far inside or outside is still hard
    bt.reach = (bt.reach || 0) + (tgt - (bt.reach || 0)) * Math.min(1, dt * 7);
  }
  let from = null;
  if (human) from = moveHands(dt);
  const N = 12, h = dt / N, hs = h * S.ts;
  const toX = bt.hx, toY = bt.hy;
  for (let i = 1; i <= N; i++) {
    const zPrev = b.z, xPrev = b.x, yPrev = b.y;
    const ac = ballAccel(b); b.vx += ac[0] * hs; b.vy += ac[1] * hs; b.vz += ac[2] * hs;
    b.x += b.vx * hs; b.y += b.vy * hs; b.z += b.vz * hs;
    if (b.y < BALL_R && b.vy < 0) { b.y = BALL_R; b.vy = -b.vy * 0.35; b.vx *= 0.6; b.vz *= 0.6; b.spin = [0, 0, 0]; b.kn = 0; }
    if (zPrev > PLATE_Z && b.z <= PLATE_Z && !S.atPlate) S.atPlate = { x: b.x, y: b.y };
    const zBat = bt.bz + 0.3; // where a hitter meets it: just out in front of him
    if (zPrev > zBat && b.z <= zBat && !S.atBat) S.atBat = { phi: bt.phi, w: bt.w, ballY: b.y, barrelY: bt.hy + Math.sin(bt.e) * BAT.L * 0.74 };
    if (!S.contacted) { S.apex = Math.max(S.apex, b.y); if (!S.land && b.y <= BALL_R + 0.01) { // where it really touched down (between steps), so a ball that clips the edge counts
      const k = yPrev > b.y ? clamp((yPrev - BALL_R) / (yPrev - b.y), 0, 1) : 1;
      S.land = { x: xPrev + (b.x - xPrev) * k, z: zPrev + (b.z - zPrev) * k }; if (!S.knocked) { S.knocked = true; UI.sound(onMat(S.land.x, S.land.z) ? 'knock' : 'thud'); } } }
    if (human) {
      bt.hy = from[1] + (toY - from[1]) * i / N;
      stepBatPhys(h);
    } else (script || cpuBatAt)(S.tReal + i * h);
    if (!S.contacted && Math.abs(bt.w) > 14 && b.z < 8 && b.z > -1) S.swung = true;
    if (!S.contacted && !S.replay && b.z > -1.5 && tryContact()) { S.t += i * hs; S.tReal += i * h; S.contactRec = { t: S.tReal, ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz } }; return 'contact'; }
    if (!S.contacted && b.z <= -3.4 && b.y > 0.1 && b.y < 5 && Math.abs(b.x) < 3.5 && !S.caughtByCatcher) {
      S.caughtByCatcher = true; b.z = -3.4; b.vx = b.vy = b.vz = 0; b.y = clamp(b.y, 0.6, 4.5);
      UI.sound('mitt');
    }
    if (S.caughtByCatcher) break;
  }
  S.t += dt * S.ts; S.tReal += dt;
  if (S.caughtByCatcher || b.z < -9 || S.t > 4.5 || (S.land && Math.hypot(b.vx, b.vz) < 3)) return 'done';
  return null;
}

function tryContact() {
  const b = S.ball, bt = S.bat;
  const d = batDir(bt.phi, bt.e);
  const rx = b.x - bt.hx, ry = b.y - bt.hy, rz = b.z - bt.hz;
  const s = clamp(rx * d[0] + ry * d[1] + rz * d[2], BAT.s0, BAT.L);
  const c = [bt.hx + d[0] * s, bt.hy + d[1] * s, bt.hz + d[2] * s];
  let n = [b.x - c[0], b.y - c[1], b.z - c[2]];
  const dist = Math.hypot(...n);
  // swinging out of your shoes costs control: the harder the swing, the smaller the window you can square it up in
  const ctl = 1 - 0.4 * clamp((Math.abs(bt.w) - 28) / 30, 0, 1), hr = HIT_R * ctl * MODS.hitR, hyW = HIT_Y * ctl * MODS.hitR;
  if ((n[0] ** 2 + n[2] ** 2) / hr ** 2 + n[1] ** 2 / hyW ** 2 > 1) return false;
  if (dist < 1e-4) n = [0, 1, 0]; else n = n.map(v => v / dist);
  const ce = Math.cos(bt.e);
  const HV = 0.45; // only part of the body turn's speed reaches the barrel (the rest is in the wrists' lag)
  const vb = [HV * bt.hvx + s * bt.w * -ce * Math.sin(bt.phi), bt.hvy, HV * (bt.hvz || 0) + s * bt.w * ce * Math.cos(bt.phi)];
  const rv = [b.vx - vb[0], b.vy - vb[1], b.vz - vb[2]];
  const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
  if (vn >= 0) return false;
  const q = s / BAT.L;
  const e = 0.40 + 0.16 * Math.exp(-((q - 0.74) ** 2) / 0.018);
  const out = [0, 1, 2].map(k => vb[k] - e * vn * n[k] + (rv[k] - vn * n[k]) * 0.85);
  const sp = Math.hypot(...out);
  // square it up for full power; catch the top of the ball and it's chopped into the dirt, the bottom and it's popped up
  // how far above or below the barrel's center the ball's path runs (its closest pass relative to the moving bat),
  // not where it first touched: a dropping ball always touches the top edge first
  const ov = [b.x - c[0], b.y - c[1], b.z - c[2]], rl = Math.hypot(...rv) || 1, ru = rv.map(v => v / rl), od = ov[0] * ru[0] + ov[1] * ru[1] + ov[2] * ru[2];
  const off = clamp((ov[1] - od * ru[1]) / hyW, -1, 1); // -1 = ball at the bottom of the window (bat under it would be +), 0 = dead center
  const square = 1 - 0.35 * Math.pow(Math.abs(off), 1.5);
  out.forEach((v, k) => out[k] = v * square);
  S.contactInfo = { phi: bt.phi, off };
  const pw = BB().power * MODS.power; // the heavy build hits it harder, the small build a bit softer
  out.forEach((v, k) => out[k] = v * pw);
  const sp3 = Math.hypot(...out), cap = 160 * Math.sqrt(pw) * (MODS.power > 1 ? 1.04 : 1);
  if (sp3 > cap) out.forEach((v, k) => out[k] = v * cap / sp3);
  // playability: real timing windows are a few milliseconds, so pull spray and launch angles toward the middle
  {
    const hS = Math.hypot(out[0], out[2]), sp2 = Math.hypot(...out);
    // direction comes from the bat's angle when it meets the ball, like a real swing: the ball leaves square off the face.
    // Square to the pitcher (in front of the plate) goes up the middle; out in front (early) is pulled to left; deep (late) goes to right.
    // (the hitting zone is only a few inches deep, so small differences in that angle are spread out to the whole field)
    const spray = clamp(-(bt.phi - 12 * D2R) * 2.2, -110 * D2R, 110 * D2R);
    // launch angle comes mostly from where on the barrel you met it: dead center is a line drive, under it a pop-up, on top a grounder
    const la = clamp(16 * D2R + off * 30 * D2R + Math.atan2(out[1], hS) * 0.1, -12 * D2R, 58 * D2R); // a range of line drives, flies and grounders, not just homers and dribblers
    out[0] = sp2 * Math.cos(la) * Math.sin(spray); out[1] = sp2 * Math.sin(la); out[2] = sp2 * Math.cos(la) * Math.cos(spray);
  }
  b.vx = out[0]; b.vy = out[1]; b.vz = out[2];
  b.x = c[0] + n[0] * (HIT_R + 0.01); b.y = c[1] + n[1] * (HIT_R + 0.01); b.z = c[2] + n[2] * (HIT_R + 0.01);
  bt.w *= 0.72; // the ball pushes back on the bat
  b.spin = [0, 0, 0]; b.kn = 0;
  S.contacted = true;
  return true;
}

/* ---------- batted ball: predict, decide, animate ---------- */
function predictBatted() {
  let { x, y, z, vx, vy, vz } = S.ball;
  const speed = Math.hypot(vx, vy, vz), launchA = Math.atan2(vy, Math.hypot(vx, vz)) / D2R;
  let t = 0; const dt = 1 / 240;
  let land = null, overFence = null, wall = null; const path = [];
  let nextSample = 0;
  while (t < 9) {
    const s = Math.hypot(vx, vy, vz);
    vx -= DRAG * s * vx * dt; vy -= (G * MODS.grav + DRAG * s * vy) * dt; vz -= DRAG * s * vz * dt;
    if (y > 1) { vx += WIND.x * dt; vz += WIND.z * dt; } // the wind carries a ball in the air
    const rPrev = hyp(x, z);
    x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
    const r = hyp(x, z);
    if (rPrev < FENCE_R && r >= FENCE_R && fairAt(x, z)) {
      if (y > FENCE_H && !land) { overFence = { t, x, z, y }; break; }
      wall = wall || { t, x, z };
      const nx = x / r, nz = z / r, vr = vx * nx + vz * nz;
      vx -= 1.3 * vr * nx; vz -= 1.3 * vr * nz; x = nx * (FENCE_R - 0.3); z = nz * (FENCE_R - 0.3);
    }
    if (y <= BALL_R && vy < 0) {
      y = BALL_R;
      if (!land) land = { t, x, z };
      const sf = surfAt(x, z), wet = FIELD.wet;
      if (vy < -4) { vy = -vy * sf.up * (1 - 0.3 * wet); vx *= sf.keep * (1 - 0.12 * wet); vz *= sf.keep * (1 - 0.12 * wet); } // a wet field: dead bounces
      else { vy = 0; const f = Math.max(0, 1 - sf.roll * (1 + 1.5 * wet) * dt); vx *= f; vz *= f; }
    }
    if (t >= nextSample) { path.push({ t, x, y, z }); nextSample += 1 / 30; }
    if (land && Math.hypot(vx, vz) < 1.5) break;
    if (land && t - land.t > 5) break;
  }
  path.push({ t, x, y, z });
  return { land, overFence, wall, path, speed, launchA, vz0: S.ball.vz, rest: { x, z, t } };
}

function decideFair(p) {
  if (p.vz0 <= 0.3) return false;
  if (p.overFence) return true;
  if (!p.land) return false;
  const ld = hyp(p.land.x, p.land.z);
  if (ld > 62) return fairAt(p.land.x, p.land.z);
  for (const q of p.path) {
    if (q.t < p.land.t) continue;
    const d = hyp(q.x, q.z);
    if (d >= 62) return fairAt(q.x, q.z);
    if (!fairAt(q.x, q.z) && d > 3) return false;
  }
  return fairAt(p.rest.x, p.rest.z);
}

function decideOutcome(p) {
  const fair = decideFair(p);
  const air = p.land && p.launchA >= 10 && hyp(p.land.x, p.land.z) >= 30;
  if (!fair) {
    if (false && p.land && p.land.t > 1.6 && p.speed > 24) { // no foul outs: a foul is only ever a foul ball
      for (const i of [0, 1, 4]) {
        const f = S.fielders[i];
        const reach = f.spd * (p.land.t - 0.4);
        if (hyp(p.land.x - f.x, p.land.z - f.z) < reach && p.land.z > -28) return { type: 'out', how: 'air', fielder: i, msg: 'Foul out', T: p.land.t, at: p.land };
      }
    }
    return { type: 'foul' };
  }
  if (p.speed < 18) return { type: 'foul' };
  if (p.overFence) {
    // can an outfielder get back to the wall in time and leap for it?
    const of = p.overFence, ang = Math.atan2(of.x, of.z), spot = [Math.sin(ang) * (FENCE_R - 1.2), Math.cos(ang) * (FENCE_R - 1.2)];
    let best = -1, slack = -Infinity;
    S.fielders.forEach((f, i) => { if (f.kind !== 'OF') return; const s = of.t - 0.45 / BUILDS[f.build].range - hyp(spot[0] - f.x, spot[1] - f.z) / f.spd; if (s > slack) { slack = s; best = i; } });
    const over = of.y - FENCE_H; // how far above the top of the wall it went
    if (best >= 0 && slack > 0) {
      const f = S.fielders[best], reachUp = 2.6 * BUILDS[f.build].range; // a small, springy fielder gets up higher
      const chance = over < reachUp ? clamp(0.75 - over / reachUp * 0.45 + Math.min(slack, 1) * 0.15, 0, 0.85) : 0;
      if (Math.random() < chance) return { type: 'out', how: 'air', fielder: best, msg: 'Home run robbed!', T: of.t, at: { x: spot[0], z: spot[1] }, deep: true, robbed: true, leap: clamp(of.y - 6.9, 1, 5) };
      if (over < 7) return { type: 'hr', leaper: best, leap: clamp(of.y - 7.5, 1, 4.5), spot }; // he goes up for it and comes down empty
    }
    return { type: 'hr' };
  }
  if (air && p.wall && (!p.land || p.wall.t < p.land.t)) return hitByRetrieval(p, p.land || { t: p.wall.t + 0.6, x: p.wall.x * 0.94, z: p.wall.z * 0.94 });
  if (air) {
    let best = -1, bm = 0;
    S.fielders.forEach((f, i) => {
      if (f.kind === 'C') return;
      const react = (0.35 + Math.random() * 0.25) / BUILDS[f.build].range;
      const reach = f.spd * (p.land.t - react);
      const m = hyp(p.land.x - f.x, p.land.z - f.z) - reach;
      if (m < bm) { bm = m; best = i; }
    });
    if (best >= 0) {
      const msg = p.launchA > 52 ? 'Popped out' : p.launchA < 18 ? 'Lined out' : 'Flied out';
      return { type: 'out', how: 'air', fielder: best, msg: `${msg} to ${FIELD_NAME[S.fielders[best].id]}`, T: p.land.t, at: p.land, deep: hyp(p.land.x, p.land.z) > 140 };
    }
    return hitByRetrieval(p, p.land);
  }
  // ground ball: can an infielder get in front of it?
  let ib = -1, it = Infinity, ip = null;
  S.fielders.forEach((f, i) => {
    if (f.kind !== 'IF' && f.kind !== 'P') return;
    const isP = f.kind === 'P'; // the pitcher only gets comebackers: right at him, after he's finished his follow-through
    for (const q of p.path) {
      if (q.t < 0.15 || q.y > 3.5) continue;
      if (isP && hyp(q.x - f.x, q.z - f.z) > 5) continue;
      const need = hyp(q.x - f.x, q.z - f.z) / f.spd + (isP ? 0.45 : 0.25);
      if (need <= q.t) { if (q.t < it) { it = q.t; ib = i; ip = q; } break; }
    }
  });
  if (ib >= 0) {
    const throwT = hyp(ip.x - BASES[0][0], ip.z - BASES[0][1]) / 90 + 0.4;
    const toFirst = 3.3 / BB().run; // small hitters fly down the line, heavy ones lumber
    if (it + throwT < toFirst) {
      // double play: flip to second, relay to first, and still beat the runner
      const dpT = hyp(ip.x - BASES[1][0], ip.z - BASES[1][1]) / 90 + 0.35 + hyp(BASES[1][0] - BASES[0][0], BASES[1][1] - BASES[0][1]) / 95 + 0.3;
      const dp = S.bases[0] && S.outs < 2 && it + dpT < toFirst + 0.4;
      return { type: 'out', how: 'ground', fielder: ib, at: ip, T: it, throwT, dp, msg: dp ? 'Double play' : `Grounded out to ${FIELD_NAME[S.fielders[ib].id]}` };
    }
    return { type: 'single', how: 'ground', fielder: ib, at: ip, T: it, throwT, note: 'Infield hit, beat the throw' };
  }
  const last = p.path[p.path.length - 1];
  return hitByRetrieval(p, { t: 1.2, x: last.x * 0.6, z: last.z * 0.6 }, 'Through the infield');
}
function hitByRetrieval(p, at, note) {
  let tr = Infinity;
  S.fielders.forEach(f => { if (f.kind === 'OF') tr = Math.min(tr, Math.max(at.t + 0.5, hyp(at.x - f.x, at.z - f.z) / f.spd + 0.35)); });
  if (p.wall) tr = Math.max(tr, p.wall.t + 1.0);
  const total = (tr + hyp(at.x - BASES[1][0], at.z - BASES[1][1]) / 100 + 0.5) * BB().run;
  const n = total < 5.0 ? 1 : total < 7.8 ? 2 : 3;
  return { type: ['single', 'double', 'triple'][n - 1], how: 'air', note: note || (p.wall ? 'Off the wall' : n === 1 ? 'Dropped in' : n === 2 ? 'Into the gap' : 'All the way to the wall'), tr };
}

function startBatted(override) {
  const pred = predictBatted();
  const tgtMode = !!(S.prac && S.prac.targets); // target practice: nobody fields it, it just flies
  const out = override || (tgtMode ? { type: 'target' } : decideOutcome(pred));
  S.batted = { t: 0, pred, out, startBall: { ...S.ball }, bases0: [...S.bases], outs0: S.outs };
  S.phase = 'batted';
  const F = S.fielders;
  if (!tgtMode) planDefense(out, pred);
  // when to call it
  const T = pred.land ? pred.land.t : 2;
  S.batted.resolveAt =
    tgtMode ? clamp(pred.overFence ? pred.overFence.t + 1.2 : (pred.land ? pred.land.t + 0.4 : 2), 1.2, 4.6) :
    out.type === 'foul' ? 1.3 :
    out.type === 'hr' ? Math.min(pred.overFence.t + 1.4, 4.6) :
    out.type === 'out' && out.how === 'air' ? out.T + 0.6 :
    out.how === 'ground' && out.fielder !== undefined ? out.T + out.throwT + (out.dp ? 1.4 : 0.3) :
    Math.min(Math.max(T + 1.4, (out.tr || 2) + 0.4), 5.5);
  const fast = pred.speed > 115;
  UI.sound(out.type === 'foul' && pred.speed < 60 ? 'tick' : fast ? 'crack' : 'thwack');
  UI.spark(S.ball.x, S.ball.y, S.ball.z, pred.speed);
  if (fast) UI.shake(pred.speed);
}

function stepBatted(dt) {
  const bt = S.batted, b = S.ball;
  S.ts = Math.min(1, S.ts + dt * 2.2);
  const sdt = dt * S.ts;
  bt.t += sdt;
  if (b.thrown) {
    const th = b.thrown, u = clamp((bt.t - th.t0) / th.dur, 0, 1);
    b.x = th.from[0] + (th.to[0] - th.from[0]) * u; b.z = th.from[2] + (th.to[2] - th.from[2]) * u;
    b.y = th.from[1] + (th.to[1] - th.from[1]) * u + Math.sin(u * Math.PI) * th.dur * 6;
    if (u >= 1 && !th.done) {
      th.done = true; UI.sound('mitt');
      if (th.toIdx !== undefined) { // caught by the teammate; relay it on if that's his job
        const r = S.fielders[th.toIdx]; b.thrown = null; b.held = th.toIdx;
        if (r.plan && r.plan.relayTo !== undefined) { r.plan.throwToIdx = r.plan.relayTo; r.plan.throwAt = bt.t + 0.25; r.plan.relayTo = undefined; }
      }
    }
  } else if (b.held === undefined) {
    const N = 4, h = sdt / N;
    for (let i = 0; i < N; i++) {
      const s = Math.hypot(b.vx, b.vy, b.vz);
      b.vx -= DRAG * s * b.vx * h; b.vy -= (G * MODS.grav + DRAG * s * b.vy) * h; b.vz -= DRAG * s * b.vz * h;
      const rPrev = hyp(b.x, b.z);
      b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      const r = hyp(b.x, b.z);
      if (rPrev < FENCE_R && r >= FENCE_R && fairAt(b.x, b.z) && b.y <= FENCE_H) {
        const nx = b.x / r, nz = b.z / r, vr = b.vx * nx + b.vz * nz;
        b.vx -= 1.3 * vr * nx; b.vz -= 1.3 * vr * nz; b.x = nx * (FENCE_R - 0.3); b.z = nz * (FENCE_R - 0.3);
        UI.sound('wall'); UI.spark(b.x, b.y, b.z, 60); UI.shake(30);
      }
      if (b.y < BALL_R && b.vy < 0) {
        b.y = BALL_R;
        const sf = surfAt(b.x, b.z);
        if (b.vy < -4) { b.vy = -b.vy * sf.up; b.vx *= sf.keep; b.vz *= sf.keep; }
        else { b.vy = 0; const f = Math.max(0, 1 - sf.roll * h); b.vx *= f; b.vz *= f; }
      }
    }
  }
  S.fielders.forEach((f, i) => {
    const p = f.plan;
    if (p && p.chaseAfter !== undefined && bt.t >= p.chaseAfter) { p.chase = true; p.chaseAfter = undefined; }
    // a leap at the wall: up and down over about 0.7 s, peaking as the ball gets there
    f.jump = p && p.leapAt !== undefined ? Math.max(0, 1 - ((bt.t - p.leapAt) / 0.36) ** 2) * p.leapH : 0;
    if (f.jump > 0) f.face = Math.atan2(f.x, f.z); // facing the wall
    let tx = f.home[0], tz = f.home[1], spd = 8;
    if (p && bt.t >= p.at) {
      if (p.chase) { tx = b.x; tz = b.z; spd = p.spd; }
      else { tx = p.x; tz = p.z; spd = p.spd; }
    } else if (p) spd = 0;
    else spd = 0;
    const dx = tx - f.x, dz = tz - f.z, d = hyp(dx, dz);
    const step = Math.min(d, spd * sdt);
    if (d > 0.01) { f.x += dx / d * step; f.z += dz / d * step; f.face = Math.atan2(dx, dz); }
    f.run = step > 0.002 ? f.run + step : 0;
    if (b.held === undefined && !b.thrown && p) {
      if (p.holdAt !== undefined && bt.t >= p.holdAt - 0.02) { b.held = i; UI.sound('mitt'); }
      if (p.chase && d < 2 && b.y < 3 && Math.hypot(b.vx, b.vz) < 35 && bt.t > 0.5) { b.held = i; p.throwAt = bt.t + 0.45; }
    }
    if (b.held === i) {
      b.x = f.x; b.y = 3.6 + (f.jump > 0 ? f.jump + 3.3 : 0); b.z = f.z; b.vx = b.vy = b.vz = 0;
      if (p && p.throwToIdx !== undefined && p.throwAt !== undefined && bt.t >= p.throwAt) { // throw it to a teammate
        const r = S.fielders[p.throwToIdx], dist = hyp(r.x - f.x, r.z - f.z);
        b.thrown = { from: [f.x, 4.5, f.z], to: [r.x, 4, r.z], t0: bt.t, dur: Math.max(0.15, dist / 90), toIdx: p.throwToIdx, fromIdx: i };
        f.face = Math.atan2(r.x - f.x, r.z - f.z); f.threwAt = bt.t;
        b.held = undefined; p.throwToIdx = undefined;
      }
    }
  });
  if (bt.t >= bt.resolveAt) return 'done';
  return null;
}

/* ---------- the defense: who goes for the ball, who covers which base, who backs up, who cuts it off ---------- */
const FI = id => FIELDERS.findIndex(f => f.id === id);
const HOMEP = [0, -1.2];
function goTo(f, pt, at = 0.25, spdK = 1, extra = {}) { f.plan = { x: pt[0], z: pt[1], at, spd: f.spd * spdK, ...extra }; }
function planDefense(out, pred) {
  const F = S.fielders, I = { C: FI('C'), B1: FI('1B'), B2: FI('2B'), SS: FI('SS'), B3: FI('3B'), P: FI('P') };
  const OFs = F.map((f, i) => i).filter(i => F[i].kind === 'OF');
  const land = pred.land || pred.rest, leftSide = land && land.x < 0;
  const coverBases = skip => { // everybody not on the ball heads for a bag (or backs up)
    if (!skip.has(I.B1)) goTo(F[I.B1], [BASES[0][0] - 1, BASES[0][1] - 1], 0.2);
    if (!skip.has(I.B3)) goTo(F[I.B3], [BASES[2][0] + 1, BASES[2][1] - 1], 0.25);
    const c2 = leftSide ? I.B2 : I.SS, o2 = leftSide ? I.SS : I.B2; // the middle infielder away from the ball takes second
    if (!skip.has(c2)) goTo(F[c2], [BASES[1][0] + (leftSide ? 1 : -1), BASES[1][1] - 1], 0.2);
    else if (!skip.has(o2)) goTo(F[o2], [BASES[1][0], BASES[1][1] - 1], 0.2);
    if (!skip.has(I.C)) goTo(F[I.C], HOMEP, 0.3, 0.6);
  };
  if (out.type === 'out' && out.how === 'air') {
    const f = F[out.fielder], react = 0.35 / BUILDS[f.build].range;
    f.plan = { x: out.at.x, z: out.at.z, at: react, spd: out.robbed ? f.spd * 1.15 : Math.min(f.spd * 1.15, hyp(out.at.x - f.x, out.at.z - f.z) / Math.max(0.2, out.T - react)), holdAt: out.T };
    if (out.robbed) { f.plan.leapAt = out.T; f.plan.leapH = out.leap; }
    // the nearest teammate backs him up, a few strides behind
    const d = Math.max(1, hyp(out.at.x, out.at.z)), back = [out.at.x + out.at.x / d * 22, out.at.z + out.at.z / d * 22];
    let bk = -1, bd = Infinity; F.forEach((g, i) => { if (i === out.fielder || g.kind === 'C' || g.kind === 'P') return; const dd = hyp(g.x - back[0], g.z - back[1]); if (dd < bd) { bd = dd; bk = i; } });
    if (bk >= 0 && bd < 120) goTo(F[bk], back, 0.45, 0.9);
    coverBases(new Set([out.fielder, bk]));
  } else if (out.how === 'ground' && out.fielder !== undefined) {
    const fi = out.fielder, f = F[fi];
    // first base: the first baseman takes the bag, unless he's the one fielding it; then the pitcher covers
    const recv = fi === I.B1 ? I.P : I.B1;
    goTo(F[recv], [BASES[0][0] - 1, BASES[0][1] - 0.6], 0.15, recv === I.P ? 1.15 : 1, { receiver: true });
    const skip = new Set([fi, recv]);
    if (out.dp) { // flip to whoever covers second, who relays to first
      const c2 = fi === I.SS || fi === I.B3 ? I.B2 : I.SS;
      goTo(F[c2], [BASES[1][0], BASES[1][1] - 0.8], 0.15, 1.1, { relayTo: recv }); skip.add(c2);
      f.plan = { x: out.at.x, z: out.at.z, at: 0.2, spd: Math.min(f.spd * 1.2, hyp(out.at.x - f.x, out.at.z - f.z) / Math.max(0.2, out.T - 0.2)), holdAt: out.T, throwToIdx: c2, throwAt: out.T + 0.3 };
    } else {
      f.plan = { x: out.at.x, z: out.at.z, at: 0.2, spd: Math.min(f.spd * 1.2, hyp(out.at.x - f.x, out.at.z - f.z) / Math.max(0.2, out.T - 0.2)), holdAt: out.T, throwToIdx: recv, throwAt: out.T + 0.35 };
    }
    coverBases(skip);
  } else if (out.type === 'hr') {
    const ang = Math.atan2(pred.overFence.x, pred.overFence.z), fr = FENCE_R - 1.2;
    let best = OFs[0], bd = Infinity;
    OFs.forEach(i => { const d = hyp(F[i].x - Math.sin(ang) * fr, F[i].z - Math.cos(ang) * fr); if (d < bd) { bd = d; best = i; } });
    if (out.leaper !== undefined) best = out.leaper;
    const f = F[best], react = 0.45 / BUILDS[f.build].range, tgt = [Math.sin(ang) * fr, Math.cos(ang) * fr];
    f.plan = { x: tgt[0], z: tgt[1], at: react, spd: f.spd * 1.1 };
    if (out.leaper !== undefined) { f.plan.leapAt = pred.overFence.t; f.plan.leapH = out.leap; }
  } else if (out.type !== 'foul') { // a hit: chase it, back it up, line up the cutoff, cover the bags
    const at = land;
    const byDist = OFs.slice().sort((a, b) => hyp(F[a].x - at.x, F[a].z - at.z) - hyp(F[b].x - at.x, F[b].z - at.z));
    const chaser = byDist[0], backup = byDist[1];
    const cf = F[chaser], react = 0.35 / BUILDS[cf.build].range;
    let ip = null; // the first spot along the ball's path he can get to before it does
    for (const q of pred.path) { if (q.y > 7) continue; if (react + hyp(q.x - cf.x, q.z - cf.z) / cf.spd <= q.t) { ip = q; break; } }
    if (!ip) ip = { x: pred.rest.x, z: pred.rest.z, t: pred.rest.t };
    cf.plan = { x: ip.x, z: ip.z, at: react, spd: cf.spd, chaseAfter: Math.max(react, ip.t - 0.3) };
    const d = Math.max(1, hyp(at.x, at.z));
    goTo(F[backup], [at.x + at.x / d * 25, at.z + at.z / d * 25], 0.5, 0.9);
    const cut = leftSide ? I.SS : I.B2, target = out.type === 'single' ? 1 : 2; // relay to second on a single, third on extra bases
    const cutPt = [at.x * 0.45 + BASES[1][0] * 0.55, at.z * 0.45 + BASES[1][1] * 0.55];
    goTo(F[cut], cutPt, 0.3, 1, { relayTo: target === 1 ? (leftSide ? I.B2 : I.SS) : I.B3 });
    F[chaser].plan.throwToIdx = cut;
    const skip = new Set([chaser, backup, cut]);
    coverBases(skip);
    goTo(F[I.P], target === 1 ? [BASES[1][0] * 0.4, BASES[1][1] * 0.55] : [BASES[2][0] - 8, BASES[2][1] - 12], 0.3, 0.8); // pitcher backs up the throw
  }
}

/* ---------- rules ---------- */
function addRuns(r) {
  if (!r) return;
  const t = battingTeam();
  S.score[t] += r;
  S.line[t][S.inning - 1] = (S.line[t][S.inning - 1] || 0) + r;
  if (S.half === 1 && S.inning >= S.innings && S.score[1] > S.score[0]) S.walkoff = true;
}
function advance(n) {
  let runs = 0; const nb = [0, 0, 0];
  for (let i = 2; i >= 0; i--) if (S.bases[i]) { const np = i + n; if (np >= 3) runs++; else nb[np] = 1; }
  if (n >= 4) runs++; else nb[n - 1] = 1;
  S.bases = nb;
  return runs;
}
function walk() {
  let runs = 0; const b = S.bases;
  if (b[0]) { if (b[1]) { if (b[2]) runs++; b[2] = 1; } b[1] = 1; }
  b[0] = 1;
  return runs;
}
function endPA() { S.balls = 0; S.strikes = 0; S.order = S.order || [0, 0]; S.order[battingTeam()]++; } // next batter up
function recordOut() { S.outs++; if (S.outs >= 3) S.halfDone = true; }

function applyPitchCall() {
  const L = S.land, legal = S.apex >= ARC.lo && S.apex <= ARC.hi;
  const hitMat = L && onMat(L.x, L.z);
  S.mark = L ? { x: L.x, z: L.z, strike: !!(hitMat && legal) } : null;
  const strike = S.swung || (legal && hitMat);
  const words = ['', 'one', 'two', 'three'];
  if (strike) {
    S.strikes++;
    if (S.strikes >= 3) { if (fieldingTeam() === mySeat()) S.myK = (S.myK || 0) + 1; endPA(); recordOut(); return { text: 'Strikeout', sub: S.swung ? 'swinging' : 'on the mat', size: '' }; }
    return { text: `Strike ${words[S.strikes]}`, sub: S.swung ? 'swinging' : 'on the mat', size: 'small' };
  }
  S.balls++;
  const where = !legal ? (S.apex < ARC.lo ? `illegal, too flat (${S.apex.toFixed(1)} ft arc)` : `illegal, too high (${S.apex.toFixed(1)} ft arc)`)
    : !L ? 'past the mat' : L.z > MAT.z1 ? 'short of the plate' : L.z < MAT.z0 ? 'past the mat' : L.x < 0 ? 'inside' : 'outside';
  if (S.balls >= 4) { endPA(); const r = walk(); addRuns(r); return { text: 'Walk', sub: r ? 'run forced in' : 'take your base', size: '' }; }
  return { text: `Ball ${words[S.balls]}`, sub: where, size: 'small' };
}
function hrDistance() {
  let { x, y, z, vx, vy, vz } = S.batted.startBall; let t = 0; const dt = 1 / 120;
  while (y > 0 && t < 10) { const s = Math.hypot(vx, vy, vz); vx -= DRAG * s * vx * dt; vy -= (G * MODS.grav + DRAG * s * vy) * dt; vz -= DRAG * s * vz * dt; x += vx * dt; y += vy * dt; z += vz * dt; t += dt; }
  return hyp(x, z);
}
function applyBattedOutcome(out) {
  const bt = battingTeam();
  if (out.type === 'foul') {
    if (S.strikes < 2) S.strikes++;
    return { text: 'Foul ball', sub: `${S.balls}–${S.strikes}`, size: 'small' };
  }
  endPA();
  if (out.type === 'out') {
    let sub = '';
    if (out.dp) {
      S.bases[0] = 0; recordOut(); if (!S.halfDone) recordOut();
      sub = S.halfDone ? 'side retired' : `${S.outs} out`;
    } else if (out.how === 'air' && out.deep && S.outs < 2 && S.bases[2]) { S.bases[2] = 0; recordOut(); addRuns(1); sub = 'sac fly, run scores'; }
    else recordOut();
    return { text: out.msg, sub: sub || (S.outs >= 3 ? 'side retired' : `${S.outs} out`), size: '' };
  }
  const n = { single: 1, double: 2, triple: 3, hr: 4 }[out.type];
  S.hits[bt]++;
  if (out.type === 'hr' && bt === mySeat()) S.myHR = (S.myHR || 0) + 1;
  const r = advance(n);
  addRuns(r);
  if (out.type === 'hr') return { text: r > 3 ? 'Grand slam!' : 'Home run!', sub: `${Math.round(hrDistance())} ft · ${r} run${r > 1 ? 's' : ''}`, size: 'huge' };
  return { text: out.type.charAt(0).toUpperCase() + out.type.slice(1) + '!', sub: (out.note || '') + (r ? ` · ${r} run${r > 1 ? 's' : ''}` : ''), size: '' };
}
function afterPlay() {
  if (S.walkoff) { S.over = true; return 'over'; }
  if (!S.halfDone) return 'next';
  S.halfDone = false;
  if (S.half === 0) {
    if (S.inning >= S.innings && S.score[1] > S.score[0]) { S.over = true; return 'over'; }
    S.half = 1;
  } else {
    if (S.inning >= S.innings && S.score[0] !== S.score[1]) { S.over = true; return 'over'; }
    S.inning++; S.half = 0;
  }
  S.outs = 0; S.bases = [0, 0, 0]; endPA();
  const t = battingTeam();
  if (S.line[t][S.inning - 1] === undefined) S.line[t][S.inning - 1] = 0;
  return 'half';
}

/* ---------- online: the batter's page is the referee; this is the state it hands over ---------- */
const SNAP_KEYS = ['gid', 'started', 'seq', 'innings', 'inning', 'half', 'outs', 'balls', 'strikes', 'bases', 'score', 'hits', 'line', 'over', 'walkoff', 'order'];
function snapshot() { const o = {}; SNAP_KEYS.forEach(k => o[k] = JSON.parse(JSON.stringify(S[k]))); return o; }
function adoptSnap(o) { SNAP_KEYS.forEach(k => { if (o[k] !== undefined) S[k] = JSON.parse(JSON.stringify(o[k])); }); S.halfDone = false; }
function aheadOf(o) { // is my game newer than the one described by o?
  if (!o || !o.gid) return true;
  if (o.gid !== S.gid) return S.started > o.started;
  return S.seq > o.seq;
}
