/**
 * lib/tmdb.js
 * 
 * TMDB API Client — handles all communication with The Movie Database API.
 * 
 * API Docs: https://developer.themoviedb.org/reference/intro/getting-started
 */

const { formatMovie, formatSeries, BLOCKED_WORDS } = require("./formatter");

const CACHE_KEY_TODAY = "today-releases";
const https = require("https");
const dns = require("dns");

// Improve DNS stability on some Windows/proxy environments.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {
  // noop
}

/**
 * Main function: fetch all releases for today from TMDB.
 * @param {string} apiKey - TMDB API v3 key
 * @param {Cache} cache - Cache instance
 * @param {object} options - { baseUrl, imageBaseUrl }
 * @returns {Promise<object>} { date, theatrical, ott }
 */
async function fetchTodayReleases(apiKey, cache, options = {}) {
  const baseUrl = options.baseUrl || "https://api.themoviedb.org/3";
  const imageBaseUrl = options.imageBaseUrl || "https://image.tmdb.org/t/p";

  // Check cache first
  const today = options.date || getTodayISO();
  const cacheKey = `${CACHE_KEY_TODAY}-${today}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[TMDB] Cache HIT for ${cacheKey}`);
    return cached;
  }
  console.log(`[TMDB] Cache MISS for ${cacheKey} — fetching from API...`);

  try {
    // Compute date window based on the target date (override or real today)
    const todayPlusMonth = getDatePlusDays(30, today);

    // Parallel fetches: upcoming + now_playing movies (IN + US) + on-the-air TV (IN)
    const [indianUpcoming, usUpcoming, indianNowPlaying, usNowPlaying, indianTV] = await Promise.all([
      fetchUpcomingMovies(apiKey, "IN", baseUrl, today, todayPlusMonth),
      fetchUpcomingMovies(apiKey, "US", baseUrl, today, todayPlusMonth),
      fetchNowPlayingMovies(apiKey, "IN", baseUrl),
      fetchNowPlayingMovies(apiKey, "US", baseUrl),
      fetchOnTheAirTV(apiKey, "IN", baseUrl),
    ]);

    // Merge and filter: only titles releasing today
    const allMoviesRaw = [
      ...indianUpcoming,
      ...usUpcoming,
      ...indianNowPlaying,
      ...usNowPlaying,
    ];

    // De-duplicate by TMDB id (same title can appear in multiple sources/regions)
    const movieMap = new Map();
    for (const m of allMoviesRaw) {
      if (!movieMap.has(m.id)) movieMap.set(m.id, m);
    }
    const allMovies = Array.from(movieMap.values());

    // Filter movies to today
    const todayMovies = allMovies.filter(m => m.release_date === today);

    // Filter series: check both first_air_date AND episode air dates
    const todaySeries = await filterSeriesByEpisodeAirDate(apiKey, indianTV, today, baseUrl);

    // Enrich with watch/providers (OTT platform info) — batch in chunks
    const enrichedMovies = await enrichWithProviders(apiKey, todayMovies, "movie", baseUrl);
    const enrichedSeries = await enrichWithProviders(apiKey, todaySeries, "tv", baseUrl);

    // Enrich with credits (cast, director, creator) — batch in chunks
    const moviesWithCredits = await enrichWithCredits(apiKey, enrichedMovies, "movie", baseUrl);
    const seriesWithCredits = await enrichWithCredits(apiKey, enrichedSeries, "tv", baseUrl);

    // Classify: theatrical vs OTT
    const theatrical = [];
    const ott = [];

    for (const m of moviesWithCredits) {
      if (!isSafeItem(m)) continue;
      const formatted = formatMovie(m, imageBaseUrl);
      if (formatted.ottPlatform && !hasTheatricalRelease(m)) {
        formatted.releaseType = "OTT";
        ott.push(formatted);
      } else {
        formatted.releaseType = "Theatrical";
        theatrical.push(formatted);
      }
    }

    for (const s of seriesWithCredits) {
      if (!isSafeItem(s)) continue;
      const formatted = formatSeries(s, imageBaseUrl);
      formatted.releaseType = "OTT";
      ott.push(formatted);
    }

    // Sort: high fame first, then alphabetical
    const sortFn = (a, b) => {
      const fameOrder = { High: 0, Medium: 1, Low: 2 };
      const fa = fameOrder[a.fameLevel] ?? 2;
      const fb = fameOrder[b.fameLevel] ?? 2;
      if (fa !== fb) return fa - fb;
      return a.title.localeCompare(b.title);
    };

    theatrical.sort(sortFn);
    ott.sort(sortFn);

    const result = { date: today, theatrical, ott };

    // Store in cache
    cache.set(cacheKey, result);
    console.log(`[TMDB] Fetched ${theatrical.length} theatrical + ${ott.length} OTT for ${today}`);

    return result;
  } catch (err) {
    console.error("[TMDB] Error fetching today releases:", err.message);
    throw err;
  }
}

