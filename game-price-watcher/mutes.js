// Muted games: "stop Nuggets" must also silence the AUTOMATIC home-game watches, not only the ones Bradley added (Nov 21).
// Stored as MUTE: lines on the "Personal: ticket watch" calendar event (or cfg.muted in wants.json without a calendar):
//   MUTE: all                    → no automatic games at all (only games he asks for)
//   MUTE: Nuggets                → no automatic Nuggets games
//   MUTE: 2026-11-20 Nuggets     → just that game
const Teams = require('./teams');
const full = n => (Teams.byName(n) || {}).full || String(n || '').toLowerCase();
const sameTeam = (a, b) => full(a) === full(b);
function parse(desc) {
  return [...String(desc || '').matchAll(/^\s*MUTE:\s*(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)\s*$/gim)]
    .map(m => m[2].trim().toLowerCase() === 'all' ? { all: true } : { date: m[1] || undefined, team: m[2].trim() });
}
const line = m => 'MUTE: ' + (m.all ? 'all' : (m.date ? m.date + ' ' : '') + m.team);
const covers = (m, g) => m.all || (sameTeam(m.team, g.team) && (!m.date || m.date === g.date));
// a game he asked for (manual / watched) is never muted
const isMuted = (g, mutes) => !(g.manual || g.watched) && (mutes || []).some(m => covers(m, g));
// adding a mute: a wider one replaces narrower ones it covers
function add(mutes, m) {
  if ((mutes || []).some(x => x.all || (!m.all && sameTeam(x.team, m.team) && (!x.date || x.date === m.date)))) return mutes;
  return [...(mutes || []).filter(x => !(m.all || (sameTeam(x.team, m.team) && (!m.date || x.date === m.date)))), m];
}
// "resume Nuggets" / watching a game again: drop the mutes that would silence it (an "all" mute stays unless resuming all)
function remove(mutes, { team, date, all } = {}) {
  if (all) return [];
  return (mutes || []).filter(x => x.all || !(sameTeam(x.team, team) && (!date || !x.date || x.date === date)));
}
const describe = m => m.all ? 'all automatic games' : (m.date ? new Date(m.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' : 'all ') + m.team + (m.date ? '' : ' games');
module.exports = { parse, line, isMuted, add, remove, describe, sameTeam };
