/* ============================================
   Saginaw Bay Fishing Hub v3
   Map-first fishing intelligence
   ============================================ */

const SUMMARY_EP = "/api/daily-summary";
const SENSORS_EP = "/api/sensors";
const REPORTS_EP = "/api/reports";
const TZ = "America/Detroit";
const SNAP_PREFIX = "saginaw:daily-snapshot";
const API_VER = "2026-03-31-rich-zones-v2";

const state = {
  loading: false, error: null, data: null, dataSource: null,
  sensors: null, reports: null,
  favorites: loadStored("saginaw:favorites", { zones: [], launches: [], species: "walleye" }),
};

let map = null;
const mapLayers = { sensors: [], launches: [], structure: [], reports: [], overlay: null };

const $ = id => document.getElementById(id);
const ui = {
  badge: $("bay-call-badge"), updated: $("updated-at"),
  best: $("hero-best"), avoid: $("hero-avoid"), conf: $("hero-confidence"),
  rationale: $("hero-rationale"), captainNote: $("captain-note"),
  condGrid: $("conditions-grid"), zonesGrid: $("zones-grid"),
  launches: $("launches-list"), reportsList: $("reports-list"),
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-species]");
  if (t) { state.favorites.species = t.dataset.species; saveStored("saginaw:favorites", state.favorites); updateSpeciesUI(); fetchSummary(); return; }
  if (e.target.closest("[data-action='generate-ai-note']")) { fetchSummary(true); return; }
  const f = e.target.closest("[data-fav-kind]");
  if (f) { toggleFav(f.dataset.favKind, f.dataset.favId); return; }
});

/* ================================================================
   KNOWN FISHING STRUCTURE
   The landmarks anglers actually reference
   ================================================================ */
const STRUCTURE = [
  { id: "spoils-island", name: "Spoils Island", lat: 43.655, lng: -83.815, type: "structure", desc: "Perch staging area. Fish east and west sides in 14-17 ft." },
  { id: "callahan-reef", name: "Callahan Reef", lat: 43.70, lng: -83.56, type: "reef", desc: "Hard bottom reef complex. Walleye on the edges in 12-16 ft." },
  { id: "pinconning-bar", name: "Pinconning Bar", lat: 43.68, lng: -83.88, type: "bar", desc: "Sand bar structure. Walleye staging area in spring transition." },
  { id: "gravelly-shoal", name: "Gravelly Shoal", lat: 43.97, lng: -83.55, type: "reef", desc: "Outer bay reef near light. Structure holds fish when current runs." },
  { id: "the-slot", name: "The Slot", lat: 43.72, lng: -83.65, type: "area", desc: "Prime walleye trolling corridor between inner and outer bay. 14-25 ft." },
  { id: "cigar-area", name: "Cigar / Black Hole", lat: 43.66, lng: -83.84, type: "area", desc: "Known walleye concentration area near inner bay transition." },
  { id: "finn-road", name: "Finn Road Area", lat: 43.70, lng: -83.73, type: "area", desc: "Popular access corridor. Walleye in 17-22 ft along the break." },
  { id: "thomas-road", name: "Thomas Road", lat: 43.66, lng: -83.77, type: "area", desc: "East of Spoils. Perch and walleye in 18-25 ft." },
  { id: "saganing-bar", name: "Saganing Bar", lat: 43.73, lng: -83.87, type: "bar", desc: "West side bar. Perch in 10-15 ft along the edge." },
  { id: "fish-point", name: "Fish Point", lat: 43.72, lng: -83.48, type: "point", desc: "East side point. Shore fishing access. Walleye along the break." },
  { id: "old-channel", name: "Old Shipping Channel", lat: 43.64, lng: -83.80, type: "channel", desc: "Channel edges hold walleye. Best when current aligns with drift." },
];

