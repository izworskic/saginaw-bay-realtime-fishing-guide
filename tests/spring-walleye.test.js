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
