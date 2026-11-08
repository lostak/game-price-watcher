// My Life – Discord slash-command helper (Cloudflare Worker, free plan).
// Discord needs an answer to a /command within 3 seconds; the GitHub bots only look every 5 minutes. This worker
// answers right away with "⏳ `<command>` …", and the bot in that channel picks that reply up as the command on its
// next check. It also fills in team and course names as you type. No secrets live here (the key below is public).
// Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → Deploy → Edit code → paste this file → Deploy.
const PUBLIC_KEY = '63f7c99b3410327319285e8d70f3ca9edf0687082d90de9a38fecedb2035fd8b';
const CHANNELS = { tickets: '1568311820983214130', golf: '1568311753908031539' };
const COURSES_URL = 'https://raw.githubusercontent.com/lostak/golf-watcher/main/golf-watcher/state/courses.json';
const TEAMS = ["Anaheim Ducks", "Arizona Cardinals", "Atlanta Falcons", "Atlanta Hawks", "Baltimore Ravens", "Boston Bruins", "Boston Celtics", "Brooklyn Nets", "Buffalo Bills", "Buffalo Sabres", "Calgary Flames", "Carolina Hurricanes", "Carolina Panthers", "Charlotte Hornets", "Chicago Bears", "Chicago Blackhawks", "Chicago Bulls", "Cincinnati Bengals", "Cleveland Browns", "Cleveland Cavaliers", "Colorado Avalanche", "Columbus Blue Jackets", "Dallas Cowboys", "Dallas Mavericks", "Dallas Stars", "Denver Broncos", "Denver Nuggets", "Detroit Lions", "Detroit Pistons", "Detroit Red Wings", "Edmonton Oilers", "Florida Panthers", "Golden State Warriors", "Green Bay Packers", "Houston Rockets", "Houston Texans", "Indiana Pacers", "Indianapolis Colts", "Jacksonville Jaguars", "Kansas City Chiefs", "LA Clippers", "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Kings", "Los Angeles Lakers", "Los Angeles Rams", "Memphis Grizzlies", "Miami Dolphins", "Miami Heat", "Milwaukee Bucks", "Minnesota Timberwolves", "Minnesota Vikings", "Minnesota Wild", "Montreal Canadiens", "Nashville Predators", "New England Patriots", "New Jersey Devils", "New Orleans Pelicans", "New Orleans Saints", "New York Giants", "New York Islanders", "New York Jets", "New York Knicks", "New York Rangers", "Oklahoma City Thunder", "Orlando Magic", "Ottawa Senators", "Philadelphia 76ers", "Philadelphia Eagles", "Philadelphia Flyers", "Phoenix Suns", "Pittsburgh Penguins", "Pittsburgh Steelers", "Portland Trail Blazers", "Sacramento Kings", "San Antonio Spurs", "San Francisco 49ers", "San Jose Sharks", "Seattle Kraken", "Seattle Seahawks", "St. Louis Blues", "Tampa Bay Buccaneers", "Tampa Bay Lightning", "Tennessee Titans", "Toronto Maple Leafs", "Toronto Raptors", "Utah Jazz", "Utah Mammoth", "Vancouver Canucks", "Vegas Golden Knights", "Washington Capitals", "Washington Commanders", "Washington Wizards", "Winnipeg Jets"];

const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
const hex = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
async function verify(sig, msg) {
  for (const alg of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const key = await crypto.subtle.importKey('raw', hex(PUBLIC_KEY), alg, false, ['verify']);
      return await crypto.subtle.verify(alg.name, key, hex(sig), new TextEncoder().encode(msg));
    } catch (e) { /* try the older name */ }
  }
  return false;
}
let courseCache = null, courseAt = 0;
async function courses() {
  if (courseCache && Date.now() - courseAt < 3600e3) return courseCache;
  try { const r = await fetch(COURSES_URL); courseCache = (await r.json()).map(String); courseAt = Date.now(); } catch (e) { courseCache = courseCache || []; }
  return courseCache;
}
const clean = (s) => String(s ?? '').replace(/[`\n]/g, ' ').trim();
const pick = (list, q) => { q = q.toLowerCase(); return list.filter((x) => x.toLowerCase().includes(q)).slice(0, 25).map((x) => ({ name: x.slice(0, 100), value: x.slice(0, 100) })); };
const HELP = [
  '**In #game-prices** – `/tickets watch` (team, opponent, date, price alerts) · `/tickets list` · `/tickets graph` · `/tickets stop` · `/tickets report`',
  '**In #golf** – `/golf watch` (day, times, players, course) · `/golf list` · `/golf report` · `/golf stop` · `/golf remove_course`',
  'Typing the words still works too, e.g. `watch Lakers vs Celtics 12/25 under 150`. The bot answers within 5 minutes.',
].join('\n');

function toText(name, sub, o) {
  if (name === 'tickets') switch (sub) {
    case 'watch': return `watch ${clean(o.team)}${o.opponent ? ' vs ' + clean(o.opponent) : ''}${o.date ? ' ' + clean(o.date) : ''}${o.under ? ' under ' + o.under : ''}${o.lower_under ? ' lower under ' + o.lower_under : ''}`;
    case 'stop': return `stop ${clean(o.game)}`;
    case 'list': return 'watch list';
    case 'graph': return `price graph ${clean(o.game) || 'all'}`;
    case 'report': return 'report';
  }
  if (name === 'golf') switch (sub) {
    case 'watch': return `watch ${clean(o.day)}${o.times ? ' ' + clean(o.times) : ''}${o.players ? ' for ' + o.players : ''}${o.course ? ' at ' + clean(o.course) : ''}`;
    case 'stop': return `stop ${clean(o.day)}`;
    case 'list': return 'list';
    case 'report': return 'report';
    case 'remove_course': return `remove course ${clean(o.course)}`;
  }
  return null;
}

export default {
  async fetch(req) {
    if (req.method !== 'POST') return new Response('My Life Discord helper is running.');
    const sig = req.headers.get('x-signature-ed25519'), ts = req.headers.get('x-signature-timestamp'), body = await req.text();
    if (!sig || !ts || !(await verify(sig, ts + body))) return new Response('invalid request signature', { status: 401 });
    const i = JSON.parse(body);
    if (i.type === 1) return json({ type: 1 });                                     // Discord checking the URL
    const name = i.data && i.data.name, sub = i.data && i.data.options && i.data.options[0];
    const opts = (sub && sub.options) || [];
    if (i.type === 4) {                                                             // autocomplete
      const f = opts.find((x) => x.focused); if (!f) return json({ type: 8, data: { choices: [] } });
      const list = f.name === 'course' ? await courses() : TEAMS;
      return json({ type: 8, data: { choices: pick(list, String(f.value || '')) } });
    }
    if (i.type !== 2) return json({ type: 4, data: { content: 'Not sure what that was.', flags: 64 } });
    if (name === 'help') return json({ type: 4, data: { content: HELP, flags: 64 } });
    const where = CHANNELS[name];
    if (where && i.channel_id !== where) return json({ type: 4, data: { content: `Use \`/${name}\` in <#${where}> – that's where its bot listens.`, flags: 64 } });
    const o = Object.fromEntries(opts.map((x) => [x.name, x.value]));
    const text = toText(name, sub && sub.name, o);
    if (!text) return json({ type: 4, data: { content: 'Unknown command – try `/help`.', flags: 64 } });
    return json({ type: 4, data: { content: `⏳ \`${text}\` – got it, the bot answers here within 5 minutes.` } });
  },
};
