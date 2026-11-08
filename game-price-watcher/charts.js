// Price-history charts for the game-price-watcher: one PNG per watched game (anywhere vs lower bowl since watching
// started, with any targets), drawn as SVG and screenshotted in the runner's Chrome, then attached to Discord posts.
// Colors: the dataviz reference palette, dark mode (blue = anywhere, orange = lower bowl), validated on #1a1a19.
'use strict';
const C = { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', all: '#3987e5', lower: '#d95926' };
const W = 800, H = 420, M = { l: 64, r: 120, t: 92, b: 64 };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Math.round(n);
const TZ = 'America/Denver';
const fmt = (t, o) => new Date(t * 1000).toLocaleString('en-US', { timeZone: TZ, ...o });

function niceTicks(lo, hi, n = 4) {
  const span = Math.max(hi - lo, 1), raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw) || 10 * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** points: [[unixSec, all|null, lower|null], ...]; game: { team, opponent, date, time, venue, target } */
function svgChart(game, points, now = Math.floor(Date.now() / 1000)) {
  const pts = (points || []).filter(p => p[1] != null || p[2] != null);
  const t0 = Math.min(pts.length ? pts[0][0] : now, now - 6 * 3600), t1 = now;   // at least a 6-hour window so a new watch still reads as a chart
  const vals = pts.flatMap(p => [p[1], p[2]]).filter(v => v != null);
  const tg = game.target || {};
  if (tg.all) vals.push(tg.all); if (tg.lower) vals.push(tg.lower);
  const yt = niceTicks(Math.min(...vals, Infinity) === Infinity ? 0 : Math.max(0, Math.min(...vals) * 0.9), vals.length ? Math.max(...vals) * 1.05 : 100);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const X = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r), Y = v => H - M.b - (v - y0) / (y1 - y0 || 1) * (H - M.t - M.b);
  const series = [['all', 1, 'Anywhere'], ['lower', 2, 'Lower bowl']].map(([k, i, label]) => {
    const s = pts.filter(p => p[i] != null).map(p => [p[0], p[i]]);
    if (!s.length) return { k, label, s, d: '' };
    let d = `M${X(s[0][0]).toFixed(1)},${Y(s[0][1]).toFixed(1)}`;
    for (let j = 1; j < s.length; j++) d += `H${X(s[j][0]).toFixed(1)}V${Y(s[j][1]).toFixed(1)}`;   // step line: a price holds until it changes
    d += `H${X(now).toFixed(1)}`;
    return { k, label, s, d, last: s[s.length - 1][1], low: s.reduce((a, b) => (b[1] < a[1] ? b : a)) };
  });
  // x ticks: hours on the first day, dates after that
  const span = t1 - t0, xs = [];
  const stepX = span <= 36 * 3600 ? 6 * 3600 : span <= 8 * 86400 ? 86400 : Math.ceil(span / 86400 / 6) * 86400;
  const startLocal = new Date(fmt(t0, { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' 00:00').getTime() / 1000;
  for (let t = startLocal; t <= t1; t += stepX) if (t >= t0) xs.push(t);
  const xl = t => span <= 36 * 3600 ? fmt(t, { hour: 'numeric' }) : fmt(t, { month: 'short', day: 'numeric' });
  const when = new Date(game.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  // end labels, nudged apart so they never collide
  const ends = series.filter(s => s.s.length).map(s => ({ ...s, y: Y(s.last) }));
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 34) { const mid = (ends[0].y + ends[1].y) / 2, up = ends[0].y <= ends[1].y ? 0 : 1; ends[up].y = mid - 17; ends[1 - up].y = mid + 17; }
  const lows = series.filter(s => s.low).map(s => `${s.label.toLowerCase()} ${money(s.low[1])} (${fmt(s.low[0], { month: 'short', day: 'numeric' })})`);
  const since = pts.length ? fmt(pts[0][0], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'now';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif">
  <rect width="${W}" height="${H}" rx="14" fill="${C.surface}"/>
  <text x="${M.l - 40}" y="38" fill="${C.ink}" font-size="22" font-weight="700">${esc(game.team)} vs ${esc(game.opponent)}</text>
  <text x="${M.l - 40}" y="62" fill="${C.ink2}" font-size="14">${esc(when)}${game.time ? ' ' + esc(new Date('2000-01-01T' + game.time + ':00').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : ''}${game.venue ? ' · ' + esc(game.venue) : ''} · per ticket, 4 together, all-in</text>
  ${series.filter(s => s.d).length === 2 ? `<g font-size="13" fill="${C.ink2}">
    <line x1="${W - 250}" x2="${W - 228}" y1="33" y2="33" stroke="${C.all}" stroke-width="3" stroke-linecap="round"/><text x="${W - 222}" y="38">Anywhere</text>
    <line x1="${W - 140}" x2="${W - 118}" y1="33" y2="33" stroke="${C.lower}" stroke-width="3" stroke-linecap="round"/><text x="${W - 112}" y="38">Lower bowl</text>
  </g>` : ''}
  <g font-size="12" fill="${C.muted}">
    ${yt.map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}" stroke-width="1"/><text x="${M.l - 10}" y="${Y(v) + 4}" text-anchor="end">${money(v)}</text>`).join('')}
    <line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="${C.axis}" stroke-width="1"/>
    ${xs.map(t => `<text x="${X(t)}" y="${H - M.b + 20}" text-anchor="middle">${esc(xl(t))}</text>`).join('')}
  </g>
  ${[['all', tg.all], ['lower', tg.lower]].filter(([, v]) => v).map(([k, v]) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C[k]}" stroke-width="1.5" stroke-dasharray="6 5" opacity=".7"/>
    <text x="${M.l + 6}" y="${Y(v) - 7}" fill="${C.ink2}" font-size="12" stroke="${C.surface}" stroke-width="5" paint-order="stroke" stroke-linejoin="round">target ${money(v)}${k === 'lower' ? ' lower bowl' : ''}</text>`).join('')}
  ${series.filter(s => s.d).map(s => `<path d="${s.d}" fill="none" stroke="${C[s.k]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(now)}" cy="${Y(s.last)}" r="5" fill="${C[s.k]}" stroke="${C.surface}" stroke-width="2"/>`).join('')}
  ${ends.map(s => `<text x="${X(now) + 12}" y="${s.y + 5}" fill="${C.ink}" font-size="16" font-weight="700">${money(s.last)}<tspan fill="${C.ink2}" font-size="12" font-weight="400"> ${s.k === 'all' ? 'anywhere' : 'lower'}</tspan></text>`).join('')}
  <text x="${M.l - 40}" y="${H - 18}" fill="${C.muted}" font-size="12">Watching since ${esc(since)}${lows.length ? ' · lowest: ' + esc(lows.join(', ')) : ''}${pts.length < 2 ? ' · history fills in with each check' : ''}</text>
</svg>`;
}

/** Renders one PNG per game in the given Playwright browser. items: [{ game, points, name }] → [{ name, png }] */
async function renderCharts(browser, items) {
  if (!items.length) return [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(), out = [];
  try {
    for (const it of items) {
      await page.setContent(`<!doctype html><html><body style="margin:0;background:${C.surface}">${svgChart(it.game, it.points)}</body></html>`);
      out.push({ name: it.name, png: await page.locator('svg').screenshot({ omitBackground: false }) });
    }
  } finally { await ctx.close(); }
  return out;
}
module.exports = { svgChart, renderCharts };
