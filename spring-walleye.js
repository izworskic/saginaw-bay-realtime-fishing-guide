"use strict";
(function () {
  const root = document.getElementById("spring-run");
  if (!root) return;
  const heading = document.getElementById("spring-run-status");
  const stations = document.getElementById("spring-run-stations");
  const updated = document.getElementById("spring-run-updated");
  const refresh = document.getElementById("spring-run-refresh");

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function observedAt(iso) {
    if (!iso || !Number.isFinite(Date.parse(iso))) return "Observation unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Detroit",
      timeZoneName: "short"
    }).format(new Date(iso));
  }
  function render(data) {
    heading.textContent = data.heading || "Conditions unavailable";
    stations.replaceChildren();
    for (const station of data.stations || []) {
      const card = el("article", "spring-station");
      const name = el("h3", "", station.river);
      const temp = el("p", "spring-metric", station.waterTempF == null ? "No current temperature" : station.waterTempF.toFixed(1) + " °F");
      const band = el("p", "spring-note", station.title);
      const flow = el("p", "spring-reading", station.flowCfs == null ? "Flow unavailable" : Math.round(station.flowCfs).toLocaleString() + " cfs");
      const time = el("p", "spring-reading", observedAt(station.waterObservedAt));
      const explanation = el("p", "spring-note", station.explanation);
      const link = el("a", "spring-source", "USGS station readings");
      link.href = station.siteUrl;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      card.append(name,temp,band,flow,time,explanation,link);
      stations.append(card);
    }
    updated.textContent = "Checked " + observedAt(data.generatedAt) + ". These readings do not verify fish presence, spawning, legal access, or fishing regulations.";
  }
  async function load() {
    refresh.disabled = true;
    heading.textContent = "Reading USGS river stations...";
    try {
      const response = await fetch("/api/spring-walleye", {headers: {Accept: "application/json"}});
      if (!response.ok) throw new Error("Source request failed");
      const data = await response.json();
      render(data);
    } catch {
      heading.textContent = "Live measurements could not be retrieved";
      stations.replaceChildren(el("p","spring-note","Check the official USGS station links below before planning."));
      updated.textContent = "No substitute river temperatures were generated.";
    } finally {
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", load);
  load();
})();
