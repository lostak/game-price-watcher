const GT = 'https://mobile.gametime.co/v1', UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); return r.ok ? r.json() : null; };
(async () => { const out = [];
  for (const c of ['nba', 'nfl', 'nhl']) for (let p = 1; p <= 4; p++) { const j = await get(`${GT}/performers?category=${c}&per_page=50&page=${p}`); const ps = (j && j.performers) || [];
    for (const x of ps) out.push([c, x.slug, x.name, x.short_name, x.abbrev].join('|')); if (!j || !j.more || !ps.length) break; }
  console.log('ROWS\n' + out.join('\n') + '\nEND'); })();
