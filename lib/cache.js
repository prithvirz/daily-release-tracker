/**
 * lib/cache.js
 * 
 * Simple in-memory cache with TTL (Time-To-Live) support.
 * Date-keyed so each day gets its own cache slot.
 */

class Cache {
  constructor() {
    this._store = new Map();
    this._timestamps = new Map();
    this._defaultTTL = 6 * 60 * 60 * 1000; // 6 hours in ms
  }

  /**
   * Get a cached value. Returns null if expired or missing.
   */
  get(key) {
    const entry = this._store.get(key);
    const timestamp = this._timestamps.get(key);

    if (!entry || !timestamp) return null;

    const age = Date.now() - timestamp;
    if (age > this._defaultTTL) {
      this._store.delete(key);
      this._timestamps.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Store a value in the cache.
   */
  set(key, value) {
    this._store.set(key, value);
    this._timestamps.set(key, Date.now());
  }

  /**
   * Set the default TTL in milliseconds.
   */
  setTTL(milliseconds) {
    this._defaultTTL = milliseconds;
  }

  /**
   * Clear ALL cache entries.
   */
  clearAll() {
    this._store.clear();
    this._timestamps.clear();
    console.log("[Cache] All entries cleared.");
  }

  /**
   * Clear entries matching a pattern.
   */
  clearByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        this._store.delete(key);
        this._timestamps.delete(key);
      }
    }
    console.log(`[Cache] Entries with prefix "${prefix}" cleared.`);
  }

  /**
   * Get cache stats.
   */
  stats() {
    return {
      entries: this._store.size,
      keys: Array.from(this._store.keys()),
    };
  }
}

// Export as singleton
module.exports = new Cache();