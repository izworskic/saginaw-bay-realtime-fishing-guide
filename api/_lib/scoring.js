const { LAUNCHES, SPECIES, ZONES } = require("./constants");
const { average, clamp, confidenceLabel, directionToCardinal, round, sourceWeight } = require("./helpers");
const { MODEL_CONFIG, resolveActiveWeights } = require("./objective-model");

function buildDailySummary({ conditions, alerts, reports, speciesKey, sourceStatuses }) {
  const species = SPECIES[speciesKey] || SPECIES.walleye;
  const weights = resolveActiveWeights();
  const windCardinal = directionToCardinal(conditions.windDirectionDeg);
  const severeAlert = findSevereAlert(alerts);
  const alertPenalty = computeAlertPenalty(alerts);
  const hardSafetyOverride = isHardSafetyOverride({ severeAlert, alerts, conditions });

  const zones = ZONES.map((zone) => scoreZone({
    zone,
    species,
    conditions,
    reports,
    windCardinal,
    alertPenalty,
    hardSafetyOverride,
    weights,
  })).sort((a, b) => b.tripScore - a.tripScore);

  const topZone = zones[0];
  const lowestSafetyZone = [...zones].sort((a, b) => a.safety - b.safety)[0];
  const bayCall = computeBayCall({
    topZone,
    zones,
    severeAlert,
    hardSafetyOverride,
    conditions,
    alerts,
  });

  const launches = scoreLaunches({ zones, windCardinal });
  const reportSummary = summarizeReports(reports);

  return {
    generatedAt: new Date().toISOString(),
    species: species.key,
    scoreModel: MODEL_CONFIG.utilityFormula,
    objective: {
      version: MODEL_CONFIG.version,
      weights: {
        safety: round(weights.safety, 4),
        fishability: round(weights.fishability, 4),
        recentSignal: round(weights.recentSignal, 4),
        confidence: round(weights.confidence, 4),
        friction: round(weights.friction, 4),
      },
      constraints: MODEL_CONFIG.constraints,
      decisionThresholds: MODEL_CONFIG.decisionThresholds,
      learning: MODEL_CONFIG.learningObjective,
    },
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
    highlights: {
      noaaHazardSummary: conditions.noaaHazardSummary || null,
      shorelineForecastShort: conditions.shorelineForecastShort || null,
      waterLevel: conditions.waterLevelFtIGLD != null
        ? `${round(conditions.waterLevelFtIGLD, 2)} ft IGLD (${conditions.waterLevelTrendLabel || "trend unknown"})`
        : null,
      smallBoatWindowLabel: conditions.smallBoatWindowLabel || null,
    },
    alerts: alerts.slice(0, 6),
    zones,
    launches,
    reports: reportSummary,
    sources: sourceStatuses,
  };
}

function scoreZone({ zone, species, conditions, reports, windCardinal, alertPenalty, hardSafetyOverride, weights }) {
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
  const frictionRaw = clamp(zone.friction + (zone.id === "outer-bay" && conditions.smallBoatWindowHours < 6 ? 6 : 0), 0, MODEL_CONFIG.normalization.frictionMax);
  const friction = normalizeFriction(frictionRaw);

  const gate = hardSafetyOverride ? 0 : 1;
  const utilityRaw = gate * (
    weights.safety * safety
    + weights.fishability * fishability
    + weights.recentSignal * recentSignal
    + weights.confidence * confidence
    - weights.friction * friction
  );
  const tripScore = clamp(round(utilityRaw), 0, 100);
  const action = buildZoneAction({
    zone,
    species,
    conditions,
    tripScore,
    safety,
    fishability,
    recentSignal,
    windCardinal,
    exposureFactor,
    reportCount: zoneReports.length,
  });

  return {
    id: zone.id,
    name: zone.name,
    recommendation: scoreRecommendation({ tripScore, safety, gate }),
    tripScore,
    safety,
    fishability: round(fishability),
    recentSignal: round(recentSignal),
    confidence: round(confidence),
    friction: round(friction),
    gate,
    action,
    why: explainZone({
      safety,
      fishability,
      recentSignal,
      confidence,
      windCardinal,
      exposureFactor,
      conditions,
      reportCount: zoneReports.length,
      gate,
      tripScore,
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
      advice: launchScore >= 70 ? "Solid option today" : launchScore >= 50 ? "Fishable with caution" : "Only if local and experienced",
      exposureSummary: exposed ? `${windCardinal} wind adds chop at this access.` : `${windCardinal} wind is less exposed here.`,
      notes: launch.notes,
    };
  }).sort((a, b) => b.score - a.score);
}

