// Keeps the "Personal: picks log" under Google Calendar's ~8,192-character description limit (past it, Google silently
// cuts the end off – the SLIPS block and the PICKS-LOG marker everything searches for). Graded pick lines and settled
// SLIP lines older than KEEP_DAYS move to weekly archive events "Personal: picks archive – week of Nov 2" (silent, marker
// PICKS-ARCHIVE), which the web/desktop/Android bet history also reads. Totals lines at the top are untouched: they
// already count everything. Run from tick.yml once a night, and any time the log grows past SOFT chars.
// Usage: node logroll.js [--dry] [--force]
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force');
const KEEP_DAYS = 7, SOFT = 6500, HARD = 7800, ARCH_MAX = 7500;
const STATE = 'state/logroll.json';

const dayAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const monday = d => { const x = new Date(d + 'T12:00:00Z'); const k = (x.getUTCDay() + 6) % 7; return dayAdd(d, -k); };
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateOf = l => (l.replace(/^SLIP:\s*/, '').match(/^(\d{4}-\d{2}-\d{2}) \|/) || [])[1];
const settled = l => /^SLIP:/.test(l) ? /\|\s*(won|lost|push|void|cashed)/i.test(l) : /result:\s*(W|L|P|Push|void)\b/i.test(l) && !/result:\s*pending/i.test(l);

(async () => {
  if (!gcal.ready) { console.log('logroll: calendar not connected'); return; }
  const today = gcal.todayLocal(), st = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  const log = await gcal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 });
  if (!log) { console.log('logroll: no picks log'); return; }
  const live = await gcal.get(log.id);                       // freshest copy right before editing
  const desc = live.description || '', len = desc.length;
  const nightly = st.date !== today && +new Date().toLocaleTimeString('en-GB', { timeZone: gcal.TZ, hour: '2-digit' }) >= 2;
  if (!FORCE && !nightly && len < SOFT) { console.log(`logroll: picks log ${len} chars – fine`); return; }
  let keepDays = KEEP_DAYS, lines = desc.split('\n'), moved = [];
  for (;;) {                                                  // tighten the window until the log fits comfortably
    const cutoff = dayAdd(today, -keepDays);
    moved = lines.filter(l => { const d = dateOf(l); return d && d < cutoff && settled(l); });
    const rest = lines.filter(l => !moved.includes(l)).join('\n');
    if (rest.length < HARD || keepDays <= 2) break;
    keepDays--;
  }
  if (!moved.length) { console.log(`logroll: nothing to archive (${len} chars)`); if (!DRY) { st.date = today; fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st)); } return; }
  // group by week; append to that week's archive (creating it, or a "(2)" part if the week's archive is full)
  const byWeek = {};
  for (const l of moved) (byWeek[monday(dateOf(l))] ||= []).push(l);
  for (const [wk, add] of Object.entries(byWeek)) {
    const title = `Personal: picks archive – week of ${nice(wk)}`;
    const found = (await gcal.search('PICKS-ARCHIVE', { back: 400, ahead: 1, max: 100 })).filter(e => (e.summary || '').startsWith(title));
    let target = found.sort((a, b) => (a.summary || '').localeCompare(b.summary || '')).pop();
    const body = d => (d || '').replace(/\n?PICKS-ARCHIVE\s*$/, '');
    const have = new Set(body(target?.description).split('\n'));
    const fresh = add.filter(l => !have.has(l));
    if (!fresh.length) continue;
    if (target && (body(target.description) + '\n' + fresh.join('\n')).length > ARCH_MAX) target = null;   // full: start part 2
    const header = `Archived picks and slips for the week of ${nice(wk)} (moved out of the picks log to keep it under Google's size limit; totals in the picks log already include them).`;
    if (DRY) { console.log(`logroll: would add ${fresh.length} line(s) to ${target ? target.summary : title + (found.length ? ` (${found.length + 1})` : '')}`); continue; }
    if (target) await gcal.patch(target.id, { description: body(target.description) + '\n' + fresh.join('\n') + '\nPICKS-ARCHIVE' });
    else await gcal.insert({ summary: title + (found.length ? ` (${found.length + 1})` : ''), description: [header, ...fresh, 'PICKS-ARCHIVE'].join('\n'),
      when: new Date(Date.parse(wk + 'T13:00:00Z')), popup: null });
    console.log(`logroll: archived ${fresh.length} line(s) → ${title}`);
  }
  if (DRY) { console.log(`logroll: would shrink the log from ${len} chars (keeping ${keepDays} days)`); return; }
  // re-read once more and remove exactly the archived lines (anything added meanwhile stays)
  const again = (await gcal.get(log.id)).description || '';
  const gone = new Set(moved);
  let next = again.split('\n').filter(l => !gone.has(l)).join('\n');
  next = next.replace(/^ROLLED-UP[^\n]*$/m, `ROLLED-UP: picks and slips older than ${keepDays} days are in the "Personal: picks archive – week of …" events (search PICKS-ARCHIVE); the totals above include them`);
  next = next.replace(/^PICKS \(last \d+ days\):/m, `PICKS (last ${keepDays} days):`);
  await gcal.patch(log.id, { description: next });
  console.log(`logroll: picks log ${len} → ${next.length} chars (kept ${keepDays} days, archived ${moved.length} lines)`);
  st.date = today; fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st));
})().catch(e => { console.error('logroll:', e.message); process.exit(1); });
