// Nightly pool focus (5:00 PM) and ski workout (8:00 PM), moved off Claude: they only step through fixed rotations.
// Run from tick.yml: `node rotations.js pool` after 4:37 PM and `node rotations.js ski` after 7:37 PM, once a day each.
// Reads the logs the Pocket processor keeps ("Personal: pool log" POOL-DAY / POOL-NIGHTS, "Personal: ski workout log"
// SKI-DAY), creates the evening event with a popup; the calendar → Discord forwarder DMs it to Bradley.
'use strict';
const fs = require('fs');
const cal = require('./gcal');
const STATE = 'state/rotations.json';
const which = process.argv[2];

const POOL = [
  ['PRE-SHOT ROUTINE', 'Decide standing up, step into the line, pause at the back, stay down.', '4 min straight-in stop shots, a diamond from the corner pocket.', 'Full routine on every shot, even the easy ones.'],
  ['CUE BALL CONTROL', 'Speed before spin; play for an area, not a spot; 90° rule on stun, 30° rule on roll.', 'Stop, then follow a foot, then draw a foot on the same straight-in shot.', 'Call your leave before every shot and count how many land within a foot.'],
  ['READING THE TABLE', 'Find problem balls and your key ball before the first shot of every inning; fix problems early.', 'Before each game, walk the table and name your worst ball.', 'Your first move every inning is fixing your worst ball.'],
  ['SAFETIES', 'No good shot, or a shot with no next shot, means play safe. Hide behind your balls, block their pocket, or soft-hit and stop on a rail.', 'Set up and play one hide-behind safety.', 'At least one deliberate safety per game.'],
  ['THE BREAK', 'Cue ball a few inches off the side rail, full hit on the head ball, about 80% speed, just below center, stay down.', 'Two breaks from your one spot.', 'Note where the cue ball stops after every break.'],
  ['RUNNING OUT', 'Name your key ball before your second-to-last ball and play shape on it.', 'Straight-in stop shots, moving back a diamond each make.', 'Key ball every rack.'],
];
const SKI = [
  ['LEG STRENGTH', 'bodyweight squats; reverse lunges, alternating; glute bridges; wall sit'],
  ['SINGLE-LEG AND BALANCE', 'split squats with rear foot on the couch (switch legs each round); single-leg Romanian deadlifts; single-leg balance, eyes closed; lateral lunges'],
  ['CORE', 'plank; side plank (switch sides at 20 s); dead bugs; bird dogs'],
  ['POWER', 'jump squats; skater hops; lateral line hops; squat thrusts (quiet version: fast-tempo squats, slow skater lunges, quick lateral steps, step-back burpees)'],
  ['SKI-STANCE ENDURANCE', 'ski-tuck hold with small pulses; wall sit; lateral squat walks; squat to calf raise'],
  ['MOBILITY AND RECOVERY', 'deep squat hold; 90/90 hip switches; couch stretch for hip flexors; ankle rocks against a wall (slow, hold each the full 40 s)'],
];
const cap = s => s.charAt(0) + s.slice(1).toLowerCase();

