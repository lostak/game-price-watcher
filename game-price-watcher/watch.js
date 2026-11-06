// game-price-watcher: watches resale ticket prices (4 seats together) for Bradley's teams' home games
// and posts to Slack + Discord when a price drops. Runs on GitHub Actions every 30 minutes while there is a
// home game within `daysAhead`; pauses itself otherwise (see .github/workflows/game-prices.yml).
//
// Sources: TickPick (all-in prices, no fees) and SeatGeek (with fees shown). Both are read by opening the
// public event page in Chrome and capturing the listings JSON the page itself loads. Nothing is bought,
// nobody signs in.
//
// Usage: node watch.js [--dry] [--debug] [--discover]
//   --dry       read prices, print, but post nothing and save nothing
//   --debug     verbose log (URLs seen, sample listing objects) – use this when a site changes
//   --discover  refresh the home-game schedule even if the cached one is fresh
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DRY = process.argv.includes('--dry');
const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const FORCE_DISCOVER = process.argv.includes('--discover');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'wants.json'), 'utf8'));
const STATE_DIR = path.join(__dirname, 'state');
const SEEN_FILE = path.join(STATE_DIR, 'seen.json');
const GAMES_FILE = path.join(STATE_DIR, 'games.json');
const TZ = CFG.timezone || 'America/Denver';
const QTY = CFG.quantity || 4;
const dbg = (...a) => { if (DEBUG) console.log('  [debug]', ...a); };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); }
function localDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function niceDate(dateStr) { const d = new Date(dateStr + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function money(n) { return '$' + Math.round(n); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- schedule discovery (home games from the public team pages) ----------
// TickPick event URLs look like /buy-denver-nuggets-vs-phoenix-suns-tickets-ball-arena-11-20-26-7pm/6512345/ (home team first)
// SeatGeek event URLs look like /phoenix-suns-at-denver-nuggets-tickets/11-20-2026-denver-co-ball-arena/nba/17123456
function parseTickPick(href, team) {
  const m = href.match(/\/buy-(.+?)-vs-(.+?)-tickets-.*?-(\d{1,2})-(\d{1,2})-(\d{2})-(\d{1,2})(\d{2})?(am|pm)[^/]*\/(\d+)\/?/i);
  if (!m) return null;
  if (!m[1].startsWith(team.homeSlug)) return null;                               // only home games (home team is listed first)
  const date = `20${m[5]}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}`;
  let h = +m[6] % 12; if (m[8].toLowerCase() === 'pm') h += 12;
  const opp = m[2].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { opponent: opp, date, time: `${String(h).padStart(2, '0')}:${m[7] || '00'}`, tickpick: href.replace(/\?.*$/, '') };
}
function parseSeatGeek(href, team) {
  const m = href.match(/\/(.+?)-at-(.+?)-tickets\/(\d{1,2})-(\d{1,2})-(\d{4})-[^/]+\/[^/]+\/(\d+)/i);
  if (!m) return null;
  if (!m[2].startsWith(team.homeSlug)) return null;
  const date = `${m[5]}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}`;
  return { opponent: m[1].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), date, seatgeek: href };
}
async function discoverTeam(browser, team) {
  const games = {};                                                                // date -> game
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const [site, parse] of [['tickpick', parseTickPick]]) {           // SeatGeek's team pages don't render for bots; skipped
    const url = team[site]; if (!url) continue;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(4000);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 3000); await sleep(800); }   // lazy-loaded lists
      const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href));
      const uniq = [...new Set(hrefs)];
      dbg(site, team.name, 'anchors:', uniq.length, 'sample:', uniq.filter(h => /\/buy-/.test(h)).slice(0, 4));
      let n = 0;
      for (const h of uniq) {
        const g = parse(h, team); if (!g) continue;
        n++;
        games[g.date] = Object.assign(games[g.date] || { team: team.name, venue: team.venue }, g, { opponent: games[g.date]?.opponent || g.opponent });
      }
      console.log(`  ${team.name} on ${site}: ${n} home game link(s)`);
    } catch (e) { console.log(`  ${team.name} on ${site}: ${e.message.split('\n')[0]}`); }
  }
  await ctx.close();
  return Object.values(games).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- listings ----------
