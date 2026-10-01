// Builds the demo library from real TMDB titles: popular films, documentaries and TV shows
// with their seasons and episodes. Results are cached on disk so restarts don't refetch.
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.themoviedb.org/3";
export const IMAGE_BASE = "https://image.tmdb.org/t/p";

function authOptions(key) {
  // v4 read access tokens are long JWTs; v3 keys are 32 hex characters.
  return key.length > 40 ? { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, query: {} } : { headers: { Accept: "application/json" }, query: { api_key: key } };
}

async function getJson(key, pathname, params = {}, attempt = 0) {
  const auth = authOptions(key);
  const url = new URL(`${API}${pathname}`);
  for (const [k, v] of Object.entries({ ...auth.query, language: "en-GB", ...params })) url.searchParams.set(k, String(v));
  const response = await fetch(url, { headers: auth.headers, signal: AbortSignal.timeout(20_000) });
  if (response.status === 429 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    return getJson(key, pathname, params, attempt + 1);
  }
  if (!response.ok) throw new Error(`TMDB ${pathname} → ${response.status}`);
  return response.json();
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const index = next++;
        out[index] = await fn(list[index], index).catch(() => null);
      }
    })
  );
  return out;
}

async function discover(key, kind, params, pages) {
  const results = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await getJson(key, `/discover/${kind}`, { ...params, page });
    results.push(...(data.results || []));
    if (page >= (data.total_pages || 1)) break;
  }
  const seen = new Set();
  return results.filter((r) => r.poster_path && !seen.has(r.id) && seen.add(r.id));
}

async function fetchCatalog(key) {
  const today = new Date().toISOString().slice(0, 10);
  const [movieGenres, tvGenres] = await Promise.all([getJson(key, "/genre/movie/list"), getJson(key, "/genre/tv/list")]);
  const genreName = new Map([...movieGenres.genres, ...tvGenres.genres].map((g) => [g.id, g.name]));

  const popularMovies = await discover(key, "movie", { sort_by: "popularity.desc", "vote_count.gte": 800, "primary_release_date.lte": today, include_adult: false, without_genres: 99 }, 16);
  const docList = await discover(key, "movie", { sort_by: "popularity.desc", "vote_count.gte": 60, with_genres: 99, include_adult: false }, 3);
  const upcomingMovies = await discover(key, "movie", { sort_by: "popularity.desc", "primary_release_date.gte": today, "primary_release_date.lte": new Date(Date.now() + 85 * 86_400_000).toISOString().slice(0, 10), include_adult: false, with_release_type: "2|3|4" }, 2);
  const showList = await discover(key, "tv", { sort_by: "popularity.desc", "vote_count.gte": 400, include_adult: false, with_original_language: "en", without_genres: "10763|10764|10767" }, 3);

  const movieDetails = async (m) => {
    const d = await getJson(key, `/movie/${m.id}`);
    return {
      tmdbId: d.id, title: d.title, overview: d.overview || "", releaseDate: d.release_date || "", runtime: d.runtime || 100,
      genres: (d.genres || []).map((g) => g.name), voteAverage: d.vote_average || 0, posterPath: d.poster_path, backdropPath: d.backdrop_path,
      certification: d.adult ? "18" : "",
    };
  };
  const movies = (await mapLimit(popularMovies.slice(0, 300), 8, movieDetails)).filter(Boolean);
  const docs = (await mapLimit(docList.slice(0, 50), 8, movieDetails)).filter(Boolean);
  const upcoming = upcomingMovies.slice(0, 30).map((m) => ({
    tmdbId: m.id, title: m.title, overview: m.overview || "", releaseDate: m.release_date || "", genres: (m.genre_ids || []).map((id) => genreName.get(id)).filter(Boolean),
    voteAverage: m.vote_average || 0, posterPath: m.poster_path, backdropPath: m.backdrop_path,
  }));

  const shows = (
    await mapLimit(showList.slice(0, 50), 6, async (s) => {
      const d = await getJson(key, `/tv/${s.id}`);
      const seasonNumbers = (d.seasons || []).map((x) => x.season_number).filter((n) => n > 0);
      const first = seasonNumbers.slice(0, 3);
      const latest = seasonNumbers.at(-1);
      const wanted = Array.from(new Set([...first, latest].filter(Boolean)));
      const seasons = (
        await mapLimit(wanted, 3, async (n) => {
          const season = await getJson(key, `/tv/${s.id}/season/${n}`);
          return {
            seasonNumber: n,
            name: season.name || `Season ${n}`,
            posterPath: season.poster_path || d.poster_path,
            episodes: (season.episodes || []).map((e) => ({
              episodeNumber: e.episode_number, name: e.name || `Episode ${e.episode_number}`, airDate: e.air_date || "", runtime: e.runtime || d.episode_run_time?.[0] || 45,
              overview: e.overview || "", voteAverage: e.vote_average || 0, stillPath: e.still_path,
            })),
          };
        })
      ).filter(Boolean);
      return {
        tmdbId: d.id, title: d.name, overview: d.overview || "", firstAirDate: d.first_air_date || "", lastAirDate: d.last_air_date || "",
        status: d.status, inProduction: Boolean(d.in_production), genres: (d.genres || []).map((g) => g.name), voteAverage: d.vote_average || 0,
        posterPath: d.poster_path, backdropPath: d.backdrop_path, runtime: d.episode_run_time?.[0] || seasons[0]?.episodes[0]?.runtime || 45, seasons,
      };
    })
  ).filter((show) => show && show.seasons.length);

  return { fetchedAt: new Date().toISOString(), movies, docs, upcoming, shows };
}

// Returns the cached catalogue when it is fresh enough, otherwise fetches a new one.
export async function loadTmdbCatalog(key, cacheDir = "/data", maxAgeDays = 7) {
  const file = path.join(cacheDir, "tmdb-catalog.json");
  try {
    const cached = JSON.parse(await fs.readFile(file, "utf8"));
    if (Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeDays * 86_400_000) return cached;
  } catch {
    // no cache yet
  }
  const catalog = await fetchCatalog(key);
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
  await fs.writeFile(file, JSON.stringify(catalog)).catch(() => {});
  return catalog;
}
