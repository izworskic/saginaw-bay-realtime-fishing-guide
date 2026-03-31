const {
  BAY_CENTER,
  FALLBACK_REPORTS,
  NOAA_WATER_LEVEL_STATION_DEFAULT,
  SHORELINE_POINT,
} = require("./constants");
const { cToF, clamp, directionToCardinal, hoursSince, metersToFeet, normalizeZoneId, round } = require("./helpers");

const DEFAULT_TIMEOUT_MS = 9000;
const NOAA_APP = "saginaw-bay-realtime-guide";

async function fetchOfficialConditions() {
  const [weatherResult, marineResult, gridResult, shorelineResult, waterLevelResult] = await Promise.all([
    safeSourceCall(fetchWeather, "open-meteo-weather"),
    safeSourceCall(fetchMarine, "open-meteo-marine"),
    safeSourceCall(fetchNwsGridMarineContext, "nws-grid"),
    safeSourceCall(fetchShorelineForecast, "nws-shoreline"),
    safeSourceCall(fetchNoaaWaterLevel, "noaa-water-level"),
  ]);

  const sourceStatuses = [
    weatherResult.sourceStatus,
    marineResult.sourceStatus,
    gridResult.sourceStatus,
    shorelineResult.sourceStatus,
    waterLevelResult.sourceStatus,
  ];

  if (!weatherResult.ok || !marineResult.ok) {
    return {
      conditions: fallbackConditions(),
      sourceStatus: {
        key: "official-conditions",
        status: "degraded",
        details: "Core weather/marine feeds unavailable; fallback conditions used.",
      },
      additionalStatuses: sourceStatuses,
    };
  }

  const weather = weatherResult.value;
  const marine = marineResult.value;
  const grid = gridResult.value;
  const shoreline = shorelineResult.value;
  const waterLevel = waterLevelResult.value;

  const waveFtOpenMeteo = Number.isFinite(marine.waveHeightRaw) ? metersToFeet(marine.waveHeightRaw) : null;
  const waveFt = blendNumbers([waveFtOpenMeteo, grid?.waveFt], 0.6);
  const windMph = blendNumbers([weather.windMph, grid?.windMph], 0.75);

  const waterTemp = normalizeWaterTemp(marine.waterTempRaw);
  const waterTempTrendF = computeTrend(marine.hourlyWaterTempRaw, normalizeWaterTemp);
  const windTrendMph = computeTrend(weather.hourlyWindMph, (x) => x);
  const smallBoatWindowHours = estimateSmallBoatWindowHours(weather.hourlyWindMph, marine.hourlyWaveHeightsRaw);

  return {
    conditions: {
      windMph,
      windDirectionDeg: weather.windDirectionDeg,
      windDirectionCardinal: directionToCardinal(weather.windDirectionDeg),
      waveFt,
      waveFtOpenMeteo,
      waveFtNoaaGrid: grid?.waveFt ?? null,
      windMphNoaaGrid: grid?.windMph ?? null,
      noaaHazardSummary: grid?.hazardSummary || null,
      skyCoverPctNoaa: grid?.skyCoverPct ?? null,
      precipChancePctNoaa: grid?.precipChancePct ?? null,
      airTempF: weather.airTempF,
      waterTempF: waterTemp,
      waterTempTrendF,
      windTrendMph,
      smallBoatWindowHours,
      smallBoatWindowLabel: classifyBoatWindow(smallBoatWindowHours),
      shorelineForecastShort: shoreline?.shortForecast || null,
      shorelineForecastDetail: shoreline?.detailedForecast || null,
      shorelineWindText: shoreline?.windText || null,
      shorelinePrecipChancePct: shoreline?.precipChancePct ?? null,
      waterLevelStationId: waterLevel?.stationId || null,
      waterLevelStationName: waterLevel?.stationName || null,
      waterLevelFtIGLD: waterLevel?.waterLevelFtIGLD ?? null,
      waterLevelTrend6hFt: waterLevel?.waterLevelTrend6hFt ?? null,
      waterLevelTrendLabel: waterLevel?.waterLevelTrendLabel || null,
      waterLevelObservedAt: waterLevel?.observedAt || null,
      fetchedAt: new Date().toISOString(),
    },
    sourceStatus: {
      key: "official-conditions",
      status: "ok",
      details: "Open-Meteo core inputs plus NOAA/NWS enrichment loaded.",
    },
    additionalStatuses: sourceStatuses,
  };
}

