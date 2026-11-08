// temporary: find Gametime performer slugs for every NBA/NFL/NHL team
const T = { nba: 'ATL Atlanta Hawks|BOS Boston Celtics|BKN Brooklyn Nets|CHA Charlotte Hornets|CHI Chicago Bulls|CLE Cleveland Cavaliers|DAL Dallas Mavericks|DEN Denver Nuggets|DET Detroit Pistons|GSW Golden State Warriors|HOU Houston Rockets|IND Indiana Pacers|LAC Los Angeles Clippers|LAL Los Angeles Lakers|MEM Memphis Grizzlies|MIA Miami Heat|MIL Milwaukee Bucks|MIN Minnesota Timberwolves|NOP New Orleans Pelicans|NYK New York Knicks|OKC Oklahoma City Thunder|ORL Orlando Magic|PHI Philadelphia 76ers|PHX Phoenix Suns|POR Portland Trail Blazers|SAC Sacramento Kings|SAS San Antonio Spurs|TOR Toronto Raptors|UTA Utah Jazz|WAS Washington Wizards',
  nhl: 'ANA Anaheim Ducks|BOS Boston Bruins|BUF Buffalo Sabres|CGY Calgary Flames|CAR Carolina Hurricanes|CHI Chicago Blackhawks|COL Colorado Avalanche|CBJ Columbus Blue Jackets|DAL Dallas Stars|DET Detroit Red Wings|EDM Edmonton Oilers|FLA Florida Panthers|LAK Los Angeles Kings|MIN Minnesota Wild|MTL Montreal Canadiens|NSH Nashville Predators|NJD New Jersey Devils|NYI New York Islanders|NYR New York Rangers|OTT Ottawa Senators|PHI Philadelphia Flyers|PIT Pittsburgh Penguins|SJS San Jose Sharks|SEA Seattle Kraken|STL St. Louis Blues|TBL Tampa Bay Lightning|TOR Toronto Maple Leafs|UTA Utah Mammoth|VAN Vancouver Canucks|VGK Vegas Golden Knights|WSH Washington Capitals|WPG Winnipeg Jets',
  nfl: 'ARI Arizona Cardinals|ATL Atlanta Falcons|BAL Baltimore Ravens|BUF Buffalo Bills|CAR Carolina Panthers|CHI Chicago Bears|CIN Cincinnati Bengals|CLE Cleveland Browns|DAL Dallas Cowboys|DEN Denver Broncos|DET Detroit Lions|GB Green Bay Packers|HOU Houston Texans|IND Indianapolis Colts|JAX Jacksonville Jaguars|KC Kansas City Chiefs|LV Las Vegas Raiders|LAC Los Angeles Chargers|LAR Los Angeles Rams|MIA Miami Dolphins|MIN Minnesota Vikings|NE New England Patriots|NO New Orleans Saints|NYG New York Giants|NYJ New York Jets|PHI Philadelphia Eagles|PIT Pittsburgh Steelers|SF San Francisco 49ers|SEA Seattle Seahawks|TB Tampa Bay Buccaneers|TEN Tennessee Titans|WAS Washington Commanders' };
const GT = 'https://mobile.gametime.co/v1', UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); return r.ok ? r.json() : null; };
(async () => {
  const s = await get(`${GT}/search?q=${encodeURIComponent('Los Angeles Lakers')}`); console.log('SEARCH SAMPLE', JSON.stringify(s).slice(0, 1500));
  const p = await get(`${GT}/performers?category=nba&per_page=50`); console.log('PERFORMERS SAMPLE', JSON.stringify(p).slice(0, 800));
  const out = {};
  for (const [lg, list] of Object.entries(T)) for (const row of list.split('|')) {
    const [ab, ...nm] = row.split(' '); const full = nm.join(' ');
    let slug = null, name = null;
    for (const c of [lg + ab.toLowerCase(), lg + ab.toLowerCase().slice(0, 2), lg + ab.toLowerCase().slice(0, 3)]) {
      const j = await get(`${GT}/events?performer_slug=${c}&per_page=3`); const e = j && (j.events || [])[0];
      if (e) { const x = e.event || e; if (full.split(' ').pop() && (x.name || '').toLowerCase().includes(full.split(' ').pop().toLowerCase())) { slug = c; name = x.name; break; } }
    }
    if (!slug && s) { const j = await get(`${GT}/search?q=${encodeURIComponent(full)}`); const txt = JSON.stringify(j || {}); const m = txt.match(/"slug":"([a-z0-9-]+)"/); if (m) { slug = '?' + m[1]; } }
    out[`${lg} ${full}`] = slug; console.log(lg, ab, full, '=>', slug, name || '');
  }
  console.log('RESULT ' + JSON.stringify(out));
})();
