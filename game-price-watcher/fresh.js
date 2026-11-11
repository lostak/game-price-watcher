// Morning freshness check for the whole Life project (tick.yml, once a day from 7:40 AM Denver).
// The watchdog catches stopped loops; this catches data that quietly stopped updating – what the web app, desktop app,
// Android apps and the morning brief show. Silent when everything is current; otherwise one Discord DM listing what's
// stale and which job owns it. Run by hand with: node fresh.js --force   (--dry prints without DMing)
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const TOKEN = one(process.env.DISCORD_BOT_TOKEN), CHANNEL = one(process.env.DISCORD_CHANNEL_ID);
const STATE = 'state/fresh.json', TZ = 'America/Denver';
const FORCE = process.argv.includes('--force'), DRY = process.argv.includes('--dry');
const dayOf = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const hoursAgo = t => (Date.now() - Date.parse(t)) / 36e5;

const dapi = async (method, path, body) => {
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Discord ${path} ${r.status}`); return r.json();
};
async function dm(text) {
  const owner = one(process.env.DISCORD_OWNER_ID) || (await dapi('GET', `/guilds/${(await dapi('GET', `/channels/${CHANNEL}`)).guild_id}`)).owner_id;
  const id = (await dapi('POST', '/users/@me/channels', { recipient_id: owner })).id;
  await dapi('POST', `/channels/${id}/messages`, { content: text.slice(0, 1990), allowed_mentions: { parse: [] } });
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

(async () => {
  const today = gcal.todayLocal(), st = readJson(STATE) || {};
  if (st.date === today && !FORCE) { console.log('Freshness already checked today.'); return; }
  if (!gcal.ready) { console.log('Calendar not connected – skipping.'); return; }
  const label = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const stale = [], ok = [];
  const check = (good, okText, badText) => (good ? ok : stale).push(good ? okText : badText);

  // 1) Betting: today's slate, the picks log refreshed this morning, nothing left ungraded, #general post
  const slate = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  check(!!slate, 'betting slate', `Betting slate for ${label} is missing (Claude betting-slate task).`);
  const log = await gcal.findByTitle('Personal: picks log', 'picks log').catch(() => null);
  if (!log) stale.push('Picks log not found on the calendar.');
  else {
    check(dayOf(log.updated) === today, 'picks log', `Picks log last updated ${dayOf(log.updated)} – the morning bankroll/totals update didn't run (Claude betting-slate task).`);
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
    const ungraded = (log.description || '').split('\n').filter(l => /^\d{4}-\d{2}-\d{2} \|/.test(l) && l.slice(0, 10) <= twoDaysAgo && /result:\s*pending/i.test(l));
    check(!ungraded.length, 'grading', `${ungraded.length} pick${ungraded.length === 1 ? '' : 's'} from ${twoDaysAgo} or earlier still ungraded (grade.js / Claude betting task).`);
  }
  const picks = readJson('state/picks.json');
  if (slate && /^\s*[-•]\s+/m.test((slate.description || '').split(/^PICKS:/m)[1] || '')) check(picks?.date === today, '#general', `Today's picks aren't marked as posted to #general (picks.js).`);

  // 2) Morning brief
  const brief = (await gcal.search('morning brief', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes(`morning brief – ${label}`));
  check(!!brief, 'morning brief', `Morning brief for ${label} is missing (brief.js).`);

  // 3) Ticket prices: the hourly "elsewhere" scrape and the Gametime game list
  const ew = readJson('state/elsewhere.json');
  if (ew?.at) check(hoursAgo(ew.at) < 3, 'ticket comparison', `TickPick/SeatGeek/Vivid prices last read ${Math.round(hoursAgo(ew.at))} h ago (elsewhere.js).`);
  const games = readJson('state/games.json');
  const gAt = games?.at || games?.updated || (fs.existsSync('state/games.json') ? fs.statSync('state/games.json').mtime.toISOString() : null);
  if (gAt) check(hoursAgo(gAt) < 30, 'game list', `Gametime game list last refreshed ${Math.round(hoursAgo(gAt))} h ago (watch.js).`);

  // 4) Golf: the watcher's app file (Tee Watch + daily report)
  try {
    const r = await fetch('https://raw.githubusercontent.com/lostak/golf-watcher/main/golf-watcher/state/app.json?t=' + Date.now());
    const app = r.ok ? await r.json() : null;
    if (!app) stale.push(`Golf app data unreadable (golf-watcher state/app.json, HTTP ${r.status}).`);
    else {
      check(hoursAgo(app.updated) < 26, 'golf data', `Golf watcher data last updated ${Math.round(hoursAgo(app.updated))} h ago (golf-watcher).`);
      check(app.report?.date === today, 'golf report', `Today's golf daily report hasn't run (golf-watcher daily-report, due 7:15 AM).`);
    }
  } catch (e) { stale.push('Golf app data unreadable: ' + e.message.slice(0, 80)); }

  console.log('Current: ' + ok.join(', '));
  if (stale.length) console.log('Stale:\n- ' + stale.join('\n- '));
  if (!DRY) {
    if (stale.length && TOKEN && CHANNEL) await dm(`🕖 Morning check – ${stale.length} thing${stale.length === 1 ? ' is' : 's are'} out of date:\n• ${stale.join('\n• ')}\n(Current: ${ok.join(', ') || 'nothing else checked'}.)`).catch(e => console.log('DM failed: ' + e.message));
    fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ date: today, stale }) + '\n');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