async function fetchWeatherAlerts() {
  const url = new URL("https://api.weather.gov/alerts/active");
  url.searchParams.set("point", `${BAY_CENTER.lat},${BAY_CENTER.lon}`);

  try {
    const data = await fetchJson(url.toString(), {
      headers: {
        "User-Agent": "SaginawBayRealtimeGuide/1.0 (ops@saginawbay.local)",
        Accept: "application/geo+json",
      },
      timeoutMs: 8000,
    });

    const alerts = Array.isArray(data.features)
      ? data.features
          .map((feature, index) => {
            const props = feature.properties || {};
            return {
              id: props.id || `alert-${index}`,
              event: props.event || "Weather alert",
              severity: props.severity || "Unknown",
              urgency: props.urgency || "Unknown",
              headline: props.headline || props.description || "No detail provided.",
              expires: props.expires || null,
            };
          })
          .slice(0, 8)
      : [];

    return {
      alerts,
      sourceStatus: {
        key: "nws-alerts",
        status: "ok",
        details: alerts.length ? `Loaded ${alerts.length} active alert(s).` : "No active alerts.",
      },
    };
  } catch (error) {
    return {
      alerts: [],
      sourceStatus: {
        key: "nws-alerts",
        status: "degraded",
        details: `Unable to load alerts (${String(error.message || error)}).`,
      },
    };
  }
}

