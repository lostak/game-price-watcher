// Gametime schedule lookups for any NBA/NFL/NHL team (home and away), cached a few hours in state/teamgames.json.
'use strict';
const fs = require('fs');
const GT = 'https://mobile.gametime.co/v1';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CACHE = 'state/teamgames.json', TTL = 6 * 3600e3;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
async function gtJson(url) { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`gametime ${r.status}`); return r.json(); }

/** Every listed game for a team: [{ date, time, gametimeId, gametime, name, venue, away, home }] (names as Gametime writes them). */
async function teamGames(slug) {
  const cache = readJson(CACHE, {});
  if (cache[slug] && Date.now() - cache[slug].at < TTL) return cache[slug].games;
  const games = [];
  for (let page = 1; page <= 4; page++) {
    const j = await gtJson(`${GT}/events?performer_slug=${slug}&page=${page}&per_page=50`);
    const venues = Object.fromEntries((j.venues || []).map(v => [v.id, v]));
    for (const e of j.events || []) {
      const x = e.event || e, name = String(x.name || '');
      const m = name.match(/^(?:.*?:\s*|.*? - )?(.+?)\s+(?:at|@)\s+(.+?)$/i) || name.match(/^(?:.*?:\s*)?(.+?)\s+vs\.?\s+(.+?)$/i);
      if (!m || !x.datetime_local) continue;                                        // skip parking passes, packages, etc.
      if (/parking|package|suite|hospitality|tailgate/i.test(name)) continue;
      games.push({ date: x.datetime_local.slice(0, 10), time: x.datetime_local.slice(11, 16), gametimeId: x.id, gametime: x.seo_url || `https://gametime.co/events/${x.id}`,
        name, venue: (e.venue && e.venue.name) || (venues[x.venue_id] || {}).name || '', away: m[1].trim(), home: m[2].trim() });
    }
    if (!j.more) break;
  }
  cache[slug] = { at: Date.now(), games };
  try { fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch {}
  return games;
}
const has = (s, t) => !!t && [t.full, t.name, t.city && t.name].filter(Boolean).some(n => String(s).toLowerCase().includes(n.toLowerCase()));
const loose = (s, x) => !!x && (String(s).toLowerCase().includes(x.toLowerCase()) || String(s).toLowerCase().split(' ').pop() === x.toLowerCase().split(' ').pop());

/** Find a game for `team` (a teams.js team) by date and/or opponent (a teams.js team or free text). Returns a watch entry or null. */
async function findGame(team, { date, opp, oppText, today } = {}) {
  const games = (await teamGames(team.slug)).filter(g => g.date >= (today || '0000'));
  const isOpp = g => opp ? has(g.away + ' ' + g.home, opp) : oppText ? loose(g.away, oppText) || loose(g.home, oppText) : true;
  const g = games.filter(x => (!date || x.date === date) && isOpp(x)).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!g) return null;
  const mineHome = has(g.home, team);
  return { team: team.label || team.name, opponent: mineHome ? g.away : g.home, date: g.date, time: g.time, venue: g.venue, home: mineHome,
    gametimeId: g.gametimeId, gametime: g.gametime, league: team.league };
}
module.exports = { teamGames, findGame };
