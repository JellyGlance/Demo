// The demo's fake back ends in one process:
//  - a Jellyfin server on :8096 (library, users, artwork, and simulated people watching)
//  - Sonarr, Radarr, Prowlarr, Bazarr, Jellyseerr, qBittorrent and SABnzbd on :80, picked by hostname
// The library comes from TMDB when TMDB_API_KEY is set, otherwise from generated titles.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildDataset, generatedCatalog, publicItem, seederView, SERVER_ID, SERVER_NAME, hashId, rng, constants } from "./dataset.mjs";
import { loadTmdbCatalog, IMAGE_BASE } from "./tmdb.mjs";
import { createArrHandler } from "./arr.mjs";
import { artwork } from "./png.mjs";

const { TICKS } = constants;
const JELLYFIN_PORT = Number(process.env.PORT || 8096);
const ARR_PORT = Number(process.env.ARR_PORT || 80);
const DATA_DIR = process.env.DEMO_DATA_DIR || "/data";
const MAX_SESSIONS = Number(process.env.DEMO_MAX_SESSIONS || 4);
const SEED = process.env.DEMO_SEED || "jellyglance-demo";
const log = (...args) => console.log("[services]", ...args);

async function loadCatalog() {
  const key = String(process.env.TMDB_API_KEY || "").trim();
  if (!key) {
    log("TMDB_API_KEY not set, using generated titles");
    return generatedCatalog(SEED);
  }
  try {
    const catalog = await loadTmdbCatalog(key, DATA_DIR);
    log(`TMDB catalogue: ${catalog.movies.length} films, ${catalog.docs.length} documentaries, ${catalog.shows.length} shows, ${catalog.upcoming.length} upcoming films`);
    return catalog;
  } catch (error) {
    log(`TMDB fetch failed (${error.message}), using generated titles`);
    return generatedCatalog(SEED);
  }
}

const data = buildDataset(SEED, await loadCatalog());
const playable = data.items.filter((item) => item.Type === "Movie" || item.Type === "Episode");
const arr = createArrHandler(data);
const memoryImages = new Map();

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function sendImage(res, buffer, type) {
  res.writeHead(200, { "Content-Type": type, "Content-Length": buffer.length, "Cache-Control": "public, max-age=604800" });
  res.end(buffer);
}

