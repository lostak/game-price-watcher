// Morning brief, built here instead of by Claude (Nov 9, 2026). Runs from tick.yml once a day after the betting slate
// is posted (or by 7:15 AM without it). Creates/updates "Personal: morning brief – <Day Mon D>" at 7:00 AM with a popup;
// the calendar → Discord forwarder DMs it to Bradley. Same sections as the old Claude prompt, minus LEAVE BY (needs maps).
'use strict';
const fs = require('fs');
const cal = require('./gcal');
const { byName } = require('./teams');
const { teamGames } = require('./gt');
const info = require('./pickinfo');
const STATE = 'state/brief.json', TZ = cal.TZ, UA = 'MyLife morning brief (github.com/lostak/game-price-watcher)';
const AURORA = [39.7294, -104.8319];
const SILENT = /^(Price watch:|Show watch:|Claude)|^Personal: (picks log|pool log|ski workout log|betting lesson log|car log|billers log|WhoStarts log|deliveries today|betting slate|life settings|golf watch|ticket watch|on-demand log|ski season log)/i;
const ALERT = /^Personal: (price drop|fare drop|ticket drop|game-day ticket drop|powder alert|powder day|show announced|tee time open|golf courses open)/i;
const BRIEFY = /^Personal: (morning brief|betting slate|ski workout|pool focus|betting lesson|ski weekend outlook|powder|ticket|price|show|deliveries|tee time open|Sunday reset|bills & renewals)/i;

function localAt(h, m, dayOffset = 0) {
  const today = cal.todayLocal(), probe = new Date(`${today}T12:00:00Z`);
  const off = (new Date(probe.toLocaleString('en-US', { timeZone: TZ })) - new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60e3;
  return new Date(Date.parse(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - off * 60e3 + dayOffset * 864e5);
}
const list = async (from, to, q) => (await cal.api('GET', '/events', null, { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 250, ...(q ? { q } : {}) })).items || [];
const fmtT = d => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtD = d => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
const startOf = e => e.start?.dateTime || e.start?.date;
const done = e => /^✅/.test(e.summary || '');
const pings = e => e.reminders?.useDefault || (e.reminders?.overrides || []).some(o => o.method === 'popup');
const nws = async url => { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } }); if (!r.ok) throw new Error('NWS ' + r.status); return r.json(); };

async function weather() {
  try {
    const p = await nws(`https://api.weather.gov/points/${AURORA[0]},${AURORA[1]}`);
    const [fc, hourly] = await Promise.all([nws(p.properties.forecast), nws(p.properties.forecastHourly)]);
    const per = fc.properties.periods, day = per.find(x => x.isDaytime) || per[0], night = per.find(x => !x.isDaytime);
    const line = `${day.name}: ${day.shortForecast}, high ${day.temperature}°F${night ? `, low ${night.temperature}°F` : ''}, wind ${day.windDirection} ${day.windSpeed}${day.probabilityOfPrecipitation?.value ? `, ${day.probabilityOfPrecipitation.value}% chance of precipitation` : ''}.`;
    return { line, hourly: hourly.properties.periods };
  } catch (e) { return { line: `(weather unavailable: ${e.message})`, hourly: [] }; }
}
const hourAt = (hourly, when) => hourly.find(h => Date.parse(h.startTime) <= +when && +when < Date.parse(h.endTime));

