const SUMMARY_ENDPOINT = "/api/daily-summary";
const APP_TIMEZONE = "America/Detroit";
const SNAPSHOT_PREFIX = "saginaw:daily-snapshot";

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
  alerts: loadStored("saginaw:alerts", {
    enabled: false,
    scoreShiftThreshold: 10,
    notifyOnBayCallChange: true,
  }),
  lastSnapshot: null,
};

const ui = {
  updatedAt: document.getElementById("updated-at"),
  statusMessage: document.getElementById("status-message"),
  loadSnapshotButton: document.getElementById("load-snapshot"),
  snapshotLock: document.getElementById("snapshot-lock"),
  heroCall: document.getElementById("hero-call"),
  heroBest: document.getElementById("hero-best"),
  heroAvoid: document.getElementById("hero-avoid"),
  heroConfidence: document.getElementById("hero-confidence"),
  whyContent: document.getElementById("why-content"),
  captainNote: document.getElementById("captain-note"),
  conditionsContent: document.getElementById("conditions-content"),
  zonesContent: document.getElementById("zones-content"),
  launchesContent: document.getElementById("launches-content"),
  reportsContent: document.getElementById("reports-content"),
  prefsContent: document.getElementById("prefs-content"),
};

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest("#load-snapshot")) {
    loadOrFetchSummary({ includeAi: false });
    return;
  }

  const favoriteButton = target.closest("[data-fav-kind]");
  if (favoriteButton) {
    const kind = favoriteButton.dataset.favKind;
    const id = favoriteButton.dataset.favId;
    if (kind && id) {
      toggleFavorite(kind, id);
    }
    return;
  }

  const speciesButton = target.closest("[data-species]");
  if (speciesButton) {
    const species = speciesButton.dataset.species;
    if (species && species !== state.favorites.species) {
      state.favorites.species = species;
      saveStored("saginaw:favorites", state.favorites);
      if (state.data) {
        loadOrFetchSummary({ includeAi: false });
      } else {
        hydrateTodayFromLocal();
        render();
      }
    }
    return;
  }

  const aiNoteButton = target.closest("[data-action='generate-ai-note']");
  if (aiNoteButton) {
    loadOrFetchSummary({ includeAi: true });
    return;
  }

  const notifyButton = target.closest("[data-action='request-notify']");
  if (notifyButton) {
    requestNotificationPermission();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("#alerts-enabled")) {
    const checkbox = /** @type {HTMLInputElement} */ (target);
    state.alerts.enabled = checkbox.checked;
    saveStored("saginaw:alerts", state.alerts);
  }

  if (target.matches("#notify-bay-call")) {
    const checkbox = /** @type {HTMLInputElement} */ (target);
    state.alerts.notifyOnBayCallChange = checkbox.checked;
    saveStored("saginaw:alerts", state.alerts);
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("#score-shift")) {
    const slider = /** @type {HTMLInputElement} */ (target);
    state.alerts.scoreShiftThreshold = Number(slider.value);
    const valueNode = document.getElementById("score-shift-value");
    if (valueNode) {
      valueNode.textContent = `${state.alerts.scoreShiftThreshold} pts`;
    }
    saveStored("saginaw:alerts", state.alerts);
  }
});

function init() {
  hydrateTodayFromLocal();
  render();
}