/**
 * Fetch upcoming movies for a region from TMDB.
 * @param {string} today - Target date (override or real today) YYYY-MM-DD
 * @param {string} todayPlusMonth - Target date + 30 days YYYY-MM-DD
 */
async function fetchUpcomingMovies(apiKey, region, baseUrl, today, todayPlusMonth) {
  const allMovies = [];
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}/movie/upcoming?api_key=${apiKey}&region=${region}&language=en-US&page=${page}`;
    const res = await fetchTMDB(url);
    if (!res || !res.results) break;

    // Only keep movies that are within our window (today → today+30d)
    const inWindow = res.results.filter(m =>
      m.release_date >= today && m.release_date <= todayPlusMonth
    );
    allMovies.push(...inWindow);

    // Stop if we've gone past our window
    if (res.results.length === 0 || res.results[res.results.length - 1].release_date > todayPlusMonth) break;
  }

  return allMovies;
}

/**
 * Fetch TV series currently airing in India.
 */
async function fetchOnTheAirTV(apiKey, region, baseUrl) {
  const allSeries = [];
  const maxPages = 2;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}/tv/on_the_air?api_key=${apiKey}&language=en-US&page=${page}`;
    const res = await fetchTMDB(url);
    if (!res || !res.results) break;

    allSeries.push(...res.results);
    if (res.total_pages <= page) break;
  }

  return allSeries;
}

/**
 * Fetch now-playing movies for a region from TMDB.
 * Includes movies already in theatrical run (not just upcoming).
 */
