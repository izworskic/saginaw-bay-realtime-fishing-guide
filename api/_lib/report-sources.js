/**
 * report-sources.js
 * Scrapes/fetches fishing reports from public sources.
 * Returns normalized report objects with zone tags and signal scores.
 */

const TIMEOUT = 10000;

/* ================================================================
   ZONE KEYWORD MAP - maps location mentions to zone IDs
   ================================================================ */
const ZONE_KEYWORDS = {
  "west-side": ["linwood", "au gres", "augres", "standish", "pinconning", "eagle bay", "pine river", "gambil", "gamble", "west side", "western"],
  "east-side": ["sebewaing", "quanicassee", "caseville", "wildfowl", "geiger", "thumb", "east side", "eastern", "callahan"],
  "inner-bay": ["inner bay", "inner saginaw", "spoils island", "essexville", "lower saginaw bay", "lower bay", "smith park"],
  "outer-bay": ["outer bay", "outer saginaw", "lake huron", "deep water", "outer"],
  "river-mouth": ["saginaw river", "river mouth", "coast guard station", "independence bridge"],
  "shipping-channel": ["shipping channel", "channel", "old shipping"],
  "reefs": ["reef", "callahan reef", "gravelly shoal"],
};

const SPECIES_KEYWORDS = {
  walleye: ["walleye", "eye", "wall-eye", "trolling"],
  perch: ["perch", "yellow perch"],
  bass: ["bass", "smallmouth", "largemouth"],
  pike: ["pike", "northern pike"],
  salmon: ["salmon", "chinook", "coho", "king"],
  steelhead: ["steelhead", "rainbow", "steel"],
};

/* ================================================================
   DNR WEEKLY REPORT
   Fetched from michigan.gov GovDelivery
   ================================================================ */
