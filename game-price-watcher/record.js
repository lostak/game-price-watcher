// Records bets Bradley placed on Claude's picks at HIS terms, from his bet slips:
//   node record.js --day=2026-11-14 --placed=Wild@-130,Oilers@-148 --parlay=Wild+Oilers@+196:2
// --placed  each pick (a word from it) @ his odds → "placed: yes (your odds -130)"; if the pick is already graded, the
//           dollars at his odds are written right away ("yours: W +$1.53"), otherwise the grader does it.
// --parlay  a parlay he built from some of the day's picks (legs @ his odds : stake $) → the day's parlay pick becomes
//           "placed: slip" and a SLIP line holds his real bet, settled from the legs' results when they're all in.
// Re-reads the picks log right before writing and changes only these lines. --dry prints instead of writing.
'use strict';
const gcal = require('./gcal');
const bank = require('./bankroll');
const ppu = o => { const n = parseFloat(o); return !n ? null : n > 0 ? n / 100 : 100 / Math.abs(n); };
const fd = d => (d > 0 ? '+' : d < 0 ? '-' : '') + '$' + Math.abs(d).toFixed(2);
const floor2 = n => Math.floor(n * 100 + 1e-9) / 100;   // books round winnings down to the cent
const res = l => ((l.match(/result:\s*(W|L|P|Push)\b/i) || [])[1] || '').toUpperCase().slice(0, 1);

function apply(desc, day, placed = [], parlay = null) {
  const lines = String(desc).split('\n'), done = [];
  const find = (word, isParlay) => lines.findIndex(l => l.startsWith(day + ' | ') && /\| PARLAY:/i.test(l) === !!isParlay && (!word || l.split(' | ')[1].toLowerCase().includes(word.toLowerCase())));
  for (const { word, odds } of placed) {
    const i = find(word, false); if (i < 0) throw new Error(`no ${day} pick matching "${word}"`);
    let l = lines[i].replace(/,\s*yours:[^|(]*/i, '').replace(/(result:[^|]*?\d+(?:\.\d+)?u),\s*[+-]\$[\d.,]+/i, '$1').replace(/\s*\(not placed, no \$\)/i, '').replace(/\s*\(see slip\)/i, '');
    const logged = (l.split(' | ')[2] || '').trim().split(' ')[0], diff = parseFloat(odds) !== parseFloat(logged);
    l = l.replace(/placed:\s*(not yet|yes|slip|no)(\s*\([^)]*\))?/i, 'placed: yes' + (diff ? ` (your odds ${odds})` : ''));
    const r = res(l), stake = +((l.match(/\du \(\$([\d.]+)/) || [])[1] || 0);
    if (r && stake) { const d = r === 'W' ? floor2(stake * ppu(diff ? odds : logged)) : r === 'L' ? -stake : 0;
      l = l.replace(/(result:\s*(?:W|L|P|Push)\b[^|]*?[+-]?\d+(?:\.\d+)?u)/i, m => m + (diff ? `, yours: ${r} ${fd(d)}` : `, ${fd(d)}`)); }
    lines[i] = l; done.push(l.split(' | ')[1]);
  }
  if (parlay) {
    const pi = find(null, true); if (pi < 0) throw new Error(`no ${day} parlay pick`);
    const legs = parlay.legs.map(w => { const i = find(w, false); if (i < 0) throw new Error(`no ${day} pick matching "${w}"`); return lines[i]; });
    lines[pi] = lines[pi].replace(/placed:\s*(not yet|yes|slip|no)(\s*\([^)]*\))?/i, 'placed: slip').replace(/\s*\(not placed, no \$\)/i, ' (see slip)');
    const rs = legs.map(res), win = floor2(parlay.stake * (legs.length ? ppu(parlay.odds) : 0));
    const status = rs.includes('L') ? `lost -$${parlay.stake.toFixed(2)}` : rs.every(x => x === 'W') ? `won +$${win.toFixed(2)}` : 'open';
    const names = legs.map(l => l.split(' | ')[1].replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+[@v].*$/, '').trim());
    const slip = `SLIP: ${day} | Parlay: ${names.join(' / ')} | ${parlay.odds} | $${parlay.stake.toFixed(2)} to win $${win.toFixed(2)} | DraftKings | ${status}`;
    let si = lines.findIndex(l => /^SLIPS\b/.test(l)); if (si < 0) { si = lines.findIndex(l => l.trim() === 'PICKS-LOG'); lines.splice(si, 0, "SLIPS (Bradley's actual bets from uploaded bet slips; the real price and stake – grade these for the bankroll):"); }
    const end = lines.findIndex((l, j) => j > si && !/^SLIP:/.test(l));
    if (!lines.some(l => l === slip)) lines.splice(end < 0 ? si + 1 : end, 0, slip);
    done.push(slip);
  }
  return { desc: lines.join('\n'), done };
}
module.exports = { apply };

if (require.main === module) (async () => {
  const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
  const day = arg('day'), placed = arg('placed') ? arg('placed').split(',').map(x => { const [word, odds] = x.split('@'); return { word, odds }; }) : [];
  const pm = arg('parlay').match(/^(.+)@([+-]\d+):([\d.]+)$/), parlay = pm ? { legs: pm[1].split('+'), odds: pm[2], stake: +pm[3] } : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (!placed.length && !parlay)) throw new Error('usage: --day=YYYY-MM-DD --placed=Word@-130,… --parlay=Word+Word@+196:2');
  const log = await gcal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  const live = await gcal.get(log.id), r = apply(live.description, day, placed, parlay);
  const archives = await bank.archives(), c = bank.compute(r.desc, archives), out = bank.withCurrent(r.desc, c, gcal.nowLocal());
  console.log(r.done.join('\n') + `\nplaced bankroll → $${c.placed.current.toFixed(2)}, picks bankroll $${c.current.toFixed(2)}`);
  if (process.argv.includes('--dry')) return;
  await gcal.patch(log.id, { description: out }); console.log('recorded');
})().catch(e => { console.error('record:', e.message); process.exit(1); });
