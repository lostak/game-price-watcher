// Daily picks lineup for the shared Discord "general" channel – generic, units only, nothing personal.
// Reads Bradley's own "Personal: betting slate – Sat Nov 7" calendar event (dollars, bankroll, books), strips it down
// to picks + units, and posts it once per morning (from 6:30 AM Denver). Run from tick.yml, the 5-minute loop, because
// GitHub's own schedule runs hours late (the my-life picks.yml schedule missed every morning slot).
// Posts as the bot (DISCORD_BOT_TOKEN), falling back to DISCORD_WEBHOOK_PICKS, then confirms the message is in #general.
// `--check` (tick.yml, 6:50 AM) verifies it's really there, retries once, and DMs Bradley if it isn't.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const info = require('./pickinfo');
const STATE = 'state/picks.json', GENERAL = '1568311701701398641';
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';   // pasted secrets can carry a line break
const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force');
const BOOKS = /\s*@\s*(DraftKings|DK|FanDuel|FD|bet365|BetMGM|Caesars|ESPN ?Bet|Fanatics|BetRivers|Hard Rock)\b.*$/i;
const noMoney = s => s.replace(/\s*\([^)]*\$[^)]*\)/g, '').replace(/,?\s*[-+]?\$\s?[\d,.]+/g, '').replace(/\s{2,}/g, ' ').trim();

