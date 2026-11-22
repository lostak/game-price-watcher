// Sunday NFL moneyline parlay – one leg for every NFL game that day, at least one upset, three reasons per leg.
// The Claude betting task writes it into the day's slate as:
//   NFL SUNDAY ML PARLAY: 13 legs @ DraftKings +18500 – 0.5u ($1, wins ~$185) – hits roughly 1 in 400
//   - Bills ML -180 vs Dolphins – 11:00 AM MT
//     • reason
//     • reason
//     • reason
//   - UPSET: Jets ML +210 @ Chiefs – 2:25 PM MT
//     • …
// This posts it to the shared #general channel after the daily lineup (units only, no dollars, nothing personal),
// split into as many messages as Discord's 2,000-character limit needs, and confirms it's visible. Same self-healing
// as picks.js: every tick from 6:30 AM until it's up (to 1 PM). State: state/nfl.json.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const info = require('./pickinfo');
const STATE = 'state/nfl.json', GENERAL = '1568311701701398641';
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force');
const noMoney = s => s.replace(/\s*\([^)]*\$[^)]*\)/g, '').replace(/,?\s*[-+]?\$\s?[\d,.]+/g, '').replace(/\s{2,}/g, ' ').trim();
const TITLE = 'Sunday NFL moneyline parlay';

// → { head: {legs, price, units, odds}, legs: [{text, upset, time, reasons[]}] } or null
function parse(desc) {
  const lines = String(desc || '').split('\n'); let i = lines.findIndex(l => /^\s*NFL SUNDAY (ML |MONEYLINE )?PARLAY\s*:/i.test(l));
  if (i < 0) return null;
  const headTxt = lines[i].replace(/^\s*NFL SUNDAY (ML |MONEYLINE )?PARLAY\s*:\s*/i, ''), parts = headTxt.split(/\s+[–—]\s+/);
  const head = { legs: (headTxt.match(/(\d+)\s*legs?/i) || [])[1] || '', price: (headTxt.match(/([+-]\d{3,6})\b/) || [])[1] || '',
    units: (headTxt.match(/(\d+(?:\.\d+)?)u\b/) || [])[1] || '', odds: (parts.find(p => /hits|1 in/i.test(p)) || '').replace(/^hits\s*/i, '').trim() };
  const legs = [];
  for (i = i + 1; i < lines.length; i++) {
    const raw = lines[i], l = raw.trim();
    if (!l) { if (legs.length) break; continue; }
    const sub = raw.match(/^\s{2,}[•·*\-–]\s+(.*)$/) || (legs.length && l.match(/^[•·]\s+(.*)$/));
    if (sub && legs.length) { legs[legs.length - 1].reasons.push(sub[1].trim()); continue; }
    const leg = l.match(/^[-*]\s+(.*)$/);
    if (!leg) break;
    let t = leg[1].trim(); const upset = /^UPSET\s*[:–-]\s*/i.test(t) || /\(upset\)/i.test(t); t = t.replace(/^UPSET\s*[:–-]\s*/i, '').replace(/\s*\(upset\)/i, '');
    const tm = t.match(/\b(\d{1,2}:\d{2}\s*[AP]M)(\s*MT)?\b/i);
    t = t.replace(/\s+[–—]\s+\d{1,2}:\d{2}\s*[AP]M(\s*MT)?\s*$/i, '').replace(/\s*\(\d{1,2}:\d{2}\s*[AP]M(\s*MT)?\)\s*$/i, '');
    legs.push({ text: t.replace(/\s*@\s*(DraftKings|DK|FanDuel|bet365)\b/i, '').trim(), upset, time: tm ? tm[1].toUpperCase().replace(/\s+/, ' ') : null, reasons: [] });
  }
  return legs.length ? { head, legs } : null;
}
// Discord messages (each ≤ 1,900 chars), generic and units-only
function messages(p, date, label) {
  const top = [`🏈 **${TITLE}** – ${label}`, [p.head.legs || p.legs.length, 'legs', p.head.price && `· ${p.head.price}`, p.head.units && `· ${p.head.units}u`, p.head.odds && `· long shot (${noMoney(p.head.odds)})`].filter(Boolean).join(' '),
    p.legs.some(l => l.upset) ? '🐶 = upset pick' : ''].filter(Boolean).join('\n');
  const blocks = p.legs.map(l => [`${l.upset ? '🐶 ' : ''}**${noMoney(l.text)}**${l.time ? ` · <t:${info.epoch(date, l.time)}:t>` : ''}`, ...l.reasons.slice(0, 3).map(r => `– ${noMoney(r)}`)].join('\n'));
  const out = []; let cur = top;
  for (const b of blocks) { if ((cur + '\n\n' + b).length > 1900) { out.push(cur); cur = `🏈 ${TITLE} (cont.) – ${label}\n\n` + b; } else cur += '\n\n' + b; }
  out.push(cur); return out;
}
module.exports = { parse, messages, TITLE };

if (require.main === module) (async () => {
  const TOKEN = () => one(process.env.DISCORD_BOT_TOKEN);
  const dapi = async (method, path, body) => {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(f => setTimeout(f, Math.min(15, (JSON.parse(t || '{}').retry_after || 2)) * 1000)); continue; }
      if (!r.ok) throw new Error(`Discord ${method} ${path.split('?')[0]} → ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : {};
    }
  };
  const today = gcal.todayLocal(), label = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const st = (() => { try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); return s.day === today ? s : { day: today }; } catch { return { day: today }; } })();
  const save = () => { fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st) + '\n'); };
  if (st.verified && !FORCE) { console.log('NFL parlay posted and confirmed today.'); return; }
  const seen = async () => { if (!TOKEN()) return null; try { return (await dapi('GET', `/channels/${GENERAL}/messages?limit=50`)).some(m => (m.content || '').includes(TITLE) && (m.content || '').includes(label)); } catch { return null; } };
  if (st.posted && !FORCE) { const s = await seen(); if (s) { st.verified = true; save(); console.log('NFL parlay confirmed.'); return; } if (s === null) return; delete st.posted; }
  // after the daily lineup, so the channel reads in order
  const picks = (() => { try { return JSON.parse(fs.readFileSync('state/picks.json', 'utf8')); } catch { return {}; } })();
  if (picks.date !== today && !FORCE) { console.log('Waiting for the daily lineup to post first.'); return; }
  const ev = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  const p = ev && parse(ev.description);
  if (!p) { console.log(new Date().getDay() === 0 ? 'No NFL Sunday parlay in the slate yet.' : 'No NFL parlay today.'); return; }
  const msgs = messages(p, today, label);
  console.log(msgs.join('\n---\n'));
  if (DRY) return;
  if (!FORCE && await seen()) { st.posted = st.verified = true; save(); return; }
  for (const m of msgs) await dapi('POST', `/channels/${GENERAL}/messages`, { content: m, allowed_mentions: { parse: [] } });
  st.posted = new Date().toISOString(); st.verified = (await seen()) === true; save();
  console.log(`Posted the NFL parlay in ${msgs.length} message(s).`);
})().catch(e => { console.error('nflparlay:', e.message); process.exit(1); });
