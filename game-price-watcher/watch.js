// game-price-watcher: watches resale ticket prices (4 seats together) for Bradley's teams' home games, plus any
// NBA, NFL or NHL game he asks for (home or away, any team), and posts to Slack + Discord when a price drops. Runs on GitHub Actions every 5 minutes while there is a
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
const Teams = require('./teams');   // every NBA/NFL/NHL team: manual watches can be any game, home or away
const { findGame } = require('./gt');
const gcal = require('./gcal');   // Bradley's calendar: TEAMS from "Personal: life settings", manual games from "Personal: ticket watch", log + alert events

const DRY = process.argv.includes('--dry');
const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const FORCE_DISCOVER = process.argv.includes('--discover');
const DAILY = process.argv.includes('--daily');     // with --report: only post if today's board hasn't gone out yet
const REPORT = process.argv.includes('--report') || DAILY;   // also post the daily price report (every game, both tiers, change since last report)
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
  try { for (const g of await gtHomeGames(team)) games[g.date] = g; console.log(`  ${team.name} on gametime: ${Object.keys(games).length} home game(s)`); }
  catch (e) { console.log(`  ${team.name} on gametime: ${e.message.split('\n')[0]}`); }
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const [site, parse] of [['tickpick', parseTickPick]]) {           // SeatGeek's team pages don't render for bots; skipped
    const url = team[site]; if (!url) continue;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(4000);
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 4000); await sleep(700); }
      for (const sel of ['button:has-text("Show more")', 'button:has-text("Load more")', 'a:has-text("See all")']) { try { const b = await page.$(sel); if (b) { await b.click(); await sleep(1500); } } catch {} }   // lazy-loaded lists
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

