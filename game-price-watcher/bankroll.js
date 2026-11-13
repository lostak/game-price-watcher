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
function compute(desc, archives = []) {
  const all = [...archives.map(rows).flat(), ...rows(desc)];
  let cur = START, pending = 0, last = null;
  for (const r of all) {
    if (r.amt === null) { pending += r.stake; continue; }
    cur += r.amt; if (!last || r.date > last) last = r.date;
  }
  return { current: Math.round(cur * 100) / 100, pending: Math.round(pending * 100) / 100, last, rows: all };
}
function withCurrent(desc, c, stamp) {
  const lines = String(desc).split('\n'), i = lines.findIndex(l => /^BANKROLL:/.test(l));
  if (i < 0) return desc;
  const note = `current $${c.current.toFixed(2)} (Claude's picks only: every pick at its logged stake, placed or not${c.last ? `, settled through ${c.last.slice(5).replace('-', '/')}` : ''}${c.pending ? `, $${c.pending.toFixed(2)} riding on open picks` : ''}; auto ${stamp})`;
  lines[i] = /\| current \$[^|]*/.test(lines[i]) ? lines[i].replace(/\| current \$[^|]*?(?=( \| |$))/, '| ' + note) : lines[i] + ' | ' + note;
  return lines.join('\n');
}
async function archives() {
  return (await cal.search('PICKS-ARCHIVE', { back: 400, ahead: 1 })).filter(e => /picks archive/i.test(e.summary || '')).map(e => e.description || '');
}
module.exports = { rows, compute, withCurrent, archives };

if (require.main === module) (async () => {
  if (!cal.ready) { console.log('bankroll: calendar not connected'); return; }
  const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  if (!log) { console.log('bankroll: no picks log'); return; }
  const arch = await archives(), live = await cal.get(log.id).catch(() => log);
  const c = compute(live.description, arch), old = (String(live.description).match(/\| current \$([\d,.]+)/) || [])[1];
  console.log(`bankroll: $${c.current.toFixed(2)} (was $${old}); ${c.rows.length} pick rows; open $${c.pending}`);
  if (old && Math.abs(+old.replace(/,/g, '') - c.current) < 0.005 && !process.argv.includes('--force')) return;
  if (DRY) return;
  const fresh = await cal.get(log.id);                        // re-read right before writing; only the BANKROLL line changes
  await cal.patch(log.id, { description: withCurrent(fresh.description, compute(fresh.description, arch), cal.nowLocal()) });
  console.log('bankroll: updated');
})().catch(e => { console.error('bankroll: ' + e.message); process.exit(1); });