// a Date for HH:MM today in Denver
function localAt(h, m, dayOffset = 0) {
  const today = cal.todayLocal();
  const probe = new Date(`${today}T12:00:00Z`);
  const off = (new Date(probe.toLocaleString('en-US', { timeZone: cal.TZ })) - new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60e3;
  return new Date(Date.parse(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - off * 60e3 + dayOffset * 864e5);
}
const at = (h, m) => { const d = localAt(h, m); return d < new Date() ? cal.nextQuarter() : d; };
const dayEvents = async (from, to) => (await cal.api('GET', '/events', null, { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 })).items || [];
const sessions = desc => String(desc || '').split('\n').filter(l => /^\d{4}-\d{2}-\d{2}: /.test(l));
const counter = (desc, key) => parseInt((String(desc || '').match(new RegExp(`^${key}\\s*(\\d+)`, 'm')) || [])[1], 10) || 1;

async function upsert(title, prefix, description, when) {
  const today = await dayEvents(localAt(0, 0), localAt(0, 0, 1));
  const ex = today.find(e => (e.summary || '').startsWith(prefix));
  if (ex) return cal.patch(ex.id, { summary: title, description });
  return cal.insert({ summary: title, description, when, popup: 0 });
}

async function pool() {
  const log = await cal.findByTitle('Personal: pool log', 'pool log', { back: 365, ahead: 2 });
  const nights = (String(log?.description || '').match(/^POOL-NIGHTS:\s*(.+)$/m) || [])[1];
  const wd = new Date().toLocaleDateString('en-US', { timeZone: cal.TZ, weekday: 'short' });
  if (nights && !/any/i.test(nights) && !new RegExp(`\\b${wd}`, 'i').test(nights)) return 'Not a pool night.';
  const n = Math.min(Math.max(counter(log?.description, 'POOL-DAY:'), 1), 6), [name, cue, warm, game] = POOL[n - 1];
  const last = sessions(log?.description).pop();
  const desc = [`FOCUS ${n} OF 6: ${name}`, `CUE: ${cue}`, `WARM-UP (if the table's free): ${warm}`, `GAME CHALLENGE: ${game}`,
    `AFTER: say "personal practiced pool" into Pocket (or reply here in Discord) to move to the next focus. Add your numbers if you have them: games won/played, makeable misses, leaves called within a foot, breaks with a ball made.`,
    last ? `LAST SESSION: ${last.replace(/\s*\(Pocket ID:[^)]*\)/, '')}` : null,
    'Set your nights: "personal pool nights Tue Thu" (or "any").', 'Full plan: 8-Ball Improvement Plan doc.'].filter(Boolean).join('\n');
  await upsert(`Personal: pool focus – ${cap(name)}`, 'Personal: pool focus', desc, at(17, 0));
  return `Pool focus ${n} of 6: ${cap(name)}.`;
}

async function ski() {
  // busy tonight: any non-"Personal:" timed event overlapping 7–10 PM
  const tonight = await dayEvents(localAt(19, 0), localAt(22, 0));
  const silent = e => e.reminders && !e.reminders.useDefault && !(e.reminders.overrides || []).length;
  if (tonight.some(e => e.start?.dateTime && !/^(✅\s*)?(Personal|Price watch|Show watch|Claude)/i.test(e.summary || '') && e.transparency !== 'transparent' && !silent(e))) return 'Busy tonight – skipped.';
  const log = await cal.findByTitle('Personal: ski workout log', 'ski workout log', { back: 365, ahead: 2 });
  let n = Math.min(Math.max(counter(log?.description, 'SKI-DAY:'), 1), 6);
  const S = sessions(log?.description).length, last = sessions(log?.description).pop();
  const tomorrow = await dayEvents(localAt(0, 0, 1), localAt(0, 0, 2));
  const skiTomorrow = tomorrow.some(e => /\b(ski|skiing|powder day|powder alert|winter park|copper|a-basin|arapahoe|eldora|steamboat|aspen|snowmass|vail|breck|keystone|loveland|beaver creek)\b/i.test(`${e.summary} ${e.location || ''}`) && !/ski workout|ski weekend outlook|ski season log/i.test(e.summary || ''));
  if (skiTomorrow) n = 6;
  const [name, moves] = SKI[n - 1];
  const lvl = n === 6 ? '40 s holds, slow' : S >= 24 ? '50 s on / 10 s rest, pause at the bottom of squats and lunges' : S >= 12 ? '45 s on / 15 s rest' : '40 s on / 20 s rest';
  const levelUp = n !== 6 && (S === 12 || S === 24);
  const desc = [`WORKOUT ${n} OF 6: ${name}${levelUp ? ' – LEVEL UP' : ''}`,
    skiTomorrow ? "Ski day tomorrow – mobility tonight, doesn't count toward the rotation." : null,
    'WARM-UP 2 min: march in place, arm circles, good mornings, easy squats (30 s each)',
    `CIRCUIT 11 min: ${moves} – ${lvl}, ~3 rounds`,
    "COOL-DOWN 2 min: quad stretch, hamstring stretch, hip flexor lunge stretch, child's pose",
    'DONE? Say "personal did ski workout" into Pocket or reply here in Discord (or "personal ski workout, repeat" to do it again).',
    `${last ? `LAST: ${last.replace(/\s*\(Pocket ID:[^)]*\)/, '')} · ` : ''}Sessions logged: ${S}`, 'Full plan: Ski Fitness Rotation doc.'].filter(Boolean).join('\n');
  await upsert(`Personal: ski workout – ${cap(name)}`, 'Personal: ski workout –', desc, at(20, 0));
  return `Ski workout ${n} of 6: ${cap(name)} (${lvl.split(',')[0]}).`;
}

(async () => {
  if (!cal.ready) { console.log('rotations: calendar not configured'); return; }
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const today = cal.todayLocal();
  if (st[which] === today) { console.log(`${which}: already done today`); return; }
  const out = which === 'pool' ? await pool() : which === 'ski' ? await ski() : (() => { throw new Error('usage: node rotations.js pool|ski'); })();
  console.log(out);
  st[which] = today; fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st));
})().catch(e => { console.error('rotations:', e.message); process.exit(1); });
