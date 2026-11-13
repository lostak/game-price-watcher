// Diagnostics (manual, via run-script.yml script=inspect): how a calendar event's description is really stored –
// plain text or HTML – for each log the apps parse. Prints only the shape and the first characters, nothing else.
'use strict';
const gcal = require('./gcal');
(async () => {
  for (const t of ['picks log', 'pool log', 'ski workout log', 'betting lesson log', 'golf watch', 'ski season log', 'billers log', 'car log', 'life settings', 'ticket watch log', 'app versions', 'task guardian log', 'lesson log']) {
    const ev = await gcal.findByTitle('Personal: ' + t, t).catch(() => null);
    if (!ev) { console.log(`${t}: not found`); continue; }
    const d = ev.description || '';
    console.log(`${t}: ${d.length} chars, ${(d.match(/\n/g) || []).length} newlines, ${(d.match(/<br\s*\/?>/gi) || []).length} <br>, ${(d.match(/<\/?(p|div|span|b|ul|li|a)\b/gi) || []).length} other tags, ${(d.match(/&(amp|lt|gt|quot|#39|nbsp);/g) || []).length} entities, updated ${ev.updated} | ${JSON.stringify(d.slice(0, 160))}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
