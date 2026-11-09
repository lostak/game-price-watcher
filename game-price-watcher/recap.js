// Weekly betting recap (Sundays from 7 PM, once): "Personal: betting recap – week of <Mon D>" with a popup, which the
// calendar → Discord forwarder DMs to Bradley. Built from the picks log: your bets (placed only, dollars), the picks
// record (all recommendations, units), what skipped picks would have made, closing-line value, and splits.
'use strict';
const fs = require('fs');
const cal = require('./gcal');
const STATE = 'state/recap.json';
const ppu = price => { const o = parseFloat(String(price).replace(/[^\d+.-]/g, '')); return !o ? null : o > 0 ? o / 100 : 100 / Math.abs(o); };
const fu = u => (u >= 0 ? '+' : '-') + Math.abs(Math.round(u * 100) / 100) + 'u';
const fd = d => (d >= 0 ? '+' : '-') + '$' + Math.abs(d).toFixed(2);
const rec = a => `${a.filter(r => r.res === 'W').length}-${a.filter(r => r.res === 'L').length}${a.some(r => r.res === 'P') ? '-' + a.filter(r => r.res === 'P').length : ''}`;

function parse(desc) {
  const rows = [];
  for (const raw of String(desc || '').split('\n')) {
    const l = raw.trim(), slip = /^SLIP:/.test(l), p = l.replace(/^SLIP:\s*/, '').split(' | ').map(s => s.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p[0] || '')) continue;
    if (slip) {
      const st = p.slice(4).find(x => /^(won|lost|push)\b/i.test(x)); if (!st) continue;
      const d = parseFloat((st.match(/([+-])\$(\d+(?:\.\d+)?)/) || [])[0]?.replace('$', '') || 0), stake = +((p[3] || '').match(/\$(\d+(?:\.\d+)?)/) || [])[1] || 0;
      rows.push({ date: p[0], slip: true, mine: true, res: /^won/i.test(st) ? 'W' : /^lost/i.test(st) ? 'L' : 'P', dollars: d, stake$: stake, parlay: /parlay/i.test(p[1]) });
      continue;
    }
    const res = (l.match(/result:\s*(W|L|P|Push)\b/i) || [])[1]; if (!res) continue;
    const units = parseFloat((l.match(/result:[^|]*?([+-]\d+(?:\.\d+)?)u/) || [])[1]);
    const dm = l.match(/result:[^|]*?([+-])\$(\d+(?:\.\d+)?)/), st = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/);
    const placed = ((l.match(/placed:\s*(yes|slip|no|not yet)/i) || [])[1] || '').toLowerCase();
    rows.push({ date: p[0], bet: p[1], parlay: /^PARLAY:/i.test(p[1]), res: res[0].toUpperCase(), units: isNaN(units) ? 0 : units,
      stakeU: st ? +st[1] : 1, stake$: st ? +st[2] : 0, dollars: dm ? (dm[1] === '-' ? -1 : 1) * +dm[2] : null, placed, mine: placed === 'yes',
      sport: ((p[1].match(/\((CFB|NFL|NHL|NBA|TT)\b/i) || [])[1] || (/^PARLAY:/i.test(p[1]) ? 'Parlay' : 'Other')).toUpperCase(),
      conf: ((p.find(x => /^(Low|Medium|High)/i.test(x)) || '').match(/^(Low|Medium|High)/i) || [''])[0],
      clv: /(did not|didn't|missed|worse than) (beat )?(the )?close/i.test(l) ? false : /beat (the )?close/i.test(l) ? true : null });
  }
  return rows;
}

(async () => {
  if (!cal.ready) { console.log('recap: calendar not configured'); return; }
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const today = cal.todayLocal(), force = process.argv.includes('--force');
  if (st.date === today && !force) { console.log('recap: already sent'); return; }
  const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 400, ahead: 30 });
  if (!log) { console.log('recap: no picks log'); return; }
  const all = parse(log.description), hdr = String(log.description);
  const from = new Date(Date.parse(today + 'T12:00:00Z') - 6 * 864e5).toISOString().slice(0, 10);
  const wk = all.filter(r => r.date >= from && r.date <= today), picks = wk.filter(r => !r.slip), mine = wk.filter(r => r.mine);
  const sum = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);
  const out = [];
  const myD = sum(mine, r => r.dollars), myRisk = sum(mine, r => r.stake$);
  out.push(`YOUR BETS: ${mine.length ? `${rec(mine)}, ${fd(myD)}${myRisk ? `, ROI ${Math.round(myD / myRisk * 100)}%` : ''} on $${myRisk.toFixed(2)} risked` : 'none placed this week'}`);
  const bank = (hdr.match(/current \$([\d.,]+)/i) || [])[1]; if (bank) out.push(`BANKROLL: $${bank}`);
  const pu = sum(picks, r => r.units), pr = sum(picks, r => r.stakeU);
  out.push(`ALL PICKS: ${rec(picks)}, ${fu(pu)}${pr ? `, ROI ${Math.round(pu / pr * 100)}%` : ''} (every recommendation, placed or not)`);
  const skipped = picks.filter(r => r.placed === 'no');
  if (skipped.length) {
    const su = sum(skipped, r => r.units), unit = parseFloat((hdr.match(/unit \$([\d.]+)/i) || [])[1]) || 2;
    out.push(`SKIPPED: ${skipped.length} picks you didn't place went ${rec(skipped)}, ${fu(su)} (about ${fd(su * unit)} at your stakes)`);
  }
  const c = picks.filter(r => r.clv !== null);
  if (c.length) out.push(`CLOSING LINE: beat the close on ${c.filter(r => r.clv).length} of ${c.length} picks${c.length >= 3 ? (c.filter(r => r.clv).length / c.length >= 0.5 ? ' – a good sign even when results swing' : ' – the prices were late; bet earlier') : ''}`);
  const split = (key, label) => {
    const by = {}; for (const r of picks.filter(r => !r.parlay)) (by[r[key] || '–'] ||= []).push(r);
    const ks = Object.keys(by); if (ks.length < 2) return;
    out.push(`${label}: ` + ks.map(k => `${k} ${rec(by[k])} ${fu(sum(by[k], r => r.units))}`).join(' · '));
  };
  split('sport', 'BY SPORT'); split('conf', 'BY CONFIDENCE');
  const par = picks.filter(r => r.parlay); if (par.length) out.push(`PARLAYS: ${rec(par)}, ${fu(sum(par, r => r.units))}`);
  const season = all.filter(r => r.mine);
  out.push(`SEASON (your bets, last 30 days in the log): ${rec(season)}, ${fd(sum(season, r => r.dollars))}`);
  out.push('Full history: My Life → Sports → Bet history.');
  if (!picks.length && !mine.length) { console.log('recap: no graded picks this week'); st.date = today; fs.writeFileSync(STATE, JSON.stringify(st)); return; }
  const label = new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (process.argv.includes('--dry')) { console.log(out.join('\n')); return; }
  await cal.insert({ summary: `Personal: betting recap – week of ${label}`, description: out.join('\n'), when: cal.nextQuarter(), popup: 0 });
  console.log('recap: posted\n' + out.join('\n'));
  st.date = today; fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st));
})().catch(e => { console.error('recap:', e.message); process.exit(1); });
