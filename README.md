# game-price-watcher

Watches resale ticket prices (4 seats together) for the Nuggets, Avalanche and Broncos home games and posts to
Slack + Discord when a price drops. Runs on GitHub Actions (free on a public repo) every 30 minutes while a home
game is within `daysAhead` (default 14 days), 5 AM–10 PM Denver; pauses itself otherwise and wakes up once a day.

- `game-price-watcher/wants.json` – teams, venue lower-bowl definition, `daysAhead`, drop thresholds, optional manual
  `games` with targets, e.g. `{"team":"Nuggets","opponent":"Suns","date":"2026-11-20","target":{"all":60,"lower":120}}`.
  Pushing a change to this file wakes the watcher immediately.
- `game-price-watcher/watch.js` – opens each game's TickPick and SeatGeek page in the runner's Chrome, captures the
  listings JSON, finds the cheapest 4-together price anywhere and in the lower bowl, and alerts when a price is
  20%+ below the lowest seen (or at/under a target), not re-alerting within 15% of the last alert.
- `state/games.json` – cached home-game schedule (refreshed daily); `state/seen.json` – prices seen and alerts sent.
- `.github/workflows/notify.yml` – relay used by Claude's scheduled tasks to post to Slack + Discord.

Secrets: `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` (the game-prices channel webhook).
Nothing is ever bought and nobody signs in.
