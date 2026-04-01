/* ============================================
   Saginaw Bay Fishing Hub - app.js v2
   Real-time sensors + reports + zone scoring
   ============================================ */

const SUMMARY_EP = "/api/daily-summary";
const SENSORS_EP = "/api/sensors";
const REPORTS_EP = "/api/reports";
const TZ = "America/Detroit";
const SNAP_PREFIX = "saginaw:daily-snapshot";
const API_VER = "2026-03-31-rich-zones-v2";

/* ---- State ---- */
const state = {
  loading: false, error: null, data: null, dataSource: null,
  sensors: null, reports: null,
  favorites: loadStored("saginaw:favorites", { zones: [], launches: [], species: "walleye" }),
};

let map = null;
const mapLayers = { sensors: [], reports: [] };

/* ---- DOM refs ---- */
const $ = id => document.getElementById(id);
const ui = {
  badge: $("bay-call-badge"), updated: $("updated-at"),
  best: $("hero-best"), avoid: $("hero-avoid"), conf: $("hero-confidence"),
  rationale: $("hero-rationale"), captainNote: $("captain-note"),
  condGrid: $("conditions-grid"), zonesGrid: $("zones-grid"),
  launches: $("launches-list"), reportsList: $("reports-list"),
};

/* ---- Events ---- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-species]");
  if (t) {
    state.favorites.species = t.dataset.species;
    saveStored("saginaw:favorites", state.favorites);
    updateSpeciesUI();
    fetchSummary();
    return;
  }
  if (e.target.closest("[data-action='generate-ai-note']")) { fetchSummary(true); return; }
  const f = e.target.closest("[data-fav-kind]");
  if (f) { toggleFav(f.dataset.favKind, f.dataset.favId); return; }
});

/* ================================================================
   INIT - fire everything in parallel
   ================================================================ */
function init() {
  initMap();
  updateSpeciesUI();
  fetchSummary();
  fetchSensors();
  fetchReports();
}

/* ================================================================
   MAP
   ================================================================ */
function initMap() {
  map = L.map("bay-map", {
    center: [43.78, -83.72],
    zoom: 9,
    scrollWheelZoom: false,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 14, subdomains: "abcd",
  }).addTo(map);
}