async function fetchDnrReport() {
  // The DNR report page links to GovDelivery bulletins
  // We can fetch the main fishing report page and parse the Saginaw Bay section
  const url = "https://www.michigan.gov/dnr/things-to-do/fishing/weekly";

  try {
    const html = await fetchText(url);
    // Look for Saginaw Bay section in the page content
    const sagSection = extractSection(html, "saginaw bay", ["tawas", "au sable", "oscoda", "port austin", "thunder bay"]);

    if (!sagSection) {
      return {
        source: "michigan-dnr",
        sourceName: "Michigan DNR Weekly Report",
        sourceUrl: url,
        status: "no-saginaw-section",
        reports: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    const reports = parseReportText(sagSection, "michigan-dnr", "Michigan DNR");
    return {
      source: "michigan-dnr",
      sourceName: "Michigan DNR Weekly Report",
      sourceUrl: url,
      status: "ok",
      reports,
      rawExcerpt: sagSection.slice(0, 500),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "michigan-dnr",
      sourceName: "Michigan DNR Weekly Report",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   SAGINAWBAY.COM WEEKLY REPORTS
   ================================================================ */
async function fetchSaginawBayCom() {
  const url = "https://saginawbay.com/weekly-fishing-reports.html";

  try {
    const html = await fetchText(url);
    // Extract report content - the site uses article/post blocks
    const reports = [];
    const textContent = stripHtml(html);

    // Split into paragraphs and look for fishing report content
    const paragraphs = textContent.split(/\n+/).filter(p => p.trim().length > 40);

    for (const para of paragraphs.slice(0, 10)) {
      if (isBoilerplate(para)) continue;
      const lower = para.toLowerCase();
      if (lower.includes("walleye") || lower.includes("perch") || lower.includes("fishing") ||
          lower.includes("caught") || lower.includes("anglers")) {
        const parsed = parseReportText(para, "saginawbay-com", "SaginawBay.com");
        reports.push(...parsed);
      }
    }

    return {
      source: "saginawbay-com",
      sourceName: "SaginawBay.com Weekly Reports",
      sourceUrl: url,
      status: reports.length ? "ok" : "no-reports",
      reports: reports.slice(0, 8),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "saginawbay-com",
      sourceName: "SaginawBay.com Weekly Reports",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   FISHINGBOOKER DAILY REPORTS
   ================================================================ */
async function fetchFishingBooker() {
  const url = "https://fishingbooker.com/reports/destination/us/saginaw-bay";

  try {
    const html = await fetchText(url);
    const textContent = stripHtml(html);
    const reports = [];

    // FishingBooker reports are captain logs with depth/lure/speed details
    const chunks = textContent.split(/(?:Continue reading|Loading Fish Calendar)/i).filter(c => c.trim().length > 50);

    for (const chunk of chunks.slice(0, 8)) {
      if (isBoilerplate(chunk)) continue;
      const lower = chunk.toLowerCase();
      if (lower.includes("fow") || lower.includes("walleye") || lower.includes("limit") ||
          lower.includes("saginaw bay") || lower.includes("trolling") || lower.includes("crawlers")) {
        const parsed = parseCharterReport(chunk);
        if (parsed) reports.push(parsed);
      }
    }

    return {
      source: "fishingbooker",
      sourceName: "FishingBooker Charter Reports",
      sourceUrl: url,
      status: reports.length ? "ok" : "no-reports",
      reports: reports.slice(0, 6),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "fishingbooker",
      sourceName: "FishingBooker Charter Reports",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   LINWOOD BEACH MARINA BLOG
   ================================================================ */
async function fetchLinwoodMarina() {
  const url = "https://www.linwoodbeachmarina.com/blog/category/fishing-report--1801";

  try {
    const html = await fetchText(url);
    const textContent = stripHtml(html);
    const reports = [];

    const paragraphs = textContent.split(/\n+/).filter(p => p.trim().length > 30);

    for (const para of paragraphs.slice(0, 10)) {
      if (isBoilerplate(para)) continue;
      const lower = para.toLowerCase();
      if (lower.includes("walleye") || lower.includes("perch") || lower.includes("fishing") ||
          lower.includes("water") || lower.includes("fow")) {
        const parsed = parseReportText(para, "linwood-marina", "Linwood Beach Marina");
        reports.push(...parsed);
      }
    }

    return {
      source: "linwood-marina",
      sourceName: "Linwood Beach Marina",
      sourceUrl: url,
      status: reports.length ? "ok" : "no-reports",
      reports: reports.slice(0, 4),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "linwood-marina",
      sourceName: "Linwood Beach Marina",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   SPORTSMAN'S WAREHOUSE REPORT
   ================================================================ */
async function fetchSportsmansWarehouse() {
  const url = "https://fishingreports.sportsmans.com/fishing-report/saginaw-bay/32633/";

  try {
    const html = await fetchText(url);
    const textContent = stripHtml(html);
    const reports = [];

    const paragraphs = textContent.split(/\n+/).filter(p => p.trim().length > 40);

    for (const para of paragraphs.slice(0, 10)) {
      if (isBoilerplate(para)) continue;
      const lower = para.toLowerCase();
      if (lower.includes("walleye") || lower.includes("perch") || lower.includes("saginaw")) {
        const parsed = parseReportText(para, "sportsmans-warehouse", "Sportsman's Warehouse");
        reports.push(...parsed);
      }
    }

    return {
      source: "sportsmans-warehouse",
      sourceName: "Sportsman's Warehouse",
      sourceUrl: url,
      status: reports.length ? "ok" : "no-reports",
      reports: reports.slice(0, 4),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "sportsmans-warehouse",
      sourceName: "Sportsman's Warehouse",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   GREAT LAKES FISHERMAN'S DIGEST
   ================================================================ */
async function fetchFishermansDigest() {
  const url = "https://www.greatlakesfishermansdigest.com/index.php?page=Great_Lakes_Bay_Region&report=true";

  try {
    const html = await fetchText(url);
    const textContent = stripHtml(html);
    const reports = [];

    const paragraphs = textContent.split(/\n+/).filter(p => p.trim().length > 40);

    for (const para of paragraphs.slice(0, 10)) {
      if (isBoilerplate(para)) continue;
      const lower = para.toLowerCase();
      if (lower.includes("saginaw") || lower.includes("walleye") || lower.includes("bay")) {
        const parsed = parseReportText(para, "fishermans-digest", "Great Lakes Fisherman's Digest");
        reports.push(...parsed);
      }
    }

    return {
      source: "fishermans-digest",
      sourceName: "Great Lakes Fisherman's Digest",
      sourceUrl: url,
      status: reports.length ? "ok" : "no-reports",
      reports: reports.slice(0, 4),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "fishermans-digest",
      sourceName: "Great Lakes Fisherman's Digest",
      sourceUrl: url,
      status: "error",
      error: err.message,
      reports: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/* ================================================================
   MASTER FETCH - All reports
   ================================================================ */
async function fetchAllReports() {
  const results = await Promise.all([
    safeCall(fetchDnrReport, "michigan-dnr"),
    safeCall(fetchSaginawBayCom, "saginawbay-com"),
    safeCall(fetchFishingBooker, "fishingbooker"),
    safeCall(fetchLinwoodMarina, "linwood-marina"),
    safeCall(fetchSportsmansWarehouse, "sportsmans-warehouse"),
    safeCall(fetchFishermansDigest, "fishermans-digest"),
  ]);

  const allReports = [];
  const sourceSummary = [];

  for (const result of results) {
    sourceSummary.push({
      source: result.source || "unknown",
      sourceName: result.sourceName || result.source,
      sourceUrl: result.sourceUrl || null,
      status: result.status || "unknown",
      reportCount: result.reports?.length || 0,
      error: result.error || null,
    });
    if (result.reports) {
      allReports.push(...result.reports);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalReports: allReports.length,
    sources: sourceSummary,
    reports: allReports,
  };
}

/* ================================================================
   PARSING HELPERS
   ================================================================ */
function parseReportText(text, sourceId, sourceName) {
  let clean = text.replace(/\s+/g, " ").trim();
  clean = cleanSummary(clean);
  if (clean.length < 30 || isBoilerplate(clean)) return [];

  const zones = detectZones(clean);
  const species = detectSpecies(clean);
  const signal = estimateSignal(clean);
  const depth = extractDepth(clean);

  return [{
    id: `${sourceId}-${hashCode(clean)}`,
    source: sourceId,
    sourceName,
    zones,
    primaryZone: zones[0] || "bay-wide",
    species,
    primarySpecies: species[0] || "mixed",
    signal,
    depth,
    summary: clean.slice(0, 300),
    fetchedAt: new Date().toISOString(),
  }];
}

function parseCharterReport(text) {
  let clean = text.replace(/\s+/g, " ").trim();
  clean = cleanSummary(clean);
  if (clean.length < 30 || isBoilerplate(clean)) return null;

  const zones = detectZones(clean);
  const species = detectSpecies(clean);
  const signal = estimateSignal(clean);
  const depth = extractDepth(clean);
  const speed = extractSpeed(clean);
  const lure = extractLure(clean);

  return {
    id: `charter-${hashCode(clean)}`,
    source: "fishingbooker",
    sourceName: "Charter Captain",
    type: "charter-log",
    zones,
    primaryZone: zones[0] || "bay-wide",
    species,
    primarySpecies: species[0] || "walleye",
    signal,
    depth,
    speed,
    lure,
    summary: clean.slice(0, 300),
    fetchedAt: new Date().toISOString(),
  };
}

function detectZones(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [zone, keywords] of Object.entries(ZONE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      found.push(zone);
    }
  }
  return found;
}

function detectSpecies(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [species, keywords] of Object.entries(SPECIES_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      found.push(species);
    }
  }
  return found;
}

function estimateSignal(text) {
  const lower = text.toLowerCase();
  let score = 0;

  // Positive signals
  if (/\b(limit|limits|box full|great|excellent|hot|fantastic|amazing|stellar|tanks?)\b/.test(lower)) score += 0.6;
  if (/\b(good|nice|decent|steady|consistent|plenty|lots|active)\b/.test(lower)) score += 0.35;
  if (/\b(few|some|fair|ok|okay|moderate)\b/.test(lower)) score += 0.1;

  // Negative signals
  if (/\b(slow|tough|poor|nothing|dead|shut down|no fish|skunked|zero)\b/.test(lower)) score -= 0.5;
  if (/\b(spotty|scattered|hit.and.miss|hit or miss|mixed|inconsistent)\b/.test(lower)) score -= 0.1;
  if (/\b(windy|rough|blow|waves|dangerous|unsafe)\b/.test(lower)) score -= 0.15;

  return Math.max(-1, Math.min(1, round(score, 2)));
}

function extractDepth(text) {
  const match = text.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*(?:fow|feet? of water|ft|foot)/i);
  if (match) return { min: parseInt(match[1]), max: parseInt(match[2]), unit: "ft" };
  const single = text.match(/(\d+)\s*(?:fow|feet? of water)/i);
  if (single) return { min: parseInt(single[1]), max: parseInt(single[1]), unit: "ft" };
  return null;
}

function extractSpeed(text) {
  const match = text.match(/([\d.]+)\s*(?:to|-)\s*([\d.]+)\s*mph/i);
  if (match) return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
  const single = text.match(/([\d.]+)\s*mph/i);
  if (single) return { min: parseFloat(single[1]), max: parseFloat(single[1]) };
  return null;
}

function extractLure(text) {
  const lower = text.toLowerCase();
  const lures = [];
  if (lower.includes("crawler harness") || lower.includes("crawlers")) lures.push("crawler harness");
  if (lower.includes("crankbait") || lower.includes("crank bait")) lures.push("crankbait");
  if (lower.includes("flicker")) lures.push("flicker minnow");
  if (lower.includes("body bait")) lures.push("body bait");
  if (lower.includes("spoon")) lures.push("spoon");
  if (lower.includes("jig")) lures.push("jig");
  if (lower.includes("blade bait")) lures.push("blade bait");
  if (lower.includes("rapala")) lures.push("rapala");
  if (lower.includes("perch rig") || lower.includes("spreader")) lures.push("perch rig");
  return lures.length ? lures : null;
}

function extractSection(html, startKeyword, endKeywords) {
  const text = stripHtml(html);
  const lower = text.toLowerCase();
  const start = lower.indexOf(startKeyword);
  if (start === -1) return null;

  let end = text.length;
  for (const kw of endKeywords) {
    const pos = lower.indexOf(kw, start + startKeyword.length + 20);
    if (pos !== -1 && pos < end) end = pos;
  }

  return text.slice(start, end).trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip common leading page-title junk from scraped text */
function cleanSummary(text) {
  const prefixes = [
    /^(?:Saginaw Bay Area )?(?:Weekly )?Fishing Reports?.*?(?:Skip to (?:content|primary)[\w\s]*)/i,
    /^Daily (?:Saginaw Bay|Bay City) Fishing Reports?\s*\([^)]+\)\s*/i,
    /^Weekly fishing report:?\s*\w+\s+\d+,?\s*\d*\s*/i,
    /^(?:Saginaw Bay (?:Area )?)?(?:Fishers? and Boaters? )?Resources?.*?(?:Lake Huron.*?:)/i,
    /^(?:Great Lakes (?:Bay Region )?)?Fishing Report\s*/i,
    /^Fishing Report (?:Saginaw Bay|Captain)\s*/i,
    /^Saginaw Bay\s+(?:fishing\s+)?(?:report\s+)?(?:–|-)\s*/i,
    /^data-event[^"]*"[^"]*"\s*/i,
    /^Fresh Saginaw Bay Fishing Reports.*?(?:See recent|Check out)[^.]*\.\s*/i,
    /^Blog\s*\|\s*Linwood Beach Marina.*?(?:Our Blog|Skip to main content)\s*/i,
    /^Skip to (?:main )?content\s*/i,
    /^Our Blog\s*/i,
  ];
  let result = text;
  for (const re of prefixes) {
    result = result.replace(re, "");
  }
  return result.trim();
}

/** Filter out paragraphs that are navigation/boilerplate */
function isBoilerplate(text) {
  const lower = text.toLowerCase();
  const junk = [
    "skip to content", "skip to primary", "skip to main", "visitor center", "education programs",
    "buy and apply", "privacy policy", "recreation passport", "cookie",
    "sign up", "subscribe", "login", "log in", "list your", "data-event",
    "copyright", "all rights reserved", "terms of service", "powered by",
    "michigan dnr pocket", "hatchery visitor", "search is currently",
    "forest carbon", "grants go to", "click the box", "learn more",
    "we administer grants", "find a great trail", "shooting and archery",
    "snowmobile trail", "business registration", "forum registration",
    "tow boatu.s.", "boatus.com", "membership", "Loading Fish Calendar",
    "don't miss what's biting", "check out the latest catches",
    "see recent", "finding the best local", "finding the best charter",
    "cancel free of charge", "remaining balance",
    "legitimacy: verification", "technicality: verification",
    "we check thousands of charter", "book with fishingbooker",
    "give me a call at", "book a trip",
  ];
  return junk.some(j => lower.includes(j));
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length && i < 100; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function round(v, d) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SaginawBayFishingHub/2.0 (saginawbay.chrisizworski.com)" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function safeCall(fn, label) {
  try {
    return await fn();
  } catch (err) {
    return { source: label, status: "error", error: err.message, reports: [] };
  }
}

module.exports = {
  fetchAllReports,
  fetchDnrReport,
  fetchSaginawBayCom,
  fetchFishingBooker,
  fetchLinwoodMarina,
  fetchSportsmansWarehouse,
  fetchFishermansDigest,
};