async function loadOrFetchSummary(options = {}) {
  const includeAi = Boolean(options.includeAi);
  const species = state.favorites.species || "walleye";
  const dayKey = getDateKeyInTimeZone(APP_TIMEZONE);
  const storageKey = snapshotStorageKey(species, dayKey);

  const localSnapshot = loadStored(storageKey, null);
  if (isValidSnapshot(localSnapshot, dayKey) && (!includeAi || localSnapshot.captainNote?.text)) {
    state.data = localSnapshot;
    state.dataSource = "local";
    state.error = null;
    state.loading = false;
    syncSnapshotMemory(localSnapshot);
    pruneOldSnapshots(dayKey);
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  renderStatus();

  const params = new URLSearchParams();
  params.set("species", species);
  params.set("day", dayKey);
  if (includeAi) {
    params.set("includeAi", "1");
  }

  try {
    const response = await fetch(`${SUMMARY_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const payload = await response.json();
    payload.snapshotDate = payload.snapshotDate || dayKey;
    handlePotentialAlert(payload);
    state.data = payload;
    state.dataSource = payload.cache && String(payload.cache).includes("hit") ? "server-cache" : "network";
    state.loading = false;

    saveStored(storageKey, payload);
    pruneOldSnapshots(dayKey);
    render();
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Failed to load summary";
    state.loading = false;
    render();
  }
}

function hydrateTodayFromLocal() {
  const species = state.favorites.species || "walleye";
  const dayKey = getDateKeyInTimeZone(APP_TIMEZONE);
  pruneOldSnapshots(dayKey);
  const snapshot = loadStored(snapshotStorageKey(species, dayKey), null);
  if (!isValidSnapshot(snapshot, dayKey)) {
    return;
  }

  state.data = snapshot;
  state.dataSource = "local";
  state.error = null;
  state.loading = false;
  syncSnapshotMemory(snapshot);
}

function render() {
  renderStatus();
  renderHero();
  renderConditions();
  renderZones();
  renderLaunches();
  renderReports();
  renderPreferences();
}

function renderStatus() {
  if (state.loading) {
    ui.statusMessage.textContent = "Generating today's locked snapshot...";
    ui.updatedAt.textContent = "Loading...";
    if (ui.snapshotLock) {
      ui.snapshotLock.textContent = "Snapshot lock: pending";
    }
    if (ui.loadSnapshotButton) {
      ui.loadSnapshotButton.disabled = true;
      ui.loadSnapshotButton.textContent = "Loading...";
    }
    return;
  }

  if (ui.loadSnapshotButton) {
    ui.loadSnapshotButton.disabled = false;
    ui.loadSnapshotButton.textContent = "Load Today's Snapshot";
  }

  if (state.error) {
    ui.statusMessage.textContent = `Could not load snapshot (${state.error}).`;
    ui.updatedAt.textContent = "Load failed";
    if (ui.snapshotLock) {
      ui.snapshotLock.textContent = "Snapshot lock: inactive";
    }
    return;
  }

  if (!state.data) {
    ui.statusMessage.textContent = "Press Load Today's Snapshot when you want data. No API call happens before that.";
    ui.updatedAt.textContent = "Snapshot not loaded";
    if (ui.snapshotLock) {
      ui.snapshotLock.textContent = "Snapshot lock: inactive";
    }
    return;
  }

  const snapshotDate = state.data.snapshotDate || getDateKeyInTimeZone(APP_TIMEZONE);
  const sourceNote = state.dataSource === "local"
    ? "Loaded from local daily cache."
    : state.dataSource === "server-cache"
      ? "Loaded from server daily cache."
      : "Generated from live sources and locked for today.";

  ui.statusMessage.textContent = `${state.data.bayCall?.summary || "Snapshot loaded."} ${sourceNote}`;
  ui.updatedAt.textContent = `Snapshot day ${snapshotDate} | generated ${formatRelativeTime(state.data.generatedAt)}`;
  if (ui.snapshotLock) {
    ui.snapshotLock.textContent = `Snapshot lock: ${snapshotDate}`;
  }
}

function renderHero() {
  if (!state.data) {
    ui.heroCall.textContent = "Not loaded";
    ui.heroCall.className = "badge neutral";
    ui.heroBest.textContent = "-";
    ui.heroAvoid.textContent = "-";
    ui.heroConfidence.textContent = "-";
    ui.whyContent.innerHTML = "<li>Load today's snapshot to view decision drivers.</li>";
    if (ui.captainNote) {
      ui.captainNote.textContent = "Optional and server-side only. Not generated until requested.";
    }
    return;
  }

  const bayCall = state.data.bayCall || {};
  ui.heroCall.textContent = bayCall.label || "Pending";
  ui.heroCall.className = `badge ${bayCallClass(bayCall.goNoGo)}`;
  ui.heroBest.textContent = state.data.bestSetup?.name || "-";
  ui.heroAvoid.textContent = state.data.avoidOrCaution || "-";
  ui.heroConfidence.textContent = `${capitalize(bayCall.confidenceLabel || "unknown")} (${bayCall.confidenceScore ?? "-"})`;

  const reasons = (bayCall.rationale || []).slice(0, 5);
  ui.whyContent.innerHTML = reasons.length
    ? reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")
    : "<li>No explanation available.</li>";

  if (ui.captainNote) {
    if (state.data.captainNote?.text) {
      ui.captainNote.textContent = state.data.captainNote.text;
    } else if (state.data.ai?.requested && state.data.ai?.generated === false) {
      ui.captainNote.textContent = "AI note unavailable right now. Check OPENAI_API_KEY and try again.";
    } else {
      ui.captainNote.textContent = "Tap Generate Note for an optional AI captain summary.";
    }
  }
}

function renderConditions() {
  if (!state.data) {
    ui.conditionsContent.innerHTML = '<p class="empty-state">Load snapshot to view conditions.</p>';
    return;
  }

  const c = state.data.conditions || {};
  const fields = [
    { label: "Wind", value: c.windMph != null ? `${Math.round(c.windMph)} mph ${c.windDirectionCardinal || ""}`.trim() : "-" },
    { label: "Waves", value: c.waveFt != null ? `${toFixed(c.waveFt, 1)} ft` : "-" },
    { label: "Air Temp", value: c.airTempF != null ? `${Math.round(c.airTempF)}°F` : "-" },
    { label: "Water Temp", value: c.waterTempF != null ? `${Math.round(c.waterTempF)}°F` : "-" },
    { label: "Small-Boat Window", value: c.smallBoatWindowHours != null ? `${c.smallBoatWindowHours} hrs` : "-" },
    { label: "Advisories", value: c.alertHeadline || "None active" },
  ];

  ui.conditionsContent.innerHTML = fields
    .map(
      (item) => `
      <div class="condition-box">
        <span class="metric-label">${escapeHtml(item.label)}</span>
        <p class="value">${escapeHtml(item.value)}</p>
      </div>
    `,
    )
    .join("");
}

function renderZones() {
  if (!state.data) {
    ui.zonesContent.innerHTML = '<p class="empty-state">Load snapshot to score zones.</p>';
    return;
  }

  const zones = state.data.zones || [];
  if (!zones.length) {
    ui.zonesContent.innerHTML = '<p class="empty-state">No zone scores available.</p>';
    return;
  }

  ui.zonesContent.innerHTML = zones
    .map((zone) => {
      const isFavorite = state.favorites.zones.includes(zone.id);
      const scoreTone = zoneScoreTone(zone.tripScore);
      return `
      <article class="zone-card">
        <div class="zone-head">
          <div>
            <h3>${escapeHtml(zone.name)}</h3>
            <p class="muted">${escapeHtml(zone.recommendation || "")}</p>
          </div>
          <button class="fav-btn ${isFavorite ? "active" : ""}" data-fav-kind="zones" data-fav-id="${escapeHtml(zone.id)}" aria-label="Favorite zone">
            ${isFavorite ? "★" : "☆"}
          </button>
        </div>
        <div class="mini-grid">
          <div class="mini-item"><span class="k">Trip</span><span class="v">${zone.tripScore}</span></div>
          <div class="mini-item"><span class="k">Safety</span><span class="v">${zone.safety}</span></div>
          <div class="mini-item"><span class="k">Fishability</span><span class="v">${zone.fishability}</span></div>
          <div class="mini-item"><span class="k">Confidence</span><span class="v">${zone.confidence}</span></div>
        </div>
        <p><span class="score-pill ${scoreTone}">Score ${zone.tripScore}</span></p>
        <ul class="list compact">
          ${(zone.why || []).slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
      </article>
    `;
    })
    .join("");
}

function renderLaunches() {
  if (!state.data) {
    ui.launchesContent.innerHTML = '<p class="empty-state">Load snapshot to rank launches.</p>';
    return;
  }

  const launches = state.data.launches || [];
  if (!launches.length) {
    ui.launchesContent.innerHTML = '<p class="empty-state">No launch guidance available.</p>';
    return;
  }

  ui.launchesContent.innerHTML = launches
    .slice(0, 6)
    .map((launch) => {
      const isFavorite = state.favorites.launches.includes(launch.id);
      return `
      <article class="launch-card">
        <div class="launch-head">
          <div>
            <h3>${escapeHtml(launch.name)}</h3>
            <p class="muted">${escapeHtml(launch.zoneName)} | ${escapeHtml(launch.advice)}</p>
          </div>
          <button class="fav-btn ${isFavorite ? "active" : ""}" data-fav-kind="launches" data-fav-id="${escapeHtml(launch.id)}" aria-label="Favorite launch">
            ${isFavorite ? "★" : "☆"}
          </button>
        </div>
        <p class="muted">Exposure: ${escapeHtml(launch.exposureSummary)}</p>
        <p>${escapeHtml(launch.notes || "")}</p>
      </article>
      `;
    })
    .join("");
}

function renderReports() {
  if (!state.data) {
    ui.reportsContent.innerHTML = '<p class="empty-state">Load snapshot to view bite signal.</p>';
    return;
  }

  const reports = state.data.reports || {};
  const items = reports.items || [];
  const sourceSummary = reports.sourceSummary || "No source summary.";

  ui.reportsContent.innerHTML = `
    <p class="muted">${escapeHtml(sourceSummary)}</p>
    ${
      items.length
        ? items
            .slice(0, 7)
            .map(
              (item) => `
      <article class="report-card">
        <div class="report-head">
          <strong>${escapeHtml(item.zoneName || item.zoneId || "Bay-wide")}</strong>
          <span class="muted">${escapeHtml(formatRelativeTime(item.observedAt))}</span>
        </div>
        <p>${escapeHtml(item.summary || "Report received.")}</p>
        <p class="muted">${escapeHtml(item.source || "Unknown source")} | Signal ${signalLabel(item.signal)}</p>
      </article>
    `,
            )
            .join("")
        : '<p class="empty-state">No recent reports.</p>'
    }
  `;
}

function renderPreferences() {
  const species = ["walleye", "perch", "mixed"];
  const activeSpecies = state.favorites.species || "walleye";
  const notificationState = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const dayKey = state.data?.snapshotDate || getDateKeyInTimeZone(APP_TIMEZONE);

  const favoriteZoneNames = (state.data?.zones || [])
    .filter((zone) => state.favorites.zones.includes(zone.id))
    .map((zone) => zone.name);
  const favoriteLaunchNames = (state.data?.launches || [])
    .filter((launch) => state.favorites.launches.includes(launch.id))
    .map((launch) => launch.name);

  ui.prefsContent.innerHTML = `
    <div>
      <p class="metric-label">Target Species</p>
      <div class="control-row">
        ${species
          .map(
            (value) => `
          <button type="button" class="chip-btn ${value === activeSpecies ? "active" : ""}" data-species="${value}">
            ${capitalize(value)}
          </button>
        `,
          )
          .join("")}
      </div>
      <p class="muted">Daily lock date: ${dayKey} (changes next day).</p>
    </div>

    <div>
      <p class="metric-label">Favorites</p>
      <p class="muted">Zones: ${favoriteZoneNames.length ? escapeHtml(favoriteZoneNames.join(", ")) : "none"}</p>
      <p class="muted">Launches: ${favoriteLaunchNames.length ? escapeHtml(favoriteLaunchNames.join(", ")) : "none"}</p>
    </div>

    <label class="switch">
      <input id="alerts-enabled" type="checkbox" ${state.alerts.enabled ? "checked" : ""}>
      Enable condition-change alerts
    </label>

    <label class="switch">
      <input id="notify-bay-call" type="checkbox" ${state.alerts.notifyOnBayCallChange ? "checked" : ""}>
      Notify when bay call changes
    </label>

    <div class="range-wrap">
      <label class="metric-label" for="score-shift">Alert when top-zone score shifts</label>
      <strong id="score-shift-value">${state.alerts.scoreShiftThreshold} pts</strong>
      <input id="score-shift" type="range" min="4" max="25" step="1" value="${state.alerts.scoreShiftThreshold}">
    </div>

    <div class="control-row">
      <button type="button" class="chip-btn" data-action="request-notify">Enable Browser Notifications</button>
      <span class="muted">Notification permission: ${notificationState}</span>
    </div>
  `;
}

function toggleFavorite(kind, id) {
  if (!["zones", "launches"].includes(kind)) {
    return;
  }

  const list = state.favorites[kind];
  const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  state.favorites[kind] = next;
  saveStored("saginaw:favorites", state.favorites);
  render();
}

function handlePotentialAlert(nextPayload) {
  const topZone = nextPayload?.zones?.[0];
  const snapshot = {
    bayCall: nextPayload?.bayCall?.goNoGo || null,
    bayLabel: nextPayload?.bayCall?.label || null,
    topZoneId: topZone?.id || null,
    topZoneScore: topZone?.tripScore ?? null,
  };

  const previous = state.lastSnapshot;
  state.lastSnapshot = snapshot;

  if (!state.alerts.enabled || !previous || typeof Notification === "undefined") {
    return;
  }

  const bayChanged = state.alerts.notifyOnBayCallChange && previous.bayCall !== snapshot.bayCall;
  const zoneChanged = previous.topZoneId && previous.topZoneId !== snapshot.topZoneId;
  const scoreShift =
    Number.isFinite(previous.topZoneScore) &&
    Number.isFinite(snapshot.topZoneScore) &&
    Math.abs(previous.topZoneScore - snapshot.topZoneScore) >= state.alerts.scoreShiftThreshold;

  if (!bayChanged && !zoneChanged && !scoreShift) {
    return;
  }

  const pieces = [];
  if (bayChanged) {
    pieces.push(`Bay call changed to ${snapshot.bayLabel}.`);
  }
  if (zoneChanged) {
    pieces.push("Top zone switched.");
  }
  if (scoreShift) {
    pieces.push(`Top-zone score moved ${Math.abs(previous.topZoneScore - snapshot.topZoneScore)} points.`);
  }
  notify("Saginaw Bay condition update", pieces.join(" "));
}

function syncSnapshotMemory(payload) {
  const topZone = payload?.zones?.[0];
  state.lastSnapshot = {
    bayCall: payload?.bayCall?.goNoGo || null,
    bayLabel: payload?.bayCall?.label || null,
    topZoneId: topZone?.id || null,
    topZoneScore: topZone?.tripScore ?? null,
  };
}

async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission === "granted") {
    notify("Notifications already enabled", "You will receive condition-change alerts when triggers fire.");
    return;
  }

  if (Notification.permission === "denied") {
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    notify("Alerts enabled", "Condition-change notifications are now active in this browser.");
  }
  renderPreferences();
}

function notify(title, body) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  new Notification(title, { body });
}

function bayCallClass(goNoGo) {
  if (goNoGo === "GO") {
    return "good";
  }
  if (goNoGo === "CAUTION") {
    return "caution";
  }
  if (goNoGo === "NO_GO") {
    return "bad";
  }
  return "neutral";
}

function zoneScoreTone(score) {
  if (score >= 72) {
    return "strong";
  }
  if (score >= 56) {
    return "moderate";
  }
  return "weak";
}

function signalLabel(signal) {
  if (signal >= 0.35) {
    return "positive";
  }
  if (signal <= -0.2) {
    return "negative";
  }
  return "mixed";
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatRelativeTime(input) {
  if (!input) {
    return "unknown";
  }

  const value = new Date(input).getTime();
  if (Number.isNaN(value)) {
    return "unknown";
  }

  const diffMs = Date.now() - value;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function getDateKeyInTimeZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function toFixed(value, digits) {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(digits);
}

function escapeHtml(input) {
  const value = String(input ?? "");
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function snapshotStorageKey(species, dayKey) {
  return `${SNAPSHOT_PREFIX}:${species}:${dayKey}`;
}

function isValidSnapshot(snapshot, expectedDayKey) {
  return Boolean(snapshot && typeof snapshot === "object" && snapshot.snapshotDate === expectedDayKey);
}

function pruneOldSnapshots(activeDayKey) {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(`${SNAPSHOT_PREFIX}:`)) {
        continue;
      }
      if (!key.endsWith(`:${activeDayKey}`)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage failures.
  }
}

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (
      fallback
      && typeof fallback === "object"
      && !Array.isArray(fallback)
      && parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
    ) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

init();