/* ---- Sensor markers on map ---- */
function renderSensorsOnMap(data) {
  mapLayers.sensors.forEach(l => map.removeLayer(l));
  mapLayers.sensors = [];

  if (!data?.stations || !data?.readings) return;

  for (const station of data.stations) {
    const reading = data.readings[station.id] || {};
    if (reading.error && !reading.windMph && !reading.flowCfs && !reading.waterLevelFtIGLD) continue;

    const icon = sensorIcon(station.type, reading);
    const marker = L.marker([station.lat, station.lng], { icon }).addTo(map);

    const popup = buildSensorPopup(station, reading);
    marker.bindPopup(popup, { maxWidth: 280, className: "sensor-popup" });
    marker.bindTooltip(station.name, { direction: "top", offset: [0, -12] });

    mapLayers.sensors.push(marker);
  }

  // Marine forecast markers
  if (data.marineForecast) {
    if (data.marineForecast.innerBay?.forecast) {
      const m = L.marker([43.68, -83.78], {
        icon: L.divIcon({ className: "forecast-icon", html: '<div class="fc-pin inner">IB</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(map);
      m.bindPopup(`<div class="sensor-popup-inner"><strong>Inner Saginaw Bay Forecast</strong><br><em>${esc(data.marineForecast.innerBay.currentPeriod || "")}</em><br>${esc(data.marineForecast.innerBay.forecast || "No forecast")}</div>`, { maxWidth: 300 });
      mapLayers.sensors.push(m);
    }
    if (data.marineForecast.outerBay?.forecast) {
      const m = L.marker([43.95, -83.62], {
        icon: L.divIcon({ className: "forecast-icon", html: '<div class="fc-pin outer">OB</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(map);
      m.bindPopup(`<div class="sensor-popup-inner"><strong>Outer Saginaw Bay Forecast</strong><br><em>${esc(data.marineForecast.outerBay.currentPeriod || "")}</em><br>${esc(data.marineForecast.outerBay.forecast || "No forecast")}</div>`, { maxWidth: 300 });
      mapLayers.sensors.push(m);
    }
  }

  // Satellite SST link
  if (data.satellite?.imageUrl) {
    const m = L.marker([44.05, -83.85], {
      icon: L.divIcon({ className: "forecast-icon", html: '<div class="fc-pin sat">SST</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
    }).addTo(map);
    m.bindPopup(`<div class="sensor-popup-inner"><strong>Satellite Surface Temp</strong><br><a href="${esc(data.satellite.imageUrl)}" target="_blank">View GLSEA SST Map</a><br><a href="${esc(data.satellite.trueColorUrl || "")}" target="_blank">True Color Satellite</a><br><small>Updated daily by GLERL/CoastWatch</small></div>`);
    mapLayers.sensors.push(m);
  }
}

function sensorIcon(type, reading) {
  let color = "#3d7a9c";
  let label = "?";

  if (type === "buoy" || type === "weather-station") {
    const w = reading.windMph;
    if (w != null) {
      color = w <= 10 ? "#2d8659" : w <= 18 ? "#c68b2c" : "#b84040";
      label = `${Math.round(w)}`;
    }
  } else if (type === "stream-gauge") {
    color = "#3d7a9c";
    label = reading.flowCfs != null ? "Q" : "G";
  } else if (type === "water-level") {
    color = "#5a6b78";
    label = "WL";
  }

  return L.divIcon({
    className: "sensor-marker",
    html: `<div class="sm-pin" style="background:${color}">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function buildSensorPopup(station, r) {
  const lines = [`<div class="sensor-popup-inner"><strong>${esc(station.name)}</strong><br><small>${esc(station.source)}</small>`];

  if (r.windMph != null) lines.push(`<br>Wind: <strong>${r.windMph} mph ${r.windDir || ""}</strong>${r.gustMph ? ` (gusts ${r.gustMph})` : ""}`);
  if (r.waveFt != null) lines.push(`<br>Waves: <strong>${r.waveFt} ft</strong>`);
  if (r.airTempF != null) lines.push(`<br>Air: ${Math.round(r.airTempF)}&deg;F`);
  if (r.waterTempF != null) lines.push(`<br>Water: <strong>${Math.round(r.waterTempF)}&deg;F</strong>`);
  if (r.flowCfs != null) lines.push(`<br>Flow: <strong>${r.flowCfs.toLocaleString()} cfs</strong>`);
  if (r.gaugeHeightFt != null) lines.push(`<br>Gauge: ${r.gaugeHeightFt} ft`);
  if (r.waterLevelFtIGLD != null) lines.push(`<br>Level: <strong>${r.waterLevelFtIGLD} ft IGLD</strong> (${r.trendLabel || ""})`);
  if (r.pressureMb != null) lines.push(`<br>Pressure: ${r.pressureMb} mb`);

  if (r.observedAt || r.flowObservedAt) {
    const t = r.observedAt || r.flowObservedAt;
    lines.push(`<br><small>Obs: ${relTime(t)}</small>`);
  }

  lines.push("</div>");
  return lines.join("");
}

/* ---- Launch markers on map ---- */
const LAUNCH_GEO = {
  "linwood":           { lat: 43.725, lng: -83.935, name: "Linwood Beach Marina" },
  "au-gres":           { lat: 44.045, lng: -83.695, name: "Au Gres Harbor" },
  "sebewaing":         { lat: 43.733, lng: -83.450, name: "Sebewaing Harbor" },
  "quanicassee":       { lat: 43.618, lng: -83.582, name: "Quanicassee DNR Launch" },
  "bay-city-state-park":{ lat: 43.551, lng: -83.860, name: "Bay City State Park" },
  "essexville":        { lat: 43.610, lng: -83.843, name: "Essexville Access" },
  "channel-access":    { lat: 43.635, lng: -83.800, name: "Shipping Channel Access" },
};

function addLaunchMarkers() {
  const icon = L.divIcon({
    className: "launch-icon",
    html: '<div class="launch-pin">&#9650;</div>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });

  for (const [id, geo] of Object.entries(LAUNCH_GEO)) {
    const m = L.marker([geo.lat, geo.lng], { icon }).addTo(map);
    m.bindTooltip(geo.name, { direction: "top", offset: [0, -16] });
    mapLayers.sensors.push(m);
  }
}

/* ================================================================
   DATA FETCHING
   ================================================================ */
async function fetchSummary(includeAi = false) {
  const species = state.favorites.species || "walleye";
  const day = getDateKey();
  const key = `${SNAP_PREFIX}:${species}:${day}`;

  const cached = loadStored(key, null);
  if (cached?.snapshotDate === day && cached?.apiVersion === API_VER && (!includeAi || cached.captainNote?.text)) {
    state.data = cached; state.dataSource = "local"; state.error = null; state.loading = false;
    renderDashboard(); return;
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
    renderDashboard();
  } catch (err) {
    state.error = err.message; state.loading = false;
    renderError();
  }
}

async function fetchSensors() {
  try {
    const r = await fetch(SENSORS_EP);
    if (!r.ok) throw new Error(`Sensors ${r.status}`);
    state.sensors = await r.json();
    renderSensorsOnMap(state.sensors);
    addLaunchMarkers();
    renderSensorCards();
  } catch (err) {
    console.warn("Sensor fetch failed:", err.message);
  }
}

async function fetchReports() {
  try {
    const r = await fetch(REPORTS_EP);
    if (!r.ok) throw new Error(`Reports ${r.status}`);
    state.reports = await r.json();
    renderReportsFeed();
  } catch (err) {
    console.warn("Reports fetch failed:", err.message);
  }
}

/* ================================================================
   RENDER
   ================================================================ */
function renderDashboard() {
  renderBayCall();
  renderConditions();
  renderZones();
  renderLaunches();
  renderCaptainNote();
}

function renderLoadingState() {
  ui.badge.className = "bay-call-badge loading";
  ui.badge.querySelector(".call-label").textContent = "Loading...";
  ui.updated.textContent = "Fetching conditions...";
}

function renderError() {
  ui.badge.className = "bay-call-badge nogo";
  ui.badge.querySelector(".call-label").textContent = "Error";
  ui.updated.textContent = state.error || "Load failed";
}

function renderBayCall() {
  const d = state.data; if (!d) return;
  const bc = d.bayCall || {};
  const cls = bc.goNoGo === "GO" ? "go" : bc.goNoGo === "CAUTION" ? "caution" : "nogo";
  ui.badge.className = `bay-call-badge ${cls}`;
  ui.badge.querySelector(".call-label").textContent = bc.label || "Pending";
  ui.updated.textContent = `${d.snapshotDate || getDateKey()} | ${state.dataSource} | ${relTime(d.generatedAt)}`;
  ui.best.textContent = d.bestSetup?.name || "--";
  ui.avoid.textContent = d.avoidOrCaution || "--";
  ui.conf.textContent = `${cap(bc.confidenceLabel || "unknown")} (${bc.confidenceScore ?? "--"})`;

  const reasons = (bc.rationale || []).slice(0, 5);
  ui.rationale.innerHTML = reasons.length
    ? `<ul>${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`
    : '<p class="muted">No rationale available.</p>';
}

function renderConditions() {
  const c = state.data?.conditions;
  if (!c) return;
  const fields = [
    { l: "Wind", v: c.windMph != null ? `${Math.round(c.windMph)} mph ${c.windDirectionCardinal || ""}` : "--" },
    { l: "Waves", v: c.waveFt != null ? `${fix(c.waveFt,1)} ft` : "--" },
    { l: "Air Temp", v: c.airTempF != null ? `${Math.round(c.airTempF)}\u00B0F` : "--" },
    { l: "Water Temp", v: c.waterTempF != null ? `${Math.round(c.waterTempF)}\u00B0F` : "--" },
    { l: "Boat Window", v: c.smallBoatWindowHours != null ? `${c.smallBoatWindowHours} hrs` : "--" },
    { l: "Water Level", v: c.waterLevelFtIGLD != null ? `${fix(c.waterLevelFtIGLD,2)} ft IGLD` : "--" },
    { l: "Shoreline", v: c.shorelineForecastShort || "--" },
    { l: "Advisories", v: c.alertHeadline || "None" },
  ];

  // Add live sensor readings if available
  const s = state.sensors?.readings || {};
  const river = s["usgs-04157005"];
  if (river?.flowCfs) fields.push({ l: "Saginaw River Flow", v: `${river.flowCfs.toLocaleString()} cfs` });
  const titt = s["usgs-04156000"];
  if (titt?.flowCfs) fields.push({ l: "Tittabawassee Flow", v: `${titt.flowCfs.toLocaleString()} cfs` });

  ui.condGrid.innerHTML = fields.map(f => `
    <div class="cond-box"><span class="cond-label">${esc(f.l)}</span><p class="cond-value">${esc(f.v)}</p></div>
  `).join("");
}

function renderSensorCards() {
  // Augment conditions if sensor data arrived after the dashboard
  if (state.data && state.sensors) renderConditions();
}

function renderZones() {
  const zones = state.data?.zones;
  if (!zones?.length) return;
  ui.zonesGrid.innerHTML = zones.map(z => {
    const tone = z.tripScore >= 72 ? "strong" : z.tripScore >= 56 ? "moderate" : "weak";
    const isFav = state.favorites.zones.includes(z.id);
    const a = z.action || {};
    return `
    <article class="zone-card">
      <div class="zone-head">
        <div><h3>${esc(z.name)}</h3><span class="zone-rec">${esc(z.recommendation || "")}</span></div>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <span class="score-badge ${tone}">${z.tripScore}</span>
          <button class="fav-btn${isFav?" active":""}" data-fav-kind="zones" data-fav-id="${esc(z.id)}">${isFav?"\u2605":"\u2606"}</button>
        </div>
      </div>
      <div class="zone-stats">
        <div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div>
        <div class="zone-stat"><span class="stat-label">Fishability</span><span class="stat-val">${z.fishability}</span></div>
        <div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div>
        <div class="zone-stat"><span class="stat-label">Confidence</span><span class="stat-val">${z.confidence}</span></div>
      </div>
      <div class="zone-action">
        <p><strong>Launch:</strong> ${esc(a.bestLaunchName||"N/A")}. ${esc(a.launchReason||"")}</p>
        <p><strong>Window:</strong> ${esc(a.windowPlan||"")}</p>
        <p><strong>Tactic:</strong> ${esc(a.technique||"")}</p>
        <p><strong>Caution:</strong> ${esc(a.caution||"Standard caution.")}</p>
      </div>
    </article>`;
  }).join("");
}

function renderLaunches() {
  const launches = state.data?.launches;
  if (!launches?.length) return;
  ui.launches.innerHTML = launches.slice(0, 7).map(l => {
    const isFav = state.favorites.launches.includes(l.id);
    return `
    <article class="launch-card">
      <div class="launch-head">
        <div><h3>${esc(l.name)}</h3><span class="launch-meta">${esc(l.zoneName)} | Score ${l.score} | ${esc(l.advice)}</span></div>
        <button class="fav-btn${isFav?" active":""}" data-fav-kind="launches" data-fav-id="${esc(l.id)}">${isFav?"\u2605":"\u2606"}</button>
      </div>
      <p class="launch-notes">${esc(l.exposureSummary)} ${esc(l.notes||"")}</p>
    </article>`;
  }).join("");
}

function renderReportsFeed() {
  const rp = state.reports;
  if (!rp) return;

  const reports = rp.reports || [];
  const sources = rp.sources || [];
  const okSources = sources.filter(s => s.status === "ok").length;

  let html = `<p class="muted">${rp.totalReports} reports from ${okSources}/${sources.length} sources</p>`;

  // Source status badges
  html += '<div class="source-badges">';
  for (const src of sources) {
    const cls = src.status === "ok" ? "src-ok" : src.status === "error" ? "src-err" : "src-warn";
    html += `<span class="src-badge ${cls}" title="${esc(src.error || src.status)}">${esc(src.sourceName || src.source)} (${src.reportCount})</span>`;
  }
  html += '</div>';

  // Report cards
  if (reports.length) {
    html += reports.slice(0, 8).map(r => {
      const sigCls = r.signal >= 0.3 ? "sig-pos" : r.signal <= -0.15 ? "sig-neg" : "sig-mix";
      return `
      <article class="report-card">
        <div class="report-head">
          <h3>${esc(r.primaryZone ? zoneLabel(r.primaryZone) : "Bay-wide")}</h3>
          <span class="report-meta ${sigCls}">${sigWord(r.signal)}</span>
        </div>
        <p class="report-summary">${esc(r.summary || "")}</p>
        <div class="report-tags">
          ${(r.species||[]).map(s => `<span class="tag">${cap(s)}</span>`).join("")}
          ${r.depth ? `<span class="tag">${r.depth.min}-${r.depth.max}ft</span>` : ""}
          ${(r.lure||[]).map(l => `<span class="tag">${esc(l)}</span>`).join("")}
          ${r.speed ? `<span class="tag">${r.speed.min}-${r.speed.max}mph</span>` : ""}
        </div>
        <span class="report-meta">${esc(r.sourceName || r.source)}</span>
      </article>`;
    }).join("");
  } else {
    html += '<p class="muted">No reports retrieved. Sources may be offline or out of season.</p>';
  }

  ui.reportsList.innerHTML = html;
}

function renderCaptainNote() {
  const d = state.data;
  if (!d || !ui.captainNote) return;
  if (d.captainNote?.text) { ui.captainNote.textContent = d.captainNote.text; ui.captainNote.className = ""; }
}

/* ================================================================
   HELPERS
   ================================================================ */
function updateSpeciesUI() {
  document.querySelectorAll("[data-species]").forEach(b =>
    b.classList.toggle("active", b.dataset.species === state.favorites.species));
}

function toggleFav(kind, id) {
  if (!["zones","launches"].includes(kind) || !id) return;
  const list = state.favorites[kind];
  state.favorites[kind] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  saveStored("saginaw:favorites", state.favorites);
  renderDashboard();
}

function zoneLabel(id) {
  return { "west-side":"West Side","east-side":"East Side","inner-bay":"Inner Bay","outer-bay":"Outer Bay",
    "river-mouth":"River Mouth","shipping-channel":"Shipping Channel","reefs":"Named Reefs","bay-wide":"Bay-wide" }[id] || id;
}

function sigWord(s) { return s >= 0.3 ? "positive" : s <= -0.15 ? "negative" : "mixed"; }
function getDateKey(d=new Date()) {
  const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const m = Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
function relTime(i) {
  if (!i) return "unknown";
  const ms = Date.now() - new Date(i).getTime();
  if (isNaN(ms)) return "unknown";
  const min = Math.max(0, Math.round(ms/60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min/60);
  return hr < 24 ? `${hr}h ago` : `${Math.round(hr/24)}d ago`;
}
function cap(v) { return v ? v[0].toUpperCase()+v.slice(1) : ""; }
function fix(v,d) { return v!=null&&!isNaN(v)?Number(v).toFixed(d):"--"; }
function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function loadStored(k,fb) { try { const r=localStorage.getItem(k); if(!r)return fb; const p=JSON.parse(r); return fb&&typeof fb==="object"&&!Array.isArray(fb)&&p&&typeof p==="object"&&!Array.isArray(p)?{...fb,...p}:p; } catch{return fb;} }
function saveStored(k,v) { try{localStorage.setItem(k,JSON.stringify(v));}catch{} }

init();
