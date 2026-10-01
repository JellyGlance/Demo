// Seeds the demo: connects the fake integrations, writes a year of believable viewing history,
// and (with --watch) rebuilds it every few hours so the demo always looks current.
import pg from "pg";
import { hashId, rng, SERVER_ID, constants } from "./dataset.mjs";

const { TICKS, DAY } = constants;
const env = (name, fallback) => process.env[name] ?? fallback;
const JG_URL = env("JG_URL", "http://jellyglance:3000").replace(/\/+$/, "");
const HISTORY_DAYS = Number(env("DEMO_HISTORY_DAYS", 365));
const RESET_EVERY_HOURS = Math.max(1, Number(env("DEMO_RESET_EVERY_HOURS", 4)));
const SERVICES_URL = env("SERVICES_URL", "http://mock-jellyfin:8096").replace(/\/+$/, "");
const WATCH = process.argv.includes("--watch");
let data = null;

const pool = new pg.Pool({
  host: env("POSTGRES_IP", "db"),
  port: Number(env("POSTGRES_PORT", 5432)),
  user: env("POSTGRES_USER", "postgres"),
  password: env("POSTGRES_PASSWORD", ""),
  database: env("POSTGRES_DB", "jellyglance"),
  max: 4,
});

const log = (...args) => console.log("[seed]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, check, { timeoutMs = 600_000, everyMs = 3000 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await sleep(everyMs);
  }
}

async function jellyglanceToken() {
  const response = await fetch(`${JG_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: env("DEMO_USER", "demo"), password: env("DEMO_PASSWORD", "") }),
  });
  if (!response.ok) throw new Error(`Demo login failed (${response.status})`);
  return (await response.json()).token;
}

async function libraryItemCount() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM jf_library_items WHERE "Type" IN ('Movie','Series')`);
  return rows[0].n;
}

// ---- library from the demo services ---------------------------------------------

// The services decide the library (TMDB or generated); fetch it so history uses the same IDs.
export function useDataset(view) {
  const byId = new Map(view.items.map((item) => [item.Id, item]));
  const series = view.series.map((s) => ({ Id: s.Id, seasons: s.seasons.map((x) => ({ Id: x.Id, episodes: x.episodes.map((id) => byId.get(id)).filter(Boolean) })) }));
  const movies = view.items.filter((i) => i.Type === "Movie" && i.LibraryId === view.libraries[0].Id);
  data = {
    seed: view.seed,
    users: view.users,
    series: series.filter((s) => s.seasons.some((x) => x.episodes.length)),
    movies,
    docs: view.items.filter((i) => i.Type === "Movie" && i.LibraryId === view.libraries[2].Id),
    familyMovies: movies.filter((m) => (m.Genres || []).some((g) => ["Animation", "Family", "Adventure"].includes(g))),
    expectedTitles: new Set(view.items.filter((i) => i.Type === "Movie").map((i) => i.Id)).size + view.series.length,
  };
  if (!data.familyMovies.length) data.familyMovies = movies;
  if (!data.docs.length) data.docs = movies;
  return data;
}

// ---- history generation -----------------------------------------------------

function startHour(r, persona, weekend) {
  if (persona === "night-owl") return (22 + Math.floor(r() * 5)) % 24;
  if (persona === "kids") return weekend ? 8 + Math.floor(r() * 10) : 15 + Math.floor(r() * 4);
  const roll = r();
  if (roll < 0.62) return 19 + Math.floor(r() * 4);
  if (roll < 0.8) return weekend ? 12 + Math.floor(r() * 6) : 17 + Math.floor(r() * 2);
  if (roll < 0.93) return 6 + Math.floor(r() * 3);
  return 23;
}

