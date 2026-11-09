'use strict';
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  for (const url of ['https://www.vividseats.com/denver-nuggets-tickets-ball-arena-11-16-2026/production/7432981?quantity=4',
                     'https://www.tickpick.com/buy-denver-nuggets-vs-phoenix-suns-tickets-ball-arena-11-16-26-7pm/8205547/?qty=4']) {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' }), page = await ctx.newPage(), hits = [];
    page.on('response', async r => { const u = r.url(); if (!/listing|inventory|tickets\?|seats|price/i.test(u) || /\.(js|css|png|svg|woff2?)(\?|$)/.test(u)) return;
      let body = ''; try { body = (await r.text()).slice(0, 300).replace(/\s+/g, ' '); } catch {} hits.push(`${r.status()} ${r.request().method()} ${u.slice(0, 200)}\n      ${body}`); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(8000);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(2500); }
    console.log(`=== ${url.slice(8, 60)} – ${hits.length} hits ===`); hits.slice(0, 12).forEach(h => console.log('  ' + h));
    const txt = await page.evaluate(() => document.body.innerText.split('\n').filter(l => /\$\d/.test(l)).slice(0, 15).join(' | '));
    console.log('  page $ lines:', txt.slice(0, 600));
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
