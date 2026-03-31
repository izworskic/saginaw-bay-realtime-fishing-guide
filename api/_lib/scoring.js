const { LAUNCHES, SPECIES, ZONES } = require("./constants");
const { average, clamp, confidenceLabel, directionToCardinal, round, sourceWeight } = require("./helpers");

function buildDailySummary({ conditions, alerts, reports, speciesKey, sourceStatuses }) {
  const species = SPECIES[speciesKey] || SPECIES.walleye;
  const windCardinal = directionToCardinal(conditions.windDirectionDeg);
  const severeAlert = findSevereAlert(alerts);
  const alertPenalty = computeAlertPenalty(alerts);

  const zones = ZONES.map((zone) => scoreZone({
    zone,
    species,
    conditions,
    reports,
    windCardinal,
    alertPenalty,
  })).sort((a, b) => b.tripScore - a.tripScore);

  const topZone = zones[0];
  const lowestSafetyZone = [...zones].sort((a, b) => a.safety - b.safety)[0];
  const bayCall = computeBayCall({
    topZone,
    zones,
    severeAlert,
    conditions,
    alerts,
  });

  const launches = scoreLaunches({ zones, windCardinal });
  const reportSummary = summarizeReports(reports);

  return {
    generatedAt: new Date().toISOString(),
    species: species.key,
    scoreModel: "trip = safety + fishability + recentSignal + confidence - friction",
    bayCall,
    bestSetup: {
      id: topZone.id,
      name: topZone.name,
      score: topZone.tripScore,
    },
    avoidOrCaution: lowestSafetyZone ? `${lowestSafetyZone.name} (${lowestSafetyZone.safety})` : "None",
    conditions: {
      ...conditions,
      windDirectionCardinal: windCardinal,
      alertHeadline: severeAlert ? severeAlert.event : alerts.length ? "Active alerts in area" : "No active alerts",
    },
    alerts: alerts.slice(0, 6),
    zones,
    launches,
    reports: reportSummary,
    sources: sourceStatuses,
  };
}

function scoreZone({ zone, species, conditions, reports, windCardinal, alertPenalty }) {
  const exposureFactor = zone.exposure[windCardinal] || 1;
  const windPenalty = Math.max(0, (conditions.windMph || 0) - 8) * 2.35 * exposureFactor;
  const wavePenalty = Math.max(0, (conditions.waveFt || 0) - 1) * 14.5 * exposureFactor;
  const accessPenalty = (conditions.smallBoatWindowHours || 0) <= 4 ? 9 : 0;
  const safety = clamp(round(100 - windPenalty - wavePenalty - alertPenalty * exposureFactor - accessPenalty), 0, 100);

  const zoneReports = reports.filter((report) => report.zoneId === zone.id);
  const bayWideReports = reports.filter((report) => report.zoneId !== zone.id);
  const reportPool = [...zoneReports, ...bayWideReports.slice(0, 4)];

  const recentSignal = computeRecentSignal(reportPool, species.key);
  const tempScore = scoreWaterTemperature(conditions.waterTempF, species);
  const trendScore = scoreTemperatureTrend(conditions.waterTempTrendF, species);
  const fishability = clamp(round(tempScore * 0.42 + trendScore * 0.18 + recentSignal * 0.4), 0, 100);
  const confidence = computeConfidence({ conditions, reports: reportPool });
  const friction = clamp(zone.friction + (zone.id === "outer-bay" && conditions.smallBoatWindowHours < 6 ? 6 : 0), 0, 40);

  const tripRaw = safety * 0.34 + fishability * 0.29 + recentSignal * 0.22 + confidence * 0.15 - friction * 0.85;
  const tripScore = clamp(round(tripRaw), 0, 100);

  return {
    id: zone.id,
    name: zone.name,
    recommendation: scoreRecommendation(tripScore, safety),
    tripScore,
    safety,
    fishability: round(fishability),
    recentSignal: round(recentSignal),
    confidence: round(confidence),
    friction,
    why: explainZone({
      zone,
      safety,
      fishability,
      recentSignal,
      confidence,
      windCardinal,
      exposureFactor,
      conditions,
      reportCount: zoneReports.length,
    }),
  };
}

function scoreLaunches({ zones, windCardinal }) {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  return LAUNCHES.map((launch) => {
    const zone = zoneById.get(launch.zoneId);
    const exposed = launch.exposedTo.includes(windCardinal);
    const launchScore = clamp((zone?.tripScore || 0) - (exposed ? 11 : 3), 0, 100);
    return {
      id: launch.id,
      name: launch.name,
      zoneId: launch.zoneId,
      zoneName: zone?.name || launch.zoneId,
      score: round(launchScore),
      advice: launchScore >= 70 ? "Solid option today" : launchScore >= 54 ? "Fishable with caution" : "Only if local and experienced",
      exposureSummary: exposed ? `${windCardinal} wind adds chop at this access.` : `${windCardinal} wind is less exposed here.`,
      notes: launch.notes,
    };
  }).sort((a, b) => b.score - a.score);
}