// ---------- Gametime (mobile.gametime.co, open JSON API: schedule + listings with section/row/all-in price) ----------
const GT = 'https://mobile.gametime.co/v1';
async function gtJson(url) { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`gametime ${r.status} ${url.slice(0, 80)}`); return r.json(); }
async function gtHomeGames(team) {
  if (!team.gametime) return [];
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const j = await gtJson(`${GT}/events?performer_slug=${team.gametime}&page=${page}&per_page=50`);
    const venues = Object.fromEntries((j.venues || []).map(v => [v.id, v]));
    for (const e of j.events || []) {
      const x = e.event || e, venue = (e.venue && e.venue.name) || (venues[x.venue_id] || {}).name || '';
      const m = (x.name || '').match(/^(?:.*?:\s*|.*? - )?(.+?) at (.+)$/i);
      const full = (team.full || '').toLowerCase();
      const home = m && full ? m[2].toLowerCase().includes(full) : team.venue && venue && venue.toLowerCase().includes(team.venue.toLowerCase().split(' ')[0]);
      if (!home) continue;
      const opponent = m ? m[1].trim() : (x.name || '').replace(new RegExp(team.full || 'denver nuggets|colorado avalanche|denver broncos', 'i'), '').replace(/\b(at|vs\.?)\b/i, '').trim();
      out.push({ team: team.name, venue, opponent, date: x.datetime_local.slice(0, 10), time: x.datetime_local.slice(11, 16), gametimeId: x.id, gametime: x.seo_url, name: x.name });
    }
    if (!j.more) break;
  }
  return out;
}
async function readGametime(game, team) {
  if (!game.gametimeId) return null;
  try {
    const j = await gtJson(`${GT}/listings?event_id=${game.gametimeId}&quantity=${QTY}`);
    const ls = (j.listings || []).map(l => ({ price: (l.price && (l.price.total || l.price.prefee) || 0) / 100, section: String(l.section || ''), row: l.row, group: l.section_group, lots: l.lots || [], seats: (l.seats || []).length, raw: l }))
      .filter(l => l.price > 0 && !/parking|suite|loge|hospitality/i.test(l.section + ' ' + (l.group || '')) && !/sro|standing/i.test(String(l.row || '') + ' ' + ((l.raw.disclosures || []).join(' '))));
    if (DEBUG) dbg('gametime', game.team, game.opponent, 'listings:', (j.listings || []).length, 'sample:', JSON.stringify((j.listings || [])[0]).slice(0, 500));
    const four = ls.filter(l => l.lots.includes(QTY) || (!l.lots.length && l.seats >= QTY));
    const pool = four.length ? four : ls;                                   // if lots are absent the API already filtered by quantity
    const cheapest = arr => arr.length ? arr.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const lower = cheapest(pool.filter(l => isLower(l.section, team)));           // lower bowl = the venue's 100-level sections only
    const any = cheapest(pool);
    const url = game.gametime || `https://gametime.co/events/${game.gametimeId}`;
    return { site: 'gametime', url, count: pool.length, all: any && { price: any.price, section: any.section, row: any.row }, lower: lower && { price: lower.price, section: lower.section, row: lower.row } };
  } catch (e) { return { site: 'gametime', error: e.message.slice(0, 100) }; }
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
  let body = null, seenReq = null;
  const seen = [];
  const onResp = async r => {
    if (!re.test(r.url())) return;
    if (DEBUG) seen.push(`${r.status()} ${r.url().slice(0, 140)}`);
    if (body) return;
    try { const txt = await r.text(); const j = JSON.parse(txt); if (extractListings(j).length) body = j; else dbg(label, 'JSON without listings:', txt.slice(0, 300)); } catch (e) { dbg(label, 'response not JSON:', e.message.slice(0, 80)); }
  };
  const onReq = r => { if (re.test(r.url())) seenReq = r; };
  page.on('response', onResp); page.on('request', onReq);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < 40 && !body; i++) await sleep(500);                       // up to 20 s for the listings call
    if (!body) {                                                                   // fall back: ask for the listings from inside the page
      const apiUrl = seenReq ? seenReq.url() : (label === 'tickpick' && url.match(/\/(\d+)\/?(?:\?|$)/) ? `https://api.tickpick.com/1.0/listings/internal/event-v2/${url.match(/\/(\d+)\/?(?:\?|$)/)[1]}?trackView=false` : null);
      if (apiUrl) {
        const res = await page.evaluate(async u => { try { const r = await fetch(u, { credentials: 'include' }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } }, apiUrl);
        dbg(label, 'in-page fetch', apiUrl.slice(0, 120), '→', res.status, (res.text || '').slice(0, 300));
        try { const j = JSON.parse(res.text); if (extractListings(j).length) body = j; } catch {}
      }
    }
  } finally { page.off('response', onResp); page.off('request', onReq); }
  if (DEBUG && !body) {
    dbg(label, 'no listings captured; API responses seen:', seen.slice(0, 10));
    try {
      const html = await page.content();
      const hits = [...html.matchAll(/.{0,80}(lowestPrice|minPrice|"price"|__NEXT_DATA__|__INITIAL_STATE__|listings)[^]{0,120}/g)].slice(0, 6).map(m => m[0].replace(/\s+/g, ' '));
      dbg(label, 'page title:', await page.title(), '| embedded hints:', hits);
      await sleep(4000);
      const panel = await page.evaluate(() => { const p = document.querySelector('#panel-event-listings') || document.body; const first = p.querySelector('[data-listing-id], [data-testid*="listing"], li, article');
        return { text: p.innerText.slice(0, 1500), firstHtml: first ? first.outerHTML.slice(0, 1200) : null, counts: { li: p.querySelectorAll('li').length, article: p.querySelectorAll('article').length, buttons: p.querySelectorAll('button').length } }; });
      dbg(label, 'listings panel:', JSON.stringify(panel).slice(0, 3000));
    } catch {}
  }
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
  const headless = process.env.HEADFUL !== '1';                                    // the workflow runs under xvfb so a real (headed) Chrome can be used
  try { return await chromium.launch({ channel: 'chrome', args, headless }); }     // GitHub runners ship Google Chrome
  catch (e) { dbg('system Chrome not available (' + e.message.split('\n')[0] + '), using Playwright Chromium'); return chromium.launch({ args, headless }); }
}