/* ---- Launch sites ---- */
const LAUNCHES = [
  { id: "linwood", name: "Linwood Beach Marina", lat: 43.7245, lng: -83.9393, zone: "west-side" },
  { id: "au-gres", name: "Au Gres Harbor", lat: 44.0430, lng: -83.6963, zone: "west-side" },
  { id: "sebewaing", name: "Sebewaing Harbor", lat: 43.7306, lng: -83.4482, zone: "east-side" },
  { id: "quanicassee", name: "Quanicassee DNR", lat: 43.6162, lng: -83.5780, zone: "east-side" },
  { id: "bay-city-state-park", name: "Bay City State Park", lat: 43.5555, lng: -83.8582, zone: "river-mouth" },
  { id: "essexville", name: "Essexville Access", lat: 43.6119, lng: -83.8425, zone: "inner-bay" },
  { id: "channel-access", name: "Channel Access", lat: 43.6350, lng: -83.8010, zone: "shipping-channel" },
];

/* ================================================================
   SVG ICON FACTORY
   Consistent, purpose-built icons for every marker type
   ================================================================ */
const SVG = {
  wind(mph, dir) {
    const c = mph <= 10 ? "#2d8659" : mph <= 18 ? "#c68b2c" : "#b84040";
    return `<div class="m-wind" style="--c:${c}">
      <svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 2 L14 8 H11 V18 H9 V8 H6 Z" fill="${c}" opacity="0.9"/></svg>
      <span class="m-val">${Math.round(mph)}</span>
      <span class="m-unit">${dir || ""}</span>
    </div>`;
  },
  water(tempF) {
    const c = tempF < 42 ? "#5a6b78" : tempF < 50 ? "#3d7a9c" : tempF < 60 ? "#2d8659" : "#c68b2c";
    return `<div class="m-water" style="--c:${c}">
      <svg viewBox="0 0 16 20" width="12" height="15"><path d="M8 2 Q12 8 12 12 A4 4 0 0 1 4 12 Q4 8 8 2Z" fill="${c}"/></svg>
      <span class="m-val">${Math.round(tempF)}&deg;</span>
    </div>`;
  },
  gauge(flowCfs, tempF) {
    const label = flowCfs ? `${(flowCfs/1000).toFixed(1)}k` : "--";
    return `<div class="m-gauge">
      <svg viewBox="0 0 18 20" width="14" height="16"><rect x="3" y="2" width="12" height="16" rx="2" fill="#3d7a9c" opacity="0.85"/><rect x="5" y="8" width="8" height="8" rx="1" fill="#fff" opacity="0.6"/></svg>
      <span class="m-val">${label}</span>
      ${tempF ? `<span class="m-sub">${Math.round(tempF)}&deg;</span>` : ""}
    </div>`;
  },
  level(ft, trend) {
    const arrow = trend === "Rising" ? "\u2191" : trend === "Falling" ? "\u2193" : "\u2192";
    return `<div class="m-level">
      <svg viewBox="0 0 18 14" width="16" height="12"><path d="M0 7 Q4.5 3 9 7 Q13.5 11 18 7" stroke="#3d7a9c" fill="none" stroke-width="2.5"/></svg>
      <span class="m-val">${ft ? ft.toFixed(1) : "--"} ${arrow}</span>
    </div>`;
  },
  launch(score) {
    const c = score >= 60 ? "#2d8659" : score >= 40 ? "#c68b2c" : "#b84040";
    return `<div class="m-launch" style="--c:${c}">
      <svg viewBox="0 0 22 22" width="20" height="20"><path d="M11 3 L18 14 H15 L15 19 H7 L7 14 H4 Z" fill="${c}" stroke="#fff" stroke-width="1.5"/></svg>
      ${score > 0 ? `<span class="m-score">${score}</span>` : ""}
    </div>`;
  },
  fish(type) {
    const fills = { reef: "#c68b2c", bar: "#8b6914", structure: "#5a6b78", channel: "#3d7a9c", area: "#2d8659", point: "#6b5b3c" };
    const c = fills[type] || "#5a6b78";
    return `<div class="m-fish" style="--c:${c}">
      <svg viewBox="0 0 24 16" width="20" height="13"><path d="M2 8 Q6 2 14 4 Q18 5 20 8 Q18 11 14 12 Q6 14 2 8Z M16 7 A1 1 0 1 1 16 9" fill="${c}" stroke="#fff" stroke-width="0.8"/></svg>
    </div>`;
  },
  forecast(label, hasAlert) {
    const c = hasAlert ? "#b84040" : "#1a2e3b";
    return `<div class="m-fc ${hasAlert?"m-alert":""}"><span style="background:${c}">${label}</span></div>`;
  },
};

