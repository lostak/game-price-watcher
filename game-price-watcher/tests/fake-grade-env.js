// Preload for running grade.js in a test: a fake calendar (the fixture in FAKE_LOG) and a fake ESPN.
'use strict';
const fs = require('fs'), path = require('path');
const ev = { id: 'LOG', summary: 'Personal: picks log', description: fs.readFileSync(process.env.FAKE_LOG, 'utf8') };
require.cache[require.resolve(path.join(__dirname, '..', 'gcal'))] = { loaded: true, exports: {
  ready: true, todayLocal: () => '2026-11-17', findByTitle: async () => ev, search: async () => [], get: async () => ev,
  patch: async (id, b) => { process.stdout.write('PATCHED\n' + b.description + '\n'); } } };
const team = (abbr, name, loc, score) => ({ score: String(score), team: { abbreviation: abbr, displayName: `${loc} ${name}`, shortDisplayName: name, name, location: loc } });
global.fetch = async url => { process.stdout.write('ESPN ' + url + '\n'); return { ok: true, json: async () => ({ events: /nfl/.test(url) ? [{ competitions: [{ status: { type: { completed: true } },
  competitors: [team('GB', 'Packers', 'Green Bay', 10), team('MIN', 'Vikings', 'Minnesota', 30)] }] }] : [] }) }; };
