const { BAY_CENTER, FALLBACK_REPORTS } = require("./constants");
const { cToF, clamp, directionToCardinal, hoursSince, metersToFeet, normalizeZoneId } = require("./helpers");

const DEFAULT_TIMEOUT_MS = 9000;

async function fetchOfficialConditions() {
  try {
    const [weather, marine] = await Promise.all([fetchWeather(), fetchMarine()]);
    const waveFt = Number.isFinite(marine.waveHeightRaw)
      ? metersToFeet(marine.waveHeightRaw)
      : null;

    const waterTemp = normalizeWaterTemp(marine.waterTempRaw);
    const waterTempTrendF = computeTrend(marine.hourlyWaterTempRaw, normalizeWaterTemp);
    const windTrendMph = computeTrend(weather.hourlyWindMph, (x) => x);

    const smallBoatWindowHours = estimateSmallBoatWindowHours(
      weather.hourlyWindMph,
      marine.hourlyWaveHeightsRaw,
    );

    return {
      conditions: {
        windMph: weather.windMph,
        windDirectionDeg: weather.windDirectionDeg,
        windDirectionCardinal: directionToCardinal(weather.windDirectionDeg),
        waveFt,
        airTempF: weather.airTempF,
        waterTempF: waterTemp,
        waterTempTrendF,
        windTrendMph,
        smallBoatWindowHours,
        fetchedAt: new Date().toISOString(),
      },
      sourceStatus: {
        key: "official-conditions",
        status: "ok",
        details: "Open-Meteo weather and marine feeds loaded.",
      },
    };
  } catch (error) {
    return {
      conditions: fallbackConditions(),
      sourceStatus: {
        key: "official-conditions",
        status: "degraded",
        details: `Using fallback conditions (${String(error.message || error)})`,
      },
    };
  }
}

async function fetchWeatherAlerts() {
  const url = new URL("https://api.weather.gov/alerts/active");
  url.searchParams.set("point", `${BAY_CENTER.lat},${BAY_CENTER.lon}`);

  try {
    const data = await fetchJson(url.toString(), {
      headers: {
        "User-Agent": "SaginawBayFishingAggregator/1.0 (ops@saginawbay.local)",
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
    airTempF: 59,
    waterTempF: 54,
    waterTempTrendF: 0.8,
    windTrendMph: 0.3,
    smallBoatWindowHours: 6,
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

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      ...options,
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