async function fetchFishingReports() {
  const feedUrl = process.env.PRIVATE_FISH_API_URL;
  if (!feedUrl) {
    return {
      reports: fallbackReports(),
      sourceStatus: {
        key: "fishing-intel",
        status: "degraded",
        details: "PRIVATE_FISH_API_URL not configured; using fallback report seed.",
      },
    };
  }

  const timeoutMs = Number.parseInt(process.env.PRIVATE_FISH_API_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;
  const headers = {
    Accept: "application/json",
  };

  if (process.env.PRIVATE_FISH_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.PRIVATE_FISH_API_TOKEN}`;
  }

  try {
    const payload = await fetchJson(feedUrl, {
      headers,
      timeoutMs,
    });

    const reportCandidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.reports)
        ? payload.reports
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.data)
            ? payload.data
            : [];

    const normalized = reportCandidates
      .map((raw, index) => normalizeReport(raw, index))
      .filter(Boolean)
      .slice(0, 50);

    return {
      reports: normalized.length ? normalized : fallbackReports(),
      sourceStatus: {
        key: "fishing-intel",
        status: normalized.length ? "ok" : "degraded",
        details: normalized.length
          ? `Loaded ${normalized.length} report(s) from private feed.`
          : "Private feed returned no usable reports; fallback report seed used.",
      },
    };
  } catch (error) {
    return {
      reports: fallbackReports(),
      sourceStatus: {
        key: "fishing-intel",
        status: "degraded",
        details: `Private feed unavailable (${String(error.message || error)}); using fallback report seed.`,
      },
    };
  }
}

async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(BAY_CENTER.lat));
  url.searchParams.set("longitude", String(BAY_CENTER.lon));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,temperature_2m");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", BAY_CENTER.timezone);

  const data = await fetchJson(url.toString(), { timeoutMs: 8000 });
  const current = data.current || {};
  const hourly = data.hourly || {};

  return {
    windMph: toNumber(current.wind_speed_10m),
    windDirectionDeg: toNumber(current.wind_direction_10m),
    airTempF: toNumber(current.temperature_2m),
    hourlyWindMph: toNumericArray(hourly.wind_speed_10m),
  };
}

async function fetchMarine() {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", String(BAY_CENTER.lat));
  url.searchParams.set("longitude", String(BAY_CENTER.lon));
  url.searchParams.set("current", "wave_height,wave_direction,sea_surface_temperature");
  url.searchParams.set("hourly", "wave_height,sea_surface_temperature");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", BAY_CENTER.timezone);

  const data = await fetchJson(url.toString(), { timeoutMs: 8000 });
  const current = data.current || {};
  const hourly = data.hourly || {};

  return {
    waveHeightRaw: toNumber(current.wave_height),
    waveDirectionDeg: toNumber(current.wave_direction),
    waterTempRaw: toNumber(current.sea_surface_temperature),
    hourlyWaveHeightsRaw: toNumericArray(hourly.wave_height),
    hourlyWaterTempRaw: toNumericArray(hourly.sea_surface_temperature),
  };
}

async function fetchNwsGridMarineContext() {
  const headers = {
    "User-Agent": "SaginawBayRealtimeGuide/1.0 (ops@saginawbay.local)",
    Accept: "application/geo+json",
  };

  const pointUrl = `https://api.weather.gov/points/${BAY_CENTER.lat},${BAY_CENTER.lon}`;
  const pointData = await fetchJson(pointUrl, { headers, timeoutMs: 9000 });
  const gridUrl = pointData?.properties?.forecastGridData;
  if (!gridUrl) {
    throw new Error("NWS forecastGridData URL missing");
  }

  const grid = await fetchJson(gridUrl, { headers, timeoutMs: 9000 });
  const props = grid.properties || {};

  const windMph = parseNwsSeriesValue(props.windSpeed, convertNwsWindToMph);
  const waveFt = parseNwsSeriesValue(props.waveHeight, convertNwsMetersToFeet);
  const skyCoverPct = parseNwsSeriesValue(props.skyCover, (value) => value);
  const precipChancePct = parseNwsSeriesValue(props.probabilityOfPrecipitation, (value) => value);
  const hazardSummary = parseNwsHazards(props.hazards);

  return {
    windMph,
    waveFt,
    skyCoverPct: Number.isFinite(skyCoverPct) ? round(skyCoverPct) : null,
    precipChancePct: Number.isFinite(precipChancePct) ? round(precipChancePct) : null,
    hazardSummary,
  };
}

async function fetchShorelineForecast() {
  const headers = {
    "User-Agent": "SaginawBayRealtimeGuide/1.0 (ops@saginawbay.local)",
    Accept: "application/geo+json",
  };
  const pointUrl = `https://api.weather.gov/points/${SHORELINE_POINT.lat},${SHORELINE_POINT.lon}`;
  const point = await fetchJson(pointUrl, { headers, timeoutMs: 9000 });
  const forecastUrl = point?.properties?.forecast;
  if (!forecastUrl) {
    throw new Error("Shoreline forecast URL missing");
  }

  const forecast = await fetchJson(forecastUrl, { headers, timeoutMs: 9000 });
  const period = forecast?.properties?.periods?.[0];
  if (!period) {
    throw new Error("No shoreline forecast periods");
  }

  return {
    shortForecast: period.shortForecast || null,
    detailedForecast: period.detailedForecast || null,
    windText: period.windSpeed ? `${period.windDirection || ""} ${period.windSpeed}`.trim() : null,
    windMph: parseWindTextToMph(period.windSpeed),
    precipChancePct: Number.isFinite(period.probabilityOfPrecipitation?.value)
      ? period.probabilityOfPrecipitation.value
      : null,
    periodName: period.name || null,
  };
}

async function fetchNoaaWaterLevel() {
  const stationId = process.env.NOAA_WATER_LEVEL_STATION || NOAA_WATER_LEVEL_STATION_DEFAULT;
  const url = new URL("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter");
  url.searchParams.set("product", "water_level");
  url.searchParams.set("application", NOAA_APP);
  url.searchParams.set("datum", "IGLD");
  url.searchParams.set("station", stationId);
  url.searchParams.set("time_zone", "lst_ldt");
  url.searchParams.set("units", "english");
  url.searchParams.set("format", "json");
  url.searchParams.set("date", "recent");

  const payload = await fetchJson(url.toString(), { timeoutMs: 9000 });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  if (!latest) {
    throw new Error("No NOAA water-level rows");
  }

  const latestValue = toNumber(latest.v);
  const lookbackIndex = Math.max(0, rows.length - 1 - 36); // roughly 6h at 10-min intervals
  const priorValue = toNumber(rows[lookbackIndex]?.v);
  const trend6h = Number.isFinite(latestValue) && Number.isFinite(priorValue)
    ? round(latestValue - priorValue, 3)
    : null;

  return {
    stationId,
    stationName: payload.metadata?.name || "NOAA station",
    observedAt: toIsoOrNow(latest.t),
    waterLevelFtIGLD: latestValue,
    waterLevelTrend6hFt: trend6h,
    waterLevelTrendLabel: classifyWaterLevelTrend(trend6h),
  };
}

async function safeSourceCall(fn, key) {
  try {
    const value = await fn();
    return {
      ok: true,
      value,
      sourceStatus: {
        key,
        status: "ok",
        details: "Loaded",
      },
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      sourceStatus: {
        key,
        status: "degraded",
        details: String(error.message || error),
      },
    };
  }
}

function normalizeReport(raw, index) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const observedAt = raw.observedAt || raw.timestamp || raw.date || raw.createdAt || new Date().toISOString();
  const zoneId = normalizeZoneId(raw.zoneId || raw.zone || raw.area || raw.location) || raw.zoneId || "inner-bay";
  const summary = String(raw.summary || raw.text || raw.note || "Field report received.");
  const signal = normalizeSignal(raw.signal, summary);
  const species = String(raw.species || raw.targetSpecies || "mixed").toLowerCase();

  return {
    id: String(raw.id || raw.reportId || `report-${index}`),
    source: String(raw.source || raw.provider || raw.origin || "private-feed"),
    zoneId,
    species,
    signal,
    summary,
    observedAt: toIsoOrNow(observedAt),
    freshnessHours: clamp(hoursSince(observedAt), 0, 240),
  };
}

