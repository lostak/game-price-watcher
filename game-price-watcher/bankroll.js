// Keeps the picks log's "BANKROLL: … | current $X (…) | …" figure right, in code. It is a paper bankroll for Claude's
// picks only: $100 on Nov 6 plus the result of EVERY recommended single and parlay at its logged stake, placed or not.
// Bradley's own bets (SLIP lines, extra bets he makes) never count here – they're in YOUR BETS / Bet history only.
// A not-placed graded line carries units only ("+0.93u (not placed, no $)"); dollars = units × the line's $-per-unit
// ("1u ($2, …"). Archived weeks (PICKS-ARCHIVE) are included.
'use strict';
const cal = require('./gcal');
const START = 100;
const DRY = process.argv.includes('--dry');

function rows(text) {          // every pick line: [{date, key, amt (settled $ or null), stake ($)}]
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}) \| ([^|]+) \|/);
    if (!m) continue;
    const sk = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/), stake = sk ? +sk[2] : 0, perU = sk && +sk[1] ? +sk[2] / +sk[1] : 0;
    // the pick's own result only: "yours: W +$1.53" is Bradley's payout at his odds and belongs to the placed bankroll
    const res = ((l.match(/result:\s*(.*)$/i) || [])[1] || '').replace(/,\s*yours:[^|(]*/i, '').trim();
    let amt = null;
    if (res && !/^pending/i.test(res)) {
      const d = res.match(/([+-])\$\s?([\d,]+(?:\.\d+)?)/), u = res.match(/([+-]?\d+(?:\.\d+)?)u\b/);
      if (d) amt = (d[1] === '-' ? -1 : 1) * +d[2].replace(/,/g, '');
      else if (u && perU) amt = +u[1] * perU;
      else if (/^(P|push|void)\b/i.test(res)) amt = 0;
    }
    out.push({ date: m[1], key: m[2].trim().slice(0, 60), amt, stake });
  }
  return out;
}
// "placed: yes (your line -4, your odds -110)" → your terms; null fields = same as the pick
const yours = l => { const f = (l.match(/placed:\s*yes\s*\(([^)]*)\)/i) || [])[1] || ''; return { line: (f.match(/your line ([+-]?\d+(?:\.\d+)?)/i) || [])[1] || null, odds: (f.match(/your odds ([+-]\d+)/i) || [])[1] || null }; };
// Bradley's placed bankroll: only Claude's picks he placed, at his odds/line. A "placed: yes" line's dollars are its
// "yours: W +$1.82" result (or the plain "+$1.81" when placed at the logged terms); a "placed: slip" pick counts through
// its matching SLIP line (same date, shared team word). Extra bets of his own never count.
function placedRows(text) {
  const out = [], lines = String(text || '').split('\n'), slipPicks = [];
  for (const l of lines) {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}) \| ([^|]+) \|/); if (!m) continue;
    const pl = (l.match(/placed:\s*(not yet|yes|slip|no)/i) || [])[1]?.toLowerCase();
    if (pl === 'slip') { slipPicks.push({ date: m[1], w: words(m[2]) }); continue; }
    if (pl !== 'yes') continue;
    const sk = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/), stake = sk ? +sk[2] : 0, res = ((l.match(/result:\s*(.*)$/i) || [])[1] || '').trim();
    let amt = null;
    const y = res.match(/yours:\s*(W|L|P|push)\b\s*([+-])?\$?([\d,.]+)?/i), d = res.match(/([+-])\$\s?([\d,]+(?:\.\d+)?)/);
    if (y) amt = /^P|push/i.test(y[1]) ? 0 : y[3] ? (y[2] === '-' ? -1 : 1) * +y[3].replace(/,/g, '') : null;
    else if (/yours:\s*pending/i.test(res) || /^pending/i.test(res) || !res) amt = null;
    else if (d) amt = (d[1] === '-' ? -1 : 1) * +d[2].replace(/,/g, '');
    else if (/^(P|push|void)\b/i.test(res)) amt = 0;
    out.push({ date: m[1], key: m[2].trim().slice(0, 60), amt, stake });
  }
  for (const l of lines) {               // SLIPs standing in for a "placed: slip" pick
    const m = l.match(/^SLIP:\s*(\d{4}-\d{2}-\d{2}) \| (.*)$/); if (!m) continue;
    const f = m[2].split(' | '), w = words(f[0]), i = slipPicks.findIndex(p => p.date === m[1] && [...p.w].some(x => w.has(x)));
    if (i < 0) continue; slipPicks.splice(i, 1);
    const last = f[f.length - 1] || '', d = last.match(/([+-])\$\s?([\d,]+(?:\.\d+)?)/), stake = +((m[2].match(/\$([\d.]+) to win/) || [])[1] || 0);
    out.push({ date: m[1], key: 'SLIP ' + f[0].slice(0, 50), amt: d && /\b(won|lost|push|cashed|void)\b/i.test(last) ? (d[1] === '-' ? -1 : 1) * +d[2].replace(/,/g, '') : /\bpush|void\b/i.test(last) ? 0 : null, stake });
  }
  return out;
}
const STOPW = new Set('the and vs over under puck line parlay alt spread ml'.split(' '));
const words = s => new Set(String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOPW.has(w)));
function sum(rows) {
  let cur = START, pending = 0, last = null;
  for (const r of rows) { if (r.amt === null) { pending += r.stake; continue; } cur += r.amt; if (!last || r.date > last) last = r.date; }
  return { current: Math.round(cur * 100) / 100, pending: Math.round(pending * 100) / 100, last, n: rows.length };
}
function compute(desc, archives = []) {
  const all = [...archives.map(rows).flat(), ...rows(desc)];
  let cur = START, pending = 0, last = null;
  for (const r of all) {
    if (r.amt === null) { pending += r.stake; continue; }
    cur += r.amt; if (!last || r.date > last) last = r.date;
  }
  const placed = sum([...archives.map(placedRows).flat(), ...placedRows(desc)]);
  return { current: Math.round(cur * 100) / 100, pending: Math.round(pending * 100) / 100, last, rows: all, placed };
}
function withCurrent(desc, c, stamp) {
  const lines = String(desc).split('\n'), i = lines.findIndex(l => /^BANKROLL:/.test(l));
  if (i < 0) return desc;
  const d = x => x ? x.slice(5).replace('-', '/') : '';
  const note = `current $${c.current.toFixed(2)} (Claude's picks only: every pick at its logged stake, placed or not${c.last ? `, settled through ${d(c.last)}` : ''}${c.pending ? `, $${c.pending.toFixed(2)} riding on open picks` : ''}; auto ${stamp})`;
  const p = c.placed, pnote = `placed bankroll $${p.current.toFixed(2)} (only the picks you placed, at your odds and line; ${p.n} placed${p.pending ? `, $${p.pending.toFixed(2)} riding` : ''})`;
  let L = lines[i].replace(/ \| placed bankroll \$[^|]*?(?= \| |$)/, '')
    .replace(/ \| current (?!\$)[^|]*\| [\d.]+ \([^)]*\)/g, '');   // a segment garbled by an old "$1" replacement bug
  // keep exactly one "current $X (…)" segment
  const segs = L.split(' | '), cur = segs.filter(x => /^current \$/.test(x));
  if (cur.length > 1) L = segs.filter((x, j) => !/^current \$/.test(x) || j === segs.indexOf(cur[0])).join(' | ');
  L = /\| current \$[^|]*/.test(L) ? L.replace(/\| current \$[^|]*?(?=( \| |$))/, () => '| ' + note) : L + ' | ' + note;
  lines[i] = L.split(note).join(note + ' | ' + pnote);
  return lines.join('\n');
}
// CLV ("CLV: x of y known beat the close (…)"), in code as well: the morning Claude task used to count it by hand and
// got a pick wrong (Wake Forest ML -104 that closed +115 counted as beating the close). Singles only; a close note's own
// verdict ("– beat", "– did not beat") wins, otherwise the closing number is compared (better line, else better price;
// an equal close is known but not beaten). Same rule as my-life appcheck/check.js, which recomputes it independently.
function clvVerdict(l) {
  const close = (l.match(/close:\s*([^|]*)/i) || [])[1] || '';
  if (!close || /^(pending|unknown)/i.test(close.trim())) return null;
  if (/(did not|didn't|missed|worse than|lost to)\b/i.test(close)) return false;
  if (/\bbeat\b/i.test(close)) return true;
  const f = l.split(' | '), bet = f[1] || '', price = parseFloat(f[2]);
  const nums = close.replace(/\([^)]*\)/g, '').match(/[+-]?\d+(?:\.\d+)?/g) || [];
  const pay = o => o > 0 ? o / 100 : 100 / Math.abs(o);
  const tot = bet.match(/\b(Over|Under)\s+(\d+(?:\.\d+)?)/i), spr = !tot && !/\bML\b/i.test(bet) ? (bet.replace(/\([^)]*\)/g, '').match(/\s([+-]\d+(?:\.\d+)?)\b/) || [])[1] : null;
  if ((tot || spr) && nums.length >= 2) {
    const mine = tot ? +tot[2] : parseFloat(spr), theirs = tot ? Math.abs(parseFloat(nums[0])) : parseFloat(nums[0]), cp = parseFloat(nums[1]);
    const better = tot ? (/over/i.test(tot[1]) ? theirs - mine : mine - theirs) : mine - theirs;
    if (Math.abs(better) > 0.01) return better > 0;
    return pay(price) > pay(cp);
  }
  const cp = parseFloat(nums[nums.length - 1]);
  if (isNaN(cp) || isNaN(price)) return null;
  return pay(price) > pay(cp);
}
function clv(desc, archives = []) {
  const all = [...archives, desc].flatMap(t => String(t || '').split('\n')).filter(l => /^\d{4}-\d{2}-\d{2} \| /.test(l) && !/^\S+ \| PARLAY:/i.test(l));
  const v = all.map(l => ({ date: l.slice(0, 10), name: (l.split(' | ')[1] || '').replace(/\s+(ML\b|[+-]\d|Over\b|Under\b|@|vs\b|\().*$/i, '').trim(), ok: clvVerdict(l) })).filter(x => x.ok !== null);
  const last = v.map(x => x.date).sort().pop();
  let note = '';
  if (last) {
    const day = v.filter(x => x.date === last), and = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    const b = day.filter(x => x.ok).map(x => x.name), n = day.filter(x => !x.ok).map(x => x.name);
    const md = new Date(last + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    note = ` (${md}: ${[b.length ? `${and(b)} beat the close` : '', n.length ? `${and(n)} did not` : ''].filter(Boolean).join('; ')})`;
  }
  return { beat: v.filter(x => x.ok).length, known: v.length, line: `CLV: ${v.filter(x => x.ok).length} of ${v.length} known beat the close${note}` };
}
// replaces the CLV line's counts and note (only that line); added after the PICKS RECORD line if missing
function withClv(desc, c) {
  const lines = String(desc).split('\n'), i = lines.findIndex(l => /^CLV:/.test(l));
  if (i >= 0) lines[i] = c.line;
  else { const r = lines.findIndex(l => /^PICKS RECORD/.test(l)); if (r < 0 || !c.known) return desc; lines.splice(r + 1, 0, c.line); }
  return lines.join('\n');
}
// PICKS RECORD ("singles W-L-P, ±Xu | parlays W-L, ±Yu | combined ±Zu on Nu risked"), in code too: the morning Claude
// task counted it by hand and on Nov 20 it was still at Nov 18 (Nov 19's four graded picks never added). Every graded
// pick line (log + archives, placed or not), units from its own result (not "yours:"), risked = logged stake units of
// every graded line. Only the numbers in that line change; the rest of its wording stays. my-life appcheck/check.js
// recomputes the same totals independently.
function record(desc, archives = []) {
  const all = [...archives, desc].flatMap(t => String(t || '').split('\n')).filter(l => /^\d{4}-\d{2}-\d{2} \| /.test(l));
  const res = l => ((l.match(/result:\s*(W|L|P|Push)\b/i) || [])[1] || '').toUpperCase().slice(0, 1);
  const units = l => +((l.replace(/,\s*yours:.*$/i, '').match(/result:[^|]*?([+-]?\d+(?:\.\d+)?)u\b/i) || [])[1] || 0);
  const stake = l => +((l.match(/\| (\d+(?:\.\d+)?)u \(\$/) || [])[1] || 0);
  const g = all.filter(res), S = g.filter(l => !/^\S+ \| PARLAY:/i.test(l)), P = g.filter(l => /^\S+ \| PARLAY:/i.test(l));
  const n = (a, r) => a.filter(l => res(l) === r).length, u = a => Math.round(a.reduce((t, l) => t + units(l), 0) * 100) / 100;
  const sg = x => (x >= 0 ? '+' : '') + x.toFixed(2), risked = Math.round(g.reduce((t, l) => t + stake(l), 0) * 100) / 100;
  return { singles: [n(S, 'W'), n(S, 'L'), n(S, 'P')], parlays: [n(P, 'W'), n(P, 'L')], su: u(S), pu: u(P), risked,
    text: `singles ${n(S, 'W')}-${n(S, 'L')}-${n(S, 'P')}, ${sg(u(S))}u | parlays ${n(P, 'W')}-${n(P, 'L')}, ${sg(u(P))}u | combined ${sg(Math.round((u(S) + u(P)) * 100) / 100)}u on ${risked}u risked` };
}
function withRecord(desc, r) {
  const lines = String(desc).split('\n'), i = lines.findIndex(l => /^PICKS RECORD/.test(l));
  if (i < 0) return desc;
  lines[i] = lines[i].replace(/singles \d+-\d+-\d+,\s*[+-]?[\d.]+u \| parlays \d+-\d+,\s*[+-]?[\d.]+u \| combined [+-]?[\d.]+u on [\d.]+u risked/, () => r.text);
  return lines.join('\n');
}
async function archives() {
  return (await cal.search('PICKS-ARCHIVE', { back: 400, ahead: 1 })).filter(e => /picks archive/i.test(e.summary || '')).map(e => e.description || '');
}
// Rewrites the picks log's BANKROLL, CLV and PICKS RECORD lines from the pick lines (only when a figure changed).
// Run every 15 min by tick.yml AND by grade.js right after it grades: on Nov 21 the 1:41 PM app check landed between
// grade.js grading Navy ML / the CFB parlay and the next 15-min bankroll run, so the totals briefly lagged the lines.
async function refresh({ force = false, dry = false } = {}) {
  if (!cal.ready) { console.log('bankroll: calendar not connected'); return false; }
  const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  if (!log) { console.log('bankroll: no picks log'); return false; }
  const arch = await archives(), live = await cal.get(log.id).catch(() => log);
  const c = compute(live.description, arch), old = (String(live.description).match(/\| current \$([\d,.]+)/) || [])[1], oldP = (String(live.description).match(/placed bankroll \$([\d,.]+)/) || [])[1];
  console.log(`bankroll: picks $${c.current.toFixed(2)} (was $${old}); placed $${c.placed.current.toFixed(2)} (was $${oldP}); ${c.rows.length} pick rows`);
  const k = clv(live.description, arch), oldClv = (String(live.description).match(/^CLV:.*$/m) || [''])[0];
  console.log(`bankroll: CLV ${k.beat} of ${k.known} (was "${oldClv.slice(0, 40)}")`);
  const same = (a, b) => a && Math.abs(+a.replace(/,/g, '') - b) < 0.005;
  const clvSame = oldClv === k.line || (!oldClv && !k.known);
  const recSame = withRecord(live.description, record(live.description, arch)) === String(live.description);
  if (!recSame) console.log(`bankroll: PICKS RECORD -> ${record(live.description, arch).text}`);
  if (same(old, c.current) && same(oldP, c.placed.current) && clvSame && recSame && !force) return false;
  if (dry) return false;
  const fresh = await cal.get(log.id);                        // re-read right before writing; only the BANKROLL, CLV and PICKS RECORD lines change
  await cal.patch(log.id, { description: withRecord(withClv(withCurrent(fresh.description, compute(fresh.description, arch), cal.nowLocal()), clv(fresh.description, arch)), record(fresh.description, arch)) });
  console.log('bankroll: updated');
  return true;
}
module.exports = { rows, placedRows, compute, withCurrent, archives, yours, clvVerdict, clv, withClv, record, withRecord, refresh };

if (require.main === module) refresh({ force: process.argv.includes('--force'), dry: DRY })
  .catch(e => { console.error('bankroll: ' + e.message); process.exit(1); });
