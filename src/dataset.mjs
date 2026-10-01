// The demo library. A catalogue (real TMDB titles, or generated ones when there is no TMDB key)
// is turned into Jellyfin-shaped libraries, items and users. The same seed always gives the
// same IDs, so the mock services and the history seeder agree without sharing state.
import { createHash } from "node:crypto";

export const SERVER_ID = "d3m0d3m0d3m0d3m0d3m0d3m0d3m0d3m0";
export const SERVER_NAME = "Glance Demo Server";
const TICKS = 10_000_000;
const DAY = 86_400_000;

export function hashId(...parts) {
  return createHash("md5").update(parts.join(":")).digest("hex");
}

export function rng(seed) {
  let a = typeof seed === "number" ? seed : Number.parseInt(hashId(seed).slice(0, 8), 16);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, min, max) => min + Math.floor(r() * (max - min + 1));

const CLIENTS = [
  { Client: "Jellyfin Web", DeviceName: "Firefox", ApplicationVersion: "10.10.7" },
  { Client: "Jellyfin Web", DeviceName: "Chrome", ApplicationVersion: "10.10.7" },
  { Client: "Jellyfin Android TV", DeviceName: "Living Room TV", ApplicationVersion: "0.17.4" },
  { Client: "Jellyfin Android", DeviceName: "Pixel 8", ApplicationVersion: "2.6.2" },
  { Client: "Swiftfin", DeviceName: "iPhone", ApplicationVersion: "1.3.0" },
  { Client: "Infuse", DeviceName: "Apple TV", ApplicationVersion: "8.0.8" },
  { Client: "Findroid", DeviceName: "Galaxy Tab", ApplicationVersion: "0.15.0" },
  { Client: "Kodi", DeviceName: "Bedroom Shield", ApplicationVersion: "0.7.12" },
];
const FIRST_NAMES = ["Sam", "Alex", "Priya", "Jordan", "Mia", "Leo", "Hannah", "Theo", "Zara", "Owen", "Isla", "Noah", "Freya", "Kai"];
const PERSONAS = ["binger", "movie-buff", "casual", "night-owl", "weekend", "kids", "docs"];

// ---- generated catalogue (no TMDB key) ------------------------------------------

const ADJ = ["Quiet", "Last", "Silver", "Hollow", "Northern", "Crimson", "Paper", "Glass", "Distant", "Burning", "Lost", "Midnight", "Iron", "Golden", "Broken", "Wild", "Velvet", "Salt", "Electric", "Winter", "Hidden", "Long", "Little", "Painted", "Restless", "Copper", "Silent", "Faded", "Bright", "Lonely"];
const NOUN = ["Harbor", "Orchard", "Signal", "Frontier", "Lantern", "Tide", "Garden", "Station", "Archive", "Meridian", "Canyon", "Engine", "Mirror", "Kingdom", "Atlas", "Harvest", "Lighthouse", "Comet", "Valley", "Circuit", "Parade", "Monsoon", "Telegraph", "Carousel", "Observatory", "Ferry", "Workshop", "Summit", "Labyrinth", "Avenue"];
const SHOW_WORDS = ["Station", "Precinct", "Crew", "House", "Department", "Signal", "District", "Academy", "Expedition", "Files", "Colony", "Hotel", "Circus", "Garage", "Bureau"];
const GENRES = ["Drama", "Comedy", "Thriller", "Science Fiction", "Adventure", "Mystery", "Animation", "Romance", "Crime", "Fantasy", "Horror", "Family", "Action", "History"];
const DOC_TOPICS = ["Deep Ocean", "Night Trains", "The Bee Year", "Mountain Weather", "City Foxes", "Glaciers", "Old Bridges", "Coral Cities", "Desert Light", "The Lost Railway", "Lighthouses of the North", "Clockmakers", "Islands of Wind", "Monarch Migration", "Volcano Season"];

