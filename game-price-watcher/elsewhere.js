// "Elsewhere" comparison: each watched game's cheapest single ticket on TickPick, SeatGeek and Vivid Seats.
// Read from each team's performer page (one page load per site per team), at most once an hour, in the same headed
// Chrome as watch.js. Those pages only show "from $X" per game (their listing APIs are bot-walled), so this is a
// single-ticket floor, not a price for 4 together – it is labelled that way everywhere it shows.
// Standalone test: xvfb-run -a node elsewhere.js --test   (prints what it finds for the games in state/games.json)
'use strict';
const fs = require('fs');
const path = require('path');
const Teams = require('./teams');

const FILE = path.join(__dirname, 'state', 'elsewhere.json');   // { at, vivid: {team: performerUrl}, games: {gameKey: {tickpick, seatgeek, vivid, urls}} }
const EVERY = 55 * 60e3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const VIVID_KNOWN = { Nuggets: 'https://www.vividseats.com/denver-nuggets-tickets--sports-nba-basketball/performer/235' };
const SITES = ['tickpick', 'seatgeek', 'vivid'];
const LABEL = { tickpick: 'TickPick', seatgeek: 'SeatGeek', vivid: 'Vivid' };

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { at: null, vivid: {}, games: {} }; } };
const write = d => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 1)); };
const gameKey = g => `${g.date} ${g.team} vs ${g.opponent}`;
const slug = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = n => String(n).padStart(2, '0');
const iso = (m, d, y) => `${y.length === 2 ? '20' + y : y}-${pad(m)}-${pad(d)}`;

