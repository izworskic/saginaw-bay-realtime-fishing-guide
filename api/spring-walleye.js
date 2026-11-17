"use strict";
const { fetchUsgs } = require("./_lib/sensor-sources");
const { STATIONS, assemble } = require("./_lib/spring-walleye");

module.exports = async function springWalleye(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({error: "GET only"});
  }
  const results = await Promise.allSettled(STATIONS.map(station => fetchUsgs(station.id)));
  const samples = {};
  STATIONS.forEach((station, i) => {
    samples[station.id] = results[i].status === "fulfilled" ? results[i].value : {error:"USGS request failed"};
  });
  const payload = assemble(samples);
  payload.sources = STATIONS.map(station => ({
    id: station.id,
    name: "USGS " + station.name,
    url: "https://waterdata.usgs.gov/monitoring-location/" + station.id + "/",
    status: payload.stations.find(s => s.id === station.id).waterTempF === null ? "missing-or-stale" : "current",
  }));
  return res.status(200).json(payload);
};
