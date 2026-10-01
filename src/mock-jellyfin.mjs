// A stand-in Jellyfin server for the demo. It answers the API calls JellyGlance makes,
// serves generated artwork, and simulates people watching so "Now playing" stays alive.
import http from "node:http";
import { buildDataset, publicItem, SERVER_ID, SERVER_NAME, hashId, rng, constants } from "./dataset.mjs";
import { artwork } from "./png.mjs";

const PORT = Number(process.env.PORT || 8096);
const data = buildDataset(process.env.DEMO_SEED || "jellyglance-demo");
const { TICKS } = constants;
const MAX_SESSIONS = Number(process.env.DEMO_MAX_SESSIONS || 4);
const playable = data.items.filter((item) => item.Type === "Movie" || item.Type === "Episode");
const imageCache = new Map();

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function image(res, key, width, height) {
  const cacheKey = `${key}:${width}x${height}`;
  let png = imageCache.get(cacheKey);
  if (!png) {
    png = artwork(key, width, height);
    if (imageCache.size > 2000) imageCache.clear();
    imageCache.set(cacheKey, png);
  }
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=86400" });
  res.end(png);
}

function descendants(parentId) {
  return data.items.filter((item) => item.ParentId === parentId);
}

function page(list, query) {
  const start = Number(query.get("startIndex") ?? query.get("StartIndex") ?? 0) || 0;
  const limit = Number(query.get("limit") ?? query.get("Limit") ?? list.length) || list.length;
  return { Items: list.slice(start, start + limit).map(publicItem), TotalRecordCount: list.length, StartIndex: start };
}

function byDateCreated(a, b) {
  return String(b.DateCreated).localeCompare(String(a.DateCreated));
}

// ---- simulated live sessions ------------------------------------------------

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
  const transcode = r() < 0.28;
  const runtimeMs = item.RunTimeTicks / 10_000;
  live.set(hashId("session", user.Id, now), {
    id: hashId("session", user.Id, now),
    user,
    item,
    device,
    transcode,
    startedAt: now - Math.floor(r() * runtimeMs * 0.6),
    leaveAt: now + Math.floor((0.2 + r() * 0.8) * runtimeMs),
    paused: false,
    remote: user.remote && r() < 0.6,
  });
}

