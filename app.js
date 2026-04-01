/* ============================================
   Saginaw Bay Fishing Hub - app.js
   Auto-loading, map-first architecture
   ============================================ */

const SUMMARY_ENDPOINT = "/api/daily-summary";
const APP_TIMEZONE = "America/Detroit";
const SNAPSHOT_PREFIX = "saginaw:daily-snapshot";
const REQUIRED_API_VERSION = "2026-03-31-rich-zones-v2";

/* ---- Zone polygons (approximate Saginaw Bay regions) ---- */
const ZONE_GEO = {
  "west-side": {
    color: "#5a9ab8",
    coords: [
      [43.62, -83.91], [43.72, -83.92], [43.82, -83.87],
      [43.93, -83.80], [44.02, -83.73], [44.02, -83.78],
      [43.93, -83.85], [43.82, -83.92], [43.72, -83.96], [43.62, -83.96]
    ]
  },
  "east-side": {
    color: "#5a9ab8",
    coords: [
      [43.60, -83.62], [43.67, -83.50], [43.77, -83.43],
      [43.88, -83.45], [43.88, -83.55], [43.77, -83.55],
      [43.67, -83.60], [43.60, -83.66]
    ]
  },
  "inner-bay": {
    color: "#5a9ab8",
    coords: [
      [43.60, -83.88], [43.60, -83.68], [43.68, -83.66],
      [43.73, -83.72], [43.73, -83.82], [43.68, -83.88]
    ]
  },
  "outer-bay": {
    color: "#5a9ab8",
    coords: [
      [43.90, -83.76], [43.90, -83.55], [44.00, -83.47],
      [44.08, -83.52], [44.08, -83.72], [44.00, -83.78]
    ]
  },
  "river-mouth": {
    color: "#5a9ab8",
    coords: [
      [43.57, -83.92], [43.57, -83.86], [43.62, -83.84],
      [43.62, -83.88], [43.60, -83.92]
    ]
  },
  "shipping-channel": {
    color: "#5a9ab8",
    coords: [
      [43.61, -83.86], [43.61, -83.82], [43.78, -83.70],
      [43.78, -83.74]
    ]
  },
  "reefs": {
    color: "#5a9ab8",
    coords: [
      [43.78, -83.64], [43.78, -83.55], [43.87, -83.53],
      [43.87, -83.62]
    ]
  },
};

/* ---- Launch coordinates ---- */
const LAUNCH_GEO = {
  "linwood":           { lat: 43.725, lng: -83.935 },
  "au-gres":           { lat: 44.045, lng: -83.695 },
  "sebewaing":         { lat: 43.733, lng: -83.450 },
  "quanicassee":       { lat: 43.618, lng: -83.582 },
  "bay-city-state-park":{ lat: 43.551, lng: -83.860 },
  "essexville":        { lat: 43.610, lng: -83.843 },
  "channel-access":    { lat: 43.635, lng: -83.800 },
};

/* ---- State ---- */
const state = {
  loading: false,
  error: null,
  data: null,
  dataSource: null,
  favorites: loadStored("saginaw:favorites", {
    zones: [],
    launches: [],
    species: "walleye",
  }),
  lastSnapshot: null,
};

let map = null;
let zonePolygons = {};
let launchMarkers = {};

/* ---- DOM refs ---- */
const ui = {
  bayCallBadge: document.getElementById("bay-call-badge"),
  updatedAt: document.getElementById("updated-at"),
  heroBest: document.getElementById("hero-best"),
  heroAvoid: document.getElementById("hero-avoid"),
  heroConfidence: document.getElementById("hero-confidence"),
  heroRationale: document.getElementById("hero-rationale"),
  captainNote: document.getElementById("captain-note"),
  conditionsGrid: document.getElementById("conditions-grid"),
  zonesGrid: document.getElementById("zones-grid"),
  launchesList: document.getElementById("launches-list"),
  reportsList: document.getElementById("reports-list"),
};

/* ---- Event delegation ---- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;

  const speciesBtn = t.closest("[data-species]");
  if (speciesBtn) {
    const species = speciesBtn.dataset.species;
    if (species && species !== state.favorites.species) {
      state.favorites.species = species;
      saveStored("saginaw:favorites", state.favorites);
      updateSpeciesButtons();
      fetchSummary({ includeAi: false });
    }
    return;
  }

  const aiBtn = t.closest("[data-action='generate-ai-note']");
  if (aiBtn) {
    fetchSummary({ includeAi: true });
    return;
  }

  const favBtn = t.closest("[data-fav-kind]");
  if (favBtn) {
    toggleFavorite(favBtn.dataset.favKind, favBtn.dataset.favId);
    return;
  }
});

/* ---- Init ---- */
function init() {
  initMap();
  updateSpeciesButtons();
  fetchSummary({ includeAi: false });
}

