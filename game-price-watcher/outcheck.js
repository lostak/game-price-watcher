// Checks what actually went OUT today, not just what the app shows: the #general lineup post, the Sunday NFL parlay
// post and the morning brief, read back from Discord and the calendar and compared with today's slate.
// Findings go to "Personal: app check" as "ISSUE: Output: …" lines (checkreport.js) for the App doctor task.
// Runs once a day from tick.yml after the lineup is confirmed (or at 1 PM regardless). State: state/outcheck.json.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');
const { parse: nflParse, TITLE: NFL_TITLE } = require('./nflparlay');
const { setSection } = require('./checkreport');
const GENERAL = '1568311701701398641', STATE = 'state/outcheck.json';
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const FORCE = process.argv.includes('--force'), DRY = process.argv.includes('--dry');

// pure checks (exported for the tests)
function checkLineup(msg, slateDesc) {
  const out = [];
  if (!msg) return ['today\'s picks lineup is not in #general'];
  if (/\$\s?\d/.test(msg)) out.push('the #general lineup shows a dollar amount (shared channel: units only)');
  const picks = msg.split('\n').filter(l => /^•/.test(l.trim()) && !/^•\s*(\*\*)?Parlay/i.test(l.trim()));
  const slatePicks = (String(slateDesc || '').match(/^PICKS\b[^:]*:\s*\n((?:\s*[-•*]\s+.*\n?)+)/m) || [, ''])[1].split('\n').filter(l => l.trim()).length;
  if (slatePicks && picks.length !== slatePicks) out.push(`#general shows ${picks.length} picks but the slate has ${slatePicks}`);
  for (const p of picks) {
    if (!/<t:\d+:t>/.test(p)) out.push(`no game time on "${p.replace(/\*\*/g, '').slice(0, 60)}"`);
    if (!/(🏈|🏒|🏀|⚾|⚽|🏓|🎾|🥊|\b(NFL|CFB|NHL|NBA|MLB|TT)\b)/.test(p)) out.push(`no sport on "${p.replace(/\*\*/g, '').slice(0, 60)}"`);
  }
  if (/^PARLAY:/m.test(slateDesc || '') && !/^\s*(•\s*)?(\*\*)?Parlay/im.test(msg)) out.push('the daily parlay is missing from the #general lineup');
  return out;
}
function checkNfl(msgs, slateDesc) {
  const p = nflParse(slateDesc), out = [];
  if (!p) return new Date().getDay() === 0 ? ['no NFL Sunday moneyline parlay in today\'s slate'] : [];
  if (!p.legs.some(l => l.upset)) out.push('the NFL Sunday parlay has no upset leg (at least one is required)');
  for (const l of p.legs) if (l.reasons.length !== 3) out.push(`NFL parlay leg "${l.text}" has ${l.reasons.length} reasons instead of 3`);
  const text = msgs.join('\n');
  if (!msgs.length) { out.push('the NFL Sunday parlay is not in #general'); return out; }
  if (/\$\s?\d/.test(text)) out.push('the NFL parlay post shows a dollar amount');
  const legs = text.split('\n').filter(l => /^(🐶 )?\*\*/.test(l));
  if (legs.length !== p.legs.length) out.push(`#general shows ${legs.length} NFL legs but the slate has ${p.legs.length}`);
  return out;
}
// Today's NFL parlay post out of #general's last 50 messages (newest first): today's first message and the "(cont.)"
// messages posted right after it. Nov 22: a bare "(cont.)" filter also picked up last Sunday's continuation, so the
// check counted 16 legs for an 11-leg post. Newer continuations carry the date too.
function nflPosts(msgs, label) {
  const h = msgs.findIndex(m => m.includes(NFL_TITLE) && m.includes(label) && !/\(cont\.\)/.test(m));
  if (h < 0) return [];
  const out = [msgs[h]];
  for (let j = h - 1; j >= 0 && msgs[j].includes(NFL_TITLE) && /\(cont\.\)/.test(msgs[j]); j--) out.push(msgs[j]);
  return out;
}
module.exports = { checkLineup, checkNfl, nflPosts };

if (require.main === module) (async () => {
  const today = gcal.todayLocal(), hm = +new Date().toLocaleTimeString('en-GB', { timeZone: gcal.TZ, hour: '2-digit', minute: '2-digit' }).replace(':', '');
  const st = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
  if (st.day === today && !FORCE) { console.log('Outputs already checked today.'); return; }
  const picks = (() => { try { return JSON.parse(fs.readFileSync('state/picks.json', 'utf8')); } catch { return {}; } })();
  const nfl = (() => { try { return JSON.parse(fs.readFileSync('state/nfl.json', 'utf8')); } catch { return {}; } })();
  const sunday = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short' }) === 'Sun';
  const ready = picks.verified === today && (!sunday || nfl.verified || hm >= 1300);
  if (!ready && hm < 1300 && !FORCE) { console.log('Waiting for today\'s posts before checking them.'); return; }
  const label = new Date().toLocaleDateString('en-US', { timeZone: gcal.TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const issues = [];
  const slate = (await gcal.search('betting slate', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes('betting slate') && (e.summary || '').includes(label));
  if (slate && !picks.none) {
    let msgs = [];
    try {
      const r = await fetch(`https://discord.com/api/v10/channels/${GENERAL}/messages?limit=50`, { headers: { Authorization: 'Bot ' + one(process.env.DISCORD_BOT_TOKEN) } });
      if (!r.ok) throw new Error('Discord ' + r.status); msgs = (await r.json()).map(m => m.content || '');
    } catch (e) { issues.push(`couldn't read #general to check today's posts (${e.message})`); }
    if (msgs.length) {
      issues.push(...checkLineup(msgs.find(m => /Picks of the day/i.test(m) && m.includes(label)), slate.description));
      if (sunday || nflParse(slate.description)) issues.push(...checkNfl(nflPosts(msgs, label), slate.description));
    }
    const brief = (await gcal.search('morning brief', { back: 1, ahead: 1 })).find(e => (e.summary || '').includes(label));
    if (brief && /no betting slate yet/i.test(brief.description || '')) issues.push('the morning brief still says there is no betting slate');
  }
  console.log(issues.length ? issues.map(x => 'ISSUE: ' + x).join('\n') : 'Outputs OK.');
  if (DRY) return;
  await setSection('Output', 'OUTPUT CHECKED', issues);
  fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ day: today, issues: issues.length }) + '\n');
})().catch(e => { console.error('outcheck:', e.message); process.exit(1); });
