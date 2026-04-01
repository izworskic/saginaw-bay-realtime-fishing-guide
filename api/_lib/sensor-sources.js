/**
 * sensor-sources.js
 * Fetches real-time environmental data from all available Saginaw Bay sensors.
 * All public APIs, no keys required.
 */

const TIMEOUT = 8000;

/* ================================================================
   STATION REGISTRY
   Every sensor that gets plotted on the map
   ================================================================ */
const STATIONS = [
  {
    id: "ndbc-sblm4",
    name: "Saginaw Bay Light #1",
    type: "weather-station",
    source: "NDBC",
    lat: 43.810,
    lng: -83.720,
    params: ["wind", "air_temp", "pressure"],
  },
  {
    id: "ndbc-45163",
    name: "Saginaw Bay Buoy",
    type: "buoy",
    source: "NDBC/GLERL",
    lat: 43.983,
    lng: -83.599,
    params: ["wind", "waves", "water_temp", "air_temp", "currents"],
    seasonal: true,
  },
  {
    id: "ndbc-tawm4",
    name: "Tawas Point",
    type: "weather-station",
    source: "NDBC",
    lat: 44.256,
    lng: -83.444,
    params: ["wind", "air_temp"],
  },
  {
    id: "usgs-04157005",
    name: "Saginaw River at Saginaw",
    type: "stream-gauge",
    source: "USGS",
    lat: 43.427,
    lng: -83.951,
    params: ["flow", "water_temp", "gauge_height"],
  },
  {
    id: "usgs-04156000",
    name: "Tittabawassee River at Midland",
    type: "stream-gauge",
    source: "USGS",
    lat: 43.628,
    lng: -84.228,
    params: ["flow", "water_temp"],
  },
  {
    id: "noaa-9075035",
    name: "Essexville Water Level",
    type: "water-level",
    source: "NOAA CO-OPS",
    lat: 43.633,
    lng: -83.845,
    params: ["water_level"],
  },
];

/* ================================================================
   NDBC - National Data Buoy Center
   Fetches latest observation from NDBC stations
   ================================================================ */
async function fetchNdbc(stationId) {
  // NDBC provides latest observations as JSON-like text
  // Use the RSS/XML feed which is more reliable
  const url = `https://www.ndbc.noaa.gov/data/latest_obs/${stationId}.txt`;

  try {
    const text = await fetchText(url);
    return parseNdbcLatestObs(text, stationId);
  } catch (err) {
    // Try alternate: realtime2 data (last 45 days, grab first line)
    try {
      const url2 = `https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`;
      const text2 = await fetchText(url2);
      return parseNdbcRealtime2(text2, stationId);
    } catch {
      return { error: err.message || "NDBC fetch failed", stationId };
    }
  }
}

function parseNdbcLatestObs(text, stationId) {
  const lines = text.split("\n").filter(l => l.trim());
  const data = {};

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Wind
    if (lower.includes("wind") && lower.includes("kt")) {
      const match = line.match(/([\d.]+)\s*kt/i);
      if (match) data.windKt = parseFloat(match[1]);
      const dirMatch = line.match(/from the (\w+)/i) || line.match(/(\d+)\s*deg/i);
      if (dirMatch) data.windDir = dirMatch[1];
    }
    if (lower.includes("gust") && lower.includes("kt")) {
      const match = line.match(/([\d.]+)\s*kt/i);
      if (match) data.gustKt = parseFloat(match[1]);
    }
    // Air temp
    if (lower.includes("air temp") || lower.includes("air temperature")) {
      const match = line.match(/([\d.]+)\s*°?f/i) || line.match(/([\d.-]+)\s*°?c/i);
      if (match) {
        const val = parseFloat(match[1]);
        data.airTempF = line.toLowerCase().includes("c") ? val * 9/5 + 32 : val;
      }
    }
    // Water temp
    if (lower.includes("water temp") || lower.includes("sea surface")) {
      const match = line.match(/([\d.]+)\s*°?f/i) || line.match(/([\d.-]+)\s*°?c/i);
      if (match) {
        const val = parseFloat(match[1]);
        data.waterTempF = line.toLowerCase().includes("c") ? val * 9/5 + 32 : val;
      }
    }
    // Waves
    if (lower.includes("wave") && lower.includes("ft")) {
      const match = line.match(/([\d.]+)\s*ft/i);
      if (match) data.waveFt = parseFloat(match[1]);
    }
    // Pressure
    if (lower.includes("pressure") || lower.includes("baro")) {
      const match = line.match(/([\d.]+)\s*(in|mb|hpa)/i);
      if (match) data.pressureRaw = `${match[1]} ${match[2]}`;
    }
  }

  return {
    stationId,
    ...data,
    windMph: data.windKt ? round(data.windKt * 1.15078, 1) : null,
    gustMph: data.gustKt ? round(data.gustKt * 1.15078, 1) : null,
    fetchedAt: new Date().toISOString(),
    source: "ndbc-latest-obs",
  };
}