// event links on each performer page, and how to read the game date out of the link
const LINK = {
  tickpick: { re: 'tickpick\\.com/buy-[a-z0-9-]+/\\d+', date: h => { const m = h.match(/-(\d{1,2})-(\d{1,2})-(\d{2})-\d{1,2}(?:-\d{2})?[ap]m\/\d+/); return m && iso(m[1], m[2], m[3]); } },
  seatgeek: { re: 'seatgeek\\.com/[a-z0-9-]+-tickets/\\d{1,2}-\\d{1,2}-20\\d\\d-[a-z0-9-]*/[a-z-]+/\\d+', date: h => { const m = h.match(/\/(\d{1,2})-(\d{1,2})-(20\d\d)-/); return m && iso(m[1], m[2], m[3]); } },
  vivid: { re: 'vividseats\\.com/[a-z0-9-]+-tickets[a-z0-9-]*-\\d{1,2}-\\d{1,2}-20\\d\\d/production/\\d+', date: h => { const m = h.match(/-(\d{1,2})-(\d{1,2})-(20\d\d)\/production\//); return m && iso(m[1], m[2], m[3]); } },
};

// In the page: for each game link, climb to the smallest container that has a "$" and no other game's link; take its lowest price.
function scan(reSrc) {
  const re = new RegExp(reSrc), base = h => h.split(/[?#]/)[0];
  const links = [...document.querySelectorAll('a[href]')].filter(a => re.test(a.href) && !/parking|club-pass|season/i.test(a.href));
  const out = {};
  for (const a of links) {
    const href = base(a.href);
    let el = a, price = null;
    for (let i = 0; i < 7 && el; i++, el = el.parentElement) {
      if ([...el.querySelectorAll('a[href]')].some(x => re.test(x.href) && base(x.href) !== href)) break;
      const m = (el.innerText || '').match(/\$\s?\d[\d,]*(?:\.\d\d)?/g);
      if (m) { price = Math.min(...m.map(s => +s.replace(/[$,\s]/g, ''))); break; }
    }
    if (price != null && price > 0 && (!out[href] || price < out[href])) out[href] = price;
    else if (!(href in out)) out[href] = null;
  }
  return out;
}

const DEBUG = process.argv.includes('--test');
const fresh = browser => browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/Denver' });
// each page load gets its own fresh profile (SeatGeek walls a second visit that carries the first visit's cookies)
async function load(browser, url, reSrc) {
  const ctx = await fresh(browser), page = await ctx.newPage();
  try {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(900); }   // lazy-loaded lists
    const found = await page.evaluate(scan, reSrc);
    if (DEBUG) console.log(`  ${url}\n` + Object.entries(found).map(([h, p]) => `    ${p == null ? '  -' : '$' + p} ${h.replace(/^https:\/\/(www\.)?/, '')}`).join('\n'));
    return { status: r && r.status(), found };
  } finally { await ctx.close(); }
}

async function vividUrl(ctx, team, state) {
  if (state.vivid[team.name]) return state.vivid[team.name];
  if (VIVID_KNOWN[team.name]) return (state.vivid[team.name] = VIVID_KNOWN[team.name]);
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.vividseats.com/search?searchTerm=' + encodeURIComponent(team.full), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    const want = slug(team.full) + '-tickets';
    const hit = await page.evaluate(w => ([...document.querySelectorAll('a[href]')].map(a => a.href.split(/[?#]/)[0]).find(h => /\/performer\/\d+$/.test(h) && h.includes('/' + w))) || null, want);
    if (hit) state.vivid[team.name] = hit;
    return hit;
  } catch { return null; } finally { await page.close(); }
}

// games: the watch list (upcoming). Returns the state ({games: {key: {...}}}); refreshes at most hourly unless force.
async function refresh(browser, games, { force = false, log = console.log } = {}) {
  const state = read();
  state.vivid = state.vivid || {};
  if (!force && state.at && Date.now() - Date.parse(state.at) < EVERY) return state;
  const ctx = await fresh(browser);
  const next = {}, notes = [];
  try {
    for (const name of [...new Set(games.map(g => g.team))]) {
      const team = Teams.byName(name) || ((Teams.parse(name)[0] || {}).teams || [])[0];
      if (!team || !team.full) { notes.push(`${name}: unknown team`); continue; }
      const mine = games.filter(g => g.team === name);
      const pages = { tickpick: `https://www.tickpick.com/${slug(team.full)}-tickets/`, seatgeek: `https://seatgeek.com/${slug(team.full)}-tickets`, vivid: await vividUrl(ctx, team, state) };
      for (const site of SITES) {
        if (!pages[site]) { notes.push(`${name} ${site}: no performer page`); continue; }
        try {
          const { status, found } = await load(browser, pages[site], LINK[site].re);
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
          const byDate = {};
          for (const [href, price] of Object.entries(found)) {
            const d = LINK[site].date(href); if (!d) continue;
            if (!byDate[d] || (price != null && (byDate[d].price == null || price < byDate[d].price))) byDate[d] = { href, price };
          }
          let n = 0;
          for (const g of mine) {
            const tpId = site === 'tickpick' && g.tickpick && (g.tickpick.match(/\/(\d+)\/?$/) || [])[1];
            const hit = (tpId && Object.entries(found).map(([href, price]) => ({ href, price })).find(x => x.href.includes('/' + tpId))) || byDate[g.date];
            if (!hit || hit.price == null) continue;
            const e = next[gameKey(g)] || (next[gameKey(g)] = { urls: {} });
            e[site] = Math.round(hit.price); e.urls[site] = hit.href; n++;
          }
          notes.push(`${name} ${site}: HTTP ${status}, ${Object.keys(found).length} game links, ${n}/${mine.length} matched`);
        } catch (e) { notes.push(`${name} ${site}: ${e.message.split('\n')[0].slice(0, 90)}`); }
      }
    }
  } finally { await ctx.close(); }
  // keep the last good reading for a game a site skipped this hour (a page that failed to load shouldn't blank the line)
  for (const [k, old] of Object.entries(state.games || {})) {
    if (!games.some(g => gameKey(g) === k)) continue;
    const e = next[k] || (next[k] = { urls: {} });
    for (const s of SITES) if (e[s] == null && old[s] != null) { e[s] = old[s]; e.urls[s] = (old.urls || {})[s]; }
  }
  Object.assign(state, { at: new Date().toISOString(), games: next, notes });
  log('Elsewhere: ' + notes.join(' | '));
  return state;
}

const lowest = e => { const v = e ? SITES.map(s => e[s]).filter(x => x != null) : []; return v.length ? Math.min(...v) : null; };
// "Elsewhere (1 ticket): TickPick from $17 · SeatGeek from $15 · Vivid from $19" – or '' when nothing is known
function line(e) {
  const parts = e ? SITES.filter(s => e[s] != null).map(s => `${LABEL[s]} from $${e[s]}`) : [];
  return parts.length ? `Elsewhere (1 ticket): ${parts.join(' · ')}` : '';
}

module.exports = { refresh, write, read, line, lowest, gameKey };

if (require.main === module) (async () => {
  const { chromium } = require('playwright');
  const cache = JSON.parse(fs.readFileSync(path.join(__dirname, 'state', 'games.json'), 'utf8'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const until = new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const games = cache.games.filter(g => g.date >= today && g.date <= until);
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const st = await refresh(browser, games, { force: true });
  await browser.close();
  for (const g of games) console.log(`${gameKey(g)}: ${line(st.games[gameKey(g)]) || 'none'}`);
  if (!process.argv.includes('--test')) write(st);
})().catch(e => { console.error(e); process.exit(1); });
