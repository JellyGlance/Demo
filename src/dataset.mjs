// Deterministic demo library: the same seed always produces the same users, titles and IDs,
// so the mock media server and the history seeder agree without sharing state.
import { createHash } from "node:crypto";

export const SERVER_ID = "d3m0d3m0d3m0d3m0d3m0d3m0d3m0d3m0";
export const SERVER_NAME = "Glance Demo Server";

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
const TICKS = 10_000_000;
const DAY = 86_400_000;

const ADJ = ["Quiet", "Last", "Silver", "Hollow", "Northern", "Crimson", "Paper", "Glass", "Distant", "Burning", "Lost", "Midnight", "Iron", "Golden", "Broken", "Wild", "Velvet", "Salt", "Electric", "Winter", "Hidden", "Long", "Little", "Painted", "Restless", "Copper", "Silent", "Faded", "Bright", "Lonely"];
const NOUN = ["Harbor", "Orchard", "Signal", "Frontier", "Lantern", "Tide", "Garden", "Station", "Archive", "Meridian", "Canyon", "Engine", "Mirror", "Kingdom", "Atlas", "Harvest", "Lighthouse", "Comet", "Valley", "Circuit", "Parade", "Monsoon", "Telegraph", "Carousel", "Observatory", "Ferry", "Workshop", "Summit", "Labyrinth", "Avenue"];
const PLACE = ["Port Ellery", "the Low Hills", "Saint Brenna", "Calder Bay", "the Outer Ring", "Marrow Street", "New Aldine", "the Salt Flats", "Fenwick", "the North Line"];
const SHOW_WORDS = ["Station", "Precinct", "Crew", "House", "Department", "Signal", "District", "Academy", "Expedition", "Files", "Colony", "Hotel", "Circus", "Garage", "Bureau"];
const GENRES = ["Drama", "Comedy", "Thriller", "Science Fiction", "Adventure", "Mystery", "Animation", "Romance", "Crime", "Fantasy", "Horror", "Family", "Documentary", "Action", "History"];
const DOC_TOPICS = ["Deep Ocean", "Night Trains", "The Bee Year", "Mountain Weather", "City Foxes", "Glaciers", "Old Bridges", "Coral Cities", "Desert Light", "The Lost Railway", "Lighthouses of the North", "Clockmakers", "Islands of Wind", "Monarch Migration", "Volcano Season"];
const FIRST_NAMES = ["Sam", "Alex", "Priya", "Jordan", "Mia", "Leo", "Hannah", "Theo", "Zara", "Owen", "Isla", "Noah", "Freya", "Kai"];

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

function titleFor(r) {
  const form = r();
  if (form < 0.45) return `The ${pick(r, ADJ)} ${pick(r, NOUN)}`;
  if (form < 0.7) return `${pick(r, NOUN)} of ${pick(r, PLACE)}`;
  if (form < 0.85) return `${pick(r, ADJ)} ${pick(r, NOUN)}`;
  return `A ${pick(r, ADJ)} ${pick(r, NOUN)}`;
}

function mediaSource(r, id, name, runtimeTicks, path) {
  const hd = r() < 0.55;
  const uhd = !hd && r() < 0.25;
  const height = uhd ? 2160 : hd ? 1080 : 720;
  const codec = uhd || r() < 0.3 ? "hevc" : "h264";
  const bitrate = (uhd ? between(r, 18, 40) : hd ? between(r, 6, 14) : between(r, 2, 5)) * 1_000_000;
  const seconds = runtimeTicks / TICKS;
  return {
    Id: id,
    Name: name,
    Path: path,
    Container: r() < 0.7 ? "mkv" : "mp4",
    Size: Math.round((bitrate / 8) * seconds),
    Bitrate: bitrate,
    RunTimeTicks: runtimeTicks,
    MediaStreams: [
      { Type: "Video", Codec: codec, Height: height, Width: Math.round((height * 16) / 9), BitRate: bitrate - 640_000, Index: 0, IsDefault: true },
      { Type: "Audio", Codec: r() < 0.6 ? "eac3" : "aac", Channels: r() < 0.5 ? 6 : 2, BitRate: 640_000, Language: "eng", Index: 1, IsDefault: true },
      ...(r() < 0.7 ? [{ Type: "Subtitle", Codec: "subrip", Language: "eng", Index: 2, IsExternal: false }] : []),
    ],
  };
}

function imageTag(id) {
  return hashId("tag", id).slice(0, 16);
}

