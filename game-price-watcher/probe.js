// One-off probe: which ticket sites still answer from a GitHub runner, by plain HTTP and by real (headed) Chrome?
// Prints, per site: status, page title, block signs, prices seen, and any JSON API calls the page made that carry prices.
'use strict';
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BLOCK = /just a moment|access denied|captcha|are you a robot|attention required|verify you are human|pardon our interruption|request blocked|px-captcha|unusual traffic/i;

const PAGES = {
  TickPick: 'https://www.tickpick.com/denver-nuggets-tickets/',
  SeatGeek: 'https://seatgeek.com/denver-nuggets-tickets',
  VividSeats: 'https://www.vividseats.com/denver-nuggets-tickets--sports-nba-basketball/performer/235',
  StubHub: 'https://www.stubhub.com/denver-nuggets-tickets/performer/2732/',
  Ticketmaster: 'https://www.ticketmaster.com/denver-nuggets-tickets/artist/805924',
  'Ball Arena (official)': 'https://www.ballarena.com/events/category/nuggets',
};
const APIS = {
  'TickPick search API': 'https://api.tickpick.com/1.0/events?performerId=&q=denver%20nuggets',
  'SeatGeek API (no key)': 'https://api.seatgeek.com/2/events?q=denver+nuggets',
  'Vivid Seats hermes': 'https://www.vividseats.com/hermes/api/v1/productions?performerId=235&pageSize=5',
  'StubHub catalog': 'https://www.stubhub.com/api/search?q=denver%20nuggets',
  'Gametime (current source)': 'https://mobile.gametime.co/v1/events?performer_slug=nbaden&per_page=1',
};

(async () => {
  console.log('=== plain HTTP ===');
  for (const [name, url] of Object.entries(APIS)) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/html' }, redirect: 'follow' });
      const t = await r.text();
      console.log(`${name}: ${r.status} ${r.headers.get('content-type') || ''} ${BLOCK.test(t) ? 'BLOCKED' : ''} ${t.slice(0, 140).replace(/\s+/g, ' ')}`);
    } catch (e) { console.log(`${name}: error ${e.message}`); }
  }
  console.log('=== real Chrome (headed, xvfb) ===');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  for (const [name, url] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/Denver' });
    const page = await ctx.newPage(); const apis = [];
    page.on('response', async (res) => {
      const ct = res.headers()['content-type'] || '';
      if (!/json/.test(ct) || res.status() !== 200) return;
      try { const t = await res.text(); if (/"(price|lowPrice|min_?price|lowest_?price|listing)/i.test(t)) apis.push(`${res.url().slice(0, 140)} (${t.length} bytes)`); } catch {}
    });
    try {
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(9000);
      const title = await page.title(), body = await page.evaluate(() => document.body?.innerText || '');
      const prices = (body.match(/\$\s?\d{2,4}/g) || []).slice(0, 6);
      console.log(`${name}: HTTP ${r?.status()} | "${title.slice(0, 70)}" | ${BLOCK.test(title + body.slice(0, 3000)) ? 'BLOCKED' : 'ok'} | prices: ${prices.join(' ') || 'none'} | events: ${(body.match(/\bvs\.?\s/gi) || []).length}`);
      apis.slice(0, 4).forEach(a => console.log(`   json: ${a}`));
    } catch (e) { console.log(`${name}: error ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }
  await browser.close();
})();
