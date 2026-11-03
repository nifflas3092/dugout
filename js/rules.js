/* League rulesets. A team picks one in Team settings; the lineup builder, game-day checks and scorekeeping follow it.
   Rules are summarised from each league's published rulebook (see `source`); leagues update them, so the in-app
   rules card always links back to the original. Pure functions only, so they can be unit-tested (tests/rules.test.mjs). */

export const POS_NAME = { P: 'Pitcher', C: 'Catcher', '1B': 'First base', '2B': 'Second base', '3B': 'Third base', SS: 'Shortstop',
  LF: 'Left field', LCF: 'Left-centre', CF: 'Centre field', RCF: 'Right-centre', RF: 'Right field', ROV: 'Rover' };
const TEN = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'];

export const RULESETS = {
  standard: {
    id: 'standard', name: 'Standard slo-pitch', short: 'Standard',
    pos: TEN, prefPos: TEN, field: 10, innings: 7,
    summary: ['10 players in the field, any mix', '7 innings', 'No gender rules in the batting order'],
  },
  ottawasoftball: {
    id: 'ottawasoftball', name: 'OttawaSoftball (co-ed)', short: 'OttawaSoftball',
    source: 'https://www.ottawasoftball.ca/info/rules/coedrules.php',
    pos: TEN, prefPos: TEN, field: 10, innings: 7,
    coed: true,
    fieldGender: { maxM: 6, minW: 4 },                 // 10 in the field: at most 6 men, at least 4 women
    orderRule: { maxRun: { m: 2 }, wrap: true },      // no more than 2 men in a row
    rotateWomenAt: 3,                                  // with exactly 3 women, 4 women's spots and the 3 rotate
    minPlayers: 7, minW: 3, fullTeam: '6 men and 4 women',
    minutes: 90, noNewInningAfter: 80,                 // 90-minute games; no new inning after 1 h 20
    runCap: 6, mercy: { lead: 15, after: 5 },
    hr: { plus: 2, byGender: true, fencedOnly: true, over: 'umpire’s call' },
    walkOnDeck: true, defenceToBat: true, cancelBy: '3:00 PM',
    summary: [
      '10 in the field: at least 4 women and no more than 6 men',
      'Batting order: no more than 2 men in a row. With only 3 women, keep 4 women’s spots and rotate the 3. No automatic outs',
      'Minimum 7 players including 3 women, or it’s a default (10-minute grace)',
      'Every player must play at least 1 inning in the field to bat',
      '7 innings or 90 minutes. No new inning after 1 h 20 min',
      'Max 6 runs an inning (unlimited in the last). Mercy: 15 runs after the 5th',
      'Home runs: +2 rule on fenced fields, men and women counted separately',
      'Walk: 1 base with a man on deck, 2 bases with a woman on deck (and she must bat)',
      'Pitch arc 6 to 12 ft; pitchers wear a mask. Caught foul tip is an out',
      'Commitment line 21 ft from home; no tags at home. No bunting, no leading off',
      'Cancel by 3:00 PM on game day ($50 fine). Rain-outs count as a 0–0 tie until replayed',
    ],
  },
  ossc: {
    id: 'ossc', name: 'OSSC: Ottawa Sport & Social Club (mixed)', short: 'OSSC',
    source: 'https://ottawa.sportandsocialclub.ca/sport-rules/',
    pos: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'ROV'],      // 8 positions + rover; the batting team pitches
    prefPos: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'ROV'],
    field: 9, innings: 7, coed: true, offensePitcher: true,
    fieldGender: { minM: 3, minW: 3, shortMin: 2 },
    orderRule: { maxRun: { m: 2, w: 2 }, wrap: true },              // no more than 2 of the same gender in a row, top to bottom too
    rotateWhenShort: true,                                           // short of one gender: its spots repeat (man, man, woman A, man, man, woman B, man, man, woman A…)
    minPlayers: 7, minEach: 2, fullTeam: 'at least 3 men and 3 women',
    minutes: 85, noNewInningLeft: 5,
    runCap: 8, mercy: { lead: 15, after: 5, optional: true },
    hr: (division) => ({ plus: division === 'int' ? 5 : 3, byGender: false, over: 'a single (runners move only if forced)' }),
    pitches: 3,
    summary: [
      '9 in the field: 8 positions plus a rover. The batting team supplies its own pitcher',
      'At least 3 men and 3 women in the field. You can play with 7 or 8 if you have 2 of each; the field is short by the same number',
      'Batting order: no more than 2 of the same gender in a row, including bottom to top. If short one gender, those spots repeat. No automatic outs',
      'Everyone bats once before anyone bats twice. Late arrivals go to the bottom of their gender',
      '3 pitches per batter. Foul pop-ups must go over 10 ft to be caught',
      '7 innings, 85 minutes. No new inning with 5 minutes left',
      'Max 8 runs an inning (unlimited in the last). Mercy: 15 runs after the 5th, losing team’s choice',
      'Home runs: +3 in Recreational, +5 in Intermediate. Over the limit counts as a single',
      'No sliding, stealing or leading off; no infield fly rule. Commitment line halfway to home; no tags at home',
      'Bats: NSA Canada approved list (USSSA 1.20 or NSA stamp), not altered. Catchers wear a mask',
      'Forfeit if you can’t field a team 15 minutes after start. Games are played rain or shine',
    ],
  },
};
export const rulesFor = team => {
  const r = RULESETS[(team && team.rules) || 'standard'] || RULESETS.standard;
  return { ...r, hr: typeof r.hr === 'function' ? r.hr(team && team.division) : r.hr || null };
};
const sexOf = p => (p && (p.g === 'm' || p.g === 'w') ? p.g : 'n');   // non-binary or not set: counts toward the team, not a gender minimum

