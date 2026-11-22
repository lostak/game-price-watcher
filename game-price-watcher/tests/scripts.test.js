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
const { checkLineup, checkNfl, nflPosts } = require('../outcheck');

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

test('a morning tick of his own line on an already-graded pick is graded by "grade.js --yours" (Nov 17 Vikings +3)', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'fake-grade-env.js'), path.join(__dirname, '..', 'grade.js'), '--yours'],
    { encoding: 'utf8', env: { ...process.env, FAKE_LOG: path.join(__dirname, 'fixtures', 'nov15-yours.txt') } });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout.split('PATCHED\n')[1] || '';
  assert.match(out, /Vikings \+2\.5 @ Packers .*result: W \(MIN 30-10\) \+0\.91u, yours: W \+\$1\.96 \(auto-graded\)/, r.stdout);
  assert.match(out, /Predators ML @ Wild .*result: pending/, 'today\'s ungraded pick is left for the main grading window');
  assert.ok(!/nhl/.test(r.stdout), '--yours does not look up games for lines it leaves alone');
});
test('PICKS RECORD is counted in code: Nov 20 line was stuck at Nov 18 (24-15 / 3-11 instead of 25-17 / 3-12)', () => {
  const log = F('nov20-log.txt'), arch = F('archives-nov20.txt');
  const r = bank.record(log, [arch]);
  assert.strictEqual(r.text, 'singles 25-17-0, +7.03u | parlays 3-12, +1.49u | combined +8.52u on 51u risked');
  const once = bank.withRecord(log, r);
  assert.strictEqual(once.split('\n')[3], 'PICKS RECORD (every recommendation, placed or not; units only): singles 25-17-0, +7.03u | parlays 3-12, +1.49u | combined +8.52u on 51u risked (log started Fri Nov 6, 2026)');
  assert.strictEqual(bank.withRecord(once, bank.record(once, [arch])), once, 'stable on re-run');
  assert.strictEqual(once.replace(/^PICKS RECORD.*$/m, ''), log.replace(/^PICKS RECORD.*$/m, ''), 'only the PICKS RECORD line changes');
  assert.strictEqual(bank.record('2026-11-18 | Bruins ML | +102 | DraftKings | Low | 1u ($2.50) | placed: yes (your odds -110) | result: W (BOS 4-1) +1.02u, yours: W +$2.27').su, 1.02, 'units come from the pick, not "yours:"');
});

// Nov 21: "Watch stop nuggets" STARTED a Nuggets watch, and stopping never silenced the automatic home-game posts.
test('ticket commands: any stop wording stops (and mutes automatic games), never starts a watch; resume turns it back on', () => {
  const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
  const dir = path.join(__dirname, '..'), W = path.join(dir, 'wants.json'), orig = fs.readFileSync(W, 'utf8');
  const run = text => {
    const r = spawnSync('node', ['commands.js', '--text', text], { cwd: dir, env: { ...process.env, GCAL_SA_KEY: '', DISCORD_WEBHOOK_URL: '' } });
    assert.ok([0, 3].includes(r.status), String(r.stderr)); return { out: String(r.stdout), c: JSON.parse(fs.readFileSync(W, 'utf8')) };
  };
  const reset = () => { const c = JSON.parse(orig); c.games = [{ team: 'Nuggets', opponent: 'Houston Rockets', date: '2099-11-20' }, { team: 'Broncos', opponent: 'Las Vegas Raiders', date: '2099-11-22' }]; c.muted = []; fs.writeFileSync(W, JSON.stringify(c)); };
  try {
    for (const [text, games, muted] of [['Watch stop nuggets', 1, [{ team: 'Nuggets' }]], ['watch stop all', 0, [{ all: true }]], ['stop', 0, [{ all: true }]],
      ['cancel the avs', 2, [{ team: 'Avs' }]], ['no more broncos games', 1, [{ team: 'Broncos' }]], ['mute everything', 0, [{ all: true }]], ['stop watching', 0, [{ all: true }]]]) {
      reset(); const r = run(text);
      assert.ok(!/Got it – watching/.test(r.out), `"${text}" must not start a watch`);
      assert.strictEqual(r.c.games.length, games, text); assert.deepStrictEqual(r.c.muted, muted, text);
    }
    reset(); run('stop nuggets'); assert.deepStrictEqual(run('resume nuggets').c.muted, []);
    reset(); run('stop all'); assert.deepStrictEqual(run('resume all').c.muted, []);
    const M = require('../mutes');
    assert.ok(M.isMuted({ team: 'Nuggets', date: '2099-11-25' }, [{ team: 'Nuggets' }]));
    assert.ok(!M.isMuted({ team: 'Nuggets', date: '2099-11-25', manual: true }, [{ all: true }]), 'a game he asked for is never muted');
    assert.deepStrictEqual(M.parse('x\nMUTE: all\nMUTE: 2099-11-20 Avalanche'), [{ all: true }, { date: '2099-11-20', team: 'Avalanche' }]);
  } finally { fs.writeFileSync(W, orig); }
});

