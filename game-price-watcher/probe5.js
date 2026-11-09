'use strict';
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US' }), page = await ctx.newPage();
  await page.goto('https://www.vividseats.com/denver-nuggets-tickets-ball-arena-11-16-2026/production/7432981?quantity=4', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(12000);
  const r = await page.evaluate(() => {
    // smallest elements that contain both a section/row marker and a price
    const all = [...document.querySelectorAll('body *')].filter(e => e.children.length < 25 && /\$\d/.test(e.innerText || '') && /(sec|section|row|\b1\d\d\b|\b2\d\d\b|\b3\d\d\b|lower|upper|club|floor)/i.test(e.innerText || '') && (e.innerText || '').length < 220);
    const leaves = all.filter(e => !all.some(o => o !== e && e.contains(o)));
    return { n: leaves.length, rows: leaves.slice(0, 15).map(e => (e.getAttribute('data-testid') || e.className.toString().slice(0, 40)) + ' :: ' + e.innerText.replace(/\s+/g, ' ').slice(0, 150)),
      qty: [...document.querySelectorAll('select, [aria-label*="quantity" i], [data-testid*="quantity" i]')].map(e => (e.getAttribute('aria-label') || e.getAttribute('data-testid') || e.tagName) + '=' + (e.value || e.innerText || '').slice(0, 30)).slice(0, 4),
      fees: /incl(udes|\.)? fees|estimated fees|all-in|before fees/i.exec(document.body.innerText)?.[0] || 'no fee wording' };
  });
  console.log('VIVID rows found:', r.n, '| quantity controls:', r.qty.join(' ; '), '| fee wording:', r.fees); r.rows.forEach(x => console.log('  ' + x));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
