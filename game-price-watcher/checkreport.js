// Writes one job's findings into the silent "Personal: app check" event (marker APP-CHECK), which the Claude "App
// doctor" task reads every morning and fixes from. Each job owns its own lines ("ISSUE: Output: …", "ISSUE: Tests: …")
// plus one "<STAMP>: <time>" line; everything else in the event (the app check's own findings, the doctor's notes) is
// kept, and the RESULT line is recounted from all ISSUE lines. Re-reads the event right before writing.
'use strict';
const gcal = require('./gcal');

async function setSection(area, stamp, issues) {
  const ev = await gcal.findByTitle('Personal: app check', 'APP-CHECK', { back: 400, ahead: 2 });
  const own = l => l.startsWith(`ISSUE: ${area}:`) || l.startsWith(stamp + ':');
  const mine = [...new Set(issues)].map(x => `ISSUE: ${area}: ${x}`).concat(`${stamp}: ${new Date().toISOString()} (${gcal.nowLocal()})`);
  if (!ev) {
    const description = [`LAST RUN: (app check not run yet)`, `RESULT: ${issues.length ? issues.length + ' issue(s)' : 'OK'}`, ...mine, 'APP-CHECK'].join('\n');
    await gcal.insert({ summary: 'Personal: app check', description, when: new Date(new Date().toISOString().slice(0, 10) + 'T07:00:00Z'), popup: null });
    return;
  }
  const lines = String((await gcal.get(ev.id)).description || ev.description || '').split('\n').filter(l => !own(l) && l.trim() !== 'APP-CHECK');
  const at = Math.max(lines.findIndex(l => /^(DEVICE ERRORS THROUGH|RUN|DOCTOR):/.test(l)), 0) || lines.length;
  lines.splice(at, 0, ...mine);
  const n = lines.filter(l => /^ISSUE:/.test(l)).length, ri = lines.findIndex(l => /^RESULT:/.test(l));
  const result = `RESULT: ${n ? n + ' issue' + (n > 1 ? 's' : '') : 'OK'}`;
  if (ri >= 0) lines[ri] = result; else lines.splice(1, 0, result);
  await gcal.patch(ev.id, { description: lines.join('\n') + '\nAPP-CHECK' });
}
module.exports = { setSection };