const PRICE_KEYS = ['pf', 'dp', 'p', 'price', 'displayPrice', 'priceWithFees'];
const SECTION_KEYS = ['sn', 's', 'section', 'sectionName', 'sec'];
const ROW_KEYS = ['r', 'row', 'rowName'];
const QTY_KEYS = ['q', 'quantity', 'availableQuantity', 'qty'];
const SPLIT_KEYS = ['sp', 'splits', 'sv', 'validSplits'];
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? +v : null);
function pick(o, keys) { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; }
// Walk any JSON and pull out things that look like ticket listings.
function extractListings(json, out = [], depth = 0) {
  if (!json || depth > 8) return out;
  if (Array.isArray(json)) { for (const x of json) extractListings(x, out, depth + 1); return out; }
  if (typeof json !== 'object') return out;
  const price = num(pick(json, PRICE_KEYS)), section = pick(json, SECTION_KEYS);
  if (price && price > 0 && section !== undefined) {
    const q = num(pick(json, QTY_KEYS)); const sp = pick(json, SPLIT_KEYS);
    const splits = Array.isArray(sp) ? sp.map(num).filter(x => x) : null;
    out.push({ price, section: String(section), row: pick(json, ROW_KEYS), qty: q, splits, raw: json });
  }
  for (const v of Object.values(json)) if (v && typeof v === 'object') extractListings(v, out, depth + 1);
  return out;
}
function seatsFour(l) {
  if (l.splits && l.splits.length) return l.splits.includes(QTY);
  if (l.qty !== null && l.qty !== undefined) return l.qty >= QTY;
  return true;                                                                     // page was already filtered to quantity=4
}
const PREMIUM = /suite|loge|club|box|premium|vip|lounge|terrace|hospitality|parking/i;
function isLower(section, team) {
  if (PREMIUM.test(section)) return false;
  const m = String(section).match(/\d{3}/); if (!m) return /lower|100 level|plaza/i.test(section);
  const n = +m[0]; const lb = team.lowerBowl || { min: 100, max: 199 };
  return n >= lb.min && n <= lb.max;
}
async function capture(page, url, re, label) {
  let body = null;
  const onResp = async r => {
    if (!re.test(r.url()) || body) return;
    try { const j = await r.json(); if (extractListings(j).length) body = j; else dbg(label, 'JSON without listings from', r.url().slice(0, 120)); } catch {}
  };
  const seen = new Set();
  const onReq = r => { if (DEBUG && /api|listing|json/i.test(r.url()) && !/\.(png|jpg|css|js|woff)/.test(r.url())) seen.add(r.url().slice(0, 160)); };
  page.on('response', onResp); page.on('request', onReq);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < 40 && !body; i++) await sleep(500);                       // up to 20 s for the listings call
  } finally { page.off('response', onResp); page.off('request', onReq); }
  if (DEBUG && !body) dbg(label, 'no listings captured; XHRs seen:', [...seen].slice(0, 15));
  return body;
}
async function readSite(ctx, site, game, team) {
  const page = await ctx.newPage();
  try {
    let url = site === 'tickpick' ? game.tickpick : game.seatgeek;
    if (!url) return null;
    if (site === 'seatgeek') url += (url.includes('?') ? '&' : '?') + `quantity=${QTY}`;
    if (site === 'tickpick') url += (url.includes('?') ? '&' : '?') + `qty=${QTY}`;
    const re = site === 'tickpick' ? /api\.tickpick\.com.*listings|\/listings\//i : /event_listings|\/api\/.*listings/i;
    const j = await capture(page, url, re, site);
    if (!j) return { site, error: 'no listings data' };
    const all = extractListings(j);
    if (DEBUG) dbg(site, 'listing sample:', JSON.stringify(all[0] && all[0].raw).slice(0, 600));
    const ok = all.filter(seatsFour).filter(l => !/parking|suite|loge|hospitality/i.test(l.section));   // real seats only
    const cheapest = arr => arr.length ? arr.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const lower = cheapest(ok.filter(l => isLower(l.section, team)));
    const any = cheapest(ok);
    return { site, url, count: ok.length, all: any && { price: any.price, section: any.section, row: any.row }, lower: lower && { price: lower.price, section: lower.section, row: lower.row } };
  } catch (e) { return { site, error: e.message.split('\n')[0] }; }
  finally { await page.close(); }
}

// ---------- alerts ----------
async function notify(text) {
  const slack = process.env.SLACK_WEBHOOK_URL, discord = process.env.DISCORD_WEBHOOK_URL;
  if (!slack && !discord) throw new Error('SLACK_WEBHOOK_URL / DISCORD_WEBHOOK_URL not set');
  const post = async (url, body, name) => { if (!url) return; const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(name + ' post failed ' + r.status); };
  await post(slack, { text }, 'Slack');
  await post(discord, { content: text.replace(/\*([^*\n]+)\*/g, '**$1**').slice(0, 1990) }, 'Discord');
}
function judge(tier, price, target, now) {
  // tier = state for this tier: { first, low, lowDate, alerted }
  const drop = (CFG.dropPct || 20) / 100, re = (CFG.realertPct || 15) / 100;
  if (!tier.first) { Object.assign(tier, { first: price, low: price, lowDate: now, alerted: null }); return null; }
  let why = null;
  if (target && price <= target) why = `at or under your $${target} target`;
  else if (price <= tier.low * (1 - drop)) why = `${Math.round((1 - price / tier.low) * 100)}% below the $${Math.round(tier.low)} low`;
  if (why && tier.alerted && price > tier.alerted * (1 - re)) why = null;          // already told him about this price
  if (price < tier.low) { tier.low = price; tier.lowDate = now; }
  if (why) tier.alerted = price;
  return why;
}
async function launch() {
  const args = ['--disable-blink-features=AutomationControlled'];
  try { return await chromium.launch({ channel: 'chrome', args }); }               // GitHub runners ship Google Chrome
  catch (e) { dbg('system Chrome not available (' + e.message.split('\n')[0] + '), using Playwright Chromium'); return chromium.launch({ args }); }
}