/* ---------- batting order ---------- */
/* Spread the larger group into the gaps between everyone else so no run is longer than allowed (counting
   bottom-to-top). When a gender is too short for that, its spots repeat and its players rotate through them. */
export function buildOrder(players, rules) {
  const men = players.filter(p => sexOf(p) === 'm'), women = players.filter(p => sexOf(p) === 'w'), neutral = players.filter(p => sexOf(p) === 'n');
  const ids = a => a.map(p => p.id);
  if (!rules.coed || !rules.orderRule) return { order: ids(players), rot: {} };
  const maxM = rules.orderRule.maxRun.m || Infinity, maxW = rules.orderRule.maxRun.w || Infinity;
  const rot = {};
  let womenSlots = ids(women), menSlots = ids(men);
  // OttawaSoftball: exactly 3 women -> 4 women's spots, the 3 rotate
  if (rules.rotateWomenAt && women.length === rules.rotateWomenAt) { rot.w = ids(women); womenSlots = Array(women.length + 1).fill('~w'); }
  // OSSC: whichever gender is too short gets extra spots it rotates through
  if (rules.rotateWhenShort) {
    const needW = Math.ceil(men.length / maxM) - neutral.length;
    if (women.length && women.length < needW) { rot.w = ids(women); womenSlots = Array(needW).fill('~w'); }
    const needM = Math.ceil(women.length / maxW) - neutral.length;
    if (men.length && men.length < needM) { rot.m = ids(men); menSlots = Array(needM).fill('~m'); }
  }
  // the bigger group (by run limit) goes into the gaps between the others
  const spreadMen = menSlots.length / maxM >= womenSlots.length / maxW;
  const big = spreadMen ? menSlots : womenSlots, small = spreadMen ? womenSlots : menSlots;
  const seps = [];                                       // separators: the smaller group, with neutral players woven in
  const a = [...small], b = ids(neutral);
  while (a.length || b.length) { if (a.length) seps.push(a.shift()); if (b.length) seps.push(b.shift()); }
  if (!seps.length) return { order: big.slice(), rot };
  const order = [], gaps = seps.length;
  let placed = 0;
  for (let i = 0; i < gaps; i++) {
    const n = Math.floor(big.length * (i + 1) / gaps) - Math.floor(big.length * i / gaps);   // even spread
    order.push(...big.slice(placed, placed + n)); placed += n; order.push(seps[i]);
  }
  return { order, rot };
}

/* who bats at overall plate appearance number `bi` (0-based), resolving rotating spots */
export function batterAt(L, bi, fallback = []) {
  const order = L && L.order && L.order.length ? L.order : fallback;
  if (!order.length) return null;
  const len = order.length, pos = ((bi % len) + len) % len, slot = order[pos];
  if (typeof slot !== 'string' || slot[0] !== '~') return slot;
  const g = slot.slice(1), list = (L.rot && L.rot[g]) || [];
  if (!list.length) return null;
  const perPass = order.filter(s => s === slot).length, before = order.slice(0, pos).filter(s => s === slot).length;
  return list[(Math.floor(bi / len) * perPass + before) % list.length];
}
export const lineupPlayers = L => (L ? [...new Set([...L.order.filter(s => s[0] !== '~'), ...Object.values(L.rot || {}).flat()])] : []);