test('DM commands: flexible "done" / "placed" wording, but ordinary chat stays a note', () => {
  const F = require('../forward');
  for (const t of ['ok done', 'I did it', 'yep, finished', 'done', '✅', 'all done'])
    assert.ok(F.DONE.test(F.normalize(t)), t);
  for (const t of ['I placed the parlay', 'placed all', 'put in wild', 'just placed oilers'])
    assert.ok(F.PLACED(F.normalize(t)), t);
  for (const t of ['did you see the game', 'bet on the broncos tonight?', 'doneness of steak'])
    assert.ok(!F.DONE.test(F.normalize(t)) && !F.PLACED(F.normalize(t)), t);
});

test('totals follow the grades in the same grade.js run (Nov 21: app check at 1:41 PM saw Navy ML graded but PICKS RECORD/bankroll still at the old numbers)', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'fake-grade-env.js'), path.join(__dirname, '..', 'grade.js')],
    { encoding: 'utf8', env: { ...process.env, FAKE_LOG: path.join(__dirname, 'fixtures', 'nov21-pending.txt'), FAKE_TODAY: '2026-11-21' } });
  assert.strictEqual(r.status, 0, r.stderr);
  const parts = r.stdout.split('PATCHED\n'), last = parts[parts.length - 1].split('\nPICKS-LOG')[0] + '\nPICKS-LOG';
  assert.ok(parts.length >= 3, 'grade.js wrote the grades and then the totals: ' + r.stdout);
  assert.match(last, /Navy ML vs Memphis .*result: W \(NAVY 38-34\) \+1\.42u/);
  assert.match(last, /PARLAY: Army ML .*result: L \(a leg lost\) -0\.5u/);
  assert.match(last, /^PICKS RECORD.*singles 2-1-0, \+1\.56u \| parlays 0-1, -0\.50u/m);
  assert.strictEqual(+(last.match(/\| current \$([\d.]+)/) || [])[1], bank.compute(last, []).current);
  assert.strictEqual(bank.compute(last, []).current, 102.4);
});
test('NFL post check reads only today\'s post (Nov 22: last Sunday\'s "(cont.)" message was counted too – 16 legs vs 11)', () => {
  const slate = n => 'NFL SUNDAY ML PARLAY: ' + n + ' legs @ DraftKings +3763 – 0.5u ($1.50, wins ~$56) – hits roughly 1 in 40\n' +
    Array.from({ length: n }, (_, i) => `- ${i === 1 ? 'UPSET: ' : ''}Team${i} ML -150 vs Other${i} – 11:00 AM MT\n` +
      [1, 2, 3].map(k => `  • reason ${k} for leg ${i}: ${'a long explanation of the matchup and recent form '.repeat(2)}`).join('\n')).join('\n') + '\n';
  const S15 = slate(12), S22 = slate(11);
  const old = nfl.messages(nfl.parse(S15), '2026-11-15', 'Sun Nov 15').map(m => m.replace(/ \(cont\.\) – Sun Nov 15/, ' (cont.)'));  // posted before continuations carried the date
  const now = nfl.messages(nfl.parse(S22), '2026-11-22', 'Sun Nov 22');
  assert.ok(old.length > 1 && now.length > 1, 'both posts span several messages');
  assert.ok(now.slice(1).every(m => m.includes('(cont.) – Sun Nov 22')), 'continuations carry the date');
  const channel = [...now.slice().reverse(), '**Picks of the day** Sun Nov 22', ...old.slice().reverse(), '**Picks of the day** Sun Nov 15'];   // newest first
  const mine = nflPosts(channel, 'Sun Nov 22');
  assert.deepStrictEqual(mine, now);
  assert.deepStrictEqual(checkNfl(mine, S22), []);
  const oldChan = channel.map(m => m.replace(/ \(cont\.\) – Sun Nov 22/, ' (cont.)'));   // old-style continuations today too
  assert.deepStrictEqual(checkNfl(nflPosts(oldChan, 'Sun Nov 22'), S22), []);
});
