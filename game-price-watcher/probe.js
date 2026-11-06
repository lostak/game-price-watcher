// Probe 2: Gametime + Vivid Seats discovery through their search pages; direct API guesses for Gametime.
'use strict';
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
(async () => {
  console.log('=== direct API guesses');
  for (const u of ['https://mobile.gametime.co/v1/search?q=denver%20nuggets', 'https://mobile.gametime.co/v2/search?q=nuggets', 'https://mobile.gametime.co/v1/performers?slug=nbaden', 'https://mobile.gametime.co/v1/categories', 'https://api.seatgeek.com/2/events?performers.slug=denver-nuggets', 'https://www.vividseats.com/hermes/api/v1/search?searchTerm=nuggets']) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); const t = await r.text(); console.log(r.status, u, '::', t.slice(0, 250).replace(/\s+/g, ' ')); } catch (e) { console.log('ERR', u, e.message); }
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADFUL !== '1', args: ['--disable-blink-features=AutomationControlled'] }).catch(() => chromium.launch());
  for (const [name, url, linkRe] of [
    ['gametime', 'https://gametime.co/search?q=denver%20nuggets', /nuggets/i],
    ['gametime-home', 'https://gametime.co/', /nuggets|performers|nba/i],
    ['vividseats', 'https://www.vividseats.com/search?searchTerm=denver%20nuggets', /nuggets/i],
  ]) {
    console.log(`\n=== ${name}`);
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const seen = [];
    page.on('response', async r => { const u = r.url(); if (/\.(js|css|png|jpg|svg|woff2?|gif)(\?|$)/i.test(u) || /google|facebook|hightouch|segment|sentry|datadog|applovin|stackadapt|sardine|doubleclick|bing|tiktok|cookielaw|onetrust/i.test(u)) return; let t = ''; try { t = (await r.text()).slice(0, 160).replace(/\s+/g, ' '); } catch {} seen.push(`${r.status()} ${u.slice(0, 140)} :: ${t}`); });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(8000);
      console.log('title:', await page.title());
      const hrefs = [...new Set(await page.$$eval('a[href]', as => as.map(a => a.href)))].filter(h => linkRe.test(h));
      console.log('links:', hrefs.length, hrefs.slice(0, 8));
      console.log('responses:'); for (const s of seen.slice(0, 25)) console.log('  ', s);
      console.log('text:', await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, ' | ')));
    } catch (e) { console.log('error:', e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
})();
