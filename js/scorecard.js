/* Scorecard engine: what each play does to the bases, outs and runs, and how each scorebook box is drawn.
   Pure functions so they can be unit-tested (tests/scorecard.test.mjs).

   A play is saved as an at-bat: { p: batter, r: play code, adv: { playerId: base }, fielders: ['SS','1B'], before, ... }
   where base is 0 = out, 1/2/3 = that base, 4 = scored. `before` is the game state before the play, so undo is exact. */

export const PLAYS = {
  '1B': { label: 'Single', hit: 1, reach: true },
  '2B': { label: 'Double', hit: 2, reach: true },
  '3B': { label: 'Triple', hit: 3, reach: true },
  HR: { label: 'Home run', hit: 4, reach: true },
  BB: { label: 'Walk', reach: true },
  E: { label: 'Error', reach: true },
  FC: { label: 'Fielder’s choice', reach: true, fielders: true },
  GO: { label: 'Groundout', out: true, fielders: true },
  FO: { label: 'Flyout', out: true, fielders: true },
  LO: { label: 'Lineout', out: true, fielders: true },
  PO: { label: 'Popout', out: true, fielders: true },
  K: { label: 'Strikeout', out: true },
  SF: { label: 'Sac fly', out: true, fielders: true },
  DP: { label: 'Double play', out: true, fielders: true },
  OUT: { label: 'Out', out: true },            // from the earlier quick scorer
};
export const REACHED = ['1B', '2B', '3B', 'HR', 'BB', 'E', 'FC'];
export const OUTS = ['GO', 'FO', 'LO', 'PO', 'K', 'SF', 'DP'];
export const isHit = r => ['1B', '2B', '3B', 'HR'].includes(r);
export const isAB = r => !['BB', 'SF'].includes(r);   // walks and sac flies aren't official at-bats

/* scorebook numbers for positions (10-player slo-pitch; OSSC's rover is 10) */
export const POS_NUM = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, LCF: 8, CF: 8, RCF: 9, RF: 10, ROV: 10 };
export function code(ab, posNum = POS_NUM) {
  const f = (ab.fielders || []).map(k => posNum[k] || k);
  switch (ab.r) {
    case 'GO': return f.length ? f.join('-') : 'GO';
    case 'FO': return 'F' + (f[0] || '');
    case 'LO': return 'L' + (f[0] || '');
    case 'PO': return 'P' + (f[0] || '');
    case 'SF': return 'SF' + (f[0] || '');
    case 'DP': return f.length ? 'DP ' + f.join('-') : 'DP';
    case 'FC': return 'FC' + (f[0] ? ' ' + f[0] : '');
    case 'E': return 'E' + (f[0] || '');
    case 'OUT': return 'Out';
    default: return ab.r;
  }
}

/* ---------- what a play usually does; the scorer can adjust before saving ---------- */
export function defaultAdvance(play, bases, batter, opts = {}) {
  const on = b => bases && bases[b];
  const adv = {};
  const move = (b, to) => { if (on(b)) adv[on(b)] = Math.min(4, to); };
  switch (play) {
    case '1B': case 'E': move(3, 4); move(2, 3); move(1, 2); adv[batter] = 1; break;      // everyone up one
    case '2B': move(3, 4); move(2, 4); move(1, 3); adv[batter] = 2; break;
    case '3B': move(3, 4); move(2, 4); move(1, 4); adv[batter] = 3; break;
    case 'HR': move(3, 4); move(2, 4); move(1, 4); adv[batter] = 4; break;
    case 'BB': {                                                                              // only forced runners move
      // OttawaSoftball: with a woman on deck the batter is awarded 2nd (walkTwo)
      let next = (opts.walkTwo ? 2 : 1) + 1;
      [1, 2, 3].forEach(b => { if (!on(b)) return; if (b < next) { adv[on(b)] = Math.min(4, next); next++; } else adv[on(b)] = b; });
      adv[batter] = opts.walkTwo ? 2 : 1; break;
    }
    case 'FC': {                                                                              // lead forced runner is out, batter safe at first
      const lead = on(1) ? 1 : on(2) ? 2 : on(3) ? 3 : null;
      [1, 2, 3].forEach(b => { if (on(b)) adv[on(b)] = b === lead ? 0 : b; });
      adv[batter] = 1; break;
    }
    case 'SF': move(3, 4); move(2, 2); move(1, 1); adv[batter] = 0; break;
    case 'DP': {                                                                              // batter and the lead runner
      const lead = on(1) ? 1 : on(2) ? 2 : on(3) ? 3 : null;
      [1, 2, 3].forEach(b => { if (on(b)) adv[on(b)] = b === lead ? 0 : b; });
      adv[batter] = 0; break;
    }
    default: [1, 2, 3].forEach(b => { if (on(b)) adv[on(b)] = b; }); adv[batter] = 0;       // outs: runners hold
  }
  return adv;
}

