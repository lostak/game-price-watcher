# Discord slash commands for the My Life bots

`/tickets …` (in #game-prices), `/golf …` (in #golf) and `/help` show up when you type `/` in Discord.

Discord wants an answer to a slash command within 3 seconds, and the GitHub bots only look every 5 minutes, so a tiny
Cloudflare Worker (free plan) answers instantly with `⏳ \`<command>\` …`. The bot in that channel reads that reply as the
command on its next check (commands.js in game-price-watcher and golf-watcher). The worker also autocompletes team names
(every NBA/NFL/NHL team) and golf courses (`golf-watcher/state/courses.json`). It holds no secrets.

Setup (once):
1. Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it `my-life-discord` → Deploy → Edit code →
   replace everything with `worker.js` → Deploy. Copy its `https://my-life-discord.<you>.workers.dev` URL.
2. Discord Developer Portal → the bot's application → General Information → Interactions Endpoint URL → paste → Save.
3. Run the `discord slash commands` workflow with `register` (installs `commands.json` on the server).

Changing commands: edit `commands.json` (and `toText` in worker.js), redeploy the worker, run `register` again.
