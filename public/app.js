/**
 * app.js
 *
 * Daily Release Tracker — main application logic (API-driven).
 * - Fetches today's releases from GET /api/today-releases
 * - Groups by release type (Theatrical / OTT) and language
 * - Auto-refreshes at midnight to show tomorrow's releases
 * - Dark/light mode toggle with localStorage persistence (dark is default)
 * - Countdown timer showing time until next midnight refresh
 * - Skeleton loading, error state with retry, empty state with CSS theatre art
 * - Staggered card animation on load + scroll-triggered reveal
 * - Collapsible language sub-groups
 *
 * Cinema Noir redesign — poster-first vertical cards.
 */

(function () {
  "use strict";

  /* ============================================================
   * DOM REFERENCES
   * ============================================================ */
  var headerDate = document.getElementById("headerDate");
  var theatricalBody = document.getElementById("theatricalBody");
  var theatricalCount = document.getElementById("theatricalCount");
  var theatricalEmpty = document.getElementById("theatricalEmpty");
  var ottBody = document.getElementById("ottBody");
  var ottCount = document.getElementById("ottCount");
  var ottEmpty = document.getElementById("ottEmpty");
  var globalEmpty = document.getElementById("globalEmpty");
  var emptyCountdown = document.getElementById("emptyCountdown");
  var footerCountdown = document.getElementById("footerCountdown");
  var themeToggle = document.getElementById("themeToggle");
  var loadingState = document.getElementById("loadingState");
  var errorState = document.getElementById("errorState");
  var errorMessage = document.getElementById("errorMessage");
  var retryButton = document.getElementById("retryButton");
  var contentArea = document.getElementById("contentArea");

  /* ============================================================
   * DARK / LIGHT MODE TOGGLE
   * Dark mode is the default (cinema noir). Light mode via .light
   * ============================================================ */
  function applyTheme(theme) {
    var html = document.documentElement;
    if (theme === "dark") {
      html.classList.remove("light");
    } else {
      html.classList.add("light");
    }
    try {
      localStorage.setItem("daily-tracker-theme", theme);
    } catch (e) {
      // localStorage unavailable
    }
  }

  function initTheme() {
    var stored;
    try {
      stored = localStorage.getItem("daily-tracker-theme");
    } catch (e) {
      stored = null;
    }
    // Default to dark if no stored preference
    if (stored === "light") {
      applyTheme("light");
    } else {
      applyTheme("dark");
    }
  }

  function toggleTheme() {
    var isLight = document.documentElement.classList.contains("light");
    applyTheme(isLight ? "dark" : "light");
  }

  themeToggle.addEventListener("click", toggleTheme);
  initTheme();

  /* ============================================================
   * DATE UTILITIES
   * ============================================================ */
  function getTodayISO() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, "0");
    var day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatDateDisplay(isoString) {
    var days = [
      "Sunday", "Monday", "Tuesday", "Wednesday",
      "Thursday", "Friday", "Saturday"
    ];
    var months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    var parts = isoString.split("-");
    var dateObj = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
    var dayName = days[dateObj.getDay()];
    var monthName = months[dateObj.getMonth()];
    var dayNum = parseInt(parts[2], 10);
    var year = parts[0];
    return dayName + ", " + monthName + " " + dayNum + ", " + year;
  }

  /** Compact date: "May 29" */
  function formatDateShort(isoString) {
    var months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    var parts = isoString.split("-");
    var monthName = months[parseInt(parts[1], 10) - 1];
    var dayNum = parseInt(parts[2], 10);
    return monthName + " " + dayNum;
  }

  function millisUntilMidnight() {
    var now = new Date();
    var midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  function formatTimeRemaining(ms) {
    if (ms <= 0) return "Refreshing\u2026";
    var totalMinutes = Math.floor(ms / 60000);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) {
      return "Next refresh in " + hours + "h " + minutes + "m";
    } else if (hours > 0) {
      return "Next refresh in " + hours + "h";
    } else {
      return "Next refresh in " + minutes + "m";
    }
  }

  /* ============================================================
   * MIDNIGHT AUTO-REFRESH
   * ============================================================ */
  var refreshTimeout = null;

  function scheduleMidnightRefresh() {
    var ms = millisUntilMidnight();
    ms += 5000;
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(function () {
      location.reload();
    }, ms);
  }

  function updateCountdown() {
    var ms = millisUntilMidnight();
    var text = formatTimeRemaining(ms);
    footerCountdown.textContent = text;
    if (emptyCountdown) {
      emptyCountdown.textContent = text;
    }
  }

  setInterval(updateCountdown, 60000);

  /* ============================================================
   * UTILITY HELPERS
   * ============================================================ */
  function escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;")
      .replace(/'/g, "&" + "#039;");
  }

  function platformToSlug(platform) {
    if (!platform) return "";
    return platform
      .toLowerCase()
      .replace(/\+/g, "")
      .replace(/\s+/g, "-");
  }

  /**
   * Build poster HTML — returns image or placeholder div.
   */
  function posterHTML(posterUrl) {
    if (posterUrl) {
      return '<img class="movie-card__poster" src="' + posterUrl + '" alt="" loading="lazy">';
    }
    return (
      '<div class="movie-card__poster--placeholder">' +
      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>' +
      '<line x1="7" y1="2" x2="7" y2="22"/>' +
      '<line x1="17" y1="2" x2="17" y2="22"/>' +
      '<line x1="2" y1="12" x2="22" y2="12"/>' +
      '<line x1="2" y1="7" x2="7" y2="7"/>' +
      '<line x1="2" y1="17" x2="7" y2="17"/>' +
      '<line x1="17" y1="7" x2="22" y2="7"/>' +
      '<line x1="17" y1="17" x2="22" y2="17"/>' +
      "</svg>" +
      "</div>"
    );
  }

  /* ============================================================
   * CARD BUILDING — Poster-first vertical layout
   * index param for staggered animation delay
   * ============================================================ */
  function buildCard(item, todayISO, index) {
    var typeLabel = item.type;
    var genreText = item.genre ? escapeHTML(item.genre) : "";
    var dateShort = formatDateShort(item.releaseDate || todayISO);
    var animDelay = index != null ? index * 50 : 0;

    // Rating overlay on poster (top-right)
    var ratingOverlay = "";
    if (item.rating && item.rating > 0) {
      ratingOverlay =
        '<span class="movie-card__rating">\u2605 ' +
        item.rating.toFixed(1) +
        "</span>";
    }

    // Fame badge overlay on poster (top-left)
    var fameOverlay = "";
    if (item.fameLevel === "High") {
      fameOverlay =
        '<span class="movie-card__fame">\uD83D\uDD25 Highly Anticipated</span>';
    }

    // Type + Genre line
    var typeGenreLine = escapeHTML(typeLabel);
    if (genreText) {
      typeGenreLine += " \u00B7 " + genreText;
    }

    // Tags: language, platform, international, release type
    var releaseTagHTML = "";
    if (item.releaseType === "Theatrical") {
      releaseTagHTML = '<span class="movie-tag movie-tag--theatrical">\uD83C\uDFAC Theatrical</span>';
    } else {
      releaseTagHTML = '<span class="movie-tag movie-tag--ott">\uD83D\uDCFA OTT</span>';
    }

    var platformTagHTML = "";
    if (item.releaseType === "OTT" && item.ottPlatform) {
      var slug = platformToSlug(item.ottPlatform);
      platformTagHTML =
        '<span class="movie-tag movie-tag--' + slug + '">' +
        escapeHTML(item.ottPlatform) +
        "</span>";
    }

    var internationalTagHTML = "";
    if (item.isIndian === false) {
      internationalTagHTML =
        '<span class="movie-tag movie-tag--international">\uD83C\uDF0D International</span>';
    }

    // Description (if present)
    var descHTML = "";
    if (item.description) {
      descHTML =
        '<p class="movie-card__desc">' + escapeHTML(item.description) + "</p>";
    }

    // Creator / Director / Cast info
    var creatorLine = "";
    if (item.type === "Series" && item.creator) {
      creatorLine = "Created by: " + escapeHTML(item.creator);
    } else if (item.director) {
      creatorLine = "Dir: " + escapeHTML(item.director);
    } else if (item.cast) {
      creatorLine = "Cast: " + escapeHTML(item.cast);
    }

    var creatorHTML = "";
    if (creatorLine) {
      creatorHTML =
        '<div class="movie-card__type-genre" style="margin-top:2px">' +
        creatorLine +
        "</div>";
    }

    return (
      '<article class="movie-card" style="--anim-delay:' +
      animDelay +
      'ms">' +
      '<div class="movie-card__poster-wrap">' +
      posterHTML(item.posterUrl) +
      ratingOverlay +
      fameOverlay +
      "</div>" +
      '<div class="movie-card__body">' +
      '<h3 class="movie-card__title">' +
      escapeHTML(item.title) +
      "</h3>" +
      '<div class="movie-card__tags">' +
      '<span class="movie-tag movie-tag--lang">' +
      escapeHTML(item.language) +
      "</span>" +
      internationalTagHTML +
      platformTagHTML +
      releaseTagHTML +
      "</div>" +
      '<div class="movie-card__type-genre">' +
      typeGenreLine +
      "</div>" +
      descHTML +
      creatorHTML +
      '<div class="movie-card__footer">' +
      '<span class="movie-card__date">\uD83D\uDCC5 ' +
      dateShort +
      "</span>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  /* ============================================================
   * INTERSECTION OBSERVER — Scroll-triggered card reveal
   * ============================================================ */
  var scrollObserver = null;

  function setupScrollAnimations() {
    if (scrollObserver) {
      scrollObserver.disconnect();
    }
    scrollObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("movie-card--revealed");
            scrollObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.1 }
    );

    var cards = document.querySelectorAll(".movie-card");
    cards.forEach(function (card) {
      scrollObserver.observe(card);
    });

    // Reveal first-viewport cards with staggered delay after brief settle
    setTimeout(function () {
      var allCards = document.querySelectorAll(".movie-card");
      allCards.forEach(function (card) {
        var rect = card.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
          card.classList.add("movie-card--revealed");
          if (scrollObserver) {
            scrollObserver.unobserve(card);
          }
        }
      });
    }, 120);
  }

  /* ============================================================
   * LANGUAGE GROUP TOGGLE COLLAPSE
   * ============================================================ */
  function setupLangGroupToggles(bodyEl) {
    var headers = bodyEl.querySelectorAll(".lang-group__header");
    headers.forEach(function (header) {
      header.addEventListener("click", function () {
        var grid = header.nextElementSibling;
        if (!grid) return;
        var arrow = header.querySelector(".lang-group__arrow");
        var isCollapsed = grid.classList.contains("lang-group__grid--collapsed");
        if (isCollapsed) {
          grid.classList.remove("lang-group__grid--collapsed");
          if (arrow) arrow.classList.add("lang-group__arrow--open");
          try {
            localStorage.setItem("dt-lang-collapsed-" + header.textContent.trim(), "false");
          } catch (e) {}
        } else {
          grid.classList.add("lang-group__grid--collapsed");
          if (arrow) arrow.classList.remove("lang-group__arrow--open");
          try {
            localStorage.setItem("dt-lang-collapsed-" + header.textContent.trim(), "true");
          } catch (e) {}
        }
      });
    });
  }

  /* ============================================================
   * RENDERING
   * ============================================================ */
  function groupBy(items, keyFn) {
    var groups = {};
    items.forEach(function (item) {
      var key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });
    return groups;
  }

  function renderSection(items, bodyEl, countEl, emptyEl) {
    countEl.textContent = "(" + items.length + ")";

    if (items.length === 0) {
      bodyEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");

    var langGroups = groupBy(items, function (item) { return item.language; });
    var uniqueLanguages = Object.keys(langGroups);

    var indianLangSet = [
      "Hindi", "Tamil", "Telugu", "Malayalam",
      "Kannada", "Bengali", "Marathi", "Punjabi", "Gujarati", "Odia"
    ];

    // Sorting: Indian languages first, then foreign, each alphabetically
    function sortLangs(langKeys) {
      var indian = [];
      var foreign = [];
      langKeys.forEach(function (lang) {
        if (indianLangSet.indexOf(lang) !== -1) {
          indian.push(lang);
        } else {
          foreign.push(lang);
        }
      });
      indian.sort();
      foreign.sort();
      return indian.concat(foreign);
    }

    if (uniqueLanguages.length <= 1) {
      // Single language — no language grouping, just grid
      var cardsHTML = items
        .map(function (item, i) { return buildCard(item, getTodayISO(), i); })
        .join("");
      bodyEl.innerHTML = '<div class="movies__grid">' + cardsHTML + "</div>";
    } else {
      var sortedLangs = sortLangs(uniqueLanguages);

      var html = "";
      sortedLangs.forEach(function (lang) {
        var langItems = langGroups[lang];
        html += '<div class="lang-group">';
        html +=
          '<div class="lang-group__header">' +
          '<span class="lang-group__arrow lang-group__arrow--open">\u25B6</span>' +
          escapeHTML(lang) +
          ' <span class="lang-group__count">(' +
          langItems.length +
          ")</span>" +
          "</div>";
        html += '<div class="lang-group__grid">';
        html += langItems
          .map(function (item, i) { return buildCard(item, getTodayISO(), i); })
          .join("");
        html += "</div>";
        html += "</div>";
      });
      bodyEl.innerHTML = html;

      // Attach collapse toggle handlers
      setupLangGroupToggles(bodyEl);
    }
  }

  /**
   * Main render — called after successful API fetch.
   */
  function render(data) {
    var todayISO = data.date || getTodayISO();

    // Update header date
    headerDate.textContent = formatDateDisplay(todayISO);

    var theatrical = data.theatrical || [];
    var ott = data.ott || [];

    // If no releases at all
    if (theatrical.length === 0 && ott.length === 0) {
      globalEmpty.classList.remove("hidden");
      theatricalBody.innerHTML = "";
      theatricalCount.textContent = "(0)";
      theatricalEmpty.classList.add("hidden");
      ottBody.innerHTML = "";
      ottCount.textContent = "(0)";
      ottEmpty.classList.add("hidden");

      // Update empty state countdown
      if (emptyCountdown) {
        var ms = millisUntilMidnight();
        emptyCountdown.textContent = formatTimeRemaining(ms);
      }
      return;
    }

    globalEmpty.classList.add("hidden");

    renderSection(theatrical, theatricalBody, theatricalCount, theatricalEmpty);
    renderSection(ott, ottBody, ottCount, ottEmpty);

    // Setup scroll-triggered animations for all cards
    setupScrollAnimations();
  }

  /* ============================================================
   * UI STATE HELPERS
   * ============================================================ */
  function showLoading() {
    loadingState.classList.remove("hidden");
    errorState.classList.add("hidden");
    contentArea.classList.add("hidden");
    globalEmpty.classList.add("hidden");
  }

  function showError(message) {
    loadingState.classList.add("hidden");
    errorState.classList.remove("hidden");
    contentArea.classList.add("hidden");
    if (message) {
      errorMessage.textContent = message;
    }
  }

  function showContent() {
    loadingState.classList.add("hidden");
    errorState.classList.add("hidden");
    contentArea.classList.remove("hidden");
  }

  /* ============================================================
   * API FETCHING
   * ============================================================ */
  function fetchReleases() {
    showLoading();

    fetch("/api/today-releases")
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.detail || body.error || "HTTP " + res.status);
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          throw new Error(data.error || "API returned unsuccessful response");
        }
        showContent();
        render(data);
      })
      .catch(function (err) {
        console.error("[App] Fetch error:", err.message);
        showError(err.message || "Unable to fetch release data. Check your connection and try again.");
      });
  }

  // Retry button
  retryButton.addEventListener("click", function () {
    fetchReleases();
  });

  /* ============================================================
   * INITIALIZATION
   * ============================================================ */
  fetchReleases();
  scheduleMidnightRefresh();
  updateCountdown();
})();