export function generatedCatalog(seed = "jellyglance-demo") {
  const r = rng(`${seed}:catalog`);
  const used = new Set();
  const unique = (make) => {
    let candidate = make();
    for (let i = 0; used.has(candidate); i += 1) candidate = i < 20 ? make() : `${make()} ${i - 18}`;
    used.add(candidate);
    return candidate;
  };
  const title = () => (r() < 0.5 ? `The ${pick(r, ADJ)} ${pick(r, NOUN)}` : `${pick(r, ADJ)} ${pick(r, NOUN)}`);
  const date = (from, to) => {
    const y = between(r, from, to);
    return `${y}-${String(between(r, 1, 12)).padStart(2, "0")}-${String(between(r, 1, 28)).padStart(2, "0")}`;
  };
  const movie = (doc) => ({
    tmdbId: null, title: unique(() => (doc ? pick(r, DOC_TOPICS) : title())), overview: "", releaseDate: date(doc ? 2005 : 1975, 2025),
    runtime: doc ? between(r, 50, 110) : between(r, 85, 165), genres: doc ? ["Documentary"] : Array.from(new Set([pick(r, GENRES), pick(r, GENRES)])),
    voteAverage: Math.round((5 + r() * 4) * 10) / 10,
  });
  const today = Date.now();
  const shows = Array.from({ length: 46 }, (_, s) => {
    const seasonCount = Math.max(1, Math.min(5, Math.round(r() ** 1.4 * 5)));
    const continuing = r() < 0.4;
    const runtime = pick(r, [24, 28, 42, 45, 52, 58]);
    const firstYear = between(r, 2010, 2023);
    return {
      tmdbId: null, title: unique(() => `${pick(r, ADJ)} ${pick(r, SHOW_WORDS)}`), overview: "", firstAirDate: `${firstYear}-09-01`,
      status: continuing ? "Returning Series" : "Ended", inProduction: continuing, genres: [pick(r, GENRES)], voteAverage: Math.round((6 + r() * 3) * 10) / 10, runtime,
      seasons: Array.from({ length: seasonCount }, (_, i) => {
        const n = i + 1;
        const isLatestUpcoming = continuing && n === seasonCount && s % 3 === 0;
        return {
          seasonNumber: n, name: `Season ${n}`,
          episodes: Array.from({ length: between(r, 6, 10) }, (_, e) => ({
            episodeNumber: e + 1, name: pick(r, ["Pilot", "The Arrival", "Crossing", "Low Tide", "The Long Night", "Static", "Homecoming", "Small Hours", "Fault Lines", "The Offer"]),
            airDate: isLatestUpcoming
              ? new Date(today + (e - 2) * 7 * DAY).toISOString().slice(0, 10)
              : `${Math.min(2025, firstYear + i)}-${String(Math.min(12, 9 + Math.floor(e / 4))).padStart(2, "0")}-${String(between(r, 1, 28)).padStart(2, "0")}`,
            runtime: runtime + between(r, -3, 4), overview: "", voteAverage: Math.round((6 + r() * 3.5) * 10) / 10,
          })),
        };
      }),
    };
  });
  const upcoming = Array.from({ length: 12 }, (_, i) => ({ ...movie(false), releaseDate: new Date(today + (i * 6 + 2) * DAY).toISOString().slice(0, 10) }));
  return { fetchedAt: new Date().toISOString(), generated: true, movies: Array.from({ length: 300 }, () => movie(false)), docs: Array.from({ length: 40 }, () => movie(true)), upcoming, shows };
}

// ---- catalogue → Jellyfin-shaped dataset ------------------------------------------

function imageTag(id) {
  return hashId("tag", id).slice(0, 16);
}

function mediaSource(r, id, name, runtimeTicks, path) {
  const uhd = r() < 0.15;
  const hd = !uhd && r() < 0.65;
  const height = uhd ? 2160 : hd ? 1080 : 720;
  const codec = uhd || r() < 0.3 ? "hevc" : "h264";
  const bitrate = (uhd ? between(r, 18, 40) : hd ? between(r, 6, 14) : between(r, 2, 5)) * 1_000_000;
  return {
    Id: id, Name: name, Path: path, Container: r() < 0.75 ? "mkv" : "mp4", Size: Math.round((bitrate / 8) * (runtimeTicks / TICKS)), Bitrate: bitrate, RunTimeTicks: runtimeTicks,
    MediaStreams: [
      { Type: "Video", Codec: codec, Height: height, Width: Math.round((height * 16) / 9), BitRate: bitrate - 640_000, Index: 0, IsDefault: true },
      { Type: "Audio", Codec: r() < 0.6 ? "eac3" : "aac", Channels: r() < 0.5 ? 6 : 2, BitRate: 640_000, Language: "eng", Index: 1, IsDefault: true },
      ...(r() < 0.7 ? [{ Type: "Subtitle", Codec: "subrip", Language: "eng", Index: 2, IsExternal: false }] : []),
    ],
  };
}