/* ---- Map ---- */
function initMap() {
  map = L.map("bay-map", {
    center: [43.78, -83.68],
    zoom: 9,
    scrollWheelZoom: false,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 14,
    subdomains: "abcd",
  }).addTo(map);

  /* Draw zone polygons (default color, updated after data loads) */
  for (const [zoneId, geo] of Object.entries(ZONE_GEO)) {
    const polygon = L.polygon(geo.coords, {
      color: "#3d7a9c",
      weight: 1.5,
      fillColor: "#3d7a9c",
      fillOpacity: 0.15,
    }).addTo(map);
    polygon.bindTooltip(zoneIdToName(zoneId), {
      sticky: true,
      className: "zone-tooltip",
    });
    zonePolygons[zoneId] = polygon;
  }

  /* Place launch markers */
  const launchIcon = L.divIcon({
    className: "launch-icon",
    html: '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 14 10 14s10-6.5 10-14C20 4.5 15.5 0 10 0z" fill="#1a2e3b"/><circle cx="10" cy="10" r="4" fill="#f5f0e8"/></svg>',
    iconSize: [20, 24],
    iconAnchor: [10, 24],
    tooltipAnchor: [0, -24],
  });

  for (const [launchId, geo] of Object.entries(LAUNCH_GEO)) {
    const marker = L.marker([geo.lat, geo.lng], { icon: launchIcon }).addTo(map);
    marker.bindTooltip(launchIdToName(launchId), { direction: "top" });
    launchMarkers[launchId] = marker;
  }
}

function updateMapFromData(data) {
  if (!map || !data || !data.zones) return;

  for (const zone of data.zones) {
    const polygon = zonePolygons[zone.id];
    if (!polygon) continue;

    const c = scoreColor(zone.tripScore);
    polygon.setStyle({
      color: c,
      fillColor: c,
      fillOpacity: 0.25,
      weight: 2,
    });
    polygon.unbindTooltip();
    polygon.bindTooltip(
      `<strong>${esc(zone.name)}</strong><br>Trip Score: ${zone.tripScore}<br>${esc(zone.recommendation || "")}`,
      { sticky: true, className: "zone-tooltip" }
    );
  }
}

function scoreColor(score) {
  if (score >= 72) return "#2d8659";
  if (score >= 56) return "#c68b2c";
  return "#b84040";
}