function playRow(r, user, item, endsAt, seconds) {
  const device = user.devices[Math.floor(r() * user.devices.length)];
  const source = item.MediaSources?.[0] || {};
  const video = (source.MediaStreams || []).find((s) => s.Type === "Video");
  // HEVC in a browser is the classic forced transcode; otherwise most plays direct-play.
  const mustTranscode = video?.Codec === "hevc" && /Web/.test(device.Client) ? 0.45 : 0;
  const roll = r();
  const method = roll < 0.08 + mustTranscode ? "Transcode" : roll < 0.18 + mustTranscode ? "DirectStream" : "DirectPlay";
  const isEpisode = item.Type === "Episode";
  const remote = user.remote && r() < 0.5;
  return {
    Id: `demo-${hashId(user.Id, item.Id, endsAt.toISOString())}`,
    IsPaused: false,
    UserId: user.Id,
    UserName: user.Name,
    Client: device.Client,
    DeviceName: device.DeviceName,
    DeviceId: device.DeviceId,
    ApplicationVersion: device.ApplicationVersion,
    NowPlayingItemId: isEpisode ? item.SeriesId : item.Id,
    NowPlayingItemName: item.Name,
    SeasonId: isEpisode ? item.SeasonId : null,
    SeriesName: isEpisode ? item.SeriesName : null,
    EpisodeId: isEpisode ? item.Id : null,
    PlaybackDuration: seconds,
    ActivityDateInserted: endsAt,
    PlayMethod: method,
    MediaStreams: JSON.stringify(source.MediaStreams || []),
    TranscodingInfo:
      method === "Transcode"
        ? JSON.stringify({
            VideoCodec: "h264",
            AudioCodec: "aac",
            Container: "ts",
            IsVideoDirect: false,
            IsAudioDirect: false,
            Bitrate: remote ? 4_000_000 : 8_000_000,
            TranscodeReasons: [video?.Codec === "hevc" ? "VideoCodecNotSupported" : remote ? "ContainerBitrateExceedsLimit" : "AudioCodecNotSupported"],
          })
        : null,
    PlayState: JSON.stringify({ IsPaused: false, PositionTicks: seconds * TICKS, PlayMethod: method }),
    OriginalContainer: source.Container || "mkv",
    RemoteEndPoint: remote ? `81.2.${(user.Name.length * 17) % 255}.${Math.floor(r() * 250)}` : "192.168.1.42",
    ServerId: SERVER_ID,
  };
}

export function generateHistory(now = new Date()) {
  const rows = [];
  const { movies, docs, familyMovies } = data;
  for (const user of data.users) {
    const r = rng(`${data.seed}:history:${user.Id}`);
    // Each user works through a few shows in order, like a real watchlist.
    const queue = Array.from({ length: 6 }, () => data.series[Math.floor(r() * data.series.length)]);
    const progress = new Map(queue.map((s) => [s.Id, 0]));
    const nextEpisode = () => {
      for (let attempt = 0; attempt < queue.length; attempt += 1) {
        const show = queue[Math.floor(r() ** 1.5 * queue.length)];
        const episodes = show.seasons.flatMap((s) => s.episodes);
        const index = progress.get(show.Id) || 0;
        if (index < episodes.length) {
          progress.set(show.Id, index + 1);
          return episodes[index];
        }
        // Finished this show: swap in another one, keeping its place if it was started before.
        const replacement = data.series[Math.floor(r() * data.series.length)];
        queue[queue.indexOf(show)] = replacement;
        if (!progress.has(replacement.Id)) progress.set(replacement.Id, 0);
      }
      return null;
    };

    for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo -= 1) {
      const day = new Date(now.getTime() - daysAgo * DAY);
      const weekday = day.getDay();
      const weekend = weekday === 0 || weekday === 5 || weekday === 6;
      const season = 1 + 0.25 * Math.cos(((day.getMonth() - 0.5) / 12) * 2 * Math.PI); // more in winter
      const chance = Math.min(0.95, user.activity * (weekend ? 1.25 : 0.85) * season * 0.75);
      if (r() > chance) continue;

      const sittings = user.persona === "binger" && weekend ? 1 + Math.floor(r() * 2) : 1;
      for (let s = 0; s < sittings; s += 1) {
        const start = new Date(day);
        start.setHours(startHour(r, user.persona, weekend), Math.floor(r() * 60), 0, 0);
        let cursor = start.getTime();
        const plays = [];
        const persona = user.persona;
        if (persona === "movie-buff" || (persona === "casual" && r() < 0.4) || (persona === "weekend" && weekend && r() < 0.5)) {
          plays.push(movies[Math.floor(r() * movies.length)]);
        } else if (persona === "kids") {
          plays.push(r() < 0.6 ? familyMovies[Math.floor(r() * familyMovies.length)] : nextEpisode());
        } else if (persona === "docs" && r() < 0.7) {
          plays.push(docs[Math.floor(r() * docs.length)]);
        } else {
          const run = persona === "binger" ? 2 + Math.floor(r() * (weekend ? 5 : 3)) : 1 + Math.floor(r() * 2);
          for (let e = 0; e < run; e += 1) plays.push(nextEpisode());
        }
        for (const item of plays.filter(Boolean)) {
          const runtime = item.RunTimeTicks / TICKS;
          const completion = r() < 0.12 ? 0.08 + r() * 0.35 : 0.82 + r() * 0.18;
          const seconds = Math.round(runtime * completion);
          const endsAt = new Date(cursor + seconds * 1000);
          if (endsAt.getTime() > now.getTime()) break;
          rows.push(playRow(r, user, item, endsAt, seconds));
          cursor = endsAt.getTime() + Math.floor(r() * 4 * 60_000);
        }
      }
    }
  }
  return rows;
}

