// Watchdog: DMs Bradley on Discord when another watcher's 5-minute loop stops (no run for 20+ minutes between
// 6 AM and 10 PM Denver), and again when it's back. With --slate (game-price-watcher only, it has the calendar) it also
// checks that the Claude "Task guardian" ran on schedule (the guardian re-runs every other missed Claude task).
// Usage: node watchdog.js "owner/repo:workflow.yml,owner/repo:workflow.yml" [--slate]
// Env: GH_API_TOKEN, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID (any channel in the server), optional DISCORD_OWNER_ID.
// Copied into golf-watcher (which watches game-price-watcher), so the two cover each other.
'use strict';
const fs = require('fs');
const one = v => String(v || '').split(/\s+/).filter(Boolean)[0] || '';
const TOKEN = one(process.env.DISCORD_BOT_TOKEN), CHANNEL = one(process.env.DISCORD_CHANNEL_ID), GH = process.env.GH_API_TOKEN || process.env.GITHUB_TOKEN;
const STATE = 'state/watchdog.json', TZ = 'America/Denver';
const targets = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { const [repo, wf] = s.split(':'); return { repo, wf }; });
const hm = () => +new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', '');

const dapi = async (method, path, body) => {
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Discord ${path} ${r.status}`); return r.json();
};
async function dm(st, text) {
  if (!st.dmId) {
    let owner = one(process.env.DISCORD_OWNER_ID);
    if (!owner) { const ch = await dapi('GET', `/channels/${CHANNEL}`); owner = (await dapi('GET', `/guilds/${ch.guild_id}`)).owner_id; }
    st.dmId = (await dapi('POST', '/users/@me/channels', { recipient_id: owner })).id;
  }
  await dapi('POST', `/channels/${st.dmId}/messages`, { content: text, allowed_mentions: { parse: [] } });
}

(async () => {
  if (!TOKEN || !CHANNEL) { console.log('watchdog: Discord bot not configured'); return; }
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  st.down ||= {};
  const t = hm(), daytime = t >= 600 && t < 2200;
  for (const { repo, wf } of targets) {
    const key = `${repo}:${wf}`;
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?per_page=1`, { headers: { Accept: 'application/vnd.github+json', ...(GH ? { Authorization: 'Bearer ' + GH } : {}) } });
    if (!r.ok) { console.log(`watchdog: ${key} → GitHub ${r.status}`); continue; }
    const run = (await r.json()).workflow_runs?.[0];
    const age = run ? (Date.now() - Date.parse(run.created_at)) / 60e3 : Infinity;
    const name = repo.split('/')[1];
    if (age > 20 && daytime && !st.down[key]) {
      st.down[key] = new Date().toISOString();
      await dm(st, `⚠ **${name} stopped** – no run for ${Math.round(age)} minutes. It usually restarts itself within the hour; if not, open https://github.com/${repo}/actions and run "${wf.replace('.yml', '')}" (Run workflow).`);
      console.log('watchdog: alerted', key);
    } else if (age <= 20 && st.down[key]) {
      delete st.down[key];
      await dm(st, `✅ **${name} is running again.**`);
      console.log('watchdog: recovered', key);
    } else console.log(`watchdog: ${key} last run ${Math.round(age)} min ago`);
  }
  // Who checks the task guardian: the Claude "Task guardian" (re-runs missed/failed Claude tasks at 9:23 AM, 2:23 PM and
  // 10:23 PM) stamps "LAST RUN:" on its silent "Personal: task guardian log" event every run. If a scheduled guardian run
  // hasn't stamped it within 45 minutes, Bradley gets one DM (GitHub can't start Claude tasks, so this is the last resort).
  if (process.argv.includes('--slate')) {
    const cal = require('./gcal');
    if (cal.ready) {
      const now = new Date(), local = new Date(now.toLocaleString('en-US', { timeZone: TZ })), off = local - now;
      const today = cal.todayLocal(), at = (d, h, m) => new Date(Date.parse(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - off);
      const yest = new Date(Date.parse(today + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
      const due = [[yest, 22, 23], [today, 9, 23], [today, 14, 23], [today, 22, 23]].map(([d, h, m]) => at(d, h, m)).filter(x => x.getTime() + 45 * 60e3 <= now.getTime()).pop();
      if (due && st.guardianDue !== due.toISOString()) {
        const ev = await cal.findByTitle('Personal: task guardian log', 'TASK-GUARDIAN', { back: 30, ahead: 1 }).catch(() => null);
        const stamp = ev && (ev.description || '').match(/^LAST RUN:\s*(\S+)/m);
        const last = stamp ? Date.parse(stamp[1]) : ev ? Date.parse(ev.updated) : NaN;
        if (!ev && Date.now() < Date.parse('2026-11-14T06:00:00Z')) console.log('watchdog: guardian log not created yet (first run pending)');
        else if (!(last >= due.getTime() - 10 * 60e3)) {
          await dm(st, `⚠ **Task guardian didn't run** at ${due.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} – so missed Claude tasks aren't being re-run right now. Its next run is in a few hours; to run it now, open Claude's scheduled tasks and run "Task guardian".`);
          console.log('watchdog: guardian stale');
        } else console.log('watchdog: guardian ran ' + new Date(last).toISOString());
        st.guardianDue = due.toISOString();
      }
    }
  }
  fs.mkdirSync('state', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st));
})().catch(e => { console.error('watchdog:', e.message); process.exit(1); });