function normalizeSignal(signalValue, summaryText) {
  if (Number.isFinite(signalValue)) {
    return clamp(Number(signalValue), -1, 1);
  }

  const text = String(summaryText || "").toLowerCase();
  if (text.match(/\b(strong|hot|consistent|limit|active)\b/)) {
    return 0.6;
  }
  if (text.match(/\b(slow|tough|tougher|dead|poor|negative)\b/)) {
    return -0.45;
  }
  if (text.match(/\b(spotty|mixed|variable)\b/)) {
    return -0.05;
  }
  return 0.1;
}

function fallbackReports() {
  const now = Date.now();
  return FALLBACK_REPORTS.map((report) => ({
    id: report.id,
    source: report.source,
    zoneId: report.zoneId,
    species: report.species,
    signal: report.signal,
    summary: report.summary,
    freshnessHours: report.freshnessHours,
    observedAt: new Date(now - report.freshnessHours * 3600000).toISOString(),
  }));
}

function fallbackConditions() {
  return {
    windMph: 14,
    windDirectionDeg: 240,
    windDirectionCardinal: "SW",
    waveFt: 2.1,
    waveFtOpenMeteo: 2.1,
    waveFtNoaaGrid: null,
    windMphNoaaGrid: null,
    noaaHazardSummary: null,
    skyCoverPctNoaa: null,
    precipChancePctNoaa: null,
    airTempF: 59,
    waterTempF: 54,
    waterTempTrendF: 0.8,
    windTrendMph: 0.3,
    smallBoatWindowHours: 6,
    smallBoatWindowLabel: "Moderate Window",
    shorelineForecastShort: null,
    shorelineForecastDetail: null,
    shorelineWindText: null,
    shorelinePrecipChancePct: null,
    waterLevelStationId: null,
    waterLevelStationName: null,
    waterLevelFtIGLD: null,
    waterLevelTrend6hFt: null,
    waterLevelTrendLabel: null,
    waterLevelObservedAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

function estimateSmallBoatWindowHours(hourlyWindMph, hourlyWaveHeightsRaw) {
  const horizon = Math.min(24, hourlyWindMph.length, hourlyWaveHeightsRaw.length);
  let count = 0;
  for (let index = 0; index < horizon; index += 1) {
    const wind = hourlyWindMph[index];
    const waveFt = metersToFeet(hourlyWaveHeightsRaw[index]);
    if (wind <= 16 && waveFt <= 2.3) {
      count += 1;
    }
  }
  return count;
}

function classifyBoatWindow(hours) {
  if (!Number.isFinite(hours)) {
    return "Unknown";
  }
  if (hours >= 10) {
    return "Long Window";
  }
  if (hours >= 6) {
    return "Moderate Window";
  }
  if (hours >= 3) {
    return "Short Window";
  }
  return "Very Short Window";
}

function classifyWaterLevelTrend(trend6h) {
  if (!Number.isFinite(trend6h)) {
    return null;
  }
  if (trend6h >= 0.15) {
    return "Rising";
  }
  if (trend6h <= -0.15) {
    return "Falling";
  }
  return "Stable";
}

function computeTrend(values, transform) {
  if (!Array.isArray(values) || values.length < 8) {
    return 0;
  }
  const early = transform(values[0]);
  const later = transform(values[8]);
  if (!Number.isFinite(early) || !Number.isFinite(later)) {
    return 0;
  }
  return later - early;
}

function normalizeWaterTemp(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value > 38 && value < 120) {
    return value;
  }
  return cToF(value);
}

function parseNwsSeriesValue(series, converter) {
  const values = Array.isArray(series?.values) ? series.values : [];
  for (const entry of values) {
    const raw = toNumber(entry?.value);
    if (!Number.isFinite(raw)) {
      continue;
    }
    const converted = converter(raw, series?.uom);
    if (Number.isFinite(converted)) {
      return round(converted, 2);
    }
  }
  return null;
}

function parseNwsHazards(series) {
  const values = Array.isArray(series?.values) ? series.values : [];
  const firstActive = values.find((entry) => Array.isArray(entry?.value) && entry.value.length);
  if (!firstActive) {
    return null;
  }

  const tags = firstActive.value
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === "string") {
        return item;
      }
      if (item.phenomenon && item.significance) {
        return `${item.phenomenon}.${item.significance}`;
      }
      return null;
    })
    .filter(Boolean);

  return tags.length ? `NWS grid hazards: ${tags.join(", ")}` : null;
}

function parseWindTextToMph(text) {
  const value = String(text || "");
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)/g)].map((entry) => Number(entry[1]));
  if (!matches.length) {
    return null;
  }
  return round(matches.reduce((sum, n) => sum + n, 0) / matches.length, 1);
}

function convertNwsWindToMph(value, uom) {
  if (String(uom || "").toLowerCase().includes("km_h")) {
    return value * 0.621371;
  }
  if (String(uom || "").toLowerCase().includes("m_s")) {
    return value * 2.23694;
  }
  return value;
}

function convertNwsMetersToFeet(value, uom) {
  if (String(uom || "").toLowerCase().includes("m")) {
    return metersToFeet(value);
  }
  return value;
}

function blendNumbers(values, primaryWeight = 0.7) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  if (valid.length === 1) {
    return round(valid[0], 2);
  }

  const [first, second] = valid;
  const p = clamp(primaryWeight, 0.5, 0.95);
  return round(first * p + second * (1 - p), 2);
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;

  try {
    const response = await fetch(url, {
      method: "GET",
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function toNumericArray(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(toNumber).filter((value) => Number.isFinite(value));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoOrNow(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

module.exports = {
  fetchFishingReports,
  fetchOfficialConditions,
  fetchWeatherAlerts,
};
