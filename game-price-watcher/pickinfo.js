// Sport + game time for each pick. The slate's pick lines don't carry them; the picks log does
// ("2026-11-13 | Rangers -1.5 puck line @ Canucks (NHL) | +114 | … | 7:00 PM MT | …"), and the slate's SLATE section
// has them too ("NHL (…):" header, "- Rangers (11-8-1) @ Canucks (3-16-1), 7:00 PM – …") as a fallback.
'use strict';
const STOP = new Set('the and vs at over under puck line ml moneyline spread total draftkings fanduel bet365 parlay first half quarter game state'.split(' '));
const words = s => new Set(String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
const SPORT = { NFL: 'NFL', CFB: 'CFB', NCAAF: 'CFB', NBA: 'NBA', NCAAB: 'NCAAB', CBB: 'NCAAB', NHL: 'NHL', MLB: 'MLB', WNBA: 'WNBA', MLS: 'MLS', EPL: 'EPL', UFC: 'UFC', MMA: 'MMA', TT: 'Table tennis', 'TABLE TENNIS': 'Table tennis', TENNIS: 'Tennis', SOCCER: 'Soccer', GOLF: 'Golf' };
const EMOJI = { NFL: '🏈', CFB: '🏈', NBA: '🏀', NCAAB: '🏀', WNBA: '🏀', NHL: '🏒', MLB: '⚾', MLS: '⚽', EPL: '⚽', Soccer: '⚽', UFC: '🥊', MMA: '🥊', 'Table tennis': '🏓', Tennis: '🎾', Golf: '⛳' };
const sportOf = s => { const k = String(s || '').toUpperCase().trim(); return SPORT[k] || (k.length <= 6 && /^[A-Z]+$/.test(k) ? k : null); };
const TIME = /\b(\d{1,2}:\d{2}\s*[AP]M)(\s*(MT|MST|MDT|ET|EST|EDT|CT|PT))?\b/i;

function fromLog(desc, date) {          // today's single picks + parlay from the picks log
  const out = [];
  for (const l of String(desc || '').split('\n')) {
    if (!l.startsWith(date + ' |')) continue;
    const f = l.split(' | '), bet = f[1] || '';
    const parlay = /^PARLAY:/i.test(bet), sp = parlay ? null : sportOf((bet.match(/\(([A-Za-z ]{2,14})\)\s*$/) || [])[1]);
    const tf = f.find(x => TIME.test(x) && /(AM|PM)/i.test(x) && !/returns|result|close/i.test(x)) || '';
    const tm = tf.match(TIME);
    out.push({ bet, parlay, sport: sp, time: tm ? tm[1].toUpperCase().replace(/\s+/, ' ') : null, zone: tm ? (tm[3] || 'MT').toUpperCase() : null, w: words(bet) });
  }
  return out;
}
function fromSlate(desc) {               // fallback: game lines under sport headers in the slate's SLATE section
  const out = []; let sport = null, on = false;
  for (const l0 of String(desc || '').split('\n')) {
    const l = l0.trim();
    if (/^SLATE:/i.test(l)) { on = true; continue; }
    if (!on) continue;
    if (/^(Odds checked|Lines move|Sources|PARLAY|PICKS)\b/i.test(l)) break;
    const h = l.match(/^([A-Z][A-Za-z /&]{1,20}?)\s*(\(([^)]*)\))?:/);
    if (h && !l.startsWith('-')) {
      const no = new Set(((h[3] || '').match(/no ([A-Z]{2,5})\b/g) || []).map(x => x.slice(3)));
      const opts = h[1].split('/').map(s => s.trim()).filter(s => !no.has(s.toUpperCase()));
      sport = opts.length === 1 ? sportOf(opts[0]) : null; continue;
    }
    if (!l.startsWith('-')) continue;
    const g = l.replace(/^-\s*/, '').split(/\s+[–—]\s+/)[0], tm = g.match(TIME);
    out.push({ bet: g, sport, time: tm ? tm[1].toUpperCase().replace(/\s+/, ' ') : null, zone: tm ? (tm[3] || 'MT').toUpperCase() : null, w: words(g.replace(/,.*$/, '')) });
  }
  return out;
}
// Best match for one pick: most shared team words; needs at least one.
function match(pick, rows, parlay = false) {
  const pw = words(pick); let best = null, score = 0;
  for (const r of rows) { if (!!r.parlay !== parlay) continue; const s = overlap(pw, r.w); if (s > score) { score = s; best = r; } }
  return parlay ? rows.find(r => r.parlay) || null : best;
}
// Unix seconds for an "H:MM PM" Mountain-time kickoff on `date` (YYYY-MM-DD), for Discord's <t:…:t> (shows in each reader's own zone)
function epoch(date, time, tz = 'America/Denver') {
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*([AP])M/i); if (!m) return null;
  const [y, mo, d] = date.split('-').map(Number), h = (+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0);
  const guess = Date.UTC(y, mo - 1, d, h, +m[2]);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(guess)).find(p => p.type === 'timeZoneName').value;
  const om = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/), mins = om ? (om[1] === '-' ? -1 : 1) * (+om[2] * 60 + +(om[3] || 0)) : 0;
  return Math.round((guess - mins * 60000) / 1000);
}
module.exports = { fromLog, fromSlate, match, epoch, EMOJI, words };