function computeBayCall({ topZone, zones, severeAlert, conditions, alerts }) {
  const averageSafety = average(zones.map((zone) => zone.safety));
  const hardSafetyOverride =
    Boolean(severeAlert)
    || (conditions.waveFt || 0) >= 4.5
    || (conditions.windMph || 0) >= 24;

  let goNoGo;
  let label;
  if (hardSafetyOverride) {
    goNoGo = "NO_GO";
    label = "No-Go for Most Small Boats";
  } else if ((topZone?.tripScore || 0) >= 72 && averageSafety >= 58) {
    goNoGo = "GO";
    label = "Go with a Focused Plan";
  } else {
    goNoGo = "CAUTION";
    label = "Fishable with Caution";
  }

  const confidenceScore = round(topZone?.confidence || 0);
  return {
    goNoGo,
    label,
    confidenceScore,
    confidenceLabel: confidenceLabel(confidenceScore),
    summary: bayCallSummary(goNoGo, topZone?.name, alerts.length),
    rationale: buildBayRationale({
      goNoGo,
      topZone,
      conditions,
      averageSafety,
      severeAlert,
      alertCount: alerts.length,
    }),
  };
}

function summarizeReports(reports) {
  if (!reports.length) {
    return {
      sourceSummary: "Thin reporting. Official conditions are driving most recommendations.",
      sourceAgreement: "low",
      items: [],
    };
  }

  const weightedSignals = reports.map((report) => report.signal * sourceWeight(report.source));
  const avgSignal = average(weightedSignals);
  const freshness = average(reports.map((report) => report.freshnessHours || 72));
  const spread = signalSpread(reports.map((report) => report.signal));
  const agreement = spread < 0.28 ? "high" : spread < 0.5 ? "medium" : "low";

  const sourceSummary = [
    agreement === "high" ? "Sources broadly agree." : agreement === "medium" ? "Sources are mixed." : "Sources conflict noticeably.",
    freshness <= 12 ? "Reports are fresh." : "Report freshness is moderate.",
  ].join(" ");

  return {
    sourceSummary,
    sourceAgreement: agreement,
    items: reports
      .slice()
      .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
      .slice(0, 12)
      .map((report) => ({
        ...report,
        zoneName: zoneName(report.zoneId),
        signal: round(report.signal, 2),
      })),
    aggregates: {
      averageSignal: round(avgSignal, 2),
      averageFreshnessHours: round(freshness, 1),
      reportCount: reports.length,
    },
  };
}

function computeRecentSignal(reports, targetSpecies) {
  if (!reports.length) {
    return 44;
  }

  let totalWeight = 0;
  let signalAccumulator = 0;

  for (const report of reports) {
    const freshnessWeight = clamp(1 - (report.freshnessHours || 72) / 96, 0.25, 1);
    const speciesWeight = report.species === targetSpecies || report.species === "mixed" ? 1 : 0.68;
    const trustWeight = sourceWeight(report.source);
    const weight = freshnessWeight * speciesWeight * trustWeight;
    signalAccumulator += report.signal * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return 44;
  }

  const normalized = signalAccumulator / totalWeight;
  return clamp(round((normalized + 1) * 50), 0, 100);
}

function computeConfidence({ conditions, reports }) {
  const officialCoverage = [
    conditions.windMph,
    conditions.waveFt,
    conditions.airTempF,
    conditions.waterTempF,
  ].filter((value) => Number.isFinite(value)).length;

  const officialScore = clamp(officialCoverage * 24, 20, 100);
  const reportCountScore = clamp(reports.length * 17, 20, 100);
  const freshnessScore = clamp(100 - average(reports.map((report) => report.freshnessHours || 120)) * 2.4, 20, 100);
  const agreementScore = clamp(100 - signalSpread(reports.map((report) => report.signal)) * 100, 28, 100);

  return round(officialScore * 0.48 + reportCountScore * 0.2 + freshnessScore * 0.18 + agreementScore * 0.14);
}

function scoreWaterTemperature(waterTempF, species) {
  if (!Number.isFinite(waterTempF)) {
    return 54;
  }
  if (waterTempF >= species.tempMinF && waterTempF <= species.tempMaxF) {
    return 84;
  }
  const distance = Math.min(
    Math.abs(waterTempF - species.tempMinF),
    Math.abs(waterTempF - species.tempMaxF),
  );
  return clamp(84 - distance * 5.2, 25, 84);
}

