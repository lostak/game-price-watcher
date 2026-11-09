// Reads new messages in the Discord game-prices channel and turns them into wants.json changes.
// Runs every 5 minutes on GitHub Actions (.github/workflows/commands.yml). Needs DISCORD_BOT_TOKEN (a bot in the
// server with Read Message History + the Message Content intent), DISCORD_CHANNEL_ID, and DISCORD_WEBHOOK_URL for replies.
//
// Things Bradley can post (any NBA, NFL or NHL team, home or away):
//   watch Nuggets vs Suns Nov 20 under 80 lower under 150   → watch that game (even if it's more than 14 days out) with targets
//   watch Avs Sat                                            → the Avs game that Saturday
//   watch Broncos vs Raiders                                 → next game against them
//   watch Lakers vs Celtics Dec 25   /   watch Broncos @ Chiefs   /   watch Maple Leafs   → any team's game, anywhere
//   (shared nicknames: "NHL Kings" or "LA Kings", "NFL Jets" or "Winnipeg Jets")
//   stop Nuggets Nov 20   /   stop all                       → drop manual watches (auto-watching of the next 14 days continues)
//   watch list  (or list)                                    → every game being watched, with the latest prices and targets
//   report                                                   → post the price report now
//   price graph Nuggets vs Suns  (or graph Lakers, graph all)  → price-history sparklines for any tracked game
// Exit code 3 = wants.json changed (the workflow commits and wakes the watcher); 4 = run a report now.
'use strict';
const fs = require('fs');
const gcal = require('./gcal');   // when configured, WATCH: lines on the "Personal: ticket watch" calendar event are the source of truth
const Teams = require('./teams');   // every NBA/NFL/NHL team + Gametime slug
const { findGame } = require('./gt');
const TZ = 'America/Denver';
const WANTS = 'wants.json', STATE = 'state/discord.json', GAMES = 'state/games.json', SEEN = 'state/seen.json';
// secrets pasted from a clipboard can carry a line break or a second copy – keep the first word only
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const token = one(process.env.DISCORD_BOT_TOKEN), channel = one(process.env.DISCORD_CHANNEL_ID), hook = one(process.env.DISCORD_WEBHOOK_URL);
const TEXT = (() => { const i = process.argv.indexOf('--text'); return i > -1 ? process.argv[i + 1] : null; })();   // one command passed in (from Pocket via Claude) instead of reading Discord
if (!TEXT && (!token || !channel)) { console.log('DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID not set – skipping.'); process.exit(0); }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => new Date(d + 'T12:00:00Z').getUTCDay();
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(text) {
  const t = today();
  const m = text.match(/\b(today|tomorrow|(?:this |next )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?)\b/i);
  if (!m) return null;
  const nextOf = (mo, d) => { const y = +t.slice(0, 4); let s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; if (s < t) s = `${y + 1}` + s.slice(4); return s; };
  const w = m[1].toLowerCase();
  if (w === 'today') return t;
  if (w === 'tomorrow') return addDays(t, 1);
  if (m[2]) { const want = DAYS.findIndex(d => d.startsWith(m[2].toLowerCase().slice(0, 3))); let d = t; for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (dow(d) === want) break; if (/^next /.test(w) && d === t) d = addDays(d, 7); return d; }
  if (m[3]) return `${m[3]}-${m[4]}-${m[5]}`;
  if (m[6]) return nextOf(+m[6], +m[7]);
  return nextOf(MONTHS.indexOf(m[8].toLowerCase()) + 1, +m[9]);
}
function parseOpponent(text) { const m = text.match(/\b(?:vs\.?|v|against|@)\s+([A-Za-z][A-Za-z .'-]*?)(?=\s+(?:on|at|under|lower|today|tomorrow|sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)|\s*$)/i); return m ? m[1].trim() : null; }
function parseTargets(text) {
  const t = text.toLowerCase(), out = {};
  const lower = t.match(/\blower(?: bowl)?\s*(?:under|below|<|at|target)?\s*\$?(\d+)/); if (lower) out.lower = +lower[1];
  const rest = t.replace(/\blower(?: bowl)?\s*(?:under|below|<|at|target)?\s*\$?\d+/, '');
  const all = rest.match(/\b(?:under|below|<|target|anywhere)\s*\$?(\d+)/); if (all) out.all = +all[1];
  return Object.keys(out).length ? out : null;
}
const sameOpp = (a, b) => a && b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().split(' ').pop() === b.toLowerCase().split(' ').pop());

async function discord(path, opts = {}) {
  const r = await fetch('https://discord.com/api/v10' + path, { ...opts, headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Discord ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function reply(text) {
  console.log('reply:', text);
  if (hook) await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1990) }) });
}
const money = n => '$' + Math.round(n);

(async () => {
  const st = readJson(STATE, {});
  const cfg = readJson(WANTS, { games: [] }); cfg.games = cfg.games || [];
  let watchEv = null, otherLines = [];
  if (gcal.ready) {                                                     // calendar mode: games come from WATCH: lines
    watchEv = await gcal.findByTitle('Personal: ticket watch', 'ticket watch');
    const d = watchEv ? watchEv.description || '' : '';
    cfg.games = [];
    for (const m of d.matchAll(/^\s*WATCH:\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(?:vs\.?|@|at)\s+(.+?)\s*(?:\|(.*))?$/gim)) {
      const target = {}; const t = m[4] || ''; const a = t.match(/all\s*\$?(\d+)/i), l = t.match(/lower\s*\$?(\d+)/i); if (a) target.all = +a[1]; if (l) target.lower = +l[1];
      cfg.games.push({ team: m[2], opponent: m[3].trim(), date: m[1], target: Object.keys(target).length ? target : undefined });
    }
    otherLines = d.split('\n').filter(l => !/^\s*(WATCH:|TICKET-WATCH)/.test(l) && l.trim());
    if (!otherLines.length) otherLines = ['Games to watch for 4 tickets (the game-price-watcher checks TickPick every 5 minutes). Home games in the next 14 days are watched automatically; add a line to watch another or set targets.'];
  }
  const sched = (readJson(GAMES, { games: [] }).games || []).filter(g => g.date >= today());
  const seen = readJson(SEEN, {});
  let msgs;
  if (TEXT) msgs = [{ id: st.last, content: TEXT }];
  else if (!st.last) {                                                // first run: start from now, don't replay old messages
    msgs = await discord(`/channels/${channel}/messages?limit=1`);
    st.last = msgs[0] ? msgs[0].id : '0'; msgs = [];
    console.log('First run – cursor set, nothing processed.');
  } else msgs = (await discord(`/channels/${channel}/messages?after=${st.last}&limit=50`)).reverse();
  let changed = false, report = false, graphs = false;
  const describe = g => { const k = `${g.date} ${g.team} vs ${g.opponent}`, l = (seen[k] || {}).last || {}; return `${nice(g.date)} ${g.team} vs ${g.opponent}${l.all ? ' – ' + money(l.all.price) + ' anywhere' : ''}${l.lower ? ' / ' + money(l.lower.price) + ' lower' : ''}${g.target ? ' (target ' + [g.target.all && money(g.target.all), g.target.lower && money(g.target.lower) + ' lower'].filter(Boolean).join(', ') + ')' : ''}`; };
  for (const msg of msgs) {
    st.last = msg.id;
    // a /slash command: the Cloudflare helper answers Discord with "⏳ `<command>` …"; that reply carries the command text
    const slash = (msg.interaction_metadata || msg.interaction) && /^⏳ `([^`]+)`/.exec(msg.content || '');
    if (!slash && (msg.author?.bot || msg.webhook_id)) continue;
    const text = (slash ? slash[1] : msg.content || '').trim(); if (!text) continue;
    const t = text.toLowerCase();
    console.log('message:', text);
    if (/^(price )?(graph|chart)s?\b/.test(t)) {      // "price graph Nuggets vs Suns" → sparkline(s) posted by the next price check
      const q = t.replace(/^(price )?(graph|chart)s?\s*(for|of)?\s*/, '').trim();
      const keys = Object.keys(readJson('state/history.json', {})).filter(k => k.slice(0, 10) >= today()).sort();
      let pick = keys;
      if (q && !/^(all|everything)\b/.test(q)) {
        const hits = Teams.parse(q).map(h => h.teams), d = parseDate(q);
        const named = (kl, t) => kl.includes(' ' + t.label.toLowerCase() + ' ') || kl.includes(t.full.toLowerCase()) || kl.endsWith(' ' + t.name.toLowerCase());
        pick = keys.filter(k => { const kl = k.toLowerCase(); return (!d || k.startsWith(d)) && hits.every(c => c.some(t => named(kl, t))) && (hits.length || d || kl.includes(q)); });
      }
      if (!pick.length) { await reply(`No price history for "${q || 'anything'}" yet. "watch list" shows what's being tracked.`); continue; }
      fs.mkdirSync('state/graph-requests', { recursive: true });
      fs.writeFileSync(`state/graph-requests/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`, JSON.stringify({ keys: pick.slice(0, 10), q }) + '\n');
      await reply(`📈 ${pick.length === 1 ? 'Graph' : pick.length + ' graphs'} coming up in a few minutes${pick.length > 10 ? ' (first 10)' : ''}.`);
      graphs = true; continue;
    }
    if (/^(watch ?list|watching|list|status|what.*watch|prices?)\b/.test(t)) {
      const mine = cfg.games.filter(g => g.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
      const auto = sched.filter(g => g.date <= addDays(today(), 14) && !mine.some(m => m.team === g.team && m.date === g.date)).sort((a, b) => a.date.localeCompare(b.date));
      const lines = ['🎟️ **Watch list** (4 tickets together)'];
      lines.push('**Your watches**', ...(mine.length ? mine.map(g => '• ' + describe(g)) : ['• none – add one with "watch Nuggets vs Suns Nov 20 under 80"']));
      lines.push('**Automatic (home games in the next 14 days)**', ...(auto.length ? auto.map(g => '• ' + describe(g)) : ['• no home games in the next 14 days']));
      lines.push('Prices are the latest check. "stop [team] [date]" drops a watch, "report" posts the full board.');
      await reply(lines.join('\n'));
      continue;
    }
    if (/^report\b/.test(t)) { report = true; await reply('Posting the price report in a few minutes.'); continue; }
    const hits = Teams.parse(text), first = hits[0], second = hits[1];
    if (first && first.teams.length > 1) { await reply(`Which ${first.alias}? ${first.teams.map(x => x.full + ' (' + x.league.toUpperCase() + ')').join(' or ')} – say "${first.teams[0].league.toUpperCase()} ${first.alias}" or the city.`); continue; }
    const teamObj = first && first.teams[0], oppObj = second && second.teams.length === 1 ? second.teams[0] : null;
    const team = teamObj && teamObj.label, date = parseDate(text), opp = oppObj ? oppObj.full : parseOpponent(text), targets = parseTargets(text);
    if (/^(stop|cancel|remove|clear|drop)\b/.test(t)) {
      const before = cfg.games.length;
      if (!/\ball\b|everything/.test(t) && !team && !date && !opp) {      // a bare "stop" never wipes everything – ask which
        await reply(cfg.games.length ? `Which one? Say "stop [team] [date]" or "stop all". Watching: ${cfg.games.map(describe).join(' · ')}.` : 'Nothing extra is being watched – only the automatic home games in the next 14 days.');
        continue;
      }
      if (/\ball\b|everything/.test(t)) cfg.games = [];
      else cfg.games = cfg.games.filter(g => !((!team || g.team === team) && (!date || g.date === date) && (!opp || sameOpp(g.opponent, opp))));
      changed = changed || cfg.games.length !== before;
      await reply(cfg.games.length !== before ? `Dropped. Still watching: ${cfg.games.map(describe).join(' · ') || 'nothing beyond the automatic 14-day window'}.` : 'Nothing matched that. "watch list" shows what is being watched.');
      continue;
    }
    if (!team) { await reply(`Didn't catch a team in "${text.slice(0, 60)}". Any NBA, NFL or NHL team works: "watch Nuggets vs Suns Nov 20 under 80", "watch Lakers vs Celtics Dec 25", "watch list", "report" or "stop all".`); continue; }
    // find the game: the cached Denver home schedule first, then the team's full Gametime schedule (home and away, any team)
    let game = sched.find(g => g.team === team && date && g.date === date)
      || (opp && !date && sched.find(g => g.team === team && sameOpp(g.opponent, opp)))
      || (!date && !opp && sched.find(g => g.team === team));
    if (!game) game = await findGame(teamObj, { date, opp: oppObj, oppText: oppObj ? null : opp, today: today() }).catch(e => { console.log('gametime lookup failed:', e.message); return null; })
      || (oppObj && await findGame(oppObj, { date, opp: teamObj, today: today() }).then(g => g && { ...g, team, opponent: oppObj.full }).catch(() => null));
    if (!game && date) game = { team, opponent: opp || 'TBD', date };
    if (!game) { await reply(`Couldn't find a ${teamObj.full} game${opp ? ' vs ' + opp : ''} on Gametime yet. Add the date: "watch ${team} vs ${opp || 'Suns'} Nov 20".`); continue; }
    const entry = { team: game.team, opponent: game.opponent, date: game.date }; if (targets) entry.target = targets;
    cfg.games = cfg.games.filter(g => !(g.team === entry.team && g.date === entry.date));
    cfg.games.push(entry); cfg.games.sort((a, b) => a.date.localeCompare(b.date));
    changed = true;
    await reply(`Got it – watching ${describe(entry)}${game.venue && !game.home && !/ball arena|empower/i.test(game.venue) ? ' at ' + game.venue : ''}. Checking every 5 minutes, 5 AM–10 PM; I'll post here when it drops${targets ? ' or hits your target' : ''}.`);
  }
  fs.mkdirSync('state', { recursive: true });
  if (!TEXT) fs.writeFileSync(STATE, JSON.stringify(st));
  if (changed) cfg.games = cfg.games.filter(g => g.date >= today());
  if (changed && gcal.ready) {
    const body = [...otherLines, ...cfg.games.map(g => `WATCH: ${g.date} ${g.team} vs ${g.opponent}${g.target ? ' | ' + [g.target.all && 'all $' + g.target.all, g.target.lower && 'lower $' + g.target.lower].filter(Boolean).join(' | ') : ''}`), 'TICKET-WATCH'].join('\n');
    if (watchEv) await gcal.patch(watchEv.id, { description: body }); else await gcal.insert({ summary: 'Personal: ticket watch', description: body, when: new Date(), popup: null });
    console.log('calendar ticket watch updated'); fs.writeFileSync(WANTS, JSON.stringify(cfg, null, 2) + '\n'); process.exit(3);
  }
  if (changed) { fs.writeFileSync(WANTS, JSON.stringify(cfg, null, 2) + '\n'); console.log('wants.json changed'); process.exit(3); }
  if (report) process.exit(4);
  if (graphs) process.exit(5);
  console.log(`${msgs.length} message(s), no change.`);
})().catch(e => { console.error(e); process.exit(1); });
