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
    const res = ((l.match(/result:\s*(.*)$/i) || [])[1] || '').trim();
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
async function archives() {
  return (await cal.search('PICKS-ARCHIVE', { back: 400, ahead: 1 })).filter(e => /picks archive/i.test(e.summary || '')).map(e => e.description || '');
}
module.exports = { rows, placedRows, compute, withCurrent, archives, yours };

if (require.main === module) (async () => {
  if (!cal.ready) { console.log('bankroll: calendar not connected'); return; }
  const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  if (!log) { console.log('bankroll: no picks log'); return; }
  const arch = await archives(), live = await cal.get(log.id).catch(() => log);
  const c = compute(live.description, arch), old = (String(live.description).match(/\| current \$([\d,.]+)/) || [])[1], oldP = (String(live.description).match(/placed bankroll \$([\d,.]+)/) || [])[1];
  console.log(`bankroll: picks $${c.current.toFixed(2)} (was $${old}); placed $${c.placed.current.toFixed(2)} (was $${oldP}); ${c.rows.length} pick rows`);
  const same = (a, b) => a && Math.abs(+a.replace(/,/g, '') - b) < 0.005;
  if (same(old, c.current) && same(oldP, c.placed.current) && !process.argv.includes('--force')) return;
  if (DRY) return;
  const fresh = await cal.get(log.id);                        // re-read right before writing; only the BANKROLL line changes
  await cal.patch(log.id, { description: withCurrent(fresh.description, compute(fresh.description, arch), cal.nowLocal()) });
  console.log('bankroll: updated');
})().catch(e => { console.error('bankroll: ' + e.message); process.exit(1); });