function scoreTemperatureTrend(trendF, species) {
  if (!Number.isFinite(trendF)) {
    return 52;
  }

  if (species.trendPreference === "warming") {
    return clamp(55 + trendF * 15, 20, 90);
  }

  return clamp(65 - Math.abs(trendF) * 10, 26, 88);
}

function scoreRecommendation(tripScore, safety) {
  if (safety < 46) {
    return "Use caution: safety signal is weak.";
  }
  if (tripScore >= 72) {
    return "Best setup right now.";
  }
  if (tripScore >= 58) {
    return "Fishable if you stay within the better window.";
  }
  return "Marginal setup. Consider alternate zone or wait for a shift.";
}

function explainZone({ zone, safety, fishability, recentSignal, confidence, windCardinal, exposureFactor, conditions, reportCount }) {
  const reasons = [];
  reasons.push(`${windCardinal} wind creates ${exposureFactor >= 1.05 ? "higher" : "lower"} wave exposure here.`);
  reasons.push(`Safety ${safety}, fishability ${round(fishability)}, report signal ${round(recentSignal)}.`);
  if (conditions.smallBoatWindowHours <= 4) {
    reasons.push("Short small-boat weather window reduces confidence.");
  } else {
    reasons.push(`Small-boat window around ${conditions.smallBoatWindowHours} hours today.`);
  }
  reasons.push(reportCount ? `${reportCount} local report(s) anchored this zone.` : "Few direct reports for this zone.");
  reasons.push(`Confidence sits at ${confidence}.`);
  return reasons.slice(0, 4);
}

function buildBayRationale({ goNoGo, topZone, conditions, averageSafety, severeAlert, alertCount }) {
  const reasons = [];

  if (goNoGo === "NO_GO") {
    reasons.push("Safety override triggered by advisory-level conditions.");
  } else if (goNoGo === "GO") {
    reasons.push("Safety and fishability align in at least one local zone.");
  } else {
    reasons.push("Signals are mixed; plan around smaller windows and protected water.");
  }

  reasons.push(`${topZone?.name || "Top zone"} leads with a trip score of ${topZone?.tripScore ?? "-"}.`);
  reasons.push(`Average zone safety is ${round(averageSafety)}.`);
  reasons.push(`Current wind ${round(conditions.windMph || 0)} mph, waves ${round(conditions.waveFt || 0, 1)} ft.`);
  if (severeAlert) {
    reasons.push(`Active alert: ${severeAlert.event}.`);
  } else if (alertCount > 0) {
    reasons.push(`${alertCount} active weather alert(s) in the area.`);
  } else {
    reasons.push("No active NWS alerts at query time.");
  }

  return reasons;
}

function bayCallSummary(goNoGo, topZoneName, alertCount) {
  if (goNoGo === "GO") {
    return `${topZoneName} currently offers the best setup; focus there first.`;
  }
  if (goNoGo === "NO_GO") {
    return "Conditions are beyond a safe comfort range for most small boats.";
  }
  return `${topZoneName} is fishable with caution; ${alertCount ? "watch active alerts closely" : "keep tight to protected water"}.`;
}

function signalSpread(values) {
  if (!values.length) {
    return 0.65;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max - min;
}

function computeAlertPenalty(alerts) {
  if (!alerts.length) {
    return 0;
  }
  return alerts.reduce((penalty, alert) => {
    const severity = String(alert.severity || "").toLowerCase();
    const event = String(alert.event || "").toLowerCase();
    if (event.includes("gale") || event.includes("storm")) {
      return penalty + 24;
    }
    if (event.includes("small craft")) {
      return penalty + 18;
    }
    if (severity.includes("extreme") || severity.includes("severe")) {
      return penalty + 12;
    }
    if (severity.includes("moderate")) {
      return penalty + 8;
    }
    return penalty + 4;
  }, 0);
}

function findSevereAlert(alerts) {
  return alerts.find((alert) => {
    const severity = String(alert.severity || "").toLowerCase();
    const event = String(alert.event || "").toLowerCase();
    return (
      event.includes("gale")
      || event.includes("storm")
      || event.includes("small craft")
      || severity.includes("extreme")
      || severity.includes("severe")
    );
  }) || null;
}

function zoneName(zoneId) {
  const zone = ZONES.find((item) => item.id === zoneId);
  return zone ? zone.name : zoneId;
}

module.exports = {
  buildDailySummary,
};
