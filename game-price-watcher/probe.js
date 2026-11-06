// Probe 3: Gametime mobile API shape (events + listings), no browser.
'use strict';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
(async () => {
  const s = await get('https://mobile.gametime.co/v1/search?q=denver%20nuggets');
  console.log('search status', s.status, 'keys', Object.keys(s.j || {}));
  const ev = (s.j && s.j.events) || [];
  console.log('events:', ev.length);
  for (const e of ev.slice(0, 4)) { const x = e.event || e; console.log('  ', x.id, x.datetime_local, x.name, '| venue', e.venue && e.venue.name, '| performers', (e.performers || []).map(p => p.slug || p.name).join(','), '| keys', Object.keys(x).slice(0, 25).join(',')); }
  const home = ev.find(e => /ball arena/i.test(JSON.stringify(e.venue || '')) || /nuggets/i.test((e.event || e).name || '')) || ev[0];
  if (!home) return;
  const id = (home.event || home).id;
  console.log('event sample:', JSON.stringify(home).slice(0, 1200));
  for (const u of [`https://mobile.gametime.co/v1/listings?event_id=${id}&quantity=4`, `https://mobile.gametime.co/v2/listings?event_id=${id}&quantity=4`, `https://mobile.gametime.co/v1/events/${id}`, `https://mobile.gametime.co/v1/events?performer_id=nbaden`, `https://mobile.gametime.co/v1/performers/nbaden/events`, `https://mobile.gametime.co/v1/events?performer_slug=nbaden`]) {
    const r = await get(u); console.log(r.status, u, '::', r.t.slice(0, 700).replace(/\s+/g, ' '));
  }
})();
