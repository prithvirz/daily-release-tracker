/**
 * server.js
 * 
 * Express server for Daily Release Tracker.
 * - Serves static frontend files from public/
 * - Proxies TMDB API calls through GET /api/today-releases
 * - Auto-clears cache at midnight
 */

require("dotenv").config();

const express = require("express");
const path = require("path");
const { fetchTodayReleases } = require("./lib/tmdb");
const cache = require("./lib/cache");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.error("\n ERROR: TMDB_API_KEY is not set.");
  console.error("  1. Copy .env.example to .env");
  console.error("  2. Add your TMDB API key to .env");
  console.error("  3. Get a free key at: https://www.themoviedb.org/settings/api\n");
  process.exit(1);
}

// Set cache TTL from env
const cacheTTLRaw = parseInt(process.env.CACHE_TTL_HOURS);
const cacheTTL = (cacheTTLRaw >= 0 ? cacheTTLRaw : 6) * 60 * 60 * 1000;
cache.setTTL(cacheTTL);

// TMDB image base URL (configurable — defaults to TMDB standard)
const TMDB_IMAGE_BASE = process.env.TMDB_IMAGE_BASE || "https://image.tmdb.org/t/p";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// In-Memory Rate Limiter for /api/today-releases
// ---------------------------------------------------------------------------
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const dateHistory = [];

function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please wait before trying again.",
    });
  }

  // Date-cache-busting protection: max 10 unique dates per hour globally
  const reqDate = req.query.date || "today";
  while (dateHistory.length && now - dateHistory[0].timestamp > 3600000) {
    dateHistory.shift();
  }
  const uniqueDates = new Set(dateHistory.map(d => d.date));
  if (!uniqueDates.has(reqDate)) {
    if (uniqueDates.size >= 10) {
      return res.status(429).json({
        success: false,
        error: "Too many unique date queries. Please try again later.",
      });
    }
    dateHistory.push({ date: reqDate, timestamp: now });
  }

  next();
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/today-releases
 * Returns all movies and series releasing today (theatrical + OTT).
 */
app.get("/api/today-releases", rateLimiter, async (req, res) => {
  // Prevent browser/CDN caching of this time-sensitive endpoint
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  try {
    let dateParam = req.query.date;
    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return res.status(400).json({ success: false, error: "Invalid date format. Use YYYY-MM-DD." });
      }
      const d = new Date(dateParam + "T00:00:00");
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, error: "Invalid date value." });
      }
      const now = new Date();
      const diffDays = Math.abs((d - now) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        return res.status(400).json({ success: false, error: "Date must be within 30 days of today." });
      }
    }
    const data = await fetchTodayReleases(TMDB_API_KEY, cache, {
      imageBaseUrl: TMDB_IMAGE_BASE,
      date: dateParam || undefined,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error("[Server] Error in /api/today-releases:", err.message);
    const safeDetail = err.message.replace(/api_key=[^&]+/g, "api_key=[REDACTED]");
    res.status(502).json({
      success: false,
      error: "Failed to fetch release data from TMDB.",
      detail: safeDetail,
    });
  }
});

/**
 * GET /api/health
 * Simple health check + cache stats.
 */
app.get("/api/health", (req, res) => {
  const hasKey = !!TMDB_API_KEY;
  const stats = cache.stats();
  res.json({
    status: "ok",
    tmdbConfigured: hasKey,
    uptime: process.uptime(),
    cacheEntries: stats.entries,
    cacheKeys: stats.keys,
  });
});

// ---------------------------------------------------------------------------
// Static Files (frontend)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// Fallback: serve index.html for any unmatched route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Midnight Cache Clear
// ---------------------------------------------------------------------------
function scheduleMidnightClear() {
  // Compute IST midnight, not UTC midnight.
  // istNow   = current time interpreted in Asia/Kolkata
  // istToday = midnight floor of that date (IST)
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const istToday = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
  const istMidnight = new Date(istToday);
  istMidnight.setHours(24, 0, 0, 0); // Next IST midnight

  // Convert IST midnight back to UTC epoch so setTimeout fires at the right wall-clock instant
  const nowUTC = Date.now();
  const msUntilMidnight = istMidnight.getTime() - nowUTC;

  setTimeout(() => {
    console.log("[Server] IST Midnight — clearing release cache...");
    cache.clearByPrefix("today-releases");
    scheduleMidnightClear();
  }, Math.max(msUntilMidnight, 1000));

  console.log(`[Server] IST midnight cache clear scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Daily Release Tracker v2.0`);
  console.log(`  Server running at http://localhost:${PORT}`);
  console.log(`  TMDB API: configured`);
  console.log(`  Cache TTL: ${cacheTTL / 3600000}h\n`);

  scheduleMidnightClear();
});