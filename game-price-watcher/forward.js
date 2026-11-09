// Calendar → Discord DM forwarder (replaces the old Slack DM).
// Every 5 minutes (from tick.yml): new "Personal: …" events that ping (have a popup) are sent to Bradley as a
// Discord DM from the bot: morning brief, bills, lessons, workouts, reminders, price drops, …
// Skipped: silent logs/watches, done items (✅), work events (anything not "Personal:"), and alerts the watchers
// already post in their own Discord channels (tee times, ticket drops, powder).
// Env: GCAL_SA_KEY, GCAL_CALENDAR_ID, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID (any channel in the server, to find it),
// optional DISCORD_OWNER_ID (else the server owner gets the DMs).
'use strict';
const fs = require('fs');
const cal = require('./gcal');
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const TOKEN = one(process.env.DISCORD_BOT_TOKEN), CHANNEL = one(process.env.DISCORD_CHANNEL_ID);
const STATE = 'state/forwarded.json';
const SKIP = /^Personal:\s*(tee time open|ticket drop|game-day ticket drop|powder alert|powder day|golf courses open)\b/i;

const dapi = async (method, path, body) => {
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Discord ${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};
const pings = e => e.reminders?.useDefault || (e.reminders?.overrides || []).some(o => o.method === 'popup');
const when = e => {
  const s = e.start?.dateTime || e.start?.date; if (!s) return '';
  const d = new Date(e.start.dateTime ? s : s + 'T12:00:00');
  if (d - Date.now() < 30 * 60e3) return '';   // happening now: no need to say when
  return '📅 ' + d.toLocaleString('en-US', { timeZone: cal.TZ, weekday: 'short', month: 'short', day: 'numeric', ...(e.start.dateTime ? { hour: 'numeric', minute: '2-digit' } : {}) });
};
const clean = t => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split('\n').filter(l => !/^\s*(Pocket ID|Calendar note ID|Done via Pocket ID):/i.test(l) && !/^\s*[A-Z]+(-[A-Z]+)+:\s/.test(l) && !/^\s*[A-Z]+(-[A-Z]+)+\s*$/.test(l))
  .join('\n').replace(/\n{3,}/g, '\n\n').trim();

(async () => {
  if (!cal.ready || !TOKEN || !CHANNEL) { console.log('forwarder: calendar or Discord bot not configured'); return; }
  let st = null; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const first = !st; st ||= { seen: [] };
  const seen = new Set(st.seen);
  // events created in the last 3 hours (recurring ones once, not every instance)
  const since = new Date(Date.now() - 3 * 3600e3);
  const j = await cal.api('GET', '/events', null, { updatedMin: since.toISOString(), showDeleted: false, maxResults: 250 });
  const fresh = (j.items || []).filter(e => e.status !== 'cancelled' && new Date(e.created) >= since && !seen.has(e.id))
    .filter(e => /^Personal:/i.test(e.summary || '') && !SKIP.test(e.summary) && pings(e))
    .sort((a, b) => new Date(a.created) - new Date(b.created));
  for (const e of (j.items || [])) if (new Date(e.created) >= since) seen.add(e.id);
  if (first) { console.log(`forwarder: first run, marked ${seen.size} recent events as seen`); }
  else if (fresh.length) {
    let owner = one(process.env.DISCORD_OWNER_ID);
    if (!owner) { const ch = await dapi('GET', `/channels/${CHANNEL}`); owner = (await dapi('GET', `/guilds/${ch.guild_id}`)).owner_id; }
    const dm = await dapi('POST', '/users/@me/channels', { recipient_id: owner });
    for (const e of fresh.slice(0, 10)) {
      const title = e.summary.replace(/^Personal:\s*/i, '');
      const text = [`**${title}**`, when(e), clean(e.description)].filter(Boolean).join('\n');
      await dapi('POST', `/channels/${dm.id}/messages`, { content: text.length > 1990 ? text.slice(0, 1975) + '\n… (more in My Life)' : text, allowed_mentions: { parse: [] } });
      console.log('forwarded:', e.summary);
    }
  } else console.log('forwarder: nothing new');
  fs.mkdirSync('state', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ seen: [...seen].slice(-600), at: new Date().toISOString() }));
})().catch(e => { console.error('forwarder:', e.message); process.exit(1); });
