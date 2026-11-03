// Unit tests for js/rules.js: run with `node tests/rules.test.mjs`
import { RULESETS, rulesFor, buildOrder, batterAt, buildLineupFor, lineupProblems, availabilityCheck, fieldCounts, gameClock, lineupPlayers } from '../js/rules.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? '   -> ' + extra : '')); } };
const team = (m, w, n = 0, pos = {}) => [
  ...Array.from({ length: m }, (_, i) => ({ id: 'm' + i, name: 'Man' + i, g: 'm', pos: pos['m' + i] || [] })),
  ...Array.from({ length: w }, (_, i) => ({ id: 'w' + i, name: 'Woman' + i, g: 'w', pos: pos['w' + i] || [] })),
  ...Array.from({ length: n }, (_, i) => ({ id: 'x' + i, name: 'Nb' + i, g: 'x', pos: [] })),
];
const sex = (id, rot) => id[0] === '~' ? id[1] : id[0];
const longestRun = (order, s) => { const seq = order.map(x => sex(x)), len = seq.length; let run = 0, worst = 0; for (let k = 0; k < len * 2; k++) { run = seq[k % len] === s ? run + 1 : 0; worst = Math.max(worst, run); } return Math.min(worst, len); };
const fieldMix = (L, rules, i) => { const on = rules.pos.map(k => L.field[i][k]).filter(Boolean); return { m: on.filter(x => x[0] === 'm').length, w: on.filter(x => x[0] === 'w').length, total: on.length }; };
const allInnings = (L, rules, f) => L.field.every((_, i) => f(fieldMix(L, rules, i)));

const OS = rulesFor({ rules: 'ottawasoftball' }), OSSC = rulesFor({ rules: 'ossc', division: 'rec' }), STD = rulesFor({});

console.log('-- OttawaSoftball');
for (const [m, w] of [[6, 4], [8, 4], [7, 5], [5, 5], [6, 3], [4, 3], [10, 5]]) {
  const L = buildLineupFor(team(m, w), OS, { gameIndex: 2 });
  const rotating = w === 3;
  ok(`${m}M ${w}W: never more than 2 men in a row (top to bottom too)`, longestRun(L.order, 'm') <= 2, L.order.join(' '));
  ok(`${m}M ${w}W: field has at most 6 men and ${w >= 4 ? 'at least 4' : 'all ' + w} women every inning`, allInnings(L, OS, f => f.m <= 6 && f.w >= Math.min(4, w) && f.total === Math.min(10, Math.min(m, 6) + w)));
  if (rotating) {
    ok(`${m}M 3W: 4 women's spots in the order, the 3 women rotate`, L.order.filter(x => x === '~w').length === 4 && L.rot.w.length === 3);
    const seen = []; for (let bi = 0; bi < L.order.length * 3; bi++) { const b = batterAt(L, bi); if (b[0] === 'w') seen.push(b); }
    ok(`${m}M 3W: each woman bats in turn (${seen.slice(0, 6).join(',')})`, seen.slice(0, 6).join() === [...L.rot.w, ...L.rot.w].join());
  }
  ok(`${m}M ${w}W: everyone plays at least one inning in the field`, lineupPlayers(L).every(id => L.field.some(inn => OS.pos.some(k => inn[k] === id))));
  ok(`${m}M ${w}W: lineup passes the rule checker`, lineupProblems(L, team(m, w), OS).length === 0, lineupProblems(L, team(m, w), OS).join(' | '));
}
ok('availability: 7 in with 2 women is a default risk', availabilityCheck(team(5, 2), OS).level === 'danger');
ok('availability: 6 men 3 women is playable but short', availabilityCheck(team(6, 3), OS).level === 'warn');
ok('availability: 6 men 4 women is a full team', availabilityCheck(team(6, 4), OS) === null);

