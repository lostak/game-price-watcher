// Price-history charts for the game-price-watcher: one PNG per game – the cheapest price anywhere (blue) and in the
// lower bowl (orange) since watching started, with a title, axis labels and mm/dd date ticks. Drawn as SVG and
// screenshotted in the runner's Chrome (scrollbars hidden), then shown inside the game's Discord embed.
// Colors: the dataviz reference palette, dark mode, validated on the #1a1a19 surface.
'use strict';
const C = { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#55544f', all: '#3987e5', lower: '#d95926' };
const W = 800, H = 420, M = { l: 92, r: 28, t: 74, b: 70 };
const TZ = 'America/Denver';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Math.round(n);
const local = (t, o) => new Date(t * 1000).toLocaleString('en-US', { timeZone: TZ, ...o });
const mmdd = t => local(t, { month: '2-digit', day: '2-digit' });

function niceTicks(lo, hi, n = 4) {
  const span = Math.max(hi - lo, 1), raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw) || 10 * mag;
  const out = []; for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
// local midnight (Denver) at or before t
function dayStart(t) { const p = local(t, { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).split(':').map(Number); return t - ((p[0] % 24) * 3600 + p[1] * 60 + p[2]); }

/** points: [[unixSec, anywhere|null, lower|null], ...]; title: string; target: { all, lower } */
function svgChart(points, title, target = {}, now = Math.floor(Date.now() / 1000)) {
  const pts = (points || []).filter(p => p[1] != null || p[2] != null);
  const first = pts.length ? pts[0][0] : now;
  const t0 = Math.min(first, now - 12 * 3600), t1 = now;
  const vals = pts.flatMap(p => [p[1], p[2]]).filter(v => v != null).concat([target.all, target.lower].filter(Boolean));
  const yt = vals.length ? niceTicks(Math.max(0, Math.min(...vals) * 0.9), Math.max(...vals) * 1.05) : [0, 50, 100];
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const X = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r), Y = v => H - M.b - (v - y0) / (y1 - y0 || 1) * (H - M.t - M.b);
  // x ticks: one per day at local midnight (thinned to at most 7); a single centered date if the window has no midnight
  let days = []; for (let d = dayStart(t0) + 86400; d <= t1; d += 86400) days.push(d);
  if (days.length > 7) { const k = Math.ceil(days.length / 7); days = days.filter((_, i) => i % k === 0); }
  const xt = days.length ? days.map(t => [X(t), mmdd(t)]) : [[(X(t0) + X(t1)) / 2, mmdd(t1)]];
  const series = [[1, 'all', 'Anywhere'], [2, 'lower', 'Lower bowl']].map(([i, k, label]) => {
    const s = pts.filter(p => p[i] != null); if (!s.length) return null;
    let d = `M${X(s[0][0]).toFixed(1)},${Y(s[0][i]).toFixed(1)}`;
    for (let j = 1; j < s.length; j++) d += `H${X(s[j][0]).toFixed(1)}V${Y(s[j][i]).toFixed(1)}`;   // step: a price holds until it changes
    d += `H${X(now).toFixed(1)}`;
    return { k, label, d, last: s[s.length - 1][i] };
  }).filter(Boolean);
  const legend = series.length > 1 ? series.map((s, i) => `<line x1="${W - M.r - 250 + i * 128}" x2="${W - M.r - 228 + i * 128}" y1="${M.t - 22}" y2="${M.t - 22}" stroke="${C[s.k]}" stroke-width="3" stroke-linecap="round"/>
      <text x="${W - M.r - 222 + i * 128}" y="${M.t - 17}" fill="${C.ink2}" font-size="14">${s.label}</text>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="${C.surface}"/>
  <text x="24" y="38" fill="${C.ink}" font-size="22" font-weight="700">${esc(title)}</text>
  ${legend}
  ${yt.map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/><text x="${M.l - 10}" y="${Y(v) + 5}" fill="${C.muted}" font-size="14" text-anchor="end">${money(v)}</text>`).join('')}
  <line x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${H - M.b}" stroke="${C.axis}"/>
  <line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="${C.axis}"/>
  ${xt.map(([x, l]) => `<line x1="${x}" x2="${x}" y1="${H - M.b}" y2="${H - M.b + 6}" stroke="${C.axis}"/><text x="${x}" y="${H - M.b + 24}" fill="${C.muted}" font-size="14" text-anchor="middle">${l}</text>`).join('')}
  <text x="${(M.l + W - M.r) / 2}" y="${H - 14}" fill="${C.ink2}" font-size="15" text-anchor="middle">Date</text>
  <text transform="translate(26 ${(M.t + H - M.b) / 2}) rotate(-90)" fill="${C.ink2}" font-size="15" text-anchor="middle">Price per ticket</text>
  ${[['all', target.all], ['lower', target.lower]].filter(([, v]) => v).map(([k, v]) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C[k]}" stroke-width="1.5" stroke-dasharray="6 6" opacity=".55"/>`).join('')}
  ${series.map(s => `<path d="${s.d}" fill="none" stroke="${C[s.k]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(now)}" cy="${Y(s.last)}" r="5.5" fill="${C[s.k]}" stroke="${C.surface}" stroke-width="2"/>`).join('')}
</svg>`;
}

/** Renders one PNG per item in the given Playwright browser. items: [{ points, title, target, name }] → [{ name, png }] */
async function renderCharts(browser, items) {
  if (!items.length) return [];
  const ctx = await browser.newContext({ viewport: { width: W + 40, height: H + 40 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(), out = [];
  try {
    for (const it of items) {
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:${C.surface}}::-webkit-scrollbar{display:none}</style></head>
        <body>${svgChart(it.points, it.title || '', it.target || {})}</body></html>`);
      out.push({ name: it.name, png: await page.locator('svg').screenshot() });
    }
  } finally { await ctx.close(); }
  return out;
}
module.exports = { svgChart, renderCharts };
