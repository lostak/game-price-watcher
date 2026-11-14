// CI entry: runs the tests and reports the result to "Personal: app check" ("ISSUE: Tests: …" lines, or none when all
// pass) so the App doctor fixes a failing script the next morning. Exits non-zero on failure (the push shows red).
'use strict';
const { spawnSync } = require('child_process'), path = require('path');
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'scripts.test.js')], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
const failed = (r.stdout || '').split('\n').filter(l => /^not ok \d+ - /.test(l)).map(l => l.replace(/^not ok \d+ - /, '').replace(/\\#/g, '#'));
if (r.status !== 0 && !failed.length) failed.push('the test run itself crashed – see the workflow log');
(async () => {
  if (process.env.GCAL_SA_KEY) {
    const { setSection } = require('../checkreport');
    await setSection('Tests', 'TESTS RUN', failed.map(f => `game-price-watcher test failing: "${f}" (${process.env.GITHUB_SHA ? 'commit ' + process.env.GITHUB_SHA.slice(0, 7) : 'local'})`)).catch(e => console.log('report failed: ' + e.message));
  }
  process.exit(failed.length ? 1 : 0);
})();
