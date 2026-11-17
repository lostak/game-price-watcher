// Tests for the background scripts, on real picks-log / slate text (tests/fixtures). Run: node --test tests/
// CI: .github/workflows/test.yml on every push; failures are reported to "Personal: app check" for the App doctor.
// Each test pins down something that actually broke (or nearly did) – keep adding one per bug.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const F = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const LOG = F('log.txt'), ARCH = F('archive.txt'), SLATE = F('slate.txt'), NFL = F('nfl-slate.txt');

const info = require('../pickinfo');
const { build } = require('../picks');
const nfl = require('../nflparlay');
const bank = require('../bankroll');
const { grade, withLine } = require('../grade');
const { markPlaced } = require('../forward');
const { checkLineup, checkNfl } = require('../outcheck');

test('picks log lines give each pick its sport and game time', () => {
  const rows = info.fromLog(LOG, '2026-11-13').filter(r => !r.parlay);
  assert.deepStrictEqual(rows.map(r => [r.sport, r.time]), [['CFB', '5:00 PM'], ['NHL', '7:00 PM'], ['CFB', '8:15 PM']]);
});
test('Discord time stamps follow Denver time, DST included', () => {
  assert.strictEqual(new Date(info.epoch('2026-11-13', '5:00 PM') * 1000).toISOString(), '2026-11-14T00:00:00.000Z');   // MST
  assert.strictEqual(new Date(info.epoch('2026-07-04', '7:10 PM') * 1000).toISOString(), '2026-07-05T01:10:00.000Z');   // MDT
});
test('#general lineup: every pick has sport + time, no dollars, parlay kept', () => {
  const ctx = { date: '2026-11-13', discord: true, log: info.fromLog(LOG, '2026-11-13'), slate: info.fromSlate(SLATE) };
  const text = build(SLATE, 'Fri Nov 13', ctx);
  assert.ok(text && !/\$\s?\d/.test(text), 'no dollar amounts in the shared channel');
  assert.deepStrictEqual(checkLineup(text, SLATE), []);
});
test('an NFL Sunday block in the slate does not leak into the daily lineup', () => {
  const ctx = { date: '2026-11-15', discord: true, log: [], slate: [] };
  const text = build(NFL, 'Sun Nov 15', ctx);
  assert.strictEqual(text.split('\n').filter(l => /^•/.test(l) && !/Parlay/.test(l)).length, 1);
});
test('NFL Sunday parlay: legs, upset flag, 3 reasons each, posts fit Discord, no dollars', () => {
  const p = nfl.parse(NFL);
  assert.strictEqual(p.legs.length, 3);
  assert.deepStrictEqual(p.legs.map(l => l.upset), [false, true, false]);
  assert.ok(p.legs.every(l => l.reasons.length === 3));
  const msgs = nfl.messages(p, '2026-11-15', 'Sun Nov 15');
  assert.ok(msgs.every(m => m.length <= 1900 && !/\$\s?\d/.test(m)));
  assert.deepStrictEqual(checkNfl(msgs, NFL), []);
  assert.match(checkNfl(msgs, NFL.replace('- UPSET: ', '- ')).join(), /no upset/);
});
test('two bankrolls from the real log + archive', () => {
  const c = bank.compute(LOG, [ARCH]);
  assert.strictEqual(c.current, 117.88, 'picks bankroll');
  assert.strictEqual(c.placed.current, 99.4, 'placed bankroll');
});
test('bankroll line: repairs the garbled part, stays stable on re-run, keeps "$" amounts intact', () => {
  const c = bank.compute(LOG, [ARCH]);
  const once = bank.withCurrent(LOG, c, 'now'), twice = bank.withCurrent(once, c, 'now');
  const line = once.split('\n')[0];
  assert.strictEqual(once, twice);
  assert.strictEqual((line.match(/\| current \$/g) || []).length, 1);
  assert.ok(!/\| current (?!\$)/.test(line));
  assert.match(line, /current \$117\.88 .*placed bankroll \$99\.40/);
});
test('"placed: not yet" is never read as "no"', () => {
  const l = '2026-11-13 | Rangers -1.5 puck line @ Canucks (NHL) | +114 | DraftKings | Low | 1u ($2, returns $4.28) | 7:00 PM MT | placed: not yet | result: pending';
  assert.strictEqual((l.match(/placed:\s*(not yet|yes|slip|no)/i) || [])[1], 'not yet');
  for (const f of fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.js')))
    assert.ok(!/yes\|slip\|no\|not yet/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f} has the alternation that reads "not yet" as "no"`);
});
test('your line swaps into spreads and totals', () => {
  assert.strictEqual(withLine('Pittsburgh -3.5 vs Florida State', '-4'), 'Pittsburgh -4 vs Florida State');
  assert.strictEqual(withLine('Bills @ Vikings Under 43.5', '44.5'), 'Bills @ Vikings Under 44.5');
});
test('grading moneyline, spread push and totals', () => {
  const g = (a, as, b, bs) => ({ done: true, teams: [{ abbr: a, score: as, names: [a === 'PIT' ? 'Pittsburgh' : 'Florida State', a] }, { abbr: b, score: bs, names: [b === 'FSU' ? 'Florida State' : 'Pittsburgh', b] }] });
  assert.strictEqual(grade('Pittsburgh ML', g('PIT', 24, 'FSU', 20)).res, 'W');
  assert.strictEqual(grade('Pittsburgh -4 vs Florida State', g('PIT', 24, 'FSU', 20)).res, 'P');
  assert.strictEqual(grade('Pittsburgh -3.5 vs Florida State', g('PIT', 24, 'FSU', 21)).res, 'L');
  assert.strictEqual(grade('Pittsburgh vs Florida State Over 44.5', g('PIT', 24, 'FSU', 21)).res, 'W');
});
test('Discord "placed" back-fills earlier days', () => {
  assert.strictEqual(markPlaced(LOG, '11/12 wild').day, '2026-11-12');
  assert.ok(markPlaced(LOG, 'nov 12 all').hit.length >= 3);
});
test('recording bets placed at his odds, plus his own 2-leg parlay of the picks', () => {
  const { apply } = require('../record');
  const r = apply(F('nov14.txt'), '2026-11-14', [{ word: 'Wild', odds: '-130' }, { word: 'Oilers', odds: '-148' }], { legs: ['Wild', 'Oilers'], odds: '+196', stake: 2 });
  assert.match(r.desc, /Wild ML @ Bruins.*placed: yes \(your odds -130\).*yours: W \+\$1\.53/);
  assert.match(r.desc, /Oilers ML @ Maple Leafs.*placed: yes \(your odds -148\).*yours: W \+\$1\.35/);
  assert.match(r.desc, /SLIP: 2026-11-14 \| Parlay: Wild ML \/ Oilers ML \| \+196 \| \$2\.00 to win \$3\.92 \| DraftKings \| won \+\$3\.92/);
  assert.strictEqual(bank.compute(r.desc, []).placed.current, 106.8);   // $100 + 1.53 + 1.35 + 3.92 (DraftKings' payouts)
  assert.strictEqual(bank.compute(r.desc, []).current, bank.compute(F('nov14.txt'), []).current, 'recording his bets must not move the picks bankroll');
  assert.strictEqual(apply(r.desc, '2026-11-14', [], { legs: ['Wild', 'Oilers'], odds: '+196', stake: 2 }).desc.split('SLIP: 2026-11-14').length, 2, 'no duplicate slip on a re-run');
});
test('CLV line is counted in code: Wake Forest -104 that closed +115 did NOT beat the close (Nov 15 miscount 16 vs 15)', () => {
  const log = F('nov15-clv.txt'), arch = F('archives-nov15.txt');
  assert.strictEqual(bank.clvVerdict(log.split('\n').find(l => /^2026-11-14 \| Wake Forest/.test(l))), false);
  const c = bank.clv(log, [arch]);
  assert.strictEqual(c.line, 'CLV: 15 of 25 known beat the close (Nov 14: Wild beat the close; Wake Forest and Oilers did not)');
  const once = bank.withClv(log, c);
  assert.strictEqual(bank.withClv(once, bank.clv(once, [arch])), once, 'stable on re-run');
  assert.strictEqual(once.split('\n').filter(l => /^CLV:/.test(l)).length, 1);
  assert.strictEqual(once.replace(/^CLV:.*$/m, ''), log.replace(/^CLV:.*$/m, ''), 'only the CLV line changes');
});

test('price message dots match the chart lines: 🔵 anywhere, 🟠 lower bowl, 🟢 1 ticket elsewhere (Nov 17: was ⚪)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'watch.js'), 'utf8');
  assert.ok(!src.includes('⚪'), 'no white dot');
  assert.ok(/'🟢 ' \+ ewLine/.test(src) && /`🟢 \$\{ewLine/.test(src), 'green dot on both "elsewhere" lines');
  const C = require('fs').readFileSync(require('path').join(__dirname, '..', 'charts.js'), 'utf8');
  assert.match(C, /all: '#3987e5', lower: '#d95926', ew: '#199e70'/, 'chart: blue, orange, green');
});