/* ================================================================
   MAP INIT
   ================================================================ */
function initMap() {
  map = L.map("bay-map", { center: [43.76, -83.72], zoom: 9, scrollWheelZoom: false, zoomControl: true });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 15, subdomains: "abcd",
  }).addTo(map);

  addStructure();
}

/* ---- Known fishing structure ---- */
function addStructure() {
  for (const s of STRUCTURE) {
    const icon = L.divIcon({
      className: "map-marker", html: SVG.fish(s.type),
      iconSize: [28, 20], iconAnchor: [14, 10],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
    m.bindTooltip(`<strong>${esc(s.name)}</strong>`, { direction: "top", offset: [0, -8], className: "tip-structure" });
    m.bindPopup(`<div class="pop"><strong>${esc(s.name)}</strong><br>${esc(s.desc)}</div>`, { maxWidth: 260 });
    mapLayers.structure.push(m);
  }
}

/* ---- Sensor stations on map ---- */
function renderSensorsOnMap(data) {
  mapLayers.sensors.forEach(l => map.removeLayer(l));
  mapLayers.sensors = [];
  if (!data?.stations || !data?.readings) return;

  for (const station of data.stations) {
    const r = data.readings[station.id] || {};
    if (r.error && !r.windMph && !r.flowCfs && !r.waterLevelFtIGLD) continue;

    let html, size, anchor;

    if (station.type === "buoy" || station.type === "weather-station") {
      html = SVG.wind(r.windMph || 0, r.windDir || "");
      if (r.waterTempF) html += SVG.water(r.waterTempF);
      size = [80, 40]; anchor = [40, 20];
    } else if (station.type === "stream-gauge") {
      html = SVG.gauge(r.flowCfs, r.waterTempF);
      size = [70, 36]; anchor = [35, 18];
    } else if (station.type === "water-level") {
      html = SVG.level(r.waterLevelFtIGLD, r.trendLabel);
      size = [80, 30]; anchor = [40, 15];
    } else {
      continue;
    }

    const icon = L.divIcon({ className: "map-marker", html, iconSize: size, iconAnchor: anchor });
    const marker = L.marker([station.lat, station.lng], { icon }).addTo(map);

    marker.bindPopup(buildSensorPopup(station, r), { maxWidth: 300, className: "pop-sensor" });
    mapLayers.sensors.push(marker);
  }

  // Marine forecast zones
  const mf = data.marineForecast || {};
  if (mf.innerBay && !mf.innerBay.error) {
    const ib = mf.innerBay;
    const icon = L.divIcon({ className: "map-marker", html: SVG.forecast("INNER BAY", !!ib.advisory), iconSize: [80, 24], iconAnchor: [40, 12] });
    const m = L.marker([43.64, -83.76], { icon }).addTo(map);
    m.bindPopup(buildForecastPopup("Inner Saginaw Bay", ib), { maxWidth: 340 });
    mapLayers.sensors.push(m);
  }
  if (mf.outerBay && !mf.outerBay.error) {
    const ob = mf.outerBay;
    const icon = L.divIcon({ className: "map-marker", html: SVG.forecast("OUTER BAY", !!ob.advisory), iconSize: [80, 24], iconAnchor: [40, 12] });
    const m = L.marker([43.96, -83.64], { icon }).addTo(map);
    m.bindPopup(buildForecastPopup("Outer Saginaw Bay", ob), { maxWidth: 340 });
    mapLayers.sensors.push(m);
  }

  // Satellite SST
  if (data.satellite?.imageUrl) {
    const icon = L.divIcon({ className: "map-marker", html: SVG.forecast("SAT SST", false), iconSize: [60, 24], iconAnchor: [30, 12] });
    const m = L.marker([44.08, -83.82], { icon }).addTo(map);
    m.bindPopup(`<div class="pop"><strong>Satellite Surface Temp</strong><br><a href="${esc(data.satellite.imageUrl)}" target="_blank">GLSEA SST Map (Lake Huron)</a><br><a href="${esc(data.satellite.trueColorUrl||"")}" target="_blank">True Color Satellite Image</a><br><small>Daily composite from GLERL/CoastWatch</small></div>`);
    mapLayers.sensors.push(m);
  }

  // Conditions overlay
  renderMapOverlay(data);
}

/* ---- Launch markers with scores from zone data ---- */
function renderLaunchesOnMap() {
  mapLayers.launches.forEach(l => map.removeLayer(l));
  mapLayers.launches = [];

  const launchScores = {};
  if (state.data?.launches) {
    for (const l of state.data.launches) launchScores[l.id] = l;
  }

  for (const launch of LAUNCHES) {
    const scored = launchScores[launch.id] || {};
    const score = scored.score || 0;
    const icon = L.divIcon({
      className: "map-marker", html: SVG.launch(score),
      iconSize: [28, 28], iconAnchor: [14, 24],
    });
    const m = L.marker([launch.lat, launch.lng], { icon }).addTo(map);
    m.bindTooltip(`<strong>${esc(launch.name)}</strong>${score ? `<br>Score: ${score}` : ""}`, { direction: "top", offset: [0, -22], className: "tip-launch" });
    m.bindPopup(`<div class="pop"><strong>${esc(launch.name)}</strong><br>Zone: ${esc(scored.zoneName || launch.zone)}<br>Score: <strong>${score}</strong><br>${esc(scored.advice||"")}<br><small>${esc(scored.exposureSummary||"")}</small><br><small>${esc(scored.notes||"")}</small></div>`, { maxWidth: 280 });
    mapLayers.launches.push(m);
  }
}

/* ---- Fishing report hotspots ---- */
function renderReportsOnMap() {
  mapLayers.reports.forEach(l => map.removeLayer(l));
  mapLayers.reports = [];
  if (!state.reports?.reports?.length) return;

  // Aggregate by zone, plot at zone center
  const ZONE_CENTER = {
    "west-side": [43.82, -83.87], "east-side": [43.70, -83.50], "inner-bay": [43.65, -83.78],
    "outer-bay": [43.97, -83.62], "river-mouth": [43.58, -83.88], "shipping-channel": [43.65, -83.80],
    "reefs": [43.82, -83.58], "bay-wide": [43.74, -83.72],
  };

  const byZone = {};
  for (const r of state.reports.reports) {
    const z = r.primaryZone || "bay-wide";
    if (!byZone[z]) byZone[z] = [];
    byZone[z].push(r);
  }

  for (const [zone, reports] of Object.entries(byZone)) {
    const center = ZONE_CENTER[zone];
    if (!center) continue;
    const avgSig = reports.reduce((s,r) => s + (r.signal||0), 0) / reports.length;
    const c = avgSig >= 0.3 ? "#2d8659" : avgSig <= -0.15 ? "#b84040" : "#c68b2c";
    const count = reports.length;

    const icon = L.divIcon({
      className: "map-marker",
      html: `<div class="m-report" style="--c:${c}"><span class="m-rcount">${count}</span><span class="m-rlabel">${sigWord(avgSig)}</span></div>`,
      iconSize: [70, 24], iconAnchor: [35, 12],
    });
    const m = L.marker(center, { icon }).addTo(map);

    const popItems = reports.slice(0, 4).map(r => {
      const tags = [...(r.species||[]).map(cap), r.depth ? `${r.depth.min}-${r.depth.max}ft` : null, ...(r.lure||[])].filter(Boolean);
      return `<div class="pop-report-item"><p>${esc(r.summary?.slice(0,150)||"")}</p>${tags.length ? `<small>${tags.join(" / ")}</small>` : ""}<small class="pop-src">${esc(r.sourceName||"")}</small></div>`;
    }).join("");

    m.bindPopup(`<div class="pop"><strong>${esc(zoneLabel(zone))} Reports</strong> (${count})<br>Signal: <strong style="color:${c}">${sigWord(avgSig)}</strong>${popItems}</div>`, { maxWidth: 320 });
    mapLayers.reports.push(m);
  }
}

/* ---- Map conditions overlay ---- */
function renderMapOverlay(sensorData) {
  const el = document.getElementById("map-overlay");
  if (!el) return;

  const r = sensorData?.readings || {};
  const sblm4 = r["ndbc-sblm4"] || {};
  const tawas = r["ndbc-tawm4"] || {};
  const river = r["usgs-04157005"] || {};
  const level = r["noaa-9075035"] || {};
  const mf = sensorData?.marineForecast?.innerBay || {};

  const items = [];
  if (sblm4.windMph != null) items.push(`<div class="ov-item"><span class="ov-k">Bay Light Wind</span><span class="ov-v">${Math.round(sblm4.windMph)} mph ${sblm4.windDir||""}</span></div>`);
  if (tawas.windMph != null) items.push(`<div class="ov-item"><span class="ov-k">Tawas Wind</span><span class="ov-v">${Math.round(tawas.windMph)} mph</span></div>`);
  if (river.waterTempF != null) items.push(`<div class="ov-item"><span class="ov-k">River Temp</span><span class="ov-v">${Math.round(river.waterTempF)}&deg;F</span></div>`);
  if (river.flowCfs != null) items.push(`<div class="ov-item"><span class="ov-k">River Flow</span><span class="ov-v">${river.flowCfs.toLocaleString()} cfs</span></div>`);
  if (level.waterLevelFtIGLD != null) items.push(`<div class="ov-item"><span class="ov-k">Essexville Level</span><span class="ov-v">${level.waterLevelFtIGLD} ft ${level.trendLabel||""}</span></div>`);
  if (mf.advisory) items.push(`<div class="ov-item ov-alert"><span class="ov-k">Advisory</span><span class="ov-v">${esc(mf.advisory.slice(0,60))}</span></div>`);

  el.innerHTML = items.join("") || '<div class="ov-item"><span class="ov-k">Sensors</span><span class="ov-v">Loading...</span></div>';
  el.style.display = items.length ? "flex" : "none";
}

/* ---- Popup builders ---- */
function buildSensorPopup(station, r) {
  let h = `<div class="pop"><strong>${esc(station.name)}</strong><br><small>${esc(station.source)}</small><table class="pop-table">`;
  if (r.windMph != null) h += `<tr><td>Wind</td><td><strong>${r.windMph} mph ${r.windDir||""}</strong>${r.gustMph?` (G ${r.gustMph})`:""}</td></tr>`;
  if (r.waveFt != null) h += `<tr><td>Waves</td><td><strong>${r.waveFt} ft</strong></td></tr>`;
  if (r.airTempF != null) h += `<tr><td>Air</td><td>${Math.round(r.airTempF)}&deg;F</td></tr>`;
  if (r.waterTempF != null) h += `<tr><td>Water</td><td><strong>${Math.round(r.waterTempF)}&deg;F</strong></td></tr>`;
  if (r.flowCfs != null) h += `<tr><td>Flow</td><td><strong>${r.flowCfs.toLocaleString()} cfs</strong></td></tr>`;
  if (r.waterTempC != null && !r.waterTempF) h += `<tr><td>Water</td><td>${r.waterTempC}&deg;C</td></tr>`;
  if (r.gaugeHeightFt != null) h += `<tr><td>Gauge</td><td>${r.gaugeHeightFt} ft</td></tr>`;
  if (r.waterLevelFtIGLD != null) h += `<tr><td>Level</td><td><strong>${r.waterLevelFtIGLD} ft IGLD</strong></td></tr>`;
  if (r.trendLabel) h += `<tr><td>Trend</td><td>${r.trendLabel} (${r.trend6hFt != null ? (r.trend6hFt > 0 ? "+" : "") + r.trend6hFt + " ft/6h" : ""})</td></tr>`;
  if (r.pressureMb != null) h += `<tr><td>Pressure</td><td>${r.pressureMb} mb</td></tr>`;
  h += `</table>`;
  if (r.observedAt || r.flowObservedAt) h += `<small>Observed: ${relTime(r.observedAt || r.flowObservedAt)}</small>`;
  return h + "</div>";
}

function buildForecastPopup(name, fc) {
  let h = `<div class="pop"><strong>${esc(name)}</strong>`;
  if (fc.advisory) h += `<div class="pop-alert">${esc(fc.advisory)}</div>`;
  if (fc.today) h += `<p><strong>Today:</strong> ${esc(fc.today.slice(0,300))}</p>`;
  if (fc.tonight) h += `<p><strong>Tonight:</strong> ${esc(fc.tonight.slice(0,300))}</p>`;
  if (!fc.today && fc.forecast) h += `<p>${esc(fc.forecast.slice(0,400))}</p>`;
  return h + "</div>";
}

/* ================================================================
   DATA FETCHING
   ================================================================ */
function init() {
  initMap();
  updateSpeciesUI();
  fetchSummary();
  fetchSensors();
  fetchReports();
}

async function fetchSummary(includeAi = false) {
  const species = state.favorites.species || "walleye";
  const day = getDateKey();
  const key = `${SNAP_PREFIX}:${species}:${day}`;
  const cached = loadStored(key, null);
  if (cached?.snapshotDate === day && cached?.apiVersion === API_VER && (!includeAi || cached.captainNote?.text)) {
    state.data = cached; state.dataSource = "local"; state.error = null; state.loading = false;
    renderDashboard(); renderLaunchesOnMap(); return;
  }
  state.loading = true; renderLoadingState();
  try {
    const p = new URLSearchParams({ species, day });
    if (includeAi) p.set("includeAi", "1");
    const r = await fetch(`${SUMMARY_EP}?${p}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const d = await r.json();
    d.snapshotDate = d.snapshotDate || day;
    state.data = d; state.dataSource = "network"; state.loading = false; state.error = null;
    saveStored(key, d);
    renderDashboard(); renderLaunchesOnMap();
  } catch (err) { state.error = err.message; state.loading = false; renderError(); }
}

async function fetchSensors() {
  try {
    const r = await fetch(SENSORS_EP);
    if (!r.ok) throw new Error(`${r.status}`);
    state.sensors = await r.json();
    renderSensorsOnMap(state.sensors);
    if (state.data) renderConditions();
  } catch (err) { console.warn("Sensor fetch:", err.message); }
}

async function fetchReports() {
  try {
    const r = await fetch(REPORTS_EP);
    if (!r.ok) throw new Error(`${r.status}`);
    state.reports = await r.json();
    renderReportsFeed();
    renderReportsOnMap();
  } catch (err) { console.warn("Reports fetch:", err.message); }
}

/* ================================================================
   DASHBOARD RENDERING (below the map)
   ================================================================ */
function renderDashboard() { renderBayCall(); renderConditions(); renderZones(); renderLaunches(); renderCaptainNote(); }
function renderLoadingState() { ui.badge.className = "bay-call-badge loading"; ui.badge.querySelector(".call-label").textContent = "Loading..."; ui.updated.textContent = "Fetching..."; }
function renderError() { ui.badge.className = "bay-call-badge nogo"; ui.badge.querySelector(".call-label").textContent = "Error"; ui.updated.textContent = state.error || "Load failed"; }

function renderBayCall() {
  const d = state.data; if (!d) return;
  const bc = d.bayCall || {};
  ui.badge.className = `bay-call-badge ${bc.goNoGo === "GO" ? "go" : bc.goNoGo === "CAUTION" ? "caution" : "nogo"}`;
  ui.badge.querySelector(".call-label").textContent = bc.label || "Pending";
  ui.updated.textContent = `${d.snapshotDate || getDateKey()} | ${state.dataSource} | ${relTime(d.generatedAt)}`;
  ui.best.textContent = d.bestSetup?.name || "--";
  ui.avoid.textContent = d.avoidOrCaution || "--";
  ui.conf.textContent = `${cap(bc.confidenceLabel || "unknown")} (${bc.confidenceScore ?? "--"})`;
  const reasons = (bc.rationale || []).slice(0, 5);
  ui.rationale.innerHTML = reasons.length ? `<ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>` : '<p class="muted">No rationale.</p>';
}

function renderConditions() {
  const c = state.data?.conditions; if (!c) return;
  const s = state.sensors?.readings || {};
  const river = s["usgs-04157005"]; const titt = s["usgs-04156000"];
  const fields = [
    { l: "Wind", v: c.windMph != null ? `${Math.round(c.windMph)} mph ${c.windDirectionCardinal||""}` : "--" },
    { l: "Waves", v: c.waveFt != null ? `${fix(c.waveFt,1)} ft` : "--" },
    { l: "Air Temp", v: c.airTempF != null ? `${Math.round(c.airTempF)}\u00B0F` : "--" },
    { l: "Water Temp", v: c.waterTempF != null ? `${Math.round(c.waterTempF)}\u00B0F` : "--" },
    { l: "Boat Window", v: c.smallBoatWindowHours != null ? `${c.smallBoatWindowHours} hrs (${c.smallBoatWindowLabel||""})` : "--" },
    { l: "Water Level", v: c.waterLevelFtIGLD != null ? `${fix(c.waterLevelFtIGLD,2)} ft IGLD` : "--" },
    { l: "Sag. River Flow", v: river?.flowCfs ? `${river.flowCfs.toLocaleString()} cfs` : "--" },
    { l: "River Water Temp", v: river?.waterTempF ? `${Math.round(river.waterTempF)}\u00B0F` : "--" },
    { l: "Tittabawassee", v: titt?.flowCfs ? `${titt.flowCfs.toLocaleString()} cfs` : "--" },
    { l: "Advisories", v: c.alertHeadline || "None active" },
  ];
  ui.condGrid.innerHTML = fields.map(f=>`<div class="cond-box"><span class="cond-label">${esc(f.l)}</span><p class="cond-value">${esc(f.v)}</p></div>`).join("");
}

function renderZones() {
  const zones = state.data?.zones; if (!zones?.length) return;
  ui.zonesGrid.innerHTML = zones.map(z => {
    const tone = z.tripScore >= 72 ? "strong" : z.tripScore >= 56 ? "moderate" : "weak";
    const isFav = state.favorites.zones.includes(z.id); const a = z.action || {};
    return `<article class="zone-card"><div class="zone-head"><div><h3>${esc(z.name)}</h3><span class="zone-rec">${esc(z.recommendation||"")}</span></div><div style="display:flex;gap:0.4rem;align-items:center"><span class="score-badge ${tone}">${z.tripScore}</span><button class="fav-btn${isFav?" active":""}" data-fav-kind="zones" data-fav-id="${esc(z.id)}">${isFav?"\u2605":"\u2606"}</button></div></div><div class="zone-stats"><div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div><div class="zone-stat"><span class="stat-label">Fishability</span><span class="stat-val">${z.fishability}</span></div><div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div><div class="zone-stat"><span class="stat-label">Confidence</span><span class="stat-val">${z.confidence}</span></div></div><div class="zone-action"><p><strong>Launch:</strong> ${esc(a.bestLaunchName||"N/A")}. ${esc(a.launchReason||"")}</p><p><strong>Window:</strong> ${esc(a.windowPlan||"")}</p><p><strong>Tactic:</strong> ${esc(a.technique||"")}</p><p><strong>Caution:</strong> ${esc(a.caution||"Standard.")}</p></div></article>`;
  }).join("");
}

function renderLaunches() {
  const launches = state.data?.launches; if (!launches?.length) return;
  ui.launches.innerHTML = launches.slice(0,7).map(l => {
    const isFav = state.favorites.launches.includes(l.id);
    return `<article class="launch-card"><div class="launch-head"><div><h3>${esc(l.name)}</h3><span class="launch-meta">${esc(l.zoneName)} | Score ${l.score} | ${esc(l.advice)}</span></div><button class="fav-btn${isFav?" active":""}" data-fav-kind="launches" data-fav-id="${esc(l.id)}">${isFav?"\u2605":"\u2606"}</button></div><p class="launch-notes">${esc(l.exposureSummary)} ${esc(l.notes||"")}</p></article>`;
  }).join("");
}

function renderReportsFeed() {
  const rp = state.reports; if (!rp) return;
  const reports = rp.reports || []; const sources = rp.sources || [];
  const ok = sources.filter(s=>s.status==="ok").length;
  let h = `<p class="muted">${rp.totalReports} reports from ${ok}/${sources.length} sources</p><div class="source-badges">`;
  for (const src of sources) { const c = src.status==="ok"?"src-ok":src.status==="error"?"src-err":"src-warn"; h += `<span class="src-badge ${c}">${esc(src.sourceName||src.source)} (${src.reportCount})</span>`; }
  h += '</div>';
  if (reports.length) { h += reports.slice(0,8).map(r=>{const sc=r.signal>=0.3?"sig-pos":r.signal<=-0.15?"sig-neg":"sig-mix";return `<article class="report-card"><div class="report-head"><h3>${esc(r.primaryZone?zoneLabel(r.primaryZone):"Bay-wide")}</h3><span class="report-meta ${sc}">${sigWord(r.signal)}</span></div><p class="report-summary">${esc(r.summary||"")}</p><div class="report-tags">${(r.species||[]).map(s=>`<span class="tag">${cap(s)}</span>`).join("")}${r.depth?`<span class="tag">${r.depth.min}-${r.depth.max}ft</span>`:""}${(r.lure||[]).map(l=>`<span class="tag">${esc(l)}</span>`).join("")}${r.speed?`<span class="tag">${r.speed.min}-${r.speed.max}mph</span>`:""}</div><span class="report-meta">${esc(r.sourceName||r.source)}</span></article>`;}).join(""); }
  else { h += '<p class="muted">No reports. Sources may be offline or out of season.</p>'; }
  ui.reportsList.innerHTML = h;
}

function renderCaptainNote() { const d = state.data; if (d?.captainNote?.text && ui.captainNote) { ui.captainNote.textContent = d.captainNote.text; ui.captainNote.className = ""; } }

/* ================================================================
   HELPERS
   ================================================================ */
function updateSpeciesUI() { document.querySelectorAll("[data-species]").forEach(b=>b.classList.toggle("active",b.dataset.species===state.favorites.species)); }
function toggleFav(kind,id) { if(!["zones","launches"].includes(kind)||!id)return; const l=state.favorites[kind]; state.favorites[kind]=l.includes(id)?l.filter(x=>x!==id):[...l,id]; saveStored("saginaw:favorites",state.favorites); renderDashboard(); }
function zoneLabel(id) { return {"west-side":"West Side","east-side":"East Side","inner-bay":"Inner Bay","outer-bay":"Outer Bay","river-mouth":"River Mouth","shipping-channel":"Shipping Channel","reefs":"Named Reefs","bay-wide":"Bay-wide"}[id]||id; }
function sigWord(s) { return s >= 0.3 ? "positive" : s <= -0.15 ? "negative" : "mixed"; }
function getDateKey(d=new Date()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`;}
function relTime(i){if(!i)return"unknown";const ms=Date.now()-new Date(i).getTime();if(isNaN(ms))return"unknown";const min=Math.max(0,Math.round(ms/60000));if(min<1)return"just now";if(min<60)return`${min}m ago`;const hr=Math.round(min/60);return hr<24?`${hr}h ago`:`${Math.round(hr/24)}d ago`;}
function cap(v){return v?v[0].toUpperCase()+v.slice(1):"";}
function fix(v,d){return v!=null&&!isNaN(v)?Number(v).toFixed(d):"--";}
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function loadStored(k,fb){try{const r=localStorage.getItem(k);if(!r)return fb;const p=JSON.parse(r);return fb&&typeof fb==="object"&&!Array.isArray(fb)&&p&&typeof p==="object"&&!Array.isArray(p)?{...fb,...p}:p;}catch{return fb;}}
function saveStored(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

init();
