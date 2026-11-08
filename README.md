# game-price-watcher

Watches resale ticket prices (4 seats together) for the Nuggets, Avalanche and Broncos home games, plus any NBA, NFL or
NHL game asked for (any team, home or away), and posts to Slack + Discord when a price drops. Runs on GitHub Actions (free on a public repo) every 5 minutes while a home
game is within `daysAhead` (default 14 days), 5 AM–10 PM Denver; pauses itself otherwise and wakes up once a day.

- `game-price-watcher/wants.json` – teams, venue lower-bowl definition, `daysAhead`, drop thresholds, optional manual
  `games` with targets, e.g. `{"team":"Nuggets","opponent":"Suns","date":"2026-11-20","target":{"all":60,"lower":120}}`.
  Pushing a change to this file wakes the watcher immediately.
- `game-price-watcher/watch.js` – reads each game's listings from Gametime's public API (TickPick page as fallback), finds the cheapest 4-together price anywhere and in the lower bowl, and alerts when a price is
  20%+ below the lowest seen (or at/under a target), not re-alerting within 15% of the last alert.
- `state/games.json` – cached home-game schedule (refreshed daily); `state/seen.json` – prices seen and alerts sent.
- `.github/workflows/notify.yml` – relay used by Claude's scheduled tasks to post to Slack + Discord.

Secrets: `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` (the game-prices channel webhook).
Nothing is ever bought and nobody signs in.

## Discord commands and daily report
Post in the Discord game-prices channel (a bot reads it every 5 minutes):
`watch Nuggets vs Suns Nov 20 under 80 lower under 150` · `watch Avs Sat` · `watch Broncos vs Raiders` · `stop Nuggets Nov 20` ·
`stop all` · `watch list` · `report` · `price graph Nuggets vs Suns` (or `graph Lakers`, `graph all`). Any NBA, NFL or NHL team works too: `watch Lakers vs Celtics Dec 25` · `watch Broncos @ Chiefs` ·
`watch Maple Leafs` (next game). Shared nicknames need a league or city: `NHL Kings`, `LA Kings`, `NFL Jets`. Home games of the TEAMS teams
in the next 14 days are watched automatically; a "watch" adds any other game or sets targets. Every team and its Gametime slug is in
`game-price-watcher/teams.js`; `gt.js` looks up a team's schedule (cached 6 hours in `state/teamgames.json`). Every morning at 7:15 a price report lists every upcoming game (anywhere / lower bowl, arrows vs yesterday).
Secrets for this: `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` (the game-prices channel), `DISCORD_WEBHOOK_URL`.

## One source of truth: Bradley's Google Calendar
With `GCAL_SA_KEY` + `GCAL_CALENDAR_ID` set (a Google service account the calendar is shared with), the watcher takes the teams
from the `TEAMS:` line of the silent **"Personal: life settings"** event (the app's Settings), games and targets from `WATCH:`
lines on **"Personal: ticket watch"** (written by Discord commands and Pocket), keeps the **"Price watch: Broncos & Avs tickets
(log)"** event current (read by the morning brief and Sunday reset), and creates "Personal: ticket drop – …" alert events.

## How it stays on schedule
`tick.yml` is a self-chaining heartbeat: every ~5 minutes it reads Discord, starts the price check every 5 minutes
(5 AM–10 PM, while a home game is within 14 days) and the price board on the first tick after 7:15 AM, then starts the
next tick. GitHub's cron is unreliable (often hours late), so cron only restarts the chain if it stops.
Price data: Gametime's public API (all-in prices, section/row); TickPick is a fallback.

## Price graphs
Every check saves each game's cheapest anywhere / lower-bowl price to `state/history.json` (a point on every change, else every
30 minutes; finished games are dropped). Games he asked for (WATCH lines / "watch …") get a small sparkline inside their Discord
embed on drop alerts and the daily board (🔵 anywhere, 🟠 lower bowl); the automatic home games stay text-only. `price graph …`
works for any tracked game: commands.js writes a request to `state/graph-requests/`, and the next price check posts the graphs and
deletes the request. Charts are drawn by `charts.js` (SVG → PNG in the runner's Chrome).