// Lenient on purpose: Claude's slate format drifts (bullets "-", "•", "*", "1." / separators " – ", " — ", " - "), and a
// format slip must never cost the day's post. If no PICKS block is found it falls back to any line that names a book.
const SEP = /\s+[–—-]\s+/;   // odds like -130 have no space after the minus, so they never split
const BULLET = /^(?:[-•*]|\d+[.)])\s+/;
// "🏒 NHL · 7:00 PM" in front of each pick; in Discord the time is a <t:…:t> stamp so everyone sees their own time zone
function tagFor(pick, ctx, parlay = false) {
  if (!ctx) return '';
  const r = info.match(pick, ctx.log, parlay) || (parlay ? null : info.match(pick, ctx.slate));
  if (!r) return '';
  const ts = r.time ? (ctx.discord && r.zone === 'MT' ? `<t:${info.epoch(ctx.date, r.time)}:t>` : `${r.time} ${r.zone}`) : '';
  if (parlay) return ts ? `last leg ${ts}` : '';
  return [r.sport ? `${info.EMOJI[r.sport] || ''} ${r.sport}`.trim() : '', ts].filter(Boolean).join(' · ');
}
function pickLine(raw, ctx) {
  const p = raw.replace(BULLET, '').replace(/\*\*/g, '').split(SEP);
  const pick = p[0].replace(BOOKS, '').trim(), units = noMoney((p.find(x => /\d(\.\d+)?\s*u\b/i.test(x)) || p[1] || ''));
  const conf = (p.find(x => /^(High|Medium|Low)( confidence)?$/i.test(x.trim())) || '').trim().replace(/ confidence$/i, '');
  const stop = (p.find(x => /^stop at /i.test(x.trim())) || '').trim();
  const tag = tagFor(pick, ctx);
  return pick ? `• ${tag ? '**' + tag + '** – ' : ''}${pick}${units && /u\b/.test(units) ? ' – ' + units : ''}${conf ? ' – ' + conf.toLowerCase() + ' confidence' : ''}${stop ? ' – ' + stop : ''}` : null;
}
function build(desc, label, ctx) {
  const lines = String(desc || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').split('\n').map(l => l.trim());
  const out = [], label_ = /^[A-Z][A-Z /&-]{2,}:/;
  let inPicks = false, parlay = null, record = null;
  for (const l0 of lines) {
    const l = l0.replace(/^\*\*(.+?)\*\*/, '$1');
    if (/^RECORD:/i.test(l)) record = noMoney(l.replace(/^RECORD:\s*(picks\s+)?/i, '').split('|')[0]).replace(/,\s*$/, '');
    if (/^PICKS\b[^:]*:/i.test(l)) { inPicks = true; const rest = l.replace(/^PICKS\b[^:]*:\s*/i, ''); if (rest && /none|no (games|picks)/i.test(rest)) return null; continue; }
    if (/^PARLAY:/i.test(l)) { inPicks = false; const p = l.replace(/^PARLAY:\s*/i, '').split(SEP); { const t = tagFor('', ctx, true); parlay = `Parlay${t ? ' (' + t + ')' : ''}: ${p[0].replace(/\s*@\s*(DraftKings|DK|FanDuel|FD|bet365|BetMGM|Caesars|ESPN ?Bet|Fanatics|BetRivers|Hard Rock)\b/i, '')}${p[1] ? ' – ' + noMoney(p[1]) : ''}`; } continue; }
    if (label_.test(l)) inPicks = false;
    if (inPicks && BULLET.test(l)) { const x = pickLine(l, ctx); if (x) out.push(x); }
  }
  if (!out.length) {   // fallback: no usable PICKS block – any bullet line that names a sportsbook is a pick
    for (const l of lines) if (BULLET.test(l) && /@\s*(DraftKings|DK|FanDuel|FD|bet365)/i.test(l) && !/^PARLAY/i.test(l)) { const x = pickLine(l, ctx); if (x) out.push(x); }
  }
  if (!out.length) return null;
  const text = [`🎯 **Picks of the day – ${label}**`, ...out.slice(0, 6), parlay ? '• ' + noMoney(parlay) : null,
    record ? `Last results: ${record}.` : null, 'Lines move – confirm the price before betting.'].filter(Boolean).join('\n');
  return text.replace(/\$\s?[\d,.]*/g, '').replace(/[ \t]{2,}/g, ' ');   // never a dollar figure in the shared channel
}

const TOKEN = () => one(process.env.DISCORD_BOT_TOKEN);
const dapi = async (method, path, body) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { const wait = Math.min(15, (JSON.parse(t || '{}').retry_after || 2)) * 1000; await new Promise(f => setTimeout(f, wait)); continue; }
    if (!r.ok) throw new Error(`Discord ${method} ${path.split('?')[0]} → ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : {};
  }
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

// Self-healing run (tick.yml, every 5 minutes from 6:30 AM until it's posted and confirmed, up to 1 PM):
// - no slate yet → nothing to post; the Claude betting task retries itself at 7:13, 8:13, 9:13 and 10:13
// - slate there → lenient parse → strip anything personal/$ → post (bot, then webhook) → confirm it's visible
// - posted but not visible (or deleted) → post again next run
// Bradley hears nothing while it's fixing itself. Only if it still isn't up at 10:45 AM does he get ONE DM saying what
// was wrong and what was tried; when it then goes up, a ✅ follow-up. `--check` is kept as an alias of a normal run.
(async () => {
  const today = gcal.todayLocal(), state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  const mine = state.day === today ? state : { day: today };     // today's working state (older days are dropped)
  const save = () => { fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(mine) + '\n'); };
  const label = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const hm = +new Date().toLocaleTimeString('en-GB', { timeZone: gcal.TZ, hour: '2-digit', minute: '2-digit' }).replace(':', '');
  const note = (k, v) => { mine.log = [...(mine.log || []).slice(-8), `${new Date().toLocaleTimeString('en-US', { timeZone: gcal.TZ, hour: 'numeric', minute: '2-digit' })} ${k}: ${v}`]; };

  if (mine.date === today && !FORCE) {                             // posted earlier: make sure it's still there
    if (mine.verified === today) { console.log('Picks posted and confirmed today.'); return; }
    const seen = await inChannel(label);
    if (seen === true) { mine.verified = today; save(); console.log('Picks confirmed in #general.'); return; }
    if (seen === false) { console.log('Marked posted but not in #general – posting again.'); note('repost', 'was marked posted but not visible'); delete mine.date; }
    else { console.log("Couldn't read #general to confirm; will try again next run."); return; }
  }
  if (!gcal.ready) { console.log('Calendar not connected (GCAL_SA_KEY / GCAL_CALENDAR_ID) – cannot read the slate.'); process.exitCode = 2; return; }

  let problem = null;
  const ev = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  if (!ev) problem = `the Claude betting task hasn't written today's slate yet (it retries at 7:13, 8:13, 9:13 and 10:13)`;
  else {
    // sport + game time per pick, from today's picks-log lines (the betting task writes those right after the slate)
    const log = await gcal.findByTitle('Personal: picks log', 'PICKS-LOG', { back: 60, ahead: 1 }).catch(() => null);
    const ctx = { date: today, discord: true, log: info.fromLog(log && log.description, today), slate: info.fromSlate(ev.description) };
    const fresh = Date.now() - new Date(ev.updated || 0) < 10 * 60000;
    if (!ctx.log.length && fresh && !FORCE) { console.log('Slate just written; waiting a run for its picks-log lines (sport + game time).'); return; }
    const text = build(ev.description, label, ctx);
    if (!text) {
      if (/^PICKS\b[^:]*:\s*.*(none|no (games|picks))/im.test(ev.description || '')) { console.log('Slate says no picks today – nothing to post.'); mine.date = today; mine.verified = today; mine.none = true; save(); return; }
      problem = "today's slate has no pick lines I can read (the betting task may still be writing it)";
    } else {
      console.log(text);
      if (DRY) return;
      if (!FORCE && await inChannel(label)) { console.log('Already in the channel.'); Object.assign(mine, { date: today, verified: today, posted: mine.posted || 'found in channel' }); save(); return; }
      const r = await post(text);
      if (r.via) {
        const seen = await inChannel(label);
        Object.assign(mine, { date: today, posted: new Date().toISOString(), via: r.via });
        if (seen !== false) mine.verified = seen ? today : undefined;
        note('posted', `via ${r.via}${r.errs.length ? ' (after: ' + r.errs.join(' · ') + ')' : ''}`);
        save();
        console.log(`Posted via ${r.via}${seen ? ' and confirmed in #general' : ''}.`);
        if (mine.alerted) await dmBradley(`✅ Today's picks are up in #general now (via ${r.via}). It had been held up by: ${mine.alerted}`).catch(() => {});
        return;
      }
      problem = 'every way to post failed: ' + r.errs.join(' · ');
    }
  }
  note('waiting', problem); console.log('Not posted yet: ' + problem);
  // one heads-up only, and only once the automatic fixes have had their chance
  if (hm >= 1045 && !mine.alerted) {
    mine.alerted = problem;
    await dmBradley(`⚠️ Today's picks still aren't in #general after the automatic retries. Cause: ${problem}.\nTried: ${(mine.log || []).join(' | ') || 'posting every 5 minutes since 6:30'}.\nIt keeps trying until 1 PM and posts the moment it can.`).catch(e => console.log('DM failed: ' + e.message));
  }
  save();
})().catch(e => { console.error(e.message); process.exit(1); });
