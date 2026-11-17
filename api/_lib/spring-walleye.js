"use strict";

// Environmental screening only. No input here confirms that walleye are present.
const { regionSummaries } = require("./spring-walleye-evidence");
const STATIONS = Object.freeze([
  { id: "04157005", name: "Saginaw River at Saginaw", river: "Saginaw River" },
  { id: "04156000", name: "Tittabawassee River at Midland", river: "Tittabawassee River" },
  { id: "04165710", name: "Detroit River at Fort Wayne", river: "Detroit River" },
  { id: "04193500", name: "Maumee River at Waterville", river: "Maumee River" },
  { id: "04198000", name: "Sandusky River near Fremont", river: "Sandusky River" },
]);
const CURRENT_MS = 6 * 3600000;
function numeric(value, low, high) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= low && n <= high ? n : null;
}
function recent(time, now) {
  const t = Date.parse(time || "");
  return Number.isFinite(t) && t <= now + 600000 && now - t <= CURRENT_MS;
}
function monthInMichigan(now) {
  return Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/Detroit",month:"numeric"}).format(new Date(now)));
}
function stationSnapshot(station, sample, now = Date.now()) {
  const date = typeof now === "number" ? now : new Date(now).getTime();
  const waterF = numeric(sample?.waterTempF, 30, 90);
  const flowCfs = numeric(sample?.flowCfs, 0, 300000);
  const tempFresh = waterF !== null && recent(sample?.tempObservedAt, date);
  const flowFresh = flowCfs !== null && recent(sample?.flowObservedAt, date);
  const observed = tempFresh ? sample.tempObservedAt : null;
  let code = "MEASUREMENT_MISSING";
  let title = "Water temperature unavailable";
  let explanation = "This station did not return a recent usable temperature. No temperature-based spring signal is shown.";
  if (tempFresh && waterF < 40) {
    code = "COLD_WATER";
    title = "Cold-water watch";
    explanation = "Measured river water remains cold. This is a temperature observation, not a finding about walleye location.";
  } else if (tempFresh && waterF < 50) {
    code = "SPRING_WARMING";
    title = "Spring warming conditions";
    explanation = "Water is in a spring warming range. One measurement cannot establish a warming trend or a spawning run.";
  } else if (tempFresh && waterF <= 60) {
    code = "MILD_SPRING_WATER";
    title = "Milder spring water";
    explanation = "Measured water has warmed into a milder range. Fish activity and spawning have not been verified.";
  } else if (tempFresh) {
    code = "WARM_WATER";
    title = "Warm-water conditions";
    explanation = "Measured water is above the spring screening range. This is not a fish-presence signal.";
  }
  return {
    id: station.id, river: station.river, name: station.name,
    siteUrl: "https://waterdata.usgs.gov/monitoring-location/" + station.id + "/",
    waterTempF: tempFresh ? waterF : null,
    waterObservedAt: observed,
    flowCfs: flowFresh ? flowCfs : null,
    flowObservedAt: flowFresh ? sample.flowObservedAt : null,
    code, title, explanation, source: "USGS instantaneous station observations",
    limitations: ["No fish-presence observations", "No verified spawning dates", "No access or fishing-regulation verdict"],
  };
}
function assemble(samples, now = Date.now()) {
  const time = typeof now === "number" ? now : new Date(now).getTime();
  const activeSeason = [3, 4, 5].includes(monthInMichigan(time));
  const stations = STATIONS.map(s => stationSnapshot(s, samples?.[s.id], time));
  const withTemperature = stations.filter(s => s.waterTempF !== null).length;
  return {
    version: "spring-walleye-context-v1",
    generatedAt: new Date(time).toISOString(),
    season: activeSeason ? "spring-watch" : "off-season",
    status: !activeSeason ? "OFF_SEASON" : withTemperature ? "TEMPERATURE_CONTEXT" : "DATA_UNAVAILABLE",
    heading: !activeSeason ? "Spring run watch returns in March" :
      withTemperature ? "River conditions are available. The walleye run is not confirmed." :
        "Current river temperatures are unavailable",
    fishPresence: "unverified",
    stations,
    regions: regionSummaries(stations, time),
    interpretation: "This tool reports measured conditions and dated historical fisheries references. It does not forecast, confirm, or locate a walleye spawning run.",
    nextSteps: [
      {label: "Check current Michigan fishing regulations", url: "https://www.michigan.gov/dnr/things-to-do/fishing/regulations"},
      {label: "Check Michigan DNR fishing reports", url: "https://www.michigan.gov/dnr/things-to-do/fishing/weekly"},
      {label: "Check official USGS water readings", url: "https://waterdata.usgs.gov/"},
    ],
  };
}
module.exports = {STATIONS, stationSnapshot, assemble, recent, monthInMichigan};
