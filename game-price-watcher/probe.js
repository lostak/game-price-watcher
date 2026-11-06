// One-off probe: which ticket sites let a GitHub runner read listings? Opens each site's Nuggets page, follows the first
// home-game link, and logs every JSON response whose URL looks like listings. Run: xvfb-run -a node probe.js
'use strict';
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SITES = [
  { name: 'gametime', team: 'https://gametime.co/nba-basketball/denver-nuggets-tickets/performers/nbaden', link: /gametime\.co\/.*nuggets.*tickets\/.*\/events\/|gametime\.co\/[a-z-]+\/[a-z-]+-at-denver-nuggets/i },
  { name: 'vividseats', team: 'https://www.vividseats.com/denver-nuggets-tickets--sports-nba-basketball/performer/459', link: /vividseats\.com\/.*nuggets.*\/production\/\d+/i },
  { name: 'seatgeek', team: 'https://seatgeek.com/denver-nuggets-tickets', link: /seatgeek\.com\/.*-at-denver-nuggets-tickets\//i },
  { name: 'stubhub', team: 'https://www.stubhub.com/denver-nuggets-tickets/performer/2704', link: /stubhub\.com\/.*nuggets.*\/event\/\d+/i },
  { name: 'tickpick', team: 'https://www.tickpick.com/nba/denver-nuggets-tickets/', link: /tickpick\.com\/buy-denver-nuggets-vs-/i },
];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADFUL !== '1', args: ['--disable-blink-features=AutomationControlled'] }).catch(() => chromium.launch());
  for (const s of SITES) {
    console.log(`\n=== ${s.name}`);
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const jsons = [];
    page.on('response', async r => {
      const u = r.url(); if (!/listing|inventory|ticket|event|offer|price/i.test(u) || /\.(js|css|png|jpg|svg|woff2?)(\?|$)/i.test(u)) return;
      try { const t = await r.text(); if (/^\s*[\[{]/.test(t)) jsons.push(`${r.status()} ${u.slice(0, 150)} :: ${t.slice(0, 200).replace(/\s+/g, ' ')}`); else if (r.status() >= 400) jsons.push(`${r.status()} ${u.slice(0, 150)} :: (not json)`); } catch {}
    });
    try {
      await page.goto(s.team, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(5000);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await sleep(600); }
      console.log('team page title:', await page.title());
      const hrefs = [...new Set(await page.$$eval('a[href]', as => as.map(a => a.href)))];
      const ev = hrefs.filter(h => s.link.test(h));
      console.log('event links:', ev.length, ev.slice(0, 3));
      console.log('team-page JSON:', jsons.slice(0, 6));
      jsons.length = 0;
      if (ev[0]) {
        const url = ev[0] + (ev[0].includes('?') ? '&' : '?') + 'quantity=4';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(12000);
        console.log('event page title:', await page.title());
        console.log('event-page JSON responses:'); for (const j of jsons.slice(0, 12)) console.log('  ', j);
        const text = await page.evaluate(() => document.body.innerText.slice(0, 600).replace(/\n+/g, ' | '));
        console.log('event page text:', text);
      }
    } catch (e) { console.log('error:', e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
})();
