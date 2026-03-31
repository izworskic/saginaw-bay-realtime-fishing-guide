function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, current) => sum + current, 0) / values.length;
}

function cToF(valueC) {
  return valueC * 9 / 5 + 32;
}

function metersToFeet(valueMeters) {
  return valueMeters * 3.28084;
}

function directionToCardinal(degrees) {
  if (!Number.isFinite(degrees)) {
    return "N";
  }
  const normalized = ((degrees % 360) + 360) % 360;
  const cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(normalized / 45) % 8;
  return cardinals[index];
}

function hoursSince(timestamp, nowMs = Date.now()) {
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) {
    return 999;
  }
  return Math.max(0, (nowMs - parsed) / 3600000);
}

function confidenceLabel(score) {
  if (score >= 74) {
    return "high";
  }
  if (score >= 52) {
    return "medium";
  }
  return "low";
}

function normalizeZoneId(raw) {
  if (!raw) {
    return null;
  }
  const value = String(raw).toLowerCase();
  if (value.includes("west")) {
    return "west-side";
  }
  if (value.includes("east")) {
    return "east-side";
  }
  if (value.includes("inner")) {
    return "inner-bay";
  }
  if (value.includes("outer")) {
    return "outer-bay";
  }
  if (value.includes("river")) {
    return "river-mouth";
  }
  if (value.includes("channel")) {
    return "shipping-channel";
  }
  if (value.includes("reef")) {
    return "reefs";
  }
  return null;
}

function sourceWeight(sourceName) {
  const source = String(sourceName || "").toLowerCase();
  if (source.includes("nws") || source.includes("noaa") || source.includes("dnr")) {
    return 1.15;
  }
  if (source.includes("charter") || source.includes("guide")) {
    return 1.05;
  }
  if (source.includes("forum") || source.includes("social")) {
    return 0.72;
  }
  if (source.includes("user")) {
    return 0.66;
  }
  return 0.9;
}

module.exports = {
  average,
  cToF,
  clamp,
  confidenceLabel,
  directionToCardinal,
  hoursSince,
  metersToFeet,
  normalizeZoneId,
  round,
  sourceWeight,
};
