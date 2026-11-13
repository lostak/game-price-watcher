// Auto-grades the picks log from ESPN's free scoreboards, right after games end (tick.yml runs it in the evening and
// early morning). Singles (moneyline, spread, total) for NFL, college football, NHL and NBA; the day's parlay once all
// its singles are graded (any loss = loss, all wins = win; a push is left for the morning Claude task to re-price).
// Units on every line; dollars only on "placed: yes" lines. Table tennis and SLIP lines are left to the Claude task,
// which also recomputes the totals and bankroll each morning.
'use strict';
const cal = require('./gcal');
const SPORT = { NFL: 'football/nfl', CFB: 'football/college-football', NHL: 'hockey/nhl', NBA: 'basketball/nba' };
const DRY = process.argv.includes('--dry');

const ppu = price => { const o = parseFloat(String(price).replace(/[^\d+.-]/g, '')); return !o ? null : o > 0 ? o / 100 : 100 / Math.abs(o); };
const r2 = n => Math.round(n * 100) / 100;
const fu = u => (u > 0 ? '+' : u < 0 ? '-' : '') + String(r2(Math.abs(u))) + 'u';
const fd = d => (d > 0 ? '+' : d < 0 ? '-' : '') + '$' + Math.abs(d).toFixed(2);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const boards = {};
async function scoreboard(sport, date) {
  const k = sport + date; if (boards[k]) return boards[k];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${SPORT[sport]}/scoreboard?dates=${date.replace(/-/g, '')}&limit=400${sport === 'CFB' ? '&groups=80' : ''}`;
  const r = await fetch(url); if (!r.ok) throw new Error(`ESPN ${sport} ${r.status}`);
  return (boards[k] = ((await r.json()).events || []).map(e => {
    const c = e.competitions?.[0] || {};
    return { done: !!c.status?.type?.completed, teams: (c.competitors || []).map(t => ({ score: +t.score, abbr: t.team?.abbreviation || '', names: [t.team?.displayName, t.team?.shortDisplayName, t.team?.name, t.team?.location, t.team?.nickname].filter(Boolean) })) };
  }));
}
// where in the bet text a team is first mentioned (-1 if not)
function mention(text, t) {
  let best = -1;
  for (const n of t.names.concat(t.abbr.length >= 3 ? [t.abbr] : [])) {
    const m = new RegExp(`(^|[^A-Za-z])${esc(n)}([^A-Za-z]|$)`, n === t.abbr ? '' : 'i').exec(text);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}
function grade(bet, game) {
  const [a, b] = game.teams, ia = mention(bet, a), ib = mention(bet, b);
  const tot = bet.match(/\b(Over|Under)\s+(\d+(?:\.\d+)?)/i);
  const score = `${(a.score >= b.score ? a : b).abbr} ${Math.max(a.score, b.score)}-${Math.min(a.score, b.score)}`;
  if (tot) {
    const sum = a.score + b.score, line = +tot[2], over = /over/i.test(tot[1]);
    return { res: sum === line ? 'P' : (sum > line) === over ? 'W' : 'L', note: `${score}, total ${sum}` };
  }
  const subj = ia >= 0 && (ib < 0 || ia <= ib) ? a : b, other = subj === a ? b : a;
  const name = subj.names[subj.names.length - 1] || subj.abbr;
  const after = bet.slice(Math.max(mention(bet, subj), 0));
  const spread = after.match(/\s([+-]\d+(?:\.\d+)?)\b/);
  if (/\bML\b/.test(bet) || !spread) return { res: subj.score > other.score ? 'W' : subj.score < other.score ? 'L' : 'P', note: score };
  const m = subj.score + parseFloat(spread[1]) - other.score;
  return { res: m > 0 ? 'W' : m < 0 ? 'L' : 'P', note: score };
}

const TEST_LOG = [
  '2026-11-06 | Virginia Tech +6.5 (CFB, @ SMU) | -110 | DraftKings | Low | 1u ($2, returns $3.81) | 5:00 PM MT | placed: yes | result: pending',   // expect L
  '2026-11-06 | Nebraska @ Illinois Under 50.5 (CFB) | -110 | DraftKings | Low | 1u ($2, returns $3.81) | 6:00 PM MT | placed: yes | result: pending',   // W
  '2026-11-06 | TCU +7.5 alt spread (CFB, @ Arizona) | -133 | DraftKings | Low | 1u ($2, returns $3.50) | 8:15 PM MT | placed: yes | result: pending',   // W
  '2026-11-06 | PARLAY: VT +6.5 / NEB-ILL Under 50.5 / TCU +7.5 alt | +943 | DraftKings | 1u ($2, returns $20.86) | placed: yes | result: pending',   // L
  '2026-11-07 | Lightning ML @ Wild (NHL) | -142 | DraftKings | Low | 1u ($2, returns $3.41) | 6:10 PM MT | placed: yes | result: pending',   // W
  '2026-11-08 | Broncos @ Panthers Over 44.5 (NFL) | -108 | DraftKings | Low | 1u ($2, returns $3.85) | 11:00 AM MT | placed: no | result: pending',   // W
  '2026-11-08 | Bruins ML vs Panthers (NHL) | -135 | DraftKings | Low | 1u ($2, returns $3.48) | 11:00 AM MT | placed: no | result: pending',   // W
  '2026-11-08 | Packers +3 @ Patriots (NFL) | -108 | DraftKings | Low | 1u ($2, returns $3.85) | 2:25 PM MT | placed: no | result: pending',   // W
  '2026-11-08 | PARLAY: DEN-CAR Over 44.5 / Bruins ML / Packers +3 | +546 | DraftKings | 0.5u ($1, returns $6.46) | placed: no | result: pending',   // W
].join('\n');

(async () => {
  if (!cal.ready && !process.argv.includes('--test')) { console.log('grade: calendar not configured'); return; }
  const TEST = process.argv.includes('--test');   // re-grade Nov 6–8 (known results) without writing anything
  const log = TEST ? { description: TEST_LOG } : await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 400, ahead: 30 });
  if (!log) { console.log('grade: no picks log'); return; }
  const lines = String(log.description || '').split('\n'), today = cal.todayLocal();
  const orig = lines.slice();   // to apply only our changes onto a fresh copy at the end
  let changed = 0;
  const graded = {};   // date -> [res of singles]
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], p = l.split(' | ').map(s => s.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p[0] || '') || /^PARLAY:/i.test(p[1] || '')) continue;
    const date = p[0], bet = p[1] || '', sport = ((bet.match(/\((CFB|NFL|NHL|NBA|TT)\b/i) || [])[1] || '').toUpperCase();
    const pending = /result:\s*pending/i.test(l);
    (graded[date] ||= []);
    if (!pending) { const r = (l.match(/result:\s*(W|L|P|Push)\b/i) || [])[1]; graded[date].push(r ? r[0].toUpperCase() : '?'); continue; }
    if (!SPORT[sport] || date > today) { graded[date].push('?'); continue; }
    try {
      const games = (await scoreboard(sport, date)).filter(g => g.teams.length === 2 && g.teams.some(t => mention(bet, t) >= 0));
      const g = games.sort((x, y) => y.teams.filter(t => mention(bet, t) >= 0).length - x.teams.filter(t => mention(bet, t) >= 0).length)[0];
      if (!g || !g.done) { graded[date].push('?'); continue; }
      const { res, note } = grade(bet.replace(/\([^)]*\)/g, m => m.replace(/@/g, ' ')), g);
      const per = ppu(p[2]), st = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/), stakeU = st ? +st[1] : 1, stake$ = st ? +st[2] : null;
      if (per === null) { graded[date].push('?'); continue; }
      const u = res === 'W' ? stakeU * per : res === 'L' ? -stakeU : 0;
      const placed = (l.match(/placed:\s*(yes|slip|no|not yet)/i) || [])[1]?.toLowerCase();
      if (placed === 'not yet') lines[i] = l.replace(/placed:\s*not yet/i, 'placed: no');   // no slip by grading time
      const money = placed === 'yes' && stake$ !== null ? `, ${fd(res === 'W' ? stake$ * per : res === 'L' ? -stake$ : 0)}` : placed === 'slip' ? ' (see slip)' : ' (not placed, no $)';
      lines[i] = lines[i].replace(/result:\s*pending/i, `result: ${res} (${note}) ${fu(u)}${money} (auto-graded)`);
      graded[date].push(res); changed++;
      console.log(`graded ${date} ${bet}: ${res} ${note}`);
    } catch (e) { console.log(`grade ${date} ${bet}: ${e.message}`); graded[date].push('?'); }
  }
  // parlays: same picks as that day's singles
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], p = l.split(' | ').map(s => s.trim());
    if (!/^PARLAY:/i.test(p[1] || '') || !/result:\s*pending/i.test(l)) continue;
    const rs = graded[p[0]] || [];
    if (!rs.length || rs.includes('?') || (!rs.includes('L') && rs.includes('P'))) continue;
    const res = rs.includes('L') ? 'L' : 'W', per = ppu(p[2]), st = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/);
    if (per === null || !st) continue;
    const u = res === 'W' ? +st[1] * per : -st[1];
    const placed = (l.match(/placed:\s*(yes|slip|no|not yet)/i) || [])[1]?.toLowerCase();
    let nl = placed === 'not yet' ? l.replace(/placed:\s*not yet/i, 'placed: no') : l;
    const money = placed === 'yes' ? `, ${fd(res === 'W' ? +st[2] * per : -st[2])}` : placed === 'slip' ? ' (see slip)' : ' (not placed, no $)';
    lines[i] = nl.replace(/result:\s*pending/i, `result: ${res} (${res === 'W' ? 'all legs won' : 'a leg lost'}) ${fu(u)}${money} (auto-graded)`);
    changed++; console.log(`graded parlay ${p[0]}: ${res}`);
  }
  if (!changed) { console.log('grade: nothing new to grade'); return; }
  if (DRY || TEST) { console.log(lines.filter(x => /auto-graded/.test(x)).join('\n')); return; }
  // the ESPN lookups took a while: re-read the log and change only the lines we graded (others may have written meanwhile)
  const swap = new Map(orig.map((l, i) => [l, lines[i]]).filter(([a, b]) => a !== b));
  const live = String((await cal.get(log.id)).description || '').split('\n');
  await cal.patch(log.id, { description: live.map(l => swap.get(l) ?? l).join('\n') });
  console.log(`grade: ${changed} line(s) graded`);
})().catch(e => { console.error('grade:', e.message); process.exit(1); });