function parseNdbcRealtime2(text, stationId) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 3) return { stationId, error: "No data" };

  // Line 0: headers, Line 1: units, Line 2+: data
  const headers = lines[0].replace(/^#/, "").trim().split(/\s+/);
  const values = lines[2].trim().split(/\s+/);

  const row = {};
  headers.forEach((h, i) => {
    const v = values[i];
    if (v && v !== "MM" && v !== "99.0" && v !== "999" && v !== "9999.0") {
      row[h] = v;
    }
  });

  const windMs = parseFloat(row.WSPD);
  const gustMs = parseFloat(row.GST);
  const waveM = parseFloat(row.WVHT);
  const airTempC = parseFloat(row.ATMP);
  const waterTempC = parseFloat(row.WTMP);
  const windDeg = parseFloat(row.WDIR);
  const pressure = parseFloat(row.PRES);

  return {
    stationId,
    windMph: isFinite(windMs) ? round(windMs * 2.23694, 1) : null,
    gustMph: isFinite(gustMs) ? round(gustMs * 2.23694, 1) : null,
    windDeg: isFinite(windDeg) ? windDeg : null,
    windDir: isFinite(windDeg) ? degToCardinal(windDeg) : null,
    waveFt: isFinite(waveM) ? round(waveM * 3.28084, 1) : null,
    airTempF: isFinite(airTempC) ? round(airTempC * 9/5 + 32, 1) : null,
    waterTempF: isFinite(waterTempC) ? round(waterTempC * 9/5 + 32, 1) : null,
    pressureMb: isFinite(pressure) ? round(pressure, 1) : null,
    observedAt: row.YY && row.MM ? `${row.YY}-${row.MM}-${row.DD}T${row.hh}:${row.mm}:00Z` : null,
    fetchedAt: new Date().toISOString(),
    source: "ndbc-realtime2",
  };
}

/* ================================================================
   USGS Water Services
   Real-time streamflow and water temp
   ================================================================ */
async function fetchUsgs(siteNumber) {
  const params = new URLSearchParams({
    format: "json",
    sites: siteNumber,
    period: "PT2H",
    parameterCd: "00060,00010,00065", // discharge, water temp, gauge height
    siteStatus: "active",
  });

  const url = `https://waterservices.usgs.gov/nwis/iv/?${params}`;

  try {
    const data = await fetchJson(url, {
      headers: { Accept: "application/json" },
    });

    const timeSeries = data?.value?.timeSeries || [];
    const result = { stationId: siteNumber, fetchedAt: new Date().toISOString(), source: "usgs" };

    for (const ts of timeSeries) {
      const paramCode = ts.variable?.variableCode?.[0]?.value;
      const values = ts.values?.[0]?.value || [];
      const latest = values[values.length - 1];
      if (!latest) continue;

      const val = parseFloat(latest.value);
      if (!isFinite(val) || val < 0) continue;

      const time = latest.dateTime;

      if (paramCode === "00060") {
        result.flowCfs = round(val, 0);
        result.flowObservedAt = time;
      } else if (paramCode === "00010") {
        result.waterTempC = round(val, 1);
        result.waterTempF = round(val * 9/5 + 32, 1);
        result.tempObservedAt = time;
      } else if (paramCode === "00065") {
        result.gaugeHeightFt = round(val, 2);
        result.gaugeObservedAt = time;
      }
    }

    return result;
  } catch (err) {
    return { stationId: siteNumber, error: err.message, source: "usgs" };
  }
}

/* ================================================================
   NOAA CO-OPS - Tides and Currents (Water Level)
   ================================================================ */
