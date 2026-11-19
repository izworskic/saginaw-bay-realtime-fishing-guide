"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {assemble, stationSnapshot, STATIONS} = require("../api/_lib/spring-walleye");

const spring = Date.parse("2027-04-14T12:00:00Z");
function sample(overrides = {}) {
  return {waterTempF: 45, tempObservedAt:"2027-04-14T11:00:00Z",flowCfs:1500,
    flowObservedAt:"2027-04-14T11:00:00Z", ...overrides};
}
test("spring water signals never establish a fish run", () => {
  const result = assemble({"04157005":sample(),"04156000":sample({waterTempF:52})}, spring);
  assert.equal(result.status,"TEMPERATURE_CONTEXT");
  assert.equal(result.fishPresence,"unverified");
  assert.equal(result.stations[0].code,"SPRING_WARMING");
  assert.equal(result.stations[1].code,"MILD_SPRING_WATER");
  assert.match(result.heading,/not confirmed/i);
  assert.ok(result.stations.every(s=>!/run confirmed|fish present/i.test(s.explanation)));
});
test("expired and missing readings do not become zero or an optimistic signal", () => {
  const result = assemble({"04157005":sample({tempObservedAt:"2027-04-13T00:00:00Z"}),"04156000":{error:"offline"}},spring);
  assert.equal(result.status,"DATA_UNAVAILABLE");
  assert.ok(result.stations.every(s=>s.waterTempF===null));
});
test("off-season never issues a spring run claim",()=>{
  const result=assemble({"04157005":sample()},Date.parse("2027-01-14T12:00:00Z"));
  assert.equal(result.status,"OFF_SEASON");
});
test("future readings and invalid values are rejected",()=>{
  const station=stationSnapshot(STATIONS[0], sample({tempObservedAt:"2027-04-15T12:00:00Z",flowCfs:999999}),spring);
  assert.equal(station.waterTempF,null);
  assert.equal(station.flowCfs,null);
});
test("existing canonical walleye page integrates the new field desk",()=>{
  const html=fs.readFileSync(require.resolve("../walleye.html"),"utf8");
  assert.match(html,/canonical" href="https:\/\/saginawbay\.chrisizworski\.com\/walleye"/);
  assert.match(html,/id="spring-run"/);
  assert.match(html,/spring-walleye\.js/);
  assert.match(html,/DNR fishing report/);
});

const {REGIONS,FISHERY_REPORTS,datedEvidence}=require("../api/_lib/spring-walleye-evidence");
test("all four river corridors reference genuine USGS monitoring stations",()=>{
  const expected={saginaw:["04157005","04156000"],detroit:["04165710"],maumee:["04193500"],sandusky:["04198000"]};
  assert.deepEqual(Object.fromEntries(REGIONS.map(r=>[r.id,r.stationIds])),expected);
  assert.equal(STATIONS.length,5);
});
test("2026 DNR observations remain historical in spring 2027",()=>{
  const d=assemble({"04165710":sample({waterTempF:46})},Date.parse("2027-04-09T12:00:00Z"));
  assert.equal(d.regions.length,4);
  for(const region of d.regions){
    assert.equal(region.seasonEvidence,"NO_CURRENT_REPORT");
    assert.equal(region.fishPresence,"unverified");
    assert.ok(region.reports.every(report=>report.currentSeason===false));
  }
  assert.ok(FISHERY_REPORTS.some(r=>r.region==="detroit"&&r.issuedAt==="2026-06-05"));
  assert.ok(FISHERY_REPORTS.every(r=>/^https:\/\//.test(r.url)));
});
test("an indexed report is not catch evidence even when dated recently",()=>{
  const record={...FISHERY_REPORTS.find(x=>x.region==="maumee"),issuedAt:"2027-04-06"};
  const d=datedEvidence(record,Date.parse("2027-04-08T12:00:00Z"));
  assert.equal(d.currentSeason,false);
  assert.equal(d.status,"historical-only");
});
test("even a reviewed recent catch report must not become guaranteed fish presence",()=>{
  const record={...FISHERY_REPORTS[0],kind:"current-catch-observation",reviewed:true,issuedAt:"2027-04-06"};
  const d=datedEvidence(record,Date.parse("2027-04-08T12:00:00Z"));
  assert.equal(d.currentSeason,true);
  const network=assemble({},Date.parse("2027-04-08T12:00:00Z"));
  assert.ok(network.regions.every(r=>r.fishPresence==="unverified"));
});
test("spring HTML has source selector, report dates and stable existing canonical",()=>{
  const html=fs.readFileSync(require.resolve("../walleye.html"),"utf8");
  assert.match(html,/spring-region-select/);
  assert.match(html,/spring-reports/);
  assert.match(html,/saginawbay\.chrisizworski\.com\/walleye/);
});