const safe = (value) => String(value).replace(/[\\/:*?"<>|]/g, "");
const isoDay = (value, fallback) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(0, 10)}T00:00:00.0000000Z` : fallback);

export function buildDataset(seed = "jellyglance-demo", catalog = generatedCatalog(seed)) {
  const r = rng(seed);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const libraries = [
    { Id: hashId(seed, "lib", "movies"), Name: "Movies", CollectionType: "movies" },
    { Id: hashId(seed, "lib", "tv"), Name: "TV Shows", CollectionType: "tvshows" },
    { Id: hashId(seed, "lib", "docs"), Name: "Documentaries", CollectionType: "movies" },
  ].map((lib) => ({ ...lib, Type: "CollectionFolder", IsFolder: true, ServerId: SERVER_ID, ImageTags: { Primary: imageTag(lib.Id) } }));
  const addedAt = () => new Date(now - Math.floor(r() ** 1.6 * 730 * DAY)).toISOString();
  const items = [];

  const addMovie = (m, library, key) => {
    const Id = hashId(seed, key, m.tmdbId ?? m.title);
    const year = Number(String(m.releaseDate).slice(0, 4)) || 2015;
    const RunTimeTicks = (m.runtime || 100) * 60 * TICKS;
    items.push({
      Id, Name: m.title, Type: "Movie", IsFolder: false, ServerId: SERVER_ID, ParentId: library.Id, LibraryId: library.Id,
      ProductionYear: year, PremiereDate: isoDay(m.releaseDate, `${year}-01-01T00:00:00.0000000Z`), DateCreated: addedAt(), RunTimeTicks,
      Overview: m.overview || "", CommunityRating: Math.round((m.voteAverage || 7) * 10) / 10, OfficialRating: pick(r, ["PG", "12A", "15", "18"]),
      Genres: (m.genres || []).slice(0, 3), ProviderIds: m.tmdbId ? { Tmdb: String(m.tmdbId) } : {},
      ImageTags: { Primary: imageTag(Id) }, BackdropImageTags: [imageTag(`${Id}b`)], ImageBlurHashes: {}, LocationType: "FileSystem",
      MediaSources: [mediaSource(r, Id, m.title, RunTimeTicks, `/media/${library.Name.toLowerCase()}/${safe(m.title)} (${year})/${safe(m.title)}.mkv`)],
      tmdb: { id: m.tmdbId, posterPath: m.posterPath || null, backdropPath: m.backdropPath || null },
    });
  };
  catalog.movies.forEach((m) => addMovie(m, libraries[0], "movie"));
  catalog.docs.forEach((m) => addMovie(m, libraries[2], "doc"));

  const series = [];
  const upcomingEpisodes = [];
  for (const show of catalog.shows) {
    const SeriesId = hashId(seed, "series", show.tmdbId ?? show.title);
    const added = addedAt();
    const firstYear = Number(String(show.firstAirDate).slice(0, 4)) || 2015;
    const entry = {
      Id: SeriesId, Name: show.title, Type: "Series", IsFolder: true, ServerId: SERVER_ID, ParentId: libraries[1].Id, LibraryId: libraries[1].Id,
      ProductionYear: firstYear, PremiereDate: isoDay(show.firstAirDate, `${firstYear}-01-01T00:00:00.0000000Z`), DateCreated: added,
      Status: show.inProduction ? "Continuing" : "Ended", EndDate: show.inProduction ? null : isoDay(show.lastAirDate, null),
      Overview: show.overview || "", CommunityRating: Math.round((show.voteAverage || 7.5) * 10) / 10, OfficialRating: pick(r, ["12", "15", "TV-14", "TV-MA"]),
      Genres: (show.genres || []).slice(0, 3), RunTimeTicks: (show.runtime || 45) * 60 * TICKS, ProviderIds: show.tmdbId ? { Tmdb: String(show.tmdbId) } : {},
      ImageTags: { Primary: imageTag(SeriesId) }, BackdropImageTags: [imageTag(`${SeriesId}b`)], ImageBlurHashes: {}, LocationType: "FileSystem",
      tmdb: { id: show.tmdbId, posterPath: show.posterPath || null, backdropPath: show.backdropPath || null }, seasons: [],
    };
    for (const s of show.seasons) {
      const aired = s.episodes.filter((e) => e.airDate && e.airDate <= today);
      const future = s.episodes.filter((e) => !e.airDate || e.airDate > today);
      future.forEach((e) => upcomingEpisodes.push({ series: entry, show, seasonNumber: s.seasonNumber, episode: e }));
      if (!aired.length) continue;
      const SeasonId = hashId(seed, "season", show.tmdbId ?? show.title, s.seasonNumber);
      const season = {
        Id: SeasonId, Name: s.name || `Season ${s.seasonNumber}`, Type: "Season", IndexNumber: s.seasonNumber, IsFolder: true, ServerId: SERVER_ID,
        SeriesId, SeriesName: show.title, SeriesPrimaryImageTag: entry.ImageTags.Primary, ParentBackdropItemId: SeriesId, ParentBackdropImageTags: entry.BackdropImageTags,
        ParentLogoItemId: SeriesId, ParentId: libraries[1].Id, LibraryId: libraries[1].Id, DateCreated: added, ImageTags: { Primary: imageTag(SeasonId) },
        LocationType: "FileSystem", tmdb: { id: show.tmdbId, posterPath: s.posterPath || show.posterPath || null }, episodes: [],
      };
      entry.seasons.push(season);
      for (const e of aired) {
        const Id = hashId(seed, "episode", show.tmdbId ?? show.title, s.seasonNumber, e.episodeNumber);
        const RunTimeTicks = (e.runtime || show.runtime || 45) * 60 * TICKS;
        const year = Number(String(e.airDate).slice(0, 4)) || firstYear;
        const code = `S${String(s.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`;
        const episode = {
          Id, Name: e.name, Type: "Episode", IndexNumber: e.episodeNumber, ParentIndexNumber: s.seasonNumber, IsFolder: false, ServerId: SERVER_ID,
          SeasonId, SeasonName: season.Name, SeriesId, SeriesName: show.title, ParentBackdropItemId: SeriesId, ParentBackdropImageTags: entry.BackdropImageTags,
          ParentLogoItemId: SeriesId, ParentId: libraries[1].Id, LibraryId: libraries[1].Id, ProductionYear: year, PremiereDate: isoDay(e.airDate, null),
          DateCreated: added, RunTimeTicks, Overview: e.overview || "", CommunityRating: Math.round((e.voteAverage || 7.5) * 10) / 10, OfficialRating: entry.OfficialRating,
          ImageTags: { Primary: imageTag(Id) }, ImageBlurHashes: {}, LocationType: "FileSystem",
          MediaSources: [mediaSource(r, Id, e.name, RunTimeTicks, `/media/tv/${safe(show.title)}/Season ${s.seasonNumber}/${safe(show.title)} - ${code}.mkv`)],
          tmdb: { id: show.tmdbId, posterPath: e.stillPath || null, fallbackPosterPath: show.posterPath || null },
        };
        season.episodes.push(episode);
      }
    }
    if (!entry.seasons.length) continue;
    items.push(entry, ...entry.seasons, ...entry.seasons.flatMap((x) => x.episodes));
    series.push(entry);
  }

  const users = FIRST_NAMES.map((name, index) => {
    const Id = hashId(seed, "user", name);
    const ur = rng(`${seed}:${name}`);
    const devices = Array.from({ length: between(ur, 1, 3) }, () => pick(ur, CLIENTS)).map((c, d) => ({ ...c, DeviceId: hashId(seed, name, "device", d) }));
    return {
      Id, Name: name, ServerId: SERVER_ID, HasPassword: true, PrimaryImageTag: imageTag(Id),
      Policy: { IsAdministrator: index === 0, IsDisabled: false, EnableRemoteAccess: true },
      persona: index === 0 ? "binger" : PERSONAS[index % PERSONAS.length], activity: index < 4 ? 0.85 : index < 9 ? 0.5 : 0.25,
      remote: ur() < 0.35, devices,
      LastActivityDate: new Date(now - Math.floor(ur() * 3 * DAY)).toISOString(), LastLoginDate: new Date(now - Math.floor(ur() * 10 * DAY)).toISOString(),
    };
  });

  const upcoming = {
    episodes: upcomingEpisodes.sort((a, b) => String(a.episode.airDate).localeCompare(String(b.episode.airDate))),
    movies: (catalog.upcoming || []).map((m) => ({ ...m, id: hashId(seed, "upcoming", m.tmdbId ?? m.title) })),
  };
  const byId = new Map(items.map((item) => [item.Id, item]));
  return { seed, source: catalog.generated ? "generated" : "tmdb", libraries, items, series, users, byId, upcoming };
}

// Strip internal helper fields before sending an item over the mock Jellyfin API.
export function publicItem(item) {
  if (!item) return item;
  const { seasons, episodes, LibraryId, tmdb, ...rest } = item;
  return rest;
}

// What the seeder needs: ids, runtimes, relations and users (no artwork or media details).
export function seederView(data) {
  return {
    seed: data.seed,
    libraries: data.libraries.map(({ Id, Name }) => ({ Id, Name })),
    items: data.items
      .filter((i) => i.Type === "Movie" || i.Type === "Episode")
      .map((i) => ({ Id: i.Id, Name: i.Name, Type: i.Type, LibraryId: i.LibraryId, RunTimeTicks: i.RunTimeTicks, Genres: i.Genres || [], SeriesId: i.SeriesId, SeriesName: i.SeriesName, SeasonId: i.SeasonId, MediaSources: i.MediaSources })),
    series: data.series.map((s) => ({ Id: s.Id, seasons: s.seasons.map((x) => ({ Id: x.Id, episodes: x.episodes.map((e) => e.Id) })) })),
    users: data.users,
  };
}

export const constants = { TICKS, DAY, CLIENTS };
