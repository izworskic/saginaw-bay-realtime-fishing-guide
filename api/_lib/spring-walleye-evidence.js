"use strict";

// Editorial evidence register. Every report is historical until a dated, verified
// new-season observation is reviewed and explicitly added. No guessed fish counts.
const FISHERY_REPORTS = Object.freeze([
  {
    id:"detroit-mdnr-2026-season",
    region:"detroit",
    publisher:"Michigan Department of Natural Resources",
    issuedAt:"2026-06-05",
    kind:"season-review",
    label:"Michigan DNR review of the 2026 Detroit River spring walleye season",
    finding:"DNR fisheries staff described successful pre-spawn, spawning and post-spawn fishing in spring 2026.",
    url:"https://www.michigan.gov/dnr/about/newsroom/releases/2026/06/05/dnr-reminds-anglers-about-walleye-possession-limit-on-detroit-river",
    observationPeriod:"2026 spring",
  },
  {
    id:"ohio-dnr-2026-river-report-listing",
    region:"maumee",
    publisher:"Ohio Department of Natural Resources",
    issuedAt:"2026-04-14",
    kind:"report-index",
    label:"ODNR Maumee and Sandusky spring river fishing report index, 2026",
    finding:"Ohio DNR listed a river-specific walleye and white bass report dated April 14, 2026. The index does not establish today's catches.",
    url:"https://ohiodnr.gov/buy-and-apply/hunting-fishing-boating/fishing-resources/fishing-reports-forecasts",
    observationPeriod:"2026 spring",
  },
  {
    id:"ohio-dnr-2026-sandusky-report-listing",
    region:"sandusky",
    publisher:"Ohio Department of Natural Resources",
    issuedAt:"2026-04-14",
    kind:"report-index",
    label:"ODNR Maumee and Sandusky spring river fishing report index, 2026",
    finding:"Ohio DNR listed a river-specific walleye and white bass report dated April 14, 2026. The index does not establish today's catches.",
    url:"https://ohiodnr.gov/buy-and-apply/hunting-fishing-boating/fishing-resources/fishing-reports-forecasts",
    observationPeriod:"2026 spring",
  },
]);
const REGIONS = Object.freeze([
  {id:"saginaw", name:"Saginaw River system", state:"Michigan", stationIds:["04157005","04156000"],
    authority:"Michigan DNR", reportsUrl:"https://www.michigan.gov/dnr/things-to-do/fishing/weekly",
    statusNote:"Michigan's weekly fishing report was suspended after November 4, 2026. A new-season report has not been verified."},
  {id:"detroit", name:"Detroit River", state:"Michigan", stationIds:["04165710"],
    authority:"Michigan DNR", reportsUrl:"https://www.michigan.gov/dnr/things-to-do/fishing/weekly",
    statusNote:"The 2026 season review is history, not a report about the 2027 run. This international river has additional fishing requirements."},
  {id:"maumee", name:"Maumee River", state:"Ohio", stationIds:["04193500"],
    authority:"Ohio DNR", reportsUrl:"https://ohiodnr.gov/buy-and-apply/hunting-fishing-boating/fishing-resources/fishing-reports-forecasts",
    statusNote:"Ohio's indexed 2026 river-run update is historical. Special spring river rules must be checked each season."},
  {id:"sandusky", name:"Sandusky River", state:"Ohio", stationIds:["04198000"],
    authority:"Ohio DNR", reportsUrl:"https://ohiodnr.gov/buy-and-apply/hunting-fishing-boating/fishing-resources/fishing-reports-forecasts",
    statusNote:"The previous season's reporting does not confirm any current run. Check ODNR for current location-specific rules."},
]);
function datedEvidence(report, now) {
  const timestamp = Date.parse(report.issuedAt + "T12:00:00Z");
  const date = new Date(now);
  const ageDays = Number.isFinite(timestamp) ? Math.floor((now - timestamp) / 86400000) : null;
  const sameYear = Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() === date.getUTCFullYear();
  const currentSeason = sameYear && ageDays !== null && ageDays >= 0 && ageDays <= 14
    && report.kind === "current-catch-observation" && Boolean(report.reviewed === true);
  return {...report, ageDays, currentSeason, status:currentSeason?"recent-reviewed-observation":"historical-only"};
}
function regionSummaries(stations, now = Date.now()) {
  return REGIONS.map(region => {
    const rows = stations.filter(s => region.stationIds.includes(s.id));
    const reports = FISHERY_REPORTS.filter(r=>r.region===region.id).map(r=>datedEvidence(r,now));
    return {
      ...region,
      stations: rows,
      reports,
      fishPresence: "unverified",
      seasonEvidence: reports.some(report=>report.currentSeason) ? "RECENT_OFFICIAL_REPORT" : "NO_CURRENT_REPORT",
      latestHistoricalReportDate: reports.map(r=>r.issuedAt).sort().at(-1)||null,
      summary:reports.some(r=>r.currentSeason)
        ? "A dated fisheries report exists. It does not confirm fish at your selected location."
        : "No independently reviewed fishery observation from the current season. Water conditions are not a fish-run report.",
    };
  });
}
module.exports={REGIONS,FISHERY_REPORTS,datedEvidence,regionSummaries};
