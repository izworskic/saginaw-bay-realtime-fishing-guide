const BAY_CENTER = Object.freeze({
  lat: 43.83,
  lon: -83.74,
  timezone: "America/Detroit",
});

const SPECIES = Object.freeze({
  walleye: Object.freeze({
    key: "walleye",
    label: "Walleye",
    tempMinF: 48,
    tempMaxF: 68,
    trendPreference: "warming",
  }),
  perch: Object.freeze({
    key: "perch",
    label: "Perch",
    tempMinF: 45,
    tempMaxF: 65,
    trendPreference: "stable",
  }),
  mixed: Object.freeze({
    key: "mixed",
    label: "Mixed Bag",
    tempMinF: 46,
    tempMaxF: 67,
    trendPreference: "warming",
  }),
});

const ZONES = Object.freeze([
  Object.freeze({
    id: "west-side",
    name: "West Side",
    friction: 15,
    exposure: { N: 0.8, NE: 0.85, E: 1.25, SE: 1.2, S: 0.95, SW: 0.72, W: 0.62, NW: 0.7 },
  }),
  Object.freeze({
    id: "east-side",
    name: "East Side",
    friction: 17,
    exposure: { N: 0.95, NE: 1.08, E: 0.76, SE: 0.7, S: 0.86, SW: 1.15, W: 1.25, NW: 1.04 },
  }),
  Object.freeze({
    id: "inner-bay",
    name: "Inner Bay",
    friction: 12,
    exposure: { N: 0.74, NE: 0.8, E: 0.94, SE: 0.92, S: 0.82, SW: 0.82, W: 0.88, NW: 0.76 },
  }),
  Object.freeze({
    id: "outer-bay",
    name: "Outer Bay",
    friction: 24,
    exposure: { N: 1.2, NE: 1.22, E: 1.2, SE: 1.16, S: 1.18, SW: 1.21, W: 1.24, NW: 1.19 },
  }),
  Object.freeze({
    id: "river-mouth",
    name: "River Mouth",
    friction: 10,
    exposure: { N: 0.66, NE: 0.7, E: 0.8, SE: 0.85, S: 0.84, SW: 0.82, W: 0.8, NW: 0.72 },
  }),
  Object.freeze({
    id: "shipping-channel",
    name: "Shipping Channel",
    friction: 20,
    exposure: { N: 0.96, NE: 1.02, E: 1.1, SE: 1.08, S: 0.94, SW: 1.0, W: 1.05, NW: 0.98 },
  }),
  Object.freeze({
    id: "reefs",
    name: "Named Reefs",
    friction: 22,
    exposure: { N: 1.12, NE: 1.2, E: 1.08, SE: 1.02, S: 0.98, SW: 1.02, W: 1.08, NW: 1.14 },
  }),
]);

const LAUNCHES = Object.freeze([
  Object.freeze({
    id: "linwood",
    name: "Linwood Beach Marina",
    zoneId: "west-side",
    exposedTo: ["E", "NE"],
    notes: "Fast west-inner access and protected staging in moderate west wind.",
  }),
  Object.freeze({
    id: "au-gres",
    name: "Au Gres Harbor",
    zoneId: "west-side",
    exposedTo: ["E", "SE"],
    notes: "Strong for west/outer transitions when east wind stays manageable.",
  }),
  Object.freeze({
    id: "sebewaing",
    name: "Sebewaing Harbor",
    zoneId: "east-side",
    exposedTo: ["W", "NW"],
    notes: "Useful east-side launch; exposure climbs quickly in hard west wind.",
  }),
  Object.freeze({
    id: "quanicassee",
    name: "Quanicassee DNR Launch",
    zoneId: "east-side",
    exposedTo: ["W", "SW"],
    notes: "Short run to east-side fish but watch shallow chop in sustained west wind.",
  }),
  Object.freeze({
    id: "bay-city-state-park",
    name: "Bay City State Park Launch",
    zoneId: "river-mouth",
    exposedTo: ["N", "NE"],
    notes: "Protected option for short-window trips near the river transition.",
  }),
  Object.freeze({
    id: "essexville",
    name: "Essexville Access",
    zoneId: "inner-bay",
    exposedTo: ["N", "NE"],
    notes: "Quick inner-bay option for small-boat sessions.",
  }),
  Object.freeze({
    id: "channel-access",
    name: "Shipping Channel Access",
    zoneId: "shipping-channel",
    exposedTo: ["N", "NW"],
    notes: "Good when channel drift sets up and wind does not stack waves.",
  }),
]);

const FALLBACK_REPORTS = Object.freeze([
  Object.freeze({
    id: "fallback-1",
    zoneId: "west-side",
    source: "charter-log",
    species: "walleye",
    signal: 0.55,
    freshnessHours: 7,
    summary: "Trolling bite improved during early light with cleaner water.",
  }),
  Object.freeze({
    id: "fallback-2",
    zoneId: "inner-bay",
    source: "bait-shop",
    species: "perch",
    signal: 0.2,
    freshnessHours: 10,
    summary: "Spotty perch reports; better with slower presentations near transition edges.",
  }),
  Object.freeze({
    id: "fallback-3",
    zoneId: "east-side",
    source: "forum",
    species: "walleye",
    signal: -0.1,
    freshnessHours: 13,
    summary: "Some marks found, but boat control was difficult in open sections.",
  }),
  Object.freeze({
    id: "fallback-4",
    zoneId: "reefs",
    source: "guide-note",
    species: "mixed",
    signal: 0.3,
    freshnessHours: 6,
    summary: "Reef edges produced short windows when current and wind aligned.",
  }),
  Object.freeze({
    id: "fallback-5",
    zoneId: "river-mouth",
    source: "public-report",
    species: "mixed",
    signal: 0.1,
    freshnessHours: 8,
    summary: "River plume had variable clarity; some fish moved shallow during warm-up.",
  }),
]);

module.exports = {
  BAY_CENTER,
  SPECIES,
  ZONES,
  LAUNCHES,
  FALLBACK_REPORTS,
};