const COLUMNS = [
  "Id", "IsPaused", "UserId", "UserName", "Client", "DeviceName", "DeviceId", "ApplicationVersion", "NowPlayingItemId",
  "NowPlayingItemName", "SeasonId", "SeriesName", "EpisodeId", "PlaybackDuration", "ActivityDateInserted", "PlayMethod",
  "MediaStreams", "TranscodingInfo", "PlayState", "OriginalContainer", "RemoteEndPoint", "ServerId",
];

async function insertRows(client, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = rows.slice(i, i + 400);
    const values = [];
    const placeholders = batch.map((row, b) => {
      COLUMNS.forEach((column) => values.push(row[column]));
      return `(${COLUMNS.map((_, c) => `$${b * COLUMNS.length + c + 1}`).join(",")}, false)`;
    });
    await client.query(
      `INSERT INTO jf_playback_activity (${COLUMNS.map((c) => `"${c}"`).join(",")}, imported) VALUES ${placeholders.join(",")} ON CONFLICT DO NOTHING`,
      values
    );
  }
}

async function refreshViews() {
  const { rows } = await pool.query(`SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'`);
  for (const { matviewname } of rows) {
    await pool.query(`REFRESH MATERIALIZED VIEW "${matviewname}"`).catch((error) => log(`refresh ${matviewname} failed: ${error.message}`));
  }
}

// The fake apps each answer on port 80 under their own hostname (see docker-compose.yml).
const INTEGRATIONS = {
  arrApps: [
    { name: "Sonarr", slug: "sonarr", host: "sonarr", secret: "demo-sonarr-key" },
    { name: "Radarr", slug: "radarr", host: "radarr", secret: "demo-radarr-key" },
    { name: "Prowlarr", slug: "prowlarr", host: "prowlarr", secret: "demo-prowlarr-key" },
    { name: "Bazarr", slug: "bazarr", host: "bazarr", secret: "demo-bazarr-key" },
    { name: "Jellyseerr", slug: "jellyseerr", host: "jellyseerr", secret: "demo-seerr-key" },
  ].map(({ host, secret, ...app }) => ({ ...app, instanceId: `${app.slug}-demo`, connected: true, values: { url: `http://${host}`, secret } })),
  clients: [
    { name: "qBittorrent", slug: "qbittorrent", protocol: "Torrent", instanceId: "qbittorrent-demo", connected: true, values: { url: "http://qbittorrent", username: "demo", secret: "demo-password" } },
    { name: "SABnzbd", slug: "sabnzbd", protocol: "Usenet", instanceId: "sabnzbd-demo", connected: true, values: { url: "http://sabnzbd", secret: "demo-sab-key" } },
  ],
  thirdParty: [],
};

async function connectIntegrations() {
  const token = await jellyglanceToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const saved = await fetch(`${JG_URL}/api/integrations`, { method: "POST", headers, body: JSON.stringify(INTEGRATIONS) });
  if (!saved.ok) throw new Error(`saving integrations failed (${saved.status})`);
  await fetch(`${JG_URL}/api/integrations/test-all`, { method: "POST", headers, body: "{}" }).catch(() => {});
  await fetch(`${JG_URL}/api/startTask?task=IntegrationSync`, { headers }).catch(() => {});
  log("integrations connected: Sonarr, Radarr, Prowlarr, Bazarr, Jellyseerr, qBittorrent, SABnzbd");
}

// The demo never needs backups (it rebuilds itself), so push JellyGlance's scheduled backup
// out of reach. The settings endpoint reloads the scheduler, so this applies straight away.
const BACKUP_INTERVAL_MINUTES = 10 * 365 * 24 * 60;

