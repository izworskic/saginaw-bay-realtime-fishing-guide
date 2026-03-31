const { SPECIES } = require("./_lib/constants");
const { fetchFishingReports, fetchOfficialConditions, fetchWeatherAlerts } = require("./_lib/data-sources");
const { buildDailySummary } = require("./_lib/scoring");
const { maybeGenerateCaptainNote } = require("./_lib/ai-insights");

const APP_TIMEZONE = "America/Detroit";
const dailyCache = new Map();
const inFlight = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, "method-not-allowed");
    return;
  }

  const species = normalizeSpecies(req.query?.species);
  const includeAi = String(req.query?.includeAi || "") === "1";
  const todayKey = getDateKeyInTimeZone(APP_TIMEZONE);
  const requestedDay = normalizeDayKey(req.query?.day);
  const snapshotDate = requestedDay === todayKey ? requestedDay : todayKey;
  const cacheKey = `${snapshotDate}:${species}`;

  trimOldCache(todayKey);

  const cached = dailyCache.get(cacheKey);
  if (cached) {
    const payload = await maybeAttachCaptainNote(cached.payload, includeAi);
    cached.payload = payload;
    sendJson(res, 200, { ...payload, cache: "daily-hit" }, "daily-hit");
    return;
  }

  if (inFlight.has(cacheKey)) {
    const inFlightPayload = await inFlight.get(cacheKey);
    const payload = await maybeAttachCaptainNote(inFlightPayload, includeAi);
    sendJson(res, 200, { ...payload, cache: "daily-hit-inflight" }, "daily-hit-inflight");
    return;
  }

  const buildPromise = buildSnapshot(species, snapshotDate)
    .then((payload) => {
      dailyCache.set(cacheKey, {
        payload,
        createdAt: Date.now(),
      });
      return payload;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, buildPromise);

  try {
    const inFlightPayload = await buildPromise;
    const payload = await maybeAttachCaptainNote(inFlightPayload, includeAi);
    const cachedAfterBuild = dailyCache.get(cacheKey);
    if (cachedAfterBuild) {
      cachedAfterBuild.payload = payload;
    }
    sendJson(res, 200, { ...payload, cache: "daily-miss" }, "daily-miss");
  } catch (error) {
    sendJson(
      res,
      500,
      {
        error: "Failed to compute daily summary",
        detail: String(error.message || error),
      },
      "error",
    );
  }
};

async function buildSnapshot(species, snapshotDate) {
  const [official, alertResult, fishing] = await Promise.all([
    fetchOfficialConditions(),
    fetchWeatherAlerts(),
    fetchFishingReports(),
  ]);

  const payload = buildDailySummary({
    conditions: official.conditions,
    alerts: alertResult.alerts,
    reports: fishing.reports,
    speciesKey: species,
    sourceStatuses: [
      official.sourceStatus,
      ...(Array.isArray(official.additionalStatuses) ? official.additionalStatuses : []),
      alertResult.sourceStatus,
      fishing.sourceStatus,
    ],
  });

  payload.apiVersion = "2026-03-31";
  payload.snapshotDate = snapshotDate;
  payload.snapshotLocked = true;
  return payload;
}

async function maybeAttachCaptainNote(payload, includeAi) {
  if (!includeAi) {
    return payload;
  }

  if (payload.captainNote?.text) {
    return payload;
  }

  const note = await maybeGenerateCaptainNote(payload);
  if (!note?.text) {
    return {
      ...payload,
      ai: {
        available: Boolean(process.env.OPENAI_API_KEY),
        requested: true,
        generated: false,
      },
    };
  }

  return {
    ...payload,
    captainNote: note,
    ai: {
      available: true,
      requested: true,
      generated: true,
      model: note.model,
    },
  };
}

function normalizeSpecies(input) {
  const key = String(input || "").toLowerCase();
  return SPECIES[key] ? key : "walleye";
}

function normalizeDayKey(input) {
  const value = String(input || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimOldCache(activeDayKey) {
  const maxEntries = 24;
  for (const [cacheKey] of dailyCache.entries()) {
    if (!cacheKey.startsWith(`${activeDayKey}:`)) {
      dailyCache.delete(cacheKey);
    }
  }

  if (dailyCache.size <= maxEntries) {
    return;
  }

  const oldest = [...dailyCache.entries()]
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
    .slice(0, dailyCache.size - maxEntries);
  for (const [key] of oldest) {
    dailyCache.delete(key);
  }
}

function getDateKeyInTimeZone(timeZone, date = new Date()) {
  const parts = getZonedParts(timeZone, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function secondsUntilNextDayInTimeZone(timeZone, date = new Date()) {
  const parts = getZonedParts(timeZone, date);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const secondsPassed = hour * 3600 + minute * 60 + second;
  const remaining = 86400 - secondsPassed;
  return Math.max(60, Math.min(90000, remaining));
}

function getZonedParts(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const pieces = formatter.formatToParts(date);
  return Object.fromEntries(pieces.map((piece) => [piece.type, piece.value]));
}

function sendJson(res, status, payload, cacheMode) {
  const sMaxAge = secondsUntilNextDayInTimeZone(APP_TIMEZONE);
  const cacheHeader = `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=60`;

  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheHeader);
  res.setHeader("CDN-Cache-Control", cacheHeader);
  res.setHeader("Vercel-CDN-Cache-Control", cacheHeader);
  if (payload?.snapshotDate) {
    res.setHeader("X-Snapshot-Date", payload.snapshotDate);
  }
  if (cacheMode) {
    res.setHeader("X-Cache-Mode", cacheMode);
  }
  res.json(payload);
}
