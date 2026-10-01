// Fake Sonarr, Radarr, Prowlarr, Bazarr, Jellyseerr, qBittorrent and SABnzbd for the demo.
// One handler serves all of them, picking the app from the request's Host header. Everything
// is derived from the demo library, so the calendar, requests and downloads match its titles.
import { hashId, rng } from "./dataset.mjs";
import { IMAGE_BASE } from "./tmdb.mjs";

const MIN = 60_000;
const DAY = 86_400_000;
const GB = 1024 ** 3;

export const ARR_HOSTS = ["sonarr", "radarr", "prowlarr", "bazarr", "jellyseerr", "qbittorrent", "sabnzbd"];

function json(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

const tmdbImage = (path, size) => (path ? `${IMAGE_BASE}/${size}${path}` : null);
const images = (posterPath, backdropPath) =>
  [posterPath && { coverType: "poster", remoteUrl: tmdbImage(posterPath, "w342") }, backdropPath && { coverType: "fanart", remoteUrl: tmdbImage(backdropPath, "w780") }].filter(Boolean);

// A download that loops through added → downloading → done, so the queue keeps moving.
function cycle(slot, lengthMin, now = Date.now()) {
  const length = lengthMin * MIN;
  const phase = Number.parseInt(hashId("phase", slot).slice(0, 6), 16) % length;
  const t = now + phase;
  return { round: Math.floor(t / length), progress: (t % length) / length, startedAt: now - (t % length) };
}

const releaseName = (title, extra) =>
  `${title.replace(/[^A-Za-z0-9 ]+/g, "").trim().replace(/\s+/g, ".")}.${extra}`;

export function createArrHandler(data) {
  const allEpisodes = data.series.flatMap((s) => s.seasons.flatMap((x) => x.episodes.map((e) => ({ ...e, series: s }))));
  const movies = data.items.filter((i) => i.Type === "Movie");
  const users = data.users;

  // ---- downloads (qBittorrent + SABnzbd) -------------------------------------------
  function downloadPool(r) {
    const upcoming = data.upcoming.episodes.slice(0, 20).map((u) => `${releaseName(u.show.title, `S${String(u.seasonNumber).padStart(2, "0")}E${String(u.episode.episodeNumber).padStart(2, "0")}.1080p.WEB-DL.DDP5.1.H.264`)}`);
    const recent = allEpisodes.slice(-40).map((e) => releaseName(e.series.Name, `S${String(e.ParentIndexNumber).padStart(2, "0")}E${String(e.IndexNumber).padStart(2, "0")}.1080p.WEB.H.264`));
    const films = movies.map((m) => releaseName(m.Name, `${m.ProductionYear}.2160p.UHD.BluRay.x265.HDR`));
    return [...upcoming, ...recent, ...films].filter(Boolean).sort(() => r() - 0.5);
  }
  const pool = downloadPool(rng(`${data.seed}:downloads`));
  const poolName = (slot, round) => pool[Number.parseInt(hashId(slot, round).slice(0, 6), 16) % pool.length];

  function torrents(now = Date.now()) {
    const list = [];
    const active = [
      { slot: "qb-1", minutes: 55, category: "tv-sonarr", size: 2.4 },
      { slot: "qb-2", minutes: 140, category: "radarr", size: 18.6 },
      { slot: "qb-3", minutes: 35, category: "tv-sonarr", size: 1.6 },
      { slot: "qb-4", minutes: 90, category: "radarr", size: 9.2 },
    ];
    for (const a of active) {
      const c = cycle(a.slot, a.minutes, now);
      const size = Math.round(a.size * GB);
      const progress = Math.min(1, c.progress * 1.15);
      const done = progress >= 1;
      list.push({
        hash: hashId(a.slot, c.round).slice(0, 40), name: poolName(a.slot, c.round), category: a.category, size, total_size: size,
        progress, downloaded: Math.round(size * progress), amount_left: Math.round(size * (1 - progress)),
        dlspeed: done ? 0 : Math.round((size / (a.minutes * 60)) * (0.8 + Math.random() * 0.4)), upspeed: done ? 120_000 : 40_000,
        state: done ? "uploading" : "downloading", num_seeds: 12 + (c.round % 30), num_leechs: 3 + (c.round % 7),
        added_on: Math.floor(c.startedAt / 1000), last_activity: Math.floor(now / 1000), eta: done ? 8640000 : Math.round(((1 - progress) * a.minutes * 60) / 1.15), ratio: done ? 0.4 : 0.05,
      });
    }
    // Stuck for hours with no peers: shows up as a stalled download and a threshold alert.
    const stuck = movies[Math.floor(movies.length / 3)];
    list.push({
      hash: hashId("qb-stuck").slice(0, 40), name: releaseName(stuck.Name, `${stuck.ProductionYear}.1080p.BluRay.x264`), category: "radarr",
      size: 9.8 * GB, total_size: 9.8 * GB, progress: 0.37, downloaded: Math.round(9.8 * GB * 0.37), amount_left: Math.round(9.8 * GB * 0.63), dlspeed: 0, upspeed: 0,
      state: "stalledDL", num_seeds: 0, num_leechs: 0, added_on: Math.floor((now - 9 * 3600_000) / 1000), last_activity: Math.floor((now - 3 * 3600_000) / 1000), eta: 8640000, ratio: 0,
    });
    list.push({
      hash: hashId("qb-paused").slice(0, 40), name: poolName("qb-paused", 1), category: "tv-sonarr", size: 3.1 * GB, total_size: 3.1 * GB, progress: 0.62,
      downloaded: Math.round(3.1 * GB * 0.62), amount_left: Math.round(3.1 * GB * 0.38), dlspeed: 0, upspeed: 0, state: "pausedDL", num_seeds: 5, num_leechs: 1,
      added_on: Math.floor((now - DAY) / 1000), last_activity: Math.floor((now - 20 * MIN) / 1000), eta: 8640000, ratio: 0,
    });
    list.push({
      hash: hashId("qb-queued").slice(0, 40), name: poolName("qb-queued", 1), category: "radarr", size: 14.2 * GB, total_size: 14.2 * GB, progress: 0,
      downloaded: 0, amount_left: 14.2 * GB, dlspeed: 0, upspeed: 0, state: "queuedDL", num_seeds: 40, num_leechs: 2, added_on: Math.floor((now - 5 * MIN) / 1000), last_activity: 0, eta: 8640000, ratio: 0,
    });
    return list;
  }

  function sabSlots(now = Date.now()) {
    return [
      { slot: "sab-1", minutes: 25, cat: "tv", mb: 2100 },
      { slot: "sab-2", minutes: 70, cat: "movies", mb: 11800 },
      { slot: "sab-3", minutes: 45, cat: "tv", mb: 3400 },
    ].map((s, index) => {
      const c = cycle(s.slot, s.minutes, now);
      const queued = index === 2 && c.progress < 0.35;
      const progress = queued ? 0 : c.progress;
      const left = Math.round(s.mb * (1 - progress));
      const secondsLeft = Math.round((1 - progress) * s.minutes * 60);
      return {
        nzo_id: `SABnzbd_nzo_${hashId(s.slot, c.round).slice(0, 10)}`, filename: poolName(s.slot, c.round), cat: s.cat, mb: String(s.mb), mbleft: String(left),
        percentage: String(Math.round(progress * 100)), status: queued ? "Queued" : "Downloading",
        timeleft: `${Math.floor(secondsLeft / 3600)}:${String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`,
        kbpersec: queued ? 0 : Math.round((s.mb * 1024) / (s.minutes * 60)), time_added: Math.floor(c.startedAt / 1000), priority: "Normal",
      };
    });
  }

  // ---- calendar ---------------------------------------------------------------------
  function sonarrCalendar(start, end) {
    return data.upcoming.episodes
      .map((u, index) => ({ u, airDate: new Date(`${u.episode.airDate || ""}T20:00:00Z`), index }))
      .filter(({ airDate }) => !Number.isNaN(airDate.getTime()) && airDate >= start && airDate <= end)
      .map(({ u, airDate, index }) => ({
        id: 9000 + index, seriesId: 100 + data.series.indexOf(u.series), episodeFileId: 0, seasonNumber: u.seasonNumber, episodeNumber: u.episode.episodeNumber,
        title: u.episode.name, airDate: airDate.toISOString().slice(0, 10), airDateUtc: airDate.toISOString(), overview: u.episode.overview || "", hasFile: false, monitored: true,
        series: { id: 100 + data.series.indexOf(u.series), title: u.show.title, overview: u.show.overview || "", tvdbId: 0, tmdbId: u.show.tmdbId || 0, status: "continuing", images: images(u.show.posterPath, u.show.backdropPath) },
      }));
  }

  function radarrCalendar(start, end) {
    return data.upcoming.movies
      .map((m, index) => ({ m, date: new Date(`${m.releaseDate}T00:00:00Z`), index }))
      .filter(({ date }) => !Number.isNaN(date.getTime()) && date >= start && date <= end)
      .map(({ m, date, index }) => ({
        // JellyGlance treats a release as a film when it has a TMDB id; generated titles get a stand-in.
        id: 500 + index, title: m.title, tmdbId: m.tmdbId || 900_000 + index, year: date.getUTCFullYear(), overview: m.overview || "", hasFile: false, monitored: true,
        inCinemas: date.toISOString(), digitalRelease: new Date(date.getTime() + 45 * DAY).toISOString(), images: images(m.posterPath, m.backdropPath),
        genres: m.genres || [], status: "announced",
      }));
  }

  // ---- Jellyseerr ---------------------------------------------------------------------
  const seerrUsers = users.map((u, index) => ({
    id: index + 1, displayName: u.Name, username: u.Name.toLowerCase(), jellyfinUsername: u.Name, jellyfinUserId: u.Id, email: `${u.Name.toLowerCase()}@demo.local`,
    avatar: "", userType: 3, permissions: index === 0 ? 2 : 32, requestCount: 0, createdAt: new Date(Date.now() - 300 * DAY).toISOString(),
  }));
  const requestSources = [
    ...data.upcoming.movies.slice(0, 10).map((m) => ({ kind: "movie", tmdbId: m.tmdbId, title: m.title, posterPath: m.posterPath, backdropPath: m.backdropPath, overview: m.overview, releaseDate: m.releaseDate, genres: m.genres, voteAverage: m.voteAverage, runtime: m.runtime })),
    ...data.series.slice(-8).map((s) => ({ kind: "tv", tmdbId: s.tmdb?.id, title: s.Name, posterPath: s.tmdb?.posterPath, backdropPath: s.tmdb?.backdropPath, overview: s.Overview, releaseDate: s.PremiereDate?.slice(0, 10), genres: s.Genres, voteAverage: s.CommunityRating, seasons: s.seasons.length })),
    ...movies.slice(0, 10).map((m) => ({ kind: "movie", tmdbId: m.tmdb?.id, title: m.Name, posterPath: m.tmdb?.posterPath, backdropPath: m.tmdb?.backdropPath, overview: m.Overview, releaseDate: m.PremiereDate?.slice(0, 10), genres: m.Genres, voteAverage: m.CommunityRating, runtime: Math.round(m.RunTimeTicks / 600_000_000), available: true })),
  ];
  const requests = requestSources.map((src, index) => {
    const r = rng(`${data.seed}:request:${index}`);
    const status = src.available ? 5 : index % 7 === 3 ? 3 : index % 3 === 0 ? 1 : 2;
    const created = new Date(Date.now() - Math.floor(r() * 40 * DAY));
    return {
      id: index + 1, status, type: src.kind, createdAt: created.toISOString(), updatedAt: new Date(created.getTime() + 3 * 3600_000).toISOString(), is4k: false,
      requestedBy: seerrUsers[1 + Math.floor(r() * (seerrUsers.length - 1))], modifiedBy: status === 1 ? null : seerrUsers[0],
      seasons: src.kind === "tv" ? Array.from({ length: Math.min(2, src.seasons || 1) }, (_, i) => ({ id: index * 10 + i, seasonNumber: i + 1, status })) : [],
      media: { id: 700 + index, mediaType: src.kind, tmdbId: src.tmdbId || 1000 + index, status: status === 5 ? 5 : status === 2 ? 3 : 2, posterPath: src.posterPath, backdropPath: src.backdropPath, title: src.title },
      _src: src,
    };
  });
  const publicRequest = ({ _src, ...rest }) => rest;
  const mediaDetails = (kind, tmdbId) => {
    const src = requestSources.find((s) => String(s.tmdbId) === String(tmdbId) && s.kind === kind);
    if (!src) return null;
    return {
      id: Number(tmdbId), [kind === "movie" ? "title" : "name"]: src.title, overview: src.overview || "", posterPath: src.posterPath, backdropPath: src.backdropPath,
      [kind === "movie" ? "releaseDate" : "firstAirDate"]: src.releaseDate || "", runtime: src.runtime || null, voteAverage: src.voteAverage || null,
      genres: (src.genres || []).map((name, id) => ({ id, name })), credits: { cast: [] }, mediaInfo: null,
    };
  };
  const issues = [
    { problemType: 1, message: "The subtitles drift out of sync about halfway through." },
    { problemType: 2, message: "No audio on the second half of this episode." },
    { problemType: 3, message: "Video stutters badly on the TV app." },
  ].map((p, index) => {
    const ep = allEpisodes[(index + 1) * 37 % allEpisodes.length];
    const user = seerrUsers[2 + index];
    const created = new Date(Date.now() - (index + 1) * 2 * DAY).toISOString();
    return {
      id: index + 1, issueType: p.problemType, status: index === 2 ? 2 : 1, problemSeason: ep.ParentIndexNumber, problemEpisode: ep.IndexNumber, createdAt: created, updatedAt: created,
      createdBy: user, mediaTitle: ep.SeriesName, mediaType: "tv", tmdbId: ep.series.tmdb?.id || 0,
      media: { id: 800 + index, mediaType: "tv", tmdbId: ep.series.tmdb?.id || 0, posterPath: ep.series.tmdb?.posterPath, title: ep.SeriesName },
      comments: [{ id: index + 1, message: p.message, createdAt: created, user }],
    };
  });

  // ---- disks, indexers, subtitles ------------------------------------------------------
  const disks = (label) => [
    { path: "/media", label: "Media", freeSpace: Math.round(3.1 * 1024 * GB), totalSpace: Math.round(24 * 1024 * GB) },
    // Nearly full on purpose so the low-disk alert has something to say.
    { path: "/downloads", label: "Downloads", freeSpace: Math.round(41 * GB), totalSpace: Math.round(900 * GB) },
    { path: "/config", label: label, freeSpace: Math.round(180 * GB), totalSpace: Math.round(240 * GB) },
  ];
  const indexers = ["Lighthouse Usenet", "Harbor Index", "Northern Torrents", "Meridian NZB", "Atlas Trackers", "Comet Public"].map((name, index) => ({
    id: index + 1, name, enable: index !== 5, protocol: index % 2 ? "torrent" : "usenet", priority: 25, implementation: "Newznab",
  }));
  const indexerStatus = [{ id: 1, indexerId: 3, mostRecentFailure: new Date(Date.now() - 2 * 3600_000).toISOString(), initialFailure: new Date(Date.now() - 6 * 3600_000).toISOString(), disabledTill: new Date(Date.now() + 3600_000).toISOString() }];

  const subtitleWanted = (kind) =>
    (kind === "episodes" ? allEpisodes.slice(5, 14) : movies.slice(20, 26)).map((item, index) => ({
      id: index + 1, title: item.Name, seriesTitle: kind === "episodes" ? item.SeriesName : undefined, episodeTitle: kind === "episodes" ? item.Name : undefined,
      sonarrEpisodeId: kind === "episodes" ? 3000 + index : undefined, radarrId: kind === "movies" ? 4000 + index : undefined,
      missing_subtitles: [{ name: index % 3 ? "Spanish" : "English", code2: index % 3 ? "es" : "en" }], language: index % 3 ? "Spanish" : "English",
    }));
  const subtitleHistory = allEpisodes.slice(20, 32).map((ep, index) => ({
    id: index + 1, title: `${ep.SeriesName} ${`S${String(ep.ParentIndexNumber).padStart(2, "0")}E${String(ep.IndexNumber).padStart(2, "0")}`}`,
    language: index % 4 ? "English" : "French", action: index % 5 ? "Downloaded" : "Upgraded", provider: ["opensubtitles", "podnapisi", "subdl"][index % 3],
    timestamp: new Date(Date.now() - index * 5 * 3600_000).toISOString(),
  }));

  // ---- router --------------------------------------------------------------------------
  return function handle(req, res, url, body) {
    const app = String(req.headers.host || "").split(":")[0].toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = url.searchParams;
    const method = req.method || "GET";
    const now = Date.now();
    const start = new Date(q.get("start") || now);
    const end = new Date(q.get("end") || now + 90 * DAY);

    if (path === "/") return json(res, 200, { app, demo: true });

    if (app === "sonarr" || app === "radarr") {
      const isSonarr = app === "sonarr";
      if (path === "/api/v3/system/status") return json(res, 200, { appName: isSonarr ? "Sonarr" : "Radarr", version: isSonarr ? "4.0.10.2544" : "5.14.0.9383", startTime: new Date(now - 6 * DAY).toISOString() });
      if (path === "/api/v3/calendar") return json(res, 200, isSonarr ? sonarrCalendar(start, end) : radarrCalendar(start, end));
      if (path === "/api/v3/diskspace") return json(res, 200, disks(isSonarr ? "Sonarr config" : "Radarr config"));
      if (path === "/api/v3/health") return json(res, 200, []);
      if (path === "/api/v3/queue") return json(res, 200, { page: 1, pageSize: 50, totalRecords: 0, records: [] });
      if (path === "/api/v3/series" || path === "/api/v3/movie") return json(res, 200, []);
      if (method !== "GET") return json(res, 200, {});
      return json(res, 200, []);
    }

    if (app === "prowlarr") {
      if (path === "/api/v1/system/status") return json(res, 200, { appName: "Prowlarr", version: "1.26.1.4844" });
      if (path === "/api/v1/health") return json(res, 200, [{ source: "IndexerStatusCheck", type: "warning", message: "Indexers unavailable due to failures: Northern Torrents" }]);
      if (path === "/api/v1/indexer") return json(res, 200, indexers);
      if (path === "/api/v1/indexerstatus") return json(res, 200, indexerStatus);
      if (path === "/api/v1/applications") return json(res, 200, [{ id: 1, name: "Sonarr", syncLevel: "fullSync" }, { id: 2, name: "Radarr", syncLevel: "fullSync" }]);
      return json(res, 200, []);
    }

    if (app === "bazarr") {
      if (path === "/api/system/status") return json(res, 200, { version: "1.4.5", data: { bazarr_version: "1.4.5" } });
      if (path === "/api/system/health") return json(res, 200, { data: [] });
      if (path === "/api/episodes/wanted") return json(res, 200, { data: subtitleWanted("episodes"), total: 9 });
      if (path === "/api/movies/wanted") return json(res, 200, { data: subtitleWanted("movies"), total: 6 });
      if (path === "/api/history") return json(res, 200, { data: subtitleHistory, total: subtitleHistory.length });
      return json(res, 200, { data: [] });
    }

    if (app === "jellyseerr") {
      if (path === "/api/v1/status") return json(res, 200, { version: "2.5.2", commitTag: "v2.5.2", updateAvailable: false });
      if (path === "/api/v1/request") {
        const take = Number(q.get("take") || 20);
        const skip = Number(q.get("skip") || 0);
        const list = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json(res, 200, { pageInfo: { pages: Math.ceil(list.length / take), pageSize: take, results: list.length, page: Math.floor(skip / take) + 1 }, results: list.slice(skip, skip + take).map(publicRequest) });
      }
      if (path === "/api/v1/request/count") {
        const count = (s) => requests.filter((r) => r.status === s).length;
        return json(res, 200, { total: requests.length, movie: requests.filter((r) => r.type === "movie").length, tv: requests.filter((r) => r.type === "tv").length, pending: count(1), approved: count(2), declined: count(3), processing: count(2), available: count(5) });
      }
      let m = path.match(/^\/api\/v1\/request\/(\d+)$/);
      if (m) {
        const found = requests.find((r) => String(r.id) === m[1]);
        return found ? json(res, 200, publicRequest(found)) : json(res, 404, { message: "Request not found" });
      }
      if (path === "/api/v1/issue") return json(res, 200, { pageInfo: { pages: 1, pageSize: 40, results: issues.length, page: 1 }, results: issues });
      if (path === "/api/v1/issue/count") return json(res, 200, { total: issues.length, open: issues.filter((i) => i.status === 1).length, closed: issues.filter((i) => i.status === 2).length });
      m = path.match(/^\/api\/v1\/(movie|tv)\/(\d+)(\/ratings(combined)?)?$/);
      if (m) {
        if (m[3]) return json(res, 200, {});
        const details = mediaDetails(m[1], m[2]);
        return details ? json(res, 200, details) : json(res, 404, { message: "Not found" });
      }
      if (path === "/api/v1/user") return json(res, 200, { pageInfo: { pages: 1, pageSize: 50, results: seerrUsers.length, page: 1 }, results: seerrUsers });
      if (path === "/api/v1/user/me") return json(res, 200, seerrUsers[0]);
      if (path === "/api/v1/search") return json(res, 200, { page: 1, totalPages: 1, totalResults: 0, results: [] });
      if (method !== "GET") return json(res, 200, {});
      return json(res, 404, { message: "Not part of the demo" });
    }

    if (app === "qbittorrent") {
      if (path === "/api/v2/auth/login") return json(res, 200, "Ok.", { "Set-Cookie": "SID=demo-session; HttpOnly; path=/" });
      if (path === "/api/v2/app/version") return json(res, 200, "v5.0.3");
      if (path === "/api/v2/app/webapiVersion") return json(res, 200, "2.11.2");
      if (path === "/api/v2/torrents/info") return json(res, 200, torrents(now));
      if (path === "/api/v2/transfer/info") return json(res, 200, { dl_info_speed: torrents(now).reduce((s, t) => s + t.dlspeed, 0), up_info_speed: 160_000, connection_status: "connected" });
      return json(res, 200, "Ok.");
    }

    if (app === "sabnzbd") {
      const mode = q.get("mode");
      if (mode === "version") return json(res, 200, { version: "4.4.1" });
      if (mode === "queue") {
        const slots = sabSlots(now);
        const speed = slots.reduce((s, x) => s + Number(x.kbpersec), 0);
        return json(res, 200, { queue: { status: speed ? "Downloading" : "Idle", paused: false, kbpersec: String(speed), speed: `${(speed / 1024).toFixed(1)} M`, noofslots: slots.length, slots, diskspace1: "41.0", diskspacetotal1: "900.0" } });
      }
      if (mode === "history") return json(res, 200, { history: { slots: [], noofslots: 0 } });
      return json(res, 200, { status: true });
    }

    return json(res, 404, { error: `Unknown demo app: ${app}` });
  };
}
