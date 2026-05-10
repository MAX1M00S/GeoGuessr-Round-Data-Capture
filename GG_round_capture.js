// ==UserScript==
// @name         GeoGuessr Round Data Capture
// @namespace    https://github.com/MAX1M00S/GeoGuessr-Round-Data-Capture
// @version      0.3.9
// @description  Capture GeoGuessr end-screen round data and export Google Street View URLs for your own played games.
// @match        https://www.geoguessr.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @run-at       document-start
// ==/UserScript==

/*
 * GeoGuessr Round Data Capture
 *
 * Intended use:
 * - Personal post-game analysis of games you played yourself.
 * - Does not automate gameplay or make background requests to GeoGuessr.
 * - Reads data already loaded in the current page/runtime.
 *
 * Usage:
 * 1. Install Tampermonkey or Violentmonkey.
 * 2. Add this file as a userscript.
 * 3. Play a GeoGuessr game normally.
 * 4. Open the game summary/end screen.
 * 5. Click "GeoGuessr Capture" in the bottom-right corner.
 * 6. Download CSV/JSON.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "geoguessr_round_capture_rows_v1";
  const API_CACHE_KEY = "geoguessr_round_capture_api_cache_v1";
  const LAST_CAPTURE_KEY = "geoguessr_round_capture_last_capture_v1";
  const PANEL_ID = "geoguessr-round-capture-panel";

  const SELECTORS_TO_IGNORE = ["script", "style", "noscript", "svg", "canvas"];
  const MAX_API_CACHE_ENTRIES = 30;
  const DEFAULT_MAX_DISTANCE_KM = 18500;

  installNetworkCapture();

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function finiteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function normalizeLatLng(value) {
    if (!value || typeof value !== "object") return null;

    const lat = finiteNumber(
      value.lat ?? value.latitude ?? value.latitute ?? value.y ?? value[0]
    );
    const lng = finiteNumber(
      value.lng ?? value.lon ?? value.long ?? value.longitude ?? value.x ?? value[1]
    );

    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
  }

  function getByPath(object, path) {
    let current = object;
    for (const part of path) {
      if (!current || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function streetViewUrl(lat, lng, heading, panoId) {
    const normalizedHeading = finiteNumber(heading) ?? 0;
    const roundedLat = roundCoordinate(lat, 7);
    const roundedLng = roundCoordinate(lng, 7);
    const yaw = Math.round(normalizedHeading);
    const cleanPanoId = normalizePanoId(panoId);

    if (cleanPanoId) {
      const thumbnailUrl = `https://streetviewpixels-pa.googleapis.com/v1/thumbnail?cb_client=maps_sv.tactile&w=900&h=600&pitch=0&panoid=${cleanPanoId}&yaw=${yaw}`;

      return `https://www.google.com/maps/@${roundedLat},${roundedLng},3a,90y,${yaw}h,90t/data=!3m7!1e1!3m5!1s${cleanPanoId}!2e0!6s${encodeURIComponent(thumbnailUrl)}!7i13312!8i6656?entry=ttu`;
    }

    const params = new URLSearchParams({
      api: "1",
      map_action: "pano",
      viewpoint: `${lat},${lng}`,
      fov: "100",
      heading: String(yaw),
    });

    return `https://www.google.com/maps/@?${params.toString()}`;
  }

  function roundCoordinate(value, decimals) {
    const number = finiteNumber(value);
    if (number === null) return value;
    return Number(number.toFixed(decimals));
  }

  function normalizePanoId(panoId) {
    const text = String(panoId || "").trim();
    if (!text) return "";

    const decoded = decodeHexPanoId(text);
    return looksLikeGooglePanoId(decoded) ? decoded : text;
  }

  function looksLikeGooglePanoId(panoId) {
    const text = String(panoId || "");
    return /^[A-Za-z0-9_-]{15,80}$/.test(text) && /[A-Z]/.test(text) && /[a-z]/.test(text);
  }

  function decodeHexPanoId(panoId) {
    const text = String(panoId || "").trim();
    if (!text || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return text;

    let decoded = "";
    for (let index = 0; index < text.length; index += 2) {
      const code = Number.parseInt(text.slice(index, index + 2), 16);
      if (code < 32 || code > 126) return text;
      decoded += String.fromCharCode(code);
    }

    return decoded;
  }

  function haversineKm(a, b) {
    if (!a || !b) return null;
    const radiusKm = 6371.0088;
    const toRad = (degrees) => (degrees * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * radiusKm * Math.asin(Math.sqrt(h));
  }

  function readStoredRows() {
    try {
      const rawRows = GM_getValue(STORAGE_KEY, []);
      return Array.isArray(rawRows) ? rawRows : [];
    } catch (_error) {
      return [];
    }
  }

  function writeStoredRows(rows) {
    GM_setValue(STORAGE_KEY, rows);
  }

  function readLastCapture() {
    try {
      const capture = GM_getValue(LAST_CAPTURE_KEY, null);
      return capture && Array.isArray(capture.rows) ? capture : null;
    } catch (_error) {
      return null;
    }
  }

  function writeLastCapture(capture) {
    GM_setValue(LAST_CAPTURE_KEY, capture);
  }

  function clearLastCapture() {
    GM_setValue(LAST_CAPTURE_KEY, null);
  }

  function readApiCache() {
    try {
      const rawEntries = GM_getValue(API_CACHE_KEY, []);
      return Array.isArray(rawEntries) ? rawEntries : [];
    } catch (_error) {
      return [];
    }
  }

  function writeApiCache(entries) {
    GM_setValue(API_CACHE_KEY, entries.slice(-MAX_API_CACHE_ENTRIES));
  }

  function rememberApiPayload(url, payload) {
    if (!payload || typeof payload !== "object") return;
    const entries = readApiCache();
    entries.push({ captured_at: new Date().toISOString(), page_url: window.location.href, api_url: String(url), payload });
    writeApiCache(entries);
  }

  function shouldCaptureApiUrl(url) {
    const text = String(url || "").toLowerCase();
    return text.includes("/api/v3/games") || text.includes("/api/v3/challenges") || text.includes("/api/v4/games") || text.includes("/api/v4/challenges") || text.includes("/api/v3/results") || text.includes("/api/v4/results");
  }

  function installNetworkCapture() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function" && !originalFetch.__geoguessrCaptureWrapped) {
      const wrappedFetch = async function fetchWithGeoGuessrCapture(...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
          if (shouldCaptureApiUrl(requestUrl)) {
            response.clone().json().then((payload) => rememberApiPayload(requestUrl, payload)).catch(() => {});
          }
        } catch (_error) {
          // Ignore capture errors so the page keeps working normally.
        }
        return response;
      };
      wrappedFetch.__geoguessrCaptureWrapped = true;
      window.fetch = wrappedFetch;
    }

    const OriginalXMLHttpRequest = window.XMLHttpRequest;
    if (typeof OriginalXMLHttpRequest === "function" && !OriginalXMLHttpRequest.__geoguessrCaptureWrapped) {
      window.XMLHttpRequest = function XMLHttpRequestWithGeoGuessrCapture() {
        const xhr = new OriginalXMLHttpRequest();
        let requestUrl = "";
        const originalOpen = xhr.open;
        xhr.open = function wrappedOpen(method, url, ...rest) {
          requestUrl = String(url || "");
          return originalOpen.call(xhr, method, url, ...rest);
        };
        xhr.addEventListener("load", () => {
          try {
            if (!shouldCaptureApiUrl(requestUrl)) return;
            const contentType = xhr.getResponseHeader("content-type") || "";
            if (!contentType.includes("json") && typeof xhr.responseText !== "string") return;
            const payload = JSON.parse(xhr.responseText);
            rememberApiPayload(requestUrl, payload);
          } catch (_error) {
            // Ignore non-JSON or inaccessible responses.
          }
        });
        return xhr;
      };
      window.XMLHttpRequest.__geoguessrCaptureWrapped = true;
    }
  }

  function stableStringify(value) {
    const seen = new WeakSet();

    return JSON.stringify(value, function replacer(key, current) {
      if (typeof current === "function") return undefined;
      if (current && typeof current === "object") {
        if (seen.has(current)) return undefined;
        seen.add(current);
      }
      return current;
    });
  }

  function collectCandidateRoots(options = {}) {
    const roots = [];
    const currentGameId = getGameIdFromUrl();

    if (window.__NEXT_DATA__) roots.push({ source: "window.__NEXT_DATA__", value: window.__NEXT_DATA__ });
    if (window.__NUXT__) roots.push({ source: "window.__NUXT__", value: window.__NUXT__ });
    if (window.__APOLLO_STATE__) roots.push({ source: "window.__APOLLO_STATE__", value: window.__APOLLO_STATE__ });
    if (window.__RELAY_STORE__) roots.push({ source: "window.__RELAY_STORE__", value: window.__RELAY_STORE__ });

    if (options.includeApiCache !== false) {
      for (const entry of readApiCache()) {
        if (currentGameId && !apiCacheEntryMatchesCurrentGame(entry, currentGameId)) continue;
        roots.push({ source: `api-cache:${entry.api_url}`, value: entry.payload });
      }
    }

    for (const script of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')) {
      const text = script.textContent?.trim();
      if (!text) continue;
      try {
        roots.push({ source: `script#${script.id || "application-json"}`, value: JSON.parse(text) });
      } catch (_error) {
        // Ignore non-JSON scripts.
      }
    }

    return roots;
  }

  function apiCacheEntryMatchesCurrentGame(entry, currentGameId) {
    if (!entry || !currentGameId) return false;
    const apiUrl = String(entry.api_url || "");
    const pageUrl = String(entry.page_url || "");
    if (apiUrl.includes(currentGameId) || pageUrl.includes(currentGameId)) return true;
    return payloadHasGameId(entry.payload, currentGameId, new WeakSet());
  }

  function payloadHasGameId(value, gameId, seen, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) return value.some((item) => payloadHasGameId(item, gameId, seen, depth + 1));

    const possibleIds = [value.token, value.id, value.gameId, value.challengeId, value.gameToken, value.challengeToken];
    if (possibleIds.some((id) => String(id || "") === gameId)) return true;

    for (const key of Object.keys(value)) {
      if (payloadHasGameId(value[key], gameId, seen, depth + 1)) return true;
    }
    return false;
  }

  function looksLikeRound(value) {
    if (!isPlainObject(value)) return false;

    const trueLocation = extractTrueLocation(value);
    const guessLocation = extractGuessLocation(value);
    const hasRoundFields =
      "roundNumber" in value ||
      "round" in value ||
      "score" in value ||
      "distance" in value ||
      "distanceInMeters" in value ||
      "streakLocationCode" in value ||
      "panoId" in value;

    return Boolean(trueLocation && (hasRoundFields || guessLocation));
  }

  function extractTrueLocation(round) {
    return (
      normalizeLatLng(round) ||
      normalizeLatLng(round.location) ||
      normalizeLatLng(round.roundLocation) ||
      normalizeLatLng(round.trueLocation) ||
      normalizeLatLng(round.panorama) ||
      normalizeLatLng(round.pano) ||
      normalizeLatLng(round.coordinate) ||
      normalizeLatLng(round.coordinates) ||
      normalizeLatLng(round.latLng) ||
      normalizeLatLng(round.position) ||
      normalizeLatLng(round.result?.location)
    );
  }

  function extractGuessLocation(round) {
    return (
      normalizeLatLng(round.guess) ||
      normalizeLatLng(round.playerGuess) ||
      normalizeLatLng(round.guesses?.[0]) ||
      normalizeLatLng(round.guessLocation) ||
      normalizeLatLng(round.pin) ||
      normalizeLatLng(round.result?.guess) ||
      normalizeLatLng(round.roundGuess)
    );
  }

  function extractDistanceKm(round, trueLocation, guessLocation) {
    const directDistanceMeters = finiteNumber(
      firstDefined(
        round.distanceInMeters,
        round.distanceMeters,
        round.distance?.meters,
        round.distance?.amount,
        round.guess?.distanceInMeters,
        round.playerGuess?.distanceInMeters,
        round.guesses?.[0]?.distanceInMeters
      )
    );
    if (directDistanceMeters !== null) return directDistanceMeters / 1000;

    const directDistanceKm = finiteNumber(
      firstDefined(
        round.distanceKm,
        round.distanceInKm,
        round.distance?.km,
        round.guess?.distanceKm,
        round.playerGuess?.distanceKm,
        round.guesses?.[0]?.distanceKm
      )
    );
    if (directDistanceKm !== null) return directDistanceKm;

    return haversineKm(trueLocation, guessLocation);
  }

  function extractRoundNumber(round, fallbackIndex) {
    const value = finiteNumber(
      firstDefined(round.roundNumber, round.round, round.roundIndex, round.index, round.number)
    );
    if (value === null) return fallbackIndex + 1;
    return value === 0 ? fallbackIndex + 1 : value;
  }

  function extractScore(round, distanceKm = null) {
    const directScore = finiteNumber(
      firstDefined(
        round.score,
        round.points,
        round.roundScore,
        round.totalScore,
        round.scoreAmount,
        round.score?.amount,
        round.score?.points,
        round.result?.score,
        round.result?.points,
        round.guess?.score,
        round.guess?.points,
        round.guess?.roundScore,
        round.playerGuess?.score,
        round.playerGuess?.points,
        round.playerGuess?.roundScore,
        round.guesses?.[0]?.score,
        round.guesses?.[0]?.points,
        round.guesses?.[0]?.roundScore
      )
    );
    if (directScore !== null) return directScore;

    return calculateScoreFromDistance(distanceKm);
  }

  function calculateScoreFromDistance(distanceKm, maxDistanceKm = DEFAULT_MAX_DISTANCE_KM) {
    const distance = finiteNumber(distanceKm);
    const maxDistance = finiteNumber(maxDistanceKm);
    if (distance === null || maxDistance === null || maxDistance <= 0) return null;

    return Math.max(0, Math.min(5000, Math.round(5000 * Math.exp((-10 * distance) / maxDistance))));
  }

  function extractTimeSeconds(round) {
    const milliseconds = finiteNumber(
      firstDefined(
        round.timeInMilliseconds,
        round.timeMilliseconds,
        round.durationMilliseconds,
        round.guess?.timeInMilliseconds,
        round.playerGuess?.timeInMilliseconds,
        round.guesses?.[0]?.timeInMilliseconds
      )
    );
    if (milliseconds !== null) return milliseconds / 1000;

    return finiteNumber(
      firstDefined(
        round.time,
        round.timeSeconds,
        round.duration,
        round.durationSeconds,
        round.guess?.time,
        round.playerGuess?.time,
        round.guesses?.[0]?.time
      )
    );
  }

  function extractHeading(round) {
    return finiteNumber(
      firstDefined(
        round.heading,
        round.headingDegrees,
        round.panorama?.heading,
        round.pano?.heading,
        round.location?.heading
      )
    );
  }

  function extractPanoId(round) {
    return firstDefined(
      round.panoId,
      round.panoID,
      round.panoramaId,
      round.panoramaID,
      round.streetViewPanoId,
      round.streetViewPanoramaId,
      round.googlePanoId,
      round.googlePanoramaId,
      round.google?.panoId,
      round.google?.panoramaId,
      round.pano?.id,
      round.pano?.panoId,
      round.pano?.panoramaId,
      round.panorama?.id,
      round.panorama?.panoId,
      round.panorama?.panoramaId,
      round.location?.panoId,
      round.location?.panoID,
      round.location?.panoramaId,
      round.location?.panoramaID,
      round.location?.streetViewPanoId,
      round.location?.streetViewPanoramaId,
      round.location?.googlePanoId,
      round.location?.googlePanoramaId,
      round.roundLocation?.panoId,
      round.roundLocation?.panoramaId,
      round.trueLocation?.panoId,
      round.trueLocation?.panoramaId
    );
  }

  function flattenRounds(value, source, output, seen, depth = 0) {
    if (!value || typeof value !== "object" || depth > 12) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) flattenRounds(item, source, output, seen, depth + 1);
      return;
    }

    if (looksLikeRound(value)) output.push({ source, value });

    for (const key of Object.keys(value)) {
      if (key.toLowerCase().includes("analytics")) continue;
      flattenRounds(value[key], `${source}.${key}`, output, seen, depth + 1);
    }
  }

  function findGamePayloads(value, source, output, seen, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) findGamePayloads(item, source, output, seen, depth + 1);
      return;
    }

    if (Array.isArray(value.rounds) && value.player && Array.isArray(value.player.guesses)) {
      output.push({ source, value });
    }

    for (const key of Object.keys(value)) {
      if (key.toLowerCase().includes("analytics")) continue;
      findGamePayloads(value[key], `${source}.${key}`, output, seen, depth + 1);
    }
  }

  function buildRowFromRoundAndGuess(round, guess, roundNumber, source, gameId) {
    const trueLocation = extractTrueLocation(round);
    if (!trueLocation) return null;

    const merged = { ...round, guess, playerGuess: guess };
    const guessLocation = extractGuessLocation(merged);
    const heading = extractHeading(merged);
    const timeSeconds = extractTimeSeconds(merged);
    const distanceKm = extractDistanceKm(merged, trueLocation, guessLocation);
    const score = extractScore(merged, distanceKm);
    const panoId = normalizePanoId(extractPanoId(merged));

    return {
      captured_at: new Date().toISOString(),
      page_url: window.location.href,
      game_id: String(firstDefined(round.gameId, guess?.gameId, gameId, "")),
      round_number: roundNumber,
      true_lat: trueLocation.lat,
      true_lng: trueLocation.lng,
      guess_lat: guessLocation?.lat ?? "",
      guess_lng: guessLocation?.lng ?? "",
      distance_km: distanceKm === null ? "" : Number(distanceKm.toFixed(3)),
      score: score ?? "",
      time_seconds: timeSeconds === null ? "" : Number(timeSeconds.toFixed(3)),
      pano_id: panoId ?? "",
      street_view_url: streetViewUrl(trueLocation.lat, trueLocation.lng, heading, panoId),
      data_source: source,
    };
  }

  function buildRowsFromGamePayloads(gamePayloads) {
    const urlGameId = getGameIdFromUrl();
    const rowsByKey = new Map();

    for (const candidate of gamePayloads) {
      const game = candidate.value;
      const rounds = Array.isArray(game.rounds) ? game.rounds : [];
      const guesses = Array.isArray(game.player?.guesses) ? game.player.guesses : [];
      const gameId = String(firstDefined(game.token, game.id, game.gameId, game.challengeId, urlGameId, ""));

      rounds.forEach((round, index) => {
        const row = buildRowFromRoundAndGuess(round, guesses[index], index + 1, candidate.source, gameId);
        if (!row) return;
        rowsByKey.set([row.game_id, row.round_number].join("|"), row);
      });
    }

    return [...rowsByKey.values()].sort((a, b) => Number(a.round_number) - Number(b.round_number));
  }

  function buildRowsFromRounds(rounds) {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const gameId = pathParts.find((part) => /^[a-zA-Z0-9_-]{8,}$/.test(part)) || "";
    const seenKeys = new Map();
    const rows = [];

    rounds.forEach((candidate, index) => {
      const round = candidate.value;
      const trueLocation = extractTrueLocation(round);
      if (!trueLocation) return;

      const guessLocation = extractGuessLocation(round);
      const heading = extractHeading(round);
      const roundNumber = extractRoundNumber(round, index);
      const timeSeconds = extractTimeSeconds(round);
      const distanceKm = extractDistanceKm(round, trueLocation, guessLocation);
      const score = extractScore(round, distanceKm);
      const panoId = normalizePanoId(extractPanoId(round));

      const row = {
        captured_at: new Date().toISOString(),
        page_url: window.location.href,
        game_id: String(firstDefined(round.gameId, round.challengeId, gameId, "")),
        round_number: roundNumber,
        true_lat: trueLocation.lat,
        true_lng: trueLocation.lng,
        guess_lat: guessLocation?.lat ?? "",
        guess_lng: guessLocation?.lng ?? "",
        distance_km: distanceKm === null ? "" : Number(distanceKm.toFixed(3)),
        score: score ?? "",
        time_seconds: timeSeconds === null ? "" : Number(timeSeconds.toFixed(3)),
        pano_id: panoId ?? "",
        street_view_url: streetViewUrl(trueLocation.lat, trueLocation.lng, heading, panoId),
        data_source: candidate.source,
      };

      const key = [row.game_id, row.round_number].join("|");
      const existing = seenKeys.get(key);
      if (existing && existing.guess_lat !== "" && existing.score !== "") return;
      seenKeys.set(key, row);
    });

    rows.push(...seenKeys.values());
    rows.sort((a, b) => Number(a.round_number) - Number(b.round_number));
    return rows;
  }

  function collectRows(options = {}) {
    const candidates = [];
    const gamePayloads = [];
    const roots = collectCandidateRoots(options);

    for (const root of roots) {
      findGamePayloads(root.value, root.source, gamePayloads, new WeakSet());
    }

    const gameRows = mergeVisibleScores(buildRowsFromGamePayloads(gamePayloads));
    if (gameRows.length) return gameRows;

    for (const root of roots) {
      flattenRounds(root.value, root.source, candidates, new WeakSet());
    }

    const rows = mergeVisibleScores(buildRowsFromRounds(candidates));
    return rows.length ? rows : collectRowsFromVisibleText();
  }

  async function fetchRowsFromCurrentGame() {
    const gameId = getGameIdFromUrl();
    if (!gameId) return [];

    const endpoints = [
      `/api/v3/games/${encodeURIComponent(gameId)}`,
      `/api/v4/games/${encodeURIComponent(gameId)}`,
      `/api/v3/challenges/${encodeURIComponent(gameId)}/game`,
      `/api/v4/challenges/${encodeURIComponent(gameId)}/game`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { credentials: "include" });
        if (!response.ok) continue;
        const payload = await response.json();
        rememberApiPayload(endpoint, payload);
        const candidates = [];
        const gamePayloads = [];
        findGamePayloads(payload, `manual-fetch:${endpoint}`, gamePayloads, new WeakSet());
        const gameRows = mergeVisibleScores(buildRowsFromGamePayloads(gamePayloads));
        if (gameRows.length) return gameRows;

        flattenRounds(payload, `manual-fetch:${endpoint}`, candidates, new WeakSet());
        const rows = mergeVisibleScores(buildRowsFromRounds(candidates));
        if (rows.length) return rows;
      } catch (_error) {
        // Try the next known endpoint shape.
      }
    }

    return [];
  }

  function getGameIdFromUrl() {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return pathParts.find((part) => /^[a-zA-Z0-9_-]{8,}$/.test(part)) || "";
  }

  function getVisibleLeafText() {
    return Array.from(document.body.querySelectorAll("*"))
      .filter((element) => !SELECTORS_TO_IGNORE.includes(element.tagName.toLowerCase()))
      .map((element) => element.childNodes.length === 1 ? element.textContent : "")
      .join("\n");
  }

  function extractVisibleRoundScores() {
    const text = getVisibleLeafText();
    const scores = [];
    const scorePattern = /(?:^|\n)\s*(?:[1-5]\s*)?((?:[0-4]?\d{1,3}|5,?000|[0-4],\d{3}))\s*PTS\b/gi;
    for (const match of text.matchAll(scorePattern)) {
      const score = finiteNumber(String(match[1]).replace(/,/g, ""));
      if (score !== null && score >= 0 && score <= 5000) scores.push(score);
    }
    return scores.slice(0, 5);
  }

  function mergeVisibleScores(rows) {
    if (!rows.length) return rows;
    const visibleScores = extractVisibleRoundScores();
    if (!visibleScores.length) return rows;

    return rows.map((row, index) => ({
      ...row,
      score: visibleScores[Number(row.round_number) - 1] ?? visibleScores[index] ?? row.score,
      data_source: String(row.data_source || "").includes("visible-score") ? row.data_source : `${row.data_source}+visible-score`,
    }));
  }

  function collectRowsFromVisibleText() {
    const text = getVisibleLeafText();

    const latLngMatches = [...text.matchAll(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g)];

    return latLngMatches
      .map((match, index) => normalizeLatLng({ lat: match[1], lng: match[2] }))
      .filter(Boolean)
      .map((location, index) => ({
        captured_at: new Date().toISOString(),
        page_url: window.location.href,
        game_id: "",
        round_number: index + 1,
        true_lat: location.lat,
        true_lng: location.lng,
        guess_lat: "",
        guess_lng: "",
        distance_km: "",
        score: "",
        time_seconds: "",
        pano_id: "",
        street_view_url: streetViewUrl(location.lat, location.lng),
        data_source: "visible-text-fallback",
      }));
  }

  function csvEscape(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows) {
    const headers = [
      "captured_at",
      "page_url",
      "game_id",
      "round_number",
      "true_lat",
      "true_lng",
      "guess_lat",
      "guess_lng",
      "distance_km",
      "score",
      "time_seconds",
      "pano_id",
      "street_view_url",
      "data_source",
    ];

    return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);

    if (typeof GM_download === "function") {
      GM_download({ url: objectUrl, name: filename, saveAs: true, onload: () => URL.revokeObjectURL(objectUrl) });
      return;
    }

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function rowsToJson(rows) {
    return `${stableStringify(rows)}\n`;
  }

  function rowStorageKey(row) {
    return [row.game_id, row.round_number].join("|");
  }

  function mergeUniqueRows(existingRows, newRows) {
    const byKey = new Map();
    for (const row of [...existingRows, ...newRows]) {
      const key = rowStorageKey(row);
      const existing = byKey.get(key);
      if (!existing || completenessScore(row) >= completenessScore(existing)) byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => String(a.game_id).localeCompare(String(b.game_id)) || Number(a.round_number) - Number(b.round_number));
  }

  function removeRowsByKeys(rows, keysToRemove) {
    return rows.filter((row) => !keysToRemove.has(rowStorageKey(row)));
  }

  function completenessScore(row) {
    return ["true_lat", "true_lng", "guess_lat", "guess_lng", "distance_km", "score", "time_seconds", "street_view_url"].reduce(
      (score, key) => score + (row[key] !== undefined && row[key] !== null && row[key] !== "" ? 1 : 0),
      0
    );
  }

  function setStatus(panel, message) {
    panel.querySelector("[data-capture-status]").textContent = message;
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:320px",
      "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#111827",
      "background:#ffffff",
      "border:1px solid #d1d5db",
      "border-radius:12px",
      "box-shadow:0 12px 35px rgba(0,0,0,.22)",
      "padding:12px",
    ].join(";");

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <strong>GeoGuessr Capture</strong>
        <button type="button" data-capture-close style="border:0;background:#f3f4f6;border-radius:8px;padding:4px 8px;cursor:pointer;">Hide</button>
      </div>
      <div data-capture-status style="min-height:36px;color:#374151;margin-bottom:10px;">Ready. Open a game end screen, then capture.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button type="button" data-capture-now>Capture page</button>
        <button type="button" data-download-current-csv>Download current CSV</button>
        <button type="button" data-download-stored-csv>Download stored CSV</button>
        <button type="button" data-download-current-json>Download current JSON</button>
        <button type="button" data-download-stored-json>Download stored JSON</button>
        <button type="button" data-undo-last-capture style="grid-column:1 / -1;">Retract last stored capture</button>
        <button type="button" data-clear-store style="grid-column:1 / -1;">Clear stored rows</button>
      </div>
    `;

    for (const button of panel.querySelectorAll("button")) {
      button.style.cssText += ";border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:7px;cursor:pointer;";
    }

    let currentRows = [];

    panel.querySelector("[data-capture-close]").addEventListener("click", () => {
      panel.remove();
      createFloatingButton();
    });

    panel.querySelector("[data-capture-now]").addEventListener("click", async () => {
      setStatus(panel, "Fetching current GeoGuessr game...");
      currentRows = await fetchRowsFromCurrentGame();
      if (!currentRows.length) currentRows = collectRows({ includeApiCache: true });
      const beforeRows = readStoredRows();
      const storedRows = mergeUniqueRows(beforeRows, currentRows);
      writeStoredRows(storedRows);
      if (currentRows.length) {
        writeLastCapture({
          captured_at: new Date().toISOString(),
          row_keys: currentRows.map(rowStorageKey),
          rows: currentRows,
        });
      }
      setStatus(panel, `Captured ${currentRows.length} row(s). Stored total: ${storedRows.length}.`);
    });

    panel.querySelector("[data-download-current-csv]").addEventListener("click", async () => {
      if (!currentRows.length) currentRows = await fetchRowsFromCurrentGame();
      if (!currentRows.length) currentRows = collectRows({ includeApiCache: true });
      if (!currentRows.length) return setStatus(panel, "No round rows found on this page.");
      downloadText(`geoguessr-rounds-${Date.now()}.csv`, rowsToCsv(currentRows), "text/csv;charset=utf-8");
      setStatus(panel, `Downloading ${currentRows.length} current row(s) as CSV.`);
    });

    panel.querySelector("[data-download-stored-csv]").addEventListener("click", () => {
      const rows = readStoredRows();
      if (!rows.length) return setStatus(panel, "No stored rows yet.");
      downloadText(`geoguessr-rounds-stored-${Date.now()}.csv`, rowsToCsv(rows), "text/csv;charset=utf-8");
      setStatus(panel, `Downloading ${rows.length} stored row(s) as CSV.`);
    });

    panel.querySelector("[data-download-current-json]").addEventListener("click", async () => {
      if (!currentRows.length) currentRows = await fetchRowsFromCurrentGame();
      if (!currentRows.length) currentRows = collectRows({ includeApiCache: true });
      if (!currentRows.length) return setStatus(panel, "No round rows found on this page.");
      downloadText(`geoguessr-rounds-${Date.now()}.json`, rowsToJson(currentRows), "application/json;charset=utf-8");
      setStatus(panel, `Downloading ${currentRows.length} current row(s) as JSON.`);
    });

    panel.querySelector("[data-download-stored-json]").addEventListener("click", () => {
      const rows = readStoredRows();
      if (!rows.length) return setStatus(panel, "No stored rows yet.");
      downloadText(`geoguessr-rounds-stored-${Date.now()}.json`, rowsToJson(rows), "application/json;charset=utf-8");
      setStatus(panel, `Downloading ${rows.length} stored row(s) as JSON.`);
    });

    panel.querySelector("[data-undo-last-capture]").addEventListener("click", () => {
      const lastCapture = readLastCapture();
      if (!lastCapture || !lastCapture.row_keys?.length) return setStatus(panel, "No last stored capture to retract.");
      const keysToRemove = new Set(lastCapture.row_keys);
      const storedRows = readStoredRows();
      const updatedRows = removeRowsByKeys(storedRows, keysToRemove);
      const removedCount = storedRows.length - updatedRows.length;
      writeStoredRows(updatedRows);
      clearLastCapture();
      setStatus(panel, `Retracted ${removedCount} row(s). Stored total: ${updatedRows.length}.`);
    });

    panel.querySelector("[data-clear-store]").addEventListener("click", () => {
      writeStoredRows([]);
      writeApiCache([]);
      clearLastCapture();
      currentRows = [];
      setStatus(panel, "Stored rows, API cache, and undo history cleared.");
    });

    document.body.appendChild(panel);
  }

  function createFloatingButton() {
    if (document.getElementById(`${PANEL_ID}-button`)) return;

    const button = document.createElement("button");
    button.id = `${PANEL_ID}-button`;
    button.type = "button";
    button.textContent = "GeoGuessr Capture";
    button.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "font:13px system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#111827",
      "background:#ffffff",
      "border:1px solid #d1d5db",
      "border-radius:999px",
      "box-shadow:0 8px 24px rgba(0,0,0,.2)",
      "padding:9px 12px",
      "cursor:pointer",
    ].join(";");

    button.addEventListener("click", () => {
      button.remove();
      createPanel();
    });

    document.body.appendChild(button);
  }

  function init() {
    if (!location.hostname.endsWith("geoguessr.com")) return;
    createFloatingButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