async function fetchNowPlayingMovies(apiKey, region, baseUrl) {
  const allMovies = [];
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}/movie/now_playing?api_key=${apiKey}&region=${region}&language=en-US&page=${page}`;
    const res = await fetchTMDB(url);
    if (!res || !res.results) break;

    allMovies.push(...res.results);
    if (res.total_pages <= page) break;
  }

  return allMovies;
}

/**
 * Enrich movies/series with OTT watch/providers data (batched).
 */
async function enrichWithProviders(apiKey, items, mediaType, baseUrl) {
  if (items.length === 0) return items;

  // Batch in groups of 10 parallel requests to avoid rate limits
  const enriched = [...items];
  const batchSize = 10;

  for (let i = 0; i < enriched.length; i += batchSize) {
    const batch = enriched.slice(i, i + batchSize);
    const providerPromises = batch.map(async (item) => {
      try {
        const url = `${baseUrl}/${mediaType}/${item.id}/watch/providers?api_key=${apiKey}`;
        const res = await fetchTMDB(url);
        if (res && res.results && res.results.IN) {
          item._providers = res.results.IN;
        }
      } catch (e) {
        // Silently skip failed provider fetches
      }
    });
    await Promise.all(providerPromises);
  }

  return enriched;
}

/**
 * Enrich movies/series with credits data — cast, director (movies), creator (TV).
 * Batched 10 at a time to avoid rate limits. Failures are silently skipped
 * so a single failed credits call doesn't break the whole response.
 *
 * @param {string} apiKey - TMDB API key
 * @param {Array} items - Movies or series enriched with _providers
 * @param {string} mediaType - "movie" or "tv"
 * @param {string} baseUrl - TMDB API base URL
 * @returns {Promise<Array>} Items with _credits attached
 */
async function enrichWithCredits(apiKey, items, mediaType, baseUrl) {
  if (items.length === 0) return items;

  const enriched = [...items];
  const batchSize = 10;

  for (let i = 0; i < enriched.length; i += batchSize) {
    const batch = enriched.slice(i, i + batchSize);
    const creditPromises = batch.map(async (item) => {
      try {
        // Movies use /credits, TV uses /aggregate_credits
        const endpoint = mediaType === "movie" ? "credits" : "aggregate_credits";
        const url = `${baseUrl}/${mediaType}/${item.id}/${endpoint}?api_key=${apiKey}`;
        const res = await fetchTMDB(url);
        if (res) {
          // Top 3 cast names
          const cast = (res.cast || []).slice(0, 3).map(c => c.name);

          if (mediaType === "movie") {
            // Directors from crew
            const directors = (res.crew || [])
              .filter(c => c.job === "Director")
              .map(c => c.name);
            item._credits = { cast, directors };
          } else {
            // Creators from crew (TV uses aggregate_credits)
            const creators = (res.crew || [])
              .filter(c => c.job === "Creator")
              .map(c => c.name);
            item._credits = { cast, creators };
          }
        }
      } catch (e) {
        // Silently skip failed credits fetches — fields will default to ""
      }
    });
    await Promise.all(creditPromises);
  }

  return enriched;
}

/**
 * Filter TV series to only those releasing today.
 *
 * Two paths for inclusion:
 *   1. first_air_date === today  →  always included (no extra API call)
 *   2. An episode in the current/last season has air_date === today  →  included
 *
 * Season details are fetched via /tv/{id}/season/{season_number}, batched 10 at a time.
 * Fail-open: if a season detail request fails, the series is included anyway
 * so we don't miss a release because of an API error.
 *
 * @param {string} apiKey - TMDB API key
 * @param {Array} series - Raw series list from on_the_air endpoint
 * @param {string} today - Today's date in YYYY-MM-DD
 * @param {string} baseUrl - TMDB API base URL
 * @returns {Promise<Array>} Filtered series list
 */
async function filterSeriesByEpisodeAirDate(apiKey, series, today, baseUrl) {
  const autoIncluded = [];
  const needCheck = [];

  // First pass: series with first_air_date === today are auto-included.
  // Series with a last_episode_to_air and no first_air_date match need episode checking.
  for (const s of series) {
    if (!s.first_air_date) continue;

    if (s.first_air_date === today) {
      autoIncluded.push(s);
    } else if (s.last_episode_to_air && s.last_episode_to_air.season_number) {
      needCheck.push(s);
    }
    // If first_air_date !== today and no last_episode_to_air data, skip
  }

  if (needCheck.length === 0) return autoIncluded;

  // Batch-check episode air dates (10 at a time, same batching pattern)
  const batchSize = 10;

  for (let i = 0; i < needCheck.length; i += batchSize) {
    const batch = needCheck.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (s) => {
      try {
        const seasonNum = s.last_episode_to_air.season_number;
        const url = `${baseUrl}/tv/${s.id}/season/${seasonNum}?api_key=${apiKey}`;
        const res = await fetchTMDB(url);
        if (res && res.episodes) {
          const hasEpisodeToday = res.episodes.some(ep => ep.air_date === today);
          return { series: s, include: hasEpisodeToday };
        }
        // No episodes array — fail-open: include the series
        return { series: s, include: true };
      } catch (e) {
        // Fail-open: include series if we can't fetch season details
        console.error(`[TMDB] Failed to fetch season ${s.last_episode_to_air?.season_number} for series ${s.id}: ${e.message}`);
        return { series: s, include: true };
      }
    }));

    for (const { series: s, include } of results) {
      if (include) autoIncluded.push(s);
    }
  }

  return autoIncluded;
}

/**
 * Determine if a movie has a theatrical release (based on release_date).
 */
function hasTheatricalRelease(movie) {
  // If there's no OTT provider or the movie has release_dates with theatrical type,
  // we consider it theatrical. For simplicity, if no OTT provider found, classify as theatrical.
  return !movie._providers || !movie._providers.flatrate || movie._providers.flatrate.length === 0;
}

function isSafeItem(item) {
  // Check raw TMDB fields BEFORE formatting/sanitization.
  // item.title (movie) / item.name (series) and item.overview are raw TMDB fields.
  const probe = `${item?.title || item?.name || ""} ${item?.overview || ""}`.toLowerCase();
  let hits = 0;
  for (const word of BLOCKED_WORDS) {
    if (probe.includes(word)) hits += 1;
    if (hits >= 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayISO() {
  // Always return IST date, regardless of server timezone.
  // en-CA locale produces YYYY-MM-DD format.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getDatePlusDays(days, baseDate) {
  const d = baseDate ? new Date(baseDate + "T00:00:00") : new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchTMDB(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[TMDB] HTTP ${res.status} for ${url.split("?").pop().slice(0, 80)}`);
      throw new Error(`TMDB API error ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[TMDB] Request timed out:", url.split("?").pop().slice(0, 80));
      throw new Error("TMDB API request timed out after 15s");
    }
    console.error(`[TMDB] Fetch error detail: ${err.message} (code: ${err.code || "none"}, errno: ${err.errno || "none"})`);

    // Fallback path: native https request (more stable in some environments).
    try {
      return await fetchTMDBViaHttps(url, 15000);
    } catch (fallbackErr) {
      console.error(`[TMDB] HTTPS fallback failed: ${fallbackErr.message}`);
      throw err;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function fetchTMDBViaHttps(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Accept: "application/json" },
      family: 4,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`TMDB API error ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`Invalid JSON from TMDB: ${e.message}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`TMDB API request timed out after ${Math.round(timeoutMs / 1000)}s`));
    });

    req.on("error", (e) => reject(e));
  });
}

module.exports = { fetchTodayReleases };