function tick() {
  const now = Date.now();
  for (const [id, session] of live) {
    const position = now - session.startedAt;
    if (now >= session.leaveAt || position * 10_000 >= session.item.RunTimeTicks) live.delete(id);
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
  const position = Math.min(item.RunTimeTicks, (Date.now() - session.startedAt) * 10_000);
  const source = item.MediaSources?.[0];
  return {
    Id: session.id,
    UserId: user.Id,
    UserName: user.Name,
    UserPrimaryImageTag: user.PrimaryImageTag,
    Client: device.Client,
    DeviceName: device.DeviceName,
    DeviceId: device.DeviceId,
    ApplicationVersion: device.ApplicationVersion,
    RemoteEndPoint: session.remote ? `81.2.${(user.Name.length * 17) % 255}.${(item.Name.length * 9) % 255}` : "192.168.1.42",
    LastActivityDate: new Date().toISOString(),
    IsActive: true,
    ServerId: SERVER_ID,
    NowPlayingItem: {
      ...publicItem(item),
      MediaStreams: source?.MediaStreams || [],
    },
    PlayState: {
      PositionTicks: position,
      IsPaused: session.paused,
      IsMuted: false,
      PlayMethod: session.transcode ? "Transcode" : "DirectPlay",
      MediaSourceId: source?.Id,
      CanSeek: true,
    },
    TranscodingInfo: session.transcode
      ? {
          AudioCodec: "aac",
          VideoCodec: "h264",
          Container: "ts",
          IsVideoDirect: false,
          IsAudioDirect: false,
          Bitrate: 8_000_000,
          Width: 1920,
          Height: 1080,
          TranscodeReasons: [source?.MediaStreams?.[0]?.Codec === "hevc" ? "VideoCodecNotSupported" : "ContainerBitrateExceedsLimit"],
        }
      : undefined,
    PlayableMediaTypes: ["Video"],
    SupportsRemoteControl: true,
  };
}

// ---- routes --------------------------------------------------------------------

const scheduledTasks = [
  ["Scan Media Library", "Library"],
  ["Extract Chapter Images", "Library"],
  ["Refresh People", "Library"],
  ["Clean Transcode Directory", "Maintenance"],
  ["Optimize database", "Maintenance"],
  ["Download missing subtitles", "Subtitles"],
].map(([Name, Category], index) => {
  const end = new Date(Date.now() - (index + 1) * 3_600_000);
  return {
    Id: hashId("task", Name),
    Name,
    Category,
    Key: Name.replace(/\s+/g, ""),
    State: "Idle",
    Triggers: [{ Type: "IntervalTrigger", IntervalTicks: 12 * 3600 * TICKS }],
    LastExecutionResult: { StartTimeUtc: new Date(end.getTime() - 120_000).toISOString(), EndTimeUtc: end.toISOString(), Status: "Completed", Name, Key: Name.replace(/\s+/g, ""), Id: hashId("task", Name) },
  };
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const lower = path.toLowerCase();
  const q = url.searchParams;
  const method = req.method || "GET";

  if (method !== "GET" && method !== "HEAD") {
    // Accept control actions (stop, message, refresh) without doing anything.
    req.resume();
    if (lower === "/users/authenticatebyname") return json(res, 401, { error: "Demo server has no logins" });
    res.writeHead(204);
    return res.end();
  }

  if (lower === "/system/info/public") {
    return json(res, 200, { LocalAddress: "http://mock-jellyfin:8096", ServerName: SERVER_NAME, Version: "10.10.7", ProductName: "Jellyfin Server", OperatingSystem: "Linux", Id: SERVER_ID, StartupWizardCompleted: true });
  }
  if (lower === "/system/info") {
    return json(res, 200, { ServerName: SERVER_NAME, Version: "10.10.7", ProductName: "Jellyfin Server", OperatingSystem: "Linux", OperatingSystemDisplayName: "Linux", Id: SERVER_ID, HasPendingRestart: false, IsShuttingDown: false, WebSocketPortNumber: 8096 });
  }
  if (lower === "/system/configuration") return json(res, 200, { ServerName: SERVER_NAME, UICulture: "en-US", EnableMetrics: false });
  if (lower === "/plugins") return json(res, 200, []);
  if (lower === "/scheduledtasks") return json(res, 200, scheduledTasks);
  if (lower === "/sessions") return json(res, 200, [...live.values()].map(sessionView));

  if (lower === "/users") return json(res, 200, data.users.map(({ persona, activity, remote, devices, ...u }) => u));
  let match = lower.match(/^\/users\/([0-9a-f]{32})$/);
  if (match) {
    const user = data.users.find((u) => u.Id === match[1]);
    if (!user) return json(res, 404, { error: "User not found" });
    const { persona, activity, remote, devices, ...u } = user;
    return json(res, 200, u);
  }
  match = lower.match(/^\/users\/([0-9a-f]{32})\/images\/primary$/);
  if (match) return image(res, `user:${match[1]}`, 160, 160);

  match = lower.match(/^\/users\/[0-9a-f]{32}\/items\/latest$/);
  if (match) {
    const parent = q.get("ParentId") || q.get("parentId");
    const limit = Number(q.get("Limit") || q.get("limit") || 20);
    const pool = data.items.filter((i) => (i.Type === "Movie" || i.Type === "Series") && (!parent || i.ParentId === parent));
    return json(res, 200, pool.sort(byDateCreated).slice(0, limit).map(publicItem));
  }
  if (/^\/users\/[0-9a-f]{32}\/items$/.test(lower)) return json(res, 200, { Items: [], TotalRecordCount: 0 });

  if (lower === "/library/mediafolders" || lower === "/library/virtualfolders") {
    return json(res, 200, { Items: data.libraries, TotalRecordCount: data.libraries.length });
  }

  if (lower === "/items") {
    const parent = q.get("ParentId") || q.get("parentId");
    const ids = (q.get("Ids") || q.get("ids") || "").split(",").filter(Boolean);
    let list = parent ? descendants(parent) : data.items;
    if (ids.length) list = list.filter((item) => ids.includes(item.Id));
    const types = (q.get("IncludeItemTypes") || q.get("includeItemTypes") || "").split(",").filter(Boolean);
    if (types.length) list = list.filter((item) => types.includes(item.Type));
    if (!parent && !ids.length && !types.length) list = list.filter((item) => item.Type === "Movie" || item.Type === "Series");
    return json(res, 200, page([...list].sort(byDateCreated), q));
  }

  match = lower.match(/^\/items\/([0-9a-f]{32})\/playbackinfo$/);
  if (match) {
    const item = data.byId.get(match[1]);
    return item ? json(res, 200, { MediaSources: item.MediaSources || [], PlaySessionId: hashId("play", match[1]) }) : json(res, 404, { error: "Item not found" });
  }

  match = lower.match(/^\/items\/([0-9a-f]{32})\/images\/(primary|backdrop|thumb|logo|banner)(?:\/\d+)?$/);
  if (match) {
    const wide = match[2] !== "primary";
    const fill = Math.min(1280, Math.max(60, Number(q.get("fillWidth") || q.get("maxWidth") || (wide ? 960 : 300))));
    return image(res, `${match[1]}:${match[2]}`, fill, Math.round(wide ? fill * 0.5625 : fill * 1.5));
  }

  match = lower.match(/^\/shows\/([0-9a-f]{32})\/seasons$/);
  if (match) {
    const show = data.byId.get(match[1]);
    return json(res, 200, { Items: (show?.seasons || []).map(publicItem), TotalRecordCount: show?.seasons?.length || 0 });
  }
  match = lower.match(/^\/shows\/([0-9a-f]{32})\/episodes$/);
  if (match) {
    const show = data.byId.get(match[1]);
    const seasonId = q.get("seasonId") || q.get("SeasonId");
    const episodes = (show?.seasons || []).filter((s) => !seasonId || s.Id === seasonId).flatMap((s) => s.episodes);
    return json(res, 200, { Items: episodes.map(publicItem), TotalRecordCount: episodes.length });
  }

  match = lower.match(/^\/items\/([0-9a-f]{32})$/);
  if (match) {
    const item = data.byId.get(match[1]);
    return item ? json(res, 200, publicItem(item)) : json(res, 404, { error: "Item not found" });
  }

  if (lower === "/health" || lower === "/") return json(res, 200, { ok: true, items: data.items.length, sessions: live.size });
  return json(res, 404, { error: `Not part of the demo server: ${path}` });
});

server.listen(PORT, "0.0.0.0", () => {
  const counts = data.items.reduce((acc, item) => ({ ...acc, [item.Type]: (acc[item.Type] || 0) + 1 }), {});
  console.log(`[mock-jellyfin] listening on :${PORT} · ${JSON.stringify(counts)} · ${data.users.length} users`);
});
