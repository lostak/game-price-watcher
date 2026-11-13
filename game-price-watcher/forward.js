// Calendar → Discord DM forwarder (replaces the old Slack DM).
// Every 5 minutes (from tick.yml): new "Personal: …" events that ping (have a popup) are sent to Bradley as a
// Discord DM from the bot: morning brief, bills, lessons, workouts, reminders, price drops, …
// Skipped: silent logs/watches, done items (✅), work events (anything not "Personal:"), and alerts the watchers
// already post in their own Discord channels (tee times, ticket drops, powder).
// Two-way: Bradley's replies in that DM are read every 5 minutes too:
//   reply "done" to a forwarded alert → that event is marked done (✅, DONE line, popup off)
//   "placed all" / "placed parlay" / "placed oilers" → today's matching picks get placed: yes in the picks log
//   anything else → a "Claude: personal <text>" calendar note, which the Pocket processor handles (hourly 8 AM–7 PM)
// Env: GCAL_SA_KEY, GCAL_CALENDAR_ID, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID (any channel in the server, to find it),
// optional DISCORD_OWNER_ID (else the server owner gets the DMs).
'use strict';
const fs = require('fs');
const cal = require('./gcal');
const bank = require('./bankroll');
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

const reply = (dmId, ref, content) => dapi('POST', `/channels/${dmId}/messages`, { content: content.slice(0, 1990), allowed_mentions: { parse: [] }, ...(ref ? { message_reference: { message_id: ref, fail_if_not_exists: false } } : {}) });

// placed: yes for matching picks on the latest log date (today's picks); fills in dollars for picks already graded as not placed
function markPlaced(desc, words) {
  const lines = String(desc || '').split('\n'), dates = lines.map(l => (l.match(/^(\d{4}-\d{2}-\d{2}) \| /) || [])[1]).filter(Boolean).sort();
  // "placed yesterday all" / "placed 11/12 wild" / "placed nov 12 parlay" back-fill an earlier day
  const today = cal.todayLocal(), y0 = +today.slice(0, 4), MON = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  let want = null, w = words.trim();
  const yd = w.match(/^yesterday\b\s*/i), md = w.match(/^(\d{1,2})\/(\d{1,2})\b\s*/), mn = w.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?\b\s*/i);
  if (yd) { const t = new Date(today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); want = t.toISOString().slice(0, 10); w = w.slice(yd[0].length); }
  else if (md) { want = `${y0}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`; w = w.slice(md[0].length); }
  else if (mn && MON.includes(mn[1].toLowerCase())) { want = `${y0}-${String(MON.indexOf(mn[1].toLowerCase()) + 1).padStart(2, '0')}-${mn[2].padStart(2, '0')}`; w = w.slice(mn[0].length); }
  words = w || 'all';
  const day = want || (dates.includes(today) ? today : dates[dates.length - 1]);
  const all = /^(all|everything|them|all of them|it all)$/i.test(words.trim()), keys = words.toLowerCase().match(/[a-z0-9+.-]{3,}/g)?.filter(w => !/^(the|bet|bets|and|on|ml|pick|picks)$/.test(w)) || [];
  const hit = [];
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].split(' | '); if (p[0] !== day || !p[1] || !/placed:\s*(not yet|no)\b/i.test(lines[i])) continue;
    const bet = p[1].toLowerCase(), parlay = /^parlay:/.test(bet);
    if (!(all || (keys.includes('parlay') ? parlay : !parlay && keys.length && keys.every(k => bet.includes(k))))) continue;
    let l = lines[i].replace(/placed:\s*(not yet|no)\b/i, 'placed: yes');
    const m = l.match(/result:\s*\w+[^|]*?([+-]\d+(?:\.\d+)?)u \(not placed, no \$\)/i), sk = l.match(/(\d+(?:\.\d+)?)u \(\$(\d+(?:\.\d+)?)/);
    if (m && sk) { const d = +m[1] * (+sk[2] / +sk[1]); l = l.replace(/ \(not placed, no \$\)/, `, ${d < 0 ? '-' : '+'}$${Math.abs(d).toFixed(2)}`); }
    lines[i] = l; hit.push(p[1].replace(/^PARLAY:\s*/i, 'Parlay: '));
  }
  return { desc: lines.join('\n'), hit, day };
}

