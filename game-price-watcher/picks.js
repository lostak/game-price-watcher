// Daily picks lineup for the shared Discord "general" channel – generic, units only, nothing personal.
// Reads Bradley's own "Personal: betting slate – Sat Nov 7" calendar event (dollars, bankroll, books), strips it down
// to picks + units, and posts it once per morning (7–11 AM Denver). Run from tick.yml, the 5-minute loop, because
// GitHub's own schedule runs hours late (the my-life picks.yml schedule missed every morning slot).
// Posts with DISCORD_WEBHOOK_PICKS when that secret is here, else as the bot (DISCORD_BOT_TOKEN) to the general channel.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const STATE = 'state/picks.json', GENERAL = '1568311701701398641';
const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force');
const BOOKS = /\s*@\s*(DraftKings|DK|FanDuel|FD|bet365|BetMGM|Caesars|ESPN ?Bet|Fanatics|BetRivers|Hard Rock)\b.*$/i;
const noMoney = s => s.replace(/\s*\([^)]*\$[^)]*\)/g, '').replace(/,?\s*[-+]?\$\s?[\d,.]+/g, '').replace(/\s{2,}/g, ' ').trim();

function build(desc, label) {
  const lines = String(desc || '').split('\n').map(l => l.trim());
  const out = [], label_ = /^[A-Z][A-Z /&-]{2,}:/;
  let inPicks = false, parlay = null, record = null;
  for (const l of lines) {
    if (/^RECORD:/.test(l)) record = noMoney(l.replace(/^RECORD:\s*/, '').split('|')[0]).replace(/,\s*$/, '');
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


async function alreadyInChannel(label) {             // safety net against a double post (state lost, or posted by hand)
  const token = process.env.DISCORD_BOT_TOKEN; if (!token) return false;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${GENERAL}/messages?limit=30`, { headers: { Authorization: 'Bot ' + token } });
    if (!r.ok) return false;
    return (await r.json()).some(m => /Picks of the day/i.test(m.content || '') && (m.content || '').includes(label));
  } catch { return false; }
}
(async () => {
  const today = gcal.todayLocal(), state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  if (state.date === today && !FORCE) { console.log('Picks already posted today.'); return; }
  if (!gcal.ready) { console.log('Calendar not connected (GCAL_SA_KEY / GCAL_CALENDAR_ID) – cannot read the slate.'); process.exitCode = 2; return; }
  const label = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const ev = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  if (!ev) { console.log(`No "betting slate – ${label}" event yet.`); return; }
  const text = build(ev.description, label);
  if (!text) { console.log('No picks in today\'s slate – nothing posted.'); return; }
  if (/\$/.test(text)) throw new Error('refusing to post: text still has a $ amount');
  console.log(text);
  if (DRY) return;
  const save = () => { fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ date: today, posted: new Date().toISOString() }) + '\n'); };
  if (!FORCE && await alreadyInChannel(label)) { console.log('Already in the channel – marking posted.'); save(); return; }
  const hook = process.env.DISCORD_WEBHOOK_PICKS, token = process.env.DISCORD_BOT_TOKEN;
  const r = hook ? await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1990) }) })
    : await fetch(`https://discord.com/api/v10/channels/${GENERAL}/messages`, { method: 'POST', headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1990) }) });
  if (!r.ok) throw new Error('Discord ' + r.status + ' ' + (await r.text()).slice(0, 200));
  save(); console.log('Posted.');
})().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build };