/* ---- Data Fetching ---- */
async function fetchSummary({ includeAi = false } = {}) {
  const species = state.favorites.species || "walleye";
  const dayKey = getDateKey();

  /* Check local cache first */
  const storageKey = `${SNAPSHOT_PREFIX}:${species}:${dayKey}`;
  const cached = loadStored(storageKey, null);
  if (isValidSnapshot(cached, dayKey) && (!includeAi || cached.captainNote?.text)) {
    state.data = cached;
    state.dataSource = "local";
    state.error = null;
    state.loading = false;
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  renderLoading();

  const params = new URLSearchParams({ species, day: dayKey });
  if (includeAi) params.set("includeAi", "1");

  try {
    const resp = await fetch(`${SUMMARY_ENDPOINT}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);

    const payload = await resp.json();
    payload.snapshotDate = payload.snapshotDate || dayKey;
    state.data = payload;
    state.dataSource = "network";
    state.loading = false;
    state.error = null;

    saveStored(storageKey, payload);
    pruneOldSnapshots(dayKey);
    render();
  } catch (err) {
    state.error = err.message || "Failed to load";
    state.loading = false;
    renderError();
  }
}

/* ---- Render orchestration ---- */
function render() {
  renderBayCall();
  renderConditions();
  renderZones();
  renderLaunches();
  renderReports();
  renderCaptainNote();
  updateMapFromData(state.data);
}

function renderLoading() {
  ui.bayCallBadge.className = "bay-call-badge loading";
  ui.bayCallBadge.querySelector(".call-label").textContent = "Loading...";
  ui.updatedAt.textContent = "Fetching conditions...";
}

function renderError() {
  ui.bayCallBadge.className = "bay-call-badge nogo";
  ui.bayCallBadge.querySelector(".call-label").textContent = "Error";
  ui.updatedAt.textContent = state.error || "Load failed";
}

/* ---- Bay Call ---- */
function renderBayCall() {
  const d = state.data;
  if (!d) return;
  const bc = d.bayCall || {};
  const cls = bc.goNoGo === "GO" ? "go" : bc.goNoGo === "CAUTION" ? "caution" : "nogo";
  ui.bayCallBadge.className = `bay-call-badge ${cls}`;
  ui.bayCallBadge.querySelector(".call-label").textContent = bc.label || "Pending";

  const snap = d.snapshotDate || getDateKey();
  const src = state.dataSource === "local" ? "cached" : "live";
  ui.updatedAt.textContent = `${snap} | ${src} | ${relTime(d.generatedAt)}`;

  ui.heroBest.textContent = d.bestSetup?.name || "--";
  ui.heroAvoid.textContent = d.avoidOrCaution || "--";
  ui.heroConfidence.textContent = `${capitalize(bc.confidenceLabel || "unknown")} (${bc.confidenceScore ?? "--"})`;

  const reasons = (bc.rationale || []).slice(0, 5);
  if (reasons.length) {
    ui.heroRationale.innerHTML = `<ul>${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`;
  } else {
    ui.heroRationale.innerHTML = `<p class="muted">No rationale available.</p>`;
  }
}

/* ---- Conditions ---- */
function renderConditions() {
  const c = state.data?.conditions;
  if (!c) return;

  const fields = [
    { label: "Wind", value: c.windMph != null ? `${Math.round(c.windMph)} mph ${c.windDirectionCardinal || ""}` : "--" },
    { label: "Waves", value: c.waveFt != null ? `${fix(c.waveFt, 1)} ft` : "--" },
    { label: "Air Temp", value: c.airTempF != null ? `${Math.round(c.airTempF)}\u00B0F` : "--" },
    { label: "Water Temp", value: c.waterTempF != null ? `${Math.round(c.waterTempF)}\u00B0F` : "--" },
    { label: "Boat Window", value: c.smallBoatWindowHours != null ? `${c.smallBoatWindowHours} hrs (${c.smallBoatWindowLabel || ""})` : "--" },
    { label: "Water Level", value: c.waterLevelFtIGLD != null ? `${fix(c.waterLevelFtIGLD, 2)} ft IGLD` : "--" },
    { label: "Level Trend", value: c.waterLevelTrendLabel || "--" },
    { label: "Shoreline", value: c.shorelineForecastShort || "--" },
    { label: "NOAA Waves", value: c.waveFtNoaaGrid != null ? `${fix(c.waveFtNoaaGrid, 1)} ft` : "--" },
    { label: "Advisories", value: c.alertHeadline || "None active" },
  ];

  ui.conditionsGrid.innerHTML = fields.map(f => `
    <div class="cond-box">
      <span class="cond-label">${esc(f.label)}</span>
      <p class="cond-value">${esc(f.value)}</p>
    </div>
  `).join("");
}

/* ---- Zones ---- */
function renderZones() {
  const zones = state.data?.zones;
  if (!zones || !zones.length) return;

  ui.zonesGrid.innerHTML = zones.map(z => {
    const tone = z.tripScore >= 72 ? "strong" : z.tripScore >= 56 ? "moderate" : "weak";
    const isFav = state.favorites.zones.includes(z.id);
    const a = z.action || {};
    return `
    <article class="zone-card">
      <div class="zone-head">
        <div>
          <h3>${esc(z.name)}</h3>
          <span class="zone-rec">${esc(z.recommendation || "")}</span>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <span class="score-badge ${tone}">${z.tripScore}</span>
          <button class="fav-btn ${isFav ? "active" : ""}" data-fav-kind="zones" data-fav-id="${esc(z.id)}" aria-label="Favorite">${isFav ? "\u2605" : "\u2606"}</button>
        </div>
      </div>
      <div class="zone-stats">
        <div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div>
        <div class="zone-stat"><span class="stat-label">Fishability</span><span class="stat-val">${z.fishability}</span></div>
        <div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div>
        <div class="zone-stat"><span class="stat-label">Confidence</span><span class="stat-val">${z.confidence}</span></div>
      </div>
      <div class="zone-action">
        <p><strong>Launch:</strong> ${esc(a.bestLaunchName || "N/A")}. ${esc(a.launchReason || "")}</p>
        <p><strong>Window:</strong> ${esc(a.windowPlan || "")}</p>
        <p><strong>Tactic:</strong> ${esc(a.technique || "")}</p>
        <p><strong>Caution:</strong> ${esc(a.caution || "Standard caution.")}</p>
      </div>
    </article>`;
  }).join("");
}

/* ---- Launches ---- */
function renderLaunches() {
  const launches = state.data?.launches;
  if (!launches || !launches.length) return;

  ui.launchesList.innerHTML = launches.slice(0, 7).map(l => {
    const isFav = state.favorites.launches.includes(l.id);
    return `
    <article class="launch-card">
      <div class="launch-head">
        <div>
          <h3>${esc(l.name)}</h3>
          <span class="launch-meta">${esc(l.zoneName)} | Score ${l.score} | ${esc(l.advice)}</span>
        </div>
        <button class="fav-btn ${isFav ? "active" : ""}" data-fav-kind="launches" data-fav-id="${esc(l.id)}">${isFav ? "\u2605" : "\u2606"}</button>
      </div>
      <p class="launch-notes">${esc(l.exposureSummary)} ${esc(l.notes || "")}</p>
    </article>`;
  }).join("");
}

/* ---- Reports ---- */
function renderReports() {
  const reports = state.data?.reports;
  if (!reports) return;
  const items = reports.items || [];
  const summary = reports.sourceSummary || "";

  ui.reportsList.innerHTML = `
    <p class="muted">${esc(summary)}</p>
    ${items.length ? items.slice(0, 6).map(r => `
      <article class="report-card">
        <div class="report-head">
          <h3>${esc(r.zoneName || r.zoneId || "Bay-wide")}</h3>
          <span class="report-meta">${esc(relTime(r.observedAt))}</span>
        </div>
        <p class="report-summary">${esc(r.summary || "Report received.")}</p>
        <span class="report-meta">${esc(r.source || "Unknown")} | Signal ${sigLabel(r.signal)}</span>
      </article>
    `).join("") : '<p class="muted">No recent reports.</p>'}
  `;
}

/* ---- Captain Note ---- */
function renderCaptainNote() {
  const d = state.data;
  if (!d || !ui.captainNote) return;
  if (d.captainNote?.text) {
    ui.captainNote.textContent = d.captainNote.text;
    ui.captainNote.className = "";
  } else if (d.ai?.requested && d.ai?.generated === false) {
    ui.captainNote.textContent = "AI note unavailable. Check API key and retry.";
  }
}

/* ---- Species buttons ---- */
function updateSpeciesButtons() {
  document.querySelectorAll("[data-species]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.species === state.favorites.species);
  });
}

/* ---- Favorites ---- */
function toggleFavorite(kind, id) {
  if (!["zones", "launches"].includes(kind) || !id) return;
  const list = state.favorites[kind];
  state.favorites[kind] = list.includes(id)
    ? list.filter(x => x !== id)
    : [...list, id];
  saveStored("saginaw:favorites", state.favorites);
  render();
}

/* ---- Helpers ---- */
function zoneIdToName(id) {
  const map = {
    "west-side": "West Side", "east-side": "East Side",
    "inner-bay": "Inner Bay", "outer-bay": "Outer Bay",
    "river-mouth": "River Mouth", "shipping-channel": "Shipping Channel",
    "reefs": "Named Reefs",
  };
  return map[id] || id;
}

function launchIdToName(id) {
  const map = {
    "linwood": "Linwood Beach Marina", "au-gres": "Au Gres Harbor",
    "sebewaing": "Sebewaing Harbor", "quanicassee": "Quanicassee DNR Launch",
    "bay-city-state-park": "Bay City State Park", "essexville": "Essexville Access",
    "channel-access": "Shipping Channel Access",
  };
  return map[id] || id;
}

function getDateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function isValidSnapshot(s, dayKey) {
  return s && typeof s === "object" && s.snapshotDate === dayKey && s.apiVersion === REQUIRED_API_VERSION;
}

function relTime(input) {
  if (!input) return "unknown";
  const ms = Date.now() - new Date(input).getTime();
  if (isNaN(ms)) return "unknown";
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function sigLabel(s) {
  if (s >= 0.35) return "positive";
  if (s <= -0.2) return "negative";
  return "mixed";
}

function capitalize(v) { return v ? v[0].toUpperCase() + v.slice(1) : ""; }
function fix(v, d) { return v != null && !isNaN(v) ? Number(v).toFixed(d) : "--"; }

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback) &&
        parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch { return fallback; }
}

function saveStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function pruneOldSnapshots(activeDay) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${SNAPSHOT_PREFIX}:`) && !key.endsWith(`:${activeDay}`)) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

/* ---- Boot ---- */
init();