export function buildDataset(seed = "jellyglance-demo") {
  const r = rng(seed);
  const now = Date.now();
  const libraries = [
    { Id: hashId(seed, "lib", "movies"), Name: "Movies", CollectionType: "movies" },
    { Id: hashId(seed, "lib", "tv"), Name: "TV Shows", CollectionType: "tvshows" },
    { Id: hashId(seed, "lib", "docs"), Name: "Documentaries", CollectionType: "movies" },
  ].map((lib) => ({ ...lib, Type: "CollectionFolder", IsFolder: true, ServerId: SERVER_ID, ImageTags: { Primary: imageTag(lib.Id) } }));

  const items = [];
  const usedTitles = new Set();
  const uniqueTitle = (make) => {
    for (let i = 0; i < 20; i += 1) {
      const t = make();
      if (!usedTitles.has(t)) {
        usedTitles.add(t);
        return t;
      }
    }
    return `${make()} ${usedTitles.size}`;
  };
  const addedAt = () => new Date(now - Math.floor(r() ** 1.6 * 730 * DAY)).toISOString();

  // Movies
  for (let i = 0; i < 340; i += 1) {
    const Id = hashId(seed, "movie", i);
    const Name = uniqueTitle(() => titleFor(r));
    const year = between(r, 1972, 2025);
    const RunTimeTicks = between(r, 82, 168) * 60 * TICKS;
    items.push({
      Id, Name, Type: "Movie", IsFolder: false, ServerId: SERVER_ID, ParentId: libraries[0].Id, LibraryId: libraries[0].Id,
      ProductionYear: year, PremiereDate: `${year}-${String(between(r, 1, 12)).padStart(2, "0")}-15T00:00:00.0000000Z`,
      DateCreated: addedAt(), RunTimeTicks, CommunityRating: Math.round((4.5 + r() * 4.5) * 10) / 10,
      OfficialRating: pick(r, ["PG", "12", "15", "18", "PG-13", "R"]),
      Genres: Array.from(new Set([pick(r, GENRES), pick(r, GENRES)])).filter((g) => g !== "Documentary"),
      ImageTags: { Primary: imageTag(Id) }, BackdropImageTags: [imageTag(`${Id}b`)], ImageBlurHashes: {},
      MediaSources: [mediaSource(r, Id, Name, RunTimeTicks, `/media/movies/${Name} (${year})/${Name}.mkv`)],
      LocationType: "FileSystem",
    });
  }

  // Documentaries
  for (let i = 0; i < 48; i += 1) {
    const Id = hashId(seed, "doc", i);
    const Name = uniqueTitle(() => (i < DOC_TOPICS.length ? DOC_TOPICS[i] : `${pick(r, DOC_TOPICS)}: ${pick(r, ["Part Two", "Revisited", "After Dark", "From Above"])}`));
    const year = between(r, 2005, 2025);
    const RunTimeTicks = between(r, 48, 110) * 60 * TICKS;
    items.push({
      Id, Name, Type: "Movie", IsFolder: false, ServerId: SERVER_ID, ParentId: libraries[2].Id, LibraryId: libraries[2].Id,
      ProductionYear: year, PremiereDate: `${year}-06-01T00:00:00.0000000Z`, DateCreated: addedAt(), RunTimeTicks,
      CommunityRating: Math.round((6.5 + r() * 3) * 10) / 10, OfficialRating: "PG", Genres: ["Documentary", pick(r, ["History", "Nature", "Science"])],
      ImageTags: { Primary: imageTag(Id) }, BackdropImageTags: [], ImageBlurHashes: {},
      MediaSources: [mediaSource(r, Id, Name, RunTimeTicks, `/media/docs/${Name}/${Name}.mkv`)],
      LocationType: "FileSystem",
    });
  }

  // Series, seasons, episodes
  const series = [];
  for (let s = 0; s < 46; s += 1) {
    const SeriesId = hashId(seed, "series", s);
    const SeriesName = uniqueTitle(() => (r() < 0.5 ? `${pick(r, ADJ)} ${pick(r, SHOW_WORDS)}` : `The ${pick(r, NOUN)} ${pick(r, SHOW_WORDS)}`));
    const firstYear = between(r, 2008, 2024);
    const seasonCount = Math.max(1, Math.min(6, Math.round(r() ** 1.4 * 6)));
    const continuing = r() < 0.4;
    const genres = Array.from(new Set([pick(r, GENRES), pick(r, GENRES)])).filter((g) => g !== "Documentary");
    const runtimeMinutes = pick(r, [22, 24, 28, 42, 45, 52, 58]);
    const added = addedAt();
    const show = {
      Id: SeriesId, Name: SeriesName, Type: "Series", IsFolder: true, ServerId: SERVER_ID, ParentId: libraries[1].Id, LibraryId: libraries[1].Id,
      ProductionYear: firstYear, PremiereDate: `${firstYear}-09-01T00:00:00.0000000Z`, DateCreated: added,
      Status: continuing ? "Continuing" : "Ended", EndDate: continuing ? null : `${firstYear + seasonCount}-05-01T00:00:00.0000000Z`,
      CommunityRating: Math.round((5.5 + r() * 4) * 10) / 10, OfficialRating: pick(r, ["12", "15", "TV-14", "TV-MA"]), Genres: genres,
      RunTimeTicks: runtimeMinutes * 60 * TICKS, ImageTags: { Primary: imageTag(SeriesId) }, BackdropImageTags: [imageTag(`${SeriesId}b`)],
      ImageBlurHashes: {}, LocationType: "FileSystem", seasons: [],
    };
    items.push(show);
    series.push(show);
    for (let n = 1; n <= seasonCount; n += 1) {
      const SeasonId = hashId(seed, "season", s, n);
      const season = {
        Id: SeasonId, Name: `Season ${n}`, Type: "Season", IndexNumber: n, IsFolder: true, ServerId: SERVER_ID,
        SeriesId, SeriesName, SeriesPrimaryImageTag: show.ImageTags.Primary, ParentBackdropItemId: SeriesId,
        ParentBackdropImageTags: show.BackdropImageTags, ParentLogoItemId: SeriesId, ParentId: libraries[1].Id, LibraryId: libraries[1].Id,
        DateCreated: added, ImageTags: { Primary: imageTag(SeasonId) }, LocationType: "FileSystem", episodes: [],
      };
      items.push(season);
      show.seasons.push(season);
      const episodeCount = runtimeMinutes < 30 ? between(r, 8, 12) : between(r, 6, 10);
      for (let e = 1; e <= episodeCount; e += 1) {
        const Id = hashId(seed, "episode", s, n, e);
        const Name = pick(r, ["Pilot", "The Arrival", "Crossing", "Low Tide", "The Long Night", "Static", "Homecoming", "Small Hours", "Fault Lines", "The Offer", "Second Chances", "Blackout", "The Ledger", "North", "Undertow", "Endgame"]);
        const RunTimeTicks = (runtimeMinutes + between(r, -3, 4)) * 60 * TICKS;
        const year = firstYear + n - 1;
        const episode = {
          Id, Name: e === 1 && n === 1 ? "Pilot" : Name, Type: "Episode", IndexNumber: e, ParentIndexNumber: n, IsFolder: false, ServerId: SERVER_ID,
          SeasonId, SeasonName: season.Name, SeriesId, SeriesName, ParentBackdropItemId: SeriesId, ParentBackdropImageTags: show.BackdropImageTags,
          ParentLogoItemId: SeriesId, ParentId: libraries[1].Id, LibraryId: libraries[1].Id, ProductionYear: year,
          PremiereDate: `${year}-${String(Math.min(12, 8 + Math.ceil(e / 4))).padStart(2, "0")}-${String(between(r, 1, 28)).padStart(2, "0")}T00:00:00.0000000Z`,
          DateCreated: added, RunTimeTicks, CommunityRating: Math.round((6 + r() * 3.5) * 10) / 10, OfficialRating: show.OfficialRating,
          ImageTags: { Primary: imageTag(Id) }, ImageBlurHashes: {}, LocationType: "FileSystem",
          MediaSources: [mediaSource(r, Id, Name, RunTimeTicks, `/media/tv/${SeriesName}/Season ${n}/S${String(n).padStart(2, "0")}E${String(e).padStart(2, "0")}.mkv`)],
        };
        items.push(episode);
        season.episodes.push(episode);
      }
    }
  }

  // Users: one admin and a household-plus-friends mix with distinct habits.
  const PERSONAS = ["binger", "movie-buff", "casual", "night-owl", "weekend", "kids", "docs"];
  const users = FIRST_NAMES.map((name, index) => {
    const Id = hashId(seed, "user", name);
    const ur = rng(`${seed}:${name}`);
    const devices = Array.from({ length: between(ur, 1, 3) }, () => pick(ur, CLIENTS)).map((c, d) => ({ ...c, DeviceId: hashId(seed, name, "device", d) }));
    return {
      Id, Name: name, ServerId: SERVER_ID, HasPassword: true, PrimaryImageTag: imageTag(Id),
      Policy: { IsAdministrator: index === 0, IsDisabled: false, EnableRemoteAccess: true },
      persona: index === 0 ? "binger" : PERSONAS[index % PERSONAS.length],
      activity: index < 4 ? 0.85 : index < 9 ? 0.5 : 0.25,
      remote: ur() < 0.35,
      devices,
      LastActivityDate: new Date(now - Math.floor(ur() * 3 * DAY)).toISOString(),
      LastLoginDate: new Date(now - Math.floor(ur() * 10 * DAY)).toISOString(),
    };
  });

  const byId = new Map(items.map((item) => [item.Id, item]));
  return { seed, libraries, items, series, users, byId };
}

// Strip internal helper fields before sending an item over the mock API.
export function publicItem(item) {
  if (!item) return item;
  const { seasons, episodes, LibraryId, ...rest } = item;
  return rest;
}

export const constants = { TICKS, DAY, CLIENTS };
