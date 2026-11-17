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
    id:"ohio-dnr-maumee-spring-guidance-2022",
    region:"maumee",
    publisher:"Ohio Department of Natural Resources",
    issuedAt:"2022-01-27",
    kind:"seasonal-guidance",
    label:"Ohio DNR Maumee River Spring Walleye Fishing guide",
    finding:"Ohio DNR describes typical March and April spawning conditions. This guide is not a recent catch or run observation.",
    url:"https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/wildlife/fish-management/036IL%20-%20Maumee%20River%20Walleye%20-%202022_FINAL.pdf",
    observationPeriod:"Historical seasonal guidance",
  },
  {
    id:"ohio-dnr-lake-erie-guide",
    region:"sandusky",
    publisher:"Ohio Department of Natural Resources",
    issuedAt:null,
    kind:"seasonal-guidance",
    label:"Ohio DNR Lake Erie Fishing Guide, river-run timing",
    finding:"Ohio DNR describes typical early-spring walleye movement into the Maumee and Sandusky rivers. This is background guidance, not a 2027 fishing report.",
    url:"https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/wildlife/fishing/Pub5276_LakeErieFishingGuide_Web.pdf",
    observationPeriod:"Undated historical reference",
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
    authority:"Ohio DNR", reportsUrl:"https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/wildlife/fish-management/036IL%20-%20Maumee%20River%20Walleye%20-%202022_FINAL.pdf",
    sourceActionLabel:"Read Ohio DNR seasonal guidance",
    statusNote:"Historical guidance is not a current fishing report. Check the current year's special spring river regulations."},
  {id:"sandusky", name:"Sandusky River", state:"Ohio", stationIds:["04198000"],
    authority:"Ohio DNR", reportsUrl:"https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/wildlife/fishing/Pub5276_LakeErieFishingGuide_Web.pdf",
    sourceActionLabel:"Read Ohio DNR Lake Erie guide",
    statusNote:"The published guide describes typical runs, not recent catch observations. Verify current location-specific fishing rules."},
]);
function datedEvidence(report, now) {
  const timestamp = Date.parse(report.issuedAt ? report.issuedAt + "T12:00:00Z" : "");
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
      latestHistoricalReportDate: reports.map(r=>r.issuedAt).filter(Boolean).sort().at(-1)||null,
      summary:reports.some(r=>r.currentSeason)
        ? "A dated fisheries report exists. It does not confirm fish at your selected location."
        : "No independently reviewed fishery observation from the current season. Water conditions are not a fish-run report.",
    };
  });
}
module.exports={REGIONS,FISHERY_REPORTS,datedEvidence,regionSummaries};
