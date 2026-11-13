// Keeps the picks log's "BANKROLL: … | current $X (…) | …" figure right, in code (it used to be recomputed by the
// Claude betting task, so it only moved when that ran and only knew bets marked placed).
// current = anchor + every placed bet settled after it. The anchor is the newest "BALANCE CHECK:" line (Bradley's real
// DraftKings balance, from the "balance 123.45" Discord command or My Life) or, with none, the $100 start on Nov 6.
// Counted: pick lines with "placed: yes" and a $ result, and SLIP lines with a $ result (placed: slip lines are
// skipped – their SLIP line is the real bet). Archived weeks (PICKS-ARCHIVE) are included.
'use strict';
const cal = require('./gcal');
const START = 100;
const DRY = process.argv.includes('--dry');

function rows(text) {          // [{date, key, amt (settled $ or null), stake (pending $)}]
  const out = [];
  for (const l of String(text || '').split('\n')) {
    let m = l.match(/^SLIP:\s*(\d{4}-\d{2}-\d{2}) \| (.*)$/);
    if (m) {
      const f = m[2].split(' | '), last = f[f.length - 1] || '', amt = last.match(/([+-])\$\s?([\d,]+(?:\.\d+)?)/);
      const stake = (m[2].match(/\$([\d.]+) to win/) || [])[1];
      out.push({ date: m[1], key: 'SLIP ' + f[0].slice(0, 60), amt: amt && /\b(won|lost|win|loss|push|cashed|void)\b/i.test(last) ? (amt[1] === '-' ? -1 : 1) * +amt[2].replace(/,/g, '') : /\bpush|void\b/i.test(last) ? 0 : null, stake: +stake || 0 });
      continue;
    }
    m = l.match(/^(\d{4}-\d{2}-\d{2}) \| ([^|]+) \|/);
    if (!m || !/placed:\s*yes\b/i.test(l)) continue;
    const res = (l.match(/result:\s*(.*)$/i) || [])[1] || '', amt = res.match(/([+-])\$\s?([\d,]+(?:\.\d+)?)/);
    const stake = (l.match(/\du \(\$([\d.]+)/) || [])[1];
    out.push({ date: m[1], key: m[2].trim().slice(0, 60), amt: amt ? (amt[1] === '-' ? -1 : 1) * +amt[2].replace(/,/g, '') : /^\s*(P|push|void)\b/i.test(res) ? 0 : null, stake: +stake || 0 });
  }
  return out;
}
// Newest "BALANCE CHECK: 2026-11-13 3:45 PM | $87.50 shown | +$4.00 pending stakes | bankroll $91.50 | in it: k1; k2"
function anchor(desc) {
  const ls = String(desc || '').split('\n').filter(l => /^BALANCE CHECK:/.test(l));
  const l = ls[ls.length - 1]; if (!l) return null;
  const date = (l.match(/(\d{4}-\d{2}-\d{2})/) || [])[1], bank = (l.match(/bankroll \$([\d,.]+)/) || [])[1];
  const inIt = ((l.match(/in it: (.*)$/) || [])[1] || '').split('; ').map(s => s.trim()).filter(s => s && s !== 'none');
  return date && bank ? { date, bank: +bank.replace(/,/g, ''), inIt: new Set(inIt), line: l } : null;
}
function compute(desc, archives = []) {
  const all = [...archives.map(rows).flat(), ...rows(desc)];
  const a = anchor(desc);
  let cur = a ? a.bank : START, pending = 0, last = null;
  for (const r of all) {
    if (r.amt === null) { pending += r.stake; continue; }
    if (a && (r.date < a.date || (r.date === a.date && a.inIt.has(r.key)))) continue;
    cur += r.amt; if (!last || r.date > last) last = r.date;
  }
  return { current: Math.round(cur * 100) / 100, pending: Math.round(pending * 100) / 100, last, anchor: a, rows: all };
}
// The line Bradley's "balance 87.50" adds: shown balance + stakes of placed bets still open = bankroll
function balanceLine(desc, archives, shown, when) {
  const all = [...archives.map(rows).flat(), ...rows(desc)], today = cal.todayLocal();
  const open = all.filter(r => r.amt === null).reduce((s, r) => s + r.stake, 0);
  const inIt = all.filter(r => r.date === today && r.amt !== null).map(r => r.key);
  return `BALANCE CHECK: ${today} ${when} | $${shown.toFixed(2)} shown at DraftKings | +$${open.toFixed(2)} open stakes | bankroll $${(shown + open).toFixed(2)} | in it: ${inIt.join('; ') || 'none'}`;
}
function withCurrent(desc, c, stamp) {
  const lines = String(desc).split('\n'), i = lines.findIndex(l => /^BANKROLL:/.test(l));
  if (i < 0) return desc;
  const note = `current $${c.current.toFixed(2)} (placed bets only${c.anchor ? `, from your ${c.anchor.date.slice(5).replace('-', '/')} balance check` : ''}${c.last ? `, settled through ${c.last.slice(5).replace('-', '/')}` : ''}${c.pending ? `, $${c.pending.toFixed(2)} in open bets` : ''}; auto ${stamp})`;
  lines[i] = /\| current \$[^|]*/.test(lines[i]) ? lines[i].replace(/\| current \$[^|]*?(?=( \| |$))/, '| ' + note) : lines[i] + ' | ' + note;
  return lines.join('\n');
}
async function archives() {
  return (await cal.search('PICKS-ARCHIVE', { back: 400, ahead: 1 })).filter(e => /picks archive/i.test(e.summary || '')).map(e => e.description || '');
}
module.exports = { rows, anchor, compute, balanceLine, withCurrent, archives };

if (require.main === module) (async () => {
  if (!cal.ready) { console.log('bankroll: calendar not connected'); return; }
  const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  if (!log) { console.log('bankroll: no picks log'); return; }
  const arch = await archives(), live = await cal.get(log.id).catch(() => log);
  const c = compute(live.description, arch), old = (String(live.description).match(/\| current \$([\d,.]+)/) || [])[1];
  console.log(`bankroll: $${c.current.toFixed(2)} (was $${old}); ${c.rows.length} placed rows; open $${c.pending}`);
  if (old && Math.abs(+old.replace(/,/g, '') - c.current) < 0.005 && !process.argv.includes('--force')) return;
  if (DRY) return;
  const fresh = await cal.get(log.id);                        // re-read right before writing; only the BANKROLL line changes
  await cal.patch(log.id, { description: withCurrent(fresh.description, compute(fresh.description, arch), cal.nowLocal()) });
  console.log('bankroll: updated');
})().catch(e => { console.error('bankroll: ' + e.message); process.exit(1); });