async function handleReplies(st, dmId, owner) {
  const q = st.dmCursor ? `?after=${st.dmCursor}&limit=50` : '?limit=1';
  const msgs = (await dapi('GET', `/channels/${dmId}/messages${q}`)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  if (!st.dmCursor) { st.dmCursor = msgs[0]?.id || '0'; return; }   // first run: start from now
  for (const m of msgs) {
    st.dmCursor = m.id;
    if (m.author?.id !== owner || m.author?.bot) continue;
    const text = String(m.content || '').trim(); if (!text) continue;
    const refEvent = m.message_reference?.message_id && st.sent?.[m.message_reference.message_id];
    try {
      if (/^(help|\?)$/i.test(text)) {
        await reply(dmId, m.id, 'Reply **done** to an alert to check it off. **placed all**, **placed parlay** or **placed oilers** marks today\'s picks as placed (**placed yesterday all** / **placed 11/12 wild** for an earlier day). Anything else goes to Claude as a "personal …" note (handled hourly, 8 AM–7 PM).');
      } else if (refEvent && /^(done|did it|finished|complete|✅|👍)\b/i.test(text)) {
        const ev = await cal.get(refEvent);
        if (/^✅/.test(ev.summary || '')) { await reply(dmId, m.id, 'Already checked off.'); continue; }
        await cal.patch(refEvent, { summary: '✅ ' + ev.summary, description: `DONE ${cal.todayLocal()} – via Discord\n${ev.description || ''}`, reminders: { useDefault: false, overrides: [] } });
        // a done rotation session also gets logged (the Pocket processor advances the rotation)
        const log = /ski workout/i.test(ev.summary) ? 'did ski workout' : /pool focus/i.test(ev.summary) ? 'practiced pool' : /betting lesson/i.test(ev.summary) ? 'did betting lesson' : null;
        const extra = text.replace(/^(done|did it|finished|complete|✅|👍)[\s,.:-]*/i, '');
        if (log) await cal.insert({ summary: `Claude: personal ${log}${extra ? ' – ' + extra.slice(0, 150) : ''}`, description: `From Bradley's Discord reply (${cal.nowLocal()}).`, when: new Date(), popup: null });
        await reply(dmId, m.id, '✅ Checked off: ' + ev.summary.replace(/^Personal:\s*/i, '') + (log ? ' – logged for the rotation (within the hour).' : ''));
      } else if (/^placed\b/i.test(text)) {
        const log = await cal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 400, ahead: 30 });
        if (!log) { await reply(dmId, m.id, "I couldn't find the picks log."); continue; }
        const live = await cal.get(log.id).catch(() => log);   // freshest copy right before editing
        const r = markPlaced(live.description, text.replace(/^placed\s*/i, '') || 'all');
        if (!r.hit.length) { await reply(dmId, m.id, `No unplaced pick on ${r.day} matches "${text}". Try **placed all**, **placed parlay** or a team name.`); continue; }
        const arch = await bank.archives().catch(() => []);
        await cal.patch(log.id, { description: bank.withCurrent(r.desc, bank.compute(r.desc, arch), cal.nowLocal()) });
        await reply(dmId, m.id, `💵 Marked placed (${r.day}): ${r.hit.join('; ')}. They count in YOUR BETS (your own record); the picks bankroll tracks every pick either way.`);
      } else {
        await cal.insert({ summary: 'Claude: personal ' + text.replace(/^personal[:\s]+/i, '').slice(0, 200), description: `${text}\n\nFrom Bradley's Discord DM to the bot (${cal.nowLocal()}).`, when: new Date(), popup: null });
        await reply(dmId, m.id, '📝 Sent to Claude. The Pocket processor handles it within the hour (8 AM–7 PM).');
      }
    } catch (e) { console.error('reply failed:', e.message); await reply(dmId, m.id, '⚠ That didn\'t work: ' + e.message.slice(0, 200)).catch(() => {}); }
  }
}

(async () => {
  if (!cal.ready || !TOKEN || !CHANNEL) { console.log('forwarder: calendar or Discord bot not configured'); return; }
  let st = null; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const first = !st; st ||= { seen: [] };
  st.sent ||= {};
  if (!st.owner || !st.dmId) {
    let owner = one(process.env.DISCORD_OWNER_ID);
    if (!owner) { const ch = await dapi('GET', `/channels/${CHANNEL}`); owner = (await dapi('GET', `/guilds/${ch.guild_id}`)).owner_id; }
    st.owner = owner; st.dmId = (await dapi('POST', '/users/@me/channels', { recipient_id: owner })).id;
  }
  await handleReplies(st, st.dmId, st.owner).catch(e => console.error('replies:', e.message));
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
    const dm = { id: st.dmId };
    for (const e of fresh.slice(0, 10)) {
      const title = e.summary.replace(/^Personal:\s*/i, '');
      const text = [`**${title}**`, when(e), clean(e.description)].filter(Boolean).join('\n');
      const sent = await dapi('POST', `/channels/${dm.id}/messages`, { content: text.length > 1990 ? text.slice(0, 1975) + '\n… (more in My Life)' : text, allowed_mentions: { parse: [] } });
      st.sent[sent.id] = e.id;   // so a "done" reply can find the event
      console.log('forwarded:', e.summary);
    }
  } else console.log('forwarder: nothing new');
  fs.mkdirSync('state', { recursive: true });
  const sentIds = Object.keys(st.sent).slice(-300);
  fs.writeFileSync(STATE, JSON.stringify({ seen: [...seen].slice(-600), owner: st.owner, dmId: st.dmId, dmCursor: st.dmCursor, sent: Object.fromEntries(sentIds.map(k => [k, st.sent[k]])), at: new Date().toISOString() }));
})().catch(e => { console.error('forwarder:', e.message); process.exit(1); });