(async () => {
  const today = localDate(), until = addDays(today, CFG.daysAhead || 14), nowIso = new Date().toISOString();
  const seen = readJson(SEEN_FILE, {});
  let cache = readJson(GAMES_FILE, { updated: null, games: [] });
  const stale = FORCE_DISCOVER || !cache.updated || Date.now() - Date.parse(cache.updated) > 24 * 3600e3;
  const browser = await launch();
  const errors = [];
  try {
    if (stale) {
      console.log('Refreshing home-game schedule…');
      const games = [];
      for (const team of CFG.teams) games.push(...await discoverTeam(browser, team));
      if (games.length) cache = { updated: nowIso, games }; else errors.push('schedule discovery found no games');
    }
    // manual games from wants.json (targets, or games discovery missed)
    for (const g of CFG.games || []) {
      const hit = cache.games.find(x => x.team === g.team && x.date === g.date);
      if (hit) Object.assign(hit, { target: g.target || hit.target, opponent: g.opponent || hit.opponent });
      else cache.games.push(Object.assign({ venue: (CFG.teams.find(t => t.name === g.team) || {}).venue }, g));
    }
    const upcoming = cache.games.filter(g => g.date >= today && g.date <= until).sort((a, b) => a.date.localeCompare(b.date));
    console.log(`${cache.games.filter(g => g.date >= today).length} home game(s) known, ${upcoming.length} within ${CFG.daysAhead || 14} days.`);
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const alerts = [];
    for (const g of upcoming) {
      const team = CFG.teams.find(t => t.name === g.team) || {};
      const key = `${g.date} ${g.team} vs ${g.opponent}`;
      const results = [];
      for (const site of ['tickpick', 'seatgeek']) { const r = await readSite(ctx, site, g, team); if (r) results.push(r); }
      const okRes = results.filter(r => !r.error);
      results.filter(r => r.error).forEach(r => errors.push(`${key} ${r.site}: ${r.error}`));
      const best = tier => okRes.filter(r => r[tier]).map(r => ({ ...r[tier], site: r.site, url: r.url })).sort((a, b) => a.price - b.price)[0] || null;
      const all = best('all'), lower = best('lower');
      console.log(`  ${key}: all ${all ? money(all.price) + ' ' + all.site + ' sec ' + all.section : 'n/a'} | lower ${lower ? money(lower.price) + ' ' + lower.site + ' sec ' + lower.section : 'n/a'}` + (okRes.length ? '' : '  (no data)'));
      const st = seen[key] || (seen[key] = { all: {}, lower: {} });
      st.last = { at: nowIso, all, lower };
      for (const [tier, val] of [['all', all], ['lower', lower]]) {
        if (!val) continue;
        const why = judge(st[tier], val.price, g.target && g.target[tier], today);
        if (why) alerts.push({ g, tier, val, why, other: tier === 'all' ? lower : all });
      }
    }
    await ctx.close();
    if (alerts.length) {
      const lines = ['🚨 *TICKET DROP*'];
      for (const a of alerts) {
        const when = `${niceDate(a.g.date)}${a.g.time ? ' ' + a.g.time : ''}`;
        lines.push(`*${a.g.team} vs ${a.g.opponent} ${when} – ${money(a.val.price)}/ticket for ${QTY} (${money(a.val.price * QTY)}) ${a.tier === 'lower' ? 'lower bowl' : 'anywhere'} – sec ${a.val.section}${a.val.row ? ' row ' + a.val.row : ''} on ${a.val.site === 'tickpick' ? 'TickPick (all-in)' : 'SeatGeek'}*`);
        lines.push(a.val.url);
        lines.push(`${a.why}${a.other ? `; ${a.tier === 'lower' ? 'anywhere' : 'lower bowl'} ${money(a.other.price)} (${a.other.site} sec ${a.other.section})` : ''}`);
      }
      lines.push('Prices move – confirm before buying.');
      const text = lines.join('\n');
      console.log('\n' + text);
      if (!DRY) await notify(text);
    } else console.log('No drops.');
    if (errors.length) console.log('errors: ' + errors.join('; '));
    if (!DRY) {
      // tell him once a day if nothing could be read at all
      const allFailed = upcoming.length && !Object.values(seen).some(s => s.last && s.last.at === nowIso && (s.last.all || s.last.lower));
      if (allFailed && (!seen._failNotified || Date.now() - Date.parse(seen._failNotified) > 24 * 3600e3)) {
        seen._failNotified = nowIso;
        await notify('⚠️ Game price watcher could not read any ticket listings: ' + errors.slice(0, 4).join('; '));
      }
      writeJson(SEEN_FILE, seen); writeJson(GAMES_FILE, cache);
    }
    console.log(`\nDone: ${upcoming.length} game(s) checked, ${alerts.length} alert(s); errors: ${errors.length ? errors.length : 'none'}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