async function fetchCoOps(stationId) {
  const now = new Date();
  const end = formatCoOpsDate(now);
  const begin = formatCoOpsDate(new Date(now.getTime() - 6 * 3600000));

  const params = new URLSearchParams({
    begin_date: begin,
    end_date: end,
    station: stationId,
    product: "water_level",
    datum: "IGLD",
    units: "english",
    time_zone: "gmt",
    format: "json",
    application: "SaginawBayFishingHub",
  });

  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`;

  try {
    const data = await fetchJson(url);
    const readings = data?.data || [];

    if (!readings.length) {
      return { stationId, error: "No water level data", source: "noaa-coops" };
    }

    const latest = readings[readings.length - 1];
    const oldest = readings[0];
    const levelFt = parseFloat(latest.v);
    const oldestFt = parseFloat(oldest.v);
    const trend6h = isFinite(levelFt) && isFinite(oldestFt) ? round(levelFt - oldestFt, 3) : null;

    let trendLabel = "Stable";
    if (trend6h > 0.15) trendLabel = "Rising";
    else if (trend6h < -0.15) trendLabel = "Falling";

    return {
      stationId,
      waterLevelFtIGLD: isFinite(levelFt) ? round(levelFt, 2) : null,
      trend6hFt: trend6h,
      trendLabel,
      observedAt: latest.t ? `${latest.t.replace(" ", "T")}Z` : null,
      fetchedAt: new Date().toISOString(),
      source: "noaa-coops",
    };
  } catch (err) {
    return { stationId, error: err.message, source: "noaa-coops" };
  }
}

/* ================================================================
   NWS Marine Forecasts - Inner and Outer Saginaw Bay
   ================================================================ */
async function fetchNwsMarineZone(zoneId, zoneName) {
  const url = `https://api.weather.gov/zones/forecast/${zoneId}/forecast`;

  try {
    const data = await fetchJson(url, {
      headers: {
        "User-Agent": "SaginawBayFishingHub/2.0 (saginawbay.chrisizworski.com)",
        Accept: "application/geo+json",
      },
    });

    const periods = data?.properties?.periods || [];
    const current = periods[0] || {};
    const next = periods[1] || {};

    return {
      zoneId,
      zoneName,
      currentPeriod: current.name || null,
      forecast: current.detailedForecast || null,
      shortForecast: current.shortForecast || null,
      nextPeriod: next.name || null,
      nextForecast: next.detailedForecast || null,
      fetchedAt: new Date().toISOString(),
      source: "nws-marine",
    };
  } catch (err) {
    return { zoneId, zoneName, error: err.message, source: "nws-marine" };
  }
}

/* ================================================================
   GLERL Satellite SST Image URL
   ================================================================ */
function getGlseaImageUrl() {
  // GLSEA daily composite image - Lake Huron region
  return {
    id: "glerl-sst",
    name: "Satellite Surface Temperature",
    type: "satellite",
    source: "GLERL/CoastWatch",
    imageUrl: "https://coastwatch.glerl.noaa.gov/glsea/cur/glsea_cur_h.png",
    trueColorUrl: "https://coastwatch.glerl.noaa.gov/modis/modis.php?region=h&page=1",
    contourUrl: "https://coastwatch.glerl.noaa.gov/statistic/contour/contour.h.png",
    description: "Daily satellite-derived surface temperature composite for Lake Huron / Saginaw Bay",
    fetchedAt: new Date().toISOString(),
  };
}

/* ================================================================
   MASTER FETCH - Grab everything in parallel
   ================================================================ */
async function fetchAllSensors() {
  const [
    sblm4,
    buoy45163,
    tawm4,
    saginawRiver,
    tittabawassee,
    essexville,
    innerBayForecast,
    outerBayForecast,
  ] = await Promise.all([
    safeCall(() => fetchNdbc("SBLM4"), "ndbc-sblm4"),
    safeCall(() => fetchNdbc("45163"), "ndbc-45163"),
    safeCall(() => fetchNdbc("TAWM4"), "ndbc-tawm4"),
    safeCall(() => fetchUsgs("04157005"), "usgs-04157005"),
    safeCall(() => fetchUsgs("04156000"), "usgs-04156000"),
    safeCall(() => fetchCoOps("9075035"), "noaa-9075035"),
    safeCall(() => fetchNwsMarineZone("LHZ422", "Inner Saginaw Bay"), "nws-lhz422"),
    safeCall(() => fetchNwsMarineZone("LHZ421", "Outer Saginaw Bay"), "nws-lhz421"),
  ]);

  const satellite = getGlseaImageUrl();

  return {
    generatedAt: new Date().toISOString(),
    stations: STATIONS,
    readings: {
      "ndbc-sblm4": sblm4,
      "ndbc-45163": buoy45163,
      "ndbc-tawm4": tawm4,
      "usgs-04157005": saginawRiver,
      "usgs-04156000": tittabawassee,
      "noaa-9075035": essexville,
    },
    marineForecast: {
      innerBay: innerBayForecast,
      outerBay: outerBayForecast,
    },
    satellite,
  };
}

/* ================================================================
   HELPERS
   ================================================================ */
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, {
      method: "GET",
      ...options,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function safeCall(fn, label) {
  try {
    return await fn();
  } catch (err) {
    return { error: err.message || "Unknown error", source: label };
  }
}

function formatCoOpsDate(d) {
  return d.toISOString().slice(0, 16).replace(/[-T:]/g, "").slice(0, 12);
}

function degToCardinal(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function round(v, d = 1) {
  if (!isFinite(v)) return null;
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

module.exports = {
  STATIONS,
  fetchAllSensors,
  fetchNdbc,
  fetchUsgs,
  fetchCoOps,
  fetchNwsMarineZone,
  getGlseaImageUrl,
};