(async () => {
  const today = localDate(), until = addDays(today, CFG.daysAhead || 14), nowIso = new Date().toISOString();
  const seen = readJson(SEEN_FILE, {});
  let cache = readJson(GAMES_FILE, { updated: null, games: [] });
  const stale = FORCE_DISCOVER || !cache.updated || Date.now() - Date.parse(cache.updated) > 24 * 3600e3;
  const browser = await launch();
  const errors = [];
  // Calendar: which teams (TEAMS line of "Personal: life settings") and any games/targets asked for ("Personal: ticket watch", WATCH: lines)
  let watchEv = null;
  if (gcal.ready) {
    try {
      const settings = await gcal.findByTitle('Personal: life settings', 'life settings', { back: 730 });
      const teamsLine = settings && ((settings.description || '').match(/^\s*TEAMS:\s*(.+)$/m) || [])[1];
      if (teamsLine) {
        const names = teamsLine.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        // any NBA/NFL/NHL team on the TEAMS line gets its home games auto-watched; the Denver teams keep their extra config from wants.json
        const picked = [], unknown = [];
        for (const n of names) {
          const local = CFG.teams.find(t => (t.aliases || [t.name.toLowerCase()]).some(a => n.includes(a)));
          const hit = Teams.parse(n)[0], any = hit && hit.teams.length === 1 ? hit.teams[0] : null;
          const t = local ? { ...(any || {}), ...local, gametime: local.gametime || (any && any.slug) } : any ? { name: any.name, full: any.full, league: any.league, gametime: any.slug, aliases: any.aliases } : null;
          if (t && !picked.some(p => p.name === t.name)) picked.push(t); else if (!t) unknown.push(n);
        }
        if (picked.length) { CFG.teams = picked; console.log(`Teams from calendar settings: ${picked.map(t => t.name).join(', ')}${unknown.length ? ' (no config yet for: ' + unknown.join(', ') + ')' : ''}`); }
      }
      watchEv = await gcal.findByTitle('Personal: ticket watch', 'ticket watch');
      const d = watchEv ? watchEv.description || '' : '';
      for (const m of d.matchAll(/^\s*WATCH:\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(?:vs\.?|@|at)\s+(.+?)\s*(?:\|(.*))?$/gim)) {
        const target = {}; const t = m[4] || '';
        const a = t.match(/all\s*\$?(\d+)/i), l = t.match(/lower\s*\$?(\d+)/i); if (a) target.all = +a[1]; if (l) target.lower = +l[1];
        CFG.games.push({ team: m[2], opponent: m[3].trim(), date: m[1], target: Object.keys(target).length ? target : undefined });
      }
    } catch (e) { console.log('Calendar read failed: ' + e.message.slice(0, 120)); }
  }
  try {
    if (stale) {
      console.log('Refreshing home-game schedule…');
      const games = [];
      for (const team of CFG.teams) games.push(...await discoverTeam(browser, team));
      if (games.length) cache = { updated: nowIso, games }; else errors.push('schedule discovery found no games');
    }
    // manual games (calendar WATCH lines / wants.json): any NBA/NFL/NHL team, home or away – found on that team's Gametime schedule
    cache.games = cache.games.filter(g => !g.manual).map(({ target, watched, ...g }) => g);   // manual watches are rebuilt every run, so a "stop" sticks
    for (const g of CFG.games || []) {
      const hit = cache.games.find(x => x.team === g.team && x.date === g.date);
      if (hit) { Object.assign(hit, { target: g.target, opponent: g.opponent && g.opponent !== 'TBD' ? g.opponent : hit.opponent, watched: true }); continue; }
      const entry = Object.assign({ venue: (CFG.teams.find(t => t.name === g.team) || {}).venue, manual: true }, g);
      const t = Teams.byName(g.team) || ((Teams.parse(g.team)[0] || {}).teams || [])[0];
      if (t) try {
        const found = await findGame(t, { date: g.date, oppText: g.opponent && g.opponent !== 'TBD' ? g.opponent : null });
        if (found) Object.assign(entry, { time: found.time, venue: found.venue, gametimeId: found.gametimeId, gametime: found.gametime, opponent: g.opponent && g.opponent !== 'TBD' ? g.opponent : found.opponent, away: !found.home });
        else console.log(`  no Gametime listing yet for ${g.team} on ${g.date}`);
      } catch (e) { errors.push(`${g.team} schedule: ${e.message.slice(0, 80)}`); }
      cache.games.push(entry);
    }
    const upcoming = cache.games.filter(g => g.date >= today && (g.date <= until || g.manual || g.watched)).sort((a, b) => a.date.localeCompare(b.date));
    console.log(`${cache.games.filter(g => g.date >= today).length} home game(s) known, ${upcoming.length} within ${CFG.daysAhead || 14} days.`);
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const alerts = [];
    for (const g of upcoming) {
      const team = CFG.teams.find(t => t.name === g.team) || Teams.byName(g.team) || {};
      const key = `${g.date} ${g.team} vs ${g.opponent}`;
      const results = [];
      const gt = await readGametime(g, team); if (gt) results.push(gt);
      if ((!gt || gt.error || !gt.all) && team.tickpick) for (const site of ['tickpick']) { const r = await readSite(ctx, site, g, team); if (r) results.push(r); }
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
        lines.push(`*${a.g.team} vs ${a.g.opponent} ${when} – ${money(a.val.price)}/ticket for ${QTY} (${money(a.val.price * QTY)}) ${a.tier === 'lower' ? 'lower bowl' : 'anywhere'} – sec ${a.val.section}${a.val.row ? ' row ' + a.val.row : ''} on ${a.val.site === 'tickpick' ? 'TickPick (all-in)' : a.val.site === 'gametime' ? 'Gametime (all-in)' : a.val.site}*`);
        lines.push(a.val.url);
        lines.push(`${a.why}${a.other ? `; ${a.tier === 'lower' ? 'anywhere' : 'lower bowl'} ${money(a.other.price)} (${a.other.site} sec ${a.other.section})` : ''}`);
      }
      lines.push('Prices move – confirm before buying.');
      const text = lines.join('\n');
      console.log('\n' + text);
      if (!DRY) await notify(text);
      if (!DRY && gcal.ready) for (const a of alerts) {
        try { await gcal.insert({ summary: `Personal: ticket drop – ${a.g.team} vs ${a.g.opponent} ${niceDate(a.g.date)} – ${money(a.val.price)}/ticket for ${QTY}${a.tier === 'lower' ? ' (lower bowl)' : ''}`, when: gcal.nextQuarter(),
          description: `${money(a.val.price)}/ticket, ${money(a.val.price * QTY)} for ${QTY} (all-in) – ${a.tier === 'lower' ? 'lower bowl' : 'anywhere'} sec ${a.val.section}${a.val.row ? ' row ' + a.val.row : ''} on ${a.val.site}\n${a.why}\n${a.other ? (a.tier === 'lower' ? 'Anywhere' : 'Lower bowl') + ': ' + money(a.other.price) + ' (sec ' + a.other.section + ')\n' : ''}${a.val.url}\nPrices move – confirm before buying.` }); }
        catch (e) { console.log('Calendar alert event failed: ' + e.message.slice(0, 120)); }
      }
    } else console.log('No drops.');
    if (!DRY && gcal.ready && upcoming.length) {                   // the log event the morning brief / Sunday reset read
      try {
        const logEv = await gcal.ensureSilent('Price watch: Broncos & Avs tickets (log)', ['Ticket prices for 4 together, kept current by the game-price-watcher (GitHub Actions). All-in prices from TickPick.'], 'TICKET-WATCH-LOG');
        const rows = upcoming.map(g => { const k = `${g.date} ${g.team} vs ${g.opponent}`, st = seen[k] || { all: {}, lower: {} }, l = st.last || {};
          const tier = (t, v) => v ? `today ${money(v.price)} confirmed${t === 'lower' ? ' sec ' + v.section : ''} low ${money(st[t].low || v.price)} on ${st[t].lowDate || today} alerted ${st[t].alerted ? money(st[t].alerted) : 'none'}` : 'n/a';
          return `${g.date} ${g.team} vs ${g.opponent} | ALL ${tier('all', l.all)} | LOWER ${tier('lower', l.lower)}`; });
        const keep = (logEv.description || '').split('\n').filter(l => /^(Ticket prices|Notes:)/.test(l));
        await gcal.patch(logEv.id, { description: [...keep, ...rows, 'TICKET-WATCH-LOG'].join('\n') });
      } catch (e) { console.log('Calendar log failed: ' + e.message.slice(0, 120)); }
    }
    const REPORT_FILE = path.join(STATE_DIR, 'report.json');
    const alreadyToday = DAILY && readJson(REPORT_FILE, {})._date === today;
    if (alreadyToday) console.log("Daily board already posted today.");
    if (REPORT && upcoming.length && !alreadyToday) {
      const prev = readJson(REPORT_FILE, {});
      const arrow = (now, old) => !now ? '' : !old ? '' : now < old * 0.97 ? ' ↓' : now > old * 1.03 ? ' ↑' : ' =';
      const lines = [`🎟 *Ticket prices – ${niceDate(today)}* (${QTY} together, all-in prices)`];
      const cur = {};
      let bestAll = null, bestLower = null;
      for (const g of upcoming) {
        const key = `${g.date} ${g.team} vs ${g.opponent}`, st = seen[key] || {}, l = st.last || {};
        const p = prev[key] || {};
        cur[key] = { all: l.all && l.all.price, lower: l.lower && l.lower.price };
        lines.push(`${niceDate(g.date)} ${g.team} vs ${g.opponent} – ${l.all ? money(l.all.price) + ' anywhere (sec ' + l.all.section + ')' + arrow(l.all.price, p.all) : 'n/a'} · ${l.lower ? money(l.lower.price) + ' lower bowl (sec ' + l.lower.section + ')' + arrow(l.lower.price, p.lower) : 'lower bowl n/a'}${g.target ? ' · target ' + [g.target.all && money(g.target.all), g.target.lower && money(g.target.lower) + ' lower'].filter(Boolean).join(' / ') : ''}`);
        if (l.all && (!bestAll || l.all.price < bestAll.price)) bestAll = { ...l.all, g };
        if (l.lower && (!bestLower || l.lower.price < bestLower.price)) bestLower = { ...l.lower, g };
      }
      if (bestAll) lines.push(`BEST VALUE: ${bestAll.g.team} vs ${bestAll.g.opponent} ${niceDate(bestAll.g.date)} ${money(bestAll.price)}` + (bestLower ? ` · lower bowl: ${bestLower.g.team} vs ${bestLower.g.opponent} ${niceDate(bestLower.g.date)} ${money(bestLower.price)}` : ''));
      lines.push('Set a target here: "watch Nuggets vs Suns Nov 20 under 80 lower under 150". Alerts fire on 20%+ drops anyway.');
      const text = lines.join('\n');
      console.log('\n' + text);
      if (!DRY) { await notify(text); writeJson(REPORT_FILE, { ...cur, _date: today }); }
    }
    if (errors.length) console.log('errors: ' + errors.join('; '));
    if (!DRY) {
      // tell him once a day if nothing could be read at all
      const allFailed = upcoming.length && !Object.values(seen).some(s => s.last && s.last.at === nowIso && (s.last.all || s.last.lower));
      if (allFailed && (!seen._failNotified || Date.now() - Date.parse(seen._failNotified) > 24 * 3600e3)) {
        seen._failNotified = nowIso;
        await notify('⚠️ Game price watcher could not read any ticket listings: ' + errors.slice(0, 4).join('; '));
      }
      writeJson(SEEN_FILE, seen); writeJson(GAMES_FILE, { ...cache, games: cache.games.filter(g => !g.manual).map(({ target, watched, ...g }) => g) });
    }
    console.log(`\nDone: ${upcoming.length} game(s) checked, ${alerts.length} alert(s); errors: ${errors.length ? errors.length : 'none'}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
