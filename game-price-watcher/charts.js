// Price-history sparklines for the game-price-watcher: one small PNG per game – just the price lines since watching
// started (blue = cheapest anywhere, orange = cheapest lower bowl), drawn as SVG and screenshotted in the runner's
// Chrome, then shown inside a Discord embed whose text carries the numbers. No titles, axes or labels on purpose.
// Colors: the dataviz reference palette, dark mode, validated on the #1a1a19 surface.
'use strict';
const C = { surface: '#1a1a19', base: '#383835', all: '#3987e5', lower: '#d95926' };
const W = 600, H = 170, P = { l: 14, r: 20, t: 18, b: 18 };

/** points: [[unixSec, anywhere|null, lower|null], ...]; target: { all, lower } (drawn as faint dashes) */
function svgChart(points, target = {}, now = Math.floor(Date.now() / 1000)) {
  const pts = (points || []).filter(p => p[1] != null || p[2] != null);
  const t0 = Math.min(pts.length ? pts[0][0] : now, now - 6 * 3600), t1 = now;
  const vals = pts.flatMap(p => [p[1], p[2]]).filter(v => v != null).concat([target.all, target.lower].filter(Boolean));
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max((hi - lo) * 0.12, hi * 0.05, 1); lo -= pad; hi += pad;
  const X = t => P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r), Y = v => H - P.b - (v - lo) / (hi - lo) * (H - P.t - P.b);
  const line = (i, k) => {
    const s = pts.filter(p => p[i] != null); if (!s.length) return '';
    let d = `M${X(s[0][0]).toFixed(1)},${Y(s[0][i]).toFixed(1)}`;
    for (let j = 1; j < s.length; j++) d += `H${X(s[j][0]).toFixed(1)}V${Y(s[j][i]).toFixed(1)}`;   // step: a price holds until it changes
    d += `H${X(now).toFixed(1)}`;
    return `<path d="${d}" fill="none" stroke="${C[k]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(now)}" cy="${Y(s[s.length - 1][i])}" r="5.5" fill="${C[k]}" stroke="${C.surface}" stroke-width="2"/>`;
  };
  const tgt = (v, k) => v ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C[k]}" stroke-width="1.5" stroke-dasharray="5 6" opacity=".45"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.surface}"/>
  <line x1="${P.l}" x2="${W - P.r}" y1="${H - P.b + 8}" y2="${H - P.b + 8}" stroke="${C.base}" stroke-width="1"/>
  ${tgt(target.all, 'all')}${tgt(target.lower, 'lower')}${line(2, 'lower')}${line(1, 'all')}
</svg>`;
}

/** Renders one PNG per item in the given Playwright browser. items: [{ points, target, name }] → [{ name, png }] */
async function renderCharts(browser, items) {
  if (!items.length) return [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(), out = [];
  try {
    for (const it of items) {
      await page.setContent(`<!doctype html><html><body style="margin:0;background:${C.surface}">${svgChart(it.points, it.target || {})}</body></html>`);
      out.push({ name: it.name, png: await page.locator('svg').screenshot() });
    }
  } finally { await ctx.close(); }
  return out;
}
module.exports = { svgChart, renderCharts };