(async () => {
  if (!cal.ready) { console.log('brief: calendar not configured'); return; }
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const today = cal.todayLocal(), label = fmtD(localAt(12, 0));
  // done for today – unless it went out without the picks and the slate has turned up since (the betting task retries until 10:13)
  if (st.date === today && !process.argv.includes('--force')) {
    if (!st.noSlate) { console.log('brief: already done today'); return; }
    const evs = await list(localAt(0, 0), localAt(0, 0, 1));
    if (!evs.some(e => new RegExp(`^Personal: betting slate – ${label}$`, 'i').test(e.summary || ''))) { console.log('brief: done; still no slate'); return; }
    console.log('brief: slate arrived – adding the picks to today\'s brief');
  }
  const t0 = localAt(0, 0), t1 = localAt(0, 0, 1), now = new Date();
  const todayEv = await list(t0, t1);
  const slate = todayEv.find(e => new RegExp(`^Personal: betting slate – ${label}$`, 'i').test(e.summary || ''));
  if (!slate && !process.argv.includes('--force') && +new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', '') < 715) { console.log('brief: waiting for the betting slate'); return; }
  const wd = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }), weekend = wd === 'Sat' || wd === 'Sun';
  const W = await weather();
  const out = [];
  out.push(`WEATHER: ${W.line}`);

  // TODAY: timed events in order (skip silent logs/watches, the brief itself, and done items)
  const timed = todayEv.filter(e => e.start?.dateTime && !SILENT.test(e.summary || '') && !/^Personal: morning brief/i.test(e.summary || '') && !done(e));
  const work = e => !/^Personal/i.test(e.summary || '');
  const shown = weekend ? [...timed.filter(e => !work(e)), ...timed.filter(work)] : timed;
  if (shown.length) {
    out.push('TODAY:');
    for (let i = 0; i < shown.length; i++) {
      const e = shown[i], s = new Date(e.start.dateTime), prev = shown[i - 1];
      const flags = [s.getTime() < localAt(8, 0).getTime() ? 'early' : '', prev && prev.end?.dateTime && Date.parse(prev.end.dateTime) >= s.getTime() && !/^Personal/i.test(prev.summary) && work(e) ? '⚠ back-to-back' : ''].filter(Boolean);
      out.push(`- ${fmtT(s)} – ${String(e.summary).replace(/^Personal:\s*/i, '')}${flags.length ? ` (${flags.join(', ')})` : ''}`);
    }
  } else out.push(`TODAY: nothing scheduled${weekend ? ' – enjoy the weekend' : ''}.`);

  // TEE TIMES: booked in the next 7 days; weather for today/tomorrow
  const week = await list(t0, localAt(0, 0, 8));
  const tees = week.filter(e => /^Personal: ⛳ tee time/i.test(e.summary || '') && !done(e));
  if (tees.length) {
    out.push('TEE TIMES:');
    for (const e of tees) {
      const s = new Date(startOf(e)), h = hourAt(W.hourly, s);
      const wx = h ? ` – ${h.temperature}°F, ${h.shortForecast.toLowerCase()}, wind ${h.windSpeed}${h.temperature < 35 ? ' ⚠ frost delay likely' : ''}${/thunder/i.test(h.shortForecast) ? ' ⚠ lightning risk' : ''}` : '';
      out.push(`- ${fmtD(s)} ${fmtT(s)} – ${String(e.summary).replace(/^Personal: ⛳ tee time\s*–\s*/i, '')}${wx}`);
    }
  }

  // PICKS from the betting slate
  if (slate) {
    const d = String(slate.description || '').split('\n');
    const rec = d.find(l => /^RECORD:/.test(l)), mine = d.find(l => /^YOUR BETS:/.test(l)), br = d.find(l => /^BANKROLL:/.test(l));
    const i = d.findIndex(l => /^PICKS:/.test(l)), picks = i >= 0 ? d.slice(i + 1).filter(l => /^\s*-\s/.test(l)).slice(0, 3) : [];
    const par = d.find(l => /^PARLAY:/.test(l));
    const plog = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 }).catch(() => null);
    const rows = info.fromLog(plog && plog.description, today), games = info.fromSlate(slate.description);
    const tag = l => { const r = info.match(l.replace(/@\s*DraftKings.*$/i, ''), rows) || info.match(l.replace(/@\s*DraftKings.*$/i, ''), games); return r ? [r.sport, r.time && `${r.time} ${r.zone}`].filter(Boolean).join(' · ') : ''; };
    out.push('PICKS:', ...[rec, mine, br].filter(Boolean), ...picks.map(l => { const t = tag(l.replace(/^\s*-\s*/, '')); return t ? l.trim().replace(/^-\s*/, `- [${t}] `) : l.trim(); }), ...(par ? [par] : []), 'Full slate in today\'s betting slate event. Placed any? Tap "I placed this" in My Life or reply "placed …" here.');
  } else out.push('PICKS: no betting slate yet today.');

  // PERSONAL: due today, open to-dos, overdue (last 30 days)
  const recent = await list(localAt(0, 0, -30), t1);
  const personal = recent.filter(e => /^Personal/i.test(e.summary || '') && !done(e) && !SILENT.test(e.summary) && !BRIEFY.test(e.summary) && !ALERT.test(e.summary));
  const items = [];
  for (const e of personal) {
    if (/^Personal to-do/i.test(e.summary)) { for (const l of String(e.description || '').split('\n')) if (/^\s*☐/.test(l)) items.push(`${l.trim()} (${fmtD(startOf(e))})`); }
    else if (pings(e) && Date.parse(startOf(e)) < +t1) items.push(`${String(e.summary).replace(/^Personal:\s*/i, '')} – ${Date.parse(startOf(e)) < +t0 ? 'overdue since ' + fmtD(startOf(e)) : 'today ' + (e.start.dateTime ? fmtT(startOf(e)) : '')}`.trim());
  }
  if (items.length) out.push('PERSONAL:', ...items.slice(0, 15).map(x => '- ' + x));

  // DELIVERIES and TRAVEL
  const del = todayEv.find(e => /^Personal: deliveries today/i.test(e.summary || ''));
  if (del?.description) out.push('DELIVERIES:', ...String(del.description).split('\n').filter(Boolean).slice(0, 8).map(l => '- ' + l.trim()));
  const trips = (await list(t0, localAt(0, 0, 2))).filter(e => /^Personal: (✈|🏨)/.test(e.summary || '') && !done(e));
  if (trips.length) out.push('TRAVEL:', ...trips.map(e => `- ${fmtD(startOf(e))} ${e.start.dateTime ? fmtT(startOf(e)) : ''} – ${e.summary.replace(/^Personal:\s*/, '')}${(String(e.description || '').match(/^WEATHER:.*$/m) || [''])[0] ? ' · ' + String(e.description).match(/^WEATHER:.*$/m)[0] : ''}`));

  // GAME DAY: TEAMS from life settings, schedule from Gametime
  const set = await cal.findByTitle('Personal: life settings', 'LIFE-SETTINGS', { back: 730, ahead: 2 }).catch(() => null);
  const teams = ((String(set?.description || '').match(/^TEAMS:\s*(.+)$/m) || [])[1] || 'Denver Broncos, Colorado Avalanche, Denver Nuggets').split(',').map(s => byName(s.trim())).filter(Boolean);
  const games = [];
  for (const t of teams) {
    try {
      for (const g of (await teamGames(t.slug)).filter(g => g.date === today)) {
        const home = (t.full && g.home.toLowerCase().includes(t.name.toLowerCase())), opp = home ? g.away : g.home;
        const when = g.utc ? new Date(/Z$|[+-]\d\d:?\d\d$/.test(g.utc) ? g.utc : g.utc + 'Z') : localAt(+g.time.slice(0, 2), +g.time.slice(3, 5)), h = /empower|coors|dick's/i.test(g.venue) ? hourAt(W.hourly, when) : null;
        games.push(`- ${t.label || t.name} ${home ? 'vs' : '@'} ${opp} – ${fmtT(when)}${!g.utc && !home ? ' (local time)' : ''}${g.venue ? ' at ' + g.venue : ''}${h ? ` – ${h.temperature}°F, ${h.shortForecast.toLowerCase()}` : ''}`);
      }
    } catch (e) { console.log('games:', t.name, e.message); }
  }
  if (games.length) out.push('GAME DAY:', ...games);

  // ALERTS from the last 24 hours
  const alerts = recent.concat(week).filter((e, i, a) => a.findIndex(x => x.id === e.id) === i)
    .filter(e => ALERT.test(e.summary || '') && !done(e) && Date.parse(e.created) > Date.now() - 864e5);
  if (alerts.length) out.push('ALERTS:', ...alerts.map(e => `- ${e.summary.replace(/^Personal:\s*/, '')}${/tee time open/i.test(e.summary) ? ' – not booked yet' : ''}`));

  const title = `Personal: morning brief – ${label}`, description = out.join('\n');
  const existing = todayEv.find(e => /^Personal: morning brief/i.test(e.summary || ''));
  if (existing) await cal.patch(existing.id, { summary: title, description });
  else await cal.insert({ summary: title, description, when: localAt(7, 0) < now ? cal.nextQuarter() : localAt(7, 0), popup: 0 });
  console.log(`brief: ${existing ? 'updated' : 'created'} – ${shown.length} events, ${items.length} personal items, ${games.length} games, slate ${slate ? 'yes' : 'no'}`);
  st.date = today; st.noSlate = !slate; fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st));
})().catch(e => { console.error('brief:', e.message); process.exit(1); });