async function disableBackups() {
  const token = await jellyglanceToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const response = await fetch(`${JG_URL}/api/setTaskSettings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskname: "Backup", Interval: BACKUP_INTERVAL_MINUTES }),
  });
  // JellyGlance up to 1.2.11 saves and reloads the schedule, then errors while replying, so check
  // the saved value rather than the status code.
  const { rows } = await pool.query(`SELECT (settings->'Tasks'->'Backup'->>'Interval')::bigint AS interval FROM app_config WHERE "ID" = 1`);
  if (Number(rows[0]?.interval) !== BACKUP_INTERVAL_MINUTES) throw new Error(`backup interval not saved (HTTP ${response.status})`);
  log("scheduled backups disabled");
}

// JellyGlance's JS_SKIP_FIRST_RUN marks the first-run wizard as done at startup, but up to 1.2.11
// a settings save made straight after can write the old flag back, leaving visitors on the wizard.
// Set it directly, and keep checking.
async function skipFirstRunWizard() {
  const { rowCount } = await pool.query(
    `UPDATE app_config
        SET settings = (COALESCE(settings::jsonb, '{}'::jsonb) || jsonb_build_object(
          'firstRunExtrasPending', false,
          'firstRunExtrasCompleted', true,
          'firstRunExtrasCompletedAt', COALESCE(settings->>'firstRunExtrasCompletedAt', now()::text)))::json
      WHERE "ID" = 1
        AND (COALESCE((settings->>'firstRunExtrasPending')::boolean, false)
             OR NOT COALESCE((settings->>'firstRunExtrasCompleted')::boolean, false))`
  );
  if (rowCount) log("first-run wizard marked done");
}

async function reseed() {
  const rows = generateHistory();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Clear everything, including plays recorded from the simulated live sessions, so each reset starts clean.
    await client.query("DELETE FROM jf_playback_activity");
    await client.query("DELETE FROM jf_activity_watchdog");
    await insertRows(client, rows);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await refreshViews();
  await connectIntegrations().catch((error) => log(`integrations: ${error.message}`));
  await disableBackups().catch((error) => log(`backups: ${error.message}`));
  await skipFirstRunWizard().catch((error) => log(`first-run wizard: ${error.message}`));
  log(`seeded ${rows.length} plays across ${data.users.length} users (${HISTORY_DAYS} days)`);
}

function nextReset(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(Math.floor(now.getHours() / RESET_EVERY_HOURS) * RESET_EVERY_HOURS + RESET_EVERY_HOURS);
  return next;
}

async function main() {
  await waitFor("demo services", async () => {
    const response = await fetch(`${SERVICES_URL}/_demo/dataset`);
    if (!response.ok) return false;
    useDataset(await response.json());
    return true;
  });
  log(`library: ${data.movies.length + data.docs.length} films, ${data.series.length} shows`);
  await waitFor("Postgres", async () => (await pool.query("SELECT 1")).rowCount === 1);
  await waitFor("JellyGlance setup", async () => {
    const response = await fetch(`${JG_URL}/auth/isConfigured`);
    return response.ok && (await response.json()).state === 2;
  });
  await skipFirstRunWizard();
  log("JellyGlance is configured; waiting for the library sync");

  // Allow a little slack so one odd title can never stall the demo.
  const expected = Math.floor(data.expectedTitles * 0.95);
  try {
    await waitFor("library sync", async () => (await libraryItemCount()) >= expected, { timeoutMs: 120_000 });
  } catch {
    log("library sync not finished, starting one");
    const token = await jellyglanceToken();
    await fetch(`${JG_URL}/sync/beginSync`, { headers: { Authorization: `Bearer ${token}` } });
    await waitFor("library sync", async () => (await libraryItemCount()) >= expected, { timeoutMs: 900_000 });
  }
  log(`library synced (${await libraryItemCount()} titles)`);

  await reseed();
  if (!WATCH) {
    await pool.end();
    return;
  }

  setInterval(() => skipFirstRunWizard().catch((error) => log(`first-run wizard: ${error.message}`)), 60_000);
  for (;;) {
    const next = nextReset();
    log(`next reset at ${next.toISOString()} (every ${RESET_EVERY_HOURS}h)`);
    await sleep(next.getTime() - Date.now());
    await reseed().catch((error) => log(`reset failed: ${error.message}`));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[seed] failed:", error.message);
    process.exit(1);
  });
}