/* ---------- who's in the field each inning ---------- */
export function fieldCounts(m, w, n, rules) {
  const size = Math.min(rules.field, m + w + n);
  if (!rules.coed) return { m: Math.min(m, size), w: Math.min(w, size - Math.min(m, size)), n: size - Math.min(m, size) - Math.min(w, size - Math.min(m, size)) };
  const fg = rules.fieldGender;
  if (fg.maxM != null) {                                  // OttawaSoftball: cap the men, fill with everyone else
    const mOn = Math.min(m, fg.maxM), wOn = Math.min(w, rules.field - mOn), nOn = Math.min(n, rules.field - mOn - wOn);
    return { m: mOn, w: wOn, n: nOn };
  }
  // OSSC: a floor of each gender (3, or 2 when short-handed), then fill the rest from whoever has the most people waiting
  const floor = size < rules.field ? fg.shortMin : fg.minW;
  let mOn = Math.min(m, floor), wOn = Math.min(w, floor), nOn = 0;
  while (mOn + wOn + nOn < size) {
    const left = [['m', m - mOn], ['w', w - wOn], ['n', n - nOn]].filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]);
    if (!left.length) break;
    if (left[0][0] === 'm') mOn++; else if (left[0][0] === 'w') wOn++; else nOn++;
  }
  return { m: mOn, w: wOn, n: nOn };
}

/* ---------- full lineup: order + positions every inning ---------- */
export function buildLineupFor(avail, rules, { innings = 7, gameIndex = 0 } = {}) {
  const n = avail.length; if (!n) return null;
  const turn = arr => { if (!arr.length) return arr; const s = gameIndex % arr.length; return arr.slice(s).concat(arr.slice(0, s)); };   // top of the order moves each game
  const byG = g => turn(avail.filter(p => sexOf(p) === g));
  const rotated = rules.coed ? [...byG('m'), ...byG('w'), ...byG('n')] : turn(avail);
  const { order, rot } = buildOrder(rotated, rules);
  const people = rules.coed ? rotated : rotated;
  const likes = (p, pos) => {
    const pref = p.pos || [];
    return pref.includes(pos) || (pos === 'CF' && pref.some(x => x === 'LCF' || x === 'RCF')) ||
      (pos === 'ROV' && pref.some(x => ['LF', 'LCF', 'CF', 'RCF', 'RF'].includes(x))) || (pos === 'LCF' || pos === 'RCF') && pref.includes('CF');
  };
  const sits = {}, played = {}, field = [];
  people.forEach(p => { sits[p.id] = 0; played[p.id] = {}; });
  const groups = { m: people.filter(p => sexOf(p) === 'm'), w: people.filter(p => sexOf(p) === 'w'), n: people.filter(p => sexOf(p) === 'n') };
  for (let i = 0; i < innings; i++) {
    let onIds;
    if (rules.coed) {
      const c = fieldCounts(groups.m.length, groups.w.length, groups.n.length, rules);
      onIds = [];
      for (const g of ['m', 'w', 'n']) {
        const grp = groups[g], benchN = grp.length - c[g];
        const bench = [...grp].sort((a, b) => sits[a.id] - sits[b.id] || ((grp.indexOf(b) + i) % grp.length) - ((grp.indexOf(a) + i) % grp.length)).slice(0, benchN);
        bench.forEach(p => sits[p.id]++);
        onIds.push(...grp.filter(p => !bench.includes(p)).map(p => p.id));
      }
    } else {
      const benchN = Math.max(0, n - rules.pos.length);
      const bench = [...people].sort((a, b) => sits[a.id] - sits[b.id] || ((people.indexOf(b) + i) % n) - ((people.indexOf(a) + i) % n)).slice(0, benchN);
      bench.forEach(p => sits[p.id]++);
      onIds = people.filter(p => !bench.includes(p)).map(p => p.id);
    }
    const slot = {};
    for (const pos of rules.pos) {
      const free = onIds.filter(id => !Object.values(slot).includes(id)); if (!free.length) break;
      const fans = free.filter(id => likes(people.find(p => p.id === id), pos));
      const pool = fans.length ? fans : free;
      pool.sort((a, b) => (played[a][pos] || 0) - (played[b][pos] || 0));
      slot[pos] = pool[0]; played[pool[0]][pos] = (played[pool[0]][pos] || 0) + 1;
    }
    field.push({ ...slot, bench: people.map(p => p.id).filter(id => !onIds.includes(id)) });
  }
  const L = { order, field, rot };
  if (rules.offensePitcher) { const pit = people.find(p => (p.pos || []).includes('P')) || people[0]; L.pitcher = pit ? pit.id : null; }
  return L;
}

