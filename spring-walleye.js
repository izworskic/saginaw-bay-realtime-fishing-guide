"use strict";
(function () {
  const root = document.getElementById("spring-run");
  if (!root) return;
  const heading = document.getElementById("spring-run-status");
  const stations = document.getElementById("spring-run-stations");
  const updated = document.getElementById("spring-run-updated");
  const refresh = document.getElementById("spring-run-refresh");
  const selector = document.getElementById("spring-region-select");
  const reportList = document.getElementById("spring-reports");
  const reportContext = document.getElementById("spring-evidence-status");
  const authority = document.getElementById("spring-official-report");
  let latest = null;

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
  function displayRegion() {
    if (!latest) return;
    const selected = latest.regions?.find(region => region.id === selector.value);
    if (!selected) return;
    heading.textContent = selected.name + ": " + selected.summary;
    stations.replaceChildren();
    for (const station of selected.stations || []) {
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
    reportList.replaceChildren();
    for (const report of selected.reports || []) {
      const item = el("li", "spring-report");
      const date = el("span", "spring-report-date", (report.issuedAt || "Undated guidance") + " | " + report.status.replaceAll("-", " "));
      const link = el("a", "", report.label);
      link.href = report.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const finding = el("p", "spring-note", report.finding);
      item.append(date, link, finding);
      reportList.append(item);
    }
    if (!reportList.children.length) {
      reportList.append(el("li","spring-note","No source-reviewed fishery report has been added for this river."));
    }
    reportContext.textContent = selected.statusNote;
    authority.href = selected.reportsUrl;
    authority.textContent = selected.sourceActionLabel || ("Check " + selected.authority + " fishery reports");
    updated.textContent = "Station fetch " + observedAt(latest.generatedAt) + ". Water readings do not verify fish presence, spawning, access, or fishing regulations.";
  }
  function render(data) {
    latest = data;
    const previous = selector.value;
    selector.replaceChildren();
    for (const region of data.regions || []) {
      const option = el("option", "", region.name);
      option.value = region.id;
      selector.appendChild(option);
    }
    selector.value = (data.regions || []).some(region=>region.id === previous) ? previous : "saginaw";
    displayRegion();
  }
  async function load() {
    refresh.disabled = true;
    heading.textContent = "Reading USGS river stations...";
    try {
      const response = await fetch("/api/spring-walleye", {headers: {Accept: "application/json"}});
      if (!response.ok) throw new Error("Source request failed");
      render(await response.json());
    } catch {
      heading.textContent = latest ? "Could not refresh current observations. Previously loaded data may be stale." :
        "Live measurements could not be retrieved";
      if (!latest) {
        stations.replaceChildren(el("p","spring-note","Use the official USGS station links below before planning."));
        updated.textContent = "No substitute river temperatures were generated.";
      }
    } finally {
      refresh.disabled = false;
    }
  }
  selector.addEventListener("change",displayRegion);
  refresh.addEventListener("click",load);
  load();
})();
