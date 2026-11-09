// Finds the listing data behind a TickPick and a Vivid Seats game page (real Chrome): all XHR/fetch URLs, embedded JSON,
// and a same-origin fetch of likely listing endpoints.
'use strict';
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const T = { name: 'TickPick', url: 'https://www.tickpick.com/buy-washington-wizards-vs-denver-nuggets-tickets-capital-one-arena-3-24-27-7pm/820610?qty=4', id: '820610',
  tries: ['https://api.tickpick.com/1.0/listings/internal/event/820610', 'https://www.tickpick.com/api/listings/820610', 'https://api.tickpick.com/1.0/events/820610/listings?qty=4'] };
const V = { name: 'VividSeats', url: 'https://www.vividseats.com/houston-rockets-tickets-toyota-center---tx-11-9-2026/production/7432959?quantity=4', id: '7432959',
  tries: ['/hermes/api/v1/listings?productionId=7432959&quantity=4', '/hermes/api/v1/listings?productionId=7432959', '/hermes/api/v1/productions/7432959'] };
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  for (const s of [T, V]) {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' }), page = await ctx.newPage(), reqs = [];
    page.on('response', async r => { const rt = r.request().resourceType(); if (rt === 'xhr' || rt === 'fetch') { let len = 0; try { len = (await r.body()).length; } catch {} reqs.push(`${r.status()} ${len}b ${r.headers()['content-type'] || ''} ${r.url().slice(0, 160)}`); } });
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(14000);
    console.log(`=== ${s.name} XHR/fetch (${reqs.length}) ===`); reqs.filter(x => !/analytics|fullstory|segment|google|facebook|datadog|sentry|optimizely|bing|tiktok|doubleclick|clarity|hotjar|amplitude|braze|launchdarkly|cookielaw|onetrust/i.test(x)).slice(0, 25).forEach(x => console.log('  ' + x));
    const nd = await page.evaluate(() => { const el = document.getElementById('__NEXT_DATA__'); return el ? el.textContent.length + ' chars, keys: ' + Object.keys(JSON.parse(el.textContent).props?.pageProps || {}).join(',') : 'no __NEXT_DATA__'; });
    console.log('  embedded:', nd);
    for (const u of s.tries) {
      const out = await page.evaluate(async (u) => { try { const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } }); const t = await r.text(); return `${r.status} ${r.headers.get('content-type')} ${t.length}b ${t.slice(0, 220).replace(/\s+/g, ' ')}`; } catch (e) { return 'error ' + e.message; } }, u);
      console.log(`  in-page fetch ${u}: ${out}`);
    }
    await ctx.close();
  }
  await b.close();
})();