/* ---------- checks ---------- */
export function lineupProblems(L, players, rules) {
  const out = [], P = id => players.find(p => p.id === id), name = id => (P(id) || {}).name || 'A player';
  if (!L || !rules.coed) return out;
  const everyone = lineupPlayers(L);
  const unset = everyone.filter(id => sexOf(P(id)) === 'n' && !(P(id) && P(id).g === 'x'));
  if (unset.length) out.push(`Set Man or Woman for ${unset.map(name).join(', ')} on the Team tab, so the lineup can follow the co-ed rules.`);
  const g = slot => slot[0] === '~' ? slot.slice(1) : sexOf(P(slot));
  for (const [sex, max] of Object.entries(rules.orderRule.maxRun)) {
    const seq = L.order.map(g), len = seq.length; if (!len || seq.every(x => x === sex)) { if (len > max && seq.every(x => x === sex)) out.push(`Batting order has more than ${max} ${sex === 'm' ? 'men' : 'women'} in a row.`); continue; }
    let run = 0, worst = 0;
    for (let k = 0; k < len * 2; k++) { run = seq[k % len] === sex ? run + 1 : 0; worst = Math.max(worst, run); }
    if (worst > max) out.push(`Batting order has ${worst} ${sex === 'm' ? 'men' : 'women'} in a row (the limit is ${max}${rules.orderRule.wrap ? ', counting bottom to top' : ''}).`);
  }
  L.field.forEach((inn, i) => {
    const on = rules.pos.map(k => inn[k]).filter(Boolean), m = on.filter(id => sexOf(P(id)) === 'm').length, w = on.filter(id => sexOf(P(id)) === 'w').length;
    const fg = rules.fieldGender;
    if (fg.maxM != null && m > fg.maxM) out.push(`Inning ${i + 1}: ${m} men in the field (max ${fg.maxM}).`);
    if (fg.minW != null && w < fg.minW && everyone.filter(id => sexOf(P(id)) === 'w').length > w) out.push(`Inning ${i + 1}: only ${w} women in the field (need ${fg.minW}).`);
    if (fg.minM != null && m < fg.minM && everyone.filter(id => sexOf(P(id)) === 'm').length > m) out.push(`Inning ${i + 1}: only ${m} men in the field (need ${fg.minM}).`);
  });
  if (rules.defenceToBat) {
    const benchAll = everyone.filter(id => L.field.every(inn => !rules.pos.some(k => inn[k] === id)));
    if (benchAll.length) out.push(`${benchAll.map(name).join(', ')} never play${benchAll.length === 1 ? 's' : ''} in the field. Everyone must play at least one inning to bat.`);
  }
  return out;
}

/* is there a team for this game? from the people who said In */
export function availabilityCheck(ins, rules) {
  if (!rules.coed) return ins.length < 9 ? { level: 'warn', text: `${ins.length} in so far` } : null;
  const m = ins.filter(p => sexOf(p) === 'm').length, w = ins.filter(p => sexOf(p) === 'w').length;
  if (rules.minW != null) {           // OttawaSoftball
    if (ins.length < rules.minPlayers || w < rules.minW) return { level: 'danger', need: w < rules.minW ? 'w' : '', text: `${ins.length} in, ${w} women. League minimum is ${rules.minPlayers} players with ${rules.minW} women, or it’s a default` };
    if (w < 4 || m < 6) return { level: 'warn', need: w < 4 ? 'w' : 'm', text: `${m} men and ${w} women in. A full team is ${rules.fullTeam}` };
    return null;
  }
  if (ins.length < rules.minPlayers || m < rules.minEach || w < rules.minEach) return { level: 'danger', need: w < rules.minEach ? 'w' : m < rules.minEach ? 'm' : '', text: `${m} men and ${w} women in. You need at least ${rules.minPlayers} with ${rules.minEach} of each, or it may be a forfeit` };
  if (m < 3 || w < 3 || ins.length < rules.field) return { level: 'warn', need: w < 3 ? 'w' : m < 3 ? 'm' : '', text: `${m} men and ${w} women in. A full field is 9 with ${rules.fullTeam}` };
  return null;
}

/* game clock from the scheduled start */
export function gameClock(date, time, rules, now = Date.now()) {
  if (!rules.minutes || !date) return null;
  const start = new Date(`${date}T${time || '18:30'}`).getTime(); if (!Number.isFinite(start)) return null;
  const end = start + rules.minutes * 60e3, lastNew = rules.noNewInningAfter != null ? start + rules.noNewInningAfter * 60e3 : end - rules.noNewInningLeft * 60e3;
  return { start, end, lastNew, pastLastNew: now >= lastNew, over: now >= end };
}