/* apply a play to the inning: new bases, outs, runs (and who scored). Returns a problem string if it doesn't add up. */
export function applyPlay(state, adv, play, { runCap = 0, runsSoFar = 0 } = {}) {
  const bases = { 1: null, 2: null, 3: null };
  let outsAdded = 0, scored = [], problem = '';
  for (const [pid, b] of Object.entries(adv)) {
    if (b === 0) outsAdded++;
    else if (b === 4) scored.push(pid);
    else if (bases[b]) problem = 'Two runners can’t end up on the same base.';
    else bases[b] = pid;
  }
  let outs = (state.outs || 0) + outsAdded;
  if (outs > 3) problem = 'That’s more than three outs.';
  // runs don't count when the third out is made on a force (ground balls, double plays, fielder's choices, strikeouts)
  if (outs >= 3 && ['GO', 'DP', 'FC', 'K', 'OUT', 'PO', 'LO', 'FO'].includes(play)) scored = [];
  let capped = false;
  if (runCap && runsSoFar + scored.length >= runCap) { scored = scored.slice(0, Math.max(0, runCap - runsSoFar)); capped = true; }
  const sideRetired = outs >= 3 || capped;
  return { bases: sideRetired ? { 1: null, 2: null, 3: null } : bases, outs: sideRetired ? 0 : outs, outsAdded, runs: scored.length, scored, sideRetired, capped, problem };
}
export const defaultRBI = (play, runs) => (play === 'E' || play === 'DP' ? 0 : runs);

/* outs made on a saved play (new plays record every runner; older quick-scored plays only the batter) */
export const outsOn = ab => (ab.adv ? Object.values(ab.adv).filter(b => b === 0).length : ['OUT', 'K', 'SF', 'GO', 'FO', 'LO', 'PO'].includes(ab.r) ? 1 : ab.r === 'DP' ? 2 : 0);

/* ---------- scorebook boxes ---------- */
/* how far the batter got around the bases from this plate appearance, following later plays in the same inning */
export function pathFor(ab, laterSameInning) {
  let reached = ab.adv ? ab.adv[ab.p] ?? (PLAYS[ab.r] && PLAYS[ab.r].out ? 0 : null) : ({ '1B': 1, '2B': 2, '3B': 3, HR: 4, BB: 1, E: 1, FC: 1 }[ab.r] ?? 0);
  let outAt = reached === 0 ? 1 : null;
  if (reached && reached < 4) {
    for (const n of laterSameInning) {
      if (!n.adv || !(ab.p in n.adv)) continue;
      const b = n.adv[ab.p];
      if (b === 0) { outAt = reached + 1; break; }
      reached = Math.max(reached, b);
      if (reached === 4) break;
    }
  }
  if (!ab.adv && (ab.scored || []).includes(ab.p)) reached = 4;
  return { reached: reached || 0, outAt };
}

/* a little diamond: home at the bottom, base paths drawn as far as the runner got, filled in if they scored */
export function diamondSVG({ reached, outAt }, label, outNo, rbi) {
  const P = [[20, 34], [34, 20], [20, 6], [6, 20], [20, 34]];   // home, 1st, 2nd, 3rd, home
  const path = reached > 0 ? P.slice(0, Math.min(4, reached) + 1).map(p => p.join(',')).join(' ') : '';
  const scored = reached >= 4;
  return `<svg viewBox="0 0 40 40" class="sc-dia" aria-hidden="true">
    <polygon points="20,34 34,20 20,6 6,20" class="sc-base${scored ? ' sc-scored' : ''}"/>
    ${path ? `<polyline points="${path}" class="sc-path"/>` : ''}
    ${outAt ? `<text x="${P[Math.min(outAt, 4) - 1][0] + (outAt === 1 ? 7 : 0)}" y="${P[Math.min(outAt, 4) - 1][1] + 4}" class="sc-x">✕</text>` : ''}
  </svg><span class="sc-code">${label}</span>${outNo ? `<span class="sc-out">${outNo}</span>` : ''}${rbi ? `<span class="sc-rbi" title="${rbi} RBI">${'•'.repeat(Math.min(rbi, 4))}</span>` : ''}`;
}
