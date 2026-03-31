const { MODEL_CONFIG, normalizeWeights, proposeWeeklyWeights } = require("./_lib/objective-model");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const htdr = Number(req.query?.htdr);
  const safetyMissRate = Number(req.query?.safetyMissRate);
  const calibrationError = Number(req.query?.calibrationError);

  if (!Number.isFinite(htdr) || !Number.isFinite(safetyMissRate) || !Number.isFinite(calibrationError)) {
    sendJson(res, 400, {
      error: "Missing or invalid metrics",
      required: ["htdr", "safetyMissRate", "calibrationError"],
      example: "/api/objective-update?htdr=0.71&safetyMissRate=0.018&calibrationError=0.09",
    });
    return;
  }

  const currentWeights = normalizeWeights(parseWeights(req.query));
  const result = proposeWeeklyWeights({
    currentWeights,
    htdr,
    safetyMissRate,
    calibrationError,
    learningRate: Number(req.query?.learningRate),
  });

  sendJson(res, 200, {
    modelVersion: MODEL_CONFIG.version,
    learningObjective: MODEL_CONFIG.learningObjective.formula,
    constraints: MODEL_CONFIG.constraints,
    targets: MODEL_CONFIG.learningObjective.targets,
    ...result,
  });
};

function parseWeights(query = {}) {
  const fromQuery = {
    safety: query.wSafety,
    fishability: query.wFishability,
    recentSignal: query.wRecentSignal,
    confidence: query.wConfidence,
    friction: query.wFriction,
  };

  if (Object.values(fromQuery).some((value) => value != null)) {
    return fromQuery;
  }

  const json = query.currentWeightsJson;
  if (!json) {
    return null;
  }

  try {
    return JSON.parse(String(json));
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(payload);
}
