// Daily picks lineup for the shared Discord "general" channel – generic, units only, nothing personal.
// Reads Bradley's own "Personal: betting slate – Sat Nov 7" calendar event (dollars, bankroll, books), strips it down
// to picks + units, and posts it once per morning (from 6:30 AM Denver). Run from tick.yml, the 5-minute loop, because
// GitHub's own schedule runs hours late (the my-life picks.yml schedule missed every morning slot).
// Posts as the bot (DISCORD_BOT_TOKEN), falling back to DISCORD_WEBHOOK_PICKS, then confirms the message is in #general.
// `--check` (tick.yml, 6:50 AM) verifies it's really there, retries once, and DMs Bradley if it isn't.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const STATE = 'state/picks.json', GENERAL = '1568311701701398641';
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';   // pasted secrets can carry a line break
const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force');
const BOOKS = /\s*@\s*(DraftKings|DK|FanDuel|FD|bet365|BetMGM|Caesars|ESPN ?Bet|Fanatics|BetRivers|Hard Rock)\b.*$/i;
const noMoney = s => s.replace(/\s*\([^)]*\$[^)]*\)/g, '').replace(/,?\s*[-+]?\$\s?[\d,.]+/g, '').replace(/\s{2,}/g, ' ').trim();

function build(desc, label) {
  const lines = String(desc || '').split('\n').map(l => l.trim());
  const out = [], label_ = /^[A-Z][A-Z /&-]{2,}:/;
  let inPicks = false, parlay = null, record = null;
  for (const l of lines) {
    if (/^RECORD:/.test(l)) record = noMoney(l.replace(/^RECORD:\s*(picks\s+)?/i, '').split('|')[0]).replace(/,\s*$/, '');
    if (/^PICKS:/.test(l)) { inPicks = true; continue; }
    if (/^PARLAY:/.test(l)) { inPicks = false; const p = l.replace(/^PARLAY:\s*/, '').split(' – '); parlay = `Parlay: ${p[0].replace(/\s*@\s*(DraftKings|DK|FanDuel|FD|bet365|BetMGM|Caesars|ESPN ?Bet|Fanatics|BetRivers|Hard Rock)\b/i, '')} – ${noMoney(p[1] || '')}`; continue; }
    if (label_.test(l)) inPicks = false;
    if (inPicks && /^[-•]\s+/.test(l)) {
      const p = l.replace(/^[-•]\s+/, '').split(' – ');
      const pick = p[0].replace(BOOKS, '').trim(), units = noMoney(p[1] || '');
      const conf = (p.find(x => /^(High|Medium|Low)$/i.test(x.trim())) || '').trim();
      const stop = (p.find(x => /^stop at /i.test(x.trim())) || '').trim();
      out.push(`• ${pick}${units ? ' – ' + units : ''}${conf ? ' – ' + conf.toLowerCase() + ' confidence' : ''}${stop ? ' – ' + stop : ''}`);
    }
  }
  if (!out.length) return null;
  return [`🎯 **Picks of the day – ${label}**`, ...out, parlay ? '• ' + noMoney(parlay) : null,
    record ? `Last results: ${record}.` : null, 'Lines move – confirm the price before betting.'].filter(Boolean).join('\n');
}