console.log('\n-- OSSC');
for (const [m, w] of [[5, 5], [6, 3], [6, 2], [7, 2], [4, 6], [3, 8], [9, 4], [5, 2]]) {
  const L = buildLineupFor(team(m, w), OSSC, { gameIndex: 1 });
  ok(`${m}M ${w}W: no more than 2 of the same gender in a row (top to bottom too)`, longestRun(L.order, 'm') <= 2 && longestRun(L.order, 'w') <= 2, L.order.join(' '));
  const size = Math.min(9, m + w), floor = size < 9 ? 2 : 3;
  ok(`${m}M ${w}W: ${size} in the field with at least ${floor} of each gender`, allInnings(L, OSSC, f => f.total === size && f.m >= Math.min(floor, m) && f.w >= Math.min(floor, w)));
  ok(`${m}M ${w}W: no defensive pitcher; rover ${size === 9 ? 'used' : 'is the spot left empty when short'}; someone pitches for us`, L.field.every(inn => !inn.P && (size === 9 ? !!inn.ROV : !inn.ROV)) && L.pitcher);
  ok(`${m}M ${w}W: lineup passes the rule checker`, lineupProblems(L, team(m, w), OSSC).length === 0, lineupProblems(L, team(m, w), OSSC).join(' | '));
}
const L62 = buildLineupFor(team(6, 2), OSSC);
ok('6M 2W: matches the OSSC example (man, man, woman A, man, man, woman B, man, man, woman A…)',
  Array.from({ length: 9 }, (_, i) => batterAt(L62, i)[0]).join('') === 'mmwmmwmmw' && batterAt(L62, 2) !== batterAt(L62, 5) && batterAt(L62, 2) === batterAt(L62, 8),
  Array.from({ length: 9 }, (_, i) => batterAt(L62, i)).join(' '));
ok('OSSC home-run limit is +3 in Recreational, +5 in Intermediate', rulesFor({ rules: 'ossc', division: 'rec' }).hr.plus === 3 && rulesFor({ rules: 'ossc', division: 'int' }).hr.plus === 5);
ok('availability: 7 with only 1 woman is a forfeit risk', availabilityCheck(team(6, 1), OSSC).level === 'danger');
ok('availability: 5 men 4 women is a full field', availabilityCheck(team(5, 4), OSSC) === null);
ok('field counts short-handed: 6M 2W -> 8 on field, 2 women', JSON.stringify(fieldCounts(6, 2, 0, OSSC)) === JSON.stringify({ m: 6, w: 2, n: 0 }));

console.log('\n-- non-binary players and unset genders');
const mix = [...team(4, 3), { id: 'x0', name: 'Sam', g: 'x', pos: [] }];
const Lx = buildLineupFor(mix, OSSC);
ok('non-binary player bats and plays; rules still hold', lineupPlayers(Lx).includes('x0') && longestRun(Lx.order, 'm') <= 2 && longestRun(Lx.order, 'w') <= 2);
const unset = [...team(4, 4), { id: 'u0', name: 'Pat', pos: [] }];
ok('player with no gender set is flagged for the captain', lineupProblems(buildLineupFor(unset, OS), unset, OS).some(t => t.includes('Pat')));

console.log('\n-- standard rules unchanged');
const Ls = buildLineupFor(team(8, 4), STD);
ok('standard: everyone bats, 10 positions incl. pitcher', Ls.order.length === 12 && Ls.field.every(inn => inn.P && Object.keys(inn).length === 11));

console.log('\n-- game clock');
const c = gameClock('2026-11-10', '18:30', OS, new Date('2026-11-10T19:55:00').getTime());
ok('OttawaSoftball: no new inning after 7:50 PM for a 6:30 game', new Date(c.lastNew).getHours() === 19 && new Date(c.lastNew).getMinutes() === 50 && c.pastLastNew && !c.over);
const c2 = gameClock('2026-11-10', '18:30', OSSC, 0);
ok('OSSC: 85 minutes, last new inning at 7:50 PM', new Date(c2.end).getMinutes() === 55 && new Date(c2.lastNew).getMinutes() === 50);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
