// Inspect listing data on a Nuggets HOME game: Vivid Seats __NEXT_DATA__.initialListingsData and TickPick's rendered listings.
'use strict';
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const show = (o, d = 0) => JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v)).slice(0, 900);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' }), page = await ctx.newPage();
  // Vivid Seats
  await page.goto('https://www.vividseats.com/denver-nuggets-tickets--sports-nba-basketball/performer/235', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000);
  let ev = (await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href))).find(h => /ball-arena/.test(h) && /production\/\d+/.test(h));
  console.log('VIVID home game:', ev);
  await page.goto(ev.split('?')[0] + '?quantity=4', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(9000);
  const v = await page.evaluate(() => { const p = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps;
    const L = p.initialListingsData; return { type: typeof L, keys: L && Object.keys(L), prod: p.initialProductionDetailsData && { name: p.initialProductionDetailsData.name, minPrice: p.initialProductionDetailsData.minPrice, listingCount: p.initialProductionDetailsData.listingCount }, priceUpdatedAt: p.priceUpdatedAt, L }; });
  console.log('keys:', v.keys, 'prod:', JSON.stringify(v.prod), 'priceUpdatedAt:', v.priceUpdatedAt);
  const arr = v.L && (Array.isArray(v.L) ? v.L : v.L.tickets || v.L.listings || Object.values(v.L).find(Array.isArray));
  console.log('listings array length:', arr?.length);
  (arr || []).slice(0, 3).forEach(x => console.log('  ' + show(x)));
  if (v.L && !Array.isArray(v.L)) console.log('  global:', show(v.L.global || v.L.meta || {}));
  // TickPick
  await page.goto('https://www.tickpick.com/denver-nuggets-tickets/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000);
  ev = (await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href))).find(h => /buy-.*ball-arena/.test(h));
  console.log('TICKPICK home game:', ev);
  await page.goto(ev.split('?')[0] + '?qty=4', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12000);
  const t = await page.evaluate(() => {
    const text = document.body.innerText; const rows = text.split('\n').filter(l => /\$\d/.test(l) || /^(Section|Sec|Row|\d{3}\b)/.test(l)).slice(0, 25);
    const cand = [...document.querySelectorAll('[class*="listing" i], [data-testid*="listing" i], [class*="Listing"]')];
    return { rows, count: cand.length, sample: cand.slice(0, 3).map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 160)), cls: cand.slice(0, 3).map(e => e.className.toString().slice(0, 80)) };
  });
  console.log('rendered listing elements:', t.count, t.cls); t.sample.forEach(s => console.log('  el: ' + s)); t.rows.forEach(r => console.log('  line: ' + r.slice(0, 120)));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