const TOKEN = () => one(process.env.DISCORD_BOT_TOKEN);
const dapi = async (method, path, body) => {
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`Discord ${method} ${path.split('?')[0]} → ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : {};
};
// The real test of "did it go through": today's lineup is visible in #general. null = couldn't read the channel.
async function inChannel(label) {
  if (!TOKEN()) return null;
  try { return (await dapi('GET', `/channels/${GENERAL}/messages?limit=50`)).some(m => /Picks of the day/i.test(m.content || '') && (m.content || '').includes(label)); }
  catch (e) { console.log('Reading #general failed: ' + e.message); return null; }
}
async function dmBradley(text) {                      // private heads-up when the post didn't land (never to #general)
  if (!TOKEN()) return;
  const owner = one(process.env.DISCORD_OWNER_ID) || (await dapi('GET', `/guilds/${(await dapi('GET', `/channels/${GENERAL}`)).guild_id}`)).owner_id;
  const dmId = (await dapi('POST', '/users/@me/channels', { recipient_id: owner })).id;
  await dapi('POST', `/channels/${dmId}/messages`, { content: text.slice(0, 1990), allowed_mentions: { parse: [] } });
}
// Every way we have to post, in order; the first that works wins. (The webhook died on Nov 9–10 with "Invalid Webhook
// Token" and the old code never fell back to the bot – so now the bot goes first and the webhook is only a backup.)
async function post(text) {
  const errs = [], body = { content: text.slice(0, 1990), allowed_mentions: { parse: [] } };
  if (TOKEN()) try { await dapi('POST', `/channels/${GENERAL}/messages`, body); return { via: 'bot', errs }; } catch (e) { errs.push('bot: ' + e.message); }
  const hook = one(process.env.DISCORD_WEBHOOK_PICKS);
  if (hook) try {
    const r = await fetch(hook + (hook.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return { via: 'webhook', errs }; errs.push(`webhook: ${r.status} ${(await r.text()).slice(0, 160)}`);
  } catch (e) { errs.push('webhook: ' + e.message); }
  if (!TOKEN() && !hook) errs.push('no DISCORD_BOT_TOKEN or DISCORD_WEBHOOK_PICKS secret');
  return { via: null, errs };
}

const CHECK = process.argv.includes('--check');
(async () => {
  const today = gcal.todayLocal(), state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  const save = extra => { fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ ...extra, date: extra.date ?? state.date, checked: extra.checked ?? (state.checked === today ? today : undefined) }) + '\n'); };
  const label = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');

  // --check (6:50 AM, once): make sure today's lineup really is in #general; if not, retry once and DM what went wrong.
  if (CHECK) {
    if (state.checked === today) { console.log('Already checked today.'); return; }
    let ok = await inChannel(label), why = state.error && state.errorDate === today ? state.error : null;
    if (ok === false && gcal.ready) {
      const ev = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
      const text = ev && build(ev.description, label);
      if (!ev) why = `the betting slate for ${label} isn't on the calendar (the Claude betting task didn't run or didn't finish)`;
      else if (!text) { console.log('No picks today – nothing should be posted.'); ok = true; }
      else if (/\$/.test(text)) why = 'the lineup still had a $ amount, so it was held back';
      else { const r = await post(text); if (r.via && await inChannel(label)) { ok = true; console.log('Check: was missing – posted now via ' + r.via); save({ date: today, posted: new Date().toISOString(), via: r.via, checked: today });
               await dmBradley(`✅ Today's picks hadn't reached #general by the morning check – posted them now (via ${r.via}).${state.error ? ' Earlier error: ' + state.error : ''}`).catch(() => {}); return; }
             why = r.errs.join(' · ') || 'posted but not visible in #general'; }
    }
    if (ok === true) { console.log(`Check: today's picks are in #general.`); save({ checked: today }); return; }
    const msg = ok === null ? `⚠️ Picks check: couldn't read #general to confirm today's lineup went out.${why ? ' Last error: ' + why : ''}`
      : `⚠️ Today's picks did NOT reach #general: ${why || 'unknown reason'}. I'll keep retrying until 11 AM.`;
    console.log(msg); await dmBradley(msg).catch(e => console.log('DM failed: ' + e.message)); save({ checked: today });
    return;
  }

  if (state.date === today && !FORCE) { console.log('Picks already posted today.'); return; }
  if (!gcal.ready) { console.log('Calendar not connected (GCAL_SA_KEY / GCAL_CALENDAR_ID) – cannot read the slate.'); process.exitCode = 2; return; }
  const ev = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  if (!ev) { console.log(`No "betting slate – ${label}" event yet.`); return; }
  const text = build(ev.description, label);
  if (!text) { console.log('No picks in today\'s slate – nothing posted.'); return; }
  if (/\$/.test(text)) throw new Error('refusing to post: text still has a $ amount');
  console.log(text);
  if (DRY) return;
  if (!FORCE && await inChannel(label)) { console.log('Already in the channel – marking posted.'); save({ date: today, posted: 'found in channel' }); return; }
  const r = await post(text);
  if (!r.via) { save({ error: r.errs.join(' · '), errorDate: today }); throw new Error('Every way to post failed: ' + r.errs.join(' · ')); }
  const seen = await inChannel(label);
  if (seen === false) { save({ error: `posted via ${r.via} but it isn't showing in #general`, errorDate: today }); throw new Error('Posted but not visible in #general'); }
  save({ date: today, posted: new Date().toISOString(), via: r.via });
  if (state.checked === today) await dmBradley(`✅ Today's picks are in #general now (via ${r.via}) – after the morning check had flagged them missing.`).catch(() => {});
  console.log(`Posted via ${r.via}${seen ? ' and confirmed in #general' : ''}.${r.errs.length ? ' (' + r.errs.join(' · ') + ')' : ''}`);
})().catch(e => { console.error(e.message); process.exit(1); });