function computeBayCall({ topZone, zones, severeAlert, hardSafetyOverride, conditions, alerts }) {
  const maxUtility = topZone?.tripScore || 0;
  const averageSafety = average(zones.map((zone) => zone.safety));
  const thresholds = MODEL_CONFIG.decisionThresholds;

  let goNoGo;
  let label;
  if (hardSafetyOverride) {
    goNoGo = "NO_GO";
    label = "No-Go for Most Small Boats";
  } else if (maxUtility >= thresholds.goMinUtility && averageSafety >= thresholds.goMinAvgSafety) {
    goNoGo = "GO";
    label = "Go with a Focused Plan";
  } else if (maxUtility >= thresholds.cautionMinUtility) {
    goNoGo = "CAUTION";
    label = "Fishable with Caution";
  } else {
    goNoGo = "NO_GO";
    label = "No-Go Based on Current Utility";
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
      maxUtility,
      severeAlert,
      hardSafetyOverride,
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

function scoreRecommendation({ tripScore, safety, gate }) {
  const thresholds = MODEL_CONFIG.decisionThresholds;
  if (gate === 0) {
    return "No-go: safety override is active.";
  }
  if (safety < 46) {
    return "Use caution: safety signal is weak.";
  }
  if (tripScore >= thresholds.goMinUtility) {
    return "Best setup right now.";
  }
  if (tripScore >= thresholds.cautionMinUtility) {
    return "Fishable if you stay within the better window.";
  }
  return "Marginal setup. Consider alternate zone or wait for a shift.";
}

function buildZoneAction({ zone, species, conditions, tripScore, safety, fishability, recentSignal, windCardinal, exposureFactor, reportCount }) {
  const launches = LAUNCHES.filter((launch) => launch.zoneId === zone.id);
  const bestLaunch = selectBestLaunch(launches, windCardinal);
  const boatWindow = conditions.smallBoatWindowHours || 0;
  const skyCover = conditions.skyCoverPctNoaa;
  const precip = conditions.shorelinePrecipChancePct ?? conditions.precipChancePctNoaa;

  const windowPlan = boatWindow >= 10
    ? "Run early and late; midday still manageable."
    : boatWindow >= 6
      ? "Prioritize first half of the day before exposure builds."
      : boatWindow >= 3
        ? "Short protected run only. Tight timing matters."
        : "Window is very limited; keep an abort route."

  const technique = buildTechniqueHint({
    speciesKey: species.key,
    zoneId: zone.id,
    recentSignal,
    waterTempF: conditions.waterTempF,
  });

  const caution = [
    exposureFactor >= 1.1 ? `${windCardinal} wind amplifies chop in this zone.` : `${windCardinal} wind exposure is relatively lower here.`,
    conditions.noaaHazardSummary ? conditions.noaaHazardSummary : null,
    Number.isFinite(precip) && precip >= 55 ? `Showers/storm chance near ${round(precip)}%.` : null,
  ].filter(Boolean).join(" ");

  const sourceBlend = reportCount
    ? `${reportCount} zone-specific reports + official conditions support this call.`
    : "Official conditions are leading due to thin direct reports.";

  return {
    bestLaunchId: bestLaunch?.id || null,
    bestLaunchName: bestLaunch?.name || null,
    launchReason: bestLaunch
      ? (bestLaunch.exposedTo.includes(windCardinal)
        ? `${bestLaunch.name}: usable, but watch ${windCardinal} exposure at the ramp.`
        : `${bestLaunch.name}: better shielded for ${windCardinal} wind.`)
      : "No mapped launch recommendation for this zone.",
    windowPlan,
    technique,
    caution,
    sourceBlend,
    snapshot: `Trip ${tripScore} | Safety ${safety} | Fishability ${round(fishability)} | Signal ${round(recentSignal)}${Number.isFinite(skyCover) ? ` | Sky ${round(skyCover)}%` : ""}`,
  };
}

function selectBestLaunch(launches, windCardinal) {
  if (!launches.length) {
    return null;
  }
  return launches
    .slice()
    .sort((a, b) => {
      const aExposed = a.exposedTo.includes(windCardinal) ? 1 : 0;
      const bExposed = b.exposedTo.includes(windCardinal) ? 1 : 0;
      return aExposed - bExposed;
    })[0];
}

function buildTechniqueHint({ speciesKey, zoneId, recentSignal, waterTempF }) {
  const warm = Number.isFinite(waterTempF) && waterTempF >= 55;
  const active = recentSignal >= 58;

  if (speciesKey === "walleye") {
    if (zoneId === "river-mouth" || zoneId === "inner-bay") {
      return active
        ? "Start with controlled passes along transition edges; adjust speed before changing color."
        : "Work slower transition edges and tighten turns near plume boundaries.";
    }
    return warm
      ? "Cover water first, then repeat productive breaks."
      : "Use slower presentations on structure-facing edges before roaming.";
  }

  if (speciesKey === "perch") {
    return active
      ? "Stay put longer on active pods and downsize only if marks thin."
      : "Use patient bottom-oriented drifts and relocate quickly when marks fade.";
  }

  return "Begin with conservative passes in protected sections, then expand only after stable boat control.";
}

function explainZone({ safety, fishability, recentSignal, confidence, windCardinal, exposureFactor, conditions, reportCount, gate, tripScore }) {
  const reasons = [];
  if (gate === 0) {
    reasons.push("Safety gate forced utility to 0 for this zone.");
  }
  reasons.push(`${windCardinal} wind creates ${exposureFactor >= 1.05 ? "higher" : "lower"} wave exposure here.`);
  reasons.push(`Utility ${tripScore}, safety ${safety}, fishability ${round(fishability)}, signal ${round(recentSignal)}.`);
  if (Number.isFinite(conditions.waveFtNoaaGrid)) {
    reasons.push(`NOAA grid wave guidance near ${round(conditions.waveFtNoaaGrid, 1)} ft.`);
  }
  if (conditions.smallBoatWindowHours <= 4) {
    reasons.push("Short small-boat weather window reduces confidence.");
  } else {
    reasons.push(`Small-boat window around ${conditions.smallBoatWindowHours} hours today.`);
  }
  reasons.push(reportCount ? `${reportCount} local report(s) anchored this zone.` : "Few direct reports for this zone.");
  reasons.push(`Confidence sits at ${confidence}.`);
  return reasons.slice(0, 4);
}

function buildBayRationale({ goNoGo, topZone, conditions, averageSafety, maxUtility, severeAlert, hardSafetyOverride, alertCount }) {
  const reasons = [];
  const thresholds = MODEL_CONFIG.decisionThresholds;

  if (hardSafetyOverride) {
    reasons.push("Hard safety gate triggered by advisories or high wind/waves.");
  } else if (goNoGo === "GO") {
    reasons.push("Utility and safety thresholds are both met.");
  } else if (goNoGo === "CAUTION") {
    reasons.push("Utility is in caution range; keep plans conservative.");
  } else {
    reasons.push("Utility is below the caution threshold.");
  }

  reasons.push(`${topZone?.name || "Top zone"} utility is ${maxUtility}.`);
  reasons.push(`GO needs utility >= ${thresholds.goMinUtility} and avg safety >= ${thresholds.goMinAvgSafety}.`);
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

function normalizeFriction(value) {
  if (!MODEL_CONFIG.normalization.frictionScaleTo100) {
    return value;
  }
  const max = MODEL_CONFIG.normalization.frictionMax || 40;
  return clamp((value / max) * 100, 0, 100);
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
  const gate = MODEL_CONFIG.safetyGate;
  return alerts.find((alert) => {
    const severity = String(alert.severity || "").toLowerCase();
    const event = String(alert.event || "").toLowerCase();
    const keywordHit = gate.advisoryKeywords.some((keyword) => event.includes(keyword));
    const severityHit = gate.severityKeywords.some((keyword) => severity.includes(keyword));
    return keywordHit || severityHit;
  }) || null;
}

function isHardSafetyOverride({ severeAlert, alerts, conditions }) {
  const gate = MODEL_CONFIG.safetyGate;
  if (severeAlert) {
    return true;
  }
  if ((conditions.windMph || 0) >= gate.windMph) {
    return true;
  }
  if ((conditions.waveFt || 0) >= gate.waveFt) {
    return true;
  }

  return alerts.some((alert) => {
    const event = String(alert.event || "").toLowerCase();
    return gate.advisoryKeywords.some((keyword) => event.includes(keyword));
  });
}

function zoneName(zoneId) {
  const zone = ZONES.find((item) => item.id === zoneId);
  return zone ? zone.name : zoneId;
}

module.exports = {
  buildDailySummary,
};