// TMDB artwork is fetched once and kept on disk; anything without artwork gets a generated poster.
async function tmdbImage(tmdbPath, size) {
  const file = path.join(DATA_DIR, "images", size, tmdbPath.replace(/[^A-Za-z0-9._-]/g, ""));
  try {
    return await fs.readFile(file);
  } catch {
    const response = await fetch(`${IMAGE_BASE}/${size}${tmdbPath}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`image ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    await fs.writeFile(file, buffer).catch(() => {});
    return buffer;
  }
}

async function itemImage(res, itemId, kind, fillWidth) {
  const item = data.byId.get(itemId);
  const wide = kind !== "primary";
  const tmdbPath = wide ? item?.tmdb?.backdropPath || data.byId.get(item?.SeriesId)?.tmdb?.backdropPath : item?.tmdb?.posterPath || item?.tmdb?.fallbackPosterPath;
  if (tmdbPath) {
    try {
      const size = wide ? (fillWidth > 780 ? "w1280" : "w780") : fillWidth > 342 ? "w500" : "w342";
      return sendImage(res, await tmdbImage(tmdbPath, size), "image/jpeg");
    } catch {
      // fall through to a generated image
    }
  }
  const width = Math.min(1280, Math.max(60, fillWidth || (wide ? 960 : 300)));
  const height = Math.round(wide ? width * 0.5625 : width * 1.5);
  const key = `${itemId}:${kind}:${width}`;
  if (!memoryImages.has(key)) {
    if (memoryImages.size > 2000) memoryImages.clear();
    memoryImages.set(key, artwork(`${itemId}:${kind}`, width, height));
  }
  return sendImage(res, memoryImages.get(key), "image/png");
}

// ---- simulated people watching ----------------------------------------------------------

const live = new Map();

function hourWeight(date) {
  const h = date.getHours();
  if (h >= 19 && h <= 23) return 1;
  if (h >= 17 || h === 0) return 0.6;
  if (h >= 8 && h <= 16) return 0.3;
  return 0.12;
}

function startSession(now) {
  const r = rng(`${now}:${live.size}:${Math.random()}`);
  const user = data.users[Math.floor(r() ** 1.3 * data.users.length)];
  if ([...live.values()].some((s) => s.user.Id === user.Id)) return;
  const item = playable[Math.floor(r() * playable.length)];
  const device = user.devices[Math.floor(r() * user.devices.length)];
  const runtimeMs = item.RunTimeTicks / 10_000;
  const id = hashId("session", user.Id, now);
  live.set(id, {
    id, user, item, device, transcode: r() < 0.2, paused: false, remote: user.remote && r() < 0.6,
    startedAt: now - Math.floor(r() * runtimeMs * 0.6), leaveAt: now + Math.floor((0.2 + r() * 0.8) * runtimeMs),
  });
}

function tick() {
  const now = Date.now();
  for (const [id, session] of live) {
    if (now >= session.leaveAt || (now - session.startedAt) * 10_000 >= session.item.RunTimeTicks) live.delete(id);
    else if (Math.random() < 0.05) session.paused = !session.paused;
  }
  // Keep at least one stream going so the demo never looks empty, more in the evening.
  const target = Math.max(1, Math.round(MAX_SESSIONS * hourWeight(new Date(now))));
  if (live.size < target && (live.size === 0 || Math.random() < 0.5)) startSession(now);
}
setInterval(tick, 20_000).unref();
for (let i = 0; i < 3; i += 1) tick();

function sessionView(session) {
  const { user, item, device } = session;
  const source = item.MediaSources?.[0];
  return {
    Id: session.id, UserId: user.Id, UserName: user.Name, UserPrimaryImageTag: user.PrimaryImageTag, Client: device.Client, DeviceName: device.DeviceName,
    DeviceId: device.DeviceId, ApplicationVersion: device.ApplicationVersion, LastActivityDate: new Date().toISOString(), IsActive: true, ServerId: SERVER_ID,
    RemoteEndPoint: session.remote ? `81.2.${(user.Name.length * 17) % 255}.${(item.Name.length * 9) % 255}` : "192.168.1.42",
    NowPlayingItem: { ...publicItem(item), MediaStreams: source?.MediaStreams || [] },
    PlayState: {
      PositionTicks: Math.min(item.RunTimeTicks, (Date.now() - session.startedAt) * 10_000), IsPaused: session.paused, IsMuted: false,
      PlayMethod: session.transcode ? "Transcode" : "DirectPlay", MediaSourceId: source?.Id, CanSeek: true,
    },
    TranscodingInfo: session.transcode
      ? {
          AudioCodec: "aac", VideoCodec: "h264", Container: "ts", IsVideoDirect: false, IsAudioDirect: false, Bitrate: 8_000_000, Width: 1920, Height: 1080,
          TranscodeReasons: [source?.MediaStreams?.[0]?.Codec === "hevc" ? "VideoCodecNotSupported" : "ContainerBitrateExceedsLimit"],
        }
      : undefined,
    PlayableMediaTypes: ["Video"], SupportsRemoteControl: true,
  };
}

// ---- Jellyfin API ------------------------------------------------------------------------

const scheduledTasks = [
  ["Scan Media Library", "Library"], ["Extract Chapter Images", "Library"], ["Refresh People", "Library"],
  ["Clean Transcode Directory", "Maintenance"], ["Optimize database", "Maintenance"], ["Download missing subtitles", "Subtitles"],
].map(([Name, Category], index) => {
  const end = new Date(Date.now() - (index + 1) * 3_600_000);
  const Key = Name.replace(/\s+/g, "");
  return {
    Id: hashId("task", Name), Name, Category, Key, State: "Idle", Triggers: [{ Type: "IntervalTrigger", IntervalTicks: 12 * 3600 * TICKS }],
    LastExecutionResult: { StartTimeUtc: new Date(end.getTime() - 120_000).toISOString(), EndTimeUtc: end.toISOString(), Status: "Completed", Name, Key, Id: hashId("task", Name) },
  };
});
const userView = ({ persona, activity, remote, devices, ...u }) => u;
const byDateCreated = (a, b) => String(b.DateCreated).localeCompare(String(a.DateCreated));
const page = (list, q) => {
  const start = Number(q.get("startIndex") ?? q.get("StartIndex") ?? 0) || 0;
  const limit = Number(q.get("limit") ?? q.get("Limit") ?? list.length) || list.length;
  return { Items: list.slice(start, start + limit).map(publicItem), TotalRecordCount: list.length, StartIndex: start };
};

async function jellyfin(req, res, url) {
  const lower = (url.pathname.replace(/\/+$/, "") || "/").toLowerCase();
  const q = url.searchParams;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (lower === "/users/authenticatebyname") return json(res, 401, { error: "The demo server has no logins" });
    res.writeHead(204);
    return res.end();
  }

  if (lower === "/_demo/dataset") return json(res, 200, seederView(data));
  if (lower === "/system/info/public") return json(res, 200, { LocalAddress: "http://mock-jellyfin:8096", ServerName: SERVER_NAME, Version: "10.10.7", ProductName: "Jellyfin Server", OperatingSystem: "Linux", Id: SERVER_ID, StartupWizardCompleted: true });
  if (lower === "/system/info") return json(res, 200, { ServerName: SERVER_NAME, Version: "10.10.7", ProductName: "Jellyfin Server", OperatingSystem: "Linux", OperatingSystemDisplayName: "Linux", Id: SERVER_ID, HasPendingRestart: false });
  if (lower === "/system/configuration") return json(res, 200, { ServerName: SERVER_NAME, UICulture: "en-GB" });
  if (lower === "/plugins") return json(res, 200, []);
  if (lower === "/scheduledtasks") return json(res, 200, scheduledTasks);
  if (lower === "/sessions") return json(res, 200, [...live.values()].map(sessionView));
  if (lower === "/users") return json(res, 200, data.users.map(userView));
  if (lower === "/library/mediafolders" || lower === "/library/virtualfolders") return json(res, 200, { Items: data.libraries, TotalRecordCount: data.libraries.length });

  let m = lower.match(/^\/users\/([0-9a-f]{32})$/);
  if (m) {
    const user = data.users.find((u) => u.Id === m[1]);
    return user ? json(res, 200, userView(user)) : json(res, 404, { error: "User not found" });
  }
  m = lower.match(/^\/users\/([0-9a-f]{32})\/images\/primary$/);
  if (m) return sendImage(res, artwork(`user:${m[1]}`, 160, 160), "image/png");
  if (/^\/users\/[0-9a-f]{32}\/items\/latest$/.test(lower)) {
    const parent = q.get("ParentId") || q.get("parentId");
    const limit = Number(q.get("Limit") || q.get("limit") || 20);
    return json(res, 200, data.items.filter((i) => (i.Type === "Movie" || i.Type === "Series") && (!parent || i.ParentId === parent)).sort(byDateCreated).slice(0, limit).map(publicItem));
  }
  if (/^\/users\/[0-9a-f]{32}\/items$/.test(lower)) return json(res, 200, { Items: [], TotalRecordCount: 0 });

  if (lower === "/items") {
    const parent = q.get("ParentId") || q.get("parentId");
    const ids = (q.get("Ids") || q.get("ids") || "").split(",").filter(Boolean);
    const types = (q.get("IncludeItemTypes") || q.get("includeItemTypes") || "").split(",").filter(Boolean);
    let list = parent ? data.items.filter((i) => i.ParentId === parent) : data.items;
    if (ids.length) list = list.filter((i) => ids.includes(i.Id));
    if (types.length) list = list.filter((i) => types.includes(i.Type));
    if (!parent && !ids.length && !types.length) list = list.filter((i) => i.Type === "Movie" || i.Type === "Series");
    return json(res, 200, page([...list].sort(byDateCreated), q));
  }
  m = lower.match(/^\/items\/([0-9a-f]{32})\/playbackinfo$/);
  if (m) {
    const item = data.byId.get(m[1]);
    return item ? json(res, 200, { MediaSources: item.MediaSources || [], PlaySessionId: hashId("play", m[1]) }) : json(res, 404, { error: "Item not found" });
  }
  m = lower.match(/^\/items\/([0-9a-f]{32})\/images\/(primary|backdrop|thumb|logo|banner)(?:\/\d+)?$/);
  if (m) return itemImage(res, m[1], m[2], Number(q.get("fillWidth") || q.get("maxWidth") || 0));
  m = lower.match(/^\/shows\/([0-9a-f]{32})\/seasons$/);
  if (m) {
    const show = data.byId.get(m[1]);
    return json(res, 200, { Items: (show?.seasons || []).map(publicItem), TotalRecordCount: show?.seasons?.length || 0 });
  }
  m = lower.match(/^\/shows\/([0-9a-f]{32})\/episodes$/);
  if (m) {
    const show = data.byId.get(m[1]);
    const seasonId = q.get("seasonId") || q.get("SeasonId");
    const episodes = (show?.seasons || []).filter((s) => !seasonId || s.Id === seasonId).flatMap((s) => s.episodes);
    return json(res, 200, { Items: episodes.map(publicItem), TotalRecordCount: episodes.length });
  }
  m = lower.match(/^\/items\/([0-9a-f]{32})$/);
  if (m) {
    const item = data.byId.get(m[1]);
    return item ? json(res, 200, publicItem(item)) : json(res, 404, { error: "Item not found" });
  }
  if (lower === "/health" || lower === "/") return json(res, 200, { ok: true, source: data.source, items: data.items.length, sessions: live.size });
  return json(res, 404, { error: `Not part of the demo server: ${url.pathname}` });
}

function serve(handler) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://demo");
    let body = "";
    req.on("data", (chunk) => {
      if (body.length < 65536) body += chunk;
    });
    req.on("end", () => {
      Promise.resolve(handler(req, res, url, body)).catch((error) => {
        if (!res.headersSent) json(res, 500, { error: error.message });
      });
    });
  });
}

serve(jellyfin).listen(JELLYFIN_PORT, "0.0.0.0", () => {
  const counts = data.items.reduce((acc, item) => ({ ...acc, [item.Type]: (acc[item.Type] || 0) + 1 }), {});
  log(`Jellyfin on :${JELLYFIN_PORT} (${data.source}) · ${JSON.stringify(counts)} · ${data.users.length} users · ${data.upcoming.episodes.length} upcoming episodes`);
});
serve(arr).listen(ARR_PORT, "0.0.0.0", () => log(`Sonarr, Radarr, Prowlarr, Bazarr, Jellyseerr, qBittorrent, SABnzbd on :${ARR_PORT}`));